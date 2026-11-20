/**
 * Device models, part 2: analog / digital ICs, electromechanical parts, thermistor, fuse, clock.
 *
 * Same contract as devices.ts (stamp / accept / state). `createDevice` at the bottom is the factory
 * the simulator uses: it knows the types defined here and falls back to the one in devices.ts.
 *
 * Behavioural ICs are piecewise-linear: the operating region (linear / slewing / clipped / current
 * limited…) is a discrete mode chosen from the Newton iterate; a mode change sets `m.limited` so the
 * iteration continues until the mode and the solution agree.
 */
import type { CircuitComponent, CircuitComponentDef, CircuitComponentState, ParamValue } from '../types';
import { Device, Digital, InteractAction, Junction, MNA, clamp, createDevice as createBaseDevice, fmtSI, squareAvg } from './devices';

const TWO_PI = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------------------------
// Operational amplifier (macro-model)
// ---------------------------------------------------------------------------------------------

export interface OpAmpModel {
  label: string;
  /** Open-loop DC gain (V/V). */
  a0: number;
  /** Gain-bandwidth product (Hz). */
  gbw: number;
  /** Slew rate (V/µs). */
  slew: number;
  /** Open-loop output resistance (Ω). */
  rout: number;
  /** Output swing headroom to the positive / negative rail (V). */
  headHigh: number;
  headLow: number;
  /** Output short-circuit current (A). */
  ilimit: number;
  /** Input offset voltage (V), input bias current (A, into each input), supply current (A). */
  vos: number;
  ibias: number;
  iq: number;
  /** Differential input resistance (Ω). */
  rin: number;
}

/** Typical data-sheet values. `generic` is only the default of the editable parameters. */
export const OPAMP_MODELS: Record<string, OpAmpModel> = {
  generic: { label: 'Generic (use parameters)', a0: 1e5, gbw: 1e6, slew: 1, rout: 50, headHigh: 1, headLow: 1, ilimit: 0.025, vos: 0, ibias: 0, iq: 1e-3, rin: 1e12 },
  lm358: { label: 'LM358 (single supply, bipolar)', a0: 1e5, gbw: 1e6, slew: 0.5, rout: 50, headHigh: 1.5, headLow: 0.02, ilimit: 0.03, vos: 2e-3, ibias: -45e-9, iq: 5e-4, rin: 1e8 },
  tl072: { label: 'TL072 (JFET input, audio)', a0: 2e5, gbw: 3e6, slew: 13, rout: 100, headHigh: 1.5, headLow: 1.5, ilimit: 0.025, vos: 3e-3, ibias: 65e-12, iq: 1.4e-3, rin: 1e12 },
  lm741: { label: 'LM741 (classic bipolar)', a0: 2e5, gbw: 1e6, slew: 0.5, rout: 75, headHigh: 1, headLow: 1, ilimit: 0.025, vos: 1e-3, ibias: 80e-9, iq: 1.7e-3, rin: 2e6 },
  rrio: { label: 'Rail-to-rail CMOS (MCP6002-like)', a0: 3e5, gbw: 1e6, slew: 0.6, rout: 100, headHigh: 0.025, headLow: 0.025, ilimit: 0.023, vos: 1e-3, ibias: 1e-12, iq: 1e-4, rin: 1e13 },
};

const LIN = 0, HI = 1, LO = 2;
/** Supply assumed for a supply pin that is left unconnected (ideal ±15 V rails). */
export const OPAMP_IMPLICIT_SUPPLY = 15;

/**
 * Pins: [IN+, IN-, OUT, V+, V-]. One branch variable J = current delivered by the OUT pin; it is
 * drawn from V+ when sourcing and returned to V- when sinking, so supply currents are real.
 *
 * Internal state x = output of the single-pole gain stage:  dx/dt = ωp·(A0·vd − x), |dx/dt| ≤ SR,
 * x clipped to [V- + headLow, V+ − headHigh]; OUT = x behind Rout, |J| ≤ Ilimit.
 * The pole is integrated implicitly (θ-method), so within a step x = a + k·vd with k ≈ 2π·GBW·θh —
 * a finite "gain per step" that keeps every feedback configuration unconditionally stable.
 */
export class OpAmp extends Device {
  nBr = 1;
  nonlinear = true;
  pwl = true;
  mdl: OpAmpModel = OPAMP_MODELS.generic;
  // dynamic state
  x = 0;
  f = 0;
  xm = LIN;
  /** 0 = voltage output, ±1 = current limit (sourcing / sinking). */
  om = 0;
  sourcing = true;
  private vsup = 2 * OPAMP_IMPLICIT_SUPPLY;
  // per-step coefficients
  private kk = 0;
  private aa = 0;
  private srh = 0;
  private hi = 0;
  private lo = 0;
  private hiK = 0;
  private loK = 0;
  // Newton bookkeeping
  private lastTime = -1;
  private flips = 0;
  private cflips = 0;
  private sflips = 0;
  private prev = -1;
  private impP = false;
  private impN = false;

