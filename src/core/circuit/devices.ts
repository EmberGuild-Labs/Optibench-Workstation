/**
 * Device models for the MNA transient simulator.
 *
 * Every device stamps a (linearised) companion model into the MNA system each Newton iteration
 * (`stamp`), updates its dynamic/discrete state once per accepted time step (`accept`) and
 * reports a UI state object (`state`).
 *
 * MNA variable numbering: 0 = ground, 1..N = nodes, N+1.. = branch currents.
 */
import type { CircuitComponent, CircuitComponentDef, CircuitComponentState, ParamValue } from '../types';
import { LED_COLORS, defaultProps } from './registry';

export const VT = 0.025852; // thermal voltage kT/q at 300 K
const TWO_PI = Math.PI * 2;

/** What devices see of the simulator. */
export interface MNA {
  /** Current Newton iterate / accepted solution, indexed by variable (v[0] = 0). */
  v: Float64Array;
  /** Step size of the step being solved (s). */
  h: number;
  /** Integration coefficient 1/(θ·h): θ = 1 for backward-Euler steps, ≈ 0.5 for (damped) trapezoidal. */
  ah: number;
  /** History weight (1−θ)/θ of the previous derivative term (0 for backward Euler). */
  hist: number;
  /** Time at the END of the step being solved (s). */
  time: number;
  gmin: number;
  /** Set by devices when junction-voltage limiting was applied (forces another iteration). */
  limited: boolean;
  /** Conductance G between variables a and b. */
  g(a: number, b: number, G: number): void;
  /** Constant current I flowing from a to b THROUGH the device. */
  cur(a: number, b: number, I: number): void;
  add(r: number, c: number, val: number): void;
  rhs(r: number, val: number): void;
  /** Report a discontinuity (switching event): the next steps use backward Euler. */
  event(): void;
}

export type InteractAction = 'toggle' | 'press' | 'release' | { set: number };

// ---------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------

