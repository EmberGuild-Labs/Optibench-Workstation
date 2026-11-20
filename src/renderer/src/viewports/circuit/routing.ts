/**
 * Manhattan auto-router for smart cables: bounded A* on the integer grid with bend
 * penalty, routing around component bodies, avoiding running along existing wires and
 * never bending on (or touching) other wires' vertices / foreign pins.
 */
import type { Vec2, Wire } from '@core/types';
import type { Rect } from './geometry';
import { eq, key } from './geometry';

export interface RouteContext {
  /** Hard obstacles (component bodies, foreign pins, existing wire vertices). */
  blocked: Set<string>;
  /** Points covered by horizontal / vertical wire segments. */
  hOcc: Set<string>;
  vOcc: Set<string>;
}

export interface RouteOptions {
  /** Preferred first move direction 0:+x 1:+y 2:-x 3:-y. */
  startDir?: number;
  /** Preferred direction of the final move (into the target). */
  endDir?: number;
  bendPenalty?: number;
  maxExpand?: number;
  margin?: number;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export function dirOf(v: Vec2): number {
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? 0 : 2;
  return v.y >= 0 ? 1 : 3;
}

export function emptyContext(): RouteContext {
  return { blocked: new Set(), hOcc: new Set(), vOcc: new Set() };
}

/** Build a routing context from world body rects, pins and existing wires. */
export function buildRouteContext(bodies: Rect[], pins: Vec2[], wires: Wire[]): RouteContext {
  const ctx = emptyContext();
  for (const r of bodies) {
    const x0 = Math.ceil(r.x0 - 1e-9), x1 = Math.floor(r.x1 + 1e-9);
    const y0 = Math.ceil(r.y0 - 1e-9), y1 = Math.floor(r.y1 + 1e-9);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40000) continue;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ctx.blocked.add(`${x},${y}`);
  }
  for (const p of pins) ctx.blocked.add(key(p));
  for (const w of wires) {
    const pts = w.points;
    for (const p of pts) ctx.blocked.add(key(p));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.y === b.y) {
        const n = Math.abs(b.x - a.x);
        if (n > 5000) continue;
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) ctx.hOcc.add(`${x},${a.y}`);
      } else if (a.x === b.x) {
        const n = Math.abs(b.y - a.y);
        if (n > 5000) continue;
        for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) ctx.vOcc.add(`${a.x},${y}`);
      }
    }
  }
  return ctx;
}

/** Remove collinear interior points and duplicates. */
export function simplify(pts: Vec2[]): Vec2[] {
  const d: Vec2[] = [];
  for (const p of pts) if (!d.length || !eq(d[d.length - 1], p)) d.push(p);
  if (d.length < 3) return d;
  const out: Vec2[] = [d[0]];
  for (let i = 1; i < d.length - 1; i++) {
    const a = out[out.length - 1], p = d[i], b = d[i + 1];
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    if (cross === 0 && (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y) > 0) continue;
    out.push(p);
  }
  out.push(d[d.length - 1]);
  return out;
}

/** Simple L-shaped route. */
export function lRoute(a: Vec2, b: Vec2, horizontalFirst: boolean): Vec2[] {
  if (a.x === b.x || a.y === b.y) return simplify([a, b]);
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [a, corner, b];
}

/** Binary min-heap keyed by f. */
class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size(): number { return this.v.length; }
  push(f: number, v: number): void {
    const F = this.f, V = this.v;
    let i = V.length;
    F.push(f); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      F[i] = F[p]; V[i] = V[p]; i = p;
    }
    F[i] = f; V[i] = v;
  }
  pop(): number {
    const F = this.f, V = this.v;
    const top = V[0];
    const lf = F.pop()!, lv = V.pop()!;
    const n = V.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        F[i] = F[c]; V[i] = V[c]; i = c;
      }
      F[i] = lf; V[i] = lv;
    }
    return top;
  }
}

/**
 * A* Manhattan route from a to b. Returns corner points (including a and b) or null if no
 * route was found within the bounded search.
 */
