/** Mesh generation for every component type + tracer performance. */
import { describe, expect, it } from 'vitest';
import type { OpticalComponent } from '../../src/core/types';
import type { Mesh3D } from '../../src/core/types3d';
import { opticsEngine } from '../../src/core/optics';
import { getGeometry3D, optics3dEngine, trace3D } from '../../src/core/optics3d';
import { comp, laser, scene } from './helpers';

const ROLES = new Set(['body', 'surface', 'mirror', 'absorber', 'detector', 'emitter', 'aperture', 'decor', 'mount']);
const posed = (c: OpticalComponent, z = 0, pitch = 0, roll = 0): OpticalComponent => ({ ...c, pose3d: { z, pitch, roll } });

/** Signed volume of a mesh (positive when triangles wind counter-clockwise seen from outside). */
function volume(m: Mesh3D): number {
  let v = 0;
  const P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}

function checkMesh(m: Mesh3D, tag: string): void {
  expect(ROLES.has(m.role), tag).toBe(true);
  expect(m.positions.length % 3, tag).toBe(0);
  expect(m.normals.length, tag).toBe(m.positions.length);
  expect(m.indices.length % 3, tag).toBe(0);
  expect(m.indices.length, tag).toBeGreaterThan(0);
  const nv = m.positions.length / 3;
  let bad = 0, wrong = 0;
  for (let i = 0; i < m.positions.length; i += 3) {
    if (!Number.isFinite(m.positions[i] + m.positions[i + 1] + m.positions[i + 2])) bad++;
    if (Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) > 1e-3) bad++;
  }
  const P = m.positions, N = m.normals, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    if (I[t] >= nv || I[t + 1] >= nv || I[t + 2] >= nv) { bad++; continue; }
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    // CCW winding must agree with the vertex normals
    if (f[0] * (N[a] + N[b] + N[c]) + f[1] * (N[a + 1] + N[b + 1] + N[c + 1]) + f[2] * (N[a + 2] + N[b + 2] + N[c + 2]) < 0) wrong++;
  }
  expect(bad, tag).toBe(0);
  expect(wrong, tag).toBe(0);
}