export function fmtSI(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  const a = Math.abs(value);
  if (a < 1e-13) return `0.00 ${unit}`;
  const prefixes: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  let scale = 1e-12;
  let pre = 'p';
  for (const [s, p] of prefixes) {
    if (a >= s * 0.9995) {
      scale = s;
      pre = p;
      break;
    }
  }
  const x = value / scale;
  const ax = Math.abs(x);
  const digits = ax >= 99.95 ? 0 : ax >= 9.995 ? 1 : 2;
  return `${x.toFixed(digits)} ${pre}${unit}`;
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------------------------
// base class
// ---------------------------------------------------------------------------------------------

export abstract class Device {
  /** MNA variable per pin (definition order). */
  n: number[] = [];
  /** True for pins whose net has no other pin attached. */
  dangling: boolean[] = [];
  /** First branch-current variable (when nBr > 0). */
  br = 0;
  nBr = 0;
  nonlinear = false;
  /**
   * Piecewise-linear device (set together with `nonlinear`): it is exactly linear while its discrete
   * operating mode holds, so Newton convergence does not need its variables to settle — only its mode
   * to agree with the solution (`consistent`).
   */
  pwl = false;
  p: Record<string, ParamValue>;
  ext: Record<string, number> = {};

  constructor(public comp: CircuitComponent, public def: CircuitComponentDef | undefined) {
    this.p = { ...(def ? defaultProps(def) : {}), ...(comp.props ?? {}) };
  }

  num(k: string, fallback = 0): number {
    const v = this.p[k];
    const x = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
    return Number.isFinite(x) ? x : fallback;
  }
  bool(k: string): boolean {
    const v = this.p[k];
    return v === true || v === 'true' || v === 1;
  }
  str(k: string): string {
    return String(this.p[k] ?? '');
  }

  setProps(props: Record<string, ParamValue>): void {
    Object.assign(this.p, props);
    this.configure();
    this.propsChanged(props);
  }
  /** Derive model parameters from props (called at build and after updateProps). */
  configure(): void {}
  /** Hook for props that carry state (switch position…). */
  propsChanged(_props: Record<string, ParamValue>): void {}
  /** Reset dynamic state to initial conditions. */
  reset(): void {}
  abstract stamp(m: MNA): void;
  accept(_m: MNA): void {}
  /**
   * Event localisation: return 0 when accepting the current solution flips no discrete state,
   * otherwise the estimated fraction (0..1] of the step at which the flip happens (`vPrev` is the
   * solution at the start of the step). The simulator then re-solves the step split at that time.
   */
  eventFraction(_m: MNA, _vPrev: Float64Array): number {
    return 0;
  }
  /**
   * PWL devices: called with a candidate solution in m.v; return false (after switching mode) when the
   * mode the last stamp used does not hold there, which forces another Newton iteration.
   */
  consistent(_m: MNA): boolean {
    return true;
  }
  abstract state(m: MNA): CircuitComponentState;
  /** Returns true when handled. */
  interact(_a: InteractAction): boolean {
    return false;
  }
  setExternal(key: string, value: number): void {
    this.ext[key] = value;
  }
  /** Groups of pin indices that are conductively connected through the device (-1 = ground). */
  groups(): number[][] {
    return [this.n.map((_, i) => i)];
  }
}

export class NullDevice extends Device {
  stamp(): void {}
  state(): CircuitComponentState {
    return { current: 0, voltage: 0, power: 0 };
  }
  groups(): number[][] {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// PN junction with series resistance (solved internally, no extra node)
// ---------------------------------------------------------------------------------------------

export class Junction {
  is = 1e-14;
  nvt = VT;
  rs = 0.01;
  bv = 0;
  ibv = 1e-3;
  nbvt = VT;
  /** junction voltage memory (warm start) */
  vj = 0;
  /** results of the last eval */
  i = 0;
  g = 0;
  private id = 0;
  private gd = 0;
  private cV = NaN;
  private cIph = 0;
  private cGsh = 0;

  set(is: number, n: number, rs: number, bv = 0, ibv = 1e-3): void {
    this.cV = NaN;
    this.is = Math.max(is, 1e-300);
    this.nvt = Math.max(n, 0.05) * VT;
    this.rs = Math.max(rs, 1e-3);
    this.bv = bv > 0 ? bv : 0;
    this.ibv = Math.max(ibv, 1e-9);
  }

  /** Configure so that the terminal voltage is `vf` at current `iref`. */
  setFromVf(vf: number, iref: number, n: number, rs: number): void {
    const nvt = n * VT;
    const r = Math.max(rs, 1e-3);
    const vj = Math.max(vf - iref * r, 0.2);
    this.set(iref / Math.expm1(Math.min(vj / nvt, 600)), n, r);
  }

  private diode(v: number): void {
    const nvt = this.nvt;
    let a = v / nvt;
    let id: number;
    let gd: number;
    if (a > 300) {
      const e = Math.exp(300);
      id = this.is * (e * (1 + a - 300) - 1);
      gd = (this.is * e) / nvt;
    } else {
      const e = Math.exp(a);
      id = this.is * (e - 1);
      gd = (this.is * e) / nvt;
    }
    if (this.bv > 0) {
      a = -(v + this.bv) / this.nbvt;
      if (a > -40) {
        let e: number;
        let de: number;
        if (a > 200) {
          const e0 = Math.exp(200);
          e = e0 * (1 + a - 200);
          de = e0;
        } else {
          e = Math.exp(a);
          de = e;
        }
        id -= this.ibv * e;
        gd += (this.ibv * de) / this.nbvt;
      }
    }
    this.id = id + 1e-12 * v;
    this.gd = gd + 1e-12;
  }

  /**
   * Evaluate terminal current i(V) and conductance g = di/dV for terminal voltage V (anode−cathode).
   * Optional photocurrent `iph` (flows cathode→anode inside) and shunt conductance `gsh` sit in
   * parallel with the junction, behind the series resistance.
   */
  eval(V: number, iph = 0, gsh = 0): void {
    // unchanged operating point (steady state): reuse the previous result
    if (Math.abs(V - this.cV) < 1e-13 && iph === this.cIph && gsh === this.cGsh) return;
    this.cV = V;
    this.cIph = iph;
    this.cGsh = gsh;
    const rs = this.rs;
    const grs = 1 / rs;
    let lo = Math.min(V, 0) - 1e-9;
    let hi = Math.max(V, 0) + iph * rs + 1e-9;
    let vj = this.vj;
    if (!(vj > lo && vj < hi)) vj = 0.5 * (lo + hi);
    let dxold = hi - lo;
    let dx = dxold;
    this.diode(vj);
    let F = this.id + gsh * vj - iph - (V - vj) * grs;
    let dF = this.gd + gsh + grs;
    for (let it = 0; it < 200; it++) {
      if (F > 0) hi = vj;
      else lo = vj;
      let vn: number;
      if (!Number.isFinite(F) || ((vj - hi) * dF - F) * ((vj - lo) * dF - F) > 0 || Math.abs(2 * F) > Math.abs(dxold * dF)) {
        dxold = dx;
        dx = 0.5 * (hi - lo);
        vn = lo + dx;
      } else {
        dxold = dx;
        dx = F / dF;
        vn = vj - dx;
      }
      const moved = Math.abs(vn - vj);
      vj = vn;
      this.diode(vj);
      F = this.id + gsh * vj - iph - (V - vj) * grs;
      dF = this.gd + gsh + grs;
      if (moved < 1e-11) break;
    }
    this.vj = vj;
    const gj = this.gd + gsh;
    this.i = this.id + gsh * vj - iph;
    this.g = gj / (1 + gj * rs);
  }

  /** Last linearisation point (for turn-off limiting). */
  private v0 = 0;
  private i0 = 0;
  private g0 = 0;

  /** Stamp between anode a and cathode k given the iterate voltages. */
  stamp(m: MNA, a: number, k: number, iph = 0, gsh = 0): void {
    let V = m.v[a] - m.v[k];
    // Turn-off limiting: when the circuit asks for a much lower (but still forward) current, plain
    // Newton only walks down the exponential by ~n·Vt per iteration. Jump instead to the voltage
    // at which the junction carries the current predicted by the previous linearisation.
    if (gsh === 0 && V < this.v0 - 0.5 * this.nvt) {
      const id = this.i0 + this.g0 * (V - this.v0) + iph; // junction current asked for
      if (id > 0 && this.i0 + iph > id) {
        const vEq = this.nvt * Math.log1p(id / this.is) + (id - iph) * this.rs;
        if (vEq < V) {
          V = vEq;
          m.limited = true;
        }
      }
    }
    this.eval(V, iph, gsh);
    this.v0 = V;
    this.i0 = this.i;
    this.g0 = this.g;
    m.g(a, k, this.g);
    m.cur(a, k, this.i - this.g * V);
  }
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number, m: MNA): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else {
      vnew = vt * Math.log(vnew / vt);
    }
    m.limited = true;
  }
  return vnew;
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

/** Voltage source with series resistance, one branch current. Pins: [+ , -]. */
abstract class VSource extends Device {
  nBr = 1;
  rs = 0;
  abstract emf(m: MNA): number;
  stamp(m: MNA): void {
    const p = this.n[0], q = this.n[1], b = this.br;
    m.add(p, b, 1);
    m.add(q, b, -1);
    m.add(b, p, 1);
    m.add(b, q, -1);
    m.add(b, b, -this.rs);
    m.rhs(b, this.emf(m));
  }
  /** Delivered current (out of the + pin). */
  delivered(m: MNA): number {
    return -m.v[this.br];
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = this.delivered(m);
    return { voltage: v, current: i, power: v * i };
  }
}

export class Battery extends VSource {
  soc = 1;
  qCap = 1;
  nominal = 9;
  configure(): void {
    this.nominal = this.num('voltage', 9);
    this.rs = Math.max(this.num('internalResistance', 0.5), 1e-4);
    this.qCap = Math.max(this.num('capacity', 500), 1e-9) * 3.6; // mAh -> C
  }
  reset(): void {
    this.soc = clamp(this.num('initialCharge', 100) / 100, 0, 1);
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('initialCharge' in props) this.reset();
  }
  emf(): number {
    const s = this.soc;
    return this.nominal * (0.88 + 0.12 * s) * (1 - Math.exp(-s / 0.03));
  }
  accept(m: MNA): void {
    this.soc = clamp(this.soc - (this.delivered(m) * m.h) / this.qCap, 0, 1);
  }
  state(m: MNA): CircuitComponentState {
    const s = super.state(m);
    const pct = this.soc * 100;
    return { ...s, charge: this.soc, chargePercent: pct, emf: this.emf(), text: `${pct.toFixed(pct < 10 ? 1 : 0)} %` };
  }
}

export class AcSource extends VSource {
  configure(): void {
    this.rs = Math.max(this.num('seriesResistance', 0), 0);
  }
  emf(m: MNA): number {
    return this.num('offset') + this.num('amplitude', 10) * Math.sin(TWO_PI * this.num('frequency', 50) * m.time + (this.num('phase') * Math.PI) / 180);
  }
  state(m: MNA): CircuitComponentState {
    return { ...super.state(m), frequency: this.num('frequency', 50) };
  }
}

/** Cumulative "high" time (in cycles) of a rectangular wave with the given duty up to phase x (cycles). */
function squareCum(x: number, duty: number): number {
  const fl = Math.floor(x);
  return fl * duty + Math.min(x - fl, duty);
}
/** Average level (0..1) of a rectangular wave over [t-h, t] — anti-aliased edges. */
export function squareAvg(f: number, t: number, h: number, duty: number, phase: number): number {
  const x1 = f * t + phase;
  const span = f * h;
  if (!(span > 1e-12)) return x1 - Math.floor(x1) < duty ? 1 : 0;
  return clamp((squareCum(x1, duty) - squareCum(x1 - span, duty)) / span, 0, 1);
}

export class FunctionGen extends VSource {
  lastLevel = false;
  configure(): void {
    this.rs = Math.max(this.num('outputResistance', 50), 0);
  }
  reset(): void {
    this.lastLevel = false;
  }
  emf(m: MNA): number {
    const f = this.num('frequency', 1000);
    const A = this.num('amplitude', 1);
    const off = this.num('offset');
    const duty = clamp(this.num('duty', 50) / 100, 0.001, 0.999);
    const ph = this.num('phase') / 360;
    const x = f * m.time + ph;
    const fr = x - Math.floor(x);
    switch (this.str('waveform')) {
      case 'square':
        return off + A * (2 * squareAvg(f, m.time, m.h, duty, ph) - 1);
      case 'triangle':
        return off + A * (fr < duty ? -1 + (2 * fr) / duty : 1 - (2 * (fr - duty)) / (1 - duty));
      case 'sawtooth':
        return off + A * (2 * fr - 1);
      default:
        return off + A * Math.sin(TWO_PI * x);
    }
  }
  accept(m: MNA): void {
    const w = this.str('waveform');
    if (w === 'square' || w === 'sawtooth') {
      const x = this.num('frequency', 1000) * m.time + this.num('phase') / 360;
      const fr = x - Math.floor(x);
      const level = w === 'square' ? fr < clamp(this.num('duty', 50) / 100, 0.001, 0.999) : fr < 0.5;
      if (level !== this.lastLevel) {
        this.lastLevel = level;
        m.event();
      }
    }
  }
  state(m: MNA): CircuitComponentState {
    return { ...super.state(m), frequency: this.num('frequency', 1000), waveform: this.str('waveform') };
  }
}

/**
 * Bench supply. One branch current; the regulation mode is a discrete state resolved inside the
 * Newton loop: CV (voltage source behind Rout), CC (current source at the limit) or BLOCK (the
 * supply cannot sink current, so it goes high-impedance when back-driven above its set voltage).
 */
export class Psu extends Device {
  nBr = 1;
  nonlinear = true;
  on = true;
  mode: 'CV' | 'CC' | 'BLOCK' = 'CV';
  private flips = 0;
  private lastTime = -1;
  reset(): void {
    this.on = this.bool('on');
    this.mode = 'CV';
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('on' in props) this.on = this.bool('on');
  }
  interact(a: InteractAction): boolean {
    if (a === 'toggle') this.on = !this.on;
    else if (a === 'press') this.on = true;
    else if (a === 'release') this.on = false;
    else this.on = a.set > 0.5;
    return true;
  }
  stamp(m: MNA): void {
    const p = this.n[0], q = this.n[1], b = this.br;
    m.add(p, b, 1);
    m.add(q, b, -1);
    m.g(p, q, 1e-9);
    if (!this.on) {
      m.add(b, b, 1); // I = 0
      return;
    }
    const vset = Math.max(this.num('voltage', 5), 0);
    const ilim = Math.max(this.num('currentLimit', 1), 1e-6);
    const rs = Math.max(this.num('outputResistance', 0.01), 1e-4);
    if (m.time !== this.lastTime) {
      this.lastTime = m.time;
      this.flips = 0;
    }
    // mode selection from the current iterate (bounded number of flips per step to avoid chatter)
    if (this.flips < 12) {
      const V = m.v[p] - m.v[q];
      const I = -m.v[b]; // delivered
      let next = this.mode;
      if (this.mode === 'CV') {
        if (I > ilim * (1 + 1e-6)) next = 'CC';
        else if (I < -1e-7) next = 'BLOCK';
      } else if (this.mode === 'CC') {
        if (V > vset - ilim * rs + 1e-9) next = 'CV';
      } else if (V < vset - 1e-9) {
        next = 'CV';
      }
      if (next !== this.mode) {
        this.mode = next;
        this.flips++;
        m.limited = true;
      }
    }
    if (this.mode === 'CV') {
      m.add(b, p, 1);
      m.add(b, q, -1);
      m.add(b, b, -rs);
      m.rhs(b, vset);
    } else {
      m.add(b, b, 1);
      m.rhs(b, this.mode === 'CC' ? -ilim : 0);
    }
  }
  state(m: MNA): CircuitComponentState {
    const V = m.v[this.n[0]] - m.v[this.n[1]];
    const I = this.on ? -m.v[this.br] : 0;
    const mode = !this.on ? 'OFF' : this.mode === 'CC' ? 'CC' : 'CV';
    return { voltage: V, current: I, power: V * I, on: this.on, mode, text: this.on ? `${fmtSI(V, 'V')}  ${fmtSI(I, 'A')}  ${mode}` : 'OFF' };
  }
}

export class CurrentSource extends Device {
  stamp(m: MNA): void {
    m.cur(this.n[1], this.n[0], this.num('current', 0.01));
    m.g(this.n[0], this.n[1], 1e-9);
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = this.num('current', 0.01);
    return { voltage: v, current: i, power: v * i };
  }
}

export class Ground extends Device {
  stamp(): void {}
  state(): CircuitComponentState {
    return { voltage: 0, current: 0, power: 0 };
  }
  groups(): number[][] {
    return [[0, -1]];
  }
}

// ---------------------------------------------------------------------------------------------
// Oscillator, 555
// ---------------------------------------------------------------------------------------------

/** Pins: [VCC, GND, OUT]. */
export class Crystal extends Device {
  vhigh = 0;
  lastLevel = false;
  private gndVar(): number {
    return this.bool('ideal') && this.dangling[1] ? 0 : this.n[1];
  }
  reset(): void {
    this.vhigh = this.bool('ideal') ? this.num('amplitude', 5) : 0;
    this.lastLevel = false;
  }
  configure(): void {
    if (this.bool('ideal')) this.vhigh = this.num('amplitude', 5);
  }
  stamp(m: MNA): void {
    const gnd = this.gndVar();
    const out = this.n[2];
    const G = 1 / Math.max(this.num('rout', 50), 1e-2);
    const lvl = squareAvg(this.num('frequency', 1000), m.time, m.h, clamp(this.num('duty', 50) / 100, 0.001, 0.999), 0);
    m.g(out, gnd, G);
    m.cur(gnd, out, G * this.vhigh * lvl);
    if (!this.bool('ideal')) m.g(this.n[0], this.n[1], 1 / 5000);
  }
  accept(m: MNA): void {
    if (!this.bool('ideal')) {
      const vs = m.v[this.n[0]] - m.v[this.n[1]];
      this.vhigh = vs >= 1.5 ? vs : 0;
    }
    const x = this.num('frequency', 1000) * m.time;
    const level = x - Math.floor(x) < clamp(this.num('duty', 50) / 100, 0.001, 0.999);
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const gnd = this.gndVar();
    const v = m.v[this.n[2]] - m.v[gnd];
    const G = 1 / Math.max(this.num('rout', 50), 1e-2);
    const i = G * (this.vhigh * (this.lastLevel ? 1 : 0) - v);
    return { voltage: v, current: i, power: Math.abs(v * i), on: this.lastLevel && this.vhigh > 0, frequency: this.num('frequency', 1000), running: this.vhigh > 0 };
  }
  groups(): number[][] {
    if (this.bool('ideal')) return [[2, this.dangling[1] ? -1 : 1]];
    return [[0, 1, 2]];
  }
}

/** Pins: [GND, TRIG, OUT, RESET, CTRL, THR, DIS, VCC]. */
export class Timer555 extends Device {
  q = false;
  reset(): void {
    this.q = false;
  }
  private next(m: MNA): boolean {
    const v = m.v, n = this.n;
    const g = v[n[0]];
    const vcc = v[n[7]] - g;
    if (vcc < 1.5) return false;
    const ctrl = v[n[4]] - g;
    let q = this.q;
    if (v[n[5]] - g > ctrl) q = false;
    if (v[n[1]] - g < 0.5 * ctrl) q = true;
    if (!this.dangling[3] && v[n[3]] - g < 0.7) q = false;
    return q;
  }
  stamp(m: MNA): void {
    const n = this.n;
    const [GND, , OUT, , CTRL, , DIS, VCC] = n;
    const cmos = this.str('variant') === 'cmos';
    const rdiv = cmos ? 100e3 : 5e3;
    m.g(VCC, CTRL, 1 / rdiv);
    m.g(CTRL, GND, 1 / (2 * rdiv));
    m.g(VCC, GND, cmos ? 1e-5 : 1 / 3000);
    const G = 1 / Math.max(this.num('rout', 10), 0.1);
    if (this.q) {
      m.g(VCC, OUT, G);
      if (!cmos) m.cur(VCC, OUT, -1.4 * G);
    } else {
      m.g(OUT, GND, G);
      m.g(DIS, GND, 1 / Math.max(this.num('rdis', 10), 0.1));
    }
  }
  eventFraction(m: MNA, vp: Float64Array): number {
    if (this.next(m) === this.q) return 0;
    const v = m.v, n = this.n;
    // margin > 0 means "comparator has fired"; interpolate its zero crossing linearly
    let g0: number, g1: number;
    if (this.q) {
      g0 = vp[n[5]] - vp[n[4]];
      g1 = v[n[5]] - v[n[4]];
    } else {
      g0 = 0.5 * (vp[n[4]] - vp[n[0]]) - (vp[n[1]] - vp[n[0]]);
      g1 = 0.5 * (v[n[4]] - v[n[0]]) - (v[n[1]] - v[n[0]]);
    }
    if (!(g0 < 0 && g1 > 0)) return 1;
    return clamp(-g0 / (g1 - g0), 1e-3, 1);
  }
  accept(m: MNA): void {
    const q = this.next(m);
    if (q !== this.q) {
      this.q = q;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v, n = this.n;
    const vout = v[n[2]] - v[n[0]];
    const vcc = v[n[7]] - v[n[0]];
    const cmos = this.str('variant') === 'cmos';
    const G = 1 / Math.max(this.num('rout', 10), 0.1);
    const iout = this.q ? G * (vcc - vout - (cmos ? 0 : 1.4)) : -G * vout;
    const iq = vcc * ((cmos ? 1e-5 : 1 / 3000) + 1 / (cmos ? 300e3 : 15e3));
    return { voltage: vout, current: iout, power: Math.abs(vcc * iq) + Math.abs(iout) * (this.q ? Math.abs(vcc - vout) : Math.abs(vout)), on: this.q, discharging: !this.q, supply: vcc };
  }
  groups(): number[][] {
    return [[0, 2, 4, 6, 7]];
  }
}

// ---------------------------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------------------------

export class Resistor extends Device {
  G = 1e-3;
  configure(): void {
    this.G = 1 / Math.max(this.num('resistance', 1000), 1e-6);
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.G);
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v * this.G;
    const p = v * i;
    return { voltage: v, current: i, power: p, overheating: p > this.num('powerRating', 0.25) };
  }
}

/** Pins: [A, B, W]. */
export class Potentiometer extends Device {
  pos = 0.5;
  reset(): void {
    this.pos = clamp(this.num('position', 0.5), 0, 1);
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('position' in props) this.pos = clamp(this.num('position', 0.5), 0, 1);
  }
  interact(a: InteractAction): boolean {
    if (typeof a === 'object') {
      this.pos = clamp(a.set, 0, 1);
      return true;
    }
    return false;
  }
  private split(): [number, number] {
    const R = Math.max(this.num('resistance', 10000), 1e-3);
    const f = this.str('taper') === 'log' ? (Math.pow(10, 2 * this.pos) - 1) / 99 : this.pos;
    const rw = Math.max(R * 1e-4, 1e-3); // wiper/end resistance
    return [R * f + rw, R * (1 - f) + rw];
  }
  stamp(m: MNA): void {
    const [r1, r2] = this.split();
    m.g(this.n[0], this.n[2], 1 / r1);
    m.g(this.n[2], this.n[1], 1 / r2);
  }
  state(m: MNA): CircuitComponentState {
    const [r1, r2] = this.split();
    const va = m.v[this.n[0]], vb = m.v[this.n[1]], vw = m.v[this.n[2]];
    const i1 = (va - vw) / r1, i2 = (vw - vb) / r2;
    return { voltage: va - vb, current: i1, power: (va - vw) * i1 + (vw - vb) * i2, position: this.pos, wiperVoltage: vw, wiperCurrent: i2 - i1 };
  }
}

export class Capacitor extends Device {
  C = 1e-6;
  esr = 0;
  vc = 0;
  ic = 0;
  configure(): void {
    this.C = Math.max(this.num('capacitance', 1e-6), 1e-15);
    this.esr = Math.max(this.num('esr', 0), 0);
  }
  reset(): void {
    this.vc = this.num('initialVoltage', 0);
    this.ic = 0;
  }
  /** Norton companion (terminal conductance, equivalent current) including ESR. */
  private coef(m: MNA): [number, number] {
    const geq = this.C * m.ah;
    const ieq = -geq * this.vc - m.hist * this.ic;
    const d = 1 + geq * this.esr;
    return [geq / d, ieq / d];
  }
  stamp(m: MNA): void {
    const [G, I] = this.coef(m);
    m.g(this.n[0], this.n[1], G);
    m.cur(this.n[0], this.n[1], I);
  }
  accept(m: MNA): void {
    const [G, I] = this.coef(m);
    const V = m.v[this.n[0]] - m.v[this.n[1]];
    const i = G * V + I;
    this.vc = V - i * this.esr;
    this.ic = i;
  }
  state(m: MNA): CircuitComponentState {
    const V = m.v[this.n[0]] - m.v[this.n[1]];
    const pol = this.bool('polarized');
    const vmax = this.num('maxVoltage', 50);
    return {
      voltage: V, current: this.ic, power: this.ic * this.ic * this.esr,
      charge: this.C * this.vc, energy: 0.5 * this.C * this.vc * this.vc,
      reverseBiased: pol && this.vc < -1, overVoltage: Math.abs(this.vc) > vmax,
    };
  }
}

export class Inductor extends Device {
  nBr = 1;
  L = 1e-3;
  R = 0;
  il = 0;
  vl = 0;
  configure(): void {
    this.L = Math.max(this.num('inductance', 1e-3), 1e-12);
    this.R = Math.max(this.num('dcr', 0), 0);
  }
  reset(): void {
    this.il = 0;
    this.vl = 0;
  }
  stamp(m: MNA): void {
    const a = this.n[0], b = this.n[1], br = this.br;
    const k = this.L * m.ah;
    m.add(a, br, 1);
    m.add(b, br, -1);
    m.add(br, a, 1);
    m.add(br, b, -1);
    m.add(br, br, -(this.R + k));
    m.rhs(br, -k * this.il - m.hist * this.vl);
  }
  accept(m: MNA): void {
    const i = m.v[this.br];
    this.vl = m.v[this.n[0]] - m.v[this.n[1]] - this.R * i;
    this.il = i;
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = m.v[this.br];
    return { voltage: v, current: i, power: i * i * this.R, energy: 0.5 * this.L * i * i };
  }
}

export class Coil extends Inductor {
  configure(): void {
    this.L = Math.max(this.num('inductance', 0.01), 1e-12);
    this.R = Math.max(this.num('resistance', 8), 0);
  }
  state(m: MNA): CircuitComponentState {
    const s = super.state(m);
    const i = s.current as number;
    const b = (4e-7 * Math.PI * Math.max(this.num('mur', 1), 1) * this.num('turns', 500) * i) / Math.max(this.num('length', 0.05), 1e-4);
    return { ...s, bField: b, text: fmtSI(b, 'T') };
  }
}

/** Pins: [P1, P2, S1, S2]; two branch currents. */
export class Transformer extends Device {
  nBr = 2;
  L1 = 1;
  L2 = 0.01;
  M = 0.099;
  r1 = 1;
  r2 = 0.1;
  i1 = 0;
  i2 = 0;
  v1 = 0;
  v2 = 0;
  configure(): void {
    const ratio = Math.max(this.num('ratio', 10), 1e-4);
    this.L1 = Math.max(this.num('lp', 1), 1e-12);
    this.L2 = this.L1 / (ratio * ratio);
    this.M = clamp(this.num('k', 0.99), 0, 0.99999) * Math.sqrt(this.L1 * this.L2);
    this.r1 = Math.max(this.num('rp', 1), 0);
    this.r2 = Math.max(this.num('rs', 0.1), 0);
  }
  reset(): void {
    this.i1 = this.i2 = this.v1 = this.v2 = 0;
  }
  stamp(m: MNA): void {
    const [p1, p2, s1, s2] = this.n;
    const b1 = this.br, b2 = this.br + 1;
    const a = m.ah;
    m.add(p1, b1, 1);
    m.add(p2, b1, -1);
    m.add(s1, b2, 1);
    m.add(s2, b2, -1);
    m.add(b1, p1, 1);
    m.add(b1, p2, -1);
    m.add(b1, b1, -(this.r1 + a * this.L1));
    m.add(b1, b2, -a * this.M);
    m.rhs(b1, -a * (this.L1 * this.i1 + this.M * this.i2) - m.hist * this.v1);
    m.add(b2, s1, 1);
    m.add(b2, s2, -1);
    m.add(b2, b2, -(this.r2 + a * this.L2));
    m.add(b2, b1, -a * this.M);
    m.rhs(b2, -a * (this.M * this.i1 + this.L2 * this.i2) - m.hist * this.v2);
  }
  accept(m: MNA): void {
    const [p1, p2, s1, s2] = this.n;
    this.i1 = m.v[this.br];
    this.i2 = m.v[this.br + 1];
    this.v1 = m.v[p1] - m.v[p2] - this.r1 * this.i1;
    this.v2 = m.v[s1] - m.v[s2] - this.r2 * this.i2;
  }
  state(m: MNA): CircuitComponentState {
    const [p1, p2, s1, s2] = this.n;
    const i1 = m.v[this.br], i2 = m.v[this.br + 1];
    return {
      voltage: m.v[p1] - m.v[p2], current: i1, power: i1 * i1 * this.r1 + i2 * i2 * this.r2,
      secondaryVoltage: m.v[s1] - m.v[s2], secondaryCurrent: -i2,
    };
  }
  groups(): number[][] {
    return [[0, 1], [2, 3]];
  }
}

// ---------------------------------------------------------------------------------------------
// Diodes
// ---------------------------------------------------------------------------------------------

/** Generic two-pin junction device. Pins: [A, K]. */
export class Diode extends Device {
  nonlinear = true;
  j = new Junction();
  configure(): void {
    this.j.set(this.num('is', 2.5e-9), this.num('n', 1.75), this.num('rs', 0.5), this.num('bv', 100), 1e-4);
  }
  reset(): void {
    this.j.vj = 0;
  }
  protected iph(): number {
    return 0;
  }
  protected gsh(): number {
    return 0;
  }
  stamp(m: MNA): void {
    this.j.stamp(m, this.n[0], this.n[1], this.iph(), this.gsh());
  }
  protected vi(m: MNA): [number, number] {
    const V = m.v[this.n[0]] - m.v[this.n[1]];
    this.j.eval(V, this.iph(), this.gsh());
    return [V, this.j.i];
  }
  state(m: MNA): CircuitComponentState {
    const [V, I] = this.vi(m);
    return { voltage: V, current: I, power: V * I, on: I > 1e-4 };
  }
}

export class Zener extends Diode {
  configure(): void {
    this.j.set(this.num('is', 1e-14), this.num('n', 1), this.num('rs', 1), this.num('vz', 5.1), this.num('izt', 0.005));
  }
  state(m: MNA): CircuitComponentState {
    const s = super.state(m);
    return { ...s, on: Math.abs(s.current as number) > 1e-4, regulating: (s.current as number) < -1e-4 };
  }
}

export function ledEfficiency(color: string, override: number): number {
  return override > 0 ? override : (LED_COLORS[color] ?? LED_COLORS.red).efficiency;
}

export class Led extends Diode {
  configure(): void {
    const c = LED_COLORS[this.str('color')] ?? LED_COLORS.red;
    this.j.setFromVf(c.vf, 0.02, 2, this.num('rs', 3));
  }
  state(m: MNA): CircuitComponentState {
    const [V, I] = this.vi(m);
    const color = this.str('color');
    const c = LED_COLORS[color] ?? LED_COLORS.red;
    const rated = Math.max(this.num('ratedCurrent', 0.02), 1e-6);
    const fwd = Math.max(I, 0);
    return {
      voltage: V, current: I, power: V * I,
      brightness: clamp(fwd / rated, 0, 1),
      opticalPower: ledEfficiency(color, this.num('efficiency', 0)) * Math.max(V, 0) * fwd,
      wavelength: c.wavelength, color, on: fwd > rated * 0.02, overdriven: fwd > 2 * rated,
    };
  }
}

export class LaserDiode extends Diode {
  configure(): void {
    const ith = Math.max(this.num('threshold', 0.02), 1e-6);
    this.j.setFromVf(this.num('vf', 2.2), 2 * ith, 2, this.num('rs', 4));
  }
  state(m: MNA): CircuitComponentState {
    const [V, I] = this.vi(m);
    const ith = Math.max(this.num('threshold', 0.02), 1e-6);
    const imax = Math.max(this.num('maxCurrent', 0.08), ith * 1.01);
    const slope = this.num('slope', 0.8);
    const pOpt = slope * Math.max(0, I - ith);
    return {
      voltage: V, current: I, power: V * I, opticalPower: pOpt,
      brightness: clamp(pOpt / (slope * (imax - ith)), 0, 1),
      wavelength: this.num('wavelength', 650), lasing: I > ith, on: I > ith, overdriven: I > imax,
    };
  }
}

/** Incident optical power: external (linked detector) overrides the manual prop. */
function incident(d: Device): number {
  const e = d.ext.opticalPower;
  return Math.max(0, e !== undefined && Number.isFinite(e) ? e : d.num('illumination', 0));
}

export class Photodiode extends Diode {
  configure(): void {
    this.j.set(this.num('is', 1e-10), this.num('n', 1.3), this.num('rs', 5), 0);
  }
  protected iph(): number {
    return this.num('responsivity', 0.5) * incident(this) + Math.max(this.num('darkCurrent', 2e-9), 0);
  }
  state(m: MNA): CircuitComponentState {
    const [V, I] = this.vi(m);
    return { voltage: V, current: I, power: V * I, photocurrent: this.iph(), opticalPower: incident(this), on: incident(this) > 0 };
  }
}

/** Pins: [+, -]. */
export class SolarCell extends Diode {
  configure(): void {
    const cells = Math.max(Math.round(this.num('cells', 4)), 1);
    const n = 1.3 * cells;
    const voc = Math.max(this.num('voc', 2.4), 0.05);
    const isc = Math.max(this.num('isc', 0.05), 1e-9);
    this.j.set(isc / Math.expm1(Math.min(voc / (n * VT), 600)), n, this.num('rs', 0.5), 0);
  }
  protected iph(): number {
    return (Math.max(this.num('isc', 0.05), 0) * incident(this)) / Math.max(this.num('pRef', 0.1), 1e-12);
  }
  protected gsh(): number {
    return 1 / Math.max(this.num('rsh', 5000), 1e-3);
  }
  state(m: MNA): CircuitComponentState {
    const [V, I] = this.vi(m);
    return { voltage: V, current: -I, power: -V * I, photocurrent: this.iph(), opticalPower: incident(this), on: incident(this) > 0 };
  }
}

// ---------------------------------------------------------------------------------------------
// Transistors
// ---------------------------------------------------------------------------------------------

/** Pins: [B, C, E]. */
export class Bjt extends Device {
  nonlinear = true;
  pol = 1;
  is = 1e-14;
  bf = 200;
  brv = 4;
  vaf = 100;
  vcrit = 0.7;
  vbeOld = 0;
  vbcOld = 0;
  // last evaluation
  ic = 0;
  ib = 0;
  jcbe = 0;
  jcbc = 0;
  jbbe = 0;
  jbbc = 0;
  constructor(comp: CircuitComponent, def: CircuitComponentDef | undefined, pol: number) {
    super(comp, def);
    this.pol = pol;
  }
  configure(): void {
    this.is = Math.max(this.num('is', 1e-14), 1e-30);
    this.bf = Math.max(this.num('beta', 200), 0.1);
    this.brv = Math.max(this.num('betaR', 4), 0.01);
    this.vaf = Math.max(this.num('vaf', 100), 0);
    this.vcrit = VT * Math.log(VT / (Math.SQRT2 * this.is));
  }
  reset(): void {
    this.vbeOld = this.vbcOld = 0;
  }
  private calc(vbe: number, vbc: number): void {
    const is = this.is;
    const ef = Math.exp(Math.min(vbe / VT, 200));
    const er = Math.exp(Math.min(vbc / VT, 200));
    const q = this.vaf > 0 ? Math.max(1 - vbc / this.vaf, 0.05) : 1;
    const dq = this.vaf > 0 && q > 0.05 ? -1 / this.vaf : 0;
    const icc = is * (ef - er) * q;
    const dccBe = ((is * ef) / VT) * q;
    const dccBc = ((-is * er) / VT) * q + is * (ef - er) * dq;
    const gmin = 1e-12;
    const ibe = (is / this.bf) * (ef - 1) + gmin * vbe;
    const gbe = ((is / this.bf) * ef) / VT + gmin;
    const ibc = (is / this.brv) * (er - 1) + gmin * vbc;
    const gbc = ((is / this.brv) * er) / VT + gmin;
    this.ic = icc - ibc;
    this.ib = ibe + ibc;
    this.jcbe = dccBe;
    this.jcbc = dccBc - gbc;
    this.jbbe = gbe;
    this.jbbc = gbc;
  }
  stamp(m: MNA): void {
    const [B, C, E] = this.n;
    const pol = this.pol;
    let vbe = pol * (m.v[B] - m.v[E]);
    let vbc = pol * (m.v[B] - m.v[C]);
    vbe = pnjlim(vbe, this.vbeOld, VT, this.vcrit, m);
    vbc = pnjlim(vbc, this.vbcOld, VT, this.vcrit, m);
    vbe = this.offlim(vbe, this.vbeOld, this.is / this.bf, m);
    vbc = this.offlim(vbc, this.vbcOld, this.is / this.brv, m);
    this.vbeOld = vbe;
    this.vbcOld = vbc;
    this.calc(vbe, vbc);
    // collector row: current pol*Ic flows INTO the device at C
    const icEq = pol * (this.ic - this.jcbe * vbe - this.jcbc * vbc);
    const ibEq = pol * (this.ib - this.jbbe * vbe - this.jbbc * vbc);
    this.row(m, C, B, C, E, this.jcbe, this.jcbc, icEq, 1);
    this.row(m, B, B, C, E, this.jbbe, this.jbbc, ibEq, 1);
    this.row(m, E, B, C, E, this.jcbe + this.jbbe, this.jcbc + this.jbbc, icEq + ibEq, -1);
  }
  /**
   * Turn-off limiting for a current-driven junction: when the junction voltage must fall while a
   * (smaller) forward current keeps flowing, jump to the voltage that carries the current predicted
   * by the previous linearisation instead of creeping down the exponential by ~Vt per iteration.
   */
  private offlim(vnew: number, vold: number, isj: number, m: MNA): number {
    if (vnew < vold - 0.5 * VT && vold > 0.3) {
      const e = Math.exp(Math.min(vold / VT, 200));
      const i0 = isj * (e - 1);
      const iLin = i0 + ((isj * e) / VT) * (vnew - vold);
      if (iLin > 0) {
        const vEq = VT * Math.log1p(iLin / isj);
        if (vEq < vnew) {
          m.limited = true;
          return vEq;
        }
      }
    }
    return vnew;
  }
  private row(m: MNA, r: number, B: number, C: number, E: number, jbe: number, jbc: number, ieq: number, s: number): void {
    m.add(r, B, s * (jbe + jbc));
    m.add(r, E, -s * jbe);
    m.add(r, C, -s * jbc);
    m.rhs(r, -s * ieq);
  }
  state(m: MNA): CircuitComponentState {
    const [B, C, E] = this.n;
    const pol = this.pol;
    const vbe = pol * (m.v[B] - m.v[E]);
    const vbc = pol * (m.v[B] - m.v[C]);
    this.calc(Math.min(vbe, 1.2), Math.min(vbc, 1.2));
    const vce = vbe - vbc;
    const ic = this.ic, ib = this.ib;
    const region = ib < 1e-9 && Math.abs(ic) < 1e-7 ? 'cutoff' : vbc > 0.3 && vbe > 0.3 ? 'saturation' : vbe > vbc ? 'active' : 'reverse';
    return {
      voltage: pol * vce, current: ic, power: Math.abs(vce * ic) + Math.abs(vbe * ib),
      ic, ib, ie: ic + ib, vbe, vce, region, on: ic > 1e-5,
    };
  }
}

/** Pins: [G, D, S]. */
export class Mosfet extends Device {
  nonlinear = true;
  pol = 1;
  body = new Junction();
  id = 0;
  gm = 0;
  gds = 0;
  constructor(comp: CircuitComponent, def: CircuitComponentDef | undefined, pol: number) {
    super(comp, def);
    this.pol = pol;
  }
  configure(): void {
    this.body.set(1e-12, 1.1, 0.02, 0);
  }
  reset(): void {
    this.body.vj = 0;
  }
  private sat(vgs: number, vds: number): void {
    // normal mode (vds >= 0); sets id, gm, gds
    const vth = Math.abs(this.num('vth', 2));
    const K = Math.max(this.num('k', 0.5), 1e-12);
    const lam = Math.max(this.num('lambda', 0), 0);
    const vov = vgs - vth;
    if (vov <= 0) {
      this.id = 0;
      this.gm = 0;
      this.gds = 0;
    } else if (vds < vov) {
      const cl = 1 + lam * vds;
      const core = vov * vds - 0.5 * vds * vds;
      this.id = K * core * cl;
      this.gm = K * vds * cl;
      this.gds = K * (vov - vds) * cl + K * core * lam;
    } else {
      const cl = 1 + lam * vds;
      this.id = 0.5 * K * vov * vov * cl;
      this.gm = K * vov * cl;
      this.gds = 0.5 * K * vov * vov * lam;
    }
  }
  /** Channel current (D→S, polarity-normalised) and partials wrt vgs, vds. */
  private calc(vgs: number, vds: number): void {
    if (vds >= 0) {
      this.sat(vgs, vds);
    } else {
      this.sat(vgs - vds, -vds);
      const gm = this.gm, gds = this.gds;
      this.id = -this.id;
      this.gm = -gm;
      this.gds = gm + gds;
    }
    this.gds += 1e-9;
    this.id += 1e-9 * vds;
  }
  stamp(m: MNA): void {
    const [G, D, S] = this.n;
    const pol = this.pol;
    const vgs = pol * (m.v[G] - m.v[S]);
    const vds = pol * (m.v[D] - m.v[S]);
    this.calc(vgs, vds);
    const { gm, gds } = this;
    const ieq = pol * (this.id - gm * vgs - gds * vds);
    m.add(D, G, gm);
    m.add(D, D, gds);
    m.add(D, S, -(gm + gds));
    m.rhs(D, -ieq);
    m.add(S, G, -gm);
    m.add(S, D, -gds);
    m.add(S, S, gm + gds);
    m.rhs(S, ieq);
    if (this.bool('bodyDiode')) {
      if (pol > 0) this.body.stamp(m, S, D);
      else this.body.stamp(m, D, S);
    }
  }
  state(m: MNA): CircuitComponentState {
    const [G, D, S] = this.n;
    const pol = this.pol;
    const vgs = pol * (m.v[G] - m.v[S]);
    const vds = pol * (m.v[D] - m.v[S]);
    this.calc(vgs, vds);
    let id = this.id;
    if (this.bool('bodyDiode')) {
      this.body.eval(-vds);
      id -= this.body.i;
    }
    const vov = vgs - Math.abs(this.num('vth', 2));
    const region = vov <= 0 ? 'cutoff' : Math.abs(vds) < vov ? 'triode' : 'saturation';
    return { voltage: pol * vds, current: id, power: Math.abs(vds * id), id, vgs, vds, region, on: vov > 0 };
  }
  groups(): number[][] {
    return [[1, 2]];
  }
}

// ---------------------------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------------------------

abstract class SwitchBase extends Device {
  protected gOn(): number {
    return 1 / Math.max(this.num('ron', 0.01), 1e-6);
  }
  protected gOff(): number {
    return 1 / Math.max(this.num('roff', 1e9), 1);
  }
}

export class SwitchSpst extends SwitchBase {
  on = false;
  reset(): void {
    this.on = this.bool('closed');
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('closed' in props) this.on = this.bool('closed');
  }
  interact(a: InteractAction): boolean {
    if (a === 'toggle') this.on = !this.on;
    else if (a === 'press') this.on = true;
    else if (a === 'release') this.on = false;
    else this.on = a.set > 0.5;
    return true;
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.on ? this.gOn() : this.gOff());
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v * (this.on ? this.gOn() : this.gOff());
    return { voltage: v, current: i, power: v * i, on: this.on };
  }
}

export class SwitchPush extends SwitchBase {
  pressed = false;
  reset(): void {
    this.pressed = false;
  }
  interact(a: InteractAction): boolean {
    if (a === 'toggle') this.pressed = !this.pressed;
    else if (a === 'press') this.pressed = true;
    else if (a === 'release') this.pressed = false;
    else this.pressed = a.set > 0.5;
    return true;
  }
  private closed(): boolean {
    return this.pressed !== this.bool('normallyClosed');
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.closed() ? this.gOn() : this.gOff());
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v * (this.closed() ? this.gOn() : this.gOff());
    return { voltage: v, current: i, power: v * i, on: this.closed(), pressed: this.pressed };
  }
}

