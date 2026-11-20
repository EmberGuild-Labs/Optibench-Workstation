/**
 * Pure wire ("smart cable") operations: cleanup / normalization, splitting at T-junctions,
 * merging, segment & vertex dragging, rubber-banding. All points are integer grid points.
 *
 * Connectivity rules (shared with the engine): wires connect at shared vertices, a wire
 * vertex (end or corner) lying on another wire's segment is a T-junction, pins connect to
 * wire vertices only — so normalization inserts a vertex wherever a pin lies on a segment.
 */
import type { Vec2, Wire } from '@core/types';
import { eq, key, onSegmentInterior } from './geometry';

const clone = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

/** p is a redundant interior vertex: a-p-b on one line (straight run, or a doubled-back spike). */
function collinearSameDir(a: Vec2, p: Vec2, b: Vec2): boolean {
  const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
  return cross === 0;
}

/**
 * Round, drop consecutive duplicates, and remove interior vertices on a straight run or at a
 * doubled-back spike (a route that overshoots and returns along the same line).
 * `keep(p)` protects junction vertices from being merged away.
 */
export function cleanPolyline(pts: Vec2[], keep?: (p: Vec2) => boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const raw of pts) {
    const p = { x: Math.round(raw.x), y: Math.round(raw.y) };
    if (out.length && eq(out[out.length - 1], p)) continue;
    out.push(p);
  }
  if (out.length < 3) return out;
  const res: Vec2[] = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = res[res.length - 1], p = out[i], b = out[i + 1];
    if (collinearSameDir(a, p, b) && !(keep && keep(p))) continue;
    res.push(p);
  }
  res.push(out[out.length - 1]);
  // a removed run could have left a duplicate at the end
  const fin: Vec2[] = [];
  for (const p of res) if (!fin.length || !eq(fin[fin.length - 1], p)) fin.push(p);
  return fin;
}

export function makeIdGen(existing: Iterable<string>, prefix = 'w'): () => string {
  const used = new Set(existing);
  let n = 0;
  const stamp = Date.now().toString(36);
  return () => {
    let id: string;
    do { id = `${prefix}_${stamp}_${(n++).toString(36)}`; } while (used.has(id));
    used.add(id);
    return id;
  };
}

export interface NormalizeOptions {
  /** World pin positions (any component). */
  pins?: Vec2[];
  /** Wire ids whose collinear interior vertices must be preserved (freshly inserted vertex). */
  keepCollinear?: Set<string>;
  genId?: () => string;
  /** Merge wires that meet end-to-end at a plain point (default true). */
  merge?: boolean;
}

/**
 * Normalize a set of wires:
 *  1. round + dedupe, drop degenerate wires
 *  2. insert a vertex wherever another wire's vertex or a pin lies on a segment (T-junction /
 *     pin tap, so the engine sees the connection the viewport draws) and
 *     split wires at interior vertices that are junctions (other wire endpoint or pin)
 *  3. merge collinear segments (except at junction vertices)
 *  4. merge two wires meeting end-to-end at a point nothing else touches
 */
