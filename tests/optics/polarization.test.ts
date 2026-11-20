import { describe, expect, it } from 'vitest';
import { getMaterial } from '../../src/core/optics';
import { DEG, comp, dir, laser, run } from './helpers';

const IDEAL_POL = { transmission: 1, extinction: 1e12 };
const wrap = (a: number) => { let x = a % 180; if (x > 90) x -= 180; if (x <= -90) x += 180; return x; };

describe('polarizers and waveplates', () => {
  it('Malus law: I = I0 cos^2(theta)', () => {
    for (const th of [0, 15, 30, 45, 60, 75, 90]) {
      const r = run([laser(-50, 0, 0, { polAngle: 0 }), comp('polarizer.linear', 0, 0, 0, { angle: th, ...IDEAL_POL }), comp('detector.power', 50, 0, 0, {}, 'pm')]);
      expect(r.detectors.pm.power).toBeCloseTo(Math.cos(th * DEG) ** 2, 9);
    }
  });

  it('unpolarized light is halved, then follows Malus between two polarizers', () => {
    const r = run([
      laser(-50, 0, 0, { polarization: 'unpolarized' }),
      comp('polarizer.linear', 0, 0, 0, { angle: 20, ...IDEAL_POL }),
      comp('polarizer.linear', 20, 0, 0, { angle: 80, ...IDEAL_POL }),
      comp('detector.power', 50, 0, 0, {}, 'pm'),
    ]);
    expect(r.detectors.pm.power).toBeCloseTo(0.5 * Math.cos(60 * DEG) ** 2, 9);
    const mid = r.segments[1];
    expect(mid.polDegree!).toBeCloseTo(1, 9);
    expect(mid.polAngle! / DEG).toBeCloseTo(20, 6);
    expect(r.segments[0].polDegree!).toBeCloseTo(0, 12);
  });

  it('three-polarizer paradox: inserting a 45 deg polarizer between crossed ones transmits 1/4', () => {
    const base = [laser(-50, 0, 0, { polAngle: 0 }), comp('polarizer.linear', 40, 0, 0, { angle: 90, ...IDEAL_POL }), comp('detector.power', 60, 0, 0, {}, 'pm')];
    expect(run(base).detectors.pm.power).toBeLessThan(1e-9);
    expect(run([...base, comp('polarizer.linear', 20, 0, 0, { angle: 45, ...IDEAL_POL })]).detectors.pm.power).toBeCloseTo(0.25, 5);
  });

  it('half-wave plate rotates linear polarization by twice the axis angle', () => {
    const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }), comp('waveplate.half', 0, 0, 0, { fastAxis: 22.5 }), comp('polarizer.linear', 20, 0, 0, { angle: 45, ...IDEAL_POL }), comp('detector.power', 50, 0, 0, {}, 'pm')]);
    expect(r.segments[1].polAngle! / DEG).toBeCloseTo(45, 6);
    expect(r.segments[1].polDegree!).toBeCloseTo(1, 9);
    expect(r.detectors.pm.power).toBeCloseTo(1, 9);
  });

  it('quarter-wave plate makes circular light; a second one restores linear (rotated 90 deg)', () => {
    const r = run([
      laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }),
      comp('waveplate.quarter', 0, 0, 0, { fastAxis: 45 }),
      comp('waveplate.quarter', 10, 0, 0, { fastAxis: 45 }),
      comp('polarizer.linear', 20, 0, 0, { angle: 90, ...IDEAL_POL }),
      comp('detector.power', 50, 0, 0, {}, 'pm'),
    ]);
    expect(r.segments[1].polDegree!).toBeLessThan(1e-9);
    expect(r.segments[2].polDegree!).toBeCloseTo(1, 9);
    expect(r.detectors.pm.power).toBeCloseTo(1, 9);
  });

  it('quarter-wave plate + mirror double pass acts as half-wave plate (reciprocal element, mirror-reversed axis)', () => {
    // p light -> QWP@45 -> mirror -> QWP -> becomes s: blocked by a p polarizer on the way back
    const r = run([
      laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }),
      comp('waveplate.quarter', 0, 0, 0, { fastAxis: 45 }),
      comp('mirror.flat', 20, 0, 0, { coating: 'ideal' }),
    ]);
    const back = r.segments[r.segments.length - 1];
    expect(dir(back).x).toBeCloseTo(-1, 9);
    expect(back.polDegree!).toBeCloseTo(1, 9);
    expect(Math.abs(wrap(back.polAngle! / DEG))).toBeCloseTo(90, 6);
  });

  it('waveplate retardance is chromatic', () => {
    const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: 450 }), comp('waveplate.quarter', 0, 0, 0, { fastAxis: 45, designWavelength: 632.8 })]);
    expect(r.segments[1].polDegree!).toBeGreaterThan(0.3); // no longer circular off-design
  });

  it('polarizing beam splitter separates s and p', () => {
    const mk = (pol: number) => run([
      laser(-50, 0, 0, { polAngle: pol }),
      comp('splitter.pbs', 0, 0, 0, { tp: 1, rs: 1, coating: 'ideal' }),
      comp('detector.power', 50, 0, 0, {}, 'straight'),
      comp('detector.power', 0, -50, -90, {}, 'side'),
    ]);
    const p = mk(0), s = mk(90), d = mk(45);
    expect(p.detectors.straight.power).toBeCloseTo(1, 9); expect(p.detectors.side.power).toBeLessThan(1e-12);
    expect(s.detectors.side.power).toBeCloseTo(1, 9); expect(s.detectors.straight.power).toBeLessThan(1e-12);
    expect(d.detectors.side.power).toBeCloseTo(0.5, 9); expect(d.detectors.straight.power).toBeCloseTo(0.5, 9);
  });
});

