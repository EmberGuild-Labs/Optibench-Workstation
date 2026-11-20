import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { opticsEngine } from '../../src/core/optics';
import { optics3dEngine, convert2Dto3D } from '../../src/core/optics3d';
import { parseDocument } from '../../src/core/project';
import type { OpticsScene } from '../../src/core/types';
import {
  ellipsePoints, falseColor, formatLinewidth, fringeVisibility, handedness, imagePixels, linearToSrgb8, linewidthHz,
  poincareXY, profileStrip, wavelengthToTHz
} from '../../src/renderer/src/components/dock/instrumentMath';

describe('instrument math', () => {
  it('sRGB transfer', () => {
    expect(linearToSrgb8(0)).toBe(0);
    expect(linearToSrgb8(1)).toBe(255);
    expect(linearToSrgb8(0.2140)).toBeGreaterThan(126);
    expect(linearToSrgb8(NaN)).toBe(0);
    expect(linearToSrgb8(5)).toBe(255);
  });
  it('profile strip normalises rgb and falls back to grey', () => {
    const s = profileStrip([1, 2], [0, 0, 0.5, 1, 0, 0]);
    expect(s[1]).toEqual([255, 0, 0]);
    expect(s[0][2]).toBeGreaterThan(150);
    const g = profileStrip([0, 4, NaN]);
    expect(g[1]).toEqual([255, 255, 255]);
    expect(g[2]).toEqual([0, 0, 0]);
    expect(profileStrip([0, 0], [0, 0, 0, 0, 0, 0])[0]).toEqual([0, 0, 0]);
  });
  it('false colour endpoints and monotone brightness', () => {
    expect(falseColor(0)).toEqual([0, 0, 4]);
    expect(falseColor(1)).toEqual([252, 255, 164]);
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    for (let t = 0; t < 1; t += 0.1) expect(lum(falseColor(t + 0.1))).toBeGreaterThanOrEqual(lum(falseColor(t)) - 1e-9);
  });
  it('image pixels: rgb, data and degenerate input', () => {
    const p = imagePixels({ w: 2, h: 1, data: [1, 0], rgb: [2, 2, 2, 0, 0, 0] });
    expect(Array.from(p)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const q = imagePixels({ w: 2, h: 1, data: [0, 3] });
    expect(Array.from(q.slice(4))).toEqual([252, 255, 164, 255]);
    expect(imagePixels({ w: 2, h: 2, data: [] }).length).toBe(16);
    expect(imagePixels({ w: NaN, h: 1, data: [1] }).length).toBe(0);
  });
  it('fringe visibility', () => {
    const n = 512;
    const full = Array.from({ length: n }, (_, i) => 1 + Math.cos((i - n / 2) * 0.3));
    expect(fringeVisibility(full)!).toBeGreaterThan(0.98);
    const half = Array.from({ length: n }, (_, i) => 1 + 0.5 * Math.cos((i - n / 2) * 0.3));
    expect(fringeVisibility(half)!).toBeCloseTo(0.5, 2);
    expect(fringeVisibility([])).toBeNull();
    expect(fringeVisibility([0, 0])).toBeNull();
  });
  it('polarization ellipse geometry', () => {
    const lin = ellipsePoints(Math.PI / 4, 0, 8);
    for (const p of lin) expect(Math.abs(p.x - p.y)).toBeLessThan(1e-12); // line at 45°
    const circ = ellipsePoints(0, Math.PI / 4, 16);
    for (const p of circ) expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.SQRT1_2, 9);
    // right-handed (chi > 0) runs counter-clockwise: positive signed area
    const pts = ellipsePoints(0.3, 0.2, 64);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
    expect(area).toBeGreaterThan(0);
    expect(handedness(0.2)).toBe('right');
    expect(handedness(-0.2)).toBe('left');
    expect(handedness(0)).toBe('linear');
    expect(poincareXY(3, 4)).toEqual({ x: 0.6, y: 0.8 });
  });
  it('wavelength conversions', () => {
    expect(wavelengthToTHz(632.8)).toBeCloseTo(473.76, 1);
    expect(wavelengthToTHz(0)).toBe(0);
    expect(linewidthHz(1000, 0.001)).toBeCloseTo(2.998e8, -6);
    expect(formatLinewidth(0.002)).toBe('2.000 pm');
    expect(formatLinewidth(2)).toBe('2.000 nm');
    expect(formatLinewidth(0)).toBe('0 pm');
  });
});

