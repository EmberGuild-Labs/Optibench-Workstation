import { describe, expect, it } from 'vitest';
import type { CircuitState, ParamValue } from '../../src/core/types';
import { Bench, comp, run } from './helpers';

/** Bench with ±vs split supply rails (nets of VP:+ and VN:-). */
function dual(vs = 12): Bench {
  const b = new Bench();
  b.add('source.battery', 'VP', { voltage: vs, internalResistance: 0.01, capacity: 1e5 });
  b.add('source.battery', 'VN', { voltage: vs, internalResistance: 0.01, capacity: 1e5 });
  b.ground('VP:-', 'VN:+');
  return b;
}
function opamp(b: Bench, id: string, props: Record<string, ParamValue> = {}): void {
  b.add('ic.opamp', id, props);
  b.connect('VP:+', `${id}:V+`);
  b.connect('VN:-', `${id}:V-`);
}
const vOf = (s: CircuitState, id: string): number => comp(s, id).voltage as number;

describe('ic.opamp', () => {
  it('inverting and non-inverting gain are accurate', () => {
    const b = dual();
    b.add('source.battery', 'VIN', { voltage: 0.5, internalResistance: 0.001, capacity: 1e5 });
    b.ground('VIN:-');
    // inverting ×(−10)
    opamp(b, 'U1');
    b.add('passive.resistor', 'R1', { resistance: 1000 });
    b.add('passive.resistor', 'R2', { resistance: 10000 });
    b.connect('VIN:+', 'R1:A');
    b.connect('R1:B', 'U1:IN-', 'R2:A');
    b.connect('R2:B', 'U1:OUT');
    b.ground('U1:IN+');
    // non-inverting ×11
    opamp(b, 'U2');
    b.add('passive.resistor', 'R3', { resistance: 1000 });
    b.add('passive.resistor', 'R4', { resistance: 10000 });
    b.connect('VIN:+', 'U2:IN+');
    b.connect('U2:OUT', 'R4:A');
    b.connect('R4:B', 'U2:IN-', 'R3:A');
    b.ground('R3:B');
    const s = run(b.sim(), 0.005);
    expect(s.converged).toBe(true);
    expect(vOf(s, 'U1')).toBeCloseTo(-5, 2);
    expect(vOf(s, 'U2')).toBeCloseTo(5.5, 2);
    expect(Math.abs(comp(s, 'U1').vdiff)).toBeLessThan(1e-3);
    expect(comp(s, 'U1').saturated).toBe(false);
  });

  function acGain(freq: number, gbw: number): number {
    const b = dual();
    b.settings.timestep = 1e-6;
    b.add('source.ac', 'VIN', { amplitude: 0.01, frequency: freq, seriesResistance: 0 });
    b.ground('VIN:-');
    opamp(b, 'U', { gbw, slewRate: 100 });
    b.add('passive.resistor', 'R3', { resistance: 1000 });
    b.add('passive.resistor', 'R4', { resistance: 99000 });
    b.connect('VIN:+', 'U:IN+');
    b.connect('U:OUT', 'R4:A');
    b.connect('R4:B', 'U:IN-', 'R3:A');
    b.ground('R3:B');
    const sim = b.sim();
    const T = 1 / freq;
    run(sim, 6 * T, T / 50);
    let mx = -Infinity, mn = Infinity;
    run(sim, 9 * T, T / 200, (s) => {
      mx = Math.max(mx, vOf(s, 'U'));
      mn = Math.min(mn, vOf(s, 'U'));
    });
    return (mx - mn) / 2 / 0.01;
  }

  it('closed-loop bandwidth ≈ GBW / gain (−3 dB point)', () => {
    expect(acGain(200, 1e6)).toBeCloseTo(100, 0);
    const g = acGain(10000, 1e6); // gain 100 → corner at 10 kHz
    expect(g).toBeGreaterThan(70.7 * 0.93);
    expect(g).toBeLessThan(70.7 * 1.07);
    const g2 = acGain(10000, 4e6); // faster part: still flat at 10 kHz
    expect(g2).toBeGreaterThan(90);
  });

  it('slew rate limits a large step', () => {
    const b = dual();
    b.settings.timestep = 1e-6;
    b.add('source.function_gen', 'FG', { waveform: 'square', frequency: 1000, amplitude: 2.5, offset: 2.5, outputResistance: 50 });
    b.ground('FG:-');
    opamp(b, 'U', { slewRate: 0.5, gbw: 5e6 });
    b.connect('FG:+', 'U:IN+');
    b.connect('U:OUT', 'U:IN-');
    const sim = b.sim();
    const pts: [number, number][] = [];
    let slewing = false;
    run(sim, 0.0006, 1e-6, (s) => {
      if (s.time > 0.0005) pts.push([s.time, vOf(s, 'U')]); // falling edge at t = 0.5 ms
      if (comp(s, 'U').slewing) slewing = true;
    });
    const t80 = pts.find(([, v]) => v < 4)![0], t20 = pts.find(([, v]) => v < 1)![0];
    const rate = 3 / (t20 - t80) / 1e6; // V/µs
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.55);
    expect(slewing).toBe(true);
    expect(pts[pts.length - 1][1]).toBeCloseTo(0, 2);
  });

  it('output saturates at the rails (headroom, rail-to-rail, LM358 single supply)', () => {
    const mk = (props: Record<string, ParamValue>, vin: number): CircuitState => {
      const b = dual();
      b.add('source.battery', 'VIN', { voltage: Math.abs(vin), internalResistance: 0.001, capacity: 1e5 });
      if (vin >= 0) b.ground('VIN:-'); else b.ground('VIN:+');
      opamp(b, 'U', props);
      b.add('passive.resistor', 'R3', { resistance: 1000 });
      b.add('passive.resistor', 'R4', { resistance: 10000 });
      b.connect(vin >= 0 ? 'VIN:+' : 'VIN:-', 'U:IN+');
      b.connect('U:OUT', 'R4:A');
      b.connect('R4:B', 'U:IN-', 'R3:A');
      b.ground('R3:B');
      return run(b.sim(), 0.004);
    };
    let s = mk({}, 2);
    expect(vOf(s, 'U')).toBeCloseTo(11, 1);
    expect(comp(s, 'U').saturated).toBe(true);
    expect(comp(s, 'U').clipping).toBe('high');
    s = mk({}, -2);
    expect(vOf(s, 'U')).toBeCloseTo(-11, 1);
    expect(comp(s, 'U').clipping).toBe('low');
    s = mk({ railToRail: true }, 2);
    expect(vOf(s, 'U')).toBeGreaterThan(11.9);
    expect(vOf(s, 'U')).toBeLessThan(12.001);
    s = mk({ model: 'lm358' }, 2);
    expect(vOf(s, 'U')).toBeCloseTo(10.5, 1);

    // LM358 on a single 5 V supply swings to (almost) ground
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.01, capacity: 1e5 });
    b.ground('V:-');
    b.add('ic.opamp', 'U', { model: 'lm358' });
    b.connect('V:+', 'U:V+');
    b.ground('U:V-', 'U:IN+');
    b.add('passive.resistor', 'RD', { resistance: 10000 });
    b.connect('V:+', 'RD:A');
    b.connect('RD:B', 'U:IN-');
    b.add('passive.resistor', 'RL', { resistance: 10000 });
    b.connect('U:OUT', 'RL:A');
    b.ground('RL:B');
    const s5 = run(b.sim(), 0.004);
    expect(vOf(s5, 'U')).toBeGreaterThan(0);
    expect(vOf(s5, 'U')).toBeLessThan(0.05);
  });

  it('current limit and real supply currents', () => {
    const b = dual();
    b.add('source.battery', 'VIN', { voltage: 5, internalResistance: 0.001, capacity: 1e5 });
    b.ground('VIN:-');
    opamp(b, 'U', { iq: 0 });
    b.connect('VIN:+', 'U:IN+');
    b.connect('U:OUT', 'U:IN-');
    b.add('passive.resistor', 'RL', { resistance: 1000 });
    b.connect('U:OUT', 'RL:A');
    b.ground('RL:B');
    const sim = b.sim();
    let s = run(sim, 0.003);
    expect(vOf(s, 'U')).toBeCloseTo(5, 2);
    expect(comp(s, 'U').current).toBeCloseTo(0.005, 4);
    expect(comp(s, 'VP').current).toBeCloseTo(0.005, 4); // sourced from V+
    expect(Math.abs(comp(s, 'VN').current)).toBeLessThan(1e-5);
    sim.updateProps('RL', { resistance: 10 }); // overload: 25 mA limit → 0.25 V
    s = run(sim, 0.006);
    expect(s.converged).toBe(true);
    expect(comp(s, 'U').limiting).toBe(true);
    expect(comp(s, 'U').current).toBeCloseTo(0.025, 4);
    expect(vOf(s, 'U')).toBeCloseTo(0.25, 2);
  });

  it('integrator ramps at −Vin/RC', () => {
    const b = dual();
    b.add('source.battery', 'VIN', { voltage: 1, internalResistance: 0.001, capacity: 1e5 });
    b.ground('VIN:-');
    opamp(b, 'U');
    b.add('passive.resistor', 'R', { resistance: 10000 });
    b.add('passive.capacitor', 'C', { capacitance: 100e-9 });
    b.connect('VIN:+', 'R:A');
    b.connect('R:B', 'U:IN-', 'C:A');
    b.connect('C:B', 'U:OUT');
    b.ground('U:IN+');
    const sim = b.sim();
    const s1 = run(sim, 0.002);
    const s2 = run(sim, 0.006);
    const slope = (vOf(s2, 'U') - vOf(s1, 'U')) / (s2.time - s1.time);
    expect(slope).toBeCloseTo(-1000, -1); // −1 V / (10 kΩ · 100 nF)
    expect(Math.abs(slope + 1000)).toBeLessThan(10);
    const s3 = run(sim, 0.03);
    expect(vOf(s3, 'U')).toBeCloseTo(-11, 1); // ends up at the negative rail
  });

  it('open-loop comparator and Schmitt trigger', () => {
    const b = dual();
    b.add('source.function_gen', 'FG', { waveform: 'triangle', frequency: 100, amplitude: 5, offset: 0, outputResistance: 50 });
    b.ground('FG:-');
    opamp(b, 'CMP');
    b.connect('FG:+', 'CMP:IN+');
    b.ground('CMP:IN-');
    // inverting Schmitt trigger: thresholds ±11 V · 10k/(10k+47k) = ±1.93 V
    opamp(b, 'ST');
    b.add('passive.resistor', 'RA', { resistance: 10000 });
    b.add('passive.resistor', 'RB', { resistance: 47000 });
    b.connect('FG:+', 'ST:IN-');
    b.connect('ST:OUT', 'RB:A');
    b.connect('RB:B', 'ST:IN+', 'RA:A');
    b.ground('RA:B');
    const sim = b.sim();
    let bad = 0;
    const flips: number[] = [];
    let last = 0;
    run(sim, 0.04, 1e-4, (s) => {
      if (!s.converged) bad++;
      const vin = vOf(s, 'FG'), vc = vOf(s, 'CMP'), vs = vOf(s, 'ST');
      if (Math.abs(vin) > 0.5) expect(Math.sign(vc)).toBe(Math.sign(vin));
      if (Math.abs(vin) > 0.5) expect(Math.abs(vc)).toBeCloseTo(11, 0);
      const sg = vs > 5 ? 1 : vs < -5 ? -1 : 0;
      if (sg !== 0 && sg !== last) {
        if (last !== 0) flips.push(vin);
        last = sg;
      }
    });
    expect(bad).toBe(0);
    expect(flips.length).toBeGreaterThanOrEqual(6);
    for (const v of flips) expect(Math.abs(Math.abs(v) - 1.93)).toBeLessThan(0.35); // ±0.2 V of triangle travel per 0.1 ms sample
  });

  it('transimpedance amplifier converts photocurrent to voltage', () => {
    const b = dual();
    opamp(b, 'U', { model: 'tl072' });
    b.add('opto.photodiode', 'PD', { responsivity: 0.5, illumination: 20e-6 });
    b.add('passive.resistor', 'RF', { resistance: 100000 });
    b.add('passive.capacitor', 'CF', { capacitance: 10e-12 });
    b.ground('PD:A', 'U:IN+');
    b.connect('PD:K', 'U:IN-', 'RF:A', 'CF:A');
    b.connect('RF:B', 'U:OUT', 'CF:B');
    const sim = b.sim();
    let s = run(sim, 0.005);
    expect(s.converged).toBe(true);
    expect(vOf(s, 'U')).toBeCloseTo(10e-6 * 1e5, 1); // 10 µA × 100 kΩ = 1 V
    expect(Math.abs(vOf(s, 'U') - 1)).toBeLessThan(0.01);
    sim.setExternal('PD', 'opticalPower', 60e-6);
    s = run(sim, 0.01);
    expect(Math.abs(vOf(s, 'U') - 3)).toBeLessThan(0.02);
  });

  it('relaxation oscillator runs at 1/(2·R·C·ln 3)', () => {
    const b = dual();
    opamp(b, 'U', { railToRail: true });
    b.add('passive.resistor', 'RA', { resistance: 10000 });
    b.add('passive.resistor', 'RB', { resistance: 10000 });
    b.add('passive.resistor', 'RT', { resistance: 10000 });
    b.add('passive.capacitor', 'CT', { capacitance: 100e-9 });
    b.connect('U:OUT', 'RB:A');
    b.connect('RB:B', 'U:IN+', 'RA:A');
    b.ground('RA:B');
    b.connect('U:OUT', 'RT:A');
    b.connect('RT:B', 'U:IN-', 'CT:A');
    b.ground('CT:B');
    b.add('passive.resistor', 'RK', { resistance: 1e6 }); // start-up kick
    b.connect('VP:+', 'RK:A');
    b.connect('RK:B', 'U:IN+');
    const sim = b.sim();
    let bad = 0, rises = 0, first = 0, lastT = 0, prev = 0;
    run(sim, 0.06, 2e-5, (s) => {
      if (!s.converged) bad++;
      const v = vOf(s, 'U');
      if (prev < 0 && v >= 0) {
        if (rises === 0) first = s.time;
        lastT = s.time;
        rises++;
      }
      prev = v;
    });
    expect(bad).toBe(0);
    expect(rises).toBeGreaterThan(10);
    const f = (rises - 1) / (lastT - first);
    const expected = 1 / (2 * 1e4 * 100e-9 * Math.log(3));
    expect(Math.abs(f - expected) / expected).toBeLessThan(0.06);
  });

  it('unconnected supply pins fall back to ideal ±15 V rails', () => {
    const b = new Bench();
    b.add('source.battery', 'VIN', { voltage: 1, internalResistance: 0.001, capacity: 1e5 });
    b.ground('VIN:-');
    b.add('ic.opamp', 'U');
    b.connect('VIN:+', 'U:IN+');
    b.connect('U:OUT', 'U:IN-');
    const s = run(b.sim(), 0.002);
    expect(vOf(s, 'U')).toBeCloseTo(1, 3);
    expect(comp(s, 'U').supply).toBe(30);
  });
});