/** Pins: [COM, A, B]. state.on = true when COM–A is closed. */
export class SwitchSpdt extends SwitchBase {
  toA = true;
  reset(): void {
    this.toA = this.str('position') !== 'B';
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('position' in props) this.toA = this.str('position') !== 'B';
  }
  interact(a: InteractAction): boolean {
    if (a === 'toggle') this.toA = !this.toA;
    else if (a === 'press') this.toA = false;
    else if (a === 'release') this.toA = true;
    else this.toA = a.set < 0.5;
    return true;
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.toA ? this.gOn() : this.gOff());
    m.g(this.n[0], this.n[2], this.toA ? this.gOff() : this.gOn());
  }
  state(m: MNA): CircuitComponentState {
    const vc = m.v[this.n[0]];
    const tgt = this.toA ? this.n[1] : this.n[2];
    const v = vc - m.v[tgt];
    const i = v * this.gOn();
    return { voltage: v, current: i, power: v * i, on: this.toA, position: this.toA ? 'A' : 'B' };
  }
}

/** Pins: [C1, C2, NO, COM, NC]; one branch (coil current). */
export class Relay extends SwitchBase {
  nBr = 1;
  on = false;
  il = 0;
  vl = 0;
  reset(): void {
    this.on = false;
    this.il = this.vl = 0;
  }
  stamp(m: MNA): void {
    const [c1, c2, no, com, nc] = this.n;
    const br = this.br;
    const L = Math.max(this.num('coilInductance', 0.05), 1e-9);
    const R = Math.max(this.num('coilResistance', 70), 1e-3);
    const k = L * m.ah;
    m.add(c1, br, 1);
    m.add(c2, br, -1);
    m.add(br, c1, 1);
    m.add(br, c2, -1);
    m.add(br, br, -(R + k));
    m.rhs(br, -k * this.il - m.hist * this.vl);
    m.g(com, no, this.on ? this.gOn() : this.gOff());
    m.g(com, nc, this.on ? this.gOff() : this.gOn());
  }
  accept(m: MNA): void {
    const i = m.v[this.br];
    const R = Math.max(this.num('coilResistance', 70), 1e-3);
    this.vl = m.v[this.n[0]] - m.v[this.n[1]] - R * i;
    this.il = i;
    const a = Math.abs(i);
    const pull = this.num('pullIn', 0.045);
    const drop = Math.min(this.num('dropOut', 0.012), pull);
    if (!this.on && a >= pull) {
      this.on = true;
      m.event();
    } else if (this.on && a <= drop) {
      this.on = false;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const [c1, c2, no, com, nc] = this.n;
    const i = m.v[this.br];
    const v = m.v[c1] - m.v[c2];
    const vcont = m.v[com] - m.v[this.on ? no : nc];
    return { voltage: v, current: i, power: i * i * Math.max(this.num('coilResistance', 70), 1e-3), on: this.on, contactCurrent: vcont * this.gOn() };
  }
  groups(): number[][] {
    return [[0, 1], [2, 3, 4]];
  }
}

// ---------------------------------------------------------------------------------------------
// Displays
// ---------------------------------------------------------------------------------------------

/** Pins: [a,b,c,d,e,f,g,dp, COM]. */
export class SevenSeg extends Device {
  nonlinear = true;
  js: Junction[] = Array.from({ length: 8 }, () => new Junction());
  configure(): void {
    const c = LED_COLORS[this.str('color')] ?? LED_COLORS.red;
    for (const j of this.js) j.setFromVf(c.vf, 0.02, 2, 3);
  }
  reset(): void {
    for (const j of this.js) j.vj = 0;
  }
  stamp(m: MNA): void {
    const com = this.n[8];
    const ca = this.str('common') === 'anode';
    for (let i = 0; i < 8; i++) {
      if (ca) this.js[i].stamp(m, com, this.n[i]);
      else this.js[i].stamp(m, this.n[i], com);
    }
  }
  state(m: MNA): CircuitComponentState {
    const com = this.n[8];
    const ca = this.str('common') === 'anode';
    const rated = Math.max(this.num('ratedCurrent', 0.01), 1e-6);
    const segments: number[] = [];
    let itot = 0, p = 0;
    for (let i = 0; i < 8; i++) {
      const V = ca ? m.v[com] - m.v[this.n[i]] : m.v[this.n[i]] - m.v[com];
      this.js[i].eval(V);
      const I = this.js[i].i;
      segments.push(clamp(I / rated, 0, 1));
      itot += Math.max(I, 0);
      p += V * I;
    }
    const color = this.str('color');
    return { voltage: m.v[com], current: itot, power: p, segments, color, wavelength: (LED_COLORS[color] ?? LED_COLORS.red).wavelength, on: itot > rated * 0.05 };
  }
}

/** Pins: [R1..R8, C1..C8]. segments row-major (row r, column c -> r*8+c). */
export class LedMatrix extends Device {
  nonlinear = true;
  js: Junction[] = Array.from({ length: 64 }, () => new Junction());
  configure(): void {
    const c = LED_COLORS[this.str('color')] ?? LED_COLORS.red;
    for (const j of this.js) j.setFromVf(c.vf, 0.02, 2, 3);
  }
  reset(): void {
    for (const j of this.js) j.vj = 0;
  }
  stamp(m: MNA): void {
    const rowAnode = this.str('polarity') !== 'col-anode';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const rn = this.n[r], cn = this.n[8 + c];
        if (rowAnode) this.js[r * 8 + c].stamp(m, rn, cn);
        else this.js[r * 8 + c].stamp(m, cn, rn);
      }
    }
  }
  state(m: MNA): CircuitComponentState {
    const rowAnode = this.str('polarity') !== 'col-anode';
    const rated = Math.max(this.num('ratedCurrent', 0.01), 1e-6);
    const segments = new Array<number>(64);
    let itot = 0, p = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const V = rowAnode ? m.v[this.n[r]] - m.v[this.n[8 + c]] : m.v[this.n[8 + c]] - m.v[this.n[r]];
        const j = this.js[r * 8 + c];
        j.eval(V);
        segments[r * 8 + c] = clamp(j.i / rated, 0, 1);
        itot += Math.max(j.i, 0);
        p += V * j.i;
      }
    }
    const color = this.str('color');
    return { voltage: 0, current: itot, power: p, segments, color, wavelength: (LED_COLORS[color] ?? LED_COLORS.red).wavelength, on: itot > rated * 0.05 };
  }
}

