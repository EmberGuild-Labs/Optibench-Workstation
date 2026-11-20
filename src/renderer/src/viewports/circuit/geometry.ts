/**
 * Pure geometry helpers for the circuit viewport: component transforms (fitted to the
 * engine's own pin placement so symbols always line up), body rectangles, hit tests.
 * Only type imports from @core so this module is test-friendly.
 */
import type { CircuitComponent, CircuitComponentDef, CircuitEngineAPI, PinDef, Vec2, ParamValue } from '@core/types';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** Canvas-style affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

export const key = (p: Vec2): string => `${p.x},${p.y}`;
export const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const snap = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Rotation matrices (quarter turns clockwise on a y-down screen). [a,b,c,d] */
const ROT: [number, number, number, number][] = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]];

export function linear(rot: number, mirrored: boolean): [number, number, number, number] {
  const [a, b, c, d] = ROT[((rot % 4) + 4) % 4];
  // R * M where M = mirror x (applied first)
  return mirrored ? [-a, -b, c, d] : [a, b, c, d];
}

export function apply(m: Mat, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}
export function applyLinear(m: Mat, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}
/** Inverse for orthonormal (rotation/reflection) matrices. */
export function invApply(m: Mat, p: Vec2): Vec2 {
  const x = p.x - m.e, y = p.y - m.f;
  const det = m.a * m.d - m.b * m.c || 1;
  return { x: (m.d * x - m.c * y) / det, y: (-m.b * x + m.a * y) / det };
}

export function resolvePins(def: CircuitComponentDef | undefined, props: Record<string, ParamValue>): PinDef[] {
  if (!def) return [];
  try {
    const p = typeof def.pins === 'function' ? def.pins(props) : def.pins;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** Local body rectangle (rotation 0). Interprets def.size robustly (ox/oy as top-left offset). */
export function bodyRect(def: CircuitComponentDef | undefined, pins: PinDef[]): Rect {
  const s = def?.size;
  if (!s || !(s.w > 0) || !(s.h > 0)) {
    if (pins.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pins) { x0 = Math.min(x0, p.offset.x); y0 = Math.min(y0, p.offset.y); x1 = Math.max(x1, p.offset.x); y1 = Math.max(y1, p.offset.y); }
      if (x1 - x0 < 1) { x0 -= 0.5; x1 += 0.5; }
      if (y1 - y0 < 1) { y0 -= 0.5; y1 += 0.5; }
      return { x0, y0, x1, y1 };
    }
    return { x0: -1, y0: -1, x1: 1, y1: 1 };
  }
  const cands: Rect[] = [
    { x0: s.ox, y0: s.oy, x1: s.ox + s.w, y1: s.oy + s.h },
    { x0: -s.ox, y0: -s.oy, x1: -s.ox + s.w, y1: -s.oy + s.h },
    { x0: s.ox - s.w / 2, y0: s.oy - s.h / 2, x1: s.ox + s.w / 2, y1: s.oy + s.h / 2 }
  ];
  let best = cands[0], bestScore = Infinity;
  for (const r of cands) {
    let score = 0;
    for (const p of pins) score += distToRect(p.offset, r);
    if (score < bestScore - 1e-9) { bestScore = score; best = r; }
  }
  return best;
}

export function distToRect(p: Vec2, r: Rect): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

export function rectCenter(r: Rect): Vec2 { return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }; }

export function transformRect(m: Mat, r: Rect): Rect {
  const pts = [apply(m, { x: r.x0, y: r.y0 }), apply(m, { x: r.x1, y: r.y0 }), apply(m, { x: r.x0, y: r.y1 }), apply(m, { x: r.x1, y: r.y1 })];
  return {
    x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y))
  };
}

export interface CompFit {
  c: CircuitComponent;
  def?: CircuitComponentDef;
  m: Mat;                                   // local -> world
  pins: PinDef[];                           // local
  world: { name: string; p: Vec2 }[];       // world pin positions (from engine)
  rect: Rect;                               // local body rect
  bounds: Rect;                             // world AABB of body + pins
}

/**
 * Finds the local->world transform that best reproduces engine.getPinPositions. Tries all
 * 8 orientations (preferring the one implied by rotation/mirrored) and fits translation,
 * so symbols drawn in local coordinates always line up with the engine's pins.
 */
