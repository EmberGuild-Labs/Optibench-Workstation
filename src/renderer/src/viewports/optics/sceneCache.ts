/** Geometry caching, hit-testing and glass mesh building. */
import type { ComponentGeometry, OpticalComponent, OpticsEngineAPI, Vec2 } from '@core/types';
import { centroid, distToPolyline, pointInPolygon, triangulate } from './math';
import { classifyPath, glassTint } from './style';

const EMPTY_BOUNDS = (p: Vec2) => ({ min: { x: p.x - 3, y: p.y - 3 }, max: { x: p.x + 3, y: p.y + 3 } });

/** Caches engine.getGeometry per component, keyed by object identity, then by a cheap content key. */
export class GeometryCache {
  private engine: OpticsEngineAPI | null = null;
  private byObj = new WeakMap<OpticalComponent, ComponentGeometry>();
  private byId = new Map<string, { key: string; g: ComponentGeometry }>();

  get(engine: OpticsEngineAPI, c: OpticalComponent): ComponentGeometry {
    if (engine !== this.engine) { this.engine = engine; this.byObj = new WeakMap(); this.byId.clear(); }
    const hit = this.byObj.get(c);
    if (hit) return hit;
    const key = `${c.type}|${c.position.x},${c.position.y}|${c.rotation}|${JSON.stringify(c.props)}`;
    const prev = this.byId.get(c.id);
    if (prev && prev.key === key) { this.byObj.set(c, prev.g); return prev.g; }
    let g: ComponentGeometry;
    try {
      g = engine.getGeometry(c);
      if (!g || !Array.isArray(g.paths)) throw new Error('bad geometry');
      if (!g.bounds) g = { ...g, bounds: boundsOf(g.paths, c.position) };
    } catch {
      g = { paths: [], bounds: EMPTY_BOUNDS(c.position) };
    }
    this.byId.set(c.id, { key, g });
    this.byObj.set(c, g);
    return g;
  }

  /** Map id -> geometry for the given component list (drops stale ids). */
  all(engine: OpticsEngineAPI, comps: OpticalComponent[]): Map<string, ComponentGeometry> {
    const m = new Map<string, ComponentGeometry>();
    for (const c of comps) m.set(c.id, this.get(engine, c));
    if (this.byId.size > comps.length * 2 + 16) for (const id of [...this.byId.keys()]) if (!m.has(id)) this.byId.delete(id);
    return m;
  }
}

function boundsOf(paths: ComponentGeometry['paths'], fallback: Vec2) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of paths) for (const q of p.points) {
    minx = Math.min(minx, q.x); miny = Math.min(miny, q.y); maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y);
  }
  return Number.isFinite(minx) ? { min: { x: minx, y: miny }, max: { x: maxx, y: maxy } } : EMPTY_BOUNDS(fallback);
}

/** Topmost component under a world point. tol in mm. */
export function hitTest(p: Vec2, comps: OpticalComponent[], geoms: Map<string, ComponentGeometry>, tol: number): string | null {
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const g = geoms.get(c.id);
    if (!g) continue;
    const b = g.bounds;
    if (p.x < b.min.x - tol || p.x > b.max.x + tol || p.y < b.min.y - tol || p.y > b.max.y + tol) continue;
    if (!g.paths.length) return c.id;
    for (const path of g.paths) {
      if (path.closed && path.points.length > 2 && pointInPolygon(p, path.points)) return c.id;
      const extra = path.role === 'decor' && c.type.startsWith('fiber') ? 1.5 : 0;
      if (distToPolyline(p, path.points, path.closed) <= tol + extra) return c.id;
    }
  }
  return null;
}

const triCache = new WeakMap<Vec2[], { ring: Vec2[]; indices: number[] }>();

/** Interleaved glass triangles: x y cx cy r g b radius (8 floats / vertex). */
export function buildGlassMesh(
  comps: OpticalComponent[], geoms: Map<string, ComponentGeometry>, engine: OpticsEngineAPI,
): { data: Float32Array; verts: number } {
  const out: number[] = [];
  for (const c of comps) {
    const g = geoms.get(c.id);
    if (!g) continue;
    for (const p of g.paths) {
      if (!p.closed || p.points.length < 3) continue;
      if (classifyPath(c, g, p) !== 'glass') continue;
      let t = triCache.get(p.points);
      if (!t) { t = triangulate(p.points); triCache.set(p.points, t); }
      if (!t.indices.length) continue;
      const cen = centroid(t.ring);
      let R = 0;
      for (const q of t.ring) R = Math.max(R, Math.hypot(q.x - cen.x, q.y - cen.y));
      const tint = glassTint(c, g.material, engine);
      for (const i of t.indices) {
        const q = t.ring[i];
        out.push(q.x, q.y, cen.x, cen.y, tint[0], tint[1], tint[2], R);
      }
    }
  }
  return { data: new Float32Array(out), verts: out.length / 8 };
}
