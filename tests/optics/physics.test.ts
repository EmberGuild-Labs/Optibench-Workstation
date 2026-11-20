import { describe, expect, it } from 'vitest';
import { getMaterial, lensmakerFocal, opticsEngine, trace } from '../../src/core/optics';
import { DEG, angleOf, comp, dir, laser, run, scene, totalBalance } from './helpers';

const WL = 587.56;
const nAirD = getMaterial('air').n(WL);
const nBK7 = getMaterial('bk7').n(WL) / nAirD; // relative to air = catalogue value

describe('refraction and reflection', () => {
  it('obeys the law of Snell', () => {
    for (const inc of [10, 30, 45, 60, 75]) {
      // big slab whose left face is at x = 0; beam hits (0,0) at angle `inc`
      const r = run([
        laser(-50 * Math.cos(inc * DEG), -50 * Math.sin(inc * DEG), inc),
        comp('block.slab', 100, 0, 0, { width: 200, height: 400, material: 'bk7' }),
      ]);
      const inside = r.segments.find((s) => s.inMedium && s.depth === 1)!;
      expect(inside).toBeTruthy();
      const refr = Math.abs(angleOf(inside));
      expect(Math.sin(inc * DEG) / Math.sin(refr)).toBeCloseTo(nBK7, 6);
    }
  });

  it('Fresnel reflectance at normal incidence is ~4 % for glass', () => {
    const r = run([laser(-50, 0), comp('block.slab', 100, 0, 0, { width: 200, height: 400 })]);
    const refl = r.segments.find((s) => s.depth === 1 && !s.inMedium)!;
    const R = ((nBK7 - 1) / (nBK7 + 1)) ** 2;
    expect(refl.power).toBeCloseTo(R, 6);
    expect(refl.power).toBeGreaterThan(0.04);
    expect(refl.power).toBeLessThan(0.045);
    expect(dir(refl).x).toBeCloseTo(-1, 9);
  });

  it('Fresnel equations at oblique incidence for s and p', () => {
    const inc = 60 * DEG, t = Math.asin(Math.sin(inc) / nBK7);
    const Rs = (Math.sin(inc - t) / Math.sin(inc + t)) ** 2, Rp = (Math.tan(inc - t) / Math.tan(inc + t)) ** 2;
    const at = (pol: number) => {
      const r = run([laser(-50 * Math.cos(inc), -50 * Math.sin(inc), 60, { polAngle: pol }), comp('block.slab', 100, 0, 0, { width: 200, height: 400 })]);
      return r.segments.find((s) => s.depth === 1 && !s.inMedium)!.power;
    };
    expect(at(0)).toBeCloseTo(Rp, 6);
    expect(at(90)).toBeCloseTo(Rs, 6);
    // unpolarized = average
    const r = run([laser(-50 * Math.cos(inc), -50 * Math.sin(inc), 60, { polarization: 'unpolarized' }), comp('block.slab', 100, 0, 0, { width: 200, height: 400 })]);
    const refl = r.segments.find((s) => s.depth === 1 && !s.inMedium)!;
    expect(refl.power).toBeCloseTo((Rs + Rp) / 2, 6);
    expect(refl.polDegree!).toBeCloseTo((Rs - Rp) / (Rs + Rp), 6); // partially s-polarized by reflection
  });

  it('Brewster angle: p-reflectance vanishes', () => {
    const b = Math.atan(nBK7);
    const mk = (pol: number) => run([
      laser(-50 * Math.cos(b), -50 * Math.sin(b), b / DEG, { polAngle: pol }),
      comp('block.slab', 100, 0, 0, { width: 200, height: 400 }),
    ], { minIntensity: 1e-12 });
    const p = mk(0).segments.find((s) => s.depth === 1 && !s.inMedium);
    expect(p ? p.power : 0).toBeLessThan(1e-9);
    const s = mk(90).segments.find((x) => x.depth === 1 && !x.inMedium)!;
    expect(s.power).toBeGreaterThan(0.14);
  });

  it('total internal reflection sets in at the critical angle of BK7', () => {
    const crit = Math.asin(1 / nBK7) / DEG; // ~41.2 deg
    expect(crit).toBeGreaterThan(41); expect(crit).toBeLessThan(41.4);
    const escapes = (inc: number) => {
      // source inside the glass, aiming at the right face (x = 100)
      const r = run([laser(0, 0, inc), comp('block.slab', 0, 0, 0, { width: 200, height: 2000 })]);
      return r.segments.some((s) => !s.inMedium && s.a.x > 99.9 && s.b.x > 101);
    };
    expect(escapes(crit - 0.2)).toBe(true);
    expect(escapes(crit + 0.2)).toBe(false);
    // TIR is lossless
    const r = run([laser(0, 0, 60), comp('block.slab', 0, 0, 0, { width: 200, height: 2000 })]);
    const refl = r.segments.find((s) => s.depth === 1)!;
    expect(refl.power).toBeCloseTo(1, 12);
    expect(refl.inMedium).toBe(true);
  });

  it('TIR phase shift: Fresnel rhomb turns 45 deg linear into circular light', () => {
    // two internal reflections at ~54.6 deg in n = 1.51 glass give 90 deg total retardance
    const n = 1.51;
    let best = 1;
    for (let a = 53; a <= 56; a += 0.05) {
      const r = run([
        laser(0, 0, 90 - a, { polAngle: 45 }),
        comp('block.slab', 0, 0, 0, { width: 2000, height: 20, material: 'custom', customIndex: n / nAirD, customAbbe: 60 }),
      ]);
      const seg = r.segments.find((s) => s.depth === 2);
      if (seg) best = Math.min(best, seg.polDegree!);
    }
    expect(best).toBeLessThan(0.01);
  });

  it('minimum deviation of an equilateral prism gives the refractive index', () => {
    const n = getMaterial('f2').n(WL) / nAirD;
    let dmin = Infinity;
    for (let a = 5; a <= 50; a += 0.02) {
      const r = run([laser(-10 - 100 * Math.cos(a * DEG), -5.8 + 100 * Math.sin(a * DEG), -a), comp('prism.equilateral', 0, 0, 0, { size: 40, material: 'f2', coating: 'ideal' })]);
      if (r.segments.length !== 3) continue;
      const out = r.segments[r.segments.length - 1];
      // beam travels up-right (-a), prism apex is up: deviation is towards the base (clockwise, +angle)
      const dev = angleOf(out) / DEG + a;
      if (dev > 0 && dev < dmin) dmin = dev;
    }
    const expected = (2 * Math.asin(n * Math.sin(30 * DEG))) / DEG - 60;
    expect(dmin).toBeCloseTo(expected, 3);
    expect(Math.sin(((60 + dmin) / 2) * DEG) / Math.sin(30 * DEG)).toBeCloseTo(n, 4);
  });

  it('prism disperses blue more than red', () => {
    const dev = (wl: number) => {
      const r = run([laser(-10 - 80 * Math.cos(24 * DEG), -5.8 + 80 * Math.sin(24 * DEG), -24, { wavelength: wl }), comp('prism.equilateral', 0, 0, 0, { coating: 'ideal' })]);
      return angleOf(r.segments[r.segments.length - 1]);
    };
    expect(dev(450)).toBeGreaterThan(dev(650) + 0.02);
  });
});

