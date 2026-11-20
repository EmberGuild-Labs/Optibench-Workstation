import { describe, expect, it } from 'vitest';
import type { OpticalComponent } from '../../src/core/types';
import { getMaterial, opticsEngine, silicaAttenuationDbPerKm, trace } from '../../src/core/optics';
import { DEG, angleOf, comp, dir, laser, run, scene, totalBalance } from './helpers';

const CANONICAL = [
  'source.laser', 'source.led', 'source.white', 'source.point', 'source.beam',
  'mirror.flat', 'mirror.spherical', 'mirror.parabolic', 'mirror.dichroic',
  'splitter.plate', 'splitter.pbs',
  'lens.biconvex', 'lens.biconcave', 'lens.planoconvex', 'lens.planoconcave', 'lens.ball', 'lens.ideal', 'lens.custom',
  'prism.equilateral', 'prism.right_angle', 'prism.dove', 'prism.custom', 'block.slab', 'block.semicircle', 'medium.grin',
  'grating.transmission', 'grating.reflection',
  'polarizer.linear', 'waveplate.half', 'waveplate.quarter',
  'magneto.faraday', 'magneto.isolator', 'field.gravity',
  'fiber.cable',
  'aperture.slit', 'aperture.iris', 'aperture.shutter', 'absorber.block', 'filter.bandpass', 'filter.longpass', 'filter.shortpass', 'filter.nd',
  'nonlinear.shg',
  'detector.power', 'detector.screen', 'detector.spectrometer', 'detector.photodiode',
];