describe('ic.comparator (LM393)', () => {
  it('open-collector output with pull-up follows the input comparison', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.01, capacity: 1e5 });
    b.ground('V:-');
    b.add('source.function_gen', 'FG', { waveform: 'triangle', frequency: 200, amplitude: 2, offset: 2.5 });
    b.ground('FG:-');
    b.add('ic.comparator', 'U');
    b.connect('V:+', 'U:V+');
    b.ground('U:V-');
    b.add('passive.resistor', 'RA', { resistance: 10000 });
    b.add('passive.resistor', 'RB', { resistance: 10000 });
    b.connect('V:+', 'RA:A');
    b.connect('RA:B', 'RB:A', 'U:IN-'); // 2.5 V reference
    b.ground('RB:B');
    b.connect('FG:+', 'U:IN+');
    b.add('passive.resistor', 'RP', { resistance: 4700 });
    b.connect('V:+', 'RP:A');
    b.connect('RP:B', 'U:OUT');
    let hi = 0, lo = 0, edges = 0, prev: boolean | null = null;
    const s = run(b.sim(), 0.02, 1e-4, (st) => {
      const vin = vOf(st, 'FG'), vo = vOf(st, 'U');
      if (vin > 2.7) { expect(vo).toBeGreaterThan(4.9); hi++; }
      if (vin < 2.3) { expect(vo).toBeLessThan(0.1); lo++; }
      const on = comp(st, 'U').on as boolean;
      if (prev !== null && on !== prev) edges++;
      prev = on;
    });
    expect(s.converged).toBe(true);
    expect(hi).toBeGreaterThan(20);
    expect(lo).toBeGreaterThan(20);
    expect(edges).toBeGreaterThanOrEqual(7);
    expect(edges).toBeLessThanOrEqual(9);
  });
});