export function normalizeWires(wires: Wire[], opts: NormalizeOptions = {}): Wire[] {
  const genId = opts.genId ?? makeIdGen(wires.map((w) => w.id));
  const pinKeys = new Set((opts.pins ?? []).map(key));
  const keepIds = opts.keepCollinear ?? new Set<string>();

  // 1. basic clean
  let ws: Wire[] = [];
  for (const w of wires) {
    const pts = cleanPolyline(w.points, () => true);
    if (pts.length >= 2) ws.push({ ...w, points: pts });
  }

  // 2a. insert T-junction vertices
  // any vertex (end or corner) of a wire lying on another segment is a junction (engine rule)
  const endpoints: { p: Vec2; wi: number }[] = [];
  ws.forEach((w, wi) => { for (const p of w.points) endpoints.push({ p, wi }); });
  const byX = new Map<number, Vec2[]>(), byY = new Map<number, Vec2[]>();
  // pins touched by a segment get a vertex too: the engine connects pins only at wire
  // vertices, so a wire drawn over a pin would otherwise look connected but stay open
  const touchPts: Vec2[] = endpoints.map((e) => e.p);
  for (const p of opts.pins ?? []) touchPts.push({ x: Math.round(p.x), y: Math.round(p.y) });
  for (const p of touchPts) {
    (byX.get(p.x) ?? byX.set(p.x, []).get(p.x)!).push(p);
    (byY.get(p.y) ?? byY.set(p.y, []).get(p.y)!).push(p);
  }
  ws = ws.map((w) => {
    const out: Vec2[] = [w.points[0]];
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      let cand: Vec2[];
      if (a.y === b.y) cand = byY.get(a.y) ?? [];
      else if (a.x === b.x) cand = byX.get(a.x) ?? [];
      else cand = touchPts;
      const inside = cand.filter((p) => onSegmentInterior(p, a, b));
      if (inside.length) {
        const uniq = new Map<string, Vec2>();
        for (const p of inside) uniq.set(key(p), p);
        const sorted = [...uniq.values()].sort((p, q) => (Math.abs(p.x - a.x) + Math.abs(p.y - a.y)) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y)));
        for (const p of sorted) out.push(clone(p));
      }
      out.push(b);
    }
    return { ...w, points: out };
  });

  // 2b. split at interior junction vertices
  const endCount = new Map<string, number>();
  for (const w of ws) for (const p of [w.points[0], w.points[w.points.length - 1]]) endCount.set(key(p), (endCount.get(key(p)) ?? 0) + 1);
  const split: Wire[] = [];
  for (const w of ws) {
    let cur: Vec2[] = [w.points[0]];
    let first = true;
    for (let i = 1; i < w.points.length; i++) {
      const p = w.points[i];
      cur.push(p);
      const interior = i < w.points.length - 1;
      if (interior && ((endCount.get(key(p)) ?? 0) > 0 || pinKeys.has(key(p)))) {
        split.push({ ...w, id: first ? w.id : genId(), points: cur });
        first = false;
        cur = [p];
      }
    }
    if (cur.length >= 2) split.push({ ...w, id: first ? w.id : genId(), points: cur });
  }
  ws = split;

  // 3. collinear merge, protecting shared vertices
  const vertexUse = new Map<string, number>();
  for (const w of ws) for (const p of w.points) vertexUse.set(key(p), (vertexUse.get(key(p)) ?? 0) + 1);
  const isJunction = (p: Vec2): boolean => (vertexUse.get(key(p)) ?? 0) > 1 || pinKeys.has(key(p));
  ws = ws.map((w) => ({ ...w, points: keepIds.has(w.id) ? w.points : cleanPolyline(w.points, isJunction) })).filter((w) => w.points.length >= 2);

  // 4. end-to-end merging
  if (opts.merge !== false) ws = mergeWires(ws, pinKeys, keepIds);
  return ws;
}

function mergeWires(input: Wire[], pinKeys: Set<string>, keepIds: Set<string>): Wire[] {
  let ws = input.slice();
  for (let guard = 0; guard < 10000; guard++) {
    const ends = new Map<string, { wi: number; atStart: boolean }[]>();
    const interior = new Set<string>();
    ws.forEach((w, wi) => {
      const n = w.points.length;
      w.points.forEach((p, i) => {
        if (i === 0 || i === n - 1) {
          const k = key(p);
          (ends.get(k) ?? ends.set(k, []).get(k)!).push({ wi, atStart: i === 0 });
        } else interior.add(key(p));
      });
    });
    let done = true;
    for (const [k, list] of ends) {
      if (list.length !== 2 || list[0].wi === list[1].wi || pinKeys.has(k) || interior.has(k)) continue;
      const A = ws[list[0].wi], B = ws[list[1].wi];
      if ((A.color ?? '') !== (B.color ?? '') || (A.label ?? '') !== (B.label ?? '')) continue;
      const [px, py] = k.split(',').map(Number);
      const pt = { x: px, y: py };
      // no other wire's segment passes through this point (that would be a T-junction)
      const onOther = ws.some((w, wi) => wi !== list[0].wi && wi !== list[1].wi && w.points.some((q, i) => i > 0 && onSegmentInterior(pt, w.points[i - 1], q)));
      if (onOther) continue;
      const a = list[0].atStart ? A.points.slice().reverse() : A.points.slice(); // ends at pt
      const b = list[1].atStart ? B.points.slice() : B.points.slice().reverse(); // starts at pt
      const pts = [...a, ...b.slice(1)];
      const merged: Wire = { ...A, points: keepIds.has(A.id) || keepIds.has(B.id) ? cleanPolyline(pts, () => true) : cleanPolyline(pts) };
      ws = ws.filter((_, i) => i !== list[0].wi && i !== list[1].wi);
      if (merged.points.length >= 2) ws.push(merged);
      done = false;
      break;
    }
    if (done) break;
  }
  return ws;
}

/** Split a wire at grid point p lying on it (vertex or segment interior). */
export function splitWireAt(w: Wire, p: Vec2, newId: string): [Wire, Wire] | null {
  const pts = w.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (eq(p, a) && i > 0) return [{ ...w, points: pts.slice(0, i + 1) }, { ...w, id: newId, points: pts.slice(i) }];
    if (onSegmentInterior(p, a, b)) {
      return [{ ...w, points: [...pts.slice(0, i + 1), clone(p)] }, { ...w, id: newId, points: [clone(p), ...pts.slice(i + 1)] }];
    }
  }
  return null;
}

