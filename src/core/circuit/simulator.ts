/**
 * Transient circuit simulator: Modified Nodal Analysis + Newton–Raphson + θ-method integration.
 *
 *  - Nominal internal step h = settings.timestep on a global grid (results do not depend on how
 *    the caller chops time into step(dt) calls), with adaptive sub-stepping inside a grid step:
 *      · a step containing a switching event of a behavioural device (555 comparator…) is split
 *        at the interpolated event time;
 *      · a step Newton cannot solve (hard transients, regenerative switching in multivibrators /
 *        latches) is redone by adaptive micro-stepping (÷8 on failure, ×2 on success, down to
 *        h·2⁻²⁶). A 20 pF stray capacitance on the nodes of nonlinear devices makes such jumps a
 *        short continuous transient instead of an unsolvable discontinuity.
 *  - Integration: lightly damped trapezoidal (θ = 0.53) with backward Euler (θ = 1) at start-up,
 *    after every discontinuity (switch, logic edge, prop change) and on reduced steps.
 *  - Newton–Raphson: linear devices are stamped once per step, nonlinear ones per iteration;
 *    junction voltage limiting (pnjlim + current-based turn-off limiting), linear predictor,
 *    damping after 25 iterations; convergence is judged on the variables nonlinear devices read.
 *  - Linear algebra: LU with partial pivoting that re-uses pivot order and fill pattern (solver.ts).
 *  - Floating sub-circuits: gmin on every node, plus one 1 mS tie to ground per conductively
 *    isolated island (reference = a source's negative pin when there is one). With no ground
 *    symbol at all, voltages are therefore relative to that reference.
 *  - Circuits start from rest (capacitors at their initial voltage, inductors at 0 A) at t = 0.
 *  - step() never throws; problems are reported through state.converged / state.error.
 *  - A wall-clock budget keeps step() real-time: if a call takes longer than `wallBudgetMs`, the
 *    remaining simulated time is dropped (the simulation runs slower than real time instead of
 *    freezing the UI). Check state.time to see how far it actually advanced.
 */
import type { CircuitComponentState, CircuitScene, CircuitSimulator, CircuitState, ParamValue } from '../types';
import { Device, InteractAction, MNA } from './devices';
import { createDevice } from './devices-extra';
import { Netlist, buildNetlist } from './netlist';
import { getPinDefs, registryMap } from './registry';
import { SparseLU } from './solver';

export interface SimulatorOptions {
  /** Max wall-clock ms per step() call before the rest of dt is dropped. Default 24. Infinity disables. */
  wallBudgetMs?: number;
}

const THETA = 0.53;
const MAX_NEWTON = 60;
/** Stray capacitance to ground on every node of a nonlinear device (keeps switching transitions solvable at tiny steps). */
const C_STRAY = 20e-12;
/** Micro-stepping (used when a full step does not converge): smallest sub-step as a fraction of the step. */
const MICRO_MIN = 1 / (1 << 26);
const EVENT_SPLITS = 2;
const G_TIE = 1e-3;
const SOURCE_TYPES = new Set(['source.battery', 'source.psu', 'source.ac', 'source.function_gen', 'source.current', 'opto.solar_cell']);

export const DEFAULT_SETTINGS: CircuitScene['settings'] = { timestep: 2e-5, simSpeed: 1, gmin: 1e-12 };

export class Simulator implements CircuitSimulator, MNA {
  // --- MNA interface
  v: Float64Array = new Float64Array(1);
  h = 1e-5;
  ah = 1e5;
  hist = 0;
  time = 0;
  gmin = 1e-12;
  limited = false;

  wallBudgetMs: number;

