/**
 * Optibench Workstation — optics ↔ circuit co-simulation bridge.
 *
 * Each tick:
 *   1. the circuit simulator advances by dt;
 *   2. `emitter` / `actuator` links are mapped into an OpticsDrive:
 *        emitter : sourceScale[opticsId] = circuit state.opticalPower / optical source props.power
 *        actuator: propOverrides[opticsId][targetProp] = gain · quantity + offset. The quantity is
 *                  chosen by link.source ('current' A | 'voltage' V | 'angle' = state.angleDeg in
 *                  degrees | 'speed' = state.speed rad/s | 'brightness' 0..1); without it: current for
 *                  opto.coil / inductors / relay coils, the angle for a servo / motor driving
 *                  'rotation', otherwise the voltage. Defaults: targetProp 'bField', gain 1, offset 0.
 *                  The special targetProp 'rotation' turns the optical component itself: its
 *                  rotation in DEGREES = gain · quantity + offset, applied to a COPY of the scene
 *                  (the document is never mutated; see CoSimTick.scene / rotations);
 *   3. the optics scene is re-traced only when needed (scene changed, a drive value moved by more
 *      than `driveTolerance` relative, a linked rotation moved by more than `rotationTolerance`
 *      degrees, a time-dependent optical component changed state, or `opticsInterval` ms elapsed
 *      with any drive change);
 *   4. `detector` links feed detector powers back: circuit.setExternal(circuitId, 'opticalPower', W)
 *      (effective from the next circuit step).
 *
 * TIME-DEPENDENT OPTICS (pulsed / modulated lasers, chopper wheels): every trace gets
 * drive.time = simulated time; the engine evaluates modulated lasers and choppers at that instant
 * (pulsed lasers are traced with their average power). The bridge uses two optional helpers
 *     sourceTemporalEnvelope(component, t)     — power of a source at time t relative to its average
 *     componentTimeTransmission(component, t)  — transmission (0..1) of a component at time t
 * (duck-typed on the injected engine object, or passed as CoSimOptions.temporal; without them the
 * optics are simply traced as before):
 *   - each tick it samples them and re-traces when a value moved by more than `driveTolerance`
 *     (a chopper opening / closing, a modulated laser moving along its envelope);
 *   - PULSED lasers (props.mode === 'pulsed'): the engine's trace carries the average power, so the
 *     bridge multiplies sourceScale by the pulse train averaged over the tick — exactly the energy
 *     of the pulses that fell into (t − dt, t] divided by dt. Slow pulse trains therefore flash the
 *     detectors tick by tick; trains much faster than the tick (> 8 pulses per tick) stay at their
 *     average power instead of aliasing.
 *
 * Engines are injected (no import of the optics implementation), so this module is pure glue.
 * Documents without links work too (pure optics: traced once; pure circuit: never traced).
 */
import type {
  CircuitEngineAPI, CircuitSimulator, CircuitState, ObwDocument, OpticalComponent, OpticsDrive, OpticsEngineAPI, OpticsScene,
  OptoLink, ParamValue, TraceResult,
} from './types';

/** Optional time-domain helpers an optics engine may expose (detected at run time). */
export interface TemporalOpticsAPI {
  sourceTemporalEnvelope?: (component: OpticalComponent, time: number) => number;
  componentTimeTransmission?: (component: OpticalComponent, time: number) => number;
}

export interface CoSimOptions {
  /** Max ms between optics re-traces while the drive keeps changing by less than the tolerance. Default 100. */
  opticsInterval?: number;
  /** Relative drive change that forces an immediate re-trace. Default 0.005 (0.5 %). */
  driveTolerance?: number;
  /** Minimum ms between two traces (throttle for expensive scenes). Default 0. */
  minTraceInterval?: number;
  /** Change (degrees) of a link-driven component rotation that forces a re-trace. Default 0.05. */
  rotationTolerance?: number;
  /** Time-domain helpers of the optics engine, when they are not methods of the engine object itself. */
  temporal?: TemporalOpticsAPI;
  /** Clock used for the intervals (ms). Default Date.now. */
  now?: () => number;
}

