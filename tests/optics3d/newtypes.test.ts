/** 3D behaviour of the modulators, compound prisms, concentrator and instrument detectors. */
import { describe, expect, it } from 'vitest';
import type { OpticalComponent } from '../../src/core/types';
import { refractiveIndex, trace } from '../../src/core/optics';
import { getGeometry3D, trace3D } from '../../src/core/optics3d';
import { DEG, comp, dir3, laser, run2, run3, scene } from './helpers';

const posed = (c: OpticalComponent, z = 0, pitch = 0, roll = 0): OpticalComponent => ({ ...c, pose3d: { z, pitch, roll } });

describe('modulators and steering', () => {
  it('AOM: first order at the Bragg angle; rolled by 90 deg it deflects vertically', () => {
    const wl = 632.8, f = 80e6, v = 4200;
    const sinB = (wl * 1e-9 * f) / (2 * v);
    const thB = Math.asin(sinB) / DEG;
    const r = run3([laser(0, 0, 0, { wavelength: wl }), comp('modulator.aom', 100, 0, thB)]);
    const orders = r.segments.filter((s) => s.depth === 1);
    const first = orders.sort((a, b) => b.power - a.power)[0];
    expect(first.power).toBeCloseTo(0.85, 2);
    // deflected by 2 theta_B from the undiffracted beam, in the bench plane
    expect(Math.abs(dir3(first).y)).toBeCloseTo(Math.sin(2 * Math.asin(sinB / refractiveIndex('air', wl))), 5);
    expect(Math.abs(dir3(first).z)).toBeLessThan(1e-12);
    // acoustic wave along the table normal: tilt about the Y axis (pitch) for Bragg incidence
    const up = run3([laser(0, 0, 0, { wavelength: wl }), posed(comp('modulator.aom', 100, 0, 0), 0, thB, 90)]);
    const f2 = up.segments.filter((s) => s.depth === 1).sort((a, b) => b.power - a.power)[0];
    expect(f2.power).toBeCloseTo(0.85, 2);
    expect(Math.abs(dir3(f2).z)).toBeCloseTo(Math.abs(dir3(first).y), 6);
    expect(Math.abs(dir3(f2).y)).toBeLessThan(1e-9);
  });

  it('galvo mirror deflects by twice its mechanical angle; corner cube retro-reflects in the plane', () => {
    const g = run3([laser(0, 0, 0), comp('mirror.galvo', 100, 0, 0, { angle: 10 })]);
    const d = dir3(g.segments[1]);
    expect(Math.abs(Math.atan2(d.y, -d.x))).toBeCloseTo(20 * DEG, 9);
    const cc = run3([laser(0, -8, 5), comp('retro.corner_cube', 100, 0, 0)]);
    const back = dir3(cc.segments[cc.segments.length - 1]), fwd = dir3(cc.segments[0]);
    expect(cc.segments.length).toBe(3);
    expect(back.x).toBeCloseTo(-fwd.x, 9); expect(back.y).toBeCloseTo(-fwd.y, 9);
  });

  it('chopper follows OpticsDrive.time; static trace transmits the duty cycle', () => {
    const cs = [laser(0, 0, 0), comp('chopper.wheel', 50, 0, 0, { frequency: 100, duty: 0.5 }), comp('detector.power', 100, 0, 0, {}, 'pm')];
    expect(trace3D(scene(cs)).detectors.pm.power).toBeCloseTo(0.5, 9);
    const open = trace3D(scene(cs), { time: 0.001 }).detectors.pm.power, shut = trace3D(scene(cs), { time: 0.006 }).detectors.pm.power;
    expect(open).toBeCloseTo(trace(scene(cs), { time: 0.001 }).detectors.pm.power, 12);
    expect(shut).toBeCloseTo(trace(scene(cs), { time: 0.006 }).detectors.pm.power, 12);
    expect(open + shut).toBeCloseTo(1, 9);
  });

  it('ground glass scatters into a 3D cone, deterministically, conserving T x power', () => {
    const cs = [laser(0, 0, 0), comp('diffuser.ground_glass', 50, 0, 0, { rays: 15, angle: 10, transmission: 0.9 }), comp('detector.screen', 150, 0, 0, { size: 400, height3d: 400 }, 'scr')];
    const r = run3(cs);
    const sc = r.segments.filter((s) => s.depth === 1);
    expect(sc.length).toBe(15);
    expect(r.detectors.scr.power).toBeCloseTo(0.9, 9);
    expect(sc.filter((s) => Math.abs(dir3(s).z) > 0.01).length).toBeGreaterThan(8); // out of the bench plane
    expect(Math.max(...sc.map((s) => Math.acos(dir3(s).x)))).toBeLessThan(16 * DEG);
    expect(run3(cs).segments.map((s) => s.b.z)).toEqual(r.segments.map((s) => s.b.z));
  });
});

