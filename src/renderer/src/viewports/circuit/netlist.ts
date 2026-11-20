/**
 * Wire connectivity graph for rendering: junction dots, connected pins, net grouping
 * (mapped to engine nets for voltage colouring) and per-edge current estimation for the
 * animated current dots. Same rules as the engine: shared vertices connect, a wire
 * vertex (end or corner) on another wire's segment is a T-junction, pins attach to wire
 * vertices only (a pin in the middle of a segment stays open).
 */
import type { CircuitState, Vec2, Wire } from '@core/types';
import { key, onSegmentInterior } from './geometry';

export interface PinRef {
  compId: string; pin: string; p: Vec2; index: number; pinCount: number;
  /** component type (for current sign conventions) */
  type?: string;
}

/** Engine convention: for sources `current` is the DELIVERED current (flows out of the first pin). */
const SOURCE_TYPES = new Set(['source.battery', 'source.psu', 'source.ac', 'source.function_gen', 'source.current', 'opto.solar_cell']);

export interface GNode { p: Vec2; edges: number[]; pins: PinRef[] }
export interface GEdge { a: number; b: number; wireId: string; len: number }

export interface WireGraph {
  nodes: GNode[];
  edges: GEdge[];
  nodeIndex: Map<string, number>;
  /** connected group (net) per node */
  group: Int32Array;
  groupCount: number;
  wireGroup: Map<string, number>;
  junctions: Vec2[];
  connectedPins: Set<string>; // `${compId}:${pin}`
}

export function buildWireGraph(wires: Wire[], pins: PinRef[]): WireGraph {
  const nodes: GNode[] = [];
  const nodeIndex = new Map<string, number>();
  const node = (p: Vec2): number => {
    const k = key(p);
    let i = nodeIndex.get(k);
    if (i === undefined) { i = nodes.length; nodes.push({ p: { x: p.x, y: p.y }, edges: [], pins: [] }); nodeIndex.set(k, i); }
    return i;
  };
  // Every wire vertex (end or corner) lying on another segment is a T-junction — the
  // engine (src/core/circuit/netlist.ts) applies exactly this rule.
  const endpoints: Vec2[] = [];
  for (const w of wires) {
    if (w.points.length < 2) continue;
    for (const p of w.points) endpoints.push(p);
  }
  const byX = new Map<number, Vec2[]>(), byY = new Map<number, Vec2[]>();
  for (const p of endpoints) {
    (byX.get(p.x) ?? byX.set(p.x, []).get(p.x)!).push(p);
    (byY.get(p.y) ?? byY.set(p.y, []).get(p.y)!).push(p);
  }
  const edges: GEdge[] = [];
  for (const w of wires) {
    const pts = w.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const cand = a.y === b.y ? byY.get(a.y) ?? [] : a.x === b.x ? byX.get(a.x) ?? [] : endpoints;
      const inner = new Map<string, Vec2>();
      for (const p of cand) if (onSegmentInterior(p, a, b)) inner.set(key(p), p);
      const chain = [a, ...[...inner.values()].sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)), b];
      for (let j = 0; j < chain.length - 1; j++) {
        const na = node(chain[j]), nb = node(chain[j + 1]);
        const ei = edges.length;
        edges.push({ a: na, b: nb, wireId: w.id, len: Math.hypot(chain[j + 1].x - chain[j].x, chain[j + 1].y - chain[j].y) });
        nodes[na].edges.push(ei);
        nodes[nb].edges.push(ei);
      }
    }
  }
  for (const pr of pins) nodes[node(pr.p)].pins.push(pr);

  // union-find
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of edges) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) parent[ra] = rb; }
  const group = new Int32Array(nodes.length);
  const remap = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    let gid = remap.get(r);
    if (gid === undefined) { gid = remap.size; remap.set(r, gid); }
    group[i] = gid;
  }
  const wireGroup = new Map<string, number>();
  for (const e of edges) if (!wireGroup.has(e.wireId)) wireGroup.set(e.wireId, group[e.a]);
  const junctions: Vec2[] = [];
  const connectedPins = new Set<string>();
  for (const n of nodes) {
    const deg = n.edges.length + n.pins.length;
    if (n.edges.length >= 1 && deg >= 3) junctions.push(n.p);
    if (n.edges.length > 0 || n.pins.length > 1) for (const pr of n.pins) connectedPins.add(`${pr.compId}:${pr.pin}`);
  }
  return { nodes, edges, nodeIndex, group, groupCount: remap.size, wireGroup, junctions, connectedPins };
}