  /** Stamp targets (switched between the linear base system and the per-iteration system). */
  private M: Float64Array = new Float64Array(0);
  private R: Float64Array = new Float64Array(0);
  /** Per-iteration system (row-major flat n×n) and right-hand side. */
  private A: Float64Array = new Float64Array(0);
  private b: Float64Array = new Float64Array(0);
  /** Structural non-zero pattern of the matrix (grows as devices stamp new entries). */
  private pat: Uint8Array = new Uint8Array(0);
  private lu: SparseLU = new SparseLU(0);
  private vNew: Float64Array = new Float64Array(1);
  /** Linear part of the system, stamped once per step. */
  private A0: Float64Array = new Float64Array(0);
  private b0: Float64Array = new Float64Array(0);
  private linDevs: Device[] = [];
  private nlDevs: Device[] = [];
  /** Piecewise-linear devices (subset of nlDevs): convergence = their mode agrees with the solution. */
  private pwlDevs: Device[] = [];
  /** Variables read by nonlinear devices: only these need to be self-consistent for Newton convergence. */
  private nlVars: Int32Array = new Int32Array(0);
  /** Solution one accepted step back (for the Newton predictor) and the step that led to `v`. */
  private vOld: Float64Array = new Float64Array(1);
  private hOld = 0;
  /** Solution at the start of the step being solved (history of the stray capacitances). */
  private vStart: Float64Array = new Float64Array(1);
  private saved: Float64Array[] = [];
  private nNodes = 0;
  private nVars = 0;
  private devs: Device[] = [];
  private evDevs: Device[] = [];
  private byId = new Map<string, Device>();
  private netlist: Netlist = { netIds: ['GND'], pinNode: new Map(), pinNets: {}, pinCount: [0], hasGround: false };
  private ties: number[] = [];
  private nonlinear = false;
  private timestep = DEFAULT_SETTINGS.timestep;
  private pending = 0;
  private beCount = 2;
  private eventFlag = false;
  private converged = true;
  private error: string | undefined;
  private buildError: string | undefined;
  private singular = false;
  private stateCache: CircuitState | null = null;

  constructor(scene: CircuitScene, opts: SimulatorOptions = {}) {
    this.wallBudgetMs = opts.wallBudgetMs ?? 24;
    try {
      this.build(scene);
    } catch (e) {
      this.buildError = `Circuit build failed: ${e instanceof Error ? e.message : String(e)}`;
      this.devs = [];
      this.evDevs = [];
      this.nNodes = 0;
      this.nVars = 0;
      this.v = new Float64Array(1);
    }
  }

