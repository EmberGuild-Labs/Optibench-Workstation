import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CircuitScene, CircuitSimulator, CircuitState, ObwDocument, OpticsScene, TraceResult } from '../../src/core/types';
import { createEmptyDocument, parseDocument } from '../../src/core/project';
import {
  applySweepValue, readSweepValue, runSweep, screenCentroid, spectrumPeak, sweepCsv, sweepValues, type SweepDeps, type SweepSpec
} from '../../src/renderer/src/lib/sweep';
import { opticsEngine } from '../../src/core/optics';
import { circuitEngine } from '../../src/core/circuit';
import { CoSimulator } from '../../src/core/cosim';

function doc(): ObwDocument {
  const d = createEmptyDocument();
  d.optics.components.push({ id: 'p', type: 'prism.equilateral', position: { x: 0, y: 0 }, rotation: 0, props: { n: 1.5 } });
  d.optics.components.push({ id: 'det', type: 'detector.power', position: { x: 50, y: 0 }, rotation: 0, props: { size: 10 } });
  d.circuit.components.push({ id: 'r', type: 'passive.resistor', position: { x: 0, y: 0 }, rotation: 0, props: { resistance: 100 } });
  return d;
}

/** Fake engines: detector power = prism rotation (rad); resistor current = 1 / R. */
function fakeDeps(log: string[]): SweepDeps {
  return {
    trace(scene: OpticsScene): TraceResult {
      log.push('trace');
      const p = scene.components.find((c) => c.id === 'p')!;
      return {
        segments: [], stats: { rays: 0, segments: 0, ms: 0 },
        detectors: { det: { power: p.rotation, spectrum: [0, 1, 5, 1, 0], spectrumRange: [400, 500], profile: [0, 0, 1, 3] } }
      };
    },
    createSimulator(scene: CircuitScene): CircuitSimulator {
      log.push('sim');
      const R = scene.components.find((c) => c.id === 'r')!.props.resistance as number;
      let t = 0;
      const st = (): CircuitState => ({
        time: t, converged: true, nodeVoltages: { n1: 5 + t }, pinNets: { 'r:A': 'n1', 'r:B': 'gnd' },
        components: { r: { current: 1 / R, voltage: 1, brightness: t } }
      });
      return {
        step(dt: number) { t += dt; return st(); }, interact() {}, setExternal() {}, updateProps() {}, reset() { t = 0; }, getState: st
      };
    }
  };
}

