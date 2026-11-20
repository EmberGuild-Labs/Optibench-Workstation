/**
 * Uniform-grid spatial index over line segments (traced ray segments, wires…) for hover picking.
 * Built once per trace in O(n · cells crossed); a query only visits the cells inside the pick radius,
 * so hovering stays O(1)-ish with 50k+ segments. Pure (no DOM) — unit tested.
 */
import type { Vec2 } from '@core/types';

export interface Seg { a: Vec2; b: Vec2 }
export interface SegHit { index: number; d: number; t: number; q: Vec2 }

const MAX_CELLS = 512 * 512;
const MAX_CELLS_PER_SEG = 4096;

export class SegmentGrid {
  readonly count: number;
  private segs: readonly Seg[];
  private x0 = 0; private y0 = 0; private cell = 1; private gw = 1; private gh = 1;
  private start: Int32Array = new Int32Array(2);
  private items: Int32Array = new Int32Array(0);
  private stamp: Uint32Array;
  private qid = 0;

  constructor(segs: readonly Seg[], cellSize?: number) {
    this.segs = segs;
    this.count = segs.length;
    this.stamp = new Uint32Array(segs.length);
    if (!segs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of segs) {
      if (!ok(s)) continue;
      x0 = Math.min(x0, s.a.x, s.b.x); y0 = Math.min(y0, s.a.y, s.b.y);
      x1 = Math.max(x1, s.a.x, s.b.x); y1 = Math.max(y1, s.a.y, s.b.y);
    }
    if (!Number.isFinite(x0)) return;
    const W = Math.max(x1 - x0, 1e-6), H = Math.max(y1 - y0, 1e-6);
    let cell = cellSize ?? Math.sqrt((W * H) / Math.max(1, segs.length * 2));
    cell = Math.max(cell, Math.max(W, H) / 512, 1e-6);
    while (Math.ceil(W / cell + 1) * Math.ceil(H / cell + 1) > MAX_CELLS) cell *= 1.5;
    this.x0 = x0; this.y0 = y0; this.cell = cell;
    this.gw = Math.max(1, Math.ceil(W / cell) + 1);
    this.gh = Math.max(1, Math.ceil(H / cell) + 1);
    const counts = new Int32Array(this.gw * this.gh + 1);
    for (let i = 0; i < segs.length; i++) if (ok(segs[i])) this.walk(segs[i], (c) => { counts[c]++; });
    const start = new Int32Array(this.gw * this.gh + 1);
    let acc = 0;
    for (let c = 0; c < this.gw * this.gh; c++) { start[c] = acc; acc += counts[c]; }
    start[this.gw * this.gh] = acc;
    const items = new Int32Array(acc);
    const fill = start.slice();
    for (let i = 0; i < segs.length; i++) if (ok(segs[i])) this.walk(segs[i], (c) => { items[fill[c]++] = i; });
    this.start = start; this.items = items;
  }

  private cellOf(x: number, y: number): [number, number] {
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
    const cy = Math.min(this.gh - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
    return [cx, cy];
  }

  /** Visit every cell the segment passes through (grid DDA), each at most once. */
  private walk(s: Seg, visit: (cell: number) => void): void {
    let [cx, cy] = this.cellOf(s.a.x, s.a.y);
    const [ex, ey] = this.cellOf(s.b.x, s.b.y);
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const c = this.cell;
    const nextX = this.x0 + (cx + (stepX > 0 ? 1 : 0)) * c, nextY = this.y0 + (cy + (stepY > 0 ? 1 : 0)) * c;
    let tMaxX = dx !== 0 ? (nextX - s.a.x) / dx : Infinity;
    let tMaxY = dy !== 0 ? (nextY - s.a.y) / dy : Infinity;
    const tDX = dx !== 0 ? c / Math.abs(dx) : Infinity, tDY = dy !== 0 ? c / Math.abs(dy) : Infinity;
    for (let n = 0; n < MAX_CELLS_PER_SEG; n++) {
      visit(cy * this.gw + cx);
      if (cx === ex && cy === ey) return;
      if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDX; } else { cy += stepY; tMaxY += tDY; }
      if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return;
    }
  }

  /** Nearest segment within `tol` (world units) of `p`, or null. `accept` can skip segments. */
  nearest(p: Vec2, tol: number, accept?: (index: number) => boolean): SegHit | null {
    if (!this.items.length) return null;
    if (++this.qid === 0xffffffff) { this.stamp.fill(0); this.qid = 1; }
    const q = this.qid;
    const [cx0, cy0] = this.cellOf(p.x - tol, p.y - tol);
    const [cx1, cy1] = this.cellOf(p.x + tol, p.y + tol);
    if (p.x + tol < this.x0 || p.y + tol < this.y0 || p.x - tol > this.x0 + this.gw * this.cell || p.y - tol > this.y0 + this.gh * this.cell) return null;
    let best: SegHit | null = null;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * this.gw + cx;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const i = this.items[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (accept && !accept(i)) continue;
          const s = this.segs[i];
          const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
          const l2 = abx * abx + aby * aby;
          let t = l2 > 0 ? ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = s.a.x + abx * t, qy = s.a.y + aby * t;
          const d = Math.hypot(p.x - qx, p.y - qy);
          if (d <= tol && (!best || d < best.d)) best = { index: i, d, t, q: { x: qx, y: qy } };
        }
      }
    }
    return best;
  }
}

function ok(s: Seg): boolean {
  return Number.isFinite(s.a.x) && Number.isFinite(s.a.y) && Number.isFinite(s.b.x) && Number.isFinite(s.b.y);
}

/** Brute-force reference (tests). */
export function nearestBrute(segs: readonly Seg[], p: Vec2, tol: number): SegHit | null {
  let best: SegHit | null = null;
  segs.forEach((s, i) => {
    if (!ok(s)) return;
    const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
    const l2 = abx * abx + aby * aby;
    let t = l2 > 0 ? ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: s.a.x + abx * t, y: s.a.y + aby * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= tol && (!best || d < best.d)) best = { index: i, d, t, q };
  });
  return best;
}
