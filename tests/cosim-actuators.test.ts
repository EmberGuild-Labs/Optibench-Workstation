/**
 * Co-simulation: rotation actuators (servo → mirror), link.source selection, time-dependent optics.
 * (Lives next to tests/cosim.test.ts; the servo test runs against the real optics engine.)
 */
import { describe, expect, it } from 'vitest';
import { CoSimulator } from '../src/core/cosim';
import { circuitEngine, createSimulatorWithOptions } from '../src/core/circuit';
import { opticsEngine } from '../src/core/optics';
import type {
  CircuitEngineAPI, CircuitScene, ObwDocument, OpticalComponent, OpticsDrive, OpticsEngineAPI, OpticsScene, OptoLink, TraceResult,
} from '../src/core/types';
import { Bench } from './circuit/helpers';

const offline: CircuitEngineAPI = { ...circuitEngine, createSimulator: (s) => createSimulatorWithOptions(s, { wallBudgetMs: Infinity }) };

function doc(circuit: CircuitScene, optics: OpticalComponent[], links: OptoLink[]): ObwDocument {
  return {
    format: 'optibench-workstation', version: 1,
    meta: { title: 't', created: '', modified: '', appVersion: '0.1.0-alpha', dimension: '2d' },
    optics: { components: optics, settings: opticsEngine.defaultSettings() },
    circuit, links,
  };
}

/** Servo in DC-control mode swept by a triangle from the function generator. */
function servoCircuit(freq = 2): Bench {
  const b = new Bench();
  b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.05, capacity: 1e6 });
  b.ground('V:-');
  b.add('source.function_gen', 'FG', { waveform: 'triangle', frequency: freq, amplitude: 2.5, offset: 2.5, outputResistance: 50 });
  b.ground('FG:-');
  b.add('misc.servo', 'SV', { mode: 'dc', speed: 5000, initialAngle: 0 });
  b.connect('V:+', 'SV:V+');
  b.ground('SV:GND');
  b.connect('FG:+', 'SV:SIG');
  return b;
}

function mockOptics(extra: Partial<OpticsEngineAPI> & Record<string, unknown> = {}) {
  const calls: { scene: OpticsScene; drive: OpticsDrive | undefined }[] = [];
  const api = {
    registry: [], materials: [],
    defaultSettings: opticsEngine.defaultSettings,
    createComponent: (type: string, position: { x: number; y: number }) => ({ id: 'x', type, position, rotation: 0, props: {} }),
    getGeometry: () => ({ paths: [], bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } }),
    wavelengthToRGB: () => [1, 1, 1] as [number, number, number],
    trace(scene: OpticsScene, drive?: OpticsDrive): TraceResult {
      calls.push({ scene, drive: drive ? JSON.parse(JSON.stringify(drive)) : undefined });
      return { segments: [], detectors: { det: { power: 1e-3 } }, stats: { rays: 1, segments: 0, ms: 0 } };
    },
    ...extra,
  } as OpticsEngineAPI;
  return { api, calls };
}

