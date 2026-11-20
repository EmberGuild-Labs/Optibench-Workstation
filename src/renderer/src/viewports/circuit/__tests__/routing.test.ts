import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@core/types';
import { autoRoute, buildRouteContext, emptyContext, lRoute, routeAStar, simplify } from '../routing';

const isOrtho = (pts: Vec2[]): boolean => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const bends = (pts: Vec2[]): number => Math.max(0, pts.length - 2);
const cells = (pts: Vec2[]): Vec2[] => {
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let k = 1; k <= n; k++) out.push({ x: a.x + Math.sign(b.x - a.x) * k, y: a.y + Math.sign(b.y - a.y) * k });
  }
  return out;
};

describe('routing', () => {
  it('L route picks orientation', () => {
    expect(lRoute({ x: 0, y: 0 }, { x: 3, y: 2 }, true)).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }]);
    expect(lRoute({ x: 0, y: 0 }, { x: 3, y: 2 }, false)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 3, y: 2 }]);
  });

  it('simplify merges collinear points', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }])).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }]);
  });

  it('A* finds a single-bend route in free space honoring start direction', () => {
    const ctx = emptyContext();
    const h = routeAStar({ x: 0, y: 0 }, { x: 5, y: 4 }, ctx, { startDir: 0 })!;
    expect(h).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }]);
    const v = routeAStar({ x: 0, y: 0 }, { x: 5, y: 4 }, ctx, { startDir: 1 })!;
    expect(v).toEqual([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 5, y: 4 }]);
  });

  it('routes around a component body', () => {
    const ctx = buildRouteContext([{ x0: 2, y0: -2, x1: 4, y1: 2 }], [], []);
    const r = routeAStar({ x: 0, y: 0 }, { x: 6, y: 0 }, ctx)!;
    expect(r).not.toBeNull();
    expect(isOrtho(r)).toBe(true);
    for (const c of cells(r)) expect(ctx.blocked.has(`${c.x},${c.y}`)).toBe(false);
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[r.length - 1]).toEqual({ x: 6, y: 0 });
    expect(bends(r)).toBeLessThanOrEqual(4);
  });

  it('never bends on or runs along an existing wire', () => {
    const wire = { id: 'w', points: [{ x: -5, y: 3 }, { x: 10, y: 3 }] };
    const ctx = buildRouteContext([], [], [wire]);
    const r = routeAStar({ x: 0, y: 0 }, { x: 6, y: 6 }, ctx)!;
    expect(isOrtho(r)).toBe(true);
    for (let i = 1; i < r.length - 1; i++) expect(r[i].y).not.toBe(3);
  });

  it('allows ending on an obstacle target (pin) and falls back to L', () => {
    const ctx = buildRouteContext([], [{ x: 4, y: 4 }], []);
    const r = autoRoute({ x: 0, y: 0 }, { x: 4, y: 4 }, ctx, { startDir: 0 });
    expect(r[r.length - 1]).toEqual({ x: 4, y: 4 });
    const fb = autoRoute({ x: 0, y: 0 }, { x: 3, y: 3 }, null, { startDir: 1 });
    expect(fb).toEqual([{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 3, y: 3 }]);
  });

  it('is fast on a large free area', () => {
    const t = performance.now();
    const r = routeAStar({ x: 0, y: 0 }, { x: 120, y: 80 }, emptyContext());
    expect(r).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(500);
  });
});