describe('ic.regulator (78xx)', () => {
  function reg(vin: number, rload: number, props: Record<string, ParamValue> = {}) {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: vin, internalResistance: 0.05, capacity: 1e6 });
    b.ground('V:-');
    b.add('ic.regulator', 'U', props);
    b.connect('V:+', 'U:IN');
    b.ground('U:GND');
    b.add('passive.capacitor', 'CO', { capacitance: 10e-6, esr: 0.1 });
    b.add('passive.resistor', 'RL', { resistance: rload });
    b.connect('U:OUT', 'CO:A', 'RL:A');
    b.ground('CO:B', 'RL:B');
    return b;
  }
  it('regulates, drops out, limits current and draws quiescent current', () => {
    let s = run(reg(9, 50).sim(), 0.01);
    expect(s.converged).toBe(true);
    expect(vOf(s, 'U')).toBeCloseTo(5, 2);
    expect(comp(s, 'U').mode).toBe('REG');
    expect(comp(s, 'U').current).toBeCloseTo(0.1, 3);
    expect(comp(s, 'V').current).toBeCloseTo(0.105, 3); // load + 5 mA quiescent
    expect(comp(s, 'U').power).toBeCloseTo(4 * 0.1 + 9 * 0.005, 1);

    s = run(reg(6, 50).sim(), 0.01); // dropout: ≈ 6 − 2 V
    expect(comp(s, 'U').mode).toBe('DROPOUT');
    expect(vOf(s, 'U')).toBeGreaterThan(3.8);
    expect(vOf(s, 'U')).toBeLessThan(4.05);

    s = run(reg(9, 1).sim(), 0.01); // overload: 1 A limit into 1 Ω
    expect(comp(s, 'U').mode).toBe('LIMIT');
    expect(comp(s, 'U').current).toBeCloseTo(1, 3);
    expect(vOf(s, 'U')).toBeCloseTo(1, 2);

    for (const [model, v] of [['7833', 3.3], ['7809', 9], ['7812', 12]] as const) {
      s = run(reg(16, 200, { model }).sim(), 0.01);
      expect(vOf(s, 'U')).toBeCloseTo(v, 2);
    }
    s = run(reg(16, 200, { model: 'custom', voltage: 7.5 }).sim(), 0.01);
    expect(vOf(s, 'U')).toBeCloseTo(7.5, 2);
  });

  it('rejects input ripple and does not sink current', () => {
    const b = new Bench();
    b.add('source.ac', 'V', { amplitude: 1, frequency: 100, offset: 10, seriesResistance: 0.1 });
    b.ground('V:-');
    b.add('ic.regulator', 'U');
    b.connect('V:+', 'U:IN');
    b.ground('U:GND');
    b.add('passive.resistor', 'RL', { resistance: 100 });
    b.connect('U:OUT', 'RL:A');
    b.ground('RL:B');
    // a 9 V battery back-feeding the output through a resistor: the regulator must switch off
    b.add('source.battery', 'VB', { voltage: 9, internalResistance: 0.1, capacity: 1e5 });
    b.add('switch.spst', 'S', { closed: false });
    b.add('passive.resistor', 'RB', { resistance: 10 });
    b.ground('VB:-');
    b.connect('VB:+', 'S:A');
    b.connect('S:B', 'RB:A');
    b.connect('RB:B', 'U:OUT');
    const sim = b.sim();
    let mn = Infinity, mx = -Infinity;
    run(sim, 0.03, 1e-4, (s) => {
      if (s.time > 0.005) { mn = Math.min(mn, vOf(s, 'U')); mx = Math.max(mx, vOf(s, 'U')); }
    });
    expect(mx - mn).toBeLessThan(0.002);
    sim.interact('S', 'toggle');
    const s = run(sim, 0.04);
    expect(s.converged).toBe(true);
    expect(comp(s, 'U').mode).toBe('OFF');
    expect(comp(s, 'U').current).toBeCloseTo(0, 6);
    expect(vOf(s, 'U')).toBeGreaterThan(7.5);
  });
});