/** Voltage per group (NaN when unknown) using the engine's pinNets/nodeVoltages. */
export function groupVoltages(g: WireGraph, state: CircuitState | null): Float64Array {
  const v = new Float64Array(g.groupCount).fill(NaN);
  if (!state) return v;
  for (let i = 0; i < g.nodes.length; i++) {
    const gi = g.group[i];
    if (!Number.isNaN(v[gi])) continue;
    for (const pr of g.nodes[i].pins) {
      const net = state.pinNets?.[`${pr.compId}:${pr.pin}`];
      if (net !== undefined && state.nodeVoltages && net in state.nodeVoltages) { v[gi] = state.nodeVoltages[net]; break; }
    }
  }
  return v;
}

/**
 * Current flowing INTO a component through each of its pins.
 * Uses state.pinCurrents (Record<pinName, A>) when provided by the engine; otherwise for
 * two-terminal parts assumes state.current flows in at pin[0] and out at pin[1].
 */
export function pinCurrentInto(pr: PinRef, state: CircuitState | null): number {
  const st = state?.components?.[pr.compId];
  if (!st) return 0;
  const pc = st.pinCurrents as Record<string, number> | undefined;
  if (pc && typeof pc === 'object') {
    const v = pc[pr.pin];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  let I = typeof st.current === 'number' && Number.isFinite(st.current) ? st.current : 0;
  if (pr.type && SOURCE_TYPES.has(pr.type)) I = -I;
  if (pr.pinCount === 2) return pr.index === 0 ? I : -I;
  if (pr.type === 'passive.potentiometer' && typeof st.wiperCurrent === 'number') {
    // current = A->W (into A), wiperCurrent = into W; KCL gives B
    const iw = st.wiperCurrent;
    return pr.pin === 'A' ? I : pr.pin === 'W' ? iw : -(I + iw);
  }
  return 0;
}

/**
 * Estimate current on every wire edge (positive = flowing a -> b). Exact for tree-shaped
 * nets (spanning-tree flow solve); loop-closing edges get zero.
 */
export function solveEdgeCurrents(g: WireGraph, state: CircuitState | null): Float64Array {
  const flow = new Float64Array(g.edges.length);
  if (!state) return flow;
  const inj = new Float64Array(g.nodes.length);
  for (let i = 0; i < g.nodes.length; i++) for (const pr of g.nodes[i].pins) inj[i] -= pinCurrentInto(pr, state);
  const seen = new Uint8Array(g.nodes.length);
  const parentEdge = new Int32Array(g.nodes.length).fill(-1);
  for (let root = 0; root < g.nodes.length; root++) {
    if (seen[root] || !g.nodes[root].edges.length) continue;
    const order: number[] = [root];
    seen[root] = 1;
    for (let qi = 0; qi < order.length; qi++) {
      const n = order[qi];
      for (const ei of g.nodes[n].edges) {
        const e = g.edges[ei];
        const m = e.a === n ? e.b : e.a;
        if (seen[m]) continue;
        seen[m] = 1;
        parentEdge[m] = ei;
        order.push(m);
      }
    }
    const sub = new Map<number, number>();
    for (let k = order.length - 1; k > 0; k--) {
      const n = order[k];
      const total = inj[n] + (sub.get(n) ?? 0);
      const ei = parentEdge[n];
      const e = g.edges[ei];
      const par = e.a === n ? e.b : e.a;
      // current leaves the subtree through this edge toward the parent
      flow[ei] = e.a === n ? total : -total;
      sub.set(par, (sub.get(par) ?? 0) + total);
    }
  }
  return flow;
}
