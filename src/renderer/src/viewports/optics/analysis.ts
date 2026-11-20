/**
 * Trace/geometry cross-analysis used purely for visuals:
 *  - which side of each mirror is the reflective front (so the backing hatch goes behind it)
 *  - surface normals at ray hit points (display.showNormals)
 */
import type { ComponentGeometry, OpticalComponent, TraceResult, Vec2 } from '@core/types';
import { closestOnSegment } from './math';

/** key `${componentId}:${pathIndex}` -> +1 (front on the left of the polyline direction) or -1 */
export function computeMirrorFronts(
  components: OpticalComponent[], geoms: Map<string, ComponentGeometry>, trace: TraceResult | null,
): Map<string, number> {
  const out = new Map<string, number>();
  const mirrors: { key: string; a: Vec2; b: Vec2; min: Vec2; max: Vec2; score: number }[] = [];
  for (const c of components) {
    const g = geoms.get(c.id);
    if (!g) continue;
    g.paths.forEach((p, i) => {
      if (p.role !== 'mirror' || p.closed || p.points.length < 2) return;
      const a = p.points[0], b = p.points[p.points.length - 1];
      const key = `${c.id}:${i}`;
      // default: front faces the component's local -x (sources usually sit there) — refined below
      const dir = { x: b.x - a.x, y: b.y - a.y };
      const lx = { x: -Math.cos(c.rotation), y: -Math.sin(c.rotation) };
      out.set(key, dir.x * lx.y - dir.y * lx.x >= 0 ? 1 : -1);
      mirrors.push({ key, a, b, min: { x: g.bounds.min.x - 1, y: g.bounds.min.y - 1 }, max: { x: g.bounds.max.x + 1, y: g.bounds.max.y + 1 }, score: 0 });
    });
  }
  if (!mirrors.length || !trace) return out;
  const segs = trace.segments;
  const lim = Math.min(segs.length, 60000);
  for (let i = 0; i < lim; i++) {
    const s = segs[i];
    for (const m of mirrors) {
      const p = s.b;
      if (p.x < m.min.x || p.x > m.max.x || p.y < m.min.y || p.y > m.max.y) continue;
      if (closestOnSegment(p, m.a, m.b).d > 0.8) continue;
      const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
      const side = dx * (s.a.y - m.a.y) - dy * (s.a.x - m.a.x);
      m.score += side > 0 ? s.power + 1e-12 : -(s.power + 1e-12);
    }
  }
  for (const m of mirrors) if (m.score !== 0) out.set(m.key, m.score > 0 ? 1 : -1);
  return out;
}

export interface NormalMark { p: Vec2; n: Vec2 }

export function computeNormals(
  components: OpticalComponent[], geoms: Map<string, ComponentGeometry>, trace: TraceResult | null, max = 1500,
): NormalMark[] {
  if (!trace) return [];
  const edges: { a: Vec2; b: Vec2 }[] = [];
  for (const c of components) {
    const g = geoms.get(c.id);
    if (!g) continue;
    for (const p of g.paths) {
      if (p.role === 'decor' || p.role === 'emitter') continue;
      const pts = p.points;
      for (let i = 0; i < pts.length - 1; i++) edges.push({ a: pts[i], b: pts[i + 1] });
      if (p.closed && pts.length > 2) edges.push({ a: pts[pts.length - 1], b: pts[0] });
    }
  }
  if (!edges.length) return [];
  const segs = trace.segments;
  const stride = Math.max(1, Math.ceil(segs.length / (max * 3)));
  const out: NormalMark[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < segs.length && out.length < max; i += stride) {
    const s = segs[i];
    const p = s.b;
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let best = 0.4, bestE: { a: Vec2; b: Vec2 } | null = null;
    for (const e of edges) {
      if (p.x < Math.min(e.a.x, e.b.x) - 0.5 || p.x > Math.max(e.a.x, e.b.x) + 0.5) continue;
      if (p.y < Math.min(e.a.y, e.b.y) - 0.5 || p.y > Math.max(e.a.y, e.b.y) + 0.5) continue;
      const d = closestOnSegment(p, e.a, e.b).d;
      if (d < best) { best = d; bestE = e; }
    }
    if (!bestE) continue;
    const dx = bestE.b.x - bestE.a.x, dy = bestE.b.y - bestE.a.y, l = Math.hypot(dx, dy) || 1;
    let n = { x: -dy / l, y: dx / l };
    const ix = s.b.x - s.a.x, iy = s.b.y - s.a.y;
    if (n.x * ix + n.y * iy > 0) n = { x: -n.x, y: -n.y }; // face the incoming ray
    out.push({ p, n });
  }
  return out;
}