describe('CoSimulator rotation actuators', () => {
  it('servo + function generator rotates a mirror: the beam hits the detector only at some angles', () => {
    const optics: OpticalComponent[] = [
      { ...opticsEngine.createComponent('source.laser', { x: -100, y: 0 }), id: 'laser', rotation: 0 },
      { ...opticsEngine.createComponent('mirror.flat', { x: 0, y: 0 }), id: 'mirror', rotation: 0.3 },
      { ...opticsEngine.createComponent('detector.power', { x: 0, y: -100 }), id: 'det', rotation: -Math.PI / 2 }, // sensitive face towards +y
    ];
    optics[0].props = { ...optics[0].props, power: 0.005, divergence: 0 };
    optics[2].props = { ...optics[2].props, size: 10 };
    // mirror angle = 27° … 63° while the servo sweeps 0 … 180°
    const d = doc(servoCircuit(2).scene(), optics, [
      { id: 'rot', kind: 'actuator', circuitId: 'SV', opticsId: 'mirror', targetProp: 'rotation', gain: 0.2, offset: 27 },
    ]);
    const frozen = JSON.stringify(d);
    let now = 0;
    const co = new CoSimulator(d, opticsEngine, offline, { now: () => now });
    let hits = 0, misses = 0, traces = 0;
    const seen: number[] = [];
    for (let i = 0; i < 300; i++) {
      now += 2;
      const r = co.tick(2e-3);
      if (r.trace) traces++;
      const sv = r.circuit.components.SV;
      const rot = r.rotations.mirror;
      expect(Math.abs(rot - (0.2 * (sv.angleDeg as number) + 27))).toBeLessThanOrEqual(0.05 + 1e-9);
      const m = r.scene.components.find((c) => c.id === 'mirror')!;
      expect(m.rotation).toBeCloseTo((rot * Math.PI) / 180, 12);
      expect(r.drive.propOverrides).toBeUndefined(); // rotation is not a prop override
      const p = co.lastTrace!.detectors.det?.power ?? 0;
      seen.push(rot);
      if (Math.abs(rot - 45) < 0.5) { expect(p).toBeGreaterThan(0.004); hits++; }
      if (Math.abs(rot - 45) > 5) { expect(p).toBeLessThan(1e-6); misses++; }
    }
    expect(hits).toBeGreaterThan(3);
    expect(misses).toBeGreaterThan(100);
    expect(Math.min(...seen)).toBeLessThan(29);
    expect(Math.max(...seen)).toBeGreaterThan(61);
    expect(traces).toBeGreaterThan(200); // the mirror moves ≈ 0.29° per tick
    // the document is never mutated; the driven scene is a copy that shares the untouched components
    expect(JSON.stringify(d)).toBe(frozen);
    expect(co.scene).not.toBe(d.optics);
    expect(co.scene.components.find((c) => c.id === 'laser')).toBe(d.optics.components[0]);
    expect(co.scene.components.find((c) => c.id === 'mirror')).not.toBe(d.optics.components[1]);
  });

  it('re-traces only when the rotation moved by more than 0.05°', () => {
    const { api, calls } = mockOptics();
    const b = servoCircuit(0.01); // very slow sweep: 3.6°/s at the servo
    const d = doc(b.scene(), [{ id: 'm', type: 'mirror.flat', position: { x: 0, y: 0 }, rotation: 1, props: {} }], [
      { id: 'rot', kind: 'actuator', circuitId: 'SV', opticsId: 'm', targetProp: 'rotation', gain: 1, offset: 10 },
    ]);
    let now = 0;
    const co = new CoSimulator(d, api, offline, { now: () => now, opticsInterval: 1e9 });
    let r = co.tick(1e-3);
    expect(calls.length).toBe(1);
    const n = 500; // 0.5 s → the mirror turns 1.8°
    for (let i = 0; i < n; i++) { now += 1; r = co.tick(1e-3); }
    const turned = (r.circuit.components.SV.angleDeg as number);
    expect(turned).toBeCloseTo(1.8, 1);
    expect(calls.length - 1).toBeGreaterThanOrEqual(Math.floor(turned / 0.06));
    expect(calls.length - 1).toBeLessThanOrEqual(Math.ceil(turned / 0.05));
    const last = calls[calls.length - 1];
    expect(last.scene.components[0].rotation).toBeCloseTo(((10 + turned) * Math.PI) / 180, 2);
    expect(Math.abs(r.rotations.m - (10 + turned))).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(d.optics.components[0].rotation).toBe(1);
  });

  it('link.source selects the circuit quantity (angle, speed, brightness, current, voltage)', () => {
    const { api } = mockOptics();
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 6, internalResistance: 0.01, capacity: 1e6 });
    b.ground('V:-');
    b.add('misc.motor', 'M', { friction: 0 });
    b.add('passive.resistor', 'R', { resistance: 200 });
    b.add('semi.led', 'L');
    b.connect('V:+', 'M:+', 'R:A');
    b.connect('R:B', 'L:A');
    b.ground('M:-', 'L:K');
    const comp = (id: string): OpticalComponent => ({ id, type: 'aperture.shutter', position: { x: 0, y: 0 }, rotation: 0, props: {} });
    const d = doc(b.scene(), [comp('a'), comp('b'), comp('c')], [
      { id: '1', kind: 'actuator', circuitId: 'M', opticsId: 'a', targetProp: 'rotation' }, // default for a motor: angle
      { id: '2', kind: 'actuator', circuitId: 'M', opticsId: 'b', targetProp: 'open', source: 'speed', gain: 0.001 },
      { id: '3', kind: 'actuator', circuitId: 'M', opticsId: 'b', targetProp: 'x', source: 'current', gain: 2, offset: 1 },
      { id: '4', kind: 'actuator', circuitId: 'M', opticsId: 'b', targetProp: 'y' }, // default: voltage
      { id: '5', kind: 'actuator', circuitId: 'L', opticsId: 'c', targetProp: 'open', source: 'brightness' },
      { id: '6', kind: 'actuator', circuitId: 'M', opticsId: 'c', targetProp: 'rotation', source: 'voltage', gain: 10 },
    ]);
    const co = new CoSimulator(d, api, offline);
    let r = co.tick(0.01);
    for (let i = 0; i < 20; i++) r = co.tick(0.01);
    const m = r.circuit.components.M, l = r.circuit.components.L;
    expect(m.speed as number).toBeGreaterThan(100);
    expect(r.rotations.a).toBeCloseTo(m.angleDeg as number, 6);
    expect(r.drive.propOverrides!.b.open).toBeCloseTo(0.001 * (m.speed as number), 9);
    expect(r.drive.propOverrides!.b.x).toBeCloseTo(2 * (m.current as number) + 1, 9);
    expect(r.drive.propOverrides!.b.y).toBeCloseTo(m.voltage as number, 9);
    expect(l.brightness as number).toBeGreaterThan(0.5);
    expect(r.drive.propOverrides!.c.open).toBeCloseTo(l.brightness as number, 9);
    expect(r.rotations.c).toBeCloseTo(10 * (m.voltage as number), 6);
    expect(r.drive.propOverrides!.a).toBeUndefined();
  });
});

