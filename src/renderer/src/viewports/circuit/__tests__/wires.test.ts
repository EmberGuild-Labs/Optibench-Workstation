import { describe, expect, it } from 'vitest';
import type { Vec2, Wire } from '@core/types';
import { cleanPolyline, insertVertex, makeIdGen, moveSegment, moveVertex, normalizeWires, rubberBandEnd, splitWireAt } from '../wires';
import { buildWireGraph, solveEdgeCurrents } from '../netlist';
import { fitComponent } from '../geometry';
import { mockEngine, mockRegistry } from '../dev/mockEngine';

const P = (x: number, y: number): Vec2 => ({ x, y });
const ortho = (pts: Vec2[]): boolean => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);

describe('cleanPolyline', () => {
  it('rounds, dedupes and merges collinear segments', () => {
    expect(cleanPolyline([P(0, 0), P(0.4, 0), P(2, 0), P(4, 0), P(4, 0), P(4, 3)])).toEqual([P(0, 0), P(4, 0), P(4, 3)]);
  });
  it('keeps protected vertices', () => {
    expect(cleanPolyline([P(0, 0), P(2, 0), P(4, 0)], (p) => p.x === 2)).toEqual([P(0, 0), P(2, 0), P(4, 0)]);
  });
});

describe('normalizeWires', () => {
  it('drops zero-length wires', () => {
    expect(normalizeWires([{ id: 'a', points: [P(1, 1), P(1, 1)] }])).toEqual([]);
  });

  it('splits a wire at a T-junction', () => {
    const ws: Wire[] = [{ id: 'main', points: [P(0, 0), P(10, 0)] }, { id: 'br', points: [P(4, 0), P(4, 5)] }];
    const out = normalizeWires(ws, { genId: makeIdGen(['main', 'br']) });
    expect(out).toHaveLength(3);
    const at4 = out.filter((w) => w.points.some((p) => p.x === 4 && p.y === 0));
    expect(at4).toHaveLength(3);
    const g = buildWireGraph(out, []);
    expect(g.junctions).toEqual([P(4, 0)]);
    expect(g.groupCount).toBe(1);
  });

  it('merges wires meeting end-to-end and the collinear joint', () => {
    const ws: Wire[] = [{ id: 'a', points: [P(0, 0), P(3, 0)] }, { id: 'b', points: [P(6, 0), P(3, 0)] }];
    expect(normalizeWires(ws)).toEqual([{ id: 'a', points: [P(0, 0), P(6, 0)] }]);
  });

  it('does not merge at a pin or across colours', () => {
    const ws: Wire[] = [{ id: 'a', points: [P(0, 0), P(3, 0)] }, { id: 'b', points: [P(3, 0), P(6, 0)] }];
    expect(normalizeWires(ws, { pins: [P(3, 0)] })).toHaveLength(2);
    expect(normalizeWires([ws[0], { ...ws[1], color: '#f00' }])).toHaveLength(2);
  });

  it('re-merges after a branch is deleted', () => {
    const ws: Wire[] = [{ id: 'l', points: [P(0, 0), P(4, 0)] }, { id: 'r', points: [P(4, 0), P(10, 0)] }];
    expect(normalizeWires(ws)).toEqual([{ id: 'l', points: [P(0, 0), P(10, 0)] }]);
  });

  it('keeps an inserted collinear vertex when asked', () => {
    const w: Wire = { id: 'a', points: insertVertex([P(0, 0), P(8, 0)], 0, P(4, 0)) };
    expect(normalizeWires([w], { keepCollinear: new Set(['a']) })[0].points).toHaveLength(3);
    expect(normalizeWires([w])[0].points).toHaveLength(2);
  });
});

describe('wire edits', () => {
  it('moves an interior segment perpendicular, neighbours stretch', () => {
    const pts = [P(0, 0), P(4, 0), P(4, 4), P(8, 4)];
    const out = moveSegment(pts, 1, P(2, 7));
    expect(out).toEqual([P(0, 0), P(6, 0), P(6, 4), P(8, 4)]);
    expect(ortho(out)).toBe(true);
  });

  it('moving an end segment grows a stub so the end stays attached', () => {
    const out = moveSegment([P(0, 0), P(6, 0)], 0, P(0, 2));
    expect(out).toEqual([P(0, 0), P(0, 2), P(6, 2), P(6, 0)]);
  });

  it('rubber-bands an end and stays orthogonal', () => {
    const a = rubberBandEnd([P(0, 0), P(4, 0), P(4, 4)], 'start', P(-1, 2));
    expect(a[0]).toEqual(P(-1, 2));
    expect(ortho(a)).toBe(true);
    const b = rubberBandEnd([P(0, 0), P(6, 0)], 'end', P(6, 3));
    expect(b[b.length - 1]).toEqual(P(6, 3));
    expect(b[0]).toEqual(P(0, 0));
    expect(ortho(b)).toBe(true);
  });

  it('drags an interior vertex keeping orthogonality', () => {
    const out = moveVertex([P(0, 0), P(4, 0), P(4, 4), P(8, 4)], 2, P(6, 6));
    expect(ortho(out)).toBe(true);
    expect(out[0]).toEqual(P(0, 0));
    expect(out[out.length - 1]).toEqual(P(8, 4));
    expect(out.some((p) => p.x === 6 && p.y === 6)).toBe(true);
  });

  it('splits a wire at a point', () => {
    const r = splitWireAt({ id: 'a', points: [P(0, 0), P(10, 0)] }, P(3, 0), 'b')!;
    expect(r[0].points).toEqual([P(0, 0), P(3, 0)]);
    expect(r[1]).toEqual({ id: 'b', points: [P(3, 0), P(10, 0)] });
  });
});

describe('netlist currents', () => {
  it('solves tree currents from two-terminal component currents', () => {
    // battery (+ at 0,0) -> wire -> resistor A (10,0); current 1 mA leaves battery '+' into the wire
    const wires: Wire[] = [{ id: 'w', points: [P(0, 0), P(10, 0)] }];
    const pins = [
      { compId: 'bat', pin: '+', p: P(0, 0), index: 0, pinCount: 2 },
      { compId: 'r', pin: 'A', p: P(10, 0), index: 0, pinCount: 2 }
    ];
    const g = buildWireGraph(wires, pins);
    const state = { time: 0, nodeVoltages: {}, pinNets: {}, converged: true, components: { bat: { current: -1e-3 }, r: { current: 1e-3 } } };
    const f = solveEdgeCurrents(g, state);
    const e = g.edges[0];
    const dir = g.nodes[e.a].p.x === 0 ? 1 : -1;
    expect(f[0] * dir).toBeCloseTo(1e-3);
  });
});

describe('component fit', () => {
  it('reproduces engine pin positions for every orientation', () => {
    const d = mockRegistry.find((x) => x.type === 'semi.npn')!;
    for (const r of [0, 1, 2, 3] as const) {
      for (const mirrored of [false, true]) {
        const c = { ...mockEngine.createComponent('semi.npn', P(5, 7)), rotation: r, mirrored };
        const f = fitComponent(c, d, mockEngine);
        const world = mockEngine.getPinPositions(c);
        for (const pd of f.pins) {
          const w = world.find((q) => q.name === pd.name)!.p;
          const q = { x: f.m.a * pd.offset.x + f.m.c * pd.offset.y + f.m.e, y: f.m.b * pd.offset.x + f.m.d * pd.offset.y + f.m.f };
          expect(q.x).toBeCloseTo(w.x);
          expect(q.y).toBeCloseTo(w.y);
        }
      }
    }
  });
});