/** Drag segment i perpendicular by d. Endpoint segments grow a stub so wire ends stay attached. */
export function moveSegment(points: Vec2[], i: number, d: Vec2): Vec2[] {
  const out = points.map(clone);
  if (i < 0 || i >= out.length - 1) return out;
  const a = out[i], b = out[i + 1];
  let dd = d;
  if (a.y === b.y && a.x !== b.x) dd = { x: 0, y: d.y };
  else if (a.x === b.x && a.y !== b.y) dd = { x: d.x, y: 0 };
  if (dd.x === 0 && dd.y === 0) return out;
  let si = i;
  if (si === 0) { out.unshift(clone(out[0])); si++; }
  if (si + 1 === out.length - 1) out.push(clone(out[out.length - 1]));
  out[si] = { x: out[si].x + dd.x, y: out[si].y + dd.y };
  out[si + 1] = { x: out[si + 1].x + dd.x, y: out[si + 1].y + dd.y };
  return out;
}

function rubberStart(pts: Vec2[], p: Vec2): Vec2[] {
  const out = pts.map(clone);
  if (!out.length) return [clone(p)];
  if (eq(out[0], p)) return out;
  if (out.length === 1) return [clone(p), out[0]];
  const a = out[0], b = out[1];
  const horiz = a.y === b.y && a.x !== b.x;
  const vert = a.x === b.x && a.y !== b.y;
  if (out.length >= 3 && (horiz || vert)) {
    const c = out[2];
    const nextPerp = horiz ? b.x === c.x : b.y === c.y;
    if (nextPerp) {
      out[1] = horiz ? { x: b.x, y: p.y } : { x: p.x, y: b.y };
      out[0] = clone(p);
      return out;
    }
  }
  // b is the other end (or not orthogonal): connect with an L / Z keeping b's direction
  if (p.x === b.x || p.y === b.y) { out[0] = clone(p); return out; }
  const rest = out.slice(1);
  const useH = horiz || (!vert && Math.abs(p.x - b.x) >= Math.abs(p.y - b.y));
  if (useH) {
    const mx = Math.round((p.x + b.x) / 2);
    return [clone(p), { x: mx, y: p.y }, { x: mx, y: b.y }, ...rest];
  }
  const my = Math.round((p.y + b.y) / 2);
  return [clone(p), { x: p.x, y: my }, { x: b.x, y: my }, ...rest];
}

/** Move one end of a wire to p, re-routing the last segments to stay orthogonal. */
export function rubberBandEnd(points: Vec2[], end: 'start' | 'end', p: Vec2): Vec2[] {
  if (end === 'start') return rubberStart(points, p);
  return rubberStart(points.slice().reverse(), p).reverse();
}

/** Drag a vertex; neighbouring segments stretch to stay orthogonal. Endpoints rubber-band. */
export function moveVertex(points: Vec2[], k: number, p: Vec2): Vec2[] {
  const n = points.length;
  if (k === 0) return rubberBandEnd(points, 'start', p);
  if (k === n - 1) return rubberBandEnd(points, 'end', p);
  const out = points.map(clone);
  const orig = points[k];
  out[k] = clone(p);
  // next neighbour first (insertions after k do not shift k)
  const nb = k + 1;
  const hN = points[nb].y === orig.y && points[nb].x !== orig.x;
  if (nb === n - 1) {
    const corner = hN ? { x: p.x, y: points[nb].y } : { x: points[nb].x, y: p.y };
    out.splice(nb, 0, corner);
  } else if (hN) out[nb] = { x: out[nb].x, y: p.y };
  else out[nb] = { x: p.x, y: out[nb].y };
  const pb = k - 1;
  const hP = points[pb].y === orig.y && points[pb].x !== orig.x;
  if (pb === 0) {
    const corner = hP ? { x: p.x, y: points[pb].y } : { x: points[pb].x, y: p.y };
    out.splice(k, 0, corner);
  } else if (hP) out[pb] = { x: out[pb].x, y: p.y };
  else out[pb] = { x: p.x, y: out[pb].y };
  return out;
}

/** Insert vertex p into segment segIdx (p is projected/snapped by the caller). */
export function insertVertex(points: Vec2[], segIdx: number, p: Vec2): Vec2[] {
  const out = points.map(clone);
  if (out.some((q) => eq(q, p))) return out;
  out.splice(segIdx + 1, 0, clone(p));
  return out;
}

/** Nearest integer grid point lying on a wire segment to world point w. */
export function nearestGridOnSegment(a: Vec2, b: Vec2, w: Vec2): Vec2 {
  if (a.y === b.y) return { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), Math.round(w.x))), y: a.y };
  if (a.x === b.x) return { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), Math.round(w.y))) };
  // diagonal: nearest of the endpoints
  return Math.hypot(w.x - a.x, w.y - a.y) < Math.hypot(w.x - b.x, w.y - b.y) ? clone(a) : clone(b);
}