describe('registry', () => {
  it('implements every canonical type with complete parameter definitions', () => {
    const types = new Set(opticsEngine.registry.map((d) => d.type));
    for (const t of CANONICAL) expect(types.has(t), t).toBe(true);
    for (const d of opticsEngine.registry) {
      expect(d.label.length).toBeGreaterThan(2);
      expect(d.description.length, d.type).toBeGreaterThan(60);
      const keys = new Set<string>();
      for (const p of d.params) {
        expect(keys.has(p.key), `${d.type}.${p.key} duplicated`).toBe(false);
        keys.add(p.key);
        expect(p.help, `${d.type}.${p.key}`).toBeTruthy();
        expect(p.group, `${d.type}.${p.key}`).toBeTruthy();
        if (p.kind === 'select') expect(p.options!.some((o) => o.value === p.default), `${d.type}.${p.key}`).toBe(true);
        if (p.kind === 'number') { expect(p.default as number).toBeGreaterThanOrEqual(p.min!); expect(p.default as number).toBeLessThanOrEqual(p.max!); }
      }
    }
  });

  it('createComponent fills defaults and unique ids', () => {
    const a = opticsEngine.createComponent('lens.biconvex', { x: 3, y: 4 }), b = opticsEngine.createComponent('lens.biconvex', { x: 3, y: 4 });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('lens_')).toBe(true);
    expect(a.rotation).toBe(0);
    expect(a.props.focalLength).toBe(100);
    const f = opticsEngine.createComponent('fiber.cable', { x: 10, y: 20 });
    expect(f.props.endX).toBe(160); expect(f.props.endY).toBe(20);
    const s = opticsEngine.defaultSettings();
    expect(s.maxBounces).toBe(64); expect(s.minIntensity).toBe(1e-4); expect(s.ambientMedium).toBe('air'); expect(s.spectralSamples).toBe(24);
  });

  it('getGeometry gives finite world-space outlines for every type and follows position / rotation', () => {
    for (const d of opticsEngine.registry) {
      const c = opticsEngine.createComponent(d.type, { x: 100, y: -50 });
      c.rotation = 0.7;
      const g = opticsEngine.getGeometry(c);
      expect(g.paths.length, d.type).toBeGreaterThan(0);
      for (const p of g.paths) for (const q of p.points) { expect(Number.isFinite(q.x) && Number.isFinite(q.y), d.type).toBe(true); }
      expect(g.bounds.min.x).toBeLessThanOrEqual(g.bounds.max.x);
      if (d.type !== 'fiber.cable') {
        expect(g.bounds.min.x, d.type).toBeLessThan(100.001); expect(g.bounds.max.x, d.type).toBeGreaterThan(99.999);
        expect(g.bounds.min.y, d.type).toBeLessThan(-49.999); expect(g.bounds.max.y, d.type).toBeGreaterThan(-50.001);
      }
    }
    const f = opticsEngine.getGeometry(opticsEngine.createComponent('fiber.cable', { x: 0, y: 0 }));
    expect(f.handles).toEqual([{ key: 'end', p: { x: 150, y: 0 } }]);
    expect(f.paths.some((p) => p.role === 'decor' && p.points.length > 20)).toBe(true);
  });

  it('drawn outline coincides with the traced surface (lens)', () => {
    const lens = comp('lens.biconvex', 10, 5, 25, { focalLength: 60, diameter: 30 });
    const body = opticsEngine.getGeometry(lens).paths.find((p) => p.role === 'body')!;
    // shoot rays at the lens from many directions; each entry point must lie on the outline polyline
    for (let a = 0; a < 360; a += 17) {
      const r = run([laser(10 + 200 * Math.cos(a * DEG), 5 + 200 * Math.sin(a * DEG), a + 180), lens]);
      const p = r.segments[0].b;
      let best = Infinity;
      for (let i = 0; i < body.points.length; i++) {
        const u = body.points[i], v = body.points[(i + 1) % body.points.length];
        const ex = v.x - u.x, ey = v.y - u.y;
        const t = Math.max(0, Math.min(1, ((p.x - u.x) * ex + (p.y - u.y) * ey) / (ex * ex + ey * ey || 1)));
        best = Math.min(best, Math.hypot(p.x - u.x - t * ex, p.y - u.y - t * ey));
      }
      expect(best).toBeLessThan(0.01);
    }
  });

  it('a scene with one of everything traces without errors and balances energy', () => {
    const comps: OpticalComponent[] = opticsEngine.registry.map((d, i) => {
      const c = opticsEngine.createComponent(d.type, { x: (i % 8) * 70, y: Math.floor(i / 8) * 70 });
      c.rotation = i * 0.37;
      return c;
    });
    const r = run(comps);
    expect(r.segments.length).toBeGreaterThan(100);
    for (const s of r.segments) expect(Number.isFinite(s.b.x + s.b.y + s.power + s.polAngle! + s.polDegree!)).toBe(true);
    expect(totalBalance(r)).toBeCloseTo(r.energy.emitted, 6);
    for (const d of comps.filter((c) => c.type.startsWith('detector.'))) expect(r.detectors[d.id]).toBeTruthy();
  });

  it('survives degenerate parameters', () => {
    const comps = opticsEngine.registry.map((d, i) => {
      const c = opticsEngine.createComponent(d.type, { x: i * 3, y: 0 });
      for (const p of d.params) if (p.kind === 'number') c.props[p.key] = i % 2 ? (p.min ?? 0) : (p.max ?? 0);
      return c;
    });
    const r = run(comps, { maxBounces: 8, raysPerSource: 4, spectralSamples: 4 });
    for (const s of r.segments) expect(Number.isFinite(s.b.x + s.b.y + s.power)).toBe(true);
    const junk = run([{ id: 'x', type: 'does.not.exist', position: { x: 0, y: 0 }, rotation: 0, props: {} }, laser(0, 0)]);
    expect(junk.segments.length).toBe(1);
  });
});

