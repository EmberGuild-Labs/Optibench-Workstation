/**
 * Triangle-mesh builder. Geometry is authored in an arbitrary orthonormal frame (possibly
 * left-handed) and written out in WORLD mm. Every vertex carries an analytic normal; `finish()`
 * orients each triangle so that its winding is counter-clockwise seen from the side its normals
 * point to, so outward normals ⇒ CCW-outward winding regardless of how a primitive was generated.
 * Vertices are grouped by (role, material) so a component yields only a handful of meshes.
 */
import type { Mesh3D, Vec3 } from '../types3d';
import type { Frame } from './math';

export type MeshRole = Mesh3D['role'];

interface Group { role: MeshRole; material?: string; pos: number[]; nor: number[]; idx: number[] }

const IDENT: Frame = { o: { x: 0, y: 0, z: 0 }, X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } };

export class MeshBuilder {
  private groups = new Map<string, Group>();
  private g!: Group;
  private f: Frame = IDENT;

  /** Select the (role, material) group subsequent primitives go to. */
  use(role: MeshRole, material?: string): this {
    const key = `${role}|${material ?? ''}`;
    let g = this.groups.get(key);
    if (!g) { g = { role, material, pos: [], nor: [], idx: [] }; this.groups.set(key, g); }
    this.g = g;
    return this;
  }

  setFrame(f: Frame): this { this.f = f; return this; }
  get frame(): Frame { return this.f; }

  /** Frame expressed in the coordinates of the current frame. */
  sub(o: [number, number, number], X: [number, number, number], Y: [number, number, number], Z: [number, number, number]): Frame {
    const f = this.f;
    const v = (a: [number, number, number]): Vec3 => ({
      x: f.X.x * a[0] + f.Y.x * a[1] + f.Z.x * a[2], y: f.X.y * a[0] + f.Y.y * a[1] + f.Z.y * a[2], z: f.X.z * a[0] + f.Y.z * a[1] + f.Z.z * a[2],
    });
    const d = v(o);
    return { o: { x: f.o.x + d.x, y: f.o.y + d.y, z: f.o.z + d.z }, X: v(X), Y: v(Y), Z: v(Z) };
  }

