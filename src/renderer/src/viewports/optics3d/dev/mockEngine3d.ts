/**
 * DEV ONLY mock of Optics3DEngineAPI, built on the real 2D optics engine:
 *  - getGeometry3D: extrudes the 2D outline (local frame) into a slab of plausible height, applies
 *    the 3D pose, and adds a post + pedestal down to the table.
 *  - trace3D: runs the 2D tracer and lifts segments to the beam plane z = 0 (ignores pose3d —
 *    good enough to exercise rendering), chains segments to fill t0/t1 (time of flight), and
 *    synthesises DetectorReading3D.image from screen hits.
 * Replaced by `optics3dEngine` from src/core/optics3d when it exists.
 */
import { ShapeUtils, Vector2 } from 'three';
import type { OpticalComponent, OpticsDrive, OpticsEngineAPI, OpticsScene, Vec2 } from '@core/types';
import type { ComponentGeometry3D, DetectorReading3D, Mesh3D, Optics3DEngineAPI, Ray3Segment, Trace3DResult, Vec3 } from '@core/types3d';
import { DEFAULT_TABLE_DEPTH } from '@core/types3d';
import { localToWorld, pose3dOf, worldPoseOf, worldToLocal, rotationMatrix } from '../pose';

const C_MM_PER_S = 299792458e3;

class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; idx: number[] = [];
  vert(p: Vec3, n: Vec3): number { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); return this.pos.length / 3 - 1; }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3) {
    const i = this.vert(a, n), j = this.vert(b, n), k = this.vert(c, n), l = this.vert(d, n);
    this.idx.push(i, j, k, i, k, l);
  }
  build(role: Mesh3D['role'], material?: string): Mesh3D {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), indices: new Uint32Array(this.idx), role, material };
  }
  get empty() { return this.idx.length === 0; }
}

function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; }
  return a / 2;
}

/** Extrude a closed local-3D (x,y) polygon between z0..z1. */
function extrudeClosed(mb: MeshBuilder, pts: Vec2[], z0: number, z1: number) {
  let p = pts.slice();
  if (p.length > 2 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) < 1e-6) p.pop();
  if (p.length < 3) return;
  if (signedArea(p) < 0) p = p.reverse(); // CCW in local x/y (z up)
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ex = b.x - a.x, ey = b.y - a.y, l = Math.hypot(ex, ey) || 1;
    const n = { x: ey / l, y: -ex / l, z: 0 };
    mb.quad({ x: a.x, y: a.y, z: z0 }, { x: b.x, y: b.y, z: z0 }, { x: b.x, y: b.y, z: z1 }, { x: a.x, y: a.y, z: z1 }, n);
  }
  const tris = ShapeUtils.triangulateShape(p.map((q) => new Vector2(q.x, q.y)), []);
  for (const [z, n] of [[z1, 1], [z0, -1]] as const) {
    const base = mb.pos.length / 3;
    for (const q of p) mb.vert({ x: q.x, y: q.y, z }, { x: 0, y: 0, z: n });
    for (const t of tris) n > 0 ? mb.idx.push(base + t[0], base + t[1], base + t[2]) : mb.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/** Open polyline -> thin vertical wall (both faces). */
function extrudeOpen(mb: MeshBuilder, pts: Vec2[], z0: number, z1: number, t = 0.6) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ex = b.x - a.x, ey = b.y - a.y, l = Math.hypot(ex, ey) || 1;
    const nx = ey / l, ny = -ex / l;
    for (const s of [1, -1]) {
      const o = (t / 2) * s;
      const A = { x: a.x + nx * o, y: a.y + ny * o }, B = { x: b.x + nx * o, y: b.y + ny * o };
      const n = { x: nx * s, y: ny * s, z: 0 };
      if (s > 0) mb.quad({ ...A, z: z0 }, { ...B, z: z0 }, { ...B, z: z1 }, { ...A, z: z1 }, n);
      else mb.quad({ ...B, z: z0 }, { ...A, z: z0 }, { ...A, z: z1 }, { ...B, z: z1 }, n);
    }
  }
}

