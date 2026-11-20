/**
 * The schematic viewport draws connectivity (junction dots, open/closed pins, voltage colours)
 * from its own wire graph, while the simulator builds its netlist in src/core/circuit. These
 * tests pin the two to the SAME rules, both on raw scenes (e.g. hand-written .obw files) and on
 * scenes after the viewport's wire normalization.
 */
import { describe, expect, it } from 'vitest';
import type { CircuitComponent, CircuitScene, Vec2, Wire } from '@core/types';
import { buildNetlist, circuitEngine } from '../../../../../core/circuit';
import { buildModel, defMap, normalizeScene } from '../model';

const P = (x: number, y: number): Vec2 => ({ x, y });
const defs = defMap(circuitEngine);

const mk = (type: string, id: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0): CircuitComponent => ({
  ...circuitEngine.createComponent(type, P(x, y)), id, rotation
});

/** Partition of pin keys as seen by the engine. */
function enginePartition(scene: Pick<CircuitScene, 'components' | 'wires'>): Map<string, string> {
  const nl = buildNetlist(scene);
  return new Map(Object.entries(nl.pinNets));
}

/** Partition of pin keys as drawn by the viewport (pins on the same wire-graph group, or sharing a point). */
function viewPartition(scene: CircuitScene): Map<string, string> {
  const m = buildModel(scene, circuitEngine, defs);
  const out = new Map<string, string>();
  for (const pr of m.pinRefs) {
    const n = m.graph.nodeIndex.get(`${pr.p.x},${pr.p.y}`);
    const k = `${pr.compId}:${pr.pin}`;
    // a node with edges belongs to a wire group; a bare node only joins pins sharing the point
    out.set(k, n !== undefined && m.graph.nodes[n].edges.length ? `g${m.graph.group[n]}` : `p${pr.p.x},${pr.p.y}`);
  }
  return out;
}

/** Same equivalence relation? (labels may differ) */
function samePartition(a: Map<string, string>, b: Map<string, string>, ground: Set<string>): string | null {
  const keys = [...a.keys()].filter((k) => !ground.has(k.split(':')[0]));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ea = a.get(keys[i]) === a.get(keys[j]);
      const eb = b.get(keys[i]) === b.get(keys[j]);
      if (ea !== eb) return `${keys[i]} vs ${keys[j]}: engine ${ea ? 'connected' : 'separate'}, viewport ${eb ? 'connected' : 'separate'}`;
    }
  }
  return null;
}

const scene = (components: CircuitComponent[], wires: Wire[]): CircuitScene => ({ components, wires, settings: circuitEngine.defaultSettings() });

/** p strictly inside axis-aligned segment a-b */
const onSeg = (p: Vec2, a: Vec2, b: Vec2): boolean =>
  ((a.x === b.x && p.x === a.x && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) ||
   (a.y === b.y && p.y === a.y && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x)));

/** Reference model of a pin tap: split each wire at every tapped pin it passes over (pure geometry, no normalization). */
function withTaps(s: CircuitScene): CircuitScene {
  const taps = s.wires.filter((w) => w.id.startsWith('tap')).map((w) => w.points[0]);
  const wires = s.wires.filter((w) => !w.id.startsWith('tap')).map((w) => {
    const pts: Vec2[] = [w.points[0]];
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1], b = w.points[i];
      const inside = taps.filter((p) => onSeg(p, a, b)).sort((p, q) => (Math.abs(p.x - a.x) + Math.abs(p.y - a.y)) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y)));
      pts.push(...inside, b);
    }
    return { ...w, points: pts };
  });
  return { ...s, wires };
}