describe('CoSimulator time-dependent optics', () => {
  it('passes simulated time and re-traces when a source envelope / chopper changes state', () => {
    // 100 Hz pulsed laser (50 % duty) and a 25 Hz chopper, reported by the optional engine helpers
    const env = (c: OpticalComponent, t: number): number => (c.id === 'pulsed' ? ((t * 100) % 1 < 0.5 ? 1 : 0) : 1);
    const chop = (c: OpticalComponent, t: number): number => (c.type === 'aperture.chopper' ? ((t * 25) % 1 < 0.5 ? 1 : 0) : 1);
    const { api, calls } = mockOptics({ sourceTemporalEnvelope: env, componentTimeTransmission: chop });
    // the mock detector sees the laser through the chopper at drive.time
    api.trace = (scene, drive) => {
      calls.push({ scene, drive: drive ? JSON.parse(JSON.stringify(drive)) : undefined });
      const t = drive?.time ?? 0;
      const src = scene.components.find((c) => c.id === 'pulsed')!, ch = scene.components.find((c) => c.id === 'chop')!;
      return { segments: [], detectors: { det: { power: 1e-3 * env(src, t) * chop(ch, t) } }, stats: { rays: 1, segments: 0, ms: 0 } };
    };
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.01, capacity: 1e6 });
    b.ground('V:-');
    b.add('opto.photodiode', 'PD', { responsivity: 0.5 });
    b.add('passive.resistor', 'RL', { resistance: 1000 });
    b.connect('V:+', 'PD:K');
    b.connect('PD:A', 'RL:A');
    b.ground('RL:B');
    const d = doc(b.scene(), [
      { id: 'pulsed', type: 'source.laser', position: { x: 0, y: 0 }, rotation: 0, props: { power: 1e-3 } },
      { id: 'chop', type: 'aperture.chopper', position: { x: 10, y: 0 }, rotation: 0, props: {} },
      { id: 'det', type: 'detector.power', position: { x: 20, y: 0 }, rotation: 0, props: {} },
    ], [{ id: 'l', kind: 'detector', circuitId: 'PD', opticsId: 'det' }]);
    let now = 0;
    const co = new CoSimulator(d, api, offline, { now: () => now, opticsInterval: 1e9 });
    const dt = 1e-3;
    let lit = 0, dark = 0, mismatched = 0;
    const N = 200; // 0.2 s
    for (let i = 0; i < N; i++) {
      now += 1;
      const r = co.tick(dt);
      const t = r.circuit.time;
      expect(r.drive.time).toBeCloseTo(t, 12);
      const expected = 1e-3 * env(d.optics.components[0], t) * chop(d.optics.components[1], t);
      if (Math.abs((co.lastTrace!.detectors.det.power) - expected) > 1e-12) mismatched++;
      if (expected > 0) lit++; else dark++;
    }
    expect(mismatched).toBe(0);
    expect(lit).toBeGreaterThan(30);
    expect(dark).toBeGreaterThan(100);
    // one trace per state change (≈ 20 laser pulses → 40 edges, fewer while the chopper is closed… at most ~45), not per tick
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.length).toBeLessThan(60);
    // the modulated light reaches the circuit photodiode
    const pd = co.simulator!.getState().components.PD;
    expect(typeof pd.opticalPower).toBe('number');
  });

  it('engines without the helpers are traced exactly as before (time is passed, nothing else changes)', () => {
    const { api, calls } = mockOptics();
    const empty: CircuitScene = { components: [], wires: [], settings: circuitEngine.defaultSettings() };
    const co = new CoSimulator(doc(empty, [{ id: 's', type: 'source.laser', position: { x: 0, y: 0 }, rotation: 0, props: { power: 1e-3 } }], []), api, offline);
    for (let i = 0; i < 5; i++) co.tick(0.01);
    expect(calls.length).toBe(1);
    expect(calls[0].drive?.time).toBeCloseTo(0.01, 12);
    expect(co.time).toBeCloseTo(0.05, 12);
    const r = co.tick(0.01);
    expect(r.scene).toBe(co.scene);
    expect(r.rotations).toEqual({});
  });
});