describe('digital ICs', () => {
  it('source.clock: frequency, levels and stop/start', () => {
    const b = new Bench();
    b.add('source.clock', 'CK', { frequency: 500, duty: 25 });
    b.add('passive.resistor', 'R', { resistance: 10000 });
    b.connect('CK:OUT', 'R:A');
    b.ground('R:B');
    const sim = b.sim();
    let rises = 0, high = 0, n = 0, prev = false, wasOn = false;
    expect(comp(sim.step(1e-4), 'CK').on).toBe(false); // starts low
    run(sim, 0.02, 1e-4, (s) => {
      const on = comp(s, 'CK').on as boolean;
      if (on && !prev) rises++;
      prev = on;
      n++;
      if (on) high++;
      if (on && wasOn) expect(vOf(s, 'R')).toBeGreaterThan(4.9);
      wasOn = on;
    });
    expect(rises).toBe(10);
    expect(high / n).toBeCloseTo(0.25, 1);
    sim.interact('CK', 'toggle');
    const s = run(sim, 0.03);
    expect(comp(s, 'CK').running).toBe(false);
    expect(vOf(s, 'R')).toBeLessThan(0.01);
  });

  it('74HC595 shifts, latches, clears and tri-states', () => {
    const b = new Bench();
    // data: 1 for the first 2.5 clock periods, then 0  → pattern 1,1,0,0,0…
    b.add('switch.spst', 'SD', { closed: true });
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 1, capacity: 1e5 });
    b.ground('V:-');
    b.add('passive.resistor', 'RPD', { resistance: 10000 });
    b.connect('V:+', 'SD:A');
    b.connect('SD:B', 'RPD:A');
    b.ground('RPD:B');
    b.add('source.clock', 'CK', { frequency: 1000 });
    b.add('ic.shift595', 'U');
    b.connect('SD:B', 'U:SER');
    b.connect('CK:OUT', 'U:SRCLK', 'U:RCLK');
    b.add('switch.spst', 'SOE', { closed: false });
    b.add('passive.resistor', 'ROE', { resistance: 10000 });
    b.connect('V:+', 'SOE:A');
    b.connect('SOE:B', 'ROE:A', 'U:OE');
    b.ground('ROE:B');
    b.add('switch.spst', 'SCL', { closed: true });
    b.add('passive.resistor', 'RCL', { resistance: 10000 });
    b.connect('V:+', 'SCL:A');
    b.connect('SCL:B', 'RCL:A', 'U:SRCLR');
    b.ground('RCL:B');
    b.add('passive.resistor', 'RQ', { resistance: 1000 });
    b.connect('U:Q1', 'RQ:A');
    b.ground('RQ:B');
    const sim = b.sim();
    let s = run(sim, 0.00225); // rising edges at 0.5, 1.5 ms
    expect(comp(s, 'U').shift).toBe(0b11);
    expect(comp(s, 'U').value).toBe(0b1); // tied clocks: the latch is one clock behind
    sim.interact('SD', 'toggle');
    s = run(sim, 0.00425); // two more edges shifting in zeros
    expect(comp(s, 'U').shift).toBe(0b1100);
    expect(comp(s, 'U').value).toBe(0b110);
    expect(comp(s, 'U').text).toBe('00000110');
    expect(vOf(s, 'RQ')).toBeGreaterThan(4.5);
    expect((comp(s, 'U').outputs as boolean[]).slice(0, 4)).toEqual([false, true, true, false]);
    // output disable
    sim.interact('SOE', 'toggle');
    s = run(sim, 0.0044);
    expect(comp(s, 'U').enabled).toBe(false);
    expect(vOf(s, 'RQ')).toBeLessThan(0.01);
    sim.interact('SOE', 'toggle');
    // clear
    sim.interact('SCL', 'toggle');
    s = run(sim, 0.0062);
    expect(comp(s, 'U').shift).toBe(0);
    expect(comp(s, 'U').value).toBe(0);
    // serial out: shift eight ones through
    sim.interact('SCL', 'toggle');
    sim.interact('SD', 'toggle');
    s = run(sim, 0.0062 + 0.0085);
    expect((comp(s, 'U').outputs as boolean[])[8]).toBe(true);
    expect(comp(s, 'U').shift).toBe(0xff);
  });

  it('74HC138 selects one active-low output', () => {
    const b = new Bench();
    b.add('source.clock', 'CK', { frequency: 1000 });
    b.add('digital.counter', 'CNT', { modulus: 8 });
    b.add('ic.decoder138', 'U');
    b.connect('CK:OUT', 'CNT:CLK');
    b.ground('CNT:RST');
    b.connect('CNT:Q0', 'U:A');
    b.connect('CNT:Q1', 'U:B');
    b.connect('CNT:Q2', 'U:C');
    b.add('switch.spst', 'SE', { closed: false });
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 1, capacity: 1e5 });
    b.add('passive.resistor', 'RE', { resistance: 10000 });
    b.ground('V:-', 'RE:B');
    b.connect('V:+', 'SE:A');
    b.connect('SE:B', 'RE:A', 'U:G2A');
    const sim = b.sim();
    const seen = new Set<number>();
    run(sim, 0.0085, 2e-4, (s) => {
      const u = comp(s, 'U'), cnt = comp(s, 'CNT').count as number;
      const outs = u.outputs as boolean[];
      const lows = outs.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
      expect(lows.length).toBe(1);
      if (lows[0] === cnt) seen.add(cnt); // (decoder follows the counter one step later)
    });
    expect(seen.size).toBe(8);
    sim.interact('SE', 'toggle'); // G2A high → disabled
    const s = run(sim, 0.0095);
    expect((comp(s, 'U').outputs as boolean[]).every((o) => o)).toBe(true);
    expect(comp(s, 'U').value).toBe(-1);
  });
});