describe('lenses and prisms', () => {
  it('Fresnel lens: thin-lens focus with chromatic shift and transmission loss, also out of plane', () => {
    const focus = (wl: number) => {
      const r = run3([posed(laser(0, 0, 0, { wavelength: wl }), 10), comp('lens.fresnel', 50, 0, 0, { focalLength: 80, transmission: 0.92 })]);
      const s = r.segments[1], d = dir3(s);
      expect(s.power).toBeCloseTo(0.92, 9);
      expect(Math.abs(d.y)).toBeLessThan(1e-12);
      return s.a.x - (s.a.z * d.x) / d.z - 50;
    };
    expect(focus(587.56)).toBeCloseTo(80, 6);
    expect(focus(450)).toBeLessThan(focus(650));
  });

  it('beam expander widens a round beam M times and keeps it collimated', () => {
    const r = run3([comp('source.beam', 0, 0, 0, { spectrum: 'mono', rays: 19, beamWidth: 6 }), comp('beam.expander', 50, 0, 0, { magnification: 3, length: 60 })]);
    const out = r.segments.filter((s) => s.a.x > 109.9);
    expect(out.length).toBe(19);
    for (const s of out) expect(dir3(s).x).toBeCloseTo(1, 9);
    expect(Math.max(...out.map((s) => Math.hypot(s.a.y, s.a.z)))).toBeCloseTo(3 * Math.max(...r.segments.filter((s) => s.depth === 0).map((s) => Math.hypot(s.a.y, s.a.z))), 6);
    expect(out.some((s) => Math.abs(s.a.z) > 1)).toBe(true);
  });

  it('Amici prism: three cemented bodies, design wavelength undeviated, same as 2D', () => {
    const cs = [laser(0, 0, 0, { wavelength: 587.6 }), comp('prism.amici', 100, 0, 0, { coating: 'ideal' })];
    const a = run2(cs), b = run3(cs);
    expect(b.segments.length).toBe(a.segments.length);
    const out = b.segments.filter((s) => !s.inMedium).sort((p, q) => q.a.x - p.a.x)[0];
    expect(dir3(out).x).toBeGreaterThan(0.99999);
    const g = getGeometry3D(comp('prism.amici', 0, 0, 0));
    const mats = g.meshes.filter((m) => m.role === 'body').map((m) => m.material).sort();
    expect(mats).toEqual(['bk7', 'sf10']);
  });

  it('double slit clips to rectangular openings; waveMode falls back to ray mode in 3D', () => {
    const slit = comp('aperture.double_slit', 50, 0, 0, { width: 0.5, separation: 2, size: 40 });
    const T = (y: number, z: number, wave = false) => trace3D(scene([posed(laser(0, y, 0), z), slit, comp('detector.screen', 100, 0, 0, { size: 60 }, 's')], { waveMode: wave })).detectors.s.power;
    expect(T(1, 0)).toBeCloseTo(1, 9);     // through the upper slit
    expect(T(-1, 0)).toBeCloseTo(1, 9);    // through the lower slit
    expect(T(0, 0)).toBe(0);               // blocked between the slits
    expect(T(1, 5)).toBeCloseTo(1, 9);     // still inside the slit height (0.6 x 40 mm)
    expect(T(1, 15)).toBe(0);              // above the opening
    expect(T(1, 0, true)).toBeCloseTo(1, 9);
    expect(T(0, 0, true)).toBe(0);
  });
});