  configure(): void {
    const id = this.str('model');
    if (id !== 'generic' && OPAMP_MODELS[id]) {
      this.mdl = OPAMP_MODELS[id];
    } else {
      const rr = this.bool('railToRail');
      this.mdl = {
        label: 'generic',
        a0: Math.pow(10, clamp(this.num('gain', 100), 0, 160) / 20),
        gbw: Math.max(this.num('gbw', 1e6), 1),
        slew: Math.max(this.num('slewRate', 1), 1e-6),
        rout: Math.max(this.num('rout', 50), 1e-3),
        headHigh: rr ? 0.01 : Math.max(this.num('headroomHigh', 1), 0),
        headLow: rr ? 0.01 : Math.max(this.num('headroomLow', 1), 0),
        ilimit: Math.max(this.num('currentLimit', 0.025), 1e-6),
        vos: this.num('vos', 0),
        ibias: this.num('ibias', 0),
        iq: Math.max(this.num('iq', 1e-3), 0),
        rin: Math.max(this.num('rin', 1e12), 1),
      };
    }
    this.impP = !!this.dangling[3];
    this.impN = !!this.dangling[4];
  }
  reset(): void {
    this.x = 0;
    this.f = 0;
    this.xm = LIN;
    this.om = 0;
    this.sourcing = true;
    this.vsup = 2 * OPAMP_IMPLICIT_SUPPLY;
    this.lastTime = -1;
  }

  private vPos(m: MNA): number {
    return this.impP ? OPAMP_IMPLICIT_SUPPLY : m.v[this.n[3]];
  }
  private vNeg(m: MNA): number {
    return this.impN ? -OPAMP_IMPLICIT_SUPPLY : m.v[this.n[4]];
  }

  /** Step coefficients and the window [lo, hi] the state may reach in this step (slew + rails). */
  private prep(m: MNA): void {
    const k = this.mdl;
    const wu = TWO_PI * k.gbw;
    const wp = wu / k.a0;
    const den = m.ah + wp;
    this.kk = wu / den;
    this.aa = (m.ah * this.x + m.hist * this.f) / den;
    this.srh = k.slew * 1e6 * m.h;
    const vp = this.vPos(m), vn = this.vNeg(m);
    const up = this.x + this.srh, dn = this.x - this.srh;
    const rh = vp - k.headHigh, rl = vn + k.headLow;
    // limit kinds: 0 = constant (slew), 1 = V+ − headHigh, 2 = V- (dead supply), 3 = V- + headLow
    if (rh < rl) {
      this.hi = this.lo = vn;
      this.hiK = this.loK = 2;
      return;
    }
    if (rh <= up) {
      this.hi = rh;
      this.hiK = 1;
    } else {
      this.hi = up;
      this.hiK = 0;
    }
    if (rl >= dn) {
      this.lo = rl;
      this.loK = 3;
    } else {
      this.lo = dn;
      this.loK = 0;
    }
    if (this.lo > this.hi) {
      // the state sits outside the rails (supply collapsed): snap onto the rail
      if (this.hiK === 1) {
        this.lo = this.hi;
        this.loK = 1;
      } else {
        this.hi = this.lo;
        this.hiK = 3;
      }
    }
  }

  /**
   * Choose the operating modes (gain-stage region, current limit, supply rail in use) for the
   * voltages in m.v. Returns true when a mode changed (or no consistent mode could be found).
   */
  private update(m: MNA): boolean {
    const n = this.n, v = m.v, k = this.mdl;
    const o = n[2], b = this.br;
    let changed = false;
    this.prep(m);
    if (m.time !== this.lastTime) {
      this.lastTime = m.time;
      this.flips = this.cflips = this.sflips = 0;
      this.prev = -1;
    }
    const vd = v[n[0]] - v[n[1]] + k.vos;
    const xt = this.aa + this.kk * vd;
    // --- gain-stage region
    let next = xt > this.hi ? HI : xt < this.lo ? LO : LIN;
    if (next !== this.xm) {
      if (this.flips < 16) {
        // Positive feedback (comparator with hysteresis, oscillators): the linear region is an unstable
        // equilibrium, so limit → linear → same limit means the output really leaves towards the far side.
        if (next !== LIN && this.xm === LIN && this.prev === next) next = next === HI ? LO : HI;
        this.prev = this.xm;
        this.xm = next;
        this.flips++;
        changed = true;
      } else if (m.h > 1e-10) {
        changed = true; // no consistent region at this step size: let the simulator shorten the step
      }
    }
    const xi = this.xm === LIN ? xt : this.xm === HI ? this.hi : this.lo;
    // --- output stage: current limit
    const J = v[b];
    if (this.cflips < 12) {
      let nm = this.om;
      const il = k.ilimit;
      if (nm === 0) {
        if (J > il * (1 + 1e-6)) nm = 1;
        else if (J < -il * (1 + 1e-6)) nm = -1;
      } else if (nm === 1) {
        if (v[o] > xi - k.rout * il + 1e-9) nm = 0;
      } else if (v[o] < xi + k.rout * il - 1e-9) nm = 0;
      if (nm !== this.om) {
        this.om = nm;
        this.cflips++;
        changed = true;
      }
    }
    // --- which rail the output current comes from
    if (this.sflips < 6 && (this.sourcing ? J < -1e-9 : J > 1e-9)) {
      this.sourcing = !this.sourcing;
      this.sflips++;
      changed = true;
    }
    return changed;
  }

  consistent(m: MNA): boolean {
    return !this.update(m);
  }

