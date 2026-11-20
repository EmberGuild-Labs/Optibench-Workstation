/**
 * Small 2D math / geometry helpers for the optics viewport:
 * view transforms, hit-testing primitives and an ear-clipping triangulator.
 */
import type { Vec2, ViewState } from '@core/types';

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Screen (CSS px, relative to the viewport element) <-> world (mm). */
export function worldToScreen(p: Vec2, view: ViewState, w: number, h: number): Vec2 {
  return { x: (p.x - view.cx) * view.zoom + w * 0.5, y: (p.y - view.cy) * view.zoom + h * 0.5 };
}
export function screenToWorld(p: Vec2, view: ViewState, w: number, h: number): Vec2 {
  return { x: (p.x - w * 0.5) / view.zoom + view.cx, y: (p.y - h * 0.5) / view.zoom + view.cy };
}

/** Rotate vector by angle (rad, clockwise on screen because +y is down). */
export function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Closest point on segment + parameter. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; t: number; d: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const q = { x: a.x + abx * t, y: a.y + aby * t };
  return { q, t, d: Math.hypot(p.x - q.x, p.y - q.y) };
}

export function distToPolyline(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  if (n === 1) return dist(p, pts[0]);
  for (let i = 0; i < n - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && n > 2) best = Math.min(best, distToSegment(p, pts[n - 1], pts[0]));
  return best;
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return s * 0.5;
}

export function centroid(pts: Vec2[]): Vec2 {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-9) {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / Math.max(1, pts.length), y: y / Math.max(1, pts.length) };
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Remove consecutive duplicates and a duplicated closing point. */
export function cleanRing(pts: Vec2[], eps = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > eps || Math.abs(q.y - p.y) > eps) out.push(p);
  }
  while (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps) out.pop(); else break;
  }
  return out;
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Ear-clipping triangulation of a simple polygon (convex or concave, either winding).
 * Returns vertex indices into the cleaned ring (also returned). O(n^2), fine for
 * component outlines (tens to a few hundred vertices). Degenerate leftovers fall
 * back to a fan so we never hang.
 */
export function triangulate(input: Vec2[]): { ring: Vec2[]; indices: number[] } {
  const ring = cleanRing(input);
  const n = ring.length;
  const indices: number[] = [];
  if (n < 3) return { ring, indices };
  const ccw = signedArea(ring) > 0;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i);
  const isConvex = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = ring[i0], b = ring[i1], c = ring[i2];
      if (!isConvex(a, b, c)) continue;
      let ear = true;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k];
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(ring[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      indices.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate / self-intersecting: drop collinear vertices or fan the rest.
      let removed = false;
      for (let i = 0; i < idx.length; i++) {
        const a = ring[idx[(i + idx.length - 1) % idx.length]], b = ring[idx[i]], c = ring[idx[(i + 1) % idx.length]];
        if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <= 1e-12) { idx.splice(i, 1); removed = true; break; }
      }
      if (!removed) {
        for (let i = 1; i < idx.length - 1; i++) indices.push(idx[0], idx[i], idx[i + 1]);
        return { ring, indices };
      }
    }
  }
  if (idx.length === 3) indices.push(idx[0], idx[1], idx[2]);
  return { ring, indices };
}

export function rectsIntersect(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

/** Cheap 32-bit string hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
