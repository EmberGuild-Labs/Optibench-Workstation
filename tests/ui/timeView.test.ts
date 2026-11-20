import { describe, expect, it } from 'vitest';
import {
  benchTimeOfFlight, clipToWindow, computeTimeView, formatSimTime, formatTimeScale, parseTimeScale, pulsedSources, segmentWindows,
  TIME_SCALE_PRESETS
} from '../../src/renderer/src/lib/timeView';
import type { OpticalComponent } from '../../src/core/types';

const close = (a: number | null, b: number): void => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b) / b).toBeLessThan(1e-9);
};

describe('parseTimeScale', () => {
  it('accepts realtime words', () => {
    for (const s of ['realtime', 'Realtime', 'real time', 'REAL-TIME', 'rt', 'live', '1:1']) expect(parseTimeScale(s)).toBe(1);
  });
  it('parses duration per second', () => {
    close(parseTimeScale('1 ns/s'), 1e-9);
    close(parseTimeScale('100 ps/s'), 1e-10);
    close(parseTimeScale('10ps/s'), 1e-11);
    close(parseTimeScale('1 µs/s'), 1e-6);
    close(parseTimeScale('1 μs/s'), 1e-6);
    close(parseTimeScale('1 us / s'), 1e-6);
    close(parseTimeScale('1 ms/s'), 1e-3);
    close(parseTimeScale('2.5 ns per s'), 2.5e-9);
    close(parseTimeScale('1 ns/sec'), 1e-9);
    close(parseTimeScale('1 ns / second'), 1e-9);
    close(parseTimeScale('ns/s'), 1e-9);
    close(parseTimeScale('1 ns/ms'), 1e-6);
    close(parseTimeScale('1 s/s'), 1);
    close(parseTimeScale('1 min/s'), 60);
  });
  it('parses ratios and factors', () => {
    close(parseTimeScale('1/1e9'), 1e-9);
    close(parseTimeScale('1 / 1000'), 1e-3);
    close(parseTimeScale('1:1e6'), 1e-6);
    close(parseTimeScale('1e-9'), 1e-9);
    close(parseTimeScale('0.5'), 0.5);
    close(parseTimeScale('2x'), 2);
    close(parseTimeScale('0.25×'), 0.25);
    close(parseTimeScale('×10'), 10);
  });
  it('rejects garbage and non-positive values', () => {
    for (const s of ['', 'fast', '0', '-1', '1/0', 'ns', '1 nm/s', '1 ns/kg', 'abc/s', 'NaN']) expect(parseTimeScale(s), s).toBeNull();
  });
  it('clamps the range', () => {
    expect(parseTimeScale('1e-30')).toBe(1e-15);
    expect(parseTimeScale('1e9')).toBe(1e3);
  });
  it('round-trips the presets through the formatter', () => {
    for (const p of TIME_SCALE_PRESETS) {
      expect(parseTimeScale(p.label)).toBeCloseTo(p.value, 20);
      expect(parseTimeScale(formatTimeScale(p.value))).toBeCloseTo(p.value, 20);
    }
  });
});

describe('formatting', () => {
  it('formats time scales and simulated time', () => {
    expect(formatTimeScale(1)).toBe('Realtime');
    expect(formatTimeScale(1e-9)).toBe('1 ns/s');
    expect(formatTimeScale(1e-10)).toBe('100 ps/s');
    expect(formatTimeScale(1e-6)).toBe('1 µs/s');
    expect(formatTimeScale(2)).toBe('2×');
    expect(formatSimTime(1.234e-9)).toBe('t = 1.234 ns');
    expect(formatSimTime(0)).toBe('t = 0 s');
  });
});