describe('motor, H-bridge, servo', () => {
  it('DC motor: no-load speed, stall current, load torque', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 6, internalResistance: 0.01, capacity: 1e6 });
    b.ground('V:-');
    b.add('misc.motor', 'M', { friction: 0 });
    b.connect('V:+', 'M:+');
    b.ground('M:-');
    const sim = b.sim();
    let s = sim.step(2e-3);
    expect(comp(s, 'M').current).toBeGreaterThan(0.2); // start-up current towards V/R = 0.75 A
    s = run(sim, 2.0, 0.01);
    expect(s.converged).toBe(true);
    expect(comp(s, 'M').speed).toBeCloseTo(600, 0); // V / Ke
    expect(comp(s, 'M').rpm).toBeCloseTo((600 * 60) / (2 * Math.PI), -1);
    expect(Math.abs(comp(s, 'M').current)).toBeLessThan(1e-3);
    expect(comp(s, 'M').angleDeg).toBeCloseTo((comp(s, 'M').angle * 180) / Math.PI, 6);
    expect(comp(s, 'M').angle).toBeGreaterThan(600 * 1.5);
    // load: ω = (V − R·T/K)/K
    sim.updateProps('M', { loadTorque: 0.002 });
    s = run(sim, 4.0, 0.01);
    expect(comp(s, 'M').current).toBeCloseTo(0.2, 3);
    expect(comp(s, 'M').speed).toBeCloseTo((6 - 8 * 0.2) / 0.01, 0);
    // stall
    sim.setExternal('M', 'loadTorque', 1);
    s = run(sim, 5.0, 0.01);
    expect(comp(s, 'M').speed).toBe(0);
    expect(comp(s, 'M').current).toBeCloseTo(6 / 8.01, 2);
    expect(comp(s, 'M').stalled).toBe(true);
  });

  it('motor mechanical time constant J·R/K²', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 6, internalResistance: 0.001, capacity: 1e6 });
    b.ground('V:-');
    b.add('misc.motor', 'M', { friction: 0, inductance: 1e-5 });
    b.connect('V:+', 'M:+');
    b.ground('M:-');
    const s = run(b.sim(), 0.16, 0.01); // τ = 2e-6·8/1e-4 = 0.16 s
    expect(comp(s, 'M').speed / 600).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('H-bridge drives a motor forward, reverse, brake and coast', () => {
    const b = new Bench();
    b.add('source.battery', 'VS', { voltage: 9, internalResistance: 0.05, capacity: 1e6 });
    b.add('source.battery', 'VL', { voltage: 5, internalResistance: 1, capacity: 1e6 });
    b.ground('VS:-', 'VL:-');
    b.add('ic.hbridge', 'H');
    b.add('misc.motor', 'M');
    b.connect('VS:+', 'H:VS');
    b.connect('H:OUT1', 'M:+');
    b.connect('H:OUT2', 'M:-');
    for (const [sw, p] of [['S1', 'IN1'], ['S2', 'IN2'], ['SE', 'EN']] as const) {
      b.add('switch.spst', sw, { closed: sw !== 'S2' });
      b.add('passive.resistor', `R${sw}`, { resistance: 10000 });
      b.connect('VL:+', `${sw}:A`);
      b.connect(`${sw}:B`, `R${sw}:A`, `H:${p}`);
      b.ground(`R${sw}:B`);
    }
    const sim = b.sim();
    let bad = 0;
    const go = (T: number) => run(sim, T, 0.005, (s) => { if (!s.converged) bad++; });
    let s = go(1.5);
    expect(comp(s, 'H').direction).toBe('forward');
    expect(vOf(s, 'H')).toBeCloseTo(9 - 2.4 - 2 * (comp(s, 'M').current as number), 1); // two drops + 2 × 1 Ω
    const w = comp(s, 'M').speed as number;
    expect(w).toBeGreaterThan(590); // (9 − 2.4 V) / (Ke + b·R/Kt) = 600 rad/s
    expect(w).toBeLessThan(610);
    sim.interact('S1', 'toggle');
    sim.interact('S2', 'toggle');
    s = go(3.5);
    expect(comp(s, 'H').direction).toBe('reverse');
    expect(comp(s, 'M').speed).toBeCloseTo(-w, 0);
    sim.interact('S2', 'toggle'); // both low → brake (motor shorted through the low side)
    s = go(3.7);
    expect(comp(s, 'H').direction).toBe('brake');
    const wBrake = Math.abs(comp(s, 'M').speed as number);
    expect(wBrake).toBeLessThan(0.45 * w); // e^(−0.2/0.2) ≈ 0.37
    sim.interact('S1', 'toggle');
    go(5.2);
    sim.interact('SE', 'toggle'); // coast: only friction slows the rotor (τ = J/b = 2 s)
    s = go(5.4);
    expect(comp(s, 'H').direction).toBe('coast');
    expect(Math.abs(comp(s, 'M').speed as number)).toBeGreaterThan(0.8 * w);
    expect(Math.abs(comp(s, 'M').current as number)).toBeLessThan(0.01);
    expect(bad).toBe(0);
  });

  function servoBench(mode: string, fg: Record<string, ParamValue>, props: Record<string, ParamValue> = {}): Bench {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.05, capacity: 1e6 });
    b.ground('V:-');
    b.add('source.function_gen', 'FG', fg);
    b.ground('FG:-');
    b.add('misc.servo', 'SV', { mode, ...props });
    b.connect('V:+', 'SV:V+');
    b.ground('SV:GND');
    b.connect('FG:+', 'SV:SIG');
    return b;
  }

  it('servo decodes 1–2 ms pulses at 50 Hz', () => {
    for (const [duty, angle] of [[5, 0], [6.25, 45], [7.5, 90], [8.75, 135], [10, 180]] as const) {
      const b = servoBench('pwm', { waveform: 'square', frequency: 50, amplitude: 2.5, offset: 2.5, duty }, { initialAngle: 60 });
      const s = run(b.sim(), 0.5, 0.01);
      expect(s.converged).toBe(true);
      expect(comp(s, 'SV').pulseWidth).toBeCloseTo(duty * 2e-4, 5);
      expect(Math.abs((comp(s, 'SV').angleDeg as number) - angle)).toBeLessThan(0.6);
      expect(comp(s, 'SV').angle).toBeCloseTo(((comp(s, 'SV').angleDeg as number) * Math.PI) / 180, 9);
    }
  });

  it('servo slews at its rated speed, needs power, holds without signal', () => {
    const b = servoBench('pwm', { waveform: 'square', frequency: 50, amplitude: 2.5, offset: 2.5, duty: 10 }, { initialAngle: 0, speed: 300 });
    const sim = b.sim();
    let s = run(sim, 0.03 + 0.2, 0.01); // first complete pulse ends at ≈ 2 ms
    const a = comp(s, 'SV').angleDeg as number;
    expect(a).toBeGreaterThan(300 * 0.2 - 8);
    expect(a).toBeLessThan(300 * 0.23 + 1);
    expect(comp(s, 'SV').moving).toBe(true);
    expect(comp(s, 'SV').current).toBeGreaterThan(0.1);
    sim.updateProps('FG', { amplitude: 0, offset: 0 }); // signal lost → holds
    s = run(sim, 0.5, 0.01);
    const held = comp(s, 'SV').angleDeg as number;
    expect(held).toBeLessThan(120);
    s = run(sim, 0.7, 0.01);
    expect(comp(s, 'SV').angleDeg).toBe(held);
    expect(comp(s, 'SV').moving).toBe(false);

    const b2 = servoBench('pwm', { waveform: 'square', frequency: 50, amplitude: 2.5, offset: 2.5, duty: 10 }, { initialAngle: 0 });
    b2.components.find((c) => c.id === 'V')!.props.voltage = 1.5; // under-voltage: no motion
    s = run(b2.sim(), 0.3, 0.01);
    expect(comp(s, 'SV').powered).toBe(false);
    expect(comp(s, 'SV').angleDeg).toBe(0);
  });

  it('servo DC-control mode follows a control voltage', () => {
    const b = servoBench('dc', { waveform: 'sine', frequency: 1, amplitude: 2, offset: 2.5, outputResistance: 50 }, { speed: 5000 });
    let mn = Infinity, mx = -Infinity;
    run(b.sim(), 1.1, 0.01, (s) => {
      const sv = comp(s, 'SV');
      if (s.time > 0.1) {
        mn = Math.min(mn, sv.angleDeg);
        mx = Math.max(mx, sv.angleDeg);
        expect(Math.abs(sv.angleDeg - 36 * (vOf(s, 'FG') as number))).toBeLessThan(0.5);
      }
    });
    expect(mn).toBeCloseTo(18, 0);
    expect(mx).toBeCloseTo(162, 0);
  });
});