describe('getGeometry3D', () => {
  it('every registry type yields valid meshes with a mount down to the table', () => {
    expect(opticsEngine.registry.length).toBeGreaterThan(40);
    for (const def of opticsEngine.registry) {
      for (const pose of [[0, 0, 0], [20, 30, 15]]) {
        const c = posed(comp(def.type, 40, -30, 25), pose[0], pose[1], pose[2]);
        const g = getGeometry3D(c, 75);
        const tag = `${def.type} ${pose.join('/')}`;
        expect(g.meshes.length, tag).toBeGreaterThan(1);
        for (const m of g.meshes) checkMesh(m, tag);
        expect(g.meshes.some((m) => m.role === 'mount'), tag).toBe(true);
        expect(g.meshes.some((m) => m.role !== 'mount'), tag).toBe(true);
        if (def.type === 'field.gravity') expect(g.bounds.min.z, tag).toBeLessThanOrEqual(-75); // sphere of influence dips below the table
        else expect(g.bounds.min.z, tag).toBeCloseTo(-75, 3);
        expect(g.bounds.max.z, tag).toBeGreaterThan(pose[0]);
        for (const k of ['x', 'y', 'z'] as const) expect(Number.isFinite(g.bounds.min[k]) && Number.isFinite(g.bounds.max[k]), tag).toBe(true);
        // closed glass bodies wind outward
        for (const m of g.meshes) if (m.role === 'body') expect(volume(m), tag).toBeGreaterThan(0);
      }
    }
  });

  it('body meshes are closed solids with the right volume and material', () => {
    const ball = getGeometry3D(comp('lens.ball', 0, 0, 0, { diameter: 10 })).meshes.find((m) => m.role === 'body')!;
    expect(ball.material).toBe('bk7');
    expect(volume(ball) / ((4 / 3) * Math.PI * 125)).toBeGreaterThan(0.985);
    expect(volume(ball) / ((4 / 3) * Math.PI * 125)).toBeLessThan(1.0001);
    const slab = getGeometry3D(posed(comp('block.slab', 5, 5, 33, { width: 60, height: 30 }), 4, 10, 20)).meshes.find((m) => m.role === 'body')!;
    expect(volume(slab)).toBeCloseTo(60 * 30 * 30, 1); // height3d defaults to the 2D height
    const prism = getGeometry3D(comp('prism.equilateral', 0, 0, 0, { size: 40 })).meshes.find((m) => m.role === 'body')!;
    expect(volume(prism)).toBeCloseTo((Math.sqrt(3) / 4) * 40 * 40 * 40, 1);
    const lens = getGeometry3D(comp('lens.biconvex', 0, 0, 0)).meshes.find((m) => m.role === 'body')!;
    expect(volume(lens)).toBeGreaterThan(Math.PI * 12.7 * 12.7 * 2); // more than the edge cylinder
    expect(lens.positions.length / 3).toBeGreaterThan(400);            // smooth tessellation
  });

  it('mirrors are metal discs in the beam plane; roles and materials are as documented', () => {
    const g = getGeometry3D(comp('mirror.flat', 100, 0, 0, { size: 40, coating: 'gold' }));
    const mir = g.meshes.find((m) => m.role === 'mirror')!;
    expect(mir.material).toBe('gold');
    let rmax = 0;
    for (let i = 0; i < mir.positions.length; i += 3) {
      expect(mir.positions[i]).toBeCloseTo(100, 4);
      rmax = Math.max(rmax, Math.hypot(mir.positions[i + 1], mir.positions[i + 2]));
    }
    expect(rmax).toBeCloseTo(20, 4);
    const sph = getGeometry3D(comp('mirror.spherical', 0, 0, 0));
    expect(sph.meshes.some((m) => m.role === 'decor' && m.material === 'substrate')).toBe(true);
    const det = getGeometry3D(comp('detector.screen', 0, 0, 0));
    expect(det.meshes.find((m) => m.role === 'detector')!.material).toBe('screen');
    const src = getGeometry3D(comp('source.laser', 0, 0, 0));
    expect(src.meshes.some((m) => m.role === 'emitter')).toBe(true);
    const far = getGeometry3D(comp('magneto.faraday', 0, 0, 0));
    expect(far.meshes.some((m) => m.material === 'magnet')).toBe(true);
    expect(far.meshes.find((m) => m.role === 'body')!.material).toBe('tgg');
    const grav = getGeometry3D(comp('field.gravity', 0, 0, 0));
    expect(grav.meshes.some((m) => m.role === 'decor' && m.material === 'field')).toBe(true);
    const iris = getGeometry3D(comp('aperture.iris', 0, 0, 0));
    expect(iris.meshes.some((m) => m.role === 'aperture')).toBe(true);
  });

  it('fibre: tube between the two ends, handle at end B in 3D', () => {
    const f = comp('fiber.cable', 0, 0, 0, { endX: 120, endY: 50, endZ: 30 });
    const g = getGeometry3D(f);
    expect(g.handles).toEqual([{ key: 'end', p: { x: 120, y: -50, z: 30 } }]);
    expect(g.meshes.some((m) => m.material === 'rubber')).toBe(true);
    expect(g.bounds.max.x).toBeGreaterThan(119);
    expect(g.bounds.max.z).toBeGreaterThan(30);
  });

  it('unknown component types render as a generic box, results are cached per pose', () => {
    const u: OpticalComponent = { id: 'u', type: 'future.widget', position: { x: 1, y: 2 }, rotation: 0.3, props: {} };
    const g = getGeometry3D(u);
    expect(g.meshes.length).toBeGreaterThan(1);
    for (const m of g.meshes) checkMesh(m, 'unknown');
    expect(getGeometry3D({ ...u })).toBe(g);
    expect(getGeometry3D({ ...u, pose3d: { z: 3, pitch: 0, roll: 0 } })).not.toBe(g);
    expect(optics3dEngine.getGeometry3D(u, 50).bounds.min.z).toBeCloseTo(-50, 3);
    expect(() => trace3D(scene([laser(0, 0, 0), { ...u, position: { x: 50, y: 0 } }]))).not.toThrow();
  });
});

describe('performance', () => {
  it('typical scene (3 sources, ~400 rays, 15 components) traces in < 40 ms', () => {
    const cs: OpticalComponent[] = [
      comp('source.laser', 0, 0, 0, { rays: 61 }),
      comp('source.white', 0, 80, 0, { rays: 9 }),            // 9 x 24 spectral samples
      posed(comp('source.led', 0, -80, 0, { rays: 20 }), 10), // 20 x 8
      comp('lens.biconvex', 60, 0, 0), comp('lens.planoconvex', 140, 0, 0), posed(comp('mirror.flat', 220, 0, 20), 0, 10),
      comp('splitter.plate', 100, 0, 45), comp('prism.equilateral', 80, 85, 0), comp('block.slab', 160, 80, 10),
      comp('polarizer.linear', 40, 0, 0), comp('waveplate.quarter', 50, 0, 0), comp('grating.transmission', 180, 0, 0),
      comp('lens.ball', 60, -80, 0), comp('aperture.iris', 30, -80, 0, { diameter: 20 }), comp('filter.nd', 20, 80, 0),
      comp('detector.screen', 320, 0, 0, { size: 300, height3d: 200 }), comp('detector.power', 100, -200, 90), comp('mirror.spherical', 260, 80, 0),
    ];
    const sc = scene(cs);
    let best = Infinity, r = trace3D(sc);
    for (let i = 0; i < 8; i++) { r = trace3D(sc); best = Math.min(best, r.stats.ms); }
    expect(r.stats.rays).toBeGreaterThan(300);
    expect(cs.length - 3).toBe(15);
    expect(best).toBeLessThan(40);
    const bal = r.energy.detected + r.energy.absorbed + r.energy.escaped + r.energy.dropped;
    expect(bal / r.energy.emitted).toBeCloseTo(1, 9);
  });
});