  /** Run `fn` with a temporary frame. */
  within(fr: Frame, fn: () => void): void { const old = this.f; this.f = fr; fn(); this.f = old; }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const f = this.f, g = this.g;
    g.pos.push(f.o.x + f.X.x * x + f.Y.x * y + f.Z.x * z, f.o.y + f.X.y * x + f.Y.y * y + f.Z.y * z, f.o.z + f.X.z * x + f.Y.z * y + f.Z.z * z);
    g.nor.push(f.X.x * nx + f.Y.x * ny + f.Z.x * nz, f.X.y * nx + f.Y.y * ny + f.Z.y * nz, f.X.z * nx + f.Y.z * ny + f.Z.z * nz);
    return g.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.g.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.g.idx.push(a, b, c, a, c, d); }

  /**
   * Surface of revolution about the frame's x axis. `prof` = flat list of (x, r, nx, nr) profile
   * points with their normals in the (x, r) half-plane. `both` adds the back side as well.
   */
  lathe(prof: number[], segs = 48, both = false): void {
    const n = prof.length / 4;
    if (n < 2) return;
    for (let side = 0; side < (both ? 2 : 1); side++) {
      const sg = side === 0 ? 1 : -1;
      const base = this.g.pos.length / 3;
      for (let j = 0; j <= segs; j++) {
        const a = (2 * Math.PI * j) / segs, c = Math.cos(a), s = Math.sin(a);
        for (let i = 0; i < n; i++) {
          const x = prof[4 * i], r = prof[4 * i + 1], nx = prof[4 * i + 2] * sg, nr = prof[4 * i + 3] * sg;
          this.vert(x, r * c, r * s, nx, nr * c, nr * s);
        }
      }
      for (let j = 0; j < segs; j++) {
        for (let i = 0; i < n - 1; i++) {
          const p = base + j * n + i, q = p + n;
          const ra = prof[4 * i + 1], rb = prof[4 * i + 5];
          if (ra > 1e-9) this.tri(p, q, p + 1);
          if (rb > 1e-9) this.tri(p + 1, q, q + 1);
        }
      }
    }
  }

  /** Solid (optionally hollow) cylinder along x from x0 to x1. */
  cyl(x0: number, x1: number, rOut: number, rIn = 0, segs = 32): void {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    this.lathe([x0, rOut, 0, 1, x1, rOut, 0, 1], segs);
    this.lathe([x0, rIn, -1, 0, x0, rOut, -1, 0], segs);
    this.lathe([x1, rIn, 1, 0, x1, rOut, 1, 0], segs);
    if (rIn > 1e-9) this.lathe([x0, rIn, 0, -1, x1, rIn, 0, -1], segs);
  }

  /** Cylinder between two points given in the current frame. */
  rod(a: [number, number, number], b: [number, number, number], rOut: number, rIn = 0, segs = 24): void {
    const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-9) return;
    const X: [number, number, number] = [d[0] / L, d[1] / L, d[2] / L];
    const ref: [number, number, number] = Math.abs(X[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let Y: [number, number, number] = [ref[1] * X[2] - ref[2] * X[1], ref[2] * X[0] - ref[0] * X[2], ref[0] * X[1] - ref[1] * X[0]];
    const yl = Math.hypot(Y[0], Y[1], Y[2]);
    Y = [Y[0] / yl, Y[1] / yl, Y[2] / yl];
    const Z: [number, number, number] = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    this.within(this.sub(a, X, Y, Z), () => this.cyl(0, L, rOut, rIn, segs));
  }

  sphere(cx: number, cy: number, cz: number, R: number, segs = 32, rings = 16): void {
    const prof: number[] = [];
    for (let i = 0; i <= rings; i++) { const t = (Math.PI * i) / rings; prof.push(-R * Math.cos(t), R * Math.sin(t), -Math.cos(t), Math.sin(t)); }
    this.within(this.sub([cx, cy, cz], [1, 0, 0], [0, 1, 0], [0, 0, 1]), () => this.lathe(prof, segs));
  }

  /** Flat quad a-b-c-d (in order around the perimeter) with normal n; `both` adds the back face. */
  face(p: number[], n: [number, number, number], both = false): void {
    for (let side = 0; side < (both ? 2 : 1); side++) {
      const sg = side === 0 ? 1 : -1;
      const i = [0, 1, 2, 3].map((k) => this.vert(p[3 * k], p[3 * k + 1], p[3 * k + 2], n[0] * sg, n[1] * sg, n[2] * sg));
      this.quad(i[0], i[1], i[2], i[3]);
    }
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.face([x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1], [-1, 0, 0]);
    this.face([x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], [1, 0, 0]);
    this.face([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0]);
    this.face([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], [0, 1, 0]);
    this.face([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], [0, 0, -1]);
    this.face([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1]);
  }

  /** Planar polygon (flat x, y list) at height z with normal ±z, ear-clipped (handles concave outlines). */
  polygon(pts: number[], z: number, nz: number): void {
    const n = pts.length / 2;
    if (n < 3) return;
    const base = this.g.pos.length / 3;
    for (let i = 0; i < n; i++) this.vert(pts[2 * i], pts[2 * i + 1], z, 0, 0, nz);
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1]; }
    const ccw = area >= 0;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const cross = (a: number, b: number, c: number) => (pts[2 * b] - pts[2 * a]) * (pts[2 * c + 1] - pts[2 * a + 1]) - (pts[2 * b + 1] - pts[2 * a + 1]) * (pts[2 * c] - pts[2 * a]);
    let guard = 0;
    while (idx.length > 3 && guard++ < 4 * n) {
      let clipped = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        const cr = cross(a, b, c);
        if (ccw ? cr < -1e-12 : cr > 1e-12) continue; // reflex corner
        let ear = true;
        for (const k of idx) {
          if (k === a || k === b || k === c) continue;
          const d1 = cross(a, b, k), d2 = cross(b, c, k), d3 = cross(c, a, k);
          if (ccw ? d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12 : d1 < -1e-12 && d2 < -1e-12 && d3 < -1e-12) { ear = false; break; }
        }
        if (!ear) continue;
        this.tri(base + a, base + b, base + c);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    for (let i = 1; i + 1 < idx.length; i++) this.tri(base + idx[0], base + idx[i], base + idx[i + 1]);
  }

  /** Tube of given radius along a polyline (parallel-transport frames), with flat end caps. */
  tube(path: Vec3[], radius: number, sides = 10): void {
    const n = path.length;
    if (n < 2) return;
    const base = this.g.pos.length / 3;
    let ux = 0, uy = 0, uz = 0;
    let ptx = 0, pty = 0, ptz = 0;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) {
        const r = Math.abs(tz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        ux = r[1] * tz - r[2] * ty; uy = r[2] * tx - r[0] * tz; uz = r[0] * ty - r[1] * tx;
      } else {
        const k = ux * tx + uy * ty + uz * tz;
        ux -= k * tx; uy -= k * ty; uz -= k * tz;
      }
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      for (let j = 0; j <= sides; j++) {
        const an = (2 * Math.PI * j) / sides, c = Math.cos(an), s = Math.sin(an);
        const nx = c * ux + s * vx, ny = c * uy + s * vy, nz = c * uz + s * vz;
        this.vert(path[i].x + radius * nx, path[i].y + radius * ny, path[i].z + radius * nz, nx, ny, nz);
      }
      ptx = tx; pty = ty; ptz = tz;
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const p = base + i * (sides + 1) + j, q = p + sides + 1;
        this.quad(p, q, q + 1, p + 1);
      }
    }
    void ptx; void pty; void ptz;
  }

  /** Emit meshes (triangle winding made consistent with the normals) and world bounds. */
  finish(): { meshes: Mesh3D[]; min: Vec3; max: Vec3 } {
    const meshes: Mesh3D[] = [];
    const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const g of this.groups.values()) {
      if (!g.idx.length) continue;
      const P = g.pos, N = g.nor, I = g.idx;
      const out: number[] = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
        const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
        if (fx * fx + fy * fy + fz * fz < 1e-20) continue; // degenerate
        const d = fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]);
        if (d >= 0) out.push(I[t], I[t + 1], I[t + 2]); else out.push(I[t], I[t + 2], I[t + 1]);
      }
      for (let i = 0; i < P.length; i += 3) {
        if (P[i] < min.x) min.x = P[i]; if (P[i] > max.x) max.x = P[i];
        if (P[i + 1] < min.y) min.y = P[i + 1]; if (P[i + 1] > max.y) max.y = P[i + 1];
        if (P[i + 2] < min.z) min.z = P[i + 2]; if (P[i + 2] > max.z) max.z = P[i + 2];
      }
      const m: Mesh3D = { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(out), role: g.role };
      if (g.material) m.material = g.material;
      meshes.push(m);
    }
    return { meshes, min, max };
  }
}
