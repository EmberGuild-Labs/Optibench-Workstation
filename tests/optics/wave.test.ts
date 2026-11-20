/** Wave optics: interference, diffraction, coherence, instruments. */
import { describe, expect, it } from 'vitest';
import type { OpticalComponent } from '../../src/core/types';
import { coherenceLengthMm, degreeOfCoherence } from '../../src/core/optics';
import { comp, laser, run } from './helpers';

const WAVE = { waveMode: true };
const WL = 632.8;

function peaks(p: number[], minFrac = 0.05): number[] {
  const out: number[] = [];
  const mx = Math.max(...p);
  for (let i = 1; i < p.length - 1; i++) if (p[i] > p[i - 1] && p[i] >= p[i + 1] && p[i] > minFrac * mx) out.push(i);
  return out;
}
/** Dark fringes (local minima between bright fringes). Unlike the maxima they are not pulled by the single-slit envelope. */
function valleys(p: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(1, lo); i < Math.min(p.length - 1, hi); i++) if (p[i] < p[i - 1] && p[i] <= p[i + 1]) out.push(refine(p, i));
  return out;
}
/** Sub-bin peak position by parabolic interpolation. */
function refine(p: number[], i: number): number {
  const a = p[i - 1], b = p[i], c = p[i + 1];
  return i + (0.5 * (a - c)) / (a - 2 * b + c);
}

/** Michelson interferometer: laser -> 50/50 splitter at 45 deg -> two mirrors -> detector below the splitter. */
function michelson(opts: { shift?: number; arm1?: number; arm2?: number; src?: OpticalComponent; extra?: OpticalComponent[]; det?: OpticalComponent } = {}): OpticalComponent[] {
  const a1 = opts.arm1 ?? 80, a2 = (opts.arm2 ?? 80) + (opts.shift ?? 0);
  return [
    opts.src ?? laser(0, 0, 0, { wavelength: WL, beamDiameter: 1 }),
    comp('splitter.plate', 100, 0, 45, { size: 30 }, 'bs'),
    comp('mirror.flat', 100, -a1, 90, { coating: 'ideal' }, 'm1'),
    comp('mirror.flat', 100 + a2, 0, 0, { coating: 'ideal' }, 'm2'),
    opts.det ?? comp('detector.power', 100, 80, 90, { size: 20 }, 'det'),
    ...(opts.extra ?? []),
  ];
}
const detPower = (cs: OpticalComponent[]) => run(cs, WAVE).detectors.det.power;
/** Fringe visibility while the mirror is scanned over half a wavelength around `shift`. */
function visibility(mk: (shift: number) => OpticalComponent[], shift = 0, lambda = WL): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 16; i++) {
    const p = detPower(mk(shift + (i / 16) * lambda * 0.5e-6));
    lo = Math.min(lo, p); hi = Math.max(hi, p);
  }
  return (hi - lo) / (hi + lo);
}

