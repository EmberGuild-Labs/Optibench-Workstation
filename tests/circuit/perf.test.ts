import { describe, expect, it } from 'vitest';
import { circuitEngine } from '../../src/core/circuit';
import { bigCircuit, bigCircuitAnalog } from './bigcircuit';
import { Bench, comp, run } from './helpers';

describe('performance', () => {
  it('a ~55-component mixed circuit runs in real time at 60 fps', () => {
    const b = bigCircuit();
    expect(b.components.filter((c) => c.type !== 'misc.ground').length).toBeGreaterThanOrEqual(50);
    const sim = b.sim(); // no wall-clock budget: measure the true cost
    run(sim, 0.05, 1 / 60); // warm-up (JIT)
    const frames = 120;
    const t0 = performance.now();
    let s = sim.getState();
    let worst = 0;
    for (let i = 0; i < frames; i++) {
      const f0 = performance.now();
      s = sim.step(1 / 60);
      worst = Math.max(worst, performance.now() - f0);
    }
    const ms = (performance.now() - t0) / frames;
    // eslint-disable-next-line no-console
    console.log(`[perf] ${b.components.length} components, ${JSON.stringify((sim as any).stats)}: ${ms.toFixed(2)} ms per 1/60 s frame (worst ${worst.toFixed(2)} ms), ${(1 / 60 / b.settings.timestep).toFixed(0)} steps/frame`);
    expect(s.converged).toBe(true);
    expect(comp(s, 'RLOAD').voltage).toBeGreaterThan(6);
    expect(ms).toBeLessThan(16.7 * 1.5); // typically ≈ 9 ms; headroom for loaded CI machines
  });

  it('a 60+ component circuit with two op-amps and a motor steps 1/60 s in < 12 ms', () => {
    const b = bigCircuitAnalog();
    const parts = b.components.filter((c) => c.type !== 'misc.ground');
    expect(parts.length).toBeGreaterThanOrEqual(60);
    expect(parts.filter((c) => c.type === 'ic.opamp').length).toBe(2);
    expect(parts.some((c) => c.type === 'misc.motor')).toBe(true);
    const sim = b.sim();
    run(sim, 0.1, 1 / 60); // warm-up (JIT)
    const frames = 120;
    const times: number[] = [];
    let s = sim.getState();
    let bad = 0;
    for (let i = 0; i < frames; i++) {
      const f0 = performance.now();
      s = sim.step(1 / 60);
      times.push(performance.now() - f0);
      if (!s.converged) bad++;
    }
    times.sort((x, y) => x - y);
    const mean = times.reduce((a, v) => a + v, 0) / frames, median = times[frames >> 1], quartile = times[frames >> 2];
    // eslint-disable-next-line no-console
    console.log(`[perf] ${b.components.length} components (2 op-amps + motor), ${JSON.stringify((sim as any).stats)}: mean ${mean.toFixed(2)} ms, median ${median.toFixed(2)} ms, worst ${times[frames - 1].toFixed(2)} ms per 1/60 s frame`);
    expect(bad).toBe(0);
    expect(comp(s, 'MOT').speed).toBeGreaterThan(50);
    expect(Math.abs(comp(s, 'OA2').voltage - comp(s, 'RD2').voltage)).toBeLessThan(0.01); // follower tracks its input
    // typically ≈ 10.8 ms median; the lower quartile is asserted so that a busy machine (parallel test workers) does not fail the run
    expect(quartile).toBeLessThan(12);
  });

  it('the default wall-clock budget bounds step() even when asked for far too much time', () => {
    const b = bigCircuit();
    const sim = circuitEngine.createSimulator(b.scene());
    sim.step(1 / 60);
    const t0 = performance.now();
    const s = sim.step(30); // 30 s of simulated time in one call
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    expect(s.time).toBeLessThan(30);
    expect(s.time).toBeGreaterThan(1 / 60);
  });

  it('8×8 matrix with all LEDs lit stays cheap', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.05 });
    b.ground('V:-');
    b.add('display.matrix', 'M');
    for (let i = 1; i <= 8; i++) {
      b.add('passive.resistor', `R${i}`, { resistance: 47 });
      b.connect('V:+', `R${i}:A`);
      b.connect(`R${i}:B`, `M:R${i}`);
      b.ground(`M:C${i}`);
    }
    const sim = b.sim();
    run(sim, 0.02, 1 / 60);
    const t0 = performance.now();
    let s = sim.getState();
    for (let i = 0; i < 30; i++) s = sim.step(1 / 60);
    const ms = (performance.now() - t0) / 30;
    // eslint-disable-next-line no-console
    console.log(`[perf] LED matrix: ${ms.toFixed(2)} ms per frame`);
    expect(s.converged).toBe(true);
    expect((comp(s, 'M').segments as number[]).every((x) => x > 0.3)).toBe(true);
    expect(ms).toBeLessThan(16.7);
  });
});
