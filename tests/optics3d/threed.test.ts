/** Genuinely three-dimensional behaviour: tilted optics, round beams, images, conical diffraction. */
import { describe, expect, it } from 'vitest';
import type { OpticalComponent } from '../../src/core/types';
import { refractiveIndex } from '../../src/core/optics';
import { convert2Dto3D, flatten3Dto2D, from3D, optics3dEngine, to3D, yawOf } from '../../src/core/optics3d';
import { DEG, comp, dir3, laser, run3, scene } from './helpers';

const posed = (c: OpticalComponent, z = 0, pitch = 0, roll = 0): OpticalComponent => ({ ...c, pose3d: { z, pitch, roll } });
const balance = (r: ReturnType<typeof run3>) => r.energy.detected + r.energy.absorbed + r.energy.escaped + r.energy.dropped;

describe('3D ray tracing', () => {
  it('a mirror pitched by 45 deg sends the beam straight up (+Z)', () => {
    const r = run3([laser(0, 0, 0), posed(comp('mirror.flat', 100, 0, 0), 0, 45)]);
    const d = dir3(r.segments[1]);
    expect(d.x).toBeCloseTo(0, 12); expect(d.y).toBeCloseTo(0, 12); expect(d.z).toBeCloseTo(1, 12);
    expect(r.segments[1].a.x).toBeCloseTo(100, 9);
  });

  it('periscope: two 45 deg mirrors raise the beam by 50 mm', () => {
    const r = run3([
      laser(0, 0, 0), posed(comp('mirror.flat', 100, 0, 0), 0, 45), posed(comp('mirror.flat', 100, 0, 0), 50, 45),
      posed(comp('detector.power', 200, 0, 0, {}, 'pm'), 50),
    ]);
    expect(r.segments.length).toBe(3);
    const out = r.segments[2], d = dir3(out);
    expect(d.x).toBeCloseTo(1, 12); expect(d.z).toBeCloseTo(0, 12);
    expect(out.a.z).toBeCloseTo(50, 9); expect(out.b.z).toBeCloseTo(50, 9); expect(out.b.x).toBeCloseTo(200, 9);
    expect(r.detectors.pm.power).toBeGreaterThan(0.9);
    expect(r.detectors.pm.power).toBeCloseTo(out.power, 12);
    expect(out.polDegree!).toBeGreaterThan(0.999);
  });

  it('a lens focuses a round collimated beam to a point on the axis', () => {
    for (const type of ['lens.ideal', 'lens.planoconvex']) {
      const ideal = type === 'lens.ideal';
      const lens = ideal ? comp(type, 50, 0, 0, { focalLength: 100, size: 30 }) : comp(type, 50, 0, 0, { focalLength: 100, coating: 'ideal' });
      const r = run3([comp('source.beam', 0, 0, 0, { spectrum: 'mono', rays: 37, beamWidth: 6 }, 'src'), lens]);
      expect(r.stats.rays).toBe(37);
      const out = r.segments.filter((s) => !s.inMedium && s.a.x > 49 && dir3(s).x > 0.9);
      expect(out.length).toBe(37);
      let off = 0, inPlane = 0, outOfPlane = 0;
      const xs: number[] = [];
      for (const s of out) {
        const d = dir3(s), rho = Math.hypot(s.a.y, s.a.z);
        if (rho < 1e-9) continue;
        const t = -(s.a.y * d.y + s.a.z * d.z) / (d.y * d.y + d.z * d.z); // closest approach to the x axis
        off = Math.max(off, Math.hypot(s.a.y + t * d.y, s.a.z + t * d.z));
        xs.push(s.a.x + t * d.x);
        if (Math.abs(s.a.z) < 1e-9) inPlane++; else outOfPlane++;
      }
      expect(off).toBeLessThan(1e-9); // meridional rays: every ray crosses the axis
      expect(inPlane).toBeGreaterThan(1); expect(outOfPlane).toBeGreaterThan(10);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      expect(hi - lo).toBeLessThan(ideal ? 1e-9 : 0.5); // real lens: small spherical aberration
      expect(Math.abs((lo + hi) / 2 - 150)).toBeLessThan(ideal ? 1e-9 : 3);
    }
  });

  it('camera image of a laser spot is a round Gaussian', () => {
    const w0 = 1; // 1/e^2 radius
    const r = run3([laser(0, 0, 0, { rays: 600, beamDiameter: 2 * w0, power: 2 }), comp('detector.screen', 50, 0, 0, { size: 8, bins: 32 }, 'cam')]);
    const img = r.detectors.cam.image!;
    expect(img.w).toBe(32); expect(img.h).toBe(32);
    expect(img.data.length).toBe(32 * 32); expect(img.rgb!.length).toBe(32 * 32 * 3);
    const px = 8 / 32;
    const X = (i: number) => ((i % 32) + 0.5) * px - 4, Y = (i: number) => (Math.floor(i / 32) + 0.5) * px - 4;
    let tot = 0, mx = 0, my = 0;
    img.data.forEach((p, i) => { tot += p; mx += p * X(i); my += p * Y(i); });
    expect(tot).toBeCloseTo(2, 9);
    expect(r.detectors.cam.power).toBeCloseTo(2, 9);
    mx /= tot; my /= tot;
    let sxx = 0, syy = 0, sxy = 0;
    img.data.forEach((p, i) => { const x = X(i) - mx, y = Y(i) - my; sxx += p * x * x; syy += p * y * y; sxy += p * x * y; });
    sxx /= tot; syy /= tot; sxy /= tot;
    expect(Math.abs(mx)).toBeLessThan(0.02); expect(Math.abs(my)).toBeLessThan(0.02);
    // Gaussian with 1/e^2 radius w has sigma = w/2 in each direction
    expect(Math.sqrt(sxx)).toBeGreaterThan(0.42 * w0); expect(Math.sqrt(sxx)).toBeLessThan(0.58 * w0);
    expect(Math.sqrt(syy / sxx)).toBeGreaterThan(0.95); expect(Math.sqrt(syy / sxx)).toBeLessThan(1.05);
    expect(Math.abs(sxy)).toBeLessThan(0.01);
    // radial profile falls monotonically (ring-averaged)
    const ringP = [0, 0, 0, 0];
    img.data.forEach((p, i) => { const k = Math.floor(Math.hypot(X(i), Y(i)) / 0.5); if (k < 4) ringP[k] += p / ((2 * k + 1)); });
    expect(ringP[0]).toBeGreaterThan(ringP[1]); expect(ringP[1]).toBeGreaterThan(ringP[2]); expect(ringP[2]).toBeGreaterThan(ringP[3]);
    const peak = img.data.indexOf(Math.max(...img.data));
    expect(img.rgb![3 * peak]).toBeGreaterThan(img.rgb![3 * peak + 2]); // 587 nm is yellow: r > b
  });

  it('Malus law in 3D: rolling a polarizer about the beam turns its axis', () => {
    const T = (roll: number) => run3([
      laser(0, 0, 0, { polAngle: 0 }), posed(comp('polarizer.linear', 50, 0, 0, { transmission: 1, extinction: 1e7 }), 0, 0, roll),
      comp('detector.power', 100, 0, 0, {}, 'pm'),
    ]).detectors.pm.power;
    expect(T(0)).toBeCloseTo(1, 6);
    expect(T(90)).toBeLessThan(1e-6);
    expect(T(30)).toBeCloseTo(Math.cos(30 * DEG) ** 2, 6);
    expect(T(-60)).toBeCloseTo(0.25, 6);
  });

  it('out-of-plane Fresnel uses the true plane of incidence (Brewster about the other axis)', () => {
    // slab pitched to the Brewster angle: the plane of incidence is now the vertical X-Z plane, so
    // light polarized along the table normal (2D "s", polAngle 90) is p-polarized there and passes
    const n = refractiveIndex('bk7', 587.56) / refractiveIndex('air', 587.56);
    const refl = (polAngle: number) => {
      const r = run3([laser(0, 0, 0, { polAngle }), posed(comp('block.slab', 100, 0, 0, { width: 10, height: 100, height3d: 300, coating: 'none' }), 0, Math.atan(n) / DEG)], { minIntensity: 1e-9 });
      return r.segments.filter((s) => s.depth === 1 && !s.inMedium).reduce((m, s) => Math.max(m, s.power), 0);
    };
    expect(refl(90)).toBeLessThan(1e-8);
    expect(refl(0)).toBeGreaterThan(0.1);
  });

  it('conical diffraction obeys the vector grating equation', () => {
    const wl = 532, lines = 1200; // beam climbing 20 deg out of the bench plane
    const r = run3([posed(laser(0, 0, 0, { wavelength: wl }), 0, -20), comp('grating.transmission', 100, 0, 0, { linesPerMm: lines, size: 200 })]);
    const k0 = dir3(r.segments[0]);
    expect(k0.z).toBeCloseTo(Math.sin(20 * DEG), 12);
    const q = (wl * lines * 1e-6) / refractiveIndex('air', wl);
    const orders = r.segments.filter((s) => s.depth === 1).map(dir3);
    expect(orders.length).toBeGreaterThanOrEqual(3);
    const ms = new Set<number>();
    for (const d of orders) {
      expect(d.z).toBeCloseTo(k0.z, 12);                      // component along the grooves is conserved
      const m = (d.y - k0.y) / q;
      expect(Math.abs(m - Math.round(m))).toBeLessThan(1e-9);  // grating-vector component jumps by m lambda/d
      ms.add(Math.round(m));
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    }
    expect(ms.has(0) && ms.has(1) && ms.has(-1)).toBe(true);
  });

  it('gravity is spherically symmetric: same deflection for rays passing beside and above the mass', () => {
    const defl = (y: number, z: number) => {
      const r = run3([posed(laser(-300, y, 0), z), comp('field.gravity', 0, 0, 0, { strength: 10, focalDistance: 200, radius: 90 })]);
      const d = dir3(r.segments[r.segments.length - 1]);
      return { ang: Math.acos(d.x), y: d.y, z: d.z };
    };
    const side = defl(20, 0), above = defl(0, 20);
    expect(side.ang).toBeGreaterThan(0.02);
    expect(above.ang).toBeCloseTo(side.ang, 9);
    expect(above.z).toBeLessThan(0);   // bent down, towards the mass
    expect(side.y).toBeGreaterThan(0); // 2D y = +20 is world Y = -20: bent towards +Y
    expect(Math.abs(above.y)).toBeLessThan(1e-12);
  });

  it('GRIN rod focuses out-of-plane rays like in-plane ones along its gradient axis only', () => {
    const r = run3([posed(laser(0, 3, 0), 0), comp('medium.grin', 100, 0, 0, { length: 80, height: 20, coating: 'ideal' })]);
    const out = r.segments[r.segments.length - 1];
    expect(Math.abs(dir3(out).y)).toBeGreaterThan(0.01);
    expect(Math.abs(dir3(out).z)).toBeLessThan(1e-12);
    const r2 = run3([posed(laser(0, 0, 0), 3), comp('medium.grin', 100, 0, 0, { length: 80, height: 20, coating: 'ideal' })]);
    const o2 = dir3(r2.segments[r2.segments.length - 1]);
    expect(o2.x).toBeCloseTo(1, 12); // index varies along local y only (a slab GRIN): no bending in z
  });

  it('fibre: light entering end A emerges from end B at another height', () => {
    const f = comp('fiber.cable', 100, 0, 0, { endX: 200, endY: 80, endRotation: 0, endZ: 40, length: 1 }, 'fib');
    const r = run3([laser(0, 0, 0, { wavelength: 850 }), f, posed(comp('detector.screen', 260, 80, 0, { size: 120 }, 'scr'), 40)]);
    expect(r.detectors.scr.power).toBeGreaterThan(0.85);
    const out = r.segments.filter((s) => s.a.x > 199.9)[0];
    expect(out.a.z).toBeGreaterThan(39.4); expect(out.a.z).toBeLessThan(40.6);
    expect(-out.a.y).toBeGreaterThan(79.4); expect(-out.a.y).toBeLessThan(80.6);
    expect(dir3(out).x).toBeCloseTo(1, 9);
    expect(out.t0!).toBeGreaterThan(1.4585 / 299792458); // 1 m of fibre
    expect(balance(r)).toBeCloseTo(r.energy.emitted, 9);
    // outside the acceptance cone nothing is guided
    const steep = run3([posed(laser(0, 0, 0, { wavelength: 850 }), -60, -31), f, posed(comp('detector.screen', 260, 80, 0, { size: 120 }, 'scr'), 40)]);
    expect(steep.detectors.scr.power).toBe(0);
  });

  it('time of flight uses the group index', () => {
    const r = run3([laser(0, 0, 0), comp('block.slab', 100, 0, 0, { width: 60, height: 30, coating: 'ideal' })]);
    const [s0, s1, s2] = r.segments;
    const c = 299792458e3;
    const nAir = refractiveIndex('air', 587.56), n = refractiveIndex('bk7', 587.56);
    expect(s0.t0).toBe(0);
    expect((s0.t1! * c) / 70).toBeCloseTo(nAir, 4);
    const ng = ((s1.t1! - s1.t0!) * c) / 60;
    expect(ng).toBeGreaterThan(n + 0.01); expect(ng).toBeLessThan(n + 0.05); // BK7: n_g ~ 1.54 vs n = 1.517
    expect(s2.t0).toBe(s1.t1);
  });

  it('white beam through a tilted prism conserves energy', () => {
    const r = run3([
      comp('source.white', 0, 0, 0, { rays: 7 }), posed(comp('prism.equilateral', 100, 5, 20), 0, 8, 5),
      comp('detector.screen', 300, 0, 0, { size: 600, height3d: 600 }, 'scr'),
    ]);
    expect(r.stats.rays).toBe(7 * 24);
    expect(balance(r) / r.energy.emitted).toBeCloseTo(1, 9);
    expect(r.segments.every((s) => Number.isFinite(s.b.x + s.b.y + s.b.z + s.power + s.t1!))).toBe(true);
    expect(r.detectors.scr.image!.data.reduce((a, b) => a + b, 0)).toBeCloseTo(r.detectors.scr.power, 9);
  });

  it('sources: LED cone and isotropic point source are deterministic and normalised', () => {
    const led = run3([comp('source.led', 0, 0, 0, { rays: 60, power: 0.5 })]);
    expect(led.energy.emitted).toBeCloseTo(0.5, 12);
    expect(led.segments.every((s) => dir3(s).x > 0)).toBe(true);
    const pt = run3([comp('source.point', 0, 0, 0, { rays: 200, power: 1 })]);
    const m = pt.segments.reduce((a, s) => { const d = dir3(s); return { x: a.x + d.x, y: a.y + d.y, z: a.z + d.z }; }, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(m.x, m.y, m.z) / 200).toBeLessThan(0.02); // isotropic
    expect(pt.segments.filter((s) => dir3(s).z > 0).length).toBeGreaterThan(80);
    const again = run3([comp('source.point', 0, 0, 0, { rays: 200, power: 1 })]);
    expect(again.segments.map((s) => s.b.z)).toEqual(pt.segments.map((s) => s.b.z));
  });
});