// ---------------------------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------------------------

export class Voltmeter extends Device {
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], 1 / Math.max(this.num('resistance', 1e7), 1));
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v / Math.max(this.num('resistance', 1e7), 1);
    return { voltage: v, current: i, power: v * i, value: v, text: fmtSI(v, 'V') };
  }
}

export class Ammeter extends Device {
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], 1 / Math.max(this.num('resistance', 0.001), 1e-6));
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v / Math.max(this.num('resistance', 0.001), 1e-6);
    return { voltage: v, current: i, power: v * i, value: i, text: fmtSI(i, 'A') };
  }
}

export const PROBE_SAMPLES = 2000;

/** Pins: [IN]. Keeps a rolling (t, v) history for the oscilloscope panel. */
export class Probe extends Device {
  t = new Float64Array(PROBE_SAMPLES);
  y = new Float64Array(PROBE_SAMPLES);
  head = 0;
  count = 0;
  lastT = -Infinity;
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.lastT = -Infinity;
  }
  stamp(): void {}
  accept(m: MNA): void {
    const interval = Math.max(this.num('window', 0.05), 1e-9) / PROBE_SAMPLES;
    if (m.time - this.lastT < interval * (1 - 1e-6)) return;
    this.lastT = m.time;
    this.t[this.head] = m.time;
    this.y[this.head] = m.v[this.n[0]];
    this.head = (this.head + 1) % PROBE_SAMPLES;
    if (this.count < PROBE_SAMPLES) this.count++;
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]];
    const n = this.count;
    const t = new Array<number>(n);
    const y = new Array<number>(n);
    let min = Infinity, max = -Infinity;
    const start = (this.head - n + PROBE_SAMPLES) % PROBE_SAMPLES;
    for (let i = 0; i < n; i++) {
      const k = (start + i) % PROBE_SAMPLES;
      t[i] = this.t[k];
      const val = this.y[k];
      y[i] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    if (n === 0) min = max = v;
    return { voltage: v, current: 0, power: 0, value: v, text: fmtSI(v, 'V'), history: { t, v: y }, min, max };
  }
  groups(): number[][] {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Digital (implied supply `vdd`, referenced to ground variable 0)
// ---------------------------------------------------------------------------------------------

export abstract class Digital extends Device {
  abstract inputs: number[]; // pin indices
  abstract outputs: number[]; // pin indices
  out: boolean[] = [];
  inState: boolean[] = [];
  private pending: boolean[] | null = null;
  private pendingT = 0;
  protected first = true;

  reset(): void {
    this.out = this.outputs.map(() => false);
    this.inState = this.inputs.map(() => false);
    this.pending = null;
    this.first = true;
    this.resetLogic();
    this.out = this.evaluate();
  }
  protected resetLogic(): void {}
  /** Compute outputs from this.inState (already sampled). May update sequential state. */
  protected abstract evaluate(): boolean[];

  protected sample(m: MNA): void {
    const vdd = Math.max(this.num('vdd', 5), 0.1);
    for (let k = 0; k < this.inputs.length; k++) {
      const v = m.v[this.n[this.inputs[k]]];
      if (v > 0.6 * vdd) this.inState[k] = true;
      else if (v < 0.4 * vdd) this.inState[k] = false;
    }
  }
  stamp(m: MNA): void {
    const G = 1 / Math.max(this.num('rout', 40), 0.1);
    const vdd = this.num('vdd', 5);
    for (let k = 0; k < this.outputs.length; k++) {
      const node = this.n[this.outputs[k]];
      m.g(node, 0, G);
      if (this.out[k]) m.cur(0, node, G * vdd);
    }
  }
  accept(m: MNA): void {
    this.sample(m);
    const next = this.evaluate();
    this.first = false;
    const delay = Math.max(this.num('delay', 0), 0);
    const differs = (a: boolean[], b: boolean[]): boolean => a.some((x, i) => x !== b[i]);
    if (delay <= 0) {
      if (differs(next, this.out)) {
        this.out = next;
        m.event();
      }
      return;
    }
    if (this.pending && m.time >= this.pendingT - 1e-15) {
      this.out = this.pending;
      this.pending = null;
      m.event();
    }
    if (differs(next, this.pending ?? this.out)) {
      this.pending = next;
      this.pendingT = m.time + delay;
    }
  }
  state(m: MNA): CircuitComponentState {
    const G = 1 / Math.max(this.num('rout', 40), 0.1);
    const vdd = this.num('vdd', 5);
    let itot = 0, p = 0;
    for (let k = 0; k < this.outputs.length; k++) {
      const v = m.v[this.n[this.outputs[k]]];
      const i = G * ((this.out[k] ? vdd : 0) - v);
      itot += i;
      p += i * i / G;
    }
    return { voltage: m.v[this.n[this.outputs[0]]], current: itot, power: p, on: this.out[0], outputs: this.out.slice(), inputs: this.inState.slice() };
  }
  groups(): number[][] {
    return [[...this.outputs, -1]];
  }
}

export class Gate extends Digital {
  inputs: number[];
  outputs: number[];
  constructor(comp: CircuitComponent, def: CircuitComponentDef | undefined, private fn: (a: boolean, b: boolean) => boolean, nIn: number) {
    super(comp, def);
    this.inputs = nIn === 1 ? [0] : [0, 1];
    this.outputs = [nIn];
  }
  protected evaluate(): boolean[] {
    return [this.fn(this.inState[0], this.inState[1] ?? false)];
  }
}

/** Pins: [CLK, RST, Q0..Q3]. */
export class Counter extends Digital {
  inputs = [0, 1];
  outputs = [2, 3, 4, 5];
  count = 0;
  prevClk = false;
  protected resetLogic(): void {
    this.count = 0;
    this.prevClk = false;
  }
  protected evaluate(): boolean[] {
    const clk = this.inState[0];
    if (this.first) {
      this.prevClk = clk;
    } else {
      const mod = clamp(Math.round(this.num('modulus', 16)), 2, 16);
      if (this.inState[1]) this.count = 0;
      else if (clk && !this.prevClk) this.count = (this.count + 1) % mod;
      this.prevClk = clk;
    }
    const c = this.count;
    return [(c & 1) !== 0, (c & 2) !== 0, (c & 4) !== 0, (c & 8) !== 0];
  }
  state(m: MNA): CircuitComponentState {
    return { ...super.state(m), count: this.count, text: String(this.count) };
  }
}

const SEG_TABLE = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** Pins: [A, B, C, D, a..g]. */
export class Bcd7Seg extends Digital {
  inputs = [0, 1, 2, 3];
  outputs = [4, 5, 6, 7, 8, 9, 10];
  value = 0;
  protected evaluate(): boolean[] {
    const s = this.inState;
    const val = (s[0] ? 1 : 0) | (s[1] ? 2 : 0) | (s[2] ? 4 : 0) | (s[3] ? 8 : 0);
    this.value = val;
    const mask = val <= 9 ? SEG_TABLE[val] : 0;
    const inv = this.bool('activeLow');
    return Array.from({ length: 7 }, (_, i) => ((mask >> i) & 1) !== 0 !== inv);
  }
  state(m: MNA): CircuitComponentState {
    return { ...super.state(m), value: this.value, text: this.value <= 9 ? String(this.value) : '' };
  }
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

const LAMP_T0 = 300;
const LAMP_TR = 2700;

export class Lamp extends Device {
  T = LAMP_T0;
  blown = false;
  reset(): void {
    this.T = LAMP_T0;
    this.blown = false;
  }
  private res(): number {
    const vr = Math.max(this.num('ratedVoltage', 6), 1e-3);
    const pr = Math.max(this.num('ratedPower', 0.6), 1e-6);
    return ((vr * vr) / pr) * Math.pow(this.T / LAMP_TR, 1.2);
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.blown ? 1e-9 : 1 / this.res());
  }
  accept(m: MNA): void {
    if (this.blown) {
      this.T += (LAMP_T0 - this.T) * (1 - Math.exp(-m.h / 0.05));
      return;
    }
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const pr = Math.max(this.num('ratedPower', 0.6), 1e-6);
    const tau = Math.max(this.num('tau', 0.04), 1e-4);
    const sub = Math.max(1, Math.ceil((m.h * 8) / tau));
    const hs = m.h / sub;
    const t04 = LAMP_T0 ** 4;
    const span4 = LAMP_TR ** 4 - t04;
    for (let k = 0; k < sub; k++) {
      const p = (v * v) / this.res();
      const prad = (pr * (this.T ** 4 - t04)) / span4;
      this.T = clamp(this.T + ((hs * (LAMP_TR - LAMP_T0)) / tau) * ((p - prad) / pr), LAMP_T0, 6000);
    }
    if (this.T > 3600) {
      this.blown = true;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = this.blown ? 0 : v / this.res();
    const x = clamp((this.T - 900) / (LAMP_TR - 900), 0, 1.5);
    return {
      voltage: v, current: i, power: v * i, brightness: this.blown ? 0 : clamp(x * x * x, 0, 1),
      temperature: this.T, resistance: this.blown ? Infinity : this.res(), blown: this.blown,
      overdriven: this.T > LAMP_TR * 1.1, on: !this.blown && this.T > 1100,
    };
  }
}

export class Buzzer extends Device {
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], Math.max(this.num('ratedCurrent', 0.025), 1e-6) / Math.max(this.num('ratedVoltage', 5), 1e-3));
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const vr = Math.max(this.num('ratedVoltage', 5), 1e-3);
    const i = (v * Math.max(this.num('ratedCurrent', 0.025), 1e-6)) / vr;
    const active = v >= this.num('minVoltage', 1.5);
    return { voltage: v, current: i, power: v * i, active, on: active, frequency: this.num('frequency', 2300), volume: active ? clamp(v / vr, 0, 1) : 0 };
  }
}