describe('pulse window math', () => {
  it('clips a segment to the window', () => {
    // segment flown from t=1 ns to 3 ns; window [1.5, 2] ns
    const c = clipToWindow(1e-9, 3e-9, 2e-9, 0.5e-9)!;
    expect(c[0]).toBeCloseTo(0.25, 12);
    expect(c[1]).toBeCloseTo(0.5, 12);
    expect(clipToWindow(1e-9, 3e-9, 0.5e-9, 0.2e-9)).toBeNull(); // not reached yet
    expect(clipToWindow(1e-9, 3e-9, 5e-9, 1e-9)).toBeNull();     // already passed
    expect(clipToWindow(1e-9, 3e-9, 2e-9, Infinity)).toEqual([0, expect.closeTo(0.5, 12)]); // CW front
    expect(clipToWindow(1e-9, 3e-9, 10e-9, Infinity)).toEqual([0, 1]);
    expect(clipToWindow(NaN, 3e-9, 2e-9, 1e-9)).toBeNull();
  });
  it('front interpolates linearly along a segment', () => {
    for (let k = 1; k < 10; k++) {
      const f = k / 10;
      const c = clipToWindow(0, 1e-9, f * 1e-9, Infinity)!;
      expect(c[1]).toBeCloseTo(f, 12);
    }
  });
  it('repeats windows for periodic pulses', () => {
    // segment 0..10 ns, pulses every 2 ns, width 0.2 ns, newest front at 0.5 ns
    const w = segmentWindows(0, 10e-9, { front: 0.5e-9, width: 0.2e-9, period: 2e-9 });
    expect(w.length).toBe(5); // fronts at 0.5, 2.5, 4.5, 6.5, 8.5 ns
    for (let k = 0; k < w.length; k++) {
      expect(w[k][1]).toBeCloseTo((0.5 + 2 * k) / 10, 9);
      expect(w[k][1] - w[k][0]).toBeCloseTo(0.02, 9);
    }
    // a short segment later on the bench sees exactly one pulse
    const one = segmentWindows(6.4e-9, 6.6e-9, { front: 0.5e-9, width: 0.2e-9, period: 2e-9 });
    expect(one.length).toBe(1);
    expect(one[0][1]).toBeCloseTo(0.5, 9);
    // non-periodic falls back to a single window
    expect(segmentWindows(0, 1e-9, { front: 0.5e-9, width: Infinity, period: 0 })[0][1]).toBeCloseTo(0.5, 12);
  });
  it('caps the number of copies', () => {
    expect(segmentWindows(0, 1, { front: 0, width: 1e-12, period: 1e-9 }).length).toBeLessThanOrEqual(48);
  });
});

const laser = (props: Record<string, number | string>): OpticalComponent => ({ id: 'L', type: 'source.laser', position: { x: 0, y: 0 }, rotation: 0, props });

