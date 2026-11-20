import { describe, expect, it } from 'vitest';
import { CoSimulator, driveChange } from '../src/core/cosim';
import { circuitEngine } from '../src/core/circuit';
import type {
  CircuitScene, ObwDocument, OpticalComponent, OpticsDrive, OpticsEngineAPI, OpticsScene, OptoLink, TraceResult,
} from '../src/core/types';
import { Bench } from './circuit/helpers';

/**
 * Fake optics engine: every `source.*` emits props.power × sourceScale; the detector 'det' receives
 * a fixed fraction (the Faraday rotator 'far' attenuates by cos²(bField·10) to exercise actuators).
 */
function mockOptics(coupling = 0.5) {
  const calls: { scene: OpticsScene; drive: OpticsDrive | undefined }[] = [];
  const api: OpticsEngineAPI = {
    registry: [],
    materials: [],
    defaultSettings: () => ({ maxBounces: 64, minIntensity: 1e-4, ambientMedium: 'air', raysPerSource: 16, temperatureC: 20, spectralSamples: 24 }),
    createComponent: (type, position) => ({ id: 'x', type, position, rotation: 0, props: {} }),
    getGeometry: () => ({ paths: [], bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } }),
    wavelengthToRGB: () => [1, 1, 1],
    trace(scene, drive): TraceResult {
      calls.push({ scene, drive: drive ? JSON.parse(JSON.stringify(drive)) : undefined });
      let p = 0;
      for (const c of scene.components) {
        if (c.type.startsWith('source.')) p += (c.props.power as number) * (drive?.sourceScale?.[c.id] ?? 1);
      }
      const far = scene.components.find((c) => c.id === 'far');
      if (far) {
        const B = drive?.propOverrides?.far?.bField ?? (far.props.bField as number) ?? 0;
        p *= Math.cos(B * 10) ** 2;
      }
      return { segments: [], detectors: { det: { power: p * coupling } }, stats: { rays: 1, segments: 0, ms: 0 } };
    },
  };
  return { api, calls };
}

const oc = (id: string, type: string, props: Record<string, number> = {}): OpticalComponent => ({ id, type, position: { x: 0, y: 0 }, rotation: 0, props });

function doc(circuit: CircuitScene, optics: OpticalComponent[], links: OptoLink[]): ObwDocument {
  return {
    format: 'optibench-workstation', version: 1,
    meta: { title: 't', created: '', modified: '', appVersion: '0.1.0-alpha', dimension: '2d' },
    optics: { components: optics, settings: { maxBounces: 64, minIntensity: 1e-4, ambientMedium: 'air', raysPerSource: 16, temperatureC: 20, spectralSamples: 24 } },
    circuit, links,
  };
}

/** Laser diode driven through a switch; photodiode + load resistor on the receiving side. */
function loopCircuit(): Bench {
  const b = new Bench();
  b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.01, capacity: 1e5 });
  b.ground('V:-');
  b.add('switch.spst', 'S', { closed: false });
  b.add('passive.resistor', 'R', { resistance: 56 });
  b.add('opto.laser_diode', 'LD', { threshold: 0.02, slope: 0.8 });
  b.connect('V:+', 'S:A');
  b.connect('S:B', 'R:A');
  b.connect('R:B', 'LD:A');
  b.ground('LD:K');
  b.add('opto.photodiode', 'PD', { responsivity: 0.5 });
  b.add('passive.resistor', 'RL', { resistance: 100 });
  b.connect('V:+', 'PD:K');
  b.connect('PD:A', 'RL:A');
  b.ground('RL:B');
  return b;
}

