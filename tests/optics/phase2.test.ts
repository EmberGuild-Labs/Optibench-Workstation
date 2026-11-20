/** Time of flight, laser realism and the beam-steering / modulation components. */
import { describe, expect, it } from 'vitest';
import {
  aomBraggAngle, componentTimeTransmission, gaussianBeamProfile, laserCavityOutput, opticsEngine, refractiveIndex,
  sourceTemporalEnvelope, trace,
} from '../../src/core/optics';
import { DEG, angleOf, comp, dir, laser, run, scene } from './helpers';

const C = 299792458e3; // mm/s

describe('time of flight (t0 / t1)', () => {
  it('every segment carries continuous times; air and glass use the group index', () => {
    const wl = 587.56;
    const r = run([laser(0, 0, 0, { wavelength: wl }), comp('block.slab', 150, 0, 0, { width: 100, height: 40, material: 'bk7', coating: 'ideal' }), comp('detector.power', 400, 0, 0, {}, 'det')]);
    const main = r.segments.filter((s) => s.sourceId === 'laser').sort((a, b) => a.t0! - b.t0!);
    expect(main.length).toBe(3);
    for (const s of r.segments) { expect(s.t0).toBeGreaterThanOrEqual(0); expect(s.t1!).toBeGreaterThan(s.t0!); }
    expect(main[0].t0).toBe(0);
    expect(main[1].t0).toBeCloseTo(main[0].t1!, 20);
    expect(main[2].t0).toBeCloseTo(main[1].t1!, 20);
    const nAir = refractiveIndex('air', wl);
    expect(main[0].t1! * C / 100).toBeCloseTo(nAir, 3);
    // group index of N-BK7 at 587.6 nm: n - lambda dn/dlambda = 1.5168 + 0.5876 * 0.0418 ~ 1.542 (> phase index)
    const n = refractiveIndex('bk7', wl);
    const ng = n - wl * (refractiveIndex('bk7', wl + 1) - refractiveIndex('bk7', wl - 1)) / 2;
    const tGlass = main[1].t1! - main[1].t0!;
    expect(tGlass * C / 100).toBeCloseTo(ng, 6);
    expect(ng).toBeGreaterThan(n + 0.02);
    expect(ng).toBeCloseTo(1.542, 2);
    expect(main[2].t1! * 1e9).toBeCloseTo((300 * nAir + 100 * ng) / C * 1e9, 4); // ~1.5 ns
  });

  it('fibre delay = length x n_g / c', () => {
    const r = run([laser(0, 0, 0, { wavelength: 850 }), comp('fiber.cable', 50, 0, 0, { endX: 200, endY: 0, length: 10, coreIndex: 1.4585 }), comp('detector.power', 300, 0, 0, { size: 60 }, 'det')]);
    const out = r.segments.filter((s) => s.a.x > 199).sort((a, b) => b.power - a.power)[0];
    const delay = out.t0! - 50 / C * refractiveIndex('air', 850);
    expect(delay * 1e9).toBeGreaterThan(48.5); // 10 m x 1.4585 / c = 48.65 ns; group index adds ~0.7 %
    expect(delay * 1e9).toBeLessThan(49.3);
  });

  it('GRIN media accumulate time along the curved path', () => {
    const r = run([laser(0, 2, 0, {}), comp('medium.grin', 100, 0, 0, { length: 80, coating: 'ideal' }), comp('detector.power', 300, 0, 0, { size: 80 }, 'det')]);
    const inside = r.segments.filter((s) => s.inMedium);
    expect(inside.length).toBeGreaterThan(3);
    const t = inside.reduce((m, s) => Math.max(m, s.t1!), 0) - inside.reduce((m, s) => Math.min(m, s.t0!), Infinity);
    expect(t * C / 80).toBeGreaterThan(1.59);
    expect(t * C / 80).toBeLessThan(1.70);
  });
});

