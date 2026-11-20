/** The wave-optics / time-of-flight / beam-steering example projects behave as their descriptions say. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/core/project';
import { sourceTemporalEnvelope, trace } from '../../src/core/optics';
import { simulateDocument, validateDocument } from '../../scripts/obw-cli';

const DIR = join(__dirname, '..', '..', 'examples');
const load = (name: string) => {
  const { doc, warnings } = parseDocument(readFileSync(join(DIR, name), 'utf8'));
  expect(warnings).toEqual([]);
  const rep = validateDocument(doc);
  expect(rep.errors).toEqual([]);
  expect(rep.warnings).toEqual([]);
  return doc;
};
function peaks(p: number[], frac: number): number[] {
  const mx = Math.max(...p), out: number[] = [];
  for (let i = 1; i < p.length - 1; i++) if (p[i] > p[i - 1] && p[i] >= p[i + 1] && p[i] > frac * mx) out.push(i);
  return out;
}

describe('wave / phase-2 example projects', () => {
  it('11 double slit: waveMode survives parse + serialize; fringe spacing, sinc minimum, five-slit sharpening; < 60 ms', () => {
    const doc = load('11-double-slit.obw');
    expect(doc.optics.settings.waveMode).toBe(true);
    expect(parseDocument(serializeDocument(doc)).doc.optics.settings.waveMode).toBe(true);
    trace(doc.optics);
    const t0 = performance.now();
    const r = trace(doc.optics);
    expect(performance.now() - t0).toBeLessThan(60);
    const mmPerBin = 40 / 1024;
    // Young: dark fringes every lambda L / d = 632.8e-6 * 500 / 0.25 = 1.2656 mm
    const p = r.detectors.screen.profile!;
    const inv = p.map((v) => -v);
    const mid = peaks(p, 0.5);
    const dark: number[] = [];
    for (let i = mid[0]; i < mid[mid.length - 1]; i++) if (inv[i] > inv[i - 1] && inv[i] >= inv[i + 1]) dark.push(i);
    expect(dark.length).toBe(mid.length - 1);
    expect((((dark[dark.length - 1] - dark[0]) / (dark.length - 1)) * mmPerBin) / 1.2656).toBeCloseTo(1, 1);
    expect(Math.abs(((dark[dark.length - 1] - dark[0]) / (dark.length - 1)) * mmPerBin - 1.2656)).toBeLessThan(0.02);
    // single slit on the camera: first minimum 3.164 mm from the centre
    const c = r.detectors.camera.profile!;
    expect(c.length).toBe(1024);
    let iMin = 512 + 40;
    for (let i = iMin; i < 512 + 120; i++) if (c[i] < c[iMin]) iMin = i;
    expect(Math.abs((iMin + 0.5 - 512) * 0.04 - 3.164)).toBeLessThan(0.08);
    expect(r.detectors.camera.profileRGB!.length).toBe(3072);
    // five slits 0.1 mm apart: principal maxima 3.164 mm apart, FWHM ~ 0.886 / 5 of the spacing, 3 subsidiary maxima between
    const q = r.detectors.screen5.profile!;
    const main = peaks(q, 0.5);
    expect(main.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(((main[main.length - 1] - main[0]) / (main.length - 1)) * mmPerBin - 3.164)).toBeLessThan(0.06);
    const i0 = q.indexOf(Math.max(...q));
    let a = i0, b = i0;
    while (q[a] > q[i0] / 2) a--;
    while (q[b] > q[i0] / 2) b++;
    expect((b - a) * mmPerBin).toBeLessThan(0.3 * 3.164);
    expect((b - a) * mmPerBin).toBeGreaterThan(0.12 * 3.164);
    const c0 = main[Math.floor(main.length / 2)], c1 = main[Math.floor(main.length / 2) + 1] ?? main[Math.floor(main.length / 2) - 1];
    const sub = peaks(q, 0.005).filter((i) => i > Math.min(c0, c1) + 2 && i < Math.max(c0, c1) - 2);
    expect(sub.length).toBe(3);
  });

  it('12 Michelson: tilt fringes lambda / (2 alpha) on the camera; a lambda/4 mirror step inverts them', () => {
    const doc = load('12-michelson.obw');
    const r = trace(doc.optics);
    const p = r.detectors.cam.profile!;
    const pk = peaks(p, 0.3);
    const spacing = ((pk[pk.length - 1] - pk[0]) / (pk.length - 1)) * 0.014;
    expect(Math.abs(spacing / (632.8e-6 / 0.0008) - 1)).toBeLessThan(0.03);
    const m2 = doc.optics.components.find((c) => c.id === 'm2')!;
    m2.position.x += 632.8e-6 / 4;
    const p2 = trace(doc.optics).detectors.cam.profile!;
    // bright fringes now sit where the dark ones were
    for (const i of pk) expect(p2[i]).toBeLessThan(0.1 * p[i]);
    // complementary port: the pick-off power changes in the opposite direction to the camera power when the tilt is removed
    m2.rotation = 0; m2.position.x = 120;
    const bright = trace(doc.optics);
    m2.position.x = 120 + 632.8e-6 / 4;
    const darkR = trace(doc.optics);
    expect(bright.detectors.cam.power).toBeGreaterThan(20 * darkR.detectors.cam.power);
    expect(darkR.detectors.ret.power).toBeGreaterThan(20 * bright.detectors.ret.power);
  });

  it('16 pulsed laser: arrival times 1.92 ns (glass block) and 11.46 ns (2 m fibre); pulse envelope', () => {
    const doc = load('16-pulsed-laser-slowmo.obw');
    expect(doc.optics.settings.waveMode).toBeUndefined();
    const r = trace(doc.optics);
    const arrive = (y: number) => {
      const s = r.segments.filter((q) => Math.abs(q.b.x - 200) < 1e-6 && Math.abs(q.b.y - y) < 4).sort((a, b) => b.power - a.power)[0];
      return s.t1! * 1e9;
    };
    expect(arrive(0)).toBeCloseTo(1.92, 2);
    expect(arrive(-130)).toBeCloseTo(11.46, 2);
    expect(r.detectors.pdA.power).toBeCloseTo(0.005, 6);
    expect(r.detectors.pdB.power).toBeGreaterThan(0.0045);
    const laser = doc.optics.components.find((c) => c.id === 'laser')!;
    expect(sourceTemporalEnvelope(laser, 0)).toBeCloseTo(37.58, 1);
    expect(sourceTemporalEnvelope(laser, 1e-9)).toBeLessThan(1e-9);
    expect(sourceTemporalEnvelope(laser, 2e-9)).toBeCloseTo(37.58, 1);
    for (const s of r.segments) { expect(s.t0).toBeDefined(); expect(s.t1!).toBeGreaterThanOrEqual(s.t0!); }
  });

  it('17 galvo + chopper: the circuit chops the beam at 20 Hz and scans it across the screen', () => {
    const doc = load('17-galvo-chopper.obw');
    const rep = simulateDocument(doc, { seconds: 0.5, dt: 0.001 });
    const mon = rep.detectors.find((d) => d.id === 'mon')!;
    expect(mon.power.max).toBeCloseTo(0.0005, 5);
    expect(mon.power.min).toBe(0);
    expect(mon.power.mean / mon.power.max).toBeCloseTo(0.5, 1);
    // direct traces: galvo angle -> spot position 250 mm * tan(2 angle)
    const spot = (angle: number) => {
      const h = trace(doc.optics, { propOverrides: { galvo: { angle } } }).detectors.screen.hits!;
      return h.reduce((s, q) => s + q.p.x * q.power, 0) / h.reduce((s, q) => s + q.power, 0);
    };
    expect(Math.abs(spot(0))).toBeLessThan(0.01);
    expect(Math.abs(spot(5))).toBeCloseTo(250 * Math.tan(10 * Math.PI / 180), 0);
    expect(spot(5)).toBeCloseTo(-spot(-5), 1);
    // wheel angle 0..18 deg open, 18..36 deg closed
    const through = (phase: number) => trace(doc.optics, { propOverrides: { chopper: { phase } } }).detectors.mon.power;
    expect(through(5)).toBeGreaterThan(0);
    expect(through(25)).toBe(0);
    expect(through(41)).toBeGreaterThan(0);
  });
});
