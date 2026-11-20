/**
 * Hover tooltips for the schematic: wires (net voltage + segment current), pins (name / net /
 * voltage / current) and components (value + live V/I/P) while the simulation has a state.
 */
import type { CircuitState } from '@core/types';
import type { TipContent, TipRow } from '../../lib/hoverTip';
import type { Hit, Model } from './model';
import { groupVoltages, pinCurrentInto, solveEdgeCurrents } from './netlist';
import { formatSI } from './format';
import { valueLabel } from './format';

export function hitKey(h: Hit | null): string | null {
  if (!h) return null;
  switch (h.kind) {
    case 'wire': return `w:${h.wireId}:${h.seg}`;
    case 'handle': return `w:${h.wireId}:v${h.index}`;
    case 'pin': return `p:${h.compId}:${h.pin}`;
    case 'comp': return `c:${h.id}`;
    default: return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Engine net id of the group a wire belongs to (via any pin attached to that group). */
function wireNet(m: Model, wireId: string, st: CircuitState): string | null {
  const g = m.graph.wireGroup.get(wireId);
  if (g === undefined) return null;
  for (let i = 0; i < m.graph.nodes.length; i++) {
    if (m.graph.group[i] !== g) continue;
    for (const pr of m.graph.nodes[i].pins) {
      const net = st.pinNets?.[`${pr.compId}:${pr.pin}`];
      if (net !== undefined) return net;
    }
  }
  return null;
}

/** Current on the wire edge under point p (A, a->b positive). */
function edgeCurrent(m: Model, wireId: string, p: { x: number; y: number }, flow: Float64Array): number | null {
  const g = m.graph;
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    if (e.wireId !== wireId) continue;
    const a = g.nodes[e.a].p, b = g.nodes[e.b].p;
    const onX = a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
    const onY = a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
    if (onX || onY) return flow[i];
  }
  return null;
}

export function circuitTip(h: Hit, m: Model, st: CircuitState | null, cache: { flow: Float64Array | null; key: unknown }): TipContent | null {
  const compName = (id: string): string => {
    const f = m.fitById.get(id);
    return f?.c.name || f?.def?.label || id;
  };
  if (h.kind === 'wire' || h.kind === 'handle') {
    if (!st) return null;
    const wr = m.wireById.get(h.wireId);
    const gv = groupVoltages(m.graph, st);
    const gi = m.graph.wireGroup.get(h.wireId);
    const v = gi !== undefined ? gv[gi] : NaN;
    const rows: TipRow[] = [{ k: 'Voltage', v: Number.isFinite(v) ? formatSI(v, 'V') : 'floating' }];
    if (cache.key !== st || !cache.flow) { cache.flow = solveEdgeCurrents(m.graph, st); cache.key = st; }
    const I = edgeCurrent(m, h.wireId, h.p, cache.flow);
    if (I !== null) rows.push({ k: 'Current', v: formatSI(Math.abs(I), 'A') });
    const net = wireNet(m, h.wireId, st);
    return { title: wr?.label ? `Wire "${wr.label}"` : 'Wire', sub: net ? `Net ${net}` : 'Unconnected net', rows };
  }
  if (h.kind === 'pin') {
    const f = m.fitById.get(h.compId);
    const rows: TipRow[] = [];
    if (st) {
      const net = st.pinNets?.[`${h.compId}:${h.pin}`];
      rows.push({ k: 'Net', v: net ?? '—' });
      const v = net !== undefined ? num(st.nodeVoltages?.[net]) : null;
      rows.push({ k: 'Voltage', v: v === null ? '—' : formatSI(v, 'V') });
      const pr = m.pinRefs.find((r) => r.compId === h.compId && r.pin === h.pin);
      if (pr) rows.push({ k: 'Current in', v: formatSI(pinCurrentInto(pr, st), 'A') });
    } else rows.push({ k: 'Live values', v: 'run the simulation (F5)' });
    return { title: `${compName(h.compId)} · pin ${h.pin}`, sub: f?.def?.label, rows };
  }
  if (h.kind === 'comp') {
    const f = m.fitById.get(h.id);
    if (!f) return null;
    const rows: TipRow[] = [];
    const val = valueLabel(f.c, f.def);
    if (val) rows.push({ k: 'Value', v: val });
    const cs = st?.components?.[h.id];
    if (cs) {
      const V = num(cs.voltage), I = num(cs.current), P = num(cs.power), B = num(cs.brightness);
      if (V !== null) rows.push({ k: 'Voltage', v: formatSI(V, 'V') });
      if (I !== null) rows.push({ k: 'Current', v: formatSI(I, 'A') });
      if (P !== null) rows.push({ k: 'Power', v: formatSI(P, 'W') });
      if (B !== null) rows.push({ k: 'Brightness', v: `${(B * 100).toFixed(0)} %` });
      if (typeof cs.on === 'boolean') rows.push({ k: 'State', v: cs.on ? 'on' : 'off' });
      if (typeof cs.text === 'string' && cs.text) rows.push({ k: 'Reading', v: cs.text });
    }
    return { title: compName(h.id), sub: f.def?.label ?? f.c.type, rows };
  }
  return null;
}
