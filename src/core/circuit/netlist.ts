/**
 * Netlist extraction from schematic geometry.
 *
 * Connectivity rules:
 *  - pins / wire vertices sharing the same grid point are connected;
 *  - consecutive points of a wire are connected;
 *  - a wire vertex (endpoint or corner) lying ON another wire's segment connects (T-junction);
 *  - a pin connects to a wire only at a wire vertex (not in the middle of a segment);
 *  - two wires merely crossing mid-segment do NOT connect;
 *  - all `misc.ground` pins form node 0 (net id 'GND').
 */
import type { CircuitComponent, CircuitScene, Vec2 } from '../types';
import { getPinPositions } from './registry';

export const GROUND_NET = 'GND';

export interface Netlist {
  /** Net id per node index; node 0 is always ground ('GND'), even when nothing is attached. */
  netIds: string[];
  /** `${componentId}:${pinName}` -> node index. */
  pinNode: Map<string, number>;
  /** `${componentId}:${pinName}` -> net id. */
  pinNets: Record<string, string>;
  /** Number of component pins on each node. */
  pinCount: number[];
  hasGround: boolean;
}

class UnionFind {
  parent: number[] = [];
  make(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i]];
      i = p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

const EPS = 1e-6;

function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > EPS) return false;
  return (
    p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
  );
}

const key = (p: Vec2): string => `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`;

export function buildNetlist(scene: Pick<CircuitScene, 'components' | 'wires'>): Netlist {
  const uf = new UnionFind();
  const pointIdx = new Map<string, number>();
  const idx = (p: Vec2): number => {
    const k = key(p);
    let i = pointIdx.get(k);
    if (i === undefined) {
      i = uf.make();
      pointIdx.set(k, i);
    }
    return i;
  };

  // --- wires
  const wirePoints: { p: Vec2; i: number }[] = [];
  const segments: { a: Vec2; b: Vec2; i: number }[] = [];
  const wireFirst: { id: string; i: number }[] = [];
  const seenPoint = new Set<number>();
  for (const w of scene.wires ?? []) {
    const pts = (w.points ?? []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length === 0) continue;
    let prev = -1;
    for (let k = 0; k < pts.length; k++) {
      const i = idx(pts[k]);
      if (!seenPoint.has(i)) {
        seenPoint.add(i);
        wirePoints.push({ p: pts[k], i });
      }
      if (k === 0) wireFirst.push({ id: w.id, i });
      if (prev >= 0) {
        uf.union(prev, i);
        segments.push({ a: pts[k - 1], b: pts[k], i });
      }
      prev = i;
    }
  }
  // T-junctions: wire vertices on other wires' segments
  for (const s of segments) {
    const minx = Math.min(s.a.x, s.b.x) - EPS, maxx = Math.max(s.a.x, s.b.x) + EPS;
    const miny = Math.min(s.a.y, s.b.y) - EPS, maxy = Math.max(s.a.y, s.b.y) + EPS;
    for (const wp of wirePoints) {
      const p = wp.p;
      if (p.x < minx || p.x > maxx || p.y < miny || p.y > maxy) continue;
      if (onSegment(p, s.a, s.b)) uf.union(wp.i, s.i);
    }
  }

  // --- pins
  const pins: { key: string; i: number; ground: boolean }[] = [];
  for (const c of scene.components ?? []) {
    let positions: { name: string; p: Vec2 }[];
    try {
      positions = getPinPositions(c as CircuitComponent);
    } catch {
      positions = [];
    }
    for (const pp of positions) {
      pins.push({ key: `${c.id}:${pp.name}`, i: idx(pp.p), ground: c.type === 'misc.ground' });
    }
  }

  // --- collect nets
  const groundRoots = new Set<number>();
  for (const p of pins) if (p.ground) groundRoots.add(uf.find(p.i));
  const rootName = new Map<number, string>();
  for (const p of pins) {
    const r = uf.find(p.i);
    if (groundRoots.has(r)) continue;
    const cur = rootName.get(r);
    if (cur === undefined || p.key < cur) rootName.set(r, p.key);
  }
  // wire-only nets (no pins): named after the first wire that touches them
  const wireOnly = new Map<number, string>();
  for (const w of wireFirst) {
    const r = uf.find(w.i);
    if (groundRoots.has(r) || rootName.has(r) || wireOnly.has(r)) continue;
    wireOnly.set(r, `wire:${w.id}`);
  }

  const named: { root: number; id: string }[] = [];
  for (const [root, k] of rootName) named.push({ root, id: `net:${k}` });
  for (const [root, id] of wireOnly) named.push({ root, id });
  named.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const netIds: string[] = [GROUND_NET];
  const rootNode = new Map<number, number>();
  for (const r of groundRoots) rootNode.set(r, 0);
  for (const n of named) {
    rootNode.set(n.root, netIds.length);
    netIds.push(n.id);
  }

  const pinNode = new Map<string, number>();
  const pinNets: Record<string, string> = {};
  const pinCount = new Array<number>(netIds.length).fill(0);
  for (const p of pins) {
    const node = rootNode.get(uf.find(p.i)) ?? 0;
    pinNode.set(p.key, node);
    pinNets[p.key] = netIds[node];
    pinCount[node]++;
  }
  return { netIds, pinNode, pinNets, pinCount, hasGround: groundRoots.size > 0 };
}