describe('engine / viewport connectivity agree', () => {
  it('corner of one wire lying on another wire segment is a junction in both', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0); // pins (-2,0) (2,0)
    const r2 = mk('passive.resistor', 'R2', 20, 10); // pins (18,10) (22,10)
    const r3 = mk('passive.resistor', 'R3', 10, 20, 1); // vertical, pins (10,18) (10,22)
    const s = scene([r1, r2, r3], [
      { id: 'a', points: [P(2, 0), P(10, 0), P(10, 18)] },
      // corner at (10,6) lies on wire a's vertical segment
      { id: 'b', points: [P(18, 10), P(14, 10), P(14, 6), P(10, 6), P(6, 6), P(6, 2)] }
    ]);
    expect(samePartition(enginePartition(s), viewPartition(s), new Set())).toBeNull();
    const nl = buildNetlist(s);
    expect(nl.pinNets['R2:A']).toBe(nl.pinNets['R1:B']);
    const n = normalizeScene(s, circuitEngine, defs);
    expect(samePartition(enginePartition(n), viewPartition(n), new Set())).toBeNull();
    const m = buildModel(n, circuitEngine, defs);
    expect(m.graph.junctions.some((j) => j.x === 10 && j.y === 6)).toBe(true);
  });

  it('a pin in the middle of a segment is open in the raw scene; normalization taps it with a vertex', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0); // pins (-2,0) (2,0)
    const r2 = mk('passive.resistor', 'R2', 0, 10); // pins (-2,10) (2,10)
    const s = scene([r1, r2], [{ id: 'over', points: [P(-10, 0), P(-1, 0)] }, { id: 'x', points: [P(-5, -5), P(-5, 10), P(-2, 10)] }]);
    expect(samePartition(enginePartition(s), viewPartition(s), new Set())).toBeNull();
    expect(buildNetlist(s).pinNets['R1:A']).not.toBe(buildNetlist(s).pinNets['R2:A']);
    const n = normalizeScene(s, circuitEngine, defs);
    expect(samePartition(enginePartition(n), viewPartition(n), new Set())).toBeNull();
    // R1:A (-2,0) lies on wire 'over' -> now a vertex -> connected; 'over' crosses x at (-5,0): a plain crossing, no T
    const nl = buildNetlist(n);
    expect(n.wires.some((w) => w.points.some((q) => q.x === -2 && q.y === 0))).toBe(true);
    expect(nl.pinNets['R1:A']).toBeDefined();
    const m = buildModel(n, circuitEngine, defs);
    const pinNode = m.graph.nodeIndex.get('-2,0');
    expect(pinNode !== undefined && m.graph.nodes[pinNode].edges.length > 0).toBe(true);
  });

  it('every pin a wire passes over gets a vertex, and normalization is idempotent', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0); // pins (-2,0) (2,0)
    const r3 = mk('passive.resistor', 'R3', 10, 0, 1); // vertical, pins (10,-2) (10,2)
    const s = scene([r1, r3], [
      { id: 'h', points: [P(-6, 0), P(-6, -4), P(10, -4), P(10, -1)] },
      { id: 'v', points: [P(20, 2), P(4, 2), P(4, 8), P(-2, 8), P(-2, -2)] }
    ]);
    const n = normalizeScene(s, circuitEngine, defs);
    const verts = new Set(n.wires.flatMap((w) => w.points.map((q) => `${q.x},${q.y}`)));
    expect(verts.has('10,2')).toBe(true); // R3:B on wire v's first segment
    expect(verts.has('-2,0')).toBe(true); // R1:A on wire v's last segment
    expect(verts.has('10,-2')).toBe(true); // R3:A on wire h's last segment
    const nl = buildNetlist(n);
    expect(nl.pinNets['R1:A']).toBe(nl.pinNets['R3:B']);
    expect(samePartition(enginePartition(n), viewPartition(n), new Set())).toBeNull();
    const n2 = normalizeScene(n, circuitEngine, defs);
    expect(samePartition(enginePartition(n), enginePartition(n2), new Set())).toBeNull();
  });

  it('random orthogonal scenes agree before and after normalization', () => {
    let seed = 12345;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let iter = 0; iter < 400; iter++) {
      const comps: CircuitComponent[] = [];
      for (let i = 0; i < 4; i++) comps.push(mk('passive.resistor', `R${i}`, rnd(10) * 2, rnd(10) * 2, rnd(2) as 0 | 1));
      const pins = comps.flatMap((c) => circuitEngine.getPinPositions(c).map((p) => p.p));
      const wires: Wire[] = [];
      for (let k = 0; k < 4; k++) {
        const pts: Vec2[] = [rnd(3) === 0 ? pins[rnd(pins.length)] : P(rnd(20), rnd(20))];
        const segs = 1 + rnd(3);
        for (let j = 0; j < segs; j++) {
          const last = pts[pts.length - 1];
          const target = rnd(3) === 0 ? pins[rnd(pins.length)] : P(rnd(20), rnd(20));
          pts.push(j % 2 === 0 ? P(target.x, last.y) : P(last.x, target.y));
        }
        wires.push({ id: `w${k}`, points: pts });
      }
      const s = scene(comps, wires);
      const raw = samePartition(enginePartition(s), viewPartition(s), new Set());
      expect(raw, `raw scene ${iter}: ${JSON.stringify(wires)}`).toBeNull();
      const n = normalizeScene(s, circuitEngine, defs);
      const norm = samePartition(enginePartition(n), viewPartition(n), new Set());
      expect(norm, `normalized scene ${iter}: ${JSON.stringify(n.wires)}`).toBeNull();
      // normalization only adds the pin taps (pins lying on a segment); otherwise nets are unchanged
      const tapped = scene(comps, [...wires, ...pins.filter((p) => wires.some((w) => w.points.some((q, i) => i > 0 && onSeg(p, w.points[i - 1], q)))).map((p, i) => ({ id: `tap${i}`, points: [p, p] }))]);
      expect(samePartition(enginePartition(withTaps(tapped)), enginePartition(n), new Set()), `normalize changed nets ${iter}`).toBeNull();
      // and it is idempotent
      expect(samePartition(enginePartition(n), enginePartition(normalizeScene(n, circuitEngine, defs)), new Set()), `not idempotent ${iter}`).toBeNull();
    }
  });
});