describe('CoSimulator', () => {
  it('closes the emitter → optics → detector loop', () => {
    const { api, calls } = mockOptics(0.5);
    const d = doc(loopCircuit().scene(), [oc('src', 'source.laser', { power: 0.005 }), oc('det', 'detector.photodiode')], [
      { id: 'l1', kind: 'emitter', circuitId: 'LD', opticsId: 'src' },
      { id: 'l2', kind: 'detector', circuitId: 'PD', opticsId: 'det' },
    ]);
    let now = 0;
    const co = new CoSimulator(d, api, circuitEngine, { opticsInterval: 100, now: () => now });

    // laser off: source scaled to zero, photodiode dark
    let r = co.tick(1e-3);
    expect(r.trace).not.toBeNull();
    expect(calls.length).toBe(1);
    expect(r.drive.sourceScale?.src).toBe(0);
    for (let i = 0; i < 5; i++) { now += 16; r = co.tick(1e-3); }
    expect(calls.length).toBe(1); // nothing changed -> no re-trace
    expect(r.trace).toBeNull();
    expect(co.lastTrace).not.toBeNull();
    expect(Math.abs(r.circuit.components.RL.voltage as number)).toBeLessThan(1e-5);

    // switch on: laser emits, optics re-traced, detector power fed back to the photodiode
    co.interact('S', 'toggle');
    now += 16;
    r = co.tick(1e-3);
    const ld = r.circuit.components.LD;
    const pOpt = ld.opticalPower as number;
    expect(pOpt).toBeGreaterThan(0.005);
    expect(pOpt).toBeCloseTo(0.8 * ((ld.current as number) - 0.02), 9);
    expect(r.drive.sourceScale?.src).toBeCloseTo(pOpt / 0.005, 9);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.detectors.det.power).toBeCloseTo(0.5 * pOpt, 9);
    now += 16;
    r = co.tick(1e-3); // the photocurrent appears on the next circuit step
    const pd = r.circuit.components.PD;
    expect(pd.opticalPower as number).toBeCloseTo(0.5 * pOpt, 6);
    expect(-(pd.current as number)).toBeCloseTo(0.5 * 0.5 * pOpt, 5);
    expect(r.circuit.components.RL.voltage as number).toBeCloseTo(100 * 0.25 * pOpt, 4);
    const traced = calls.length;
    for (let i = 0; i < 5; i++) { now += 16; r = co.tick(1e-3); }
    expect(calls.length).toBe(traced); // steady state: no more traces

    // switch off again: detector goes dark
    co.interact('S', 'toggle');
    for (let i = 0; i < 3; i++) { now += 16; r = co.tick(1e-3); }
    expect(r.drive.sourceScale?.src).toBe(0);
    expect(r.circuit.components.PD.opticalPower).toBe(0);
    expect(Math.abs(r.circuit.components.RL.voltage as number)).toBeLessThan(1e-5);
  });

  it('re-traces small drifts only every opticsInterval, big changes immediately', () => {
    const { api, calls } = mockOptics();
    const b = new Bench();
    b.add('source.function_gen', 'F', { waveform: 'sine', frequency: 50, amplitude: 0.0005, offset: 4, outputResistance: 50 });
    b.ground('F:-');
    b.add('opto.laser_diode', 'LD');
    b.connect('F:+', 'LD:A');
    b.ground('LD:K');
    const d = doc(b.scene(), [oc('src', 'source.laser', { power: 0.001 })], [{ id: 'l1', kind: 'emitter', circuitId: 'LD', opticsId: 'src' }]);
    let now = 0;
    const co = new CoSimulator(d, api, circuitEngine, { opticsInterval: 100, now: () => now });
    co.tick(1e-3);
    expect(calls.length).toBe(1);
    // tiny drift (≪ 0.5 %) per tick: traced at most once per 100 ms
    for (let i = 0; i < 12; i++) { now += 10; co.tick(2e-4); }
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(3);
    // large change -> immediate
    const before = calls.length;
    co.updateCircuitProps('F', { offset: 4.5 });
    now += 1;
    co.tick(1e-3);
    expect(calls.length).toBe(before + 1);
  });

  it('actuator links map coil current to an optical prop with gain and offset', () => {
    const { api, calls } = mockOptics(1);
    const b = new Bench();
    b.add('source.battery', 'V', { voltage: 8, internalResistance: 0.01, capacity: 1e5 });
    b.ground('V:-');
    b.add('opto.coil', 'EM', { inductance: 0.001, resistance: 7.99 });
    b.add('passive.resistor', 'RV', { resistance: 1000 });
    b.connect('V:+', 'EM:A', 'RV:A');
    b.ground('EM:B', 'RV:B');
    const d = doc(b.scene(), [oc('src', 'source.laser', { power: 0.001 }), oc('far', 'magneto.faraday', { bField: 0 }), oc('det', 'detector.power')], [
      { id: 'a1', kind: 'actuator', circuitId: 'EM', opticsId: 'far', targetProp: 'bField', gain: 0.05, offset: 0.001 },
      { id: 'a2', kind: 'actuator', circuitId: 'RV', opticsId: 'far', targetProp: 'angle', gain: 2 },
    ]);
    const co = new CoSimulator(d, api, circuitEngine);
    let r = co.tick(1e-3);
    for (let i = 0; i < 20; i++) r = co.tick(1e-3);
    expect(r.circuit.components.EM.current as number).toBeCloseTo(1, 2);
    expect(r.drive.propOverrides?.far.bField).toBeCloseTo(0.05 * 1 + 0.001, 3); // current-driven
    expect(r.drive.propOverrides?.far.angle).toBeCloseTo(2 * 8, 1); // voltage-driven
    expect(r.drive.sourceScale).toBeUndefined();
    const last = calls[calls.length - 1];
    expect(last.drive?.propOverrides?.far.bField).toBeCloseTo(0.051, 3);
    expect(co.lastTrace!.detectors.det.power).toBeCloseTo(0.001 * Math.cos(0.51) ** 2, 5);
  });

  it('works for pure-optics and pure-circuit documents, and survives engine errors', () => {
    // pure optics: traced once, re-traced only when the scene is replaced
    const m1 = mockOptics();
    const empty: CircuitScene = { components: [], wires: [], settings: circuitEngine.defaultSettings() };
    const co1 = new CoSimulator(doc(empty, [oc('src', 'source.laser', { power: 0.002 }), oc('det', 'detector.power')], []), m1.api, circuitEngine);
    let r = co1.tick(1 / 60);
    expect(r.trace!.detectors.det.power).toBeCloseTo(0.001, 9);
    expect(r.circuit.converged).toBe(true);
    co1.tick(1 / 60);
    co1.tick(1 / 60);
    expect(m1.calls.length).toBe(1);
    co1.setOpticsScene({ ...co1['opticsScene' as keyof CoSimulator] as unknown as OpticsScene, components: [oc('src', 'source.laser', { power: 0.004 }), oc('det', 'detector.power')] });
    r = co1.tick(1 / 60);
    expect(m1.calls.length).toBe(2);
    expect(r.trace!.detectors.det.power).toBeCloseTo(0.002, 9);

    // pure circuit: optics never traced
    const m2 = mockOptics();
    const co2 = new CoSimulator(doc(loopCircuit().scene(), [], []), m2.api, circuitEngine);
    r = co2.tick(1e-3);
    expect(r.trace).toBeNull();
    expect(m2.calls.length).toBe(0);
    expect(r.circuit.time).toBeCloseTo(1e-3, 9);
    co2.reset();
    expect(co2.tick(0).circuit.time).toBe(0);

    // optics engine throwing must not break the tick
    const m3 = mockOptics();
    m3.api.trace = () => { throw new Error('boom'); };
    const co3 = new CoSimulator(doc(loopCircuit().scene(), [oc('src', 'source.laser', { power: 0.001 })], [{ id: 'l', kind: 'emitter', circuitId: 'LD', opticsId: 'src' }]), m3.api, circuitEngine);
    expect(() => co3.tick(1e-3)).not.toThrow();
    expect(co3.error).toMatch(/boom/);

    // rebuild swaps in a new document
    co2.rebuild(doc(empty, [oc('src', 'source.laser', { power: 0.002 }), oc('det', 'detector.power')], []));
    expect(co2.tick(1 / 60).trace).not.toBeNull();
  });

  it('driveChange measures relative differences', () => {
    expect(driveChange({}, {})).toBe(0);
    expect(driveChange({ sourceScale: { a: 1 } }, { sourceScale: { a: 1.004 } })).toBeLessThan(0.005);
    expect(driveChange({ sourceScale: { a: 1 } }, { sourceScale: { a: 1.01 } })).toBeGreaterThan(0.005);
    expect(driveChange({ sourceScale: { a: 0 } }, {})).toBe(1);
    expect(driveChange({ propOverrides: { f: { b: 0.1 } } }, { propOverrides: { f: { b: 0.1 } } })).toBe(0);
    expect(driveChange({ propOverrides: { f: { b: 0.1 } } }, { propOverrides: { f: { b: 0.2 } } })).toBeCloseTo(0.5, 9);
    expect(driveChange({}, { propOverrides: { f: { b: 0 } } })).toBe(1);
  });
});