function cylinder(mb: MeshBuilder, c: Vec3, r: number, z0: number, z1: number, seg = 20) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) }, p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
    const n0 = { x: Math.cos(a0), y: Math.sin(a0), z: 0 }, n1 = { x: Math.cos(a1), y: Math.sin(a1), z: 0 };
    const i0 = mb.vert({ ...p0, z: z0 }, n0), i1 = mb.vert({ ...p1, z: z0 }, n1), i2 = mb.vert({ ...p1, z: z1 }, n1), i3 = mb.vert({ ...p0, z: z1 }, n0);
    mb.idx.push(i0, i1, i2, i0, i2, i3);
    const t = mb.vert({ x: c.x, y: c.y, z: z1 }, { x: 0, y: 0, z: 1 });
    const t0 = mb.vert({ ...p0, z: z1 }, { x: 0, y: 0, z: 1 }), t1 = mb.vert({ ...p1, z: z1 }, { x: 0, y: 0, z: 1 });
    mb.idx.push(t, t0, t1);
  }
}

function transformMesh(m: Mesh3D, c: OpticalComponent): Mesh3D {
  const w = worldPoseOf(c);
  const R = rotationMatrix(w.yaw, w.pitch, w.roll);
  const P = m.positions, N = m.normals;
  for (let i = 0; i < P.length; i += 3) {
    const p = localToWorld(c, { x: P[i], y: P[i + 1], z: P[i + 2] });
    P[i] = p.x; P[i + 1] = p.y; P[i + 2] = p.z;
    const nx = N[i], ny = N[i + 1], nz = N[i + 2];
    N[i] = R[0] * nx + R[1] * ny + R[2] * nz; N[i + 1] = R[3] * nx + R[4] * ny + R[5] * nz; N[i + 2] = R[6] * nx + R[7] * ny + R[8] * nz;
  }
  return m;
}

function boundsOf(meshes: Mesh3D[]) {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    min.x = Math.min(min.x, m.positions[i]); max.x = Math.max(max.x, m.positions[i]);
    min.y = Math.min(min.y, m.positions[i + 1]); max.y = Math.max(max.y, m.positions[i + 1]);
    min.z = Math.min(min.z, m.positions[i + 2]); max.z = Math.max(max.z, m.positions[i + 2]);
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  return { min, max };
}