describe('lenses and mirrors', () => {
  const crossing = (segs: ReturnType<typeof run>['segments']) => {
    const s = segs[segs.length - 1];
    const d = dir(s);
    return s.a.x - (s.a.y * d.x) / d.y; // x where the ray meets y = 0
  };

  it('plano-convex lens focuses paraxial rays at the lensmaker focal length', () => {
    const lens = comp('lens.planoconvex', 0, 0, 0, { focalLength: 100, diameter: 25.4, coating: 'ideal' });
    const g = opticsEngine.getGeometry(lens);
    const backVertex = g.bounds.max.x, tc = g.bounds.max.x - g.bounds.min.x;
    const nRel = getMaterial('bk7').nCatalog(WL);
    const R = (nRel - 1) * 100;
    const f = lensmakerFocal(nRel, R, 0, tc);
    expect(f).toBeCloseTo(100, 6);
    const r = run([laser(-50, 0.2), lens]);
    // back focal distance of a plano-convex lens (curved side first): f - tc/n
    expect(crossing(r.segments) - backVertex).toBeCloseTo(f - tc / nRel, 1);
  });

  it('bi-convex lens: design focal length, spherical and chromatic aberration emerge', () => {
    const lens = comp('lens.biconvex', 0, 0, 0, { focalLength: 80, diameter: 30, coating: 'ideal' });
    const fx = (h: number, wl = WL) => crossing(run([laser(-50, h, 0, { wavelength: wl }), lens]).segments);
    const g = opticsEngine.getGeometry(lens);
    const tc = g.bounds.max.x - g.bounds.min.x;
    const nRel = getMaterial('bk7').nCatalog(WL);
    // symmetric thick lens: the rear principal plane sits ~tc/(2n) inside the back vertex
    const hPrime = tc / 2 - tc / (2 * nRel);
    expect(fx(0.1) - hPrime).toBeGreaterThan(79.7);
    expect(fx(0.1) - hPrime).toBeLessThan(80.3);
    expect(fx(12)).toBeLessThan(fx(0.1) - 1);              // marginal rays focus shorter
    expect(fx(0.1, 450)).toBeLessThan(fx(0.1, 650) - 0.5); // blue focuses shorter
  });

  it('ideal lens is free of aberrations', () => {
    const lens = comp('lens.ideal', 0, 0, 0, { focalLength: 75, size: 40 });
    for (const h of [1, 8, 19]) expect(crossing(run([laser(-50, h), lens]).segments)).toBeCloseTo(75, 9);
    // imaging: point at 150 mm images at 150 mm (1/s + 1/s' = 1/f)
    const r = run([laser(-150, 0, 5), lens]);
    expect(crossing(r.segments)).toBeCloseTo(150, 8);
  });

  it('custom lens matches the thick-lens formula', () => {
    const lens = comp('lens.custom', 0, 0, 0, { r1: 60, r2: -200, thickness: 6, diameter: 20, coating: 'ideal' });
    const nRel = getMaterial('bk7').nCatalog(WL);
    const f = lensmakerFocal(nRel, 60, -200, 6);
    const bfd = f * (1 - ((nRel - 1) * 6) / (nRel * 60));
    expect(crossing(run([laser(-50, 0.1), lens]).segments) - 3).toBeCloseTo(bfd, 1);
  });

  it('parabolic mirror focuses all parallel rays exactly; spherical mirror only paraxially', () => {
    const cross = (type: string, h: number, props: Record<string, number | string>) => {
      const r = run([laser(-200, h), comp(type, 0, 0, 0, { size: 90, coating: 'ideal', ...props })]);
      const s = r.segments[1];
      const d = dir(s);
      return s.a.x - (s.a.y * d.x) / d.y;
    };
    for (const h of [2, 20, 40]) expect(cross('mirror.parabolic', h, { focalLength: 100 })).toBeCloseTo(-100, 8);
    expect(cross('mirror.spherical', 0.5, { radius: 200 })).toBeCloseTo(-100, 2);
    expect(cross('mirror.spherical', 40, { radius: 200 })).toBeGreaterThan(-98); // marginal focus closer to mirror
  });

  it('flat mirror: law of reflection', () => {
    const r = run([laser(-50, 0), comp('mirror.flat', 0, 0, 30, { coating: 'ideal' })]);
    expect(angleOf(r.segments[1]) / DEG).toBeCloseTo(-120, 8); // mirror normal at 30 deg => reflected at 180 + 60
    expect(r.segments[1].power).toBeCloseTo(1, 12);
  });

  it('ball lens focal length f = nD / 4(n-1)', () => {
    const r = run([laser(-50, 0.05), comp('lens.ball', 0, 0, 0, { diameter: 10, coating: 'ideal' })]);
    const s = r.segments[r.segments.length - 1], d = dir(s);
    expect(s.a.x - (s.a.y * d.x) / d.y).toBeCloseTo((nBK7 * 10) / (4 * (nBK7 - 1)), 2);
  });
});