export interface CoSimTick {
  circuit: CircuitState;
  /** The NEW trace when optics were re-traced during this tick, otherwise null (see `lastTrace`). */
  trace: TraceResult | null;
  drive: OpticsDrive;
  /**
   * The optics scene as currently driven: the document scene, with link-driven rotations applied
   * to copies of the affected components (identical to the document scene when there are none).
   * Draw the optics view from this while simulating.
   */
  scene: OpticsScene;
  /** Link-driven rotations in DEGREES by optical component id (empty when there are none). */
  rotations: Record<string, number>;
}

const ANGLE_TYPES = new Set(['misc.servo', 'misc.motor']);
const DEG = Math.PI / 180;

const CURRENT_DRIVEN = new Set(['opto.coil', 'passive.inductor', 'switch.relay']);

function emptyState(): CircuitState {
  return { time: 0, nodeVoltages: {}, pinNets: {}, components: {}, converged: true };
}

export class CoSimulator {
  opticsInterval: number;
  driveTolerance: number;
  minTraceInterval: number;
  rotationTolerance: number;

  private doc!: ObwDocument;
  private sim: CircuitSimulator | null = null;
  private opticsScene!: OpticsScene;
  private links: OptoLink[] = [];
  private circuitTypes = new Map<string, string>();
  private sourcePower = new Map<string, number>();
  private sceneDirty = true;
  private tracedDrive: OpticsDrive | null = null;
  private lastTraceAt = -Infinity;
  private _lastTrace: TraceResult | null = null;
  private _lastDrive: OpticsDrive = {};
  private _error: string | undefined;
  private now: () => number;
  /** Scene copy with link-driven rotations (rebuilt only when a rotation changes). */
  private drivenScene: OpticsScene | null = null;
  private drivenRot: Record<string, number> = {};
  private tracedRot: Record<string, number> = {};
  /** Components with a time-dependent source envelope / transmission, and their values at the last trace. */
  private temporal: { c: OpticalComponent; fn: (c: OpticalComponent, t: number) => number }[] = [];
  private tracedTemporal: number[] = [];
  /** Pulsed sources: sourceScale is multiplied by their tick-averaged pulse train. */
  private pulsed: { c: OpticalComponent; fn: (c: OpticalComponent, t: number) => number }[] = [];
  private temporalApi: TemporalOpticsAPI;
  private simTime = 0;
  private lastDt = 0;

  constructor(doc: ObwDocument, private optics: OpticsEngineAPI, private circuit: CircuitEngineAPI, opts: CoSimOptions = {}) {
    this.opticsInterval = opts.opticsInterval ?? 100;
    this.driveTolerance = opts.driveTolerance ?? 0.005;
    this.minTraceInterval = opts.minTraceInterval ?? 0;
    this.rotationTolerance = opts.rotationTolerance ?? 0.05;
    const eng = optics as OpticsEngineAPI & TemporalOpticsAPI;
    this.temporalApi = {
      sourceTemporalEnvelope: opts.temporal?.sourceTemporalEnvelope ?? (typeof eng.sourceTemporalEnvelope === 'function' ? eng.sourceTemporalEnvelope.bind(eng) : undefined),
      componentTimeTransmission: opts.temporal?.componentTimeTransmission ?? (typeof eng.componentTimeTransmission === 'function' ? eng.componentTimeTransmission.bind(eng) : undefined),
    };
    this.now = opts.now ?? (() => Date.now());
    this.rebuild(doc);
  }

  /** Most recent optics trace (null before the first trace / for pure-circuit documents). */
  get lastTrace(): TraceResult | null {
    return this._lastTrace;
  }
  get lastDrive(): OpticsDrive {
    return this._lastDrive;
  }
  /** Last bridge-level error (engine exceptions are caught and reported here). */
  get error(): string | undefined {
    return this._error;
  }
  get simulator(): CircuitSimulator | null {
    return this.sim;
  }