describe('wave mode: diffraction', () => {
  const young = (d: number, L: number, props = {}) => run([
    laser(0, 0, 0, { rays: 9, beamDiameter: 2, wavelength: WL }),
    comp('aperture.double_slit', 100, 0, 0, { width: 0.04, separation: d, ...props }),
    comp('detector.screen', 100 + L, 0, 0, { size: 60 }, 'scr'),
  ], WAVE);

  it('Young double slit: fringe spacing = lambda L / d within 2 %', () => {
    for (const [d, L] of [[0.25, 1000], [0.4, 800], [0.15, 500]]) {
      const r = young(d, L);
      const p = r.detectors.scr.profile!;
      expect(p.length).toBeGreaterThanOrEqual(512);
      const pk = peaks(p, 0.3).map((i) => refine(p, i));
      expect(pk.length).toBeGreaterThanOrEqual(5);
      // measured on the dark fringes (the bright ones are pulled inwards by a^2 / 3 d^2 by the slit envelope)
      const dk = valleys(p, Math.floor(pk[0]), Math.ceil(pk[pk.length - 1]));
      expect(dk.length).toBe(pk.length - 1);
      const spacing = ((dk[dk.length - 1] - dk[0]) / (dk.length - 1)) * (60 / p.length);
      const expected = (WL * 1e-6 * L) / d;
      expect(Math.abs(spacing / expected - 1)).toBeLessThan(0.01);
      const bright = ((pk[pk.length - 1] - pk[0]) / (pk.length - 1)) * (60 / p.length);
      expect(bright / expected).toBeCloseTo(1 - (0.04 * 0.04) / (3 * d * d), 2);
      // central maximum on the axis, dark fringes really dark
      const mid = p.length / 2;
      expect(Math.min(...pk.map((x) => Math.abs(x - (mid - 0.5))))).toBeLessThan(1.5);
      const c = Math.round(pk[Math.floor(pk.length / 2)]), half = Math.round((expected / 2) * (p.length / 60));
      expect(p[c + half]).toBeLessThan(0.03 * p[c]);
    }
  });

  it('single slit: first minimum at sin(theta) = lambda / a, side lobe ~4.7 % of the peak', () => {
    const a = 0.1, L = 1000;
    const r = run([
      laser(0, 0, 0, { rays: 9, beamDiameter: 2, wavelength: WL }),
      comp('aperture.slit', 100, 0, 0, { width: a }),
      comp('detector.screen', 100 + L, 0, 0, { size: 60 }, 'scr'),
    ], WAVE);
    const p = r.detectors.scr.profile!;
    const n = p.length, du = 60 / n, mid = n / 2;
    const expected = (WL * 1e-6 * L) / a; // 6.33 mm
    // first minimum on the +u side
    let iMin = Math.round(mid + (0.5 * expected) / du);
    for (let i = iMin; i < mid + (1.5 * expected) / du; i++) if (p[i] < p[iMin]) iMin = i;
    const pos = (iMin + 0.5 - mid) * du;
    expect(Math.abs(pos / expected - 1)).toBeLessThan(0.03);
    const peak = Math.max(...p);
    expect(p[iMin]).toBeLessThan(0.002 * peak);
    let side = 0;
    for (let i = iMin; i < mid + (2 * expected) / du; i++) side = Math.max(side, p[i]);
    expect(side / peak).toBeGreaterThan(0.04);
    expect(side / peak).toBeLessThan(0.055);
  });

  it('N slits: principal maxima keep the spacing and get N - 2 subsidiary maxima', () => {
    const r = young(0.25, 1000, { slits: 4 });
    const p = r.detectors.scr.profile!;
    const strong = peaks(p, 0.4).map((i) => refine(p, i));
    const spacing = ((strong[strong.length - 1] - strong[0]) / (strong.length - 1)) * (60 / p.length);
    expect(Math.abs(spacing / ((WL * 1e-6 * 1000) / 0.25) - 1)).toBeLessThan(0.02);
    const all = peaks(p, 0.01);
    const c0 = Math.round(strong[Math.floor(strong.length / 2)]), c1 = Math.round(strong[Math.floor(strong.length / 2) + 1]);
    expect(all.filter((i) => i > c0 + 1 && i < c1 - 1).length).toBe(2);
  });

  it('ray mode is unchanged by the double slit (geometric clipping only) and a slit wider than 2 mm stays geometric', () => {
    const r = run([laser(0, 0, 0, { rays: 9, beamDiameter: 2 }), comp('aperture.double_slit', 100, 0, 0, {}), comp('detector.screen', 300, 0, 0, {}, 'scr')]);
    expect(r.detectors.scr.profile!.length).toBe(64);
    expect(r.stats.rays).toBe(9);
    const w = run([laser(0, 0, 0, { rays: 9, beamDiameter: 2 }), comp('aperture.slit', 100, 0, 0, { width: 5 }), comp('detector.power', 300, 0, 0, {}, 'det')], WAVE);
    expect(w.stats.rays).toBe(9);
    expect(w.detectors.det.power).toBeGreaterThan(0.95);
  });

  it('double-slit demo traces in well under 60 ms', () => {
    young(0.25, 1000);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) young(0.25, 1000);
    expect((performance.now() - t0) / 5).toBeLessThan(60);
  });
});