const load = (f: string) => parseDocument(readFileSync(`examples/${f}`, 'utf8')).doc;

describe('instrument panels have data', () => {
  it('11 double slit: screens + camera profile/profileRGB (wave mode), 3D images', () => {
    const doc = load('11-double-slit.obw');
    const r = opticsEngine.trace(doc.optics);
    const r3 = optics3dEngine.trace3D(convert2Dto3D(doc.optics));
    const dets = doc.optics.components.filter((c) => c.type === 'detector.screen' || c.type === 'detector.camera');
    expect(dets.length).toBeGreaterThanOrEqual(3);
    for (const c of dets) {
      const d = r.detectors[c.id];
      expect(d.profile!.length).toBeGreaterThanOrEqual(256);
      expect(d.profileRGB!.length).toBe(d.profile!.length * 3);
      expect(fringeVisibility(d.profile!)).not.toBeNull();
      const im = (r3.detectors[c.id] as { image?: { w: number; h: number; data: number[] } }).image!;
      expect(im.w * im.h).toBe(im.data.length);
    }
    // the 3D tracer has no wave optics: the camera and the ray-optics screen still get a lit image
    for (const id of ['camera', 'screen5']) {
      const im = (r3.detectors[id] as { image?: { data: number[] } }).image!;
      expect(Math.max(...im.data)).toBeGreaterThan(0);
    }
  });
  it('12 michelson: camera fringes', () => {
    const doc = load('12-michelson.obw');
    const r = opticsEngine.trace(doc.optics);
    const cam = doc.optics.components.find((c) => c.type === 'detector.camera')!;
    const d = r.detectors[cam.id];
    expect(d.profile!.length).toBeGreaterThan(0);
    expect(d.profileRGB!.length).toBe(d.profile!.length * 3);
    expect(Math.max(...d.profile!)).toBeGreaterThan(0);
  });

  function scene(detType: string, srcType = 'source.laser'): { scene: OpticsScene; id: string } {
    const src = { ...opticsEngine.createComponent(srcType, { x: 0, y: 0 }), id: 's' };
    const det = { ...opticsEngine.createComponent(detType, { x: 120, y: 0 }), id: 'd', rotation: Math.PI };
    return { scene: { components: [src, det], settings: opticsEngine.defaultSettings() }, id: 'd' };
  }
  const hit = (detType: string, srcType?: string) => {
    const s = scene(detType, srcType);
    let r = opticsEngine.trace(s.scene).detectors[s.id];
    if (!(r?.power > 0)) { s.scene.components[1].rotation = 0; r = opticsEngine.trace(s.scene).detectors[s.id]; }
    return r;
  };
  it('polarimeter reports Stokes parameters', () => {
    const r = hit('detector.polarimeter');
    expect(r.power).toBeGreaterThan(0);
    expect(r.stokes).toBeDefined();
    expect(r.stokes!.dop).toBeGreaterThan(0.5);
  });
  it('wavemeter reports mean wavelength + linewidth', () => {
    const r = hit('detector.wavemeter');
    expect(r.power).toBeGreaterThan(0);
    expect(r.meanWavelength!).toBeGreaterThan(300);
    expect(r.linewidth!).toBeGreaterThanOrEqual(0);
  });
  it('solar concentrator reports a concentration ratio', () => {
    const r = hit('solar.concentrator', 'source.beam');
    expect(r).toBeDefined();
    expect(Number.isFinite(r.concentration)).toBe(true);
  });
});