describe('sweep values', () => {
  it('linear and log, inclusive end points', () => {
    expect(sweepValues(0, 10, 3, 'linear')).toEqual([0, 5, 10]);
    const lg = sweepValues(1, 100, 3, 'log');
    expect(lg[0]).toBeCloseTo(1); expect(lg[1]).toBeCloseTo(10); expect(lg[2]).toBeCloseTo(100);
    expect(sweepValues(0, 100, 3, 'log')).toEqual([0, 50, 100]); // log needs > 0: linear fallback
    expect(sweepValues(3, 9, 1, 'linear')).toEqual([3]);
  });
  it('applies params without mutating the source document', () => {
    const d = doc();
    const before = JSON.stringify(d);
    const a = applySweepValue(d, { domain: 'optics', id: 'p', param: '@rotation' }, 90);
    expect(a.optics.components[0].rotation).toBeCloseTo(Math.PI / 2);
    expect(readSweepValue(a, { domain: 'optics', id: 'p', param: '@rotation' })).toBeCloseTo(90);
    const b = applySweepValue(d, { domain: 'circuit', id: 'r', param: 'resistance' }, 470);
    expect(b.circuit.components[0].props.resistance).toBe(470);
    expect(b.optics).toBe(d.optics);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('runSweep with injected engines', () => {
  it('optics sweep traces once per point, no circuit sim', async () => {
    const log: string[] = [];
    const spec: SweepSpec = {
      target: { domain: 'optics', id: 'p', param: '@rotation' }, start: 0, stop: 180, steps: 5, scale: 'linear',
      outputs: [{ kind: 'detectorPower', id: 'det' }, { kind: 'spectrumPeak', id: 'det' }, { kind: 'screenCentroid', id: 'det' }], settle: 0.1
    };
    const seen: number[] = [];
    const r = await runSweep(doc(), spec, fakeDeps(log), { onPoint: (_p, done) => seen.push(done) });
    expect(log.filter((x) => x === 'trace')).toHaveLength(5);
    expect(log).not.toContain('sim');
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    r.points.forEach((p, i) => expect(p.outputs[0]).toBeCloseTo((r.values[i] * Math.PI) / 180));
    expect(r.points[0].outputs[1]).toBeCloseTo(450, 0);
    expect(r.points[0].outputs[2]!).toBeGreaterThan(0);
  });
  it('circuit sweep averages the second half of the settle window', async () => {
    const log: string[] = [];
    const spec: SweepSpec = {
      target: { domain: 'circuit', id: 'r', param: 'resistance' }, start: 10, stop: 1000, steps: 3, scale: 'log',
      outputs: [{ kind: 'componentCurrent', id: 'r' }, { kind: 'nodeVoltage', id: 'r' }, { kind: 'ledBrightness', id: 'r' }], settle: 1, samples: 10
    };
    const r = await runSweep(doc(), spec, fakeDeps(log));
    expect(log).toEqual(['sim', 'sim', 'sim']);
    expect(r.points[0].outputs[0]).toBeCloseTo(0.1);
    expect(r.points[2].outputs[0]).toBeCloseTo(0.001);
    // samples 5..9 -> t = 0.6..1.0, mean 0.8
    expect(r.points[0].outputs[2]).toBeCloseTo(0.8);
    expect(r.points[0].outputs[1]).toBeCloseTo(5.8);
  });
  it('can be cancelled and reports engine errors per point', async () => {
    const deps = fakeDeps([]);
    let n = 0;
    const spec: SweepSpec = { target: { domain: 'optics', id: 'p', param: '@x' }, start: 0, stop: 1, steps: 10, scale: 'linear', outputs: [{ kind: 'detectorPower', id: 'det' }], settle: 0 };
    const r = await runSweep(doc(), spec, deps, { onPoint: () => { n++; }, cancelled: () => n >= 3 });
    expect(r.cancelled).toBe(true);
    expect(r.points).toHaveLength(3);
    const bad: SweepDeps = { ...deps, trace: () => { throw new Error('boom'); } };
    const r2 = await runSweep(doc(), { ...spec, steps: 2 }, bad);
    expect(r2.points[0].error).toBe('boom');
    expect(r2.points[0].outputs[0]).toBeNull();
  });
  it('helpers and CSV', () => {
    expect(spectrumPeak({ power: 1, spectrum: [0, 0, 0] })).toBeNull();
    expect(screenCentroid({ power: 1, profile: [1, 1] }, 10)).toBeCloseTo(0);
    const csv = sweepCsv('R (Ω)', ['I, A'], [{ index: 0, value: 1, outputs: [2] }, { index: 1, value: 2, outputs: [null] }]);
    expect(csv).toBe('R (Ω),"I, A"\r\n1,2\r\n2,\r\n');
  });
});

describe('runSweep with the real engines', () => {
  const deps: SweepDeps = {
    trace: (s) => opticsEngine.trace(s),
    createSimulator: (s) => circuitEngine.createSimulator(s),
    createCoSim: (d) => new CoSimulator(d, opticsEngine, circuitEngine, { opticsInterval: 0 })
  };
  it('prism rotation changes the spectrometer reading (example 01)', async () => {
    const { doc: d } = parseDocument(readFileSync('examples/01-prism-rainbow.obw', 'utf8'));
    const r = await runSweep(d, {
      target: { domain: 'optics', id: 'prism', param: '@rotation' }, start: 20, stop: 30, steps: 4, scale: 'linear',
      outputs: [{ kind: 'detectorPower', id: 'spec' }, { kind: 'spectrumPeak', id: 'spec' }], settle: 0
    }, deps);
    expect(r.points).toHaveLength(4);
    expect(r.points.every((p) => !p.error)).toBe(true);
    expect(r.points.some((p) => (p.outputs[0] ?? 0) > 0)).toBe(true);
  });
  it('resistor value changes LED brightness (example 05)', async () => {
    const { doc: d } = parseDocument(readFileSync('examples/05-blinking-led-555.obw', 'utf8'));
    const r = await runSweep(d, {
      target: { domain: 'circuit', id: 'r2', param: 'resistance' }, start: 100, stop: 10000, steps: 3, scale: 'log',
      outputs: [{ kind: 'ledBrightness', id: 'led' }, { kind: 'componentCurrent', id: 'led' }], settle: 1, samples: 40
    }, deps);
    const b = r.points.map((p) => p.outputs[0] ?? 0);
    expect(b[0]).toBeGreaterThan(b[2]);
  }, 60000);
  it('co-simulates linked documents (example 08)', async () => {
    const { doc: d } = parseDocument(readFileSync('examples/08-optical-link.obw', 'utf8'));
    const r = await runSweep(d, {
      target: { domain: 'circuit', id: 'r1', param: 'resistance' }, start: 50, stop: 400, steps: 2, scale: 'linear',
      outputs: [{ kind: 'detectorPower', id: 'pd' }, { kind: 'nodeVoltage', id: 'rt', pin: 'A' }], settle: 0.2, samples: 20
    }, deps);
    expect(r.points.every((p) => !p.error)).toBe(true);
    expect(r.points[0].outputs[0]).not.toBeNull();
  }, 60000);
});