describe('concentrator and instruments', () => {
  it('CPC collects inside its acceptance angle and rejects outside, also when pitched', () => {
    const run = (tilt: number, pitch = 0) => {
      const cpc = posed(comp('solar.concentrator', 0, 0, 0, { entranceWidth: 60, acceptanceAngle: 30, reflectivity: 1 }, 'cpc'), 0, pitch);
      // collimated beam aimed at the entrance (local x = -L), arriving at `tilt` from the axis
      const L = (30 + 15) / Math.tan(30 * DEG);
      const a = (tilt + (pitch ? 0 : 0)) * DEG;
      const src = pitch
        ? posed(comp('source.beam', -(L + 80) * Math.cos(pitch * DEG), 0, 0, { spectrum: 'mono', rays: 31, beamWidth: 40 }), (L + 80) * Math.sin(pitch * DEG), pitch)
        : comp('source.beam', -L - 80 * Math.cos(a), -80 * Math.sin(a), tilt, { spectrum: 'mono', rays: 31, beamWidth: 40 });
      return run3([src, cpc]).detectors.cpc;
    };
    const on = run(0);
    expect(on.power).toBeGreaterThan(0.99);
    expect(on.concentration!).toBeCloseTo(2, 2);       // 1 / sin(30 deg) x efficiency 1
    expect(run(15).power).toBeGreaterThan(0.5);
    expect(run(45).power).toBeLessThan(0.02);          // outside the acceptance angle: turned back
    expect(run(0, 35).power).toBeGreaterThan(0.99);    // whole assembly (incl. tilted parabolic walls) pitched 35 deg
  });

  it('polarimeter reports Stokes parameters in its own frame', () => {
    const st = (pol: Record<string, string | number>, roll = 0) =>
      run3([laser(0, 0, 0, pol), posed(comp('detector.polarimeter', 50, 0, 0, {}, 'p'), 0, 0, roll)]).detectors.p.stokes!;
    const lin = st({ polAngle: 0 });
    expect(lin.s1).toBeCloseTo(1, 9); expect(lin.dop).toBeCloseTo(1, 9);
    expect(st({ polAngle: 90 }).s1).toBeCloseTo(-1, 9);
    const c2 = run2([laser(0, 0, 0, { polarization: 'circular_r' }), comp('detector.polarimeter', 50, 0, 0, {}, 'p')]).detectors.p.stokes!;
    const c3 = st({ polarization: 'circular_r' });
    expect(c3.s3).toBeCloseTo(c2.s3, 12); expect(Math.abs(c3.s3)).toBeCloseTo(1, 9);
    // instrument rolled by 45 deg: p-polarized light appears at -/+45 deg, circular light is unchanged
    const rolled = st({ polAngle: 0 }, 45);
    expect(Math.abs(rolled.s2)).toBeCloseTo(1, 9); expect(rolled.s1).toBeCloseTo(0, 9);
    expect(st({ polarization: 'circular_r' }, 45).s3).toBeCloseTo(c3.s3, 9);
    expect(st({ polarization: 'unpolarized' }).dop).toBeCloseTo(0, 9);
  });

  it('wavemeter, camera and laser cavity agree with the 2D engine', () => {
    const cav = comp('source.laser_cavity', 0, 0, 0, { rays: 1 }, 'cav');
    const wm = [cav, comp('detector.wavemeter', 80, 0, 0, {}, 'wm')];
    const a = run2(wm), b = run3(wm);
    expect(b.detectors.wm.power).toBeGreaterThan(0);
    expect(b.detectors.wm.power).toBeCloseTo(a.detectors.wm.power, 12);
    expect(b.detectors.wm.meanWavelength!).toBeCloseTo(1064, 9);
    expect(b.detectors.wm.linewidth!).toBeCloseTo(a.detectors.wm.linewidth!, 12);

    const r = run3([laser(0, 0, 0, { rays: 300, beamDiameter: 2, wavelength: 532 }), comp('detector.camera', 50, 0, 0, { pixels: 256, pitch: 40 }, 'cam')]);
    const cam = r.detectors.cam;
    expect(cam.profile!.length).toBe(256);
    expect(Math.max(...cam.profile!)).toBeCloseTo(0.9, 9); // auto exposure
    expect(cam.profileRGB!.length).toBe(256 * 3);
    expect(cam.image!.w).toBe(128); expect(cam.image!.h).toBe(128);
    expect(cam.image!.data.reduce((p, q) => p + q, 0)).toBeCloseTo(cam.power, 9);
    const peak = cam.profile!.indexOf(Math.max(...cam.profile!));
    expect(Math.abs(peak - 127.5)).toBeLessThan(12);
    expect(cam.profileRGB![3 * peak + 1]).toBeGreaterThan(cam.profileRGB![3 * peak + 2]); // green
  });

  it('modulated laser follows its envelope at a given time', () => {
    const cs = [laser(0, 0, 0, { mode: 'modulated', modulationFreq: 1000, modulationDepth: 1 }), comp('detector.power', 50, 0, 0, {}, 'pm')];
    for (const t of [0.00025, 0.00075]) {
      expect(trace3D(scene(cs), { time: t }).detectors.pm.power).toBeCloseTo(trace(scene(cs), { time: t }).detectors.pm.power, 12);
    }
    expect(trace3D(scene(cs), { time: 0.00025 }).detectors.pm.power).toBeGreaterThan(1.9);
  });
});