export function fitComponent(c: CircuitComponent, def: CircuitComponentDef | undefined, engine: Pick<CircuitEngineAPI, 'getPinPositions'>): CompFit {
  const pins = resolvePins(def, c.props);
  let world: { name: string; p: Vec2 }[] = [];
  try { world = engine.getPinPositions(c) ?? []; } catch { world = []; }
  const rect = bodyRect(def, pins);
  const pairs: [Vec2, Vec2][] = [];
  const used = new Set<number>();
  pins.forEach((pd, i) => {
    let j = world.findIndex((w, k) => !used.has(k) && w.name === pd.name);
    if (j < 0 && world.length === pins.length && !used.has(i)) j = i;
    if (j >= 0) { used.add(j); pairs.push([pd.offset, world[j].p]); }
  });
  const expected = (c.rotation ?? 0) + (c.mirrored ? 4 : 0);
  const order = [expected, ...[0, 1, 2, 3, 4, 5, 6, 7].filter((k) => k !== expected)];
  let best: Mat | null = null, bestErr = Infinity;
  for (const k of order) {
    const [a, b, cc, d] = linear(k % 4, k >= 4);
    let e = c.position.x, f = c.position.y;
    if (pairs.length) {
      e = 0; f = 0;
      for (const [l, w] of pairs) { e += w.x - (a * l.x + cc * l.y); f += w.y - (b * l.x + d * l.y); }
      e /= pairs.length; f /= pairs.length;
      // keep integer-ish placement if close to position
      if (Math.abs(e - c.position.x) < 1e-6 && Math.abs(f - c.position.y) < 1e-6) { e = c.position.x; f = c.position.y; }
    }
    const m: Mat = { a, b, c: cc, d, e, f };
    let err = 0;
    for (const [l, w] of pairs) { const q = apply(m, l); err += Math.abs(q.x - w.x) + Math.abs(q.y - w.y); }
    if (err < bestErr - 1e-9) { bestErr = err; best = m; }
    if (err < 1e-9) break;
  }
  const m = best!;
  if (!world.length && pins.length) world = pins.map((p) => ({ name: p.name, p: apply(m, p.offset) }));
  const b = transformRect(m, rect);
  for (const w of world) { b.x0 = Math.min(b.x0, w.p.x); b.y0 = Math.min(b.y0, w.p.y); b.x1 = Math.max(b.x1, w.p.x); b.y1 = Math.max(b.y1, w.p.y); }
  return { c, def, m, pins, world, rect, bounds: b };
}

/** Direction (unit axis vector, world) a pin points away from its body. */
export function pinOutward(fit: CompFit, pinName: string): Vec2 | null {
  const pd = fit.pins.find((p) => p.name === pinName);
  if (!pd) return null;
  const c = rectCenter(fit.rect);
  let dx = pd.offset.x - c.x, dy = pd.offset.y - c.y;
  // pins on an edge: use the edge normal
  const r = fit.rect;
  if (Math.abs(pd.offset.x - r.x0) < 1e-6 || pd.offset.x < r.x0) { dx = -1; dy = 0; }
  else if (Math.abs(pd.offset.x - r.x1) < 1e-6 || pd.offset.x > r.x1) { dx = 1; dy = 0; }
  else if (Math.abs(pd.offset.y - r.y0) < 1e-6 || pd.offset.y < r.y0) { dx = 0; dy = -1; }
  else if (Math.abs(pd.offset.y - r.y1) < 1e-6 || pd.offset.y > r.y1) { dx = 0; dy = 1; }
  if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; dx = Math.sign(dx) || 1; } else { dx = 0; dy = Math.sign(dy); }
  const w = applyLinear(fit.m, { x: dx, y: dy });
  return { x: Math.round(w.x), y: Math.round(w.y) };
}

/** Does a world point hit the component body? */
export function hitBody(fit: CompFit, p: Vec2, pad = 0.15): boolean {
  const l = invApply(fit.m, p);
  const r = fit.rect;
  // thin bodies get a minimum thickness for easier picking
  const cy = (r.y0 + r.y1) / 2, cx = (r.x0 + r.x1) / 2;
  const hw = Math.max((r.x1 - r.x0) / 2, 0.45) + pad, hh = Math.max((r.y1 - r.y0) / 2, 0.45) + pad;
  return Math.abs(l.x - cx) <= hw && Math.abs(l.y - cy) <= hh;
}

export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number; q: Vec2 } {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + vx * t, y: a.y + vy * t };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), t, q };
}

/** Strictly inside segment (excluding endpoints), for integer grid points. */
export function onSegmentInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (eq(p, a) || eq(p, b)) return false;
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}
export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
}