export class Ldr extends Device {
  pf = 0;
  reset(): void {
    this.pf = incident(this);
  }
  private res(): number {
    const rDark = Math.max(this.num('rDark', 1e6), 1);
    if (!(this.pf > 0)) return rDark;
    const r = this.num('rRef', 5000) * Math.pow(this.pf / Math.max(this.num('pRef', 1e-4), 1e-15), -this.num('gamma', 0.7));
    return clamp(r, Math.min(Math.max(this.num('rMin', 100), 1e-3), rDark), rDark);
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], 1 / this.res());
  }
  accept(m: MNA): void {
    const tau = Math.max(this.num('tau', 0.03), 1e-6);
    this.pf += (incident(this) - this.pf) * (1 - Math.exp(-m.h / tau));
    if (this.pf < 1e-15) this.pf = 0;
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const r = this.res();
    return { voltage: v, current: v / r, power: (v * v) / r, resistance: r, opticalPower: incident(this), text: fmtSI(r, 'Ω') };
  }
}

// ---------------------------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------------------------

export function createDevice(comp: CircuitComponent, def: CircuitComponentDef | undefined): Device {
  switch (comp.type) {
    case 'source.battery': return new Battery(comp, def);
    case 'source.psu': return new Psu(comp, def);
    case 'source.ac': return new AcSource(comp, def);
    case 'source.function_gen': return new FunctionGen(comp, def);
    case 'source.current': return new CurrentSource(comp, def);
    case 'misc.ground': return new Ground(comp, def);
    case 'osc.crystal': return new Crystal(comp, def);
    case 'ic.555': return new Timer555(comp, def);
    case 'passive.resistor': return new Resistor(comp, def);
    case 'passive.potentiometer': return new Potentiometer(comp, def);
    case 'passive.capacitor': return new Capacitor(comp, def);
    case 'passive.inductor': return new Inductor(comp, def);
    case 'passive.transformer': return new Transformer(comp, def);
    case 'semi.diode': return new Diode(comp, def);
    case 'semi.zener': return new Zener(comp, def);
    case 'semi.led': return new Led(comp, def);
    case 'semi.npn': return new Bjt(comp, def, 1);
    case 'semi.pnp': return new Bjt(comp, def, -1);
    case 'semi.nmos': return new Mosfet(comp, def, 1);
    case 'semi.pmos': return new Mosfet(comp, def, -1);
    case 'switch.spst': return new SwitchSpst(comp, def);
    case 'switch.spdt': return new SwitchSpdt(comp, def);
    case 'switch.push': return new SwitchPush(comp, def);
    case 'switch.relay': return new Relay(comp, def);
    case 'display.7seg': return new SevenSeg(comp, def);
    case 'display.matrix': return new LedMatrix(comp, def);
    case 'meter.voltmeter': return new Voltmeter(comp, def);
    case 'meter.ammeter': return new Ammeter(comp, def);
    case 'meter.probe': return new Probe(comp, def);
    case 'digital.and': return new Gate(comp, def, (a, b) => a && b, 2);
    case 'digital.or': return new Gate(comp, def, (a, b) => a || b, 2);
    case 'digital.not': return new Gate(comp, def, (a) => !a, 1);
    case 'digital.nand': return new Gate(comp, def, (a, b) => !(a && b), 2);
    case 'digital.xor': return new Gate(comp, def, (a, b) => a !== b, 2);
    case 'digital.counter': return new Counter(comp, def);
    case 'digital.bcd7seg': return new Bcd7Seg(comp, def);
    case 'misc.lamp': return new Lamp(comp, def);
    case 'misc.buzzer': return new Buzzer(comp, def);
    case 'opto.photodiode': return new Photodiode(comp, def);
    case 'opto.ldr': return new Ldr(comp, def);
    case 'opto.solar_cell': return new SolarCell(comp, def);
    case 'opto.laser_diode': return new LaserDiode(comp, def);
    case 'opto.coil': return new Coil(comp, def);
    default: return new NullDevice(comp, def);
  }
}