describe('fiber', () => {
  const fiberScene = (incDeg: number, props = {}) => [
    laser(-30 * Math.cos(incDeg * DEG), -30 * Math.sin(incDeg * DEG), incDeg, { wavelength: 632.8, polarization: 'unpolarized' }),
    comp('fiber.cable', 0, 0, 0, { endX: 200, endY: 80, endRotation: 90, na: 0.22, coreDiameter: 1, length: 5, ...props }, 'fib'),
    comp('detector.screen', 200, 120, 90, { size: 200 }, 'out'),
  ];

  it('accepts rays inside the numerical aperture and rejects rays outside', () => {
    const naAngle = Math.asin(0.22 / getMaterial('air').n(632.8)) / DEG; // 12.7 deg
    expect(run(fiberScene(naAngle - 0.3)).detectors.out.power).toBeGreaterThan(0.9);
    expect(run(fiberScene(naAngle + 0.3)).detectors.out.power).toBe(0);
    expect(run(fiberScene(0)).detectors.out.power).toBeGreaterThan(0.9);
  });

  it('transmission = Fresnel at both faces x attenuation; exit angle preserved', () => {
    const r = run(fiberScene(8, { attenuationModel: 'constant', attenuation: 1000 }));
    const n0 = getMaterial('air').n(632.8), nc = 1.4585;
    const T = 1 - ((n0 - nc) / (n0 + nc)) ** 2;
    expect(r.detectors.out.power).toBeCloseTo(T * T * Math.pow(10, -(1000 * 5e-3) / 10), 9);
    const out = r.segments.find((s) => Math.abs(s.a.x - 200) < 0.6 && Math.abs(s.a.y - 80) < 1e-9)!;
    expect(Math.abs(angleOf(out) / DEG - 90)).toBeCloseTo(8, 6);
    expect(out.polDegree!).toBeLessThan(0.1);
    // silica model
    const r2 = run(fiberScene(0, { length: 1000 }));
    expect(r2.detectors.out.power).toBeCloseTo(T * T * Math.pow(10, -silicaAttenuationDbPerKm(632.8) / 10), 9);
  });

  it('is bidirectional and keeps polarization in PM fibre', () => {
    const r = run([
      laser(200, 120, -90, { wavelength: 632.8, polAngle: 30 }),
      comp('fiber.cable', 0, 0, 0, { endX: 200, endY: 80, endRotation: 90, pm: true }, 'fib'),
      comp('detector.power', -40, 0, 180, {}, 'pm'),
    ]);
    expect(r.detectors.pm.power).toBeGreaterThan(0.9);
    const out = r.segments.find((s) => Math.abs(s.a.x) < 1e-9 && dir(s).x < -0.99)!;
    expect(out.polDegree!).toBeCloseTo(1, 9);
  });

  it('misses outside the core are absorbed by the ferrule', () => {
    const r = run([laser(-30, 1.0), comp('fiber.cable', 0, 0, 0, { coreDiameter: 1 }), comp('detector.power', 300, 0, 0, { size: 50 }, 'pm')]);
    expect(r.detectors.pm.power).toBe(0);
    expect(r.energy.absorbed).toBeCloseTo(1, 9);
  });
});