describe('CoSimulator with the real optics engine helpers', () => {
  const empty: CircuitScene = { components: [], wires: [], settings: circuitEngine.defaultSettings() };
  const mk = (type: string, id: string, x: number, props: Record<string, number | string | boolean> = {}): OpticalComponent => {
    const c = opticsEngine.createComponent(type, { x, y: 0 });
    return { ...c, id, rotation: 0, props: { ...c.props, ...props } };
  };

  it('a chopper wheel gates the detector at simulated time (helpers passed as options)', async () => {
    const mod = await import('../src/core/optics');
    const temporal = { sourceTemporalEnvelope: (mod as any).sourceTemporalEnvelope, componentTimeTransmission: (mod as any).componentTimeTransmission };
    if (typeof temporal.componentTimeTransmission !== 'function' || !opticsEngine.registry.some((d) => d.type === 'chopper.wheel')) return; // engine without choppers
    const d = doc(empty, [
      mk('source.laser', 'laser', -100, { power: 0.005 }),
      mk('chopper.wheel', 'chop', 0, { frequency: 50, duty: 0.5 }),
      mk('detector.power', 'det', 100, { size: 20 }),
    ], []);
    let now = 0;
    const co = new CoSimulator(d, opticsEngine, offline, { now: () => now, temporal });
    let open = 0, closed = 0, traces = 0;
    for (let i = 0; i < 200; i++) { // 0.2 s in 1 ms ticks = 10 chopper periods
      now += 1;
      const r = co.tick(1e-3);
      if (r.trace) traces++;
      const p = co.lastTrace!.detectors.det.power;
      const expected = temporal.componentTimeTransmission(d.optics.components[1], co.time);
      if (expected > 0.5) { open++; expect(p).toBeGreaterThan(0.004); } else { closed++; expect(p).toBeLessThan(1e-6); }
    }
    expect(open).toBeGreaterThan(70);
    expect(closed).toBeGreaterThan(70);
    expect(traces).toBeGreaterThanOrEqual(19); // one per edge …
    expect(traces).toBeLessThanOrEqual(22);    // … not one per tick
  });

  it('slow pulsed lasers flash tick by tick with the right energy; fast trains stay at their average', () => {
    const env = (c: OpticalComponent, t: number): number => (c.props.mode === 'pulsed' ? ((t * (c.props.repRate as number)) % 1 < 0.01 ? 100 : 0) : 1);
    const run = (repRate: number, pulseWidth: number) => {
      const { api, calls } = mockOptics();
      const d = doc(empty, [{ id: 's', type: 'source.laser', position: { x: 0, y: 0 }, rotation: 0, props: { power: 1e-3, mode: 'pulsed', repRate, pulseWidth } }], []);
      let now = 0;
      const co = new CoSimulator(d, api, offline, { now: () => now, temporal: { sourceTemporalEnvelope: env } });
      const scales: number[] = [];
      for (let i = 0; i < 1000; i++) { now += 1; scales.push(co.tick(1e-3).drive.sourceScale?.s ?? 1); }
      return { scales, calls };
    };
    // 10 Hz, 1 µs pulses, 1 ms ticks: one tick in 100 carries the whole pulse energy (scale 100), the rest are dark
    let r = run(10, 1e-6);
    expect(r.scales.filter((x) => x > 0).length).toBe(10);
    expect(Math.max(...r.scales)).toBeCloseTo(100, 6);
    expect(r.scales.reduce((a, v) => a + v, 0) / r.scales.length).toBeCloseTo(1, 6); // average power preserved
    expect(r.calls.length).toBeLessThanOrEqual(21);
    // 100 MHz mode-locked train: far above the tick rate → average power, traced once
    r = run(1e8, 1e-10);
    expect(r.scales.every((x) => x === 1)).toBe(true);
    expect(r.calls.length).toBe(1);
    // long pulses (20 ms at 10 Hz… here the mock envelope is 1 % duty): sampled envelope, still energy-conserving on average
    r = run(10, 5e-3);
    expect(r.scales.some((x) => x > 1)).toBe(true);
  });
});