describe('thermistor and fuse', () => {
  it('NTC follows the beta equation and self-heats', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.01, capacity: 1e6 });
    b.ground('V:-');
    b.add('passive.thermistor', 'TH');
    b.connect('V:+', 'TH:A');
    b.ground('TH:B');
    const sim = b.sim();
    let s = sim.step(1e-3);
    expect(comp(s, 'TH').resistance).toBeCloseTo(10000, 3);
    sim.updateProps('TH', { temperature: 50 });
    s = sim.step(1e-3);
    const r50 = 10000 * Math.exp(3950 * (1 / 323.15 - 1 / 298.15));
    expect(comp(s, 'TH').resistance).toBeCloseTo(r50, 3);
    expect(comp(s, 'TH').current).toBeCloseTo(5 / r50, 5);
    sim.setExternal('TH', 'temperature', 0);
    s = sim.step(1e-3);
    expect(comp(s, 'TH').resistance).toBeGreaterThan(30000);

    const b2 = new Bench();
    b2.add('source.battery', 'V', { voltage: 10, internalResistance: 0.01, capacity: 1e6 });
    b2.ground('V:-');
    b2.add('passive.thermistor', 'TH', { r25: 100, selfHeating: true, tau: 0.02, dissipation: 0.02 });
    b2.add('passive.resistor', 'R', { resistance: 100, powerRating: 5 });
    b2.connect('V:+', 'R:A');
    b2.connect('R:B', 'TH:A');
    b2.ground('TH:B');
    s = run(b2.sim(), 0.5, 0.01);
    expect(comp(s, 'TH').temperature).toBeGreaterThan(30);
    expect(comp(s, 'TH').resistance).toBeLessThan(90);
    // steady state: T = 25 + P / 0.02 W/K
    expect(comp(s, 'TH').temperature).toBeCloseTo(25 + comp(s, 'TH').power / 0.02, 1);
  });

  it('fuse carries its rating, blows on overload after ≈ I²t, and can be replaced', () => {
    const b = new Bench();
    b.add('source.psu', 'V', { voltage: 10, currentLimit: 20 });
    b.ground('V:-');
    b.add('passive.fuse', 'F', { rating: 0.5, i2t: 0.05 });
    b.add('passive.resistor', 'R', { resistance: 20, powerRating: 50 });
    b.connect('V:+', 'F:A');
    b.connect('F:B', 'R:A');
    b.ground('R:B');
    const sim = b.sim();
    let s = run(sim, 1.5, 0.01);
    expect(comp(s, 'F').blown).toBe(false); // 0.5 A = rated
    expect(comp(s, 'F').heat).toBeCloseTo(1 / 1.8, 2);
    expect(comp(s, 'F').current).toBeCloseTo(0.5, 2);
    sim.updateProps('R', { resistance: 2 }); // ≈ 4.9 A = 10× overload
    let tBlow = NaN;
    s = run(sim, 1.6, 2e-4, (st) => { if (Number.isNaN(tBlow) && comp(st, 'F').blown) tBlow = st.time - 1.5; });
    expect(comp(s, 'F').blown).toBe(true);
    expect(tBlow).toBeGreaterThan(0.0005);
    expect(tBlow).toBeLessThan(0.05 / 4.9 ** 2 * 1.2); // I²t / I²
    expect(Math.abs(comp(s, 'F').current)).toBeLessThan(1e-6);
    sim.updateProps('R', { resistance: 20 });
    sim.interact('F', 'toggle');
    s = run(sim, 1.7, 0.01);
    expect(comp(s, 'F').blown).toBe(false);
    expect(comp(s, 'F').current).toBeCloseTo(0.5, 2);
  });
});