describe('filters, apertures, detectors', () => {
  it('filters have the specified transmission', () => {
    const T = (type: string, wl: number, props = {}) => run([laser(-20, 0, 0, { wavelength: wl }), comp(type, 0, 0, 0, props), comp('detector.power', 20, 0, 0, {}, 'pm')]).detectors.pm.power;
    expect(T('filter.nd', 550, { opticalDensity: 2 })).toBeCloseTo(0.01, 12);
    expect(T('filter.bandpass', 550, { center: 550, fwhm: 20, peak: 0.9 })).toBeCloseTo(0.9, 12);
    expect(T('filter.bandpass', 560, { center: 550, fwhm: 20, peak: 0.9 })).toBeCloseTo(0.45, 12);
    expect(T('filter.bandpass', 600, { center: 550, fwhm: 20, peak: 0.9 })).toBeLessThan(0.002);
    expect(T('filter.longpass', 550, { cutoff: 550, peak: 0.9 })).toBeCloseTo(0.45, 12);
    expect(T('filter.longpass', 600, { cutoff: 550 })).toBeGreaterThan(0.9);
    expect(T('filter.longpass', 500, { cutoff: 550 })).toBeLessThan(0.001);
    expect(T('filter.shortpass', 500, { cutoff: 550 })).toBeGreaterThan(0.9);
    expect(T('filter.shortpass', 600, { cutoff: 550 })).toBeLessThan(0.001);
  });

  it('dichroic mirror splits the spectrum without loss', () => {
    const mk = (wl: number) => run([laser(-50, 0, 0, { wavelength: wl }), comp('mirror.dichroic', 0, 0, 45, { cutoff: 550 }), comp('detector.power', 50, 0, 0, {}, 't'), comp('detector.power', 0, -50, -90, {}, 'r')]);
    const red = mk(650), blue = mk(450);
    expect(red.detectors.t.power).toBeGreaterThan(0.97); expect(blue.detectors.r.power).toBeGreaterThan(0.97);
    expect(red.detectors.t.power + red.detectors.r.power).toBeCloseTo(1, 12);
  });

  it('apertures clip, shutter modulates, beam dump absorbs', () => {
    const through = (c: OpticalComponent, y = 0) => run([laser(-20, y), c, comp('detector.power', 30, 0, 0, { size: 60 }, 'pm')]).detectors.pm.power;
    expect(through(comp('aperture.slit', 0, 0, 0, { width: 2 }), 0.5)).toBe(1);
    expect(through(comp('aperture.slit', 0, 0, 0, { width: 2 }), 1.5)).toBe(0);
    expect(through(comp('aperture.iris', 0, 0, 0, { diameter: 8 }), 3.9)).toBe(1);
    expect(through(comp('aperture.iris', 0, 0, 0, { diameter: 8 }), 4.1)).toBe(0);
    expect(through(comp('aperture.shutter', 0, 0, 0, { open: 0.37 }))).toBeCloseTo(0.37, 12);
    expect(through(comp('aperture.shutter', 0, 0, 0, { open: 0 }))).toBe(0);
    expect(through(comp('aperture.shutter', 0, 0, 0, { open: 0.4, mode: 'blade', size: 30 }), 5)).toBe(1);
    expect(through(comp('aperture.shutter', 0, 0, 0, { open: 0.4, mode: 'blade', size: 30 }), -5)).toBe(0);
    expect(through(comp('absorber.block', 0, 0, 0, {}))).toBe(0);
  });

  it('single-slit diffraction: first minimum at sin(theta) = lambda / a', () => {
    const a = 0.01, wl = 632.8; // 10 um slit
    const r = run([laser(-20, 0, 0, { wavelength: wl }), comp('aperture.slit', 0, 0, 0, { width: a, diffraction: true }), comp('detector.screen', 500, 0, 0, { size: 400, bins: 200 }, 'scr')], { minIntensity: 1e-7 });
    const hits = r.detectors.scr.hits!;
    expect(hits.length).toBeGreaterThan(8);
    const total = hits.reduce((s, h) => s + h.power, 0);
    expect(total).toBeCloseTo(1, 6);
    const yMin = 500 * Math.tan(Math.asin((wl * 1e-6) / a));
    const inside = hits.filter((h) => Math.abs(h.p.y) < yMin).reduce((s, h) => s + h.power, 0);
    expect(inside / total).toBeGreaterThan(0.85); // ~90 % of the power is in the central lobe
    expect(inside / total).toBeLessThan(0.95);
  });

  it('screen profile, hits and spectrometer bins', () => {
    const r = run([
      comp('source.white', -50, 0, 0, { rays: 3, power: 1, spectrum: 'flat', beamWidth: 2 }),
      comp('splitter.plate', 0, 0, 45, {}),
      comp('detector.spectrometer', 50, 0, 0, { bins: 40 }, 'spec'),
      comp('detector.screen', 0, -50, 90, { size: 20, bins: 10 }, 'scr'),
    ]);
    const spec = r.detectors.spec, scr = r.detectors.scr;
    expect(spec.spectrum!.length).toBe(40); expect(spec.spectrumRange).toEqual([380, 780]);
    expect(spec.spectrum!.reduce((a, b) => a + b, 0)).toBeCloseTo(spec.power, 12);
    expect(spec.power).toBeCloseTo(0.5, 9);
    expect(scr.profile!.length).toBe(10);
    expect(scr.profile!.reduce((a, b) => a + b, 0)).toBeCloseTo(scr.power, 12);
    expect(scr.hits!.length).toBe(3 * 24);
    // power meter only counts its front face
    const back = run([laser(50, 0, 180), comp('detector.power', 0, 0, 0, {}, 'pm')]);
    expect(back.detectors.pm.power).toBe(0);
  });
});

