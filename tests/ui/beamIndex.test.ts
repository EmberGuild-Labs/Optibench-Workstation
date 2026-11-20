import { describe, expect, it } from 'vitest';
import { SegmentGrid, nearestBrute, type Seg } from '../../src/renderer/src/lib/beamIndex';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('SegmentGrid (overlay hit index)', () => {
  it('matches brute force on random segments', () => {
    const r = rng(7);
    const segs: Seg[] = [];
    for (let i = 0; i < 3000; i++) {
      const a = { x: r() * 400 - 200, y: r() * 300 - 150 };
      const L = r() < 0.1 ? 300 : r() * 20;
      const ang = r() * Math.PI * 2;
      segs.push({ a, b: { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L } });
    }
    segs.push({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }); // degenerate
    segs.push({ a: { x: NaN, y: 0 }, b: { x: 1, y: 1 } }); // invalid, ignored
    segs.push({ a: { x: -100, y: 0 }, b: { x: 100, y: 0 } }); // axis aligned
    const g = new SegmentGrid(segs);
    for (let k = 0; k < 2000; k++) {
      const p = { x: r() * 500 - 250, y: r() * 400 - 200 };
      const tol = r() * 3;
      const a = g.nearest(p, tol), b = nearestBrute(segs, p, tol);
      expect(a === null).toBe(b === null);
      if (a && b) expect(a.d).toBeCloseTo(b.d, 9);
    }
  });
  it('handles 50k segments quickly', () => {
    const r = rng(3);
    const segs: Seg[] = [];
    for (let i = 0; i < 50000; i++) {
      const a = { x: r() * 1000, y: r() * 1000 };
      segs.push({ a, b: { x: a.x + r() * 50 - 25, y: a.y + r() * 50 - 25 } });
    }
    const t0 = performance.now();
    const g = new SegmentGrid(segs);
    const tb = performance.now() - t0;
    const t1 = performance.now();
    let found = 0;
    for (let k = 0; k < 5000; k++) if (g.nearest({ x: r() * 1000, y: r() * 1000 }, 2)) found++;
    const tq = (performance.now() - t1) / 5000;
    expect(found).toBeGreaterThan(0);
    expect(tb).toBeLessThan(1000);
    expect(tq).toBeLessThan(0.5);
  });
  it('accept filter and empty input', () => {
    expect(new SegmentGrid([]).nearest({ x: 0, y: 0 }, 10)).toBeNull();
    const segs: Seg[] = [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 0, y: 1 }, b: { x: 10, y: 1 } }];
    const g = new SegmentGrid(segs);
    expect(g.nearest({ x: 5, y: 0.2 }, 2)!.index).toBe(0);
    expect(g.nearest({ x: 5, y: 0.2 }, 2, (i) => i !== 0)!.index).toBe(1);
    expect(g.nearest({ x: 5, y: 50 }, 2)).toBeNull();
  });
});