describe('diffraction grating', () => {
  it('orders follow the grating equation', () => {
    const wl = 632.8, lines = 600;
    const r = run([laser(-50, 0, 0, { wavelength: wl }), comp('grating.transmission', 0, 0, 0, { linesPerMm: lines, size: 30 })]);
    const outs = r.segments.filter((s) => s.a.x === 0).map((s) => Math.asin(dir(s).y)).sort((a, b) => a - b);
    const q = (wl * 1e-6 * lines) / getMaterial('air').n(wl);
    const expected = [-2, -1, 0, 1, 2].map((m) => Math.asin(m * q));
    expect(outs.length).toBe(5);
    outs.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 9));
    expect(Math.abs(outs[3]) / DEG).toBeCloseTo(22.3, 1);
    const sum = r.segments.filter((s) => s.a.x === 0).reduce((a, s) => a + s.power, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it('oblique incidence and reflection grating', () => {
    const wl = 532, lines = 1200, inc = 20 * DEG;
    const r = run([laser(-50 * Math.cos(inc), -50 * Math.sin(inc), 20, { wavelength: wl }), comp('grating.reflection', 0, 0, 0, { linesPerMm: lines })]);
    const outs = r.segments.filter((s) => s.depth === 1);
    const q = (wl * 1e-6 * lines) / getMaterial('air').n(wl);
    for (const s of outs) {
      expect(dir(s).x).toBeLessThan(0);
      const m = (dir(s).y - Math.sin(inc)) / q;
      expect(Math.abs(m - Math.round(m))).toBeLessThan(1e-9);
    }
    expect(outs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('energy conservation and determinism', () => {
  const build = () => [
    comp('source.white', -200, 0, 0, { rays: 5, power: 2 }, 'w'),
    comp('source.laser', -200, 30, -5, { rays: 5, power: 0.5 }, 'l'),
    comp('lens.biconvex', -120, 0, 0, {}, 'c1'),
    comp('prism.equilateral', -40, 5, 10, {}, 'c2'),
    comp('splitter.plate', 40, 0, 45, {}, 'c3'),
    comp('mirror.flat', 40, -80, 45, { coating: 'ideal', reflectivity: 1 }, 'c4'),
    comp('block.slab', 120, 0, 20, {}, 'c5'),
    comp('lens.ball', 100, -80, 0, {}, 'c6'),
    comp('grating.transmission', 180, 0, 0, {}, 'c7'),
    comp('detector.screen', 300, 0, 0, { size: 300 }, 'screen'),
  ];

  it('emitted power = detected + absorbed + escaped + dropped', () => {
    const r = run(build());
    expect(r.energy.emitted).toBeCloseTo(2.5, 9);
    expect(totalBalance(r)).toBeCloseTo(r.energy.emitted, 9);
    // lossless optics: nothing is absorbed except by the detector, and only a little is culled
    expect(r.energy.absorbed).toBeLessThan(1e-9);
    expect(r.energy.dropped / r.energy.emitted).toBeLessThan(0.01);
    expect(r.detectors.screen.power).toBeCloseTo(r.energy.detected, 12);
  });

  it('lossless slab: reflected + transmitted = incident', () => {
    const r = run([laser(-100, 0, 25, { polarization: 'unpolarized' }), comp('block.slab', 0, 0, 0, { width: 20, height: 400 })], { minIntensity: 1e-9 });
    expect(r.energy.escaped + r.energy.dropped).toBeCloseTo(1, 9);
    expect(r.energy.dropped).toBeLessThan(1e-6);
    expect(r.energy.absorbed).toBe(0);
  });

  it('is deterministic', () => {
    const a = run(build()), b = run(build());
    expect(a.segments.length).toBe(b.segments.length);
    expect(a.segments.length).toBeGreaterThan(100);
    for (let i = 0; i < a.segments.length; i += 7) {
      expect(a.segments[i].b.x).toBe(b.segments[i].b.x);
      expect(a.segments[i].power).toBe(b.segments[i].power);
    }
  });

  it('honours sourceScale and propOverrides', () => {
    const comps = [laser(-50, 0, 0, {}, 'src'), comp('aperture.shutter', 0, 0, 0, {}, 'sh'), comp('detector.power', 50, 0, 0, {}, 'pm')];
    expect(trace(scene(comps)).detectors.pm.power).toBeCloseTo(1, 12);
    expect(trace(scene(comps), { sourceScale: { src: 0.25 } }).detectors.pm.power).toBeCloseTo(0.25, 12);
    expect(trace(scene(comps), { sourceScale: { src: 0 } }).detectors.pm.power).toBe(0);
    expect(trace(scene(comps), { propOverrides: { sh: { open: 0.3 } } }).detectors.pm.power).toBeCloseTo(0.3, 12);
  });

  it('single-layer MgF2 coating: exact thin-film reflectance', () => {
    const r = run([laser(-50, 0, 0, { wavelength: 550 }), comp('block.slab', 100, 0, 0, { width: 200, height: 400, coating: 'mgf2' })]);
    const refl = r.segments.find((s) => s.depth === 1 && !s.inMedium)!;
    const n0 = getMaterial('air').n(550), ns = getMaterial('bk7').n(550), nf = getMaterial('mgf2').n(550);
    expect(refl.power).toBeCloseTo(((n0 * ns - nf * nf) / (n0 * ns + nf * nf)) ** 2, 9); // quarter-wave formula, ~1.25 %
    expect(refl.power).toBeLessThan(0.014);
    const ideal = run([laser(-50, 0, 0), comp('block.slab', 100, 0, 0, { width: 200, height: 400, coating: 'ideal' })]);
    expect(ideal.segments.length).toBe(3);
  });

  it('touching bodies (cemented pair) and overlapping bodies stay consistent', () => {
    const r = run([
      laser(-50, 0, 7),
      comp('block.slab', 5, 0, 0, { width: 10, height: 100, material: 'bk7' }),
      comp('block.slab', 15, 0, 0, { width: 10, height: 100, material: 'sf11' }),
      comp('block.slab', 22, 0, 0, { width: 10, height: 100, material: 'water' }), // overlaps the SF11 slab by 3 mm
      comp('detector.power', 60, 6, 0, { size: 60 }, 'pm'),
    ], { minIntensity: 1e-9 });
    expect(totalBalance(r)).toBeCloseTo(1, 9);
    expect(r.detectors.pm.power).toBeGreaterThan(0.8);
    const last = r.segments.filter((s) => s.b.x > 59.9 && s.depth < 8)[0];
    expect(last.inMedium).toBe(false);
    expect(angleOf(last) / DEG).toBeCloseTo(7, 6); // parallel plates do not change the direction
  });

  it('Beer-Lambert absorption in water', () => {
    const r = run([laser(-50, 0, 0, { wavelength: 700 }), comp('block.slab', 500, 0, 0, { width: 1000, height: 100, material: 'water', coating: 'ideal' }), comp('detector.power', 1050, 0, 0, {}, 'pm')]);
    expect(r.detectors.pm.power).toBeCloseTo(Math.exp(-0.624), 3); // alpha(700 nm) = 0.624 1/m over 1 m
  });
});