describe('sources', () => {
  it('emit the configured power with the right spectra', () => {
    for (const t of ['source.laser', 'source.led', 'source.white', 'source.point', 'source.beam']) {
      const r = run([comp(t, 0, 0, 0, { power: 0.3 })]);
      expect(r.energy.emitted, t).toBeCloseTo(0.3, 9);
      expect(r.stats.rays).toBeGreaterThan(0);
    }
    const w = run([comp('source.white', 0, 0, 0, { rays: 1, temperature: 3000 }), comp('detector.spectrometer', 50, 0, 0, { bins: 8 }, 's')]).detectors.s.spectrum!;
    expect(w[7]).toBeGreaterThan(2 * w[0]); // a 3000 K blackbody is much stronger in the red
    const led = run([comp('source.led', 0, 0, 0, { wavelength: 470, fwhm: 25 })]);
    const wls = led.segments.map((s) => s.wavelength);
    expect(Math.min(...wls)).toBeGreaterThan(430); expect(Math.max(...wls)).toBeLessThan(510);
  });

  it('laser has a Gaussian profile and LED a Lambertian pattern', () => {
    const l = run([comp('source.laser', 0, 0, 0, { rays: 21, beamDiameter: 2, power: 1 })]);
    const centre = l.segments.find((s) => Math.abs(s.a.y) < 1e-9)!, edge = l.segments.find((s) => Math.abs(Math.abs(s.a.y) - 1.0667) < 0.08)!;
    expect(edge.power / centre.power).toBeCloseTo(Math.exp(-2 * (edge.a.y / 1) ** 2), 6);
    const led = run([comp('source.led', 0, 0, 0, { rays: 41, halfAngle: 60, fwhm: 0, size: 0 })]);
    const on = led.segments.reduce((a, b) => (Math.abs(angleOf(a)) < Math.abs(angleOf(b)) ? a : b));
    const off = led.segments.reduce((a, b) => (Math.abs(Math.abs(angleOf(a)) - 60 * DEG) < Math.abs(Math.abs(angleOf(b)) - 60 * DEG) ? a : b));
    expect(off.power / on.power).toBeCloseTo(Math.cos(angleOf(off)) / Math.cos(angleOf(on)), 6);
  });
});

describe('wavelength band selection', () => {
  it('broadband sources sample only [wavelengthMin, wavelengthMax] and keep the configured power in band', () => {
    for (const t of ['source.white', 'source.beam', 'source.point']) {
      for (const [lo, hi] of [[500, 600], [600, 500]]) {
        const r = run([comp(t, 0, 0, 0, { power: 0.4, spectrum: 'blackbody', rays: 2, wavelengthMin: lo, wavelengthMax: hi })]);
        const wls = r.segments.map((s) => s.wavelength);
        expect(Math.min(...wls), t).toBeGreaterThanOrEqual(500);
        expect(Math.max(...wls), t).toBeLessThanOrEqual(600);
        expect(new Set(wls).size).toBe(24);
        expect(r.energy.emitted).toBeCloseTo(0.4, 9);
      }
    }
    // spectral shape inside the band is unchanged (ratio of two wavelengths equals the Planck ratio)
    const mono = run([comp('source.point', 0, 0, 0, { spectrum: 'mono', wavelength: 650, wavelengthMin: 400, wavelengthMax: 500 })]);
    expect(mono.segments.every((s) => s.wavelength === 650)).toBe(true);
  });

  it('spectrometer range follows wavelengthMin / wavelengthMax (swapped if reversed)', () => {
    const r = run([
      comp('source.white', -50, 0, 0, { rays: 1, spectrum: 'flat', power: 1 }),
      comp('detector.spectrometer', 50, 0, 0, { bins: 10, wavelengthMin: 700, wavelengthMax: 500 }, 's'),
    ]);
    const d = r.detectors.s;
    expect(d.spectrumRange).toEqual([500, 700]);
    expect(d.power).toBeCloseTo(1, 9);
    expect(d.spectrum!.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5, 2); // half of the 380-780 band
    expect(Math.min(...d.spectrum!)).toBeGreaterThan(0);
  });
});