describe('laser realism', () => {
  it('temporal envelope: cw, pulsed (unit average, Gaussian pulses) and modulated', () => {
    const cw = comp('source.laser', 0, 0);
    expect(sourceTemporalEnvelope(cw, 0.123)).toBe(1);
    const pulsed = comp('source.laser', 0, 0, 0, { mode: 'pulsed', pulseWidth: 1e-10, repRate: 1e8 });
    const peak = sourceTemporalEnvelope(pulsed, 0);
    expect(peak).toBeCloseTo(1 / (1e8 * 1e-10 * 1.0644670194), 6); // ~93.9 x average
    expect(sourceTemporalEnvelope(pulsed, 0.5e-10) / peak).toBeCloseTo(0.5, 9); // half maximum at +- FWHM / 2
    expect(sourceTemporalEnvelope(pulsed, 5e-9)).toBeLessThan(1e-12);         // dark between pulses
    expect(sourceTemporalEnvelope(pulsed, 3e-8)).toBeCloseTo(peak, 6);         // periodic
    let avg = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) avg += sourceTemporalEnvelope(pulsed, ((i + 0.5) / N) * 1e-8);
    expect(avg / N).toBeCloseTo(1, 3);
    const mod = comp('source.laser', 0, 0, 0, { mode: 'modulated', modulationFreq: 1000, modulationDepth: 0.6 });
    expect(sourceTemporalEnvelope(mod, 0)).toBeCloseTo(1, 12);
    expect(sourceTemporalEnvelope(mod, 0.25e-3)).toBeCloseTo(1.6, 9);
    expect(sourceTemporalEnvelope(mod, 0.75e-3)).toBeCloseTo(0.4, 9);
    // a trace at a given time follows the modulation; a static trace carries the average
    const sc = scene([Object.assign(mod, { id: 'L' }), comp('detector.power', 100, 0, 0, {}, 'det')]);
    const p0 = trace(sc).detectors.det.power;
    expect(trace(sc, { time: 0.25e-3 }).detectors.det.power / p0).toBeCloseTo(1.6, 6);
  });

  it('Gaussian beam: divergence derived from the waist (and vice versa)', () => {
    const g = gaussianBeamProfile(comp('source.laser', 0, 0, 0, { beamModel: 'gaussian', beamDiameter: 1, wavelength: 632.8, m2: 1 }));
    expect(g.w0).toBeCloseTo(0.5, 12);
    expect(g.theta).toBeCloseTo(632.8e-6 / (Math.PI * 0.5), 12); // 0.403 mrad half-angle
    expect(g.zR).toBeCloseTo((Math.PI * 0.25) / 632.8e-6, 6);     // 1241 mm
    expect(g.waistPos).toBe(0);
    const g2 = gaussianBeamProfile(comp('source.laser', 0, 0, 0, { beamModel: 'gaussian', beamDiameter: 1, wavelength: 632.8, m2: 2 }));
    expect(g2.theta).toBeCloseTo(2 * g.theta, 12);
    // manual model: 1 mm beam with 2 mrad full divergence -> waist radius lambda / (pi theta) behind the exit
    const m = gaussianBeamProfile(comp('source.laser', 0, 0, 0, { beamDiameter: 1, divergence: 2, wavelength: 632.8 }));
    expect(m.theta).toBeCloseTo(1e-3, 12);
    expect(m.w0).toBeCloseTo(632.8e-6 / (Math.PI * 1e-3), 9);
    expect(m.zR).toBeCloseTo(m.w0 / m.theta, 9);
    expect(m.waistPos).toBeLessThan(0);
    expect(m.w0 * Math.sqrt(1 + (m.waistPos / m.zR) ** 2)).toBeCloseTo(0.5, 9); // w(z) at the exit = beam radius
    // the traced rays use the derived divergence: marginal ray at the 1/e^2 radius has slope theta
    const r = run([comp('source.laser', 0, 0, 0, { beamModel: 'gaussian', beamDiameter: 0.2, wavelength: 632.8, rays: 9 }, 'L')]);
    const top = r.segments.reduce((b, s) => (s.a.y > b.a.y ? s : b));
    expect(angleOf(top) / ((top.a.y / 0.1) * (632.8e-6 / (Math.PI * 0.1)))).toBeCloseTo(1, 3);
  });

  it('laser cavity: threshold, slope efficiency and optimum output coupling', () => {
    const cav = (props: Record<string, number>) => comp('source.laser_cavity', 0, 0, 0, props, 'cav');
    const o = laserCavityOutput(cav({}));
    const delta = 0.02 - Math.log(0.95);
    expect(o.threshold).toBeCloseTo(4 * delta, 9);
    expect(o.slope).toBeCloseTo(0.8 * (808 / 1064) * (-Math.log(0.95) / delta), 9);
    expect(o.power).toBeCloseTo(o.slope * (2 - o.threshold), 9);
    expect(laserCavityOutput(cav({ pumpPower: o.threshold * 0.9 })).power).toBe(0);
    const det = (props: Record<string, number>) => run([cav(props), comp('detector.power', 100, 0, 0, {}, 'det')]).detectors.det.power;
    expect(det({})).toBeCloseTo(o.power, 3);
    expect(det({ pumpPower: 0.1 })).toBe(0);
    // an optimum coupler exists: too little coupling wastes the light on parasitic loss, too much pushes the threshold up
    const p = [0.999, 0.9, 0.5].map((R) => laserCavityOutput(cav({ couplerR: R })).power);
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p[1]).toBeGreaterThan(p[2]);
    const wm = run([cav({}), comp('detector.wavemeter', 100, 0, 0, {}, 'wm')]).detectors.wm;
    expect(wm.meanWavelength).toBeCloseTo(1064, 6);
  });
});