describe('wave mode: interferometers', () => {
  it('Michelson: equal arms are bright; moving a mirror by lambda/4 swaps bright and dark', () => {
    const bright = detPower(michelson());
    const dark = detPower(michelson({ shift: WL * 0.25e-6 }));
    const again = detPower(michelson({ shift: WL * 0.5e-6 }));
    expect(bright).toBeGreaterThan(0.97);
    expect(dark).toBeLessThan(0.01);
    expect(again).toBeGreaterThan(0.97);
    // an eighth of a wave: half power
    expect(detPower(michelson({ shift: WL * 0.125e-6 }))).toBeCloseTo(0.5, 1);
    // ray mode: no interference, half of the light returns to the laser
    expect(run(michelson()).detectors.det.power).toBeCloseTo(0.5, 6);
  });

  it('Michelson with a tilted mirror: straight fringes of spacing lambda / (2 alpha) on a camera', () => {
    const alpha = 0.5e-3; // rad
    const cs = michelson({ src: laser(0, 0, 0, { wavelength: WL, beamDiameter: 6, rays: 15 }), det: comp('detector.camera', 100, 80, 90, { pixels: 512, pitch: 20 }, 'det') });
    cs[3].rotation = alpha;
    const r = run(cs, WAVE);
    const p = r.detectors.det.profile!;
    expect(p.length).toBe(512);
    expect(Math.max(...p)).toBeCloseTo(0.9, 6); // auto exposure
    expect(r.detectors.det.profileRGB!.length).toBe(3 * 512);
    const pk = peaks(p, 0.2).map((i) => refine(p, i));
    const spacing = ((pk[pk.length - 1] - pk[0]) / (pk.length - 1)) * 0.02;
    expect(Math.abs(spacing / ((WL * 1e-6) / (2 * alpha)) - 1)).toBeLessThan(0.03);
  });

  it('Mach-Zehnder: the two outputs are complementary and sum to the input power', () => {
    // `q`: displacement of the lower mirror along its normal; the path grows by sqrt(2) q
    const mz = (q: number) => run([
      laser(0, 0, 0, { wavelength: WL, beamDiameter: 1 }),
      comp('splitter.plate', 100, 0, 45, { size: 30 }),
      comp('mirror.flat', 200 + q * Math.SQRT1_2, q * Math.SQRT1_2, 45, { coating: 'ideal' }),
      comp('mirror.flat', 100, -100, 45, { coating: 'ideal' }),
      comp('splitter.plate', 200, -100, 45, { size: 30 }),
      comp('detector.power', 200, -180, -90, { size: 20 }, 'd1'),
      comp('detector.power', 280, -100, 0, { size: 20 }, 'd2'),
    ], WAVE).detectors;
    const a = mz(0);
    expect(a.d1.power + a.d2.power).toBeCloseTo(1, 2);
    expect(Math.min(a.d1.power, a.d2.power)).toBeLessThan(0.01);
    // lengthening one arm by lambda/2 swaps the ports
    const b = mz((WL * 0.5e-6) / Math.SQRT2);
    expect(b.d1.power + b.d2.power).toBeCloseTo(1, 2);
    expect(b.d1.power).toBeCloseTo(a.d2.power, 2);
    expect(b.d2.power).toBeCloseTo(a.d1.power, 2);
  });

  it('Fresnel-Arago: orthogonally polarized beams do not interfere; an analyser restores the fringes', () => {
    // quarter-wave plate at 45 deg in arm 2, passed twice = half-wave plate: p becomes s
    const qwp = comp('waveplate.quarter', 140, 0, 0, { fastAxis: 45, designWavelength: WL });
    expect(visibility((s) => michelson({ shift: s }))).toBeGreaterThan(0.97);
    expect(visibility((s) => michelson({ shift: s, extra: [qwp] }))).toBeLessThan(0.02);
    expect(detPower(michelson({ extra: [qwp] }))).toBeCloseTo(0.5, 2);
    const analyser = comp('polarizer.linear', 100, 60, 90, { angle: 45, transmission: 1 });
    expect(visibility((s) => michelson({ shift: s, extra: [qwp, analyser] }))).toBeGreaterThan(0.95);
  });

  it('white light: fringes only near zero path difference', () => {
    const src = () => comp('source.white', 0, 0, 0, { rays: 1, beamWidth: 1, power: 1 }, 'w');
    const mk = (s: number) => michelson({ shift: s, src: src() });
    expect(visibility(mk, 0, 550)).toBeGreaterThan(0.8);
    expect(visibility(mk, 2e-3, 550)).toBeLessThan(0.25);   // OPD 4 um
    expect(visibility(mk, 10e-3, 550)).toBeLessThan(0.05);  // OPD 20 um
    expect(visibility(mk, 0.2, 550)).toBeLessThan(0.02);    // OPD 0.4 mm
    // an LED (30 nm wide) keeps its fringes over ~10 um but not 100 um
    const led = (s: number) => michelson({ shift: s, src: comp('source.led', 0, 0, 0, { rays: 1, size: 0, halfAngle: 2, power: 1, wavelength: 525, fwhm: 30, polarization: 'linear' }, 'led') });
    expect(visibility(led, 0, 525)).toBeGreaterThan(0.9);
    expect(visibility(led, 0.05, 525)).toBeLessThan(0.05);
  });

  it('laser linewidth sets the coherence length L_c = lambda^2 / d_lambda', () => {
    const lw = 0.01; // nm -> L_c = 40 mm
    const g = { wl: WL, bw: 0, fwhm: lw, srcFwhm: lw };
    expect(coherenceLengthMm(g)).toBeCloseTo((WL * WL) / lw * 1e-6, 9);
    expect(degreeOfCoherence(g, 0)).toBe(1);
    const mk = (arm2: number) => (s: number) => michelson({ shift: s, arm2, src: laser(0, 0, 0, { wavelength: WL, beamDiameter: 1, linewidth: lw }) });
    const v1 = visibility(mk(81)), v2 = visibility(mk(90)), v3 = visibility(mk(130));
    expect(v1).toBeGreaterThan(0.97);                                   // OPD 2 mm
    expect(Math.abs(v2 / degreeOfCoherence(g, 20) - 1)).toBeLessThan(0.03); // OPD 20 mm
    expect(v3).toBeLessThan(0.02);                                      // OPD 100 mm
    // a perfectly monochromatic laser interferes at any path difference
    expect(visibility((s) => michelson({ shift: s, arm2: 130 }))).toBeGreaterThan(0.97);
  });
});