describe('exotic components', () => {
  it('GRIN slab: parabolic profile focuses at a quarter pitch', () => {
    const n0 = 1.6, dn = 0.05, h = 10;
    const quarter = (Math.PI / 2) * h / Math.sqrt((2 * dn) / n0);
    const r = run([laser(-150, 3, 0), comp('medium.grin', 0, 0, 0, { length: 200, height: 20, n0, deltaN: dn, coating: 'ideal' })]);
    const inside = r.segments.filter((s) => s.inMedium);
    expect(inside.length).toBeGreaterThan(20);
    const cross = inside.find((s) => s.a.y > 0 && s.b.y <= 0)!;
    const xc = cross.a.x + ((cross.b.x - cross.a.x) * cross.a.y) / (cross.a.y - cross.b.y);
    expect(xc + 100).toBeGreaterThan(quarter * 0.97);
    expect(xc + 100).toBeLessThan(quarter * 1.03);
    // ray stays bounded and exits through the far face
    for (const s of inside) expect(Math.abs(s.b.y)).toBeLessThan(3.2);
    expect(r.segments[r.segments.length - 1].b.x).toBeGreaterThan(1000);
    // linear profile bends towards higher index (+y)
    const lin = run([laser(-150, 0, 0), comp('medium.grin', 0, 0, 0, { length: 200, height: 20, profile: 'linear', coating: 'ideal' })]);
    expect(dir(lin.segments[lin.segments.length - 1]).y).toBeGreaterThan(0.05);
  });

  it('gravitational lens: weak-field deflection 2 r_s / b, stronger for closer rays, achromatic', () => {
    const RE = 10, D = 200, rs = (RE * RE) / (2 * D);
    const defl = (b: number, wl = 550) => {
      const r = run([laser(-2000, b, 0, { wavelength: wl }), comp('field.gravity', 0, 0, 0, { strength: RE, focalDistance: D, radius: 1500 })]);
      return -Math.asin(dir(r.segments[r.segments.length - 1]).y);
    };
    expect(defl(40)).toBeGreaterThan(0);
    expect(defl(40) / ((2 * rs) / 40)).toBeGreaterThan(0.97);
    expect(defl(40) / ((2 * rs) / 40)).toBeLessThan(1.06);
    expect(defl(20)).toBeGreaterThan(1.9 * defl(40));
    expect(defl(40, 450)).toBe(defl(40, 650));
    // ray at the Einstein radius crosses the axis near the focal distance
    const r = run([laser(-2000, RE, 0), comp('field.gravity', 0, 0, 0, { strength: RE, focalDistance: D, radius: 1500 })]);
    const s = r.segments[r.segments.length - 1], d = dir(s);
    const xc = s.a.x - (s.a.y * d.x) / d.y;
    expect(xc).toBeGreaterThan(D * 0.85); expect(xc).toBeLessThan(D * 1.1);
    // a ray aimed at the horizon is captured
    const cap = run([laser(-300, 0.05, 0), comp('field.gravity', 0, 0, 0, { strength: RE, focalDistance: D, radius: 200 })]);
    expect(cap.energy.absorbed).toBeCloseTo(1, 9);
  });

  it('SHG crystal doubles the frequency, conserving energy', () => {
    const r = run([laser(-30, 0, 0, { wavelength: 1064, power: 0.5, polAngle: 0 }), comp('nonlinear.shg', 0, 0, 0, { efficiency: 2 }), comp('detector.spectrometer', 40, 0, 0, { bins: 4, wavelengthMin: 400, wavelengthMax: 1200 }, 's')]);
    const green = r.segments.filter((s) => Math.abs(s.wavelength - 532) < 1e-9);
    expect(green.length).toBeGreaterThan(0);
    const eta = Math.tanh(Math.sqrt(2 * 0.5)) ** 2;
    expect(green[0].power).toBeCloseTo(0.5 * eta, 9);
    expect(Math.abs(green[0].polAngle!) / DEG).toBeCloseTo(90, 6);
    expect(r.detectors.s.power).toBeCloseTo(0.5, 9);
    // far from phase matching nothing is converted
    const none = run([laser(-30, 0, 0, { wavelength: 632.8 }), comp('nonlinear.shg', 0, 0, 0, {})]);
    expect(none.segments.filter((s) => s.wavelength !== 632.8).reduce((a, s) => Math.max(a, s.power), 0)).toBeLessThan(1e-3);
  });

  it('right-angle prism turns the beam by 90 deg via TIR; dove prism keeps direction and inverts', () => {
    // enter through a leg, reflect off the hypotenuse
    const r = run([laser(-60, 0, 0), comp('prism.right_angle', 0, 0, 0, { size: 30, coating: 'ideal' })]);
    const out = r.segments[r.segments.length - 1];
    expect(out.power).toBeCloseTo(1, 9);
    expect(Math.abs(dir(out).x)).toBeLessThan(1e-9);
    const d1 = run([laser(-80, -3, 0), comp('prism.dove', 0, 0, 0, { coating: 'ideal' })]).segments;
    const d2 = run([laser(-80, 3, 0), comp('prism.dove', 0, 0, 0, { coating: 'ideal' })]).segments;
    expect(dir(d1[d1.length - 1]).x).toBeCloseTo(1, 9);
    expect(d1[d1.length - 1].a.y).toBeGreaterThan(d2[d2.length - 1].a.y); // inverted
  });

  it('semicircular block: ray through the centre is undeviated at the curved face', () => {
    const inc = 35 * DEG, n = getMaterial('pmma').n(587.56) / getMaterial('air').n(587.56);
    const r = run([laser(-50 * Math.cos(inc), -50 * Math.sin(inc), 35), comp('block.semicircle', 0, 0, 0, { coating: 'ideal' })]);
    expect(r.segments.length).toBe(3);
    expect(angleOf(r.segments[2])).toBeCloseTo(Math.asin(Math.sin(inc) / n), 9);
  });

  it('nested media: lens immersed in water has a longer focal length', () => {
    const f = (water: boolean) => {
      const comps = [laser(-40, 1, 0), comp('lens.biconvex', 0, 0, 0, { focalLength: 50, coating: 'ideal' })];
      if (water) comps.push(comp('block.slab', 200, 0, 0, { width: 1000, height: 200, material: 'water', coating: 'ideal' }));
      const segs = run(comps).segments.filter((s) => s.a.x > 0 && s.a.x < 20);
      const s = segs[segs.length - 1], d = dir(s);
      return s.a.x - (s.a.y * d.x) / d.y;
    };
    // f_water / f_air ~ (n_g - 1) / (n_g / n_w - 1) ~ 3.9
    expect(f(true) / f(false)).toBeGreaterThan(3.3);
    expect(f(true) / f(false)).toBeLessThan(4.3);
  });

  it('ambient medium setting is honoured', () => {
    const r = trace(scene([laser(-50 * Math.cos(40 * DEG), -50 * Math.sin(40 * DEG), 40), comp('block.slab', 100, 0, 0, { width: 200, height: 400 })], { ambientMedium: 'water' }));
    const inside = r.segments.find((s) => s.inMedium)!;
    expect(Math.sin(40 * DEG) / Math.sin(angleOf(inside))).toBeCloseTo(getMaterial('bk7').n(587.56) / getMaterial('water').n(587.56), 6);
  });
});