describe('Faraday effect', () => {
  it('rotation angle = V B L', () => {
    const V = getMaterial('tgg').verdet(632.8);
    for (const [B, L] of [[0.1, 20], [0.3, 10], [-0.2, 15]]) {
      const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }), comp('magneto.faraday', 0, 0, 0, { bField: B, length: L })]);
      const out = r.segments[r.segments.length - 1];
      expect(out.polDegree!).toBeCloseTo(1, 9);
      expect(wrap(out.polAngle! / DEG)).toBeCloseTo(wrap((V * B * L * 1e-3) / DEG), 6);
    }
  });

  it('Verdet dispersion: less rotation at longer wavelength', () => {
    const rot = (wl: number) => {
      const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: wl }), comp('magneto.faraday', 0, 0, 0, { bField: 0.1, length: 20 })]);
      return Math.abs(r.segments[r.segments.length - 1].polAngle!);
    };
    expect(rot(1064) / rot(632.8)).toBeCloseTo(40 / 134, 1);
  });

  it('is non-reciprocal: a double pass doubles the rotation instead of cancelling it', () => {
    const V = getMaterial('tgg').verdet(632.8), B = 0.1, L = 20;
    const single = (V * B * L * 1e-3) / DEG;
    const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }), comp('magneto.faraday', 0, 0, 0, { bField: B, length: L }), comp('mirror.flat', 40, 0, 0, { coating: 'ideal' })]);
    const back = r.segments[r.segments.length - 1];
    expect(dir(back).x).toBeCloseTo(-1, 9);
    // measured in the (mirror-reversed) basis of the returning beam the angle is -(2 theta)
    expect(Math.abs(wrap(back.polAngle! / DEG))).toBeCloseTo(Math.abs(wrap(2 * single)), 6);
  });

  it('rotation follows B.dl for oblique rays', () => {
    const r = run([laser(-50, 0, 0, { polAngle: 0, wavelength: 632.8 }), comp('magneto.faraday', 0, 0, 20, { bField: 0.1, length: 20, diameter: 40 })]);
    // B is along the rod axis; projection of the internal path on the axis is still the rod length
    const V = getMaterial('tgg').verdet(632.8);
    expect(wrap(r.segments[r.segments.length - 1].polAngle! / DEG)).toBeCloseTo(wrap((V * 0.1 * 20e-3) / DEG), 4);
  });

  it('optical isolator passes forward light and blocks backward light', () => {
    const iso = (rotDeg: number) => run([
      laser(-60, 0, 0, { polarization: 'unpolarized', wavelength: 632.8 }),
      comp('magneto.isolator', 0, 0, rotDeg, {}),
      comp('detector.power', 60, 0, 0, {}, 'pm'),
    ]);
    const fwd = iso(0).detectors.pm.power, bwd = iso(180).detectors.pm.power;
    expect(fwd).toBeGreaterThan(0.47);
    expect(bwd).toBeLessThan(1e-4);
    expect(10 * Math.log10(fwd / bwd)).toBeGreaterThan(35); // isolation in dB
    // off the design wavelength the isolation degrades
    const off = run([laser(-60, 0, 0, { polarization: 'unpolarized', wavelength: 532 }), comp('magneto.isolator', 0, 0, 180, {}), comp('detector.power', 60, 0, 0, {}, 'pm')]).detectors.pm.power;
    expect(off).toBeGreaterThan(10 * bwd);
  });

  it('metal mirror changes polarization of obliquely reflected 45 deg light', () => {
    const r = run([laser(-50, 0, 0, { polAngle: 45 }), comp('mirror.flat', 0, 0, 60, { coating: 'aluminium' })]);
    const out = r.segments[1];
    expect(out.power).toBeGreaterThan(0.85); expect(out.power).toBeLessThan(0.95);
    expect(out.polDegree!).toBeLessThan(0.999); // slightly elliptical
    expect(out.polDegree!).toBeGreaterThan(0.8);
  });
});