describe('beam steering and modulation components', () => {
  it('galvo mirror: the beam turns by twice the mechanical angle; drivable', () => {
    const out = (angle: number, drive?: number) => {
      const sc = scene([laser(0, 0, 0, {}), comp('mirror.galvo', 100, 0, 45, { angle, coating: 'ideal' }, 'g')]);
      const r = trace(sc, drive === undefined ? undefined : { propOverrides: { g: { angle: drive } } });
      return angleOf(r.segments.filter((s) => s.depth === 1)[0]);
    };
    const a0 = out(0);
    expect(Math.abs(a0)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(out(5) - a0)).toBeCloseTo(10 * DEG, 9);
    expect(Math.abs(out(-3) - a0)).toBeCloseTo(6 * DEG, 9);
    expect(out(0, 5)).toBeCloseTo(out(5), 12);
  });

  it('AOM: first order at 2 theta_B with sin(theta_B) = lambda f / (2 v); efficiency follows drive and Bragg matching', () => {
    const wl = 632.8, f = 80, v = 4200;
    const thB = aomBraggAngle(wl, f, v);
    expect(Math.sin(thB)).toBeCloseTo((wl * 1e-9 * f * 1e6) / (2 * v), 12); // 6.03 mrad
    const go = (rotDeg: number, drive: number) => {
      const r = run([laser(0, 0, 0, { wavelength: wl }), comp('modulator.aom', 100, 0, rotDeg, { drive, frequency: f, velocity: v, efficiency: 0.85 }, 'aom')]);
      const outs = r.segments.filter((s) => s.a.x > 99.9);
      const zero = outs.filter((s) => Math.abs(angleOf(s)) < 1e-9)[0];
      const first = outs.filter((s) => Math.abs(angleOf(s)) > 1e-6).sort((a, b) => b.power - a.power)[0];
      return { zero: zero?.power ?? 0, first: first?.power ?? 0, angle: first ? angleOf(first) : 0, total: outs.reduce((s, x) => s + x.power, 0) };
    };
    // cell tilted to the Bragg angle
    const on = go(thB / DEG, 1);
    const nAir = refractiveIndex('air', wl);
    // separation between the orders: sin(theta_1 - tilt) + sin(tilt) = lambda f / (n_air v)
    expect(Math.abs(on.angle)).toBeCloseTo(Math.asin((wl * 1e-9 * f * 1e6) / (v * nAir) - Math.sin(thB)) + thB, 9);
    expect(Math.abs(on.angle) / (2 * thB)).toBeCloseTo(1, 3);
    expect(on.first).toBeCloseTo(0.85, 3);
    // the rest stays in the zero order, apart from a weak mismatched -1 order (finite interaction length)
    expect(on.zero).toBeGreaterThan(0.1);
    expect(on.zero).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(on.total).toBeCloseTo(1, 9);
    const half = go(thB / DEG, 0.5);
    expect(half.first).toBeCloseTo(0.425, 3);
    expect(go(thB / DEG, 0).first).toBe(0);
    // the opposite tilt selects the other order; a large tilt kills the diffraction
    expect(go(-thB / DEG, 1).angle).toBeCloseTo(-on.angle, 9);
    expect(go(3, 1).first).toBeLessThan(0.02);
    // doubling the frequency doubles the deflection
    const r2 = run([laser(0, 0, 0, { wavelength: wl }), comp('modulator.aom', 100, 0, aomBraggAngle(wl, 160, v) / DEG, { frequency: 160, velocity: v })]);
    const f2 = r2.segments.filter((s) => s.a.x > 99.9 && Math.abs(angleOf(s)) > 1e-6).sort((a, b) => b.power - a.power)[0];
    expect(Math.abs(angleOf(f2)) / Math.abs(on.angle)).toBeCloseTo(2, 2);
  });

  it('corner cube: the beam returns antiparallel for any angle of incidence (hollow and solid)', () => {
    for (const construction of ['hollow', 'solid']) {
      // the solid prism only retro-reflects while both internal reflections stay total (a few degrees)
      for (const tilt of construction === 'solid' ? [0, 3, -3] : [0, 8, -15]) {
        for (const y of [3, -6]) {
          const r = run([laser(0, y, 0, {}), comp('retro.corner_cube', 100, 0, tilt, { size: 40, construction, coating: 'ideal' }, 'cc')]);
          const back = r.segments.filter((s) => s.b.x < -1000).sort((a, b) => b.power - a.power)[0];
          expect(back, `${construction} ${tilt} ${y}`).toBeDefined();
          const d = dir(back);
          expect(d.x).toBeCloseTo(-1, 9);
          expect(d.y).toBeCloseTo(0, 9);
          expect(back.power).toBeGreaterThan(0.99);
          if (construction === 'hollow' && tilt === 0) expect(back.a.y + back.a.x * 0).toBeCloseTo(-y, 9); // mirrored through the apex
        }
      }
    }
  });

  it('chopper: static trace = duty cycle; with a time it is open or closed at the chopping frequency', () => {
    const ch = comp('chopper.wheel', 100, 0, 0, { frequency: 100, slots: 10, duty: 0.3 }, 'ch');
    const sc = scene([laser(0, 0, 0, {}), ch, comp('detector.power', 200, 0, 0, {}, 'det')]);
    expect(componentTimeTransmission(ch)).toBeCloseTo(0.3, 12);
    expect(trace(sc).detectors.det.power).toBeCloseTo(0.3, 9);
    let open = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) / N) * 0.05; // five periods of 10 ms
      const T = componentTimeTransmission(ch, t);
      expect(T === 0 || T === 1).toBe(true);
      open += T;
      if (i % 97 === 0) expect(trace(sc, { time: t }).detectors.det.power).toBeCloseTo(T, 9);
    }
    expect(open / N).toBeCloseTo(0.3, 2);
    expect(componentTimeTransmission(ch, 0.001)).toBe(1);
    expect(componentTimeTransmission(ch, 0.005)).toBe(0);
    expect(componentTimeTransmission(ch, 0.011)).toBe(1); // period 10 ms
    // the wheel angle shifts the phase: one slot period = 36 deg, so 18 deg = half a period
    const shifted = { ...ch, props: { ...ch.props, phase: 18 } };
    expect(componentTimeTransmission(shifted, 0.001)).toBe(0);
    expect(componentTimeTransmission(shifted, 0.006)).toBe(1);
    expect(componentTimeTransmission(comp('lens.ideal', 0, 0), 1)).toBe(1);
  });

  it('LCD panel: addressed pixels switch with the voltage, the others stay bright', () => {
    const power = (y: number, voltage: number, extra = {}) => run([
      laser(0, y, 0, { polarization: 'linear', polAngle: 0 }),
      comp('display.lcd_panel', 100, 0, 0, { pattern: '1010', pixels: 4, size: 40, voltage, transmission: 1, ...extra }, 'lcd'),
      comp('detector.polarimeter', 200, 0, 0, { size: 60 }, 'det'),
    ]).detectors.det;
    // pixel 0 (y in -20..-10) is addressed, pixel 1 (-10..0) is not
    expect(power(-15, 0).power).toBeCloseTo(1, 6);
    expect(power(-15, 5).power).toBeCloseTo(1 / 500, 6);
    expect(power(-5, 5).power).toBeCloseTo(1, 6);
    const mid = power(-15, 2.5).power; // half way between threshold and saturation
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(power(-15, 0).stokes!.s1).toBeCloseTo(-1, 6); // leaves s-polarized (crossed analyser)
    expect(power(-15, 0, { mode: 'black' }).power).toBeCloseTo(1 / 500, 6);
    expect(power(-15, 5, { mode: 'black' }).power).toBeCloseTo(1, 6);
    // unpolarized light loses half in the entrance polarizer
    const un = run([laser(0, -15, 0, { polarization: 'unpolarized' }), comp('display.lcd_panel', 100, 0, 0, { pattern: '0', pixels: 4, size: 40, transmission: 1 }), comp('detector.power', 200, 0, 0, { size: 60 }, 'det')]);
    expect(un.detectors.det.power).toBeCloseTo(0.5, 6);
  });

  it('CPC: collects everything inside the acceptance angle, rejects outside; concentration 1 / sin(theta)', () => {
    const cpc = (tiltDeg: number, R = 1) => {
      const t = tiltDeg * DEG;
      // collimated beam aimed at the centre of the entrance aperture (x = -L before the origin)
      const L = (30 + 30 * Math.sin(30 * DEG)) / Math.tan(30 * DEG);
      const cs = [
        comp('source.beam', 200 - L - 300 * Math.cos(t), -300 * Math.sin(t), tiltDeg, { beamWidth: 50 * Math.cos(t), rays: 41, spectrum: 'mono', power: 1 }, 'sun'),
        comp('solar.concentrator', 200, 0, 0, { entranceWidth: 60, acceptanceAngle: 30, reflectivity: R }, 'cpc'),
      ];
      return run(cs).detectors.cpc;
    };
    for (const a of [0, 10, 20, 27]) {
      const d = cpc(a);
      expect(d.power, `inside ${a}`).toBeGreaterThan(0.999);
      expect(d.concentration!).toBeCloseTo(2, 2); // 1 / sin(30 deg)
    }
    for (const a of [33, 40, 55]) {
      const d = cpc(a);
      expect(d.power, `outside ${a}`).toBeLessThan(0.02);
      expect(d.concentration!).toBeLessThan(0.05);
    }
    // lossy walls: rays that need a reflection lose some power
    const lossy = cpc(20, 0.9);
    expect(lossy.power).toBeLessThan(0.99);
    expect(lossy.power).toBeGreaterThan(0.85);
    const g = opticsEngine.getGeometry(comp('solar.concentrator', 0, 0, 0, { entranceWidth: 60, acceptanceAngle: 30 }));
    expect(g.bounds.max.y - g.bounds.min.y).toBeCloseTo(60, 6);
    expect(g.bounds.min.x).toBeCloseTo(-(30 + 15) / Math.tan(30 * DEG), 6);
  });

  it('Fresnel lens: focuses at f, chromatic shift follows the material, groove loss', () => {
    const cross = (wl: number) => {
      const r = run([laser(0, 10, 0, { wavelength: wl }), comp('lens.fresnel', 100, 0, 0, { focalLength: 80, material: 'pmma', transmission: 0.9 }, 'fl')]);
      const s = r.segments.filter((q) => q.a.x > 99.9)[0];
      return { x: s.a.x - s.a.y / Math.tan(angleOf(s)) - 100, p: s.power };
    };
    const d = cross(587.56);
    expect(d.x).toBeCloseTo(80, 6);
    expect(d.p).toBeCloseTo(0.9, 9);
    expect(cross(450).x).toBeLessThan(d.x - 0.5); // blue focuses closer
    expect(cross(700).x).toBeGreaterThan(d.x + 0.3);
  });

  it('Pellin-Broca prism: constant 90 degree deviation at minimum deviation', () => {
    // inside, the ray must hit the reflecting face at 45 deg: refraction angle 30 deg -> sin(i) = n sin(30 deg)
    const wl = 587.56, n = refractiveIndex('sf10', wl) / refractiveIndex('air', wl);
    const inc = Math.asin(n / 2);
    const pb = comp('prism.pellin_broca', 9, 0, 0, { size: 30, material: 'sf10', coating: 'ideal' }, 'pb');
    const x0 = opticsEngine.getGeometry(pb).bounds.min.x; // entrance face
    const r = run([laser(x0 - 100 * Math.cos(inc), -100 * Math.sin(inc), inc / DEG, { wavelength: wl }), pb]);
    const out = r.segments.filter((s) => !s.inMedium && s.depth >= 3).sort((a, b) => b.power - a.power)[0];
    expect(out.power).toBeGreaterThan(0.99);
    let dev = Math.abs(angleOf(out) - inc);
    if (dev > Math.PI) dev = 2 * Math.PI - dev;
    expect(dev).toBeCloseTo(Math.PI / 2, 6);
    // another wavelength is NOT deviated by exactly 90 degrees at this prism angle
    const r2 = run([laser(x0 - 100 * Math.cos(inc), -100 * Math.sin(inc), inc / DEG, { wavelength: 450 }), pb]);
    const out2 = r2.segments.filter((s) => !s.inMedium && s.depth >= 3).sort((a, b) => b.power - a.power)[0];
    expect(Math.abs(Math.abs(angleOf(out2) - inc) - Math.PI / 2)).toBeGreaterThan(0.01);
  });

  it('Amici prism: the design wavelength passes undeviated, blue and red fan out on opposite sides', () => {
    const out = (wl: number) => {
      const r = run([laser(-100, 0, 0, { wavelength: wl }), comp('prism.amici', 0, 0, 0, { size: 20, coating: 'ideal', designWavelength: 587.6 }, 'am')]);
      const s = r.segments.filter((q) => !q.inMedium && q.b.x > 500).sort((a, b) => b.power - a.power)[0];
      return { a: angleOf(s), p: s.power };
    };
    const d = out(587.6);
    expect(d.a).toBeCloseTo(0, 5);
    expect(d.p).toBeGreaterThan(0.98);
    const blue = out(450).a, red = out(680).a;
    expect(blue * red).toBeLessThan(0);
    expect(Math.abs(blue - red)).toBeGreaterThan(2 * DEG);
  });

  it('Galilean beam expander: collimated in, collimated out, M times wider; reversed it reduces', () => {
    const r = run([comp('source.beam', 0, 0, 0, { beamWidth: 4, rays: 5, spectrum: 'mono' }, 'b'), comp('beam.expander', 100, 0, 0, { magnification: 3, length: 60 }, 'bx')]);
    const outs = r.segments.filter((s) => s.a.x > 159.9);
    expect(outs.length).toBe(5);
    for (const s of outs) expect(angleOf(s)).toBeCloseTo(0, 9);
    const ys = outs.map((s) => s.a.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3 * 3.2, 9); // rays span 0.8 x beam width
    const rev = run([comp('source.beam', 300, 0, 180, { beamWidth: 12, rays: 5, spectrum: 'mono' }, 'b'), comp('beam.expander', 100, 0, 0, { magnification: 3, length: 60 }, 'bx')]);
    const o2 = rev.segments.filter((s) => s.a.x < 100.1 && s.b.x < 0);
    expect(o2.length).toBe(5);
    const y2 = o2.map((s) => s.a.y);
    expect(Math.max(...y2) - Math.min(...y2)).toBeCloseTo(9.6 / 3, 9);
  });

  it('ground-glass diffuser: deterministic seeded scatter into the cone, energy conserving', () => {
    const go = (seed: number) => run([laser(0, 0, 0, {}), comp('diffuser.ground_glass', 100, 0, 0, { angle: 10, rays: 9, seed, transmission: 0.9 }, 'df')]);
    const a = go(1), b = go(1), c = go(2);
    const outs = (r: typeof a) => r.segments.filter((s) => s.a.x > 99.9);
    expect(outs(a).length).toBe(9);
    expect(outs(a).reduce((s, x) => s + x.power, 0)).toBeCloseTo(0.9, 9);
    expect(outs(a).map(angleOf)).toEqual(outs(b).map(angleOf));
    expect(outs(a).map(angleOf)).not.toEqual(outs(c).map(angleOf));
    for (const s of outs(a)) expect(Math.abs(angleOf(s))).toBeLessThan(15.01 * DEG);
    const spread = Math.max(...outs(a).map(angleOf)) - Math.min(...outs(a).map(angleOf));
    expect(spread).toBeGreaterThan(15 * DEG);
    const e = a.energy;
    expect(e.detected + e.absorbed + e.escaped + e.dropped).toBeCloseTo(e.emitted, 9);
    // wave mode: speckle on a screen
    const w = run([laser(0, 0, 0, { rays: 9, beamDiameter: 2 }), comp('diffuser.ground_glass', 100, 0, 0, { angle: 5, rays: 15 }), comp('detector.screen', 400, 0, 0, { size: 40 }, 'scr')], { waveMode: true });
    const p = w.detectors.scr.profile!;
    const mean = p.reduce((s, v) => s + v, 0) / p.length;
    const contrast = Math.sqrt(p.reduce((s, v) => s + (v - mean) ** 2, 0) / p.length) / mean;
    expect(contrast).toBeGreaterThan(0.4);
  });

  it('all new types: registry entries, default geometry and a trace without errors (ray and wave mode)', () => {
    const types = ['aperture.double_slit', 'detector.camera', 'detector.polarimeter', 'detector.wavemeter', 'source.laser_cavity', 'mirror.galvo', 'modulator.aom',
      'retro.corner_cube', 'chopper.wheel', 'display.lcd_panel', 'solar.concentrator', 'lens.fresnel', 'prism.pellin_broca', 'prism.amici', 'beam.expander', 'diffuser.ground_glass'];
    for (const t of types) {
      const def = opticsEngine.registry.find((d) => d.type === t);
      expect(def, t).toBeDefined();
      expect(def!.description.length).toBeGreaterThan(80);
      for (const p of def!.params) expect(p.help?.length ?? 0, `${t}.${p.key}`).toBeGreaterThan(5);
      const c = comp(t, 100, 1, 12);
      const g = opticsEngine.getGeometry(c);
      expect(g.paths.length, t).toBeGreaterThan(0);
      for (const path of g.paths) for (const q of path.points) expect(Number.isFinite(q.x) && Number.isFinite(q.y), t).toBe(true);
      for (const waveMode of [false, true]) {
        const r = run([comp('source.white', 0, 0, 0, { rays: 5 }, 'src'), c, comp('detector.screen', 400, 0, 0, { size: 300 }, 'scr')], { waveMode });
        const e = r.energy;
        for (const s of r.segments) expect(Number.isFinite(s.power) && Number.isFinite(s.b.x) && Number.isFinite(s.t1!), `${t} wave=${waveMode}`).toBe(true);
        if (!waveMode) expect((e.detected + e.absorbed + e.escaped + e.dropped) / e.emitted, t).toBeCloseTo(1, 6);
      }
    }
  });
});