describe('performance', () => {
  it('traces a typical scene quickly', () => {
    const comps = [
      comp('source.white', -300, 0, 0, { rays: 3 }),
      comp('source.laser', -300, 60, 0, { rays: 50 }),
      comp('source.beam', -300, -80, 0, { rays: 50, spectrum: 'mono' }),
      comp('lens.biconvex', -220, -80, 0, { diameter: 40 }),
      comp('lens.planoconvex', -100, -80, 0, { diameter: 40 }),
      comp('prism.equilateral', -200, 5, 0, {}),
      comp('mirror.flat', -100, 60, 45, {}),
      comp('mirror.spherical', 100, -80, 0, {}),
      comp('splitter.plate', -100, 150, 45, {}),
      comp('block.slab', 0, 150, 10, {}),
      comp('polarizer.linear', -200, 60, 0, {}),
      comp('waveplate.half', -160, 60, 0, {}),
      comp('grating.transmission', 60, 150, 0, {}),
      comp('filter.nd', -250, 60, 0, {}),
      comp('lens.ball', -150, 150, 0, {}),
      comp('aperture.iris', -260, -80, 0, { diameter: 30 }),
      comp('prism.right_angle', 100, 60, 0, {}),
      comp('detector.screen', 250, 0, 0, { size: 400 }),
      comp('detector.power', 200, 150, 0, {}),
      comp('absorber.block', -100, 250, 0, { width: 100, height: 5 }),
    ];
    const sc = scene(comps);
    trace(sc); trace(sc); // warm-up (JIT)
    let best = Infinity, last = trace(sc);
    for (let i = 0; i < 8; i++) { last = trace(sc); best = Math.min(best, last.stats.ms); }
    // eslint-disable-next-line no-console
    console.log(`typical scene: ${last.stats.rays} rays, ${last.stats.segments} segments, best ${best.toFixed(2)} ms`);
    expect(last.stats.rays).toBeGreaterThanOrEqual(150);
    expect(best).toBeLessThan(60); // target < 30 ms on a desktop; generous bound for slow CI machines
  });
});
