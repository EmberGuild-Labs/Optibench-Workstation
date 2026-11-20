import { describe, expect, it } from 'vitest';
import { Bench, comp, run } from './helpers';

describe('linear circuits', () => {
  it('voltage divider', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 10, internalResistance: 0.001, capacity: 1e5 });
    b.add('passive.resistor', 'R1', { resistance: 1000 });
    b.add('passive.resistor', 'R2', { resistance: 3000 });
    b.add('meter.voltmeter', 'VM', { resistance: 1e12 });
    b.add('meter.ammeter', 'AM');
    b.connect('V:+', 'AM:+');
    b.connect('AM:-', 'R1:A');
    b.connect('R1:B', 'R2:A', 'VM:+');
    b.connect('R2:B', 'V:-', 'VM:-');
    b.ground('V:-');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'R2').voltage).toBeCloseTo(7.5, 3);
    expect(comp(s, 'R1').current).toBeCloseTo(2.5e-3, 6);
    expect(comp(s, 'R1').power).toBeCloseTo(2.5 * 2.5e-3, 5);
    expect(comp(s, 'V').current).toBeCloseTo(2.5e-3, 6);
    expect(comp(s, 'VM').text).toBe('7.50 V');
    expect(comp(s, 'AM').text).toBe('2.50 mA');
    expect(s.nodeVoltages[s.pinNets['R1:B']]).toBeCloseTo(7.5, 3);
    expect(s.nodeVoltages.GND).toBe(0);
    // every component reports current / voltage / power
    for (const id of Object.keys(s.components)) {
      for (const k of ['current', 'voltage', 'power']) expect(typeof comp(s, id)[k], `${id}.${k}`).toBe('number');
    }
  });

  it('solves without a ground symbol', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 6, internalResistance: 0.001 });
    b.add('passive.resistor', 'R1', { resistance: 100 });
    b.add('passive.resistor', 'R2', { resistance: 200 });
    b.connect('V:+', 'R1:A');
    b.connect('R1:B', 'R2:A');
    b.connect('R2:B', 'V:-');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'R2').voltage).toBeCloseTo(4, 3);
    expect(s.nodeVoltages[s.pinNets['V:-']]).toBeCloseTo(0, 6); // source negative is the reference
  });

  it('RC charging reaches 63.2 % at t = τ (within 1 %)', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.001, capacity: 1e5 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.add('passive.capacitor', 'C', { capacitance: 1e-6 });
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'C:A');
    b.connect('C:B', 'V:-');
    b.ground('V:-');
    const sim = b.sim();
    const s = run(sim, 1e-3);
    expect(s.time).toBeCloseTo(1e-3, 9);
    const target = 5 * (1 - Math.exp(-1));
    const vTau = comp(s, 'C').voltage;
    expect(Math.abs(vTau - target) / target).toBeLessThan(0.01);
    const s5 = run(sim, 5e-3);
    expect(comp(s5, 'C').voltage).toBeCloseTo(5 * (1 - Math.exp(-5)), 2);
    // result must not depend on how the caller slices time
    const sB = run(b.sim(), 1e-3, 1.3e-5);
    expect(sB.time).toBeCloseTo(1e-3, 9);
    expect(comp(sB, 'C').voltage).toBeCloseTo(vTau, 9);
  });

  it('RL current rise reaches 63.2 % at t = L/R', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 10, internalResistance: 0.001, capacity: 1e5 });
    b.add('passive.resistor', 'R', { resistance: 99.999 });
    b.add('passive.inductor', 'L', { inductance: 0.1, dcr: 0 });
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'L:A');
    b.connect('L:B', 'V:-');
    b.ground('V:-');
    const s = run(b.sim(), 1e-3); // τ = L/R = 1 ms
    const target = 0.1 * (1 - Math.exp(-1));
    expect(Math.abs(comp(s, 'L').current - target) / target).toBeLessThan(0.01);
  });

  it('LC tank oscillates at 1/(2π√(LC))', () => {
    const b = new Bench();
    b.settings.timestep = 5e-6;
    b.add('passive.capacitor', 'C', { capacitance: 1e-6, initialVoltage: 5 });
    b.add('passive.inductor', 'L', { inductance: 0.01, dcr: 0 });
    b.connect('C:A', 'L:A');
    b.connect('C:B', 'L:B');
    b.ground('C:B');
    const sim = b.sim();
    const crossings: number[] = [];
    let prev = 5, prevT = 0;
    run(sim, 6e-3, 5e-6, (s) => {
      const v = comp(s, 'C').voltage;
      if (prev < 0 && v >= 0) crossings.push(prevT + ((s.time - prevT) * -prev) / (v - prev));
      prev = v;
      prevT = s.time;
    });
    expect(crossings.length).toBeGreaterThanOrEqual(8);
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(0.01 * 1e-6));
    expect(Math.abs(1 / period - f0) / f0).toBeLessThan(0.01);
  });

  it('transformer steps the voltage down by the turns ratio under load', () => {
    const b = new Bench();
    b.add('source.ac', 'V', { amplitude: 10, frequency: 50, seriesResistance: 0.1 });
    b.add('passive.transformer', 'T', { lp: 1, ratio: 10, k: 0.99, rp: 1, rs: 0.1 });
    b.add('passive.resistor', 'RL', { resistance: 100 });
    b.connect('V:+', 'T:P1');
    b.connect('V:-', 'T:P2');
    b.connect('T:S1', 'RL:A');
    b.connect('T:S2', 'RL:B');
    b.ground('V:-'); // the secondary floats (isolated island)
    const sim = b.sim();
    let vs = 0, vp = 0, is = 0;
    run(sim, 0.1, 1e-4, (s) => {
      if (s.time > 0.06) {
        vs = Math.max(vs, Math.abs(comp(s, 'RL').voltage));
        vp = Math.max(vp, Math.abs(comp(s, 'T').voltage));
        is = Math.max(is, Math.abs(comp(s, 'T').secondaryCurrent));
      }
    });
    expect(vp).toBeGreaterThan(9.8);
    expect(vs / vp).toBeGreaterThan(0.099 * 0.96);
    expect(vs / vp).toBeLessThan(0.099 * 1.02);
    expect(is).toBeCloseTo(vs / 100, 4);
  });

  it('potentiometer wiper and switches respond to interaction', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 10, internalResistance: 0.001 });
    b.add('switch.spst', 'S', { closed: false });
    b.add('passive.potentiometer', 'P', { resistance: 10000, position: 0.5 });
    b.connect('V:+', 'S:A');
    b.connect('S:B', 'P:A');
    b.connect('P:B', 'V:-');
    b.ground('V:-');
    const sim = b.sim();
    let s = run(sim, 2e-4);
    expect(comp(s, 'S').on).toBe(false);
    expect(Math.abs(comp(s, 'P').wiperVoltage)).toBeLessThan(0.01);
    sim.interact('S', 'toggle');
    s = run(sim, 4e-4);
    expect(comp(s, 'S').on).toBe(true);
    expect(comp(s, 'P').wiperVoltage).toBeCloseTo(5, 2);
    sim.interact('P', { set: 0.25 });
    s = run(sim, 6e-4);
    expect(comp(s, 'P').wiperVoltage).toBeCloseTo(7.5, 2);
    sim.updateProps('P', { position: 0.9 });
    s = run(sim, 8e-4);
    expect(comp(s, 'P').wiperVoltage).toBeCloseTo(1, 2);
    sim.reset();
    expect(sim.getState().time).toBe(0);
    s = run(sim, 2e-4);
    expect(comp(s, 'S').on).toBe(false);
  });

  it('battery drains and reports its charge', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 9, internalResistance: 0.5, capacity: 0.001 }); // 3.6 mC
    b.add('passive.resistor', 'R', { resistance: 90 });
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'V:-');
    b.ground('V:-');
    const sim = b.sim();
    let s = run(sim, 0.01);
    expect(comp(s, 'V').chargePercent).toBeLessThan(80);
    expect(comp(s, 'V').chargePercent).toBeGreaterThan(60);
    s = run(sim, 0.2);
    expect(comp(s, 'V').charge).toBeLessThan(0.02);
    expect(comp(s, 'R').voltage).toBeLessThan(1);
  });

  it('never throws on pathological circuits (shorted ideal sources, empty scene, unknown types)', () => {
    const b = new Bench();
    b.add('source.ac', 'V1', { amplitude: 5, seriesResistance: 0 });
    b.add('source.ac', 'V2', { amplitude: 9, offset: 3, seriesResistance: 0 });
    b.connect('V1:+', 'V2:+');
    b.connect('V1:-', 'V2:-');
    b.ground('V1:-');
    const s = run(b.sim(), 1e-3);
    expect(typeof s.error).toBe('string');
    expect(s.converged).toBe(false);
    const empty = new Bench().sim();
    expect(empty.step(0.01).converged).toBe(true);
    const junk = new Bench();
    junk.components.push({ id: 'x', type: 'no.such.type', position: { x: 0, y: 0 }, rotation: 0, props: {} });
    expect(() => junk.sim().step(0.01)).not.toThrow();
  });
});