  // ------------------------------------------------------------------------------- build
  private build(scene: CircuitScene): void {
    const s = scene.settings ?? DEFAULT_SETTINGS;
    this.timestep = Number.isFinite(s.timestep) && s.timestep > 0 ? Math.max(s.timestep, 1e-9) : DEFAULT_SETTINGS.timestep;
    this.gmin = Number.isFinite(s.gmin) && s.gmin > 0 ? s.gmin : DEFAULT_SETTINGS.gmin;

    const nl = buildNetlist(scene);
    this.netlist = nl;
    this.nNodes = nl.netIds.length - 1;
    let nBr = 0;
    for (const comp of scene.components ?? []) {
      if (this.byId.has(comp.id)) continue; // duplicate ids: ignore later copies
      const def = registryMap.get(comp.type);
      const dev = createDevice(comp, def);
      const pins = getPinDefs(comp);
      dev.n = pins.map((p) => nl.pinNode.get(`${comp.id}:${p.name}`) ?? 0);
      dev.dangling = dev.n.map((node) => node !== 0 && nl.pinCount[node] <= 1);
      dev.br = this.nNodes + 1 + nBr;
      nBr += dev.nBr;
      dev.configure();
      dev.reset();
      this.devs.push(dev);
      this.byId.set(comp.id, dev);
    }
    this.nVars = this.nNodes + nBr;
    this.nonlinear = this.devs.some((d) => d.nonlinear);
    this.evDevs = this.devs.filter((d) => d.eventFraction !== Device.prototype.eventFraction);
    this.linDevs = this.devs.filter((d) => !d.nonlinear);
    this.nlDevs = this.devs.filter((d) => d.nonlinear);
    this.pwlDevs = this.nlDevs.filter((d) => d.pwl);
    const nlSet = new Set<number>();
    for (const d of this.nlDevs) {
      if (d.pwl) continue; // linear within a mode: checked through consistent() instead
      for (const node of d.n) if (node > 0) nlSet.add(node);
      for (let k = 0; k < d.nBr; k++) nlSet.add(d.br + k);
    }
    this.nlVars = Int32Array.from([...nlSet].sort((a, b) => a - b));

    const n = this.nVars;
    this.A = new Float64Array(n * n);
    this.b = new Float64Array(n);
    this.A0 = new Float64Array(n * n);
    this.b0 = new Float64Array(n);
    this.M = this.A;
    this.R = this.b;
    this.pat = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) this.pat[i * (n + 1)] = 1;
    this.lu = new SparseLU(n);
    this.vOld = new Float64Array(n + 1);
    this.v = new Float64Array(n + 1);
    this.vNew = new Float64Array(n + 1);
    this.saved = Array.from({ length: EVENT_SPLITS + 2 }, () => new Float64Array(n + 1));
    this.findIslands();
  }

  /** Conductively isolated sub-circuits without a ground get one node tied to ground (no current flows through a single tie). */
  private findIslands(): void {
    const N = this.nNodes;
    const parent = Array.from({ length: N + 1 }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    for (const d of this.devs) {
      for (const grp of d.groups()) {
        let first = -1;
        for (const pi of grp) {
          const node = pi < 0 ? 0 : d.n[pi];
          if (node === undefined) continue;
          if (first < 0) first = node;
          else union(first, node);
        }
      }
    }
    const ref = new Map<number, number>();
    // prefer the negative terminal of a source as island reference
    for (const d of this.devs) {
      if (!SOURCE_TYPES.has(d.comp.type) || d.n.length < 2) continue;
      const node = d.n[1];
      const r = find(node);
      if (r !== 0 && node !== 0 && !ref.has(r)) ref.set(r, node);
    }
    for (let i = 1; i <= N; i++) {
      const r = find(i);
      if (r !== 0 && !ref.has(r)) ref.set(r, i);
    }
    this.ties = [...ref.values()];
  }

  // ------------------------------------------------------------------------------- stamping
  g(a: number, b: number, G: number): void {
    const n = this.nVars, M = this.M;
    if (a > 0) {
      const ia = (a - 1) * n;
      M[ia + a - 1] += G;
      if (b > 0) {
        const ib = (b - 1) * n;
        M[ia + b - 1] -= G;
        M[ib + a - 1] -= G;
        M[ib + b - 1] += G;
        if (this.pat[ia + b - 1] === 0) this.mark(ia + b - 1, ib + a - 1);
      }
    } else if (b > 0) {
      M[(b - 1) * (n + 1)] += G;
    }
  }
  cur(a: number, b: number, I: number): void {
    if (a > 0) this.R[a - 1] -= I;
    if (b > 0) this.R[b - 1] += I;
  }
  add(r: number, c: number, val: number): void {
    if (r > 0 && c > 0) {
      const i = (r - 1) * this.nVars + c - 1;
      this.M[i] += val;
      if (this.pat[i] === 0) this.mark(i, i);
    }
  }
  rhs(r: number, val: number): void {
    if (r > 0) this.R[r - 1] += val;
  }
  private mark(i: number, j: number): void {
    this.pat[i] = 1;
    this.pat[j] = 1;
    this.lu.invalidate();
  }
  event(): void {
    this.eventFlag = true;
  }

  // ------------------------------------------------------------------------------- solving
  /** Newton–Raphson solve of the current step; this.v holds the initial guess and the result. */
  private solve(alpha = 0, maxIter = MAX_NEWTON): boolean {
    const n = this.nVars;
    if (n === 0) return true;
    const { v, vNew, nNodes, A0, b0, linDevs, nlDevs, pwlDevs } = this;
    // linear devices do not depend on the iterate: stamp them once per step
    const A = this.A, b = this.b, lu = this.lu;
    this.M = A0;
    this.R = b0;
    A0.fill(0);
    b0.fill(0);
    for (let i = 0; i < linDevs.length; i++) linDevs[i].stamp(this);
    for (let i = 0; i < nNodes; i++) A0[i * (n + 1)] += this.gmin;
    for (let i = 0; i < this.ties.length; i++) A0[(this.ties[i] - 1) * (n + 1)] += G_TIE;
    if (this.nonlinear) {
      // stray capacitances (backward Euler): negligible at normal steps, dominant at micro-steps
      const gc = C_STRAY / this.h;
      const nlVars = this.nlVars, vs = this.vStart;
      for (let k = 0; k < nlVars.length; k++) {
        const i = nlVars[k];
        if (i > nNodes) break;
        A0[(i - 1) * (n + 1)] += gc;
        b0[i - 1] += gc * vs[i];
      }
    }
    this.M = A;
    this.R = b;
    for (let iter = 0; iter < maxIter; iter++) {
      A.set(A0);
      b.set(b0);
      this.limited = false;
      for (let i = 0; i < nlDevs.length; i++) nlDevs[i].stamp(this);
      if (alpha > 0) {
        const nlVars = this.nlVars;
        for (let k = 0; k < nlVars.length; k++) {
          const i = nlVars[k];
          if (i > nNodes) break;
          A[(i - 1) * (n + 1)] += alpha;
          b[i - 1] += alpha * v[i];
        }
      }
      lu.solve(A, b, this.pat, vNew);
      if (lu.singular) this.singular = true;
      let finite = true;
      for (let i = 1; i <= n; i++) {
        if (!Number.isFinite(vNew[i])) {
          finite = false;
          break;
        }
      }
      if (!finite) return false;
      if (!this.nonlinear) {
        v.set(vNew);
        return true;
      }
      // The linear part is solved exactly; the solution is self-consistent as soon as the variables
      // the nonlinear devices were linearised at agree with the new solution.
      let conv = !this.limited;
      if (conv) {
        const nlVars = this.nlVars;
        for (let k = 0; k < nlVars.length; k++) {
          const i = nlVars[k];
          const a = vNew[i], c = v[i];
          const d = Math.abs(a - c);
          const tol = (i <= nNodes ? 1e-6 : 1e-9) + 1e-3 * Math.max(Math.abs(a), Math.abs(c));
          if (d > tol) {
            conv = false;
            break;
          }
        }
      }
      if (iter >= 25 && !conv) {
        for (let i = 1; i <= n; i++) v[i] += 0.5 * (vNew[i] - v[i]);
      } else {
        v.set(vNew);
      }
      if (conv) {
        // piecewise-linear devices: the solution must lie in the region they were stamped for
        for (let i = 0; i < pwlDevs.length; i++) if (!pwlDevs[i].consistent(this)) conv = false;
      }
      if (conv) return true;
    }
    return false;
  }

  private setStep(h: number, be: boolean, tEnd: number): void {
    const theta = be ? 1 : THETA;
    this.h = h;
    this.ah = 1 / (theta * h);
    this.hist = (1 - theta) / theta;
    this.time = tEnd;
  }

  /** Accept the current solution as the state at this.time. */
  private acceptStep(from: Float64Array, h: number): void {
    this.vOld.set(from);
    this.hOld = h;
    this.eventFlag = false;
    const devs = this.devs;
    for (let i = 0; i < devs.length; i++) devs[i].accept(this);
    if (this.eventFlag) {
      this.beCount = 2;
      this.hOld = 0;
    } else if (this.beCount > 0) this.beCount--;
  }

  private fail(from: Float64Array): void {
    this.converged = false;
    this.error = this.singular
      ? 'Singular circuit matrix (shorted voltage source or loop of ideal sources/inductors?)'
      : 'Simulation did not converge';
    const v = this.v;
    for (let i = 1; i <= this.nVars; i++) {
      if (!Number.isFinite(v[i])) {
        v.set(from);
        break;
      }
    }
  }

  private advance(h: number, depth: number): void {
    const t0 = this.time;
    const saved = this.saved[depth];
    const v = this.v;
    saved.set(v);
    this.vStart = saved;
    const be = this.beCount > 0 || depth > 0;
    this.setStep(h, be, t0 + h);
    // predictor: extrapolate the previous step as the Newton starting point (smooth stretches only)
    const predicted = this.nonlinear && !be && this.hOld > 0;
    if (predicted) {
      const r = h / this.hOld;
      const vOld = this.vOld;
      for (let i = 1; i <= this.nVars; i++) v[i] += r * (v[i] - vOld[i]);
    }
    let ok = this.solve();
    if (!ok && predicted) {
      // retry from the unextrapolated point before giving up on this step size
      v.set(saved);
      ok = this.solve();
    }
    if (!ok && this.nonlinear) {
      v.set(saved);
      this.time = t0;
      this.micro(t0, h);
      return;
    }
    if (ok && depth < EVENT_SPLITS && this.evDevs.length > 0) {
      let f = 2;
      for (let i = 0; i < this.evDevs.length; i++) {
        const fi = this.evDevs[i].eventFraction(this, saved);
        if (fi > 0 && fi < f) f = fi;
      }
      if (f < 0.9) {
        // re-solve so that the event lands (just) at the end of the first part
        const h1 = h * Math.min(f * 1.05 + 0.01, 0.95);
        v.set(saved);
        this.time = t0;
        this.advance(h1, depth + 1);
        this.advance(h - h1, depth + 1);
        this.time = t0 + h;
        return;
      }
    }
    if (!ok) this.fail(saved);
    this.acceptStep(saved, h);
  }

  /**
   * Adaptive micro-stepping across [t0, t0 + h] for intervals a single step cannot solve — hard
   * nonlinear transients and regenerative switching (multivibrators, Schmitt triggers, latches),
   * where the operating point jumps. Sub-steps shrink (÷8) until Newton converges and grow back
   * (×2) afterwards, so a fast transition is followed through as a short continuous transient.
   */
  private micro(t0: number, h: number): void {
    const v = this.v;
    const buf = this.saved[this.saved.length - 1];
    const hMin = h * MICRO_MIN;
    let t = 0;
    let hs = h / 4;
    let guard = 0;
    while (t < h * (1 - 1e-12) && guard++ < 20000) {
      if (hs > h - t) hs = h - t;
      buf.set(v);
      this.vStart = buf;
      this.setStep(hs, true, t0 + t + hs);
      const ok = this.solve(0, 14);
      if (!ok && hs > hMin * 1.0001) {
        v.set(buf);
        hs = Math.max(hs / 8, hMin);
        continue;
      }
      if (!ok) this.fail(buf);
      this.acceptStep(buf, hs);
      this.hOld = 0;
      t += hs;
      hs *= 2;
    }
    this.time = t0 + h;
    this.beCount = 2;
  }

  // ------------------------------------------------------------------------------- public API
  step(dt: number): CircuitState {
    try {
      if (Number.isFinite(dt) && dt > 0 && !this.buildError) {
        this.converged = true;
        this.error = undefined;
        this.singular = false;
        this.pending += dt;
        const h = this.timestep;
        let steps = Math.floor(this.pending / h + 1e-9);
        if (steps > 0) {
          this.pending = Math.max(0, this.pending - steps * h);
          const budget = this.wallBudgetMs;
          const limited = Number.isFinite(budget);
          const start = limited ? Date.now() : 0;
          let done = 0;
          while (steps-- > 0) {
            this.advance(h, 0);
            done++;
            if (limited && (done & 15) === 0 && Date.now() - start > budget) {
              this.pending = 0; // drop the backlog: run slower than real time
              break;
            }
          }
          if (this.singular) {
            this.converged = false;
            this.error ??= 'Singular circuit matrix (shorted voltage source or loop of ideal sources/inductors?)';
          }
        }
        this.stateCache = null;
      }
    } catch (e) {
      this.converged = false;
      this.error = `Simulation error: ${e instanceof Error ? e.message : String(e)}`;
      this.stateCache = null;
    }
    return this.getState();
  }

  interact(componentId: string, action: InteractAction): void {
    const d = this.byId.get(componentId);
    if (!d) return;
    try {
      if (d.interact(action)) {
        this.beCount = 2;
        this.stateCache = null;
      }
    } catch {
      /* ignore */
    }
  }

  setExternal(componentId: string, key: string, value: number): void {
    const d = this.byId.get(componentId);
    if (!d || !Number.isFinite(value)) return;
    if (d.ext[key] === value) return;
    d.setExternal(key, value);
    this.stateCache = null;
  }

  updateProps(componentId: string, props: Record<string, ParamValue>): void {
    const d = this.byId.get(componentId);
    if (!d || !props) return;
    try {
      d.setProps(props);
      this.beCount = 2;
      this.stateCache = null;
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this.time = 0;
    this.pending = 0;
    this.beCount = 2;
    this.converged = true;
    this.error = undefined;
    this.singular = false;
    this.v.fill(0);
    this.hOld = 0;
    for (const d of this.devs) {
      try {
        d.ext = {};
        d.reset();
      } catch {
        /* ignore */
      }
    }
    this.stateCache = null;
  }

  getState(): CircuitState {
    if (this.stateCache) return this.stateCache;
    const nodeVoltages: Record<string, number> = {};
    const ids = this.netlist.netIds;
    for (let i = 0; i < ids.length; i++) nodeVoltages[ids[i]] = i === 0 ? 0 : this.v[i] ?? 0;
    const components: Record<string, CircuitComponentState> = {};
    for (const d of this.devs) {
      try {
        components[d.comp.id] = d.state(this);
      } catch {
        components[d.comp.id] = { current: 0, voltage: 0, power: 0 };
      }
    }
    const state: CircuitState = {
      time: this.time,
      nodeVoltages,
      pinNets: this.netlist.pinNets,
      components,
      converged: this.converged && !this.buildError,
    };
    const err = this.buildError ?? this.error;
    if (err) state.error = err;
    this.stateCache = state;
    return state;
  }

  /** Diagnostics: matrix size and device count. */
  get stats(): { nodes: number; variables: number; devices: number; nonlinear: boolean } {
    return { nodes: this.nNodes, variables: this.nVars, devices: this.devs.length, nonlinear: this.nonlinear };
  }
}