describe('computeTimeView', () => {
  const base = { simTime: 1e-9, timeScale: 1e-9, status: 'running' as const, maxT: 3e-9 };
  it('is steady in edit mode or at realtime', () => {
    expect(computeTimeView({ ...base, components: [laser({})], status: 'stopped' }).mode).toBe('steady');
    expect(computeTimeView({ ...base, components: [laser({})], timeScale: 1 }).mode).toBe('steady');
    expect(computeTimeView({ ...base, components: [laser({})], maxT: 0 }).mode).toBe('steady');
  });
  it('shows a CW front at slow motion, then the steady beam', () => {
    const v = computeTimeView({ ...base, components: [laser({ mode: 'cw' })] });
    expect(v.mode).toBe('pulse');
    expect(v.t).toBe(1e-9);
    expect(v.pulseWidth).toBe(Infinity);
    expect(computeTimeView({ ...base, simTime: 10e-9, components: [laser({ mode: 'cw' })] }).mode).toBe('steady');
    // paused keeps the frozen front
    expect(computeTimeView({ ...base, status: 'paused', components: [laser({ mode: 'cw' })] }).mode).toBe('pulse');
  });
  it('repeats pulses of a pulsed laser', () => {
    const comps = [laser({ mode: 'pulsed', repRate: 5e8, pulseWidth: 5e-11 })];
    expect(pulsedSources(comps)).toEqual([{ id: 'L', repRate: 5e8, pulseWidth: 5e-11 }]);
    const v = computeTimeView({ ...base, simTime: 2.3e-9, components: comps });
    expect(v.mode).toBe('pulse');
    expect(v.period).toBeCloseTo(2e-9, 20);
    // visual minimum: 4 % of the bench time of flight (> 50 ps physical width)
    expect(v.pulseWidth).toBeCloseTo(0.04 * 3e-9, 20);
    // newest pulse centred at 2 ns -> front 0.3 ns + width / 2
    expect(v.t).toBeCloseTo(0.3e-9 + v.pulseWidth / 2, 18);
    // a fast train at a moderate slow-down strobes: steady instead
    expect(computeTimeView({ ...base, timeScale: 1e-6, components: comps }).mode).toBe('steady');
  });
  it('bench time of flight uses the last interaction', () => {
    expect(benchTimeOfFlight([{ t0: 0, t1: 1e-9 }, { t0: 1e-9, t1: 9e-9 }])).toBe(1e-9);
    expect(benchTimeOfFlight([{ t0: 0, t1: 2e-9 }])).toBe(2e-9);
    expect(benchTimeOfFlight([])).toBe(0);
  });
});

import { buildLightData, RAY_STRIDE } from '../../src/renderer/src/viewports/optics/lightData';
import { opticsEngine } from '../../src/core/optics';
import { parseDocument } from '../../src/core/project';
import { readFileSync } from 'node:fs';

describe('2D pulse rendering (lightData windowing)', () => {
  const doc = parseDocument(readFileSync('examples/16-pulsed-laser-slowmo.obw', 'utf8')).doc;
  const tr = opticsEngine.trace(doc.optics);
  const geom = (c: OpticalComponent) => opticsEngine.getGeometry(c);
  it('steady mode draws every segment, pulse mode only the lit pieces', () => {
    const steady = buildLightData(tr, opticsEngine, doc.optics.components, geom);
    const n = steady.rayCount;
    expect(n).toBeGreaterThan(5);
    const maxT = benchTimeOfFlight(tr.segments);
    const v = computeTimeView({ components: doc.optics.components, simTime: 1.5e-9, timeScale: 1e-9, status: 'running', maxT });
    expect(v.mode).toBe('pulse');
    const lit = buildLightData(tr, opticsEngine, doc.optics.components, geom, { front: v.t, width: v.pulseWidth, period: v.period });
    expect(lit.rayCount).toBeGreaterThan(0);
    // every emitted piece lies on its segment and is no longer than the window allows
    const c = 299792458e3; // mm/s
    for (let k = 0; k < lit.rayCount; k++) {
      const o = k * RAY_STRIDE;
      const len = Math.hypot(lit.rays[o + 2] - lit.rays[o], lit.rays[o + 3] - lit.rays[o + 1]);
      expect(len).toBeLessThanOrEqual(v.pulseWidth * c * 1.0001 + 1e-6);
    }
    // nothing is lit before the light left the laser
    const none = buildLightData(tr, opticsEngine, doc.optics.components, geom, { front: -1e-9, width: 1e-10, period: 0 });
    expect(none.rayCount).toBe(0);
    // a CW front at time t lights exactly the path flown up to t
    const t = 0.5e-9;
    const front = buildLightData(tr, opticsEngine, doc.optics.components, geom, { front: t, width: Infinity, period: 0 });
    let total = 0;
    for (let k = 0; k < front.rayCount; k++) { const o = k * RAY_STRIDE; total += Math.hypot(front.rays[o + 2] - front.rays[o], front.rays[o + 3] - front.rays[o + 1]); }
    expect(total).toBeGreaterThan(0);
    expect(steady.rayCount).toBe(n); // the steady buffers are unaffected by windowing
  });
});