  /** Rebuild everything from a document (topology change, load, new links). Simulation time restarts. */
  rebuild(doc: ObwDocument): void {
    this.doc = doc;
    this.links = Array.isArray(doc.links) ? doc.links.filter((l) => l && l.circuitId && l.opticsId) : [];
    this.circuitTypes.clear();
    for (const c of doc.circuit?.components ?? []) this.circuitTypes.set(c.id, c.type);
    this._error = undefined;
    try {
      this.sim = doc.circuit ? this.circuit.createSimulator(doc.circuit) : null;
    } catch (e) {
      this.sim = null;
      this._error = `Circuit: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.simTime = 0;
    this.setOpticsScene(doc.optics);
    this._lastTrace = null;
    this.tracedDrive = null;
    this.tracedRot = {};
  }

  /** The optics scene as currently driven (see CoSimTick.scene). */
  get scene(): OpticsScene {
    return this.drivenScene ?? this.opticsScene;
  }
  /** Simulated time (s) of the last tick. */
  get time(): number {
    return this.simTime;
  }

  /** Replace the optics scene (component moved / edited). Circuit state is kept; optics re-trace on the next tick. */
  setOpticsScene(scene: OpticsScene): void {
    this.opticsScene = scene;
    this.sourcePower.clear();
    for (const c of scene?.components ?? []) {
      const p = c.props?.power;
      if (typeof p === 'number' && Number.isFinite(p)) this.sourcePower.set(c.id, p);
    }
    this.sceneDirty = true;
    this.drivenScene = null;
    this.drivenRot = {};
    // time-dependent components: keep those whose helper answers with a number
    this.temporal = [];
    this.pulsed = [];
    for (const c of scene?.components ?? []) {
      const isSource = String(c.type).startsWith('source.');
      const fn = isSource ? this.temporalApi.sourceTemporalEnvelope : this.temporalApi.componentTimeTransmission;
      if (typeof fn !== 'function') continue;
      try {
        if (typeof fn(c, 0) !== 'number') continue;
      } catch {
        continue; // not a time-dependent component
      }
      if (isSource && c.props?.mode === 'pulsed') this.pulsed.push({ c, fn });
      else this.temporal.push({ c, fn });
    }
    this.tracedTemporal = [];
  }

  /**
   * Pulse train of a pulsed source averaged over the tick (t − dt, t], relative to its average power.
   * Short pulses: (number of pulses in the tick) / (repRate · dt); pulses longer than a quarter tick:
   * mean of the sampled envelope; more than 8 pulses per tick: 1 (the average).
   */
  private pulseFactor(e: { c: OpticalComponent; fn: (c: OpticalComponent, t: number) => number }, t: number, dt: number): number {
    if (!(dt > 0)) return 1;
    const f = Number(e.c.props?.repRate);
    const width = Number(e.c.props?.pulseWidth);
    if (!(f > 0)) return 1;
    if (f * dt > 8) return 1;
    if (!(width >= dt / 4)) {
      const n = Math.floor(f * t + 0.5) - Math.floor(f * (t - dt) + 0.5); // pulses are centred on k / repRate
      return n / (f * dt);
    }
    let sum = 0;
    const N = 8;
    for (let i = 0; i < N; i++) {
      let v = 1;
      try {
        v = e.fn(e.c, t - dt + ((i + 0.5) * dt) / N);
      } catch {
        v = 1;
      }
      sum += typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 1;
    }
    return sum / N;
  }

  private sampleTemporal(t: number): number[] {
    const out: number[] = [];
    for (const e of this.temporal) {
      let v = 1;
      try {
        v = e.fn(e.c, t);
      } catch {
        v = 1;
      }
      out.push(typeof v === 'number' && Number.isFinite(v) ? v : 1);
    }
    return out;
  }

  /** Scene with the link-driven rotations applied to component copies (cached while they do not change). */
  private applyRotations(rot: Record<string, number>): OpticsScene {
    const ids = Object.keys(rot);
    if (ids.length === 0) {
      this.drivenScene = null;
      this.drivenRot = {};
      return this.opticsScene;
    }
    const prev = this.drivenRot;
    if (this.drivenScene && ids.length === Object.keys(prev).length && ids.every((id) => prev[id] === rot[id])) return this.drivenScene;
    this.drivenRot = { ...rot };
    this.drivenScene = {
      ...this.opticsScene,
      components: this.opticsScene.components.map((c) => (rot[c.id] !== undefined ? { ...c, rotation: rot[c.id] * DEG } : c)),
    };
    return this.drivenScene;
  }

  interact(componentId: string, action: 'toggle' | 'press' | 'release' | { set: number }): void {
    this.sim?.interact(componentId, action);
  }

  /** Tweak circuit component props while running (no rebuild). */
  updateCircuitProps(componentId: string, props: Record<string, ParamValue>): void {
    this.sim?.updateProps(componentId, props);
  }

  reset(): void {
    this.sim?.reset();
    this.tracedDrive = null;
    this._lastTrace = null;
    this.sceneDirty = true;
    this.lastTraceAt = -Infinity;
    this.simTime = 0;
  }

  tick(dt: number): CoSimTick {
    let circuit: CircuitState;
    try {
      circuit = this.sim ? this.sim.step(dt) : emptyState();
    } catch (e) {
      circuit = { ...emptyState(), converged: false, error: `Circuit: ${e instanceof Error ? e.message : String(e)}` };
    }

    // simulated time: the circuit clock when there is a circuit, otherwise the sum of the ticks
    if (this.sim && Number.isFinite(circuit.time)) this.simTime = circuit.time;
    else if (Number.isFinite(dt) && dt > 0) this.simTime += dt;

    this.lastDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

    const rotations: Record<string, number> = {};
    const drive = this.computeDrive(circuit, rotations);
    drive.time = this.simTime;
    for (const e of this.pulsed) {
      const k = this.pulseFactor(e, this.simTime, this.lastDt);
      if (k === 1 && drive.sourceScale?.[e.c.id] === undefined) continue;
      const ss = (drive.sourceScale ??= {});
      ss[e.c.id] = (ss[e.c.id] ?? 1) * k;
    }
    this._lastDrive = drive;

    let trace: TraceResult | null = null;
    const hasOptics = (this.opticsScene?.components?.length ?? 0) > 0;
    if (hasOptics) {
      const t = this.now();
      const since = t - this.lastTraceAt;
      const temporal = this.temporal.length ? this.sampleTemporal(this.simTime) : [];
      let need = this.sceneDirty || this._lastTrace === null;
      if (!need && since >= this.minTraceInterval) {
        const change = driveChange(this.tracedDrive ?? {}, drive);
        need = change > this.driveTolerance || (change > 0 && since >= this.opticsInterval);
        if (!need) {
          const ids = Object.keys(rotations);
          need = ids.length !== Object.keys(this.tracedRot).length ||
            ids.some((id) => !(Math.abs(rotations[id] - this.tracedRot[id]) <= this.rotationTolerance));
        }
        for (let i = 0; !need && i < temporal.length; i++) {
          need = !(Math.abs(temporal[i] - (this.tracedTemporal[i] ?? NaN)) <= this.driveTolerance);
        }
      }
      if (need) {
        // the driven geometry (what is traced and what the UI draws) only moves together with a trace
        const scene = this.applyRotations(rotations);
        this.tracedRot = { ...rotations };
        this.tracedTemporal = temporal;
        try {
          trace = this.optics.trace(scene, drive);
          this._lastTrace = trace;
          this.tracedDrive = cloneDrive(drive);
          this.sceneDirty = false;
          this.lastTraceAt = t;
          if (this._error?.startsWith('Optics')) this._error = undefined;
        } catch (e) {
          this._error = `Optics: ${e instanceof Error ? e.message : String(e)}`;
          this.sceneDirty = false; // do not retry every tick until something changes
          this.tracedDrive = cloneDrive(drive);
          this.lastTraceAt = t;
        }
      }
    }

    if (trace && this.sim) this.feedDetectors(trace);
    return { circuit, trace, drive, scene: this.scene, rotations: { ...this.tracedRot } };
  }

  // ---------------------------------------------------------------------------------------
  /** Circuit quantity an actuator link reads. */
  private quantity(l: OptoLink, st: CircuitState['components'][string] | undefined): number {
    if (!st) return 0;
    const type = this.circuitTypes.get(l.circuitId) ?? '';
    const src = l.source ?? (CURRENT_DRIVEN.has(type) ? 'current' : l.targetProp === 'rotation' && ANGLE_TYPES.has(type) ? 'angle' : 'voltage');
    const raw = src === 'current' ? st.current : src === 'angle' ? st.angleDeg : src === 'speed' ? st.speed : src === 'brightness' ? st.brightness : st.voltage;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }

  private computeDrive(circuit: CircuitState, rotations: Record<string, number>): OpticsDrive {
    const drive: OpticsDrive = {};
    for (const l of this.links) {
      const st = circuit.components[l.circuitId];
      if (l.kind === 'emitter') {
        const p = st && typeof st.opticalPower === 'number' && Number.isFinite(st.opticalPower) ? Math.max(0, st.opticalPower) : 0;
        const nominal = this.sourcePower.get(l.opticsId);
        const scale = p / (nominal !== undefined && nominal > 0 ? nominal : 1e-3);
        const ss = (drive.sourceScale ??= {});
        ss[l.opticsId] = (ss[l.opticsId] ?? 0) + scale;
      } else if (l.kind === 'actuator') {
        const value = (l.gain ?? 1) * this.quantity(l, st) + (l.offset ?? 0);
        if (l.targetProp === 'rotation') {
          rotations[l.opticsId] = value; // degrees; applied to a scene copy, not sent as a prop override
          continue;
        }
        const po = (drive.propOverrides ??= {});
        const target = (po[l.opticsId] ??= {});
        target[l.targetProp || 'bField'] = value;
      }
    }
    return drive;
  }

  private feedDetectors(trace: TraceResult): void {
    const sums = new Map<string, number>();
    for (const l of this.links) {
      if (l.kind !== 'detector') continue;
      const p = trace.detectors?.[l.opticsId]?.power;
      sums.set(l.circuitId, (sums.get(l.circuitId) ?? 0) + (typeof p === 'number' && Number.isFinite(p) ? Math.max(0, p) : 0));
    }
    for (const [id, p] of sums) {
      try {
        this.sim!.setExternal(id, 'opticalPower', p);
      } catch {
        /* ignore */
      }
    }
  }
}

// -------------------------------------------------------------------------------------------

function cloneDrive(d: OpticsDrive): OpticsDrive {
  const out: OpticsDrive = {};
  if (d.time !== undefined) out.time = d.time;
  if (d.sourceScale) out.sourceScale = { ...d.sourceScale };
  if (d.propOverrides) {
    out.propOverrides = {};
    for (const k of Object.keys(d.propOverrides)) out.propOverrides[k] = { ...d.propOverrides[k] };
  }
  return out;
}

/** Relative difference; values that are both below `floor` in magnitude count as equal (noise). */
function rel(a: number, b: number, floor = 1e-9): number {
  if (a === b) return 0;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m < floor ? 0 : Math.abs(a - b) / m;
}

/** Largest relative difference between two drives (missing sourceScale = 1, missing override = 0; a structural change counts as 1; `time` is ignored). */
export function driveChange(a: OpticsDrive, b: OpticsDrive): number {
  let max = 0;
  const sa = a.sourceScale ?? {}, sb = b.sourceScale ?? {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    max = Math.max(max, rel(sa[k] ?? 1, sb[k] ?? 1));
  }
  const pa = a.propOverrides ?? {}, pb = b.propOverrides ?? {};
  for (const id of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    const oa = pa[id], ob = pb[id];
    if (!oa || !ob) {
      max = 1;
      continue;
    }
    for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
      if (!(k in oa) || !(k in ob)) max = 1;
      else max = Math.max(max, rel(oa[k], ob[k]));
    }
  }
  return max;
}
