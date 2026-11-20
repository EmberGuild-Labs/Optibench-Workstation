/** With all pose3d = 0, the z = 0 slice of the 3D trace must reproduce the 2D trace. */
import { describe, expect, it } from 'vitest';
import { opticsEngine, lensmakerFocal, refractiveIndex } from '../../src/core/optics';
import { DEG, comp, compare, dir3, laser, run2, run3 } from './helpers';
import { dir } from '../optics/helpers';

describe('2D / 3D equivalence in the beam plane', () => {
  it('every non-source registry type: identical segment lists (position, power, polarization)', () => {
    for (const def of opticsEngine.registry) {
      // fibre exit and ground-glass scatter are genuinely 3D (azimuth-scrambled) and are tested in threed.test.ts
      if (def.type.startsWith('source.') || def.type === 'fiber.cable' || def.type === 'diffuser.ground_glass') continue;
      for (const rot of [0, 20, 200]) {
        const r = compare([
          laser(0, 0.7, 3, { polarization: 'linear', polAngle: 30 }),
          comp(def.type, 100, 2, rot), comp('mirror.flat', 220, 0, 10), comp('detector.screen', 300, 0, 0, { size: 400 }),
        ]);
        const tag = `${def.type} @ ${rot}`;
        expect(r.n3, tag).toBe(r.n2);
        expect(r.pos, tag).toBeLessThan(1e-6);
        expect(r.pow, tag).toBeLessThan(1e-9);
        expect(r.z, tag).toBeLessThan(1e-9);
        expect(r.pol, tag).toBeLessThan(1e-6);
      }
    }
  });

  it('prism: same deviation angle and transmitted power; blue deviates more than red', () => {
    const dev = (wl: number) => {
      const cs = [laser(55, 25, -24, { wavelength: wl }), comp('prism.equilateral', 100, 5, 0, { coating: 'none' }), comp('detector.screen', 400, 150, 0, { size: 900 }, 'scr')];
      const a = run2(cs), b = run3(cs);
      const s2 = a.segments.filter((s) => s.depth === 2 && !s.inMedium).sort((p, q) => q.power - p.power)[0];
      const s3 = b.segments.filter((s) => s.depth === 2 && !s.inMedium).sort((p, q) => q.power - p.power)[0];
      const a2 = Math.atan2(dir(s2).y, dir(s2).x), a3 = Math.atan2(-dir3(s3).y, dir3(s3).x);
      expect(a3).toBeCloseTo(a2, 9);
      expect(s3.power).toBeCloseTo(s2.power, 9);
      expect(Math.abs(dir3(s3).z)).toBeLessThan(1e-12);
      expect(b.detectors.scr.power).toBeCloseTo(a.detectors.scr.power, 9);
      return Math.abs(a3 + 24 * DEG);
    };
    const red = dev(650), blue = dev(450);
    expect(blue).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(20 * DEG);
  });

  it('lens focus: paraxial rays cross the axis at the lensmaker focal length in 2D and 3D', () => {
    const f = 100, cs = [laser(0, 0.5, 0, {}, 'l1'), laser(0, -0.5, 0, {}, 'l2'), comp('lens.biconvex', 50, 0, 0, { focalLength: f, coating: 'ideal' })];
    const cross2 = run2(cs).segments.filter((s) => s.depth === 2 && s.sourceId === 'l1').map((s) => s.a.x - (s.a.y * (s.b.x - s.a.x)) / (s.b.y - s.a.y))[0];
    const cross3 = run3(cs).segments.filter((s) => s.depth === 2 && s.sourceId === 'l1').map((s) => s.a.x - (s.a.y * (s.b.x - s.a.x)) / (s.b.y - s.a.y))[0];
    expect(cross3).toBeCloseTo(cross2, 8);
    expect(Math.abs(cross3 - 50 - f)).toBeLessThan(1.5); // principal-plane offset + tiny aberration
    expect(Number.isFinite(lensmakerFocal(1.5168, 100, -100, 3))).toBe(true);
  });

  it('mirror: angle of reflection = angle of incidence, silver reflectance matches 2D', () => {
    const cs = [laser(0, 0, 0), comp('mirror.flat', 100, 0, 30)];
    const a = run2(cs).segments[1], b = run3(cs).segments[1];
    const d = dir3(b);
    // mirror normal at 2D angle 30° -> reflected at 2*30° + 180° in 2D (y down) = (−cos60, −sin60)
    expect(d.x).toBeCloseTo(-Math.cos(60 * DEG), 12);
    expect(-d.y).toBeCloseTo(-Math.sin(60 * DEG), 12);
    expect(d.z).toBeCloseTo(0, 12);
    expect(b.power).toBeCloseTo(a.power, 12);
    expect(b.power).toBeGreaterThan(0.9);
  });

  it('Brewster: p-polarized light is not reflected at tan θ = n, s-polarized is', () => {
    const n = refractiveIndex('bk7', 587.56) / refractiveIndex('air', 587.56);
    const thB = Math.atan(n) / DEG;
    const refl = (polAngle: number, run: typeof run3 | typeof run2) => {
      const r = run([laser(0, 0, 0, { polAngle }), comp('block.slab', 100, 0, thB, { width: 10, height: 200, coating: 'none' })], { minIntensity: 1e-9 });
      return r.segments.filter((s) => s.depth === 1 && !s.inMedium).reduce((m, s) => Math.max(m, s.power), 0);
    };
    expect(refl(0, run3)).toBeLessThan(1e-8);
    expect(refl(90, run3)).toBeGreaterThan(0.1);
    expect(refl(90, run3)).toBeCloseTo(refl(90, run2), 10);
    expect(refl(40, run3)).toBeCloseTo(refl(40, run2), 10);
  });

  it('TIR: right-angle prism turns the beam by 90° without loss (ideal AR faces)', () => {
    const cs = [laser(0, 0, 0), comp('prism.right_angle', 100, 5, 0, { coating: 'ideal', size: 30 }), comp('detector.screen', 100, 200, 90, { size: 300 }, 'scr')];
    const a = run2(cs), b = run3(cs);
    expect(b.segments.length).toBe(a.segments.length);
    const out = b.segments[b.segments.length - 1], d = dir3(out);
    expect(Math.abs(d.x)).toBeLessThan(1e-9);
    expect(Math.abs(d.y)).toBeCloseTo(1, 9);
    expect(out.power).toBeCloseTo(1, 9);
    const o2 = a.segments[a.segments.length - 1];
    expect(-d.y).toBeCloseTo(dir(o2).y, 9);
  });

  it('grating: first order leaves at sin θ = λ / d', () => {
    const wl = 632.8, lines = 600;
    const cs = [laser(0, 0, 0, { wavelength: wl }), comp('grating.transmission', 100, 0, 0, { linesPerMm: lines })];
    const a = run2(cs), b = run3(cs);
    const sines3 = b.segments.filter((s) => s.depth === 1).map((s) => -dir3(s).y).sort((p, q) => p - q);
    const sines2 = a.segments.filter((s) => s.depth === 1).map((s) => dir(s).y).sort((p, q) => p - q);
    const q = (wl * lines * 1e-6) / refractiveIndex('air', wl);
    expect(sines3.length).toBe(5);
    expect(sines3[3]).toBeCloseTo(q, 9);
    expect(sines3[1]).toBeCloseTo(-q, 9);
    expect(sines3[4]).toBeCloseTo(2 * q, 9);
    sines3.forEach((s, i) => expect(s).toBeCloseTo(sines2[i], 10));
  });

  it('Faraday rotation: 45° with the default TGG rod, same as 2D', () => {
    const cs = [laser(0, 0, 0, { wavelength: 632.8, polAngle: 0 }), comp('magneto.faraday', 100, 0, 0)];
    const a = run2(cs), b = run3(cs);
    const o2 = a.segments[a.segments.length - 1], o3 = b.segments[b.segments.length - 1];
    expect(Math.abs(o3.polAngle!)).toBeCloseTo(45 * DEG, 2);
    expect(o3.polAngle!).toBeCloseTo(o2.polAngle!, 10);
    expect(o3.polDegree!).toBeCloseTo(1, 9);
  });
});