export function createMockEngine3D(engine2d: OpticsEngineAPI): Optics3DEngineAPI {
  function getGeometry3D(c: OpticalComponent, tableDepth = DEFAULT_TABLE_DEPTH): ComponentGeometry3D {
    const isFiber = c.type.startsWith('fiber');
    const meshes: Mesh3D[] = [];
    if (isFiber) {
      // world-space 2D geometry (end points are absolute) -> flat jacket strip in the beam plane
      const g = engine2d.getGeometry(c);
      for (const path of g.paths) {
        const mb = new MeshBuilder();
        const pts = path.points.map((p) => ({ x: p.x, y: -p.y }));
        extrudeOpen(mb, pts, -1.5, 1.5, 3);
        if (!mb.empty) meshes.push(mb.build(path.role === 'decor' ? 'decor' : path.role, 'rubber'));
      }
      for (const end of [c.position, { x: Number(c.props.endX ?? c.position.x), y: Number(c.props.endY ?? c.position.y) }]) {
        const mb = new MeshBuilder();
        cylinder(mb, { x: end.x, y: -end.y, z: 0 }, 5, -tableDepth, -6);
        meshes.push(mb.build('mount', 'anodized'));
      }
      return { meshes, bounds: boundsOf(meshes) };
    }
    const local = engine2d.getGeometry({ ...c, position: { x: 0, y: 0 }, rotation: 0 });
    const ext = Math.max(local.bounds.max.y - local.bounds.min.y, local.bounds.max.x - local.bounds.min.x);
    const H = Math.min(40, Math.max(8, Math.abs(local.bounds.max.y - local.bounds.min.y) || ext || 10));
    const material = local.material ?? (typeof c.props.material === 'string' ? c.props.material : undefined);
    for (const path of local.paths) {
      const mb = new MeshBuilder();
      const pts = path.points.map((p) => ({ x: p.x, y: -p.y }));
      if (path.closed && pts.length > 2) extrudeClosed(mb, pts, -H / 2, H / 2);
      else extrudeOpen(mb, pts, -H / 2, H / 2);
      if (mb.empty) continue;
      const mat = path.role === 'body' || path.role === 'surface' ? material : path.role === 'mirror' ? 'metal' : 'anodized';
      meshes.push(transformMesh(mb.build(path.role, mat), c));
    }
    // post + pedestal straight down to the table under the component's world origin
    const w = worldPoseOf(c);
    const bottom = Math.min(...meshes.map((m) => { let z = Infinity; for (let i = 2; i < m.positions.length; i += 3) z = Math.min(z, m.positions[i]); return z; }), w.p.z - H / 2);
    const top = Math.max(-tableDepth + 12, bottom + 1);
    const post = new MeshBuilder();
    cylinder(post, { x: w.p.x, y: w.p.y, z: 0 }, 6.35, -tableDepth + 10, top);
    meshes.push(post.build('mount', 'metal'));
    const ped = new MeshBuilder();
    cylinder(ped, { x: w.p.x, y: w.p.y, z: 0 }, 12.5, -tableDepth, -tableDepth + 10, 28);
    meshes.push(ped.build('mount', 'anodized'));
    return { meshes, bounds: boundsOf(meshes) };
  }

  function trace3D(scene: OpticsScene, drive?: OpticsDrive): Trace3DResult {
    const t0 = performance.now();
    const r = engine2d.trace(scene, drive);
    const segments: Ray3Segment[] = [];
    const ends = new Map<string, number>();
    const key = (p: Vec2, src: string) => `${src}|${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
    const srcPos = new Map(scene.components.map((c) => [c.id, c.position] as const));
    for (const s of r.segments) {
      const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      const n = s.inMedium ? 1.62 : 1.0003;
      let ta = ends.get(key(s.a, s.sourceId));
      if (ta === undefined) {
        const sp = srcPos.get(s.sourceId);
        ta = sp && s.depth > 0 ? Math.hypot(s.a.x - sp.x, s.a.y - sp.y) / C_MM_PER_S : 0;
      }
      const tb = ta + (L * n) / C_MM_PER_S;
      ends.set(key(s.b, s.sourceId), tb);
      segments.push({ a: { x: s.a.x, y: -s.a.y, z: 0 }, b: { x: s.b.x, y: -s.b.y, z: 0 }, wavelength: s.wavelength, power: s.power, sourceId: s.sourceId, depth: s.depth, t0: ta, t1: tb, polAngle: s.polAngle, polDegree: s.polDegree, inMedium: s.inMedium });
    }
    const detectors: Record<string, DetectorReading3D> = {};
    for (const [id, d] of Object.entries(r.detectors)) {
      const c = scene.components.find((q) => q.id === id);
      const out: DetectorReading3D = { ...d };
      if (c && d.hits && d.hits.length) {
        const W = 48, Hh = 48;
        const data = new Array(W * Hh).fill(0), rgb = new Array(W * Hh * 3).fill(0);
        const size = Number(c.props.size ?? 30);
        for (const h of d.hits) {
          const l = worldToLocal(c, { x: h.p.x, y: -h.p.y, z: 0 });
          const u = Math.round(((l.y / size) + 0.5) * (W - 1));
          const col = engine2d.wavelengthToRGB(h.wavelength);
          for (let v = 0; v < Hh; v++) {
            for (let du = -2; du <= 2; du++) {
              const x = u + du; if (x < 0 || x >= W) continue;
              const g = Math.exp(-((v - Hh / 2) ** 2) / 18 - du * du / 2) * h.power;
              data[v * W + x] += g;
              rgb[(v * W + x) * 3] += col[0] * g; rgb[(v * W + x) * 3 + 1] += col[1] * g; rgb[(v * W + x) * 3 + 2] += col[2] * g;
            }
          }
        }
        out.image = { w: W, h: Hh, data, rgb };
      }
      detectors[id] = out;
    }
    return { segments, detectors, stats: { rays: r.stats.rays, segments: segments.length, ms: performance.now() - t0 } };
  }

  return {
    getGeometry3D,
    trace3D,
    poseOf: pose3dOf,
    localToWorld,
    worldToLocal,
  };
}