describe('instruments', () => {
  it('polarimeter: Stokes parameters of linear, circular and unpolarized light (both modes)', () => {
    for (const settings of [{}, WAVE]) {
      const st = (props: Record<string, string | number>) => run([laser(0, 0, 0, props), comp('detector.polarimeter', 100, 0, 0, {}, 'pol')], settings).detectors.pol.stokes!;
      const lin = st({ polarization: 'linear', polAngle: 30 });
      expect(lin.s0).toBeCloseTo(1, 3);
      expect(lin.s1).toBeCloseTo(Math.cos(Math.PI / 3), 6);
      expect(lin.s2).toBeCloseTo(Math.sin(Math.PI / 3), 6);
      expect(lin.s3).toBeCloseTo(0, 6);
      expect(lin.dop).toBeCloseTo(1, 6);
      expect(lin.azimuth).toBeCloseTo(Math.PI / 6, 6);
      const circ = st({ polarization: 'circular_r' });
      expect(circ.s3).toBeCloseTo(1, 6);
      expect(Math.abs(circ.ellipticity)).toBeCloseTo(Math.PI / 4, 6);
      expect(st({ polarization: 'circular_l' }).s3).toBeCloseTo(-1, 6);
      const un = st({ polarization: 'unpolarized' });
      expect(un.dop).toBeCloseTo(0, 6);
      expect(un.s0).toBeCloseTo(1, 3);
    }
    // quarter-wave plate at 45 deg turns p-polarized light circular
    const r = run([laser(0, 0, 0, { polarization: 'linear', polAngle: 0, wavelength: WL }), comp('waveplate.quarter', 50, 0, 0, { fastAxis: 45, designWavelength: WL }), comp('detector.polarimeter', 100, 0, 0, {}, 'pol')]);
    expect(Math.abs(r.detectors.pol.stokes!.s3)).toBeCloseTo(1, 6);
  });

  it('wavemeter: mean wavelength and linewidth', () => {
    const wm = (props: Record<string, number>, settings = {}) => run([laser(0, 0, 0, props), comp('detector.wavemeter', 100, 0, 0, {}, 'wm')], settings).detectors.wm;
    const a = wm({ wavelength: 532 });
    expect(a.meanWavelength).toBeCloseTo(532, 6);
    expect(a.linewidth).toBeCloseTo(0, 6);
    expect(wm({ wavelength: 532, linewidth: 0.01 }).linewidth).toBeCloseTo(0.01, 6);
    const b = wm({ wavelength: 650, linewidth: 2 });
    expect(b.meanWavelength).toBeCloseTo(650, 3);
    expect(b.linewidth!).toBeGreaterThan(1.4);
    expect(b.linewidth!).toBeLessThan(2.6);
    expect(wm({ wavelength: 532, linewidth: 0.01 }, WAVE).linewidth).toBeCloseTo(0.01, 6);
  });

  it('camera: fixed exposure scales and saturates; screen reports an RGB profile', () => {
    const cam = (props: Record<string, number | boolean>) => run([laser(0, 0, 0, { power: 1e-6, rays: 5, beamDiameter: 2 }), comp('detector.camera', 100, 0, 0, { pixels: 64, pitch: 100, ...props }, 'cam')]).detectors.cam;
    const auto = cam({});
    expect(auto.profile!.length).toBe(64);
    expect(Math.max(...auto.profile!)).toBeCloseTo(0.9, 9);
    expect(auto.power).toBeCloseTo(1e-6, 12);
    const lo = cam({ autoExposure: false, exposure: 1e-4, gain: 1, saturation: 1e-9 });
    const hi = cam({ autoExposure: false, exposure: 1e-4, gain: 4, saturation: 1e-9 });
    const mLo = Math.max(...lo.profile!), mHi = Math.max(...hi.profile!);
    expect(mLo).toBeGreaterThan(0);
    expect(mLo).toBeLessThan(0.25);
    expect(mHi).toBeCloseTo(4 * mLo, 9);
    expect(Math.max(...cam({ autoExposure: false, exposure: 1, gain: 1, saturation: 1e-9 }).profile!)).toBe(1);
    const scr = run([laser(0, 0, 0, { wavelength: 650 }), comp('detector.screen', 100, 0, 0, {}, 'scr')]).detectors.scr;
    const rgb = scr.profileRGB!;
    expect(rgb.length).toBe(3 * scr.profile!.length);
    const i = scr.profile!.indexOf(Math.max(...scr.profile!));
    expect(rgb[3 * i]).toBeGreaterThan(rgb[3 * i + 2]); // red light: R > B
  });
});