describe('conventions and conversion', () => {
  it('to3D / from3D / yaw / pose helpers follow the contract', () => {
    expect(to3D({ x: 3, y: 4 }, 5)).toEqual({ x: 3, y: -4, z: 5 });
    expect(from3D({ x: 3, y: -4, z: 5 })).toEqual({ x: 3, y: 4 });
    const c = posed(comp('mirror.flat', 10, 20, 90), 7, 0, 0);
    expect(yawOf(c)).toBeCloseTo(-Math.PI / 2, 12);
    // 2D rotation 90 deg (clockwise on screen) points local +x along 2D +y = world -Y
    const p = optics3dEngine.localToWorld(c, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(10, 12); expect(p.y).toBeCloseTo(-21, 12); expect(p.z).toBeCloseTo(7, 12);
    const up = optics3dEngine.localToWorld(posed(comp('mirror.flat', 0, 0, 0), 0, 0, 90), { x: 0, y: 0, z: 1 });
    expect(up.y).toBeCloseTo(-1, 12); // roll +90 deg about x turns z towards -y
    const q = optics3dEngine.worldToLocal(c, p);
    expect(q.x).toBeCloseTo(1, 12); expect(q.y).toBeCloseTo(0, 12); expect(q.z).toBeCloseTo(0, 12);
    expect(optics3dEngine.poseOf(comp('mirror.flat', 0, 0))).toEqual({ z: 0, pitch: 0, roll: 0 });
  });

  it('convert2Dto3D is idempotent and flatten3Dto2D drops the poses', () => {
    const s = scene([laser(0, 0, 0), posed(comp('mirror.flat', 100, 0, 0), 5, 45, 1)]);
    delete s.components[0].pose3d;
    const a = convert2Dto3D(s), b = convert2Dto3D(a);
    expect(a.components[0].pose3d).toEqual({ z: 0, pitch: 0, roll: 0 });
    expect(a.components[1].pose3d).toEqual({ z: 5, pitch: 45, roll: 1 });
    expect(b).toEqual(a);
    expect(s.components[0].pose3d).toBeUndefined(); // input untouched
    const f = flatten3Dto2D(a);
    expect(f.components.every((c) => !('pose3d' in c))).toBe(true);
    expect(f.components[1].position).toEqual({ x: 100, y: 0 });
  });
});