describe('wire cleanup', () => {
  it('removes doubled-back spikes so a wire never overlaps itself', async () => {
    const { cleanPolyline } = await import('../wires');
    expect(cleanPolyline([P(8, -6), P(10, -6), P(9, -6), P(9, 0), P(10, 0)])).toEqual([P(8, -6), P(9, -6), P(9, 0), P(10, 0)]);
  });
});

describe('transforms keep the netlist', () => {
  const nets = (s: CircuitScene): string => {
    const g: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(buildNetlist(s).pinNets)) (g[v] ??= []).push(k);
    return Object.values(g).map((a) => a.sort().join('+')).sort().join(' | ');
  };
  it('rotating a wired part by quarter turns never shorts its own pins', async () => {
    const { transformSelection } = await import('../model');
    const b = mk('source.battery', 'B1', -8, 0);
    const r = mk('passive.resistor', 'R1', 0, -6);
    const d = mk('semi.led', 'D1', 8, 0);
    const pin = (c: CircuitComponent, n: string): Vec2 => circuitEngine.getPinPositions(c).find((p) => p.name === n)!.p;
    let s = scene([b, r, d], [
      { id: 'w1', points: [pin(b, '+'), P(-10, -6), pin(r, 'A')] },
      { id: 'w2', points: [pin(r, 'B'), P(6, -6), pin(d, 'A')] },
      { id: 'w3', points: [pin(d, 'K'), P(10, 3), P(-6, 3), pin(b, '-')] }
    ]);
    const want = nets(s);
    for (const id of ['R1', 'D1', 'B1']) {
      for (let k = 0; k < 4; k++) {
        s = normalizeScene(transformSelection(s, circuitEngine, defs, undefined, new Set([id]), new Set(), P(0, 0), 1, false), circuitEngine, defs);
        expect(nets(s), `${id} after ${k + 1} quarter turns`).toBe(want);
      }
      s = normalizeScene(transformSelection(s, circuitEngine, defs, undefined, new Set([id]), new Set(), P(0, 0), 0, true), circuitEngine, defs);
      expect(nets(s), `${id} mirrored`).toBe(want);
    }
  });
});