export function routeAStar(a: Vec2, b: Vec2, ctx: RouteContext, opts: RouteOptions = {}): Vec2[] | null {
  if (eq(a, b)) return [a];
  const bend = opts.bendPenalty ?? 2.5;
  const margin = opts.margin ?? 8;
  const maxExpand = opts.maxExpand ?? 40000;
  const x0 = Math.min(a.x, b.x) - margin, x1 = Math.max(a.x, b.x) + margin;
  const y0 = Math.min(a.y, b.y) - margin, y1 = Math.max(a.y, b.y) + margin;
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  if (W * H > 250000) return null;
  const N = W * H * 5;
  const g = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const idx = (x: number, y: number, d: number): number => ((y - y0) * W + (x - x0)) * 5 + d;
  const heap = new Heap();
  const start = idx(a.x, a.y, 4);
  g[start] = 0;
  heap.push(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), start);
  const bk = key(b);
  let expanded = 0;
  let goal = -1;
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const d = s % 5;
    const cell = (s - d) / 5;
    const x = (cell % W) + x0, y = Math.floor(cell / W) + y0;
    if (x === b.x && y === b.y) { goal = s; break; }
    if (++expanded > maxExpand) break;
    const here = `${x},${y}`;
    const isStart = d === 4;
    const hereOcc = !isStart && (ctx.hOcc.has(here) || ctx.vOcc.has(here));
    for (let nd = 0; nd < 4; nd++) {
      if (!isStart && nd === ((d + 2) & 3)) continue; // no reversing
      const turning = !isStart && nd !== d;
      if (turning && hereOcc) continue; // never bend on an existing wire
      const nx = x + DX[nd], ny = y + DY[nd];
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const nk = `${nx},${ny}`;
      const isGoal = nk === bk;
      if (!isGoal && ctx.blocked.has(nk)) continue;
      let cost = 1;
      if (turning) cost += bend;
      if (isStart && opts.startDir !== undefined && nd !== opts.startDir) cost += nd === ((opts.startDir + 2) & 3) ? bend * 2 : bend * 0.8;
      const horiz = nd === 0 || nd === 2;
      if (!isGoal) {
        if (horiz ? ctx.hOcc.has(nk) : ctx.vOcc.has(nk)) cost += 10; // running along a wire
        else if (horiz ? ctx.vOcc.has(nk) : ctx.hOcc.has(nk)) cost += 0.3; // crossing
      } else if (opts.endDir !== undefined && nd !== opts.endDir) cost += nd === ((opts.endDir + 2) & 3) ? bend * 3 : bend * 1.2;
      const ni = idx(nx, ny, nd);
      const ng = g[s] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = s;
        heap.push(ng + Math.abs(nx - b.x) + Math.abs(ny - b.y), ni);
      }
    }
  }
  if (goal < 0) return null;
  const path: Vec2[] = [];
  for (let s = goal; s >= 0; s = parent[s]) {
    const cell = (s - (s % 5)) / 5;
    path.push({ x: (cell % W) + x0, y: Math.floor(cell / W) + y0 });
  }
  path.reverse();
  return simplify(path);
}

/** A* with L-shape fallback; always returns an orthogonal polyline from a to b. */
export function autoRoute(a: Vec2, b: Vec2, ctx: RouteContext | null, opts: RouteOptions = {}): Vec2[] {
  if (eq(a, b)) return [a];
  if (a.x === b.x || a.y === b.y) {
    // straight shot if nothing is in the way
    if (!ctx || straightClear(a, b, ctx)) return [a, b];
  }
  if (ctx) {
    const r = routeAStar(a, b, ctx, opts);
    if (r) return r;
  }
  const hf = opts.startDir !== undefined ? opts.startDir % 2 === 0 : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  return lRoute(a, b, hf);
}

function straightClear(a: Vec2, b: Vec2, ctx: RouteContext): boolean {
  const horiz = a.y === b.y;
  const n = Math.abs(horiz ? b.x - a.x : b.y - a.y);
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  for (let i = 1; i < n; i++) {
    const k = `${a.x + sx * i},${a.y + sy * i}`;
    if (ctx.blocked.has(k)) return false;
    if (horiz ? ctx.hOcc.has(k) : ctx.vOcc.has(k)) return false;
  }
  return true;
}