  stamp(m: MNA): void {
    const n = this.n, k = this.mdl;
    const p = n[0], q = n[1], o = n[2], b = this.br;
    const sp = this.impP ? 0 : n[3], sn = this.impN ? 0 : n[4];
    if (this.update(m)) m.limited = true;
    m.add(o, b, -1);
    m.add(this.sourcing ? sp : sn, b, 1);
    if (this.om !== 0) {
      m.add(b, b, 1);
      m.rhs(b, this.om * k.ilimit);
    } else {
      m.add(b, o, 1);
      m.add(b, b, k.rout);
      if (this.xm === LIN) {
        m.add(b, p, -this.kk);
        m.add(b, q, this.kk);
        m.rhs(b, this.aa + this.kk * k.vos);
      } else {
        const kind = this.xm === HI ? this.hiK : this.loK;
        if (kind === 0) m.rhs(b, this.xm === HI ? this.hi : this.lo);
        else if (kind === 1) {
          if (this.impP) m.rhs(b, OPAMP_IMPLICIT_SUPPLY - k.headHigh);
          else {
            m.add(b, sp, -1);
            m.rhs(b, -k.headHigh);
          }
        } else {
          const c = kind === 3 ? k.headLow : 0;
          if (this.impN) m.rhs(b, -OPAMP_IMPLICIT_SUPPLY + c);
          else {
            m.add(b, sn, -1);
            m.rhs(b, c);
          }
        }
      }
    }
    // --- inputs and supply current
    m.g(p, q, 1 / k.rin);
    if (k.ibias !== 0) {
      m.cur(p, sn, k.ibias);
      m.cur(q, sn, k.ibias);
    }
    if (!this.impP && !this.impN && k.iq > 0) m.g(sp, sn, k.iq / Math.max(this.vsup, 1));
  }

  accept(m: MNA): void {
    const n = this.n, v = m.v, k = this.mdl;
    this.prep(m);
    const vd = v[n[0]] - v[n[1]] + k.vos;
    const xt = this.aa + this.kk * vd;
    let xn = xt;
    let mode = LIN;
    if (xt > this.hi) {
      xn = this.hi;
      mode = HI;
    } else if (xt < this.lo) {
      xn = this.lo;
      mode = LO;
    }
    this.f = mode === LIN ? (TWO_PI * k.gbw / k.a0) * (k.a0 * vd - xn) : (xn - this.x) / m.h;
    this.slewing = mode !== LIN && (mode === HI ? this.hiK : this.loK) === 0;
    this.clip = mode === LIN || this.slewing ? 0 : mode === HI ? 1 : -1;
    this.x = xn;
    this.xm = mode;
    this.vsup = this.vPos(m) - this.vNeg(m);
  }
  private slewing = false;
  private clip = 0;

  state(m: MNA): CircuitComponentState {
    const n = this.n, v = m.v, k = this.mdl;
    const vout = v[n[2]];
    const J = v[this.br];
    const vp = this.vPos(m), vn = this.vNeg(m);
    const drop = J >= 0 ? vp - vout : vout - vn;
    return {
      voltage: vout, current: J, power: Math.abs(J) * Math.max(drop, 0) + (vp - vn) * k.iq,
      vdiff: v[n[0]] - v[n[1]], vplus: v[n[0]], vminus: v[n[1]],
      supply: vp - vn, saturated: this.clip !== 0, clipping: this.clip > 0 ? 'high' : this.clip < 0 ? 'low' : 'none',
      slewing: this.slewing, limiting: this.om !== 0, on: vout > 0.5 * (vp + vn),
    };
  }
  groups(): number[][] {
    const g = [2, this.impP ? -1 : 3, this.impN ? -1 : 4];
    return this.mdl.rin < 1e9 ? [g, [0, 1]] : [g];
  }
}

// ---------------------------------------------------------------------------------------------
// Comparator (LM393: open-collector output)
// ---------------------------------------------------------------------------------------------

/** Pins: [IN+, IN-, OUT, V+, V-]. Output transistor (OUT → V-) conducts when IN+ < IN-. */
export class Comparator extends Device {
  /** Output transistor on (output pulled low). */
  low = false;
  private vsup = 5;
  reset(): void {
    this.low = false;
    this.vsup = 5;
  }
  private vneg(v: Float64Array): number {
    return this.dangling[4] ? 0 : v[this.n[4]];
  }
  private powered(v: Float64Array): boolean {
    return this.dangling[3] || v[this.n[3]] - this.vneg(v) >= 2;
  }
  private margin(v: Float64Array): number {
    return v[this.n[0]] - v[this.n[1]] + this.num('vos', 0);
  }
  private next(m: MNA): boolean {
    if (!this.powered(m.v)) return false;
    const vd = this.margin(m.v);
    const hy = 0.5 * Math.max(this.num('hysteresis', 0), 0);
    if (vd < -hy) return true;
    if (vd > hy) return false;
    return this.low;
  }
  stamp(m: MNA): void {
    const n = this.n;
    const sn = this.dangling[4] ? 0 : n[4];
    m.g(n[2], sn, this.low ? 1 / Math.max(this.num('ron', 50), 0.1) : 1e-9);
    if (!this.dangling[3]) m.g(n[3], sn, Math.max(this.num('iq', 4e-4), 0) / Math.max(this.vsup, 2));
  }
  eventFraction(m: MNA, vp: Float64Array): number {
    if (this.next(m) === this.low) return 0;
    const hy = 0.5 * Math.max(this.num('hysteresis', 0), 0);
    // margin > 0 = "has fired": going low needs vd < −hy, going high vd > +hy
    const s = this.low ? 1 : -1;
    const g0 = s * this.margin(vp) - hy, g1 = s * this.margin(m.v) - hy;
    if (!(g0 < 0 && g1 > 0)) return 1;
    return clamp(-g0 / (g1 - g0), 1e-3, 1);
  }
  accept(m: MNA): void {
    const q = this.next(m);
    if (q !== this.low) {
      this.low = q;
      m.event();
    }
    this.vsup = this.dangling[3] ? 5 : m.v[this.n[3]] - this.vneg(m.v);
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v, n = this.n;
    const vo = v[n[2]] - this.vneg(v);
    const i = this.low ? vo / Math.max(this.num('ron', 50), 0.1) : vo * 1e-9;
    return {
      voltage: v[n[2]], current: i, power: Math.abs(vo * i) + this.vsup * this.num('iq', 4e-4),
      on: !this.low, sinking: this.low, vdiff: v[n[0]] - v[n[1]], supply: this.vsup, overdriven: i > 0.02,
    };
  }
  groups(): number[][] {
    return [[2, this.dangling[3] ? -1 : 3, this.dangling[4] ? -1 : 4]];
  }
}

