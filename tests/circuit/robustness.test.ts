import { describe, expect, it } from 'vitest';
import { circuitEngine, createSimulatorWithOptions } from '../../src/core/circuit';
import type { CircuitComponent, CircuitScene, CircuitState, Wire } from '../../src/core/types';
import { Bench, comp, run } from './helpers';

function allFinite(s: CircuitState): boolean {
  for (const v of Object.values(s.nodeVoltages)) if (!Number.isFinite(v)) return false;
  for (const c of Object.values(s.components)) {
    for (const k of ['current', 'voltage', 'power'] as const) if (!Number.isFinite(c[k] as number)) return false;
  }
  return true;
}

describe('robustness', () => {
  it('PSU charges a large capacitor in CC, then holds CV', () => {
    const b = new Bench();
    b.add('source.psu', 'P', { voltage: 10, currentLimit: 0.1 });
    b.add('passive.capacitor', 'C', { capacitance: 100e-6, esr: 0.05 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.connect('P:+', 'C:A', 'R:A');
    b.connect('P:-', 'C:B', 'R:B');
    b.ground('P:-');
    const sim = b.sim();
    let s = run(sim, 2e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'P').mode).toBe('CC');
    expect(comp(s, 'C').voltage).toBeCloseTo((0.1 * 2e-3) / 100e-6, 0); // ≈ 2 V ramp (I·t/C)
    s = run(sim, 0.03);
    expect(s.converged).toBe(true);
    expect(comp(s, 'P').mode).toBe('CV');
    expect(comp(s, 'C').voltage).toBeCloseTo(10, 1);
  });

  it('opening a switch on an inductor (with and without flyback diode) stays finite', () => {
    for (const flyback of [true, false]) {
      const b = new Bench();
      b.add('source.battery', 'V', { voltage: 12, internalResistance: 0.1 });
      b.ground('V:-');
      b.add('switch.spst', 'S', { closed: true });
      b.add('passive.inductor', 'L', { inductance: 0.1, dcr: 10 });
      b.connect('V:+', 'S:A');
      b.connect('S:B', 'L:A');
      b.ground('L:B');
      if (flyback) {
        b.add('semi.diode', 'D');
        b.connect('D:K', 'L:A');
        b.ground('D:A');
      }
      const sim = b.sim();
      let s = run(sim, 0.05);
      expect(comp(s, 'L').current).toBeCloseTo(12 / 10.1, 1);
      sim.interact('S', 'toggle');
      let vmin = 0;
      s = run(sim, 0.06, 2e-5, (st) => { vmin = Math.min(vmin, st.nodeVoltages[st.pinNets['L:A']]); });
      expect(allFinite(s)).toBe(true);
      if (flyback) {
        expect(s.converged).toBe(true);
        expect(vmin).toBeGreaterThan(-1.5); // clamped one diode drop below ground
        expect(comp(s, 'L').current).toBeGreaterThan(0.2); // still free-wheeling (τ = 10 ms)
        expect(comp(s, 'L').current).toBeLessThan(0.6);
      } else {
        expect(vmin).toBeLessThan(-1000); // inductive kick
        expect(Math.abs(comp(s, 'L').current)).toBeLessThan(1e-3);
      }
      // no persistent numerical ringing afterwards
      s = run(sim, 0.2);
      expect(Math.abs(comp(s, 'L').voltage)).toBeLessThan(0.05);
    }
  });

  it('half-wave rectifier with smoothing capacitor', () => {
    const b = new Bench();
    b.add('source.ac', 'V', { amplitude: 10, frequency: 50 });
    b.add('semi.diode', 'D');
    b.add('passive.capacitor', 'C', { capacitance: 470e-6 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.connect('V:+', 'D:A');
    b.connect('D:K', 'C:A', 'R:A');
    b.connect('V:-', 'C:B', 'R:B');
    b.ground('V:-');
    let min = Infinity;
    const s = run(b.sim(), 0.1, 1e-4, (st) => { if (st.time > 0.06) min = Math.min(min, comp(st, 'R').voltage); });
    expect(s.converged).toBe(true);
    expect(min).toBeGreaterThan(8.5);
    expect(comp(s, 'R').voltage).toBeLessThan(9.6);
  });

  it('BJT astable multivibrator oscillates', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 9, internalResistance: 0.1 });
    b.ground('V:-');
    for (const k of ['1', '2']) {
      b.add('semi.npn', `Q${k}`);
      b.add('passive.resistor', `RC${k}`, { resistance: 1000 });
      b.add('passive.resistor', `RB${k}`, { resistance: k === '1' ? 47000 : 51000 });
      b.add('passive.capacitor', `C${k}`, { capacitance: 100e-9 });
      b.connect('V:+', `RC${k}:A`);
      b.connect('V:+', `RB${k}:A`);
      b.connect(`RC${k}:B`, `Q${k}:C`);
      b.connect(`RB${k}:B`, `Q${k}:B`);
      b.ground(`Q${k}:E`);
    }
    b.connect('Q1:C', 'C1:A');
    b.connect('C1:B', 'Q2:B');
    b.connect('Q2:C', 'C2:A');
    b.connect('C2:B', 'Q1:B');
    let edges = 0, prev = false, bad = 0;
    const s = run(b.sim(), 0.05, 2e-5, (st) => {
      const on = (comp(st, 'Q1').vce as number) < 1;
      if (on !== prev) edges++;
      prev = on;
      if (!st.converged) bad++;
    });
    expect(allFinite(s)).toBe(true);
    expect(bad).toBe(0);
    // f ≈ 1 / (0.693·(RB1·C + RB2·C)) ≈ 147 Hz -> ≈ 14 edges in 50 ms
    expect(edges).toBeGreaterThan(9);
    expect(edges).toBeLessThan(20);
  });

  it('MOSFET PWM stage with square-wave gate drive and inductive load', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 12, internalResistance: 0.05 });
    b.ground('V:-');
    b.add('source.function_gen', 'F', { waveform: 'square', frequency: 2000, amplitude: 5, offset: 5, duty: 30, outputResistance: 50 });
    b.ground('F:-');
    b.add('semi.nmos', 'M');
    b.add('passive.inductor', 'L', { inductance: 5e-3, dcr: 1 });
    b.add('passive.resistor', 'R', { resistance: 10 });
    b.add('semi.diode', 'D', { rs: 0.05 });
    b.connect('F:+', 'M:G');
    b.connect('V:+', 'L:A', 'D:K');
    b.connect('L:B', 'R:A');
    b.connect('R:B', 'M:D', 'D:A');
    b.ground('M:S');
    let bad = 0, sum = 0, n = 0;
    const s = run(b.sim(), 0.03, 1e-4, (st) => {
      if (!st.converged) bad++;
      if (st.time > 0.02) { sum += comp(st, 'L').current; n++; }
    });
    expect(allFinite(s)).toBe(true);
    expect(bad).toBe(0);
    // buck-like average: ≈ duty·12 V / 11 Ω, a bit less from the diode drop during free-wheeling
    expect(sum / n).toBeGreaterThan(0.2);
    expect(sum / n).toBeLessThan(0.4);
  });

  it('zener + emitter follower regulator', () => {
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 12, internalResistance: 0.1 });
    b.ground('V:-');
    b.add('passive.resistor', 'RZ', { resistance: 1000 });
    b.add('semi.zener', 'Z', { vz: 5.6 });
    b.add('semi.npn', 'Q');
    b.add('passive.resistor', 'RL', { resistance: 100 });
    b.connect('V:+', 'RZ:A', 'Q:C');
    b.connect('RZ:B', 'Z:K', 'Q:B');
    b.ground('Z:A', 'RL:B');
    b.connect('Q:E', 'RL:A');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'RL').voltage).toBeGreaterThan(4.6);
    expect(comp(s, 'RL').voltage).toBeLessThan(5.2);
  });

  it('fuzz: random netlists of every component type never throw and stay finite', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const types = circuitEngine.registry.map((d) => d.type);
    let nonConverged = 0;
    for (let trial = 0; trial < 40; trial++) {
      const components: CircuitComponent[] = [];
      const wires: Wire[] = [];
      const nComp = 6 + Math.floor(rnd() * 14);
      for (let i = 0; i < nComp; i++) {
        const type = i === 0 ? 'source.battery' : i === 1 ? 'misc.ground' : types[Math.floor(rnd() * types.length)];
        const c = circuitEngine.createComponent(type, { x: i * 20, y: Math.floor(rnd() * 5) * 20 });
        c.id = `c${i}`;
        c.rotation = Math.floor(rnd() * 4) as 0 | 1 | 2 | 3;
        c.mirrored = rnd() < 0.3;
        components.push(c);
      }
      // a handful of shared rails; each pin is wired to a random rail (or left open)
      const pins = components.flatMap((c) => circuitEngine.getPinPositions(c).map((p) => p.p));
      const nRails = 3 + Math.floor(rnd() * 5);
      const rails: number[] = pins.map(() => (rnd() < 0.1 ? -1 : Math.floor(rnd() * nRails)));
      const anchor = new Map<number, number>();
      pins.forEach((p, i) => {
        const r = rails[i];
        if (r < 0) return;
        const a = anchor.get(r);
        if (a === undefined) anchor.set(r, i);
        else wires.push({ id: `w${wires.length}`, points: [pins[a], { x: pins[a].x + 0.5, y: 500 + r * 7 + i * 0.01 }, { x: p.x + 0.25, y: 500 + r * 7 + i * 0.01 }, p] });
      });
      const scene: CircuitScene = { components, wires, settings: circuitEngine.defaultSettings() };
      const sim = createSimulatorWithOptions(scene, { wallBudgetMs: Infinity });
      let s = sim.getState();
      expect(() => {
        for (let k = 0; k < 20; k++) {
          s = sim.step(5e-4);
          if (k === 5) for (const c of components) sim.interact(c.id, 'toggle');
          if (k === 8) for (const c of components) sim.setExternal(c.id, 'opticalPower', 1e-3);
          if (k === 12) for (const c of components) sim.interact(c.id, { set: rnd() });
        }
      }).not.toThrow();
      expect(allFinite(s), `trial ${trial}`).toBe(true);
      expect(Object.keys(s.components).length).toBe(components.length);
      if (!s.converged) nonConverged++;
    }
    // eslint-disable-next-line no-console
    console.log(`[fuzz] ${nonConverged}/40 random circuits ended non-converged`);
    expect(nonConverged).toBeLessThanOrEqual(8);
  });
});