// ---------------------------------------------------------------------------------------------
// Linear regulator (78xx)
// ---------------------------------------------------------------------------------------------

export const REGULATOR_MODELS: Record<string, number> = { '7833': 3.3, '7805': 5, '7809': 9, '7812': 12 };

type RegMode = 'REG' | 'DROP' | 'CC' | 'OFF';

/**
 * Pins: [IN, GND, OUT]; branch J = current through the pass element (IN → OUT).
 * OUT = min(Vnom, Vin − dropout) behind a small output resistance, 0 ≤ J ≤ Ilimit; the quiescent
 * current flows IN → GND.
 */
export class Regulator extends Device {
  nBr = 1;
  nonlinear = true;
  mode: RegMode = 'OFF';
  private vnom = 5;
  private vinPrev = 0;
  private flips = 0;
  private lastTime = -1;
  configure(): void {
    const mdl = this.str('model');
    this.vnom = REGULATOR_MODELS[mdl] ?? Math.max(this.num('voltage', 5), 0.1);
  }
  reset(): void {
    this.mode = 'OFF';
    this.vinPrev = 0;
    this.lastTime = -1;
  }
  stamp(m: MNA): void {
    const [vi, g, vo] = this.n;
    const b = this.br, v = m.v;
    const vnom = this.vnom;
    const vdrop = Math.max(this.num('dropout', 2), 0);
    const ilim = Math.max(this.num('currentLimit', 1), 1e-6);
    const rout = Math.max(this.num('rout', 0.02), 1e-4);
    const rd = 0.2;
    if (m.time !== this.lastTime) {
      this.lastTime = m.time;
      this.flips = 0;
    }
    if (this.flips < 12) {
      const vin = v[vi] - v[g], vout = v[vo] - v[g], J = v[b];
      let next = this.mode;
      if (this.mode === 'REG' || this.mode === 'DROP') {
        if (J > ilim * (1 + 1e-6)) next = 'CC';
        else if (J < -1e-9) next = 'OFF';
        else next = vnom - rout * J <= vin - vdrop - rd * J ? 'REG' : 'DROP';
      } else if (this.mode === 'CC') {
        const tr = vnom - rout * ilim, td = vin - vdrop - rd * ilim;
        if (vout > Math.min(tr, td) + 1e-9) next = tr <= td ? 'REG' : 'DROP';
      } else if (vout < Math.min(vnom, vin - vdrop) - 1e-9) {
        next = vnom <= vin - vdrop ? 'REG' : 'DROP';
      }
      if (next !== this.mode) {
        this.mode = next;
        this.flips++;
        m.limited = true;
      }
    }
    m.add(vi, b, 1);
    m.add(vo, b, -1);
    if (this.mode === 'REG') {
      m.add(b, vo, 1);
      m.add(b, g, -1);
      m.add(b, b, rout);
      m.rhs(b, vnom);
    } else if (this.mode === 'DROP') {
      m.add(b, vi, 1);
      m.add(b, vo, -1);
      m.add(b, b, -rd);
      m.rhs(b, vdrop);
    } else {
      m.add(b, b, 1);
      m.rhs(b, this.mode === 'CC' ? ilim : 0);
    }
    m.g(vi, g, Math.max(this.num('iq', 0.005), 0) / Math.max(this.vinPrev, 2));
    m.g(vo, g, 1e-7);
  }
  accept(m: MNA): void {
    this.vinPrev = m.v[this.n[0]] - m.v[this.n[1]];
  }
  state(m: MNA): CircuitComponentState {
    const [vi, g, vo] = this.n;
    const v = m.v;
    const vin = v[vi] - v[g], vout = v[vo] - v[g], J = v[this.br];
    const iq = (Math.max(this.num('iq', 0.005), 0) / Math.max(this.vinPrev, 2)) * vin;
    const p = (vin - vout) * J + vin * iq;
    const mode = this.mode === 'REG' ? 'REG' : this.mode === 'DROP' ? 'DROPOUT' : this.mode === 'CC' ? 'LIMIT' : 'OFF';
    return {
      voltage: vout, current: J, power: p, inputVoltage: vin, inputCurrent: J + iq, nominal: this.vnom,
      mode, regulating: this.mode === 'REG', on: vout > 0.5 * this.vnom,
      overheating: p > this.num('powerRating', 15), text: `${fmtSI(vout, 'V')}  ${fmtSI(J, 'A')}  ${mode}`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Digital ICs (implied supply)
// ---------------------------------------------------------------------------------------------

/** Pins: [SER, SRCLK, RCLK, OE, SRCLR, Q0..Q7, Q7S]. OE and SRCLR are active-low. */
export class Shift595 extends Digital {
  inputs = [0, 1, 2, 3, 4];
  outputs = [5, 6, 7, 8, 9, 10, 11, 12, 13];
  shift = 0;
  latch = 0;
  hiz = false;
  private pS = false;
  private pR = false;
  protected resetLogic(): void {
    this.shift = 0;
    this.latch = 0;
    this.hiz = false;
    this.pS = this.pR = false;
  }
  protected evaluate(): boolean[] {
    const s = this.inState;
    if (!this.first) {
      const riseS = s[1] && !this.pS, riseR = s[2] && !this.pR;
      const old = this.shift;
      if (riseR) this.latch = old; // storage register copies the shift register as it was before this edge
      if (!this.dangling[4] && !s[4]) this.shift = 0;
      else if (riseS) this.shift = ((old << 1) | (s[0] ? 1 : 0)) & 0xff;
    }
    this.pS = s[1];
    this.pR = s[2];
    const out: boolean[] = [];
    for (let i = 0; i < 8; i++) out.push(((this.latch >> i) & 1) !== 0);
    out.push((this.shift & 0x80) !== 0);
    return out;
  }
  stamp(m: MNA): void {
    if (!this.hiz) {
      super.stamp(m);
      return;
    }
    // outputs disabled (OE high): Q0..Q7 float, only the serial output stays driven
    const G = 1 / Math.max(this.num('rout', 40), 0.1);
    const node = this.n[13];
    m.g(node, 0, G);
    if (this.out[8]) m.cur(0, node, G * this.num('vdd', 5));
  }
  accept(m: MNA): void {
    super.accept(m);
    const hz = !this.dangling[3] && this.inState[3];
    if (hz !== this.hiz) {
      this.hiz = hz;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const s = super.state(m);
    const bin = this.latch.toString(2).padStart(8, '0');
    return { ...s, value: this.latch, shift: this.shift, enabled: !this.hiz, text: this.hiz ? 'Hi-Z' : bin };
  }
}

/** Pins: [A, B, C, G1, G2A, G2B, Y0..Y7]. Outputs are active-low; G2A / G2B are active-low enables. */
export class Decoder138 extends Digital {
  inputs = [0, 1, 2, 3, 4, 5];
  outputs = [6, 7, 8, 9, 10, 11, 12, 13];
  value = -1;
  protected evaluate(): boolean[] {
    const s = this.inState;
    const en = (this.dangling[3] || s[3]) && !s[4] && !s[5];
    const sel = (s[0] ? 1 : 0) | (s[1] ? 2 : 0) | (s[2] ? 4 : 0);
    this.value = en ? sel : -1;
    return Array.from({ length: 8 }, (_, i) => !(en && i === sel));
  }
  state(m: MNA): CircuitComponentState {
    return { ...super.state(m), value: this.value, enabled: this.value >= 0, text: this.value >= 0 ? `Y${this.value}` : '—' };
  }
}

/** Pins: [OUT]. Square clock 0…vdd referenced to circuit ground; starts LOW (first rising edge at (1 − duty)·T). */
export class Clock extends Device {
  level = false;
  running = true;
  private lvl = 0;
  reset(): void {
    this.level = false;
    this.lvl = 0;
    this.running = this.p.running !== false;
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('running' in props) this.running = this.bool('running');
  }
  interact(a: InteractAction): boolean {
    if (a === 'toggle') this.running = !this.running;
    else if (a === 'press') this.running = true;
    else if (a === 'release') this.running = false;
    else this.running = a.set > 0.5;
    return true;
  }
  private duty(): number {
    return clamp(this.num('duty', 50) / 100, 0.001, 0.999);
  }
  private phase(): number {
    return this.num('phase', 0) / 360 + this.duty();
  }
  stamp(m: MNA): void {
    const out = this.n[0];
    const G = 1 / Math.max(this.num('rout', 40), 1e-2);
    const lvl = this.running ? squareAvg(this.num('frequency', 1), m.time, m.h, this.duty(), this.phase()) : 0;
    this.lvl = lvl;
    m.g(out, 0, G);
    m.cur(0, out, G * this.num('vdd', 5) * lvl);
  }
  accept(m: MNA): void {
    const x = this.num('frequency', 1) * m.time + this.phase();
    const level = this.running && x - Math.floor(x) < this.duty();
    if (level !== this.level) {
      this.level = level;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]];
    const G = 1 / Math.max(this.num('rout', 40), 1e-2);
    const i = G * (this.lvl * this.num('vdd', 5) - v); // lvl = mean level of the last step (edges are anti-aliased)
    return { voltage: v, current: i, power: (i * i) / G, on: this.level, running: this.running, frequency: this.num('frequency', 1) };
  }
  groups(): number[][] {
    return [[0, -1]];
  }
}

// ---------------------------------------------------------------------------------------------
// H-bridge (one L293-style full bridge)
// ---------------------------------------------------------------------------------------------

/** Pins: [EN, IN1, IN2, OUT1, OUT2, VS]. Logic thresholds are TTL-like; power ground is the circuit ground. */
export class HBridge extends Device {
  nonlinear = true;
  en = false;
  a = false;
  b = false;
  private vs = 0;
  private js: Junction[] = Array.from({ length: 4 }, () => new Junction());
  configure(): void {
    for (const j of this.js) j.set(5e-9, 1.8, 0.1, 0);
  }
  reset(): void {
    this.en = this.a = this.b = false;
    this.vs = 0;
    for (const j of this.js) j.vj = 0;
  }
  private drop(): number {
    return Math.min(Math.max(this.num('drop', 1.2), 0), Math.max(this.vs, 0) / 2);
  }
  private half(m: MNA, out: number, high: boolean): void {
    const G = 1 / Math.max(this.num('ron', 1), 1e-3);
    const d = this.drop();
    if (high) {
      const vs = this.n[5];
      m.g(vs, out, G);
      m.cur(vs, out, -d * G);
    } else {
      m.g(out, 0, G);
      m.cur(out, 0, -d * G);
    }
  }
  stamp(m: MNA): void {
    const n = this.n;
    if (this.en) {
      this.half(m, n[3], this.a);
      this.half(m, n[4], this.b);
    }
    m.g(n[5], 0, 1e-4); // logic / bias supply current (≈ 1 mA at 10 V)
    if (this.bool('clampDiodes')) {
      this.js[0].stamp(m, n[3], n[5]);
      this.js[1].stamp(m, 0, n[3]);
      this.js[2].stamp(m, n[4], n[5]);
      this.js[3].stamp(m, 0, n[4]);
    } else {
      m.g(n[3], 0, 1e-9);
      m.g(n[4], 0, 1e-9);
    }
  }
  accept(m: MNA): void {
    const v = m.v, n = this.n;
    const lvl = (i: number, old: boolean, floating: boolean): boolean => {
      if (this.dangling[i]) return floating;
      const x = v[n[i]];
      return x > 2.3 ? true : x < 1.5 ? false : old;
    };
    const en = lvl(0, this.en, true), a = lvl(1, this.a, false), b = lvl(2, this.b, false);
    if (en !== this.en || a !== this.a || b !== this.b) {
      this.en = en;
      this.a = a;
      this.b = b;
      m.event();
    }
    this.vs = v[n[5]];
  }
  /** Current delivered by an output pin into the external circuit. */
  private iout(m: MNA, out: number, high: boolean, j0: Junction, j1: Junction): number {
    const v = m.v;
    const G = 1 / Math.max(this.num('ron', 1), 1e-3);
    const d = this.drop();
    let i = 0;
    if (this.en) i = high ? G * (v[this.n[5]] - d - v[out]) : -G * (v[out] - d);
    if (this.bool('clampDiodes')) {
      j0.eval(v[out] - v[this.n[5]]);
      i -= j0.i;
      j1.eval(-v[out]);
      i += j1.i;
    }
    return i;
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v, n = this.n;
    const i1 = this.iout(m, n[3], this.a, this.js[0], this.js[1]);
    const i2 = this.iout(m, n[4], this.b, this.js[2], this.js[3]);
    const vs = v[n[5]];
    const loss = (i: number, out: number): number => (i >= 0 ? i * (vs - v[out]) : -i * v[out]);
    const direction = !this.en ? 'coast' : this.a === this.b ? 'brake' : this.a ? 'forward' : 'reverse';
    return {
      voltage: v[n[3]] - v[n[4]], current: i1, power: Math.max(loss(i1, n[3]), 0) + Math.max(loss(i2, n[4]), 0),
      on: this.en, direction, supply: vs, inputs: [this.en, this.a, this.b],
      overdriven: Math.max(Math.abs(i1), Math.abs(i2)) > this.num('maxCurrent', 1), text: direction,
    };
  }
  groups(): number[][] {
    return [[3, 4, 5, -1]];
  }
}

// ---------------------------------------------------------------------------------------------
// DC motor, servo
// ---------------------------------------------------------------------------------------------

/**
 * Pins: [+, -]; branch = armature current (+ → −).
 *   electrical:  v = R·i + L·di/dt + Ke·ω        mechanical:  J·dω/dt = Kt·i − b·ω − T_load·sgn(ω)
 * The mechanical equation is integrated implicitly together with the electrical one (ω at the end
 * of the step is linear in the unknown current), so stiff motors stay stable at any step size.
 */
export class Motor extends Device {
  nBr = 1;
  il = 0;
  vl = 0;
  w = 0;
  angle = 0;
  private c0 = 0;
  private c1 = 0;
  private dir = 0;
  private R = 1;
  private L = 1e-3;
  private K = 0.01;
  private Jm = 1e-6;
  private bf = 0;
  configure(): void {
    this.R = Math.max(this.num('resistance', 8), 1e-3);
    this.L = Math.max(this.num('inductance', 5e-3), 1e-9);
    this.K = Math.max(this.num('k', 0.01), 1e-9);
    this.Jm = Math.max(this.num('inertia', 2e-6), 1e-12);
    this.bf = Math.max(this.num('friction', 1e-6), 0);
  }
  reset(): void {
    this.il = this.vl = this.w = this.angle = 0;
  }
  private load(): number {
    const e = this.ext.loadTorque;
    return Math.max(this.num('loadTorque', 0), 0) + (e !== undefined && Number.isFinite(e) ? Math.max(e, 0) : 0);
  }
  stamp(m: MNA): void {
    const a = this.n[0], b = this.n[1], br = this.br;
    const h = m.h;
    const den = this.Jm + this.bf * h;
    const tl = this.load();
    // direction of the friction torque during this step (0 = held by stiction)
    let dir = this.w > 0 ? 1 : this.w < 0 ? -1 : 0;
    if (dir === 0 && Math.abs(this.K * this.il) > tl) dir = this.il > 0 ? 1 : -1;
    this.dir = dir;
    if (dir === 0 && tl > 0) {
      this.c0 = 0;
      this.c1 = 0;
    } else {
      this.c0 = (this.Jm * this.w - h * tl * dir) / den;
      this.c1 = (h * this.K) / den;
    }
    const k = this.L * m.ah;
    m.add(a, br, 1);
    m.add(b, br, -1);
    m.add(br, a, 1);
    m.add(br, b, -1);
    m.add(br, br, -(this.R + k + this.K * this.c1));
    m.rhs(br, this.K * this.c0 - k * this.il - m.hist * this.vl);
  }
  accept(m: MNA): void {
    const i = m.v[this.br];
    let w = this.c0 + this.c1 * i;
    this.vl = m.v[this.n[0]] - m.v[this.n[1]] - this.R * i - this.K * w;
    this.il = i;
    // friction can stop the rotor but never reverse it
    if (this.dir !== 0 && this.load() > 0 && w * this.dir < 0) w = 0;
    this.angle += 0.5 * (this.w + w) * m.h;
    this.w = w;
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = m.v[this.br];
    const rpm = (this.w * 60) / TWO_PI;
    const torque = this.K * i;
    return {
      voltage: v, current: i, power: v * i, speed: this.w, rpm, angle: this.angle, angleDeg: this.angle * RAD2DEG,
      torque, backEmf: this.K * this.w, mechanicalPower: torque * this.w, on: Math.abs(rpm) > 1,
      stalled: Math.abs(rpm) < 1 && Math.abs(i) > 0.5 * Math.abs(v) / this.R && Math.abs(v) > 0.2,
      text: `${rpm.toFixed(Math.abs(rpm) < 100 ? 1 : 0)} rpm`,
    };
  }
}

/**
 * Pins: [V+, GND, SIG]. Position servo: the horn angle follows the commanded angle at a limited
 * angular speed while the supply is present.
 *   pwm mode: command = pulse width on SIG (minPulse → 0°, maxPulse → range), pulses every ~20 ms;
 *   dc mode : command = range · V(SIG) / controlVoltage.
 * Pulse widths are measured as (pulse area) / (pulse height), which stays accurate to a fraction of
 * the simulation step for the anti-aliased square sources.
 */
export class Servo extends Device {
  angle = 90;
  target = 90;
  width = 0;
  powered = false;
  moving = false;
  private hasCmd = false;
  private high = false;
  private area = 0;
  private peak = 0;
  private peakRef = 5;
  private lastPulse = -Infinity;
  private vs = 0;
  reset(): void {
    const range = Math.max(this.num('range', 180), 1);
    this.angle = this.target = clamp(this.num('initialAngle', 90), 0, range);
    this.width = 0;
    this.powered = this.moving = this.hasCmd = this.high = false;
    this.area = this.peak = 0;
    this.peakRef = 5;
    this.lastPulse = -Infinity;
    this.vs = 0;
  }
  stamp(m: MNA): void {
    const [vp, g, sig] = this.n;
    m.g(sig, g, 1e-5);
    const i = Math.max(this.num('idleCurrent', 0.008), 0) + (this.moving ? Math.max(this.num('runCurrent', 0.15), 0) : 0);
    m.g(vp, g, i / Math.max(this.vs, 3));
  }
  accept(m: MNA): void {
    const v = m.v;
    const [vp, g, sig] = this.n;
    const h = m.h;
    this.vs = v[vp] - v[g];
    this.powered = this.vs >= Math.max(this.num('minVoltage', 3), 0);
    const s = v[sig] - v[g];
    const range = Math.max(this.num('range', 180), 1);
    if (this.str('mode') === 'dc') {
      this.target = range * clamp(s / Math.max(this.num('controlVoltage', 5), 1e-3), 0, 1);
      this.hasCmd = true;
    } else {
      const thr = Math.max(0.3 * this.peakRef, 0.5);
      const floor = Math.max(0.08 * this.peakRef, 0.1);
      if (s > floor) {
        this.area += s * h;
        if (s > this.peak) this.peak = s;
      } else if (!this.high) {
        this.area = 0;
        this.peak = 0;
      }
      if (!this.high && s > thr) this.high = true;
      else if (this.high && s < thr) {
        this.high = false;
        const w = this.peak > 0 ? this.area / this.peak : 0;
        const lo = Math.max(this.num('minPulse', 1e-3), 1e-5), hi = Math.max(this.num('maxPulse', 2e-3), lo * 1.01);
        if (w > 0.4 * lo && w < 1.6 * hi) {
          this.width = w;
          this.target = range * clamp((w - lo) / (hi - lo), 0, 1);
          this.hasCmd = true;
          this.lastPulse = m.time;
          this.peakRef = this.peak;
        }
        this.area = 0;
        this.peak = 0;
      }
      if (this.hasCmd && m.time - this.lastPulse > 0.1) this.hasCmd = false; // signal lost: hold position
    }
    let moving = false;
    if (this.powered && this.hasCmd) {
      const d = this.target - this.angle;
      const step = Math.max(this.num('speed', 600), 0) * h;
      if (Math.abs(d) > 1e-9) {
        this.angle += clamp(d, -step, step);
        moving = Math.abs(d) > step;
      }
    }
    this.moving = moving;
  }
  state(m: MNA): CircuitComponentState {
    const [vp, g] = this.n;
    const vs = m.v[vp] - m.v[g];
    const i = (vs * (Math.max(this.num('idleCurrent', 0.008), 0) + (this.moving ? Math.max(this.num('runCurrent', 0.15), 0) : 0))) / Math.max(this.vs, 3);
    const range = Math.max(this.num('range', 180), 1);
    return {
      voltage: vs, current: i, power: vs * i, angleDeg: this.angle, angle: this.angle / RAD2DEG, target: this.target,
      fraction: this.angle / range, pulseWidth: this.width, powered: this.powered, moving: this.moving,
      on: this.powered && this.hasCmd, text: `${this.angle.toFixed(1)}°`,
    };
  }
  groups(): number[][] {
    return [[0, 1, 2]];
  }
}

// ---------------------------------------------------------------------------------------------
// Thermistor, fuse
// ---------------------------------------------------------------------------------------------

/** Pins: [A, B]. NTC, beta model: R(T) = R25·exp(B·(1/T − 1/298.15 K)); optional self-heating. */
export class Thermistor extends Device {
  T = 25;
  private ambient(): number {
    const e = this.ext.temperature;
    return e !== undefined && Number.isFinite(e) ? e : this.num('temperature', 25);
  }
  reset(): void {
    this.T = this.ambient();
  }
  propsChanged(): void {
    if (!this.bool('selfHeating')) this.T = this.ambient();
  }
  setExternal(key: string, value: number): void {
    super.setExternal(key, value);
    if (!this.bool('selfHeating')) this.T = this.ambient();
  }
  interact(a: InteractAction): boolean {
    if (typeof a !== 'object') return false;
    this.ext.temperature = a.set;
    if (!this.bool('selfHeating')) this.T = a.set;
    return true;
  }
  private res(): number {
    const tk = Math.max(this.T + 273.15, 1);
    return clamp(Math.max(this.num('r25', 10000), 1e-3) * Math.exp(this.num('beta', 3950) * (1 / tk - 1 / 298.15)), 1e-3, 1e12);
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], 1 / this.res());
  }
  accept(m: MNA): void {
    const amb = this.ambient();
    if (!this.bool('selfHeating')) {
      this.T = amb;
      return;
    }
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const p = (v * v) / this.res();
    const dc = Math.max(this.num('dissipation', 0.002), 1e-6); // W/K
    const tau = Math.max(this.num('tau', 5), 1e-3);
    this.T = clamp(this.T + (amb + p / dc - this.T) * (1 - Math.exp(-m.h / tau)), -273, 1000);
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const r = this.res();
    return { voltage: v, current: v / r, power: (v * v) / r, resistance: r, temperature: this.T, text: `${fmtSI(r, 'Ω')} @ ${this.T.toFixed(1)} °C` };
  }
}

/** Blow threshold of the normalised fuse-wire temperature u (u → (I/Irated)² in steady state). */
const FUSE_BLOW = 1.8;

/**
 * Pins: [A, B]. Fuse with an I²t characteristic: du/dt = ((I/In)² − u)/τ, blows at u ≥ 1.8
 * (≈ 1.34·In sustained), τ = I²t / (1.8·In²) so that a large overload melts it after I²·t ≈ `i2t`.
 */
export class Fuse extends Device {
  blown = false;
  u = 0;
  reset(): void {
    this.blown = this.bool('blown');
    this.u = 0;
  }
  propsChanged(props: Record<string, ParamValue>): void {
    if ('blown' in props) {
      this.blown = this.bool('blown');
      if (!this.blown) this.u = 0;
    }
  }
  interact(a: InteractAction): boolean {
    // toggle / press / release = fit a new fuse; {set: 0} blows it on purpose, {set: 1} replaces it
    this.blown = typeof a === 'object' ? a.set < 0.5 : false;
    this.u = 0;
    return true;
  }
  private g(): number {
    return this.blown ? 1e-9 : 1 / Math.max(this.num('resistance', 0.05), 1e-6);
  }
  stamp(m: MNA): void {
    m.g(this.n[0], this.n[1], this.g());
  }
  accept(m: MNA): void {
    if (this.blown) return;
    const i = (m.v[this.n[0]] - m.v[this.n[1]]) * this.g();
    const rated = Math.max(this.num('rating', 0.5), 1e-6);
    const tau = Math.max(this.num('i2t', 0.05), 1e-12) / (FUSE_BLOW * rated * rated);
    const x = (i / rated) ** 2;
    this.u += (x - this.u) * (1 - Math.exp(-m.h / tau));
    if (this.u >= FUSE_BLOW) {
      this.blown = true;
      m.event();
    }
  }
  state(m: MNA): CircuitComponentState {
    const v = m.v[this.n[0]] - m.v[this.n[1]];
    const i = v * this.g();
    return { voltage: v, current: i, power: v * i, blown: this.blown, on: !this.blown, heat: clamp(this.u / FUSE_BLOW, 0, 1), text: this.blown ? 'BLOWN' : fmtSI(this.num('rating', 0.5), 'A') };
  }
}

// ---------------------------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------------------------

export function createDevice(comp: CircuitComponent, def: CircuitComponentDef | undefined): Device {
  switch (comp.type) {
    case 'ic.opamp': return new OpAmp(comp, def);
    case 'ic.comparator': return new Comparator(comp, def);
    case 'ic.regulator': return new Regulator(comp, def);
    case 'ic.shift595': return new Shift595(comp, def);
    case 'ic.decoder138': return new Decoder138(comp, def);
    case 'ic.hbridge': return new HBridge(comp, def);
    case 'misc.motor': return new Motor(comp, def);
    case 'misc.servo': return new Servo(comp, def);
    case 'passive.thermistor': return new Thermistor(comp, def);
    case 'passive.fuse': return new Fuse(comp, def);
    case 'source.clock': return new Clock(comp, def);
    default: return createBaseDevice(comp, def);
  }
}
