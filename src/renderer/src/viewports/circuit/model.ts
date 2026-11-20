/** Derived per-scene model (fits, pins, wire graph) + hit testing + scene edit helpers. */
import type { CircuitComponent, CircuitComponentDef, CircuitEngineAPI, CircuitScene, Vec2, Wire } from '@core/types';
import { type CompFit, type Rect, distPointSeg, fitComponent, hitBody, key, onSegmentInterior, pinOutward, transformRect } from './geometry';
import { autoRoute, buildRouteContext, dirOf } from './routing';
import { buildWireGraph, type PinRef, type WireGraph } from './netlist';
import { nearestGridOnSegment, normalizeWires, makeIdGen, rubberBandEnd } from './wires';

export interface Model {
  scene: CircuitScene;
  defs: Map<string, CircuitComponentDef>;
  fits: CompFit[];
  fitById: Map<string, CompFit>;
  pinRefs: PinRef[];
  graph: WireGraph;
  wireById: Map<string, Wire>;
}

export type FitCache = WeakMap<CircuitComponent, CompFit>;

export function defMap(engine: CircuitEngineAPI): Map<string, CircuitComponentDef> {
  const m = new Map<string, CircuitComponentDef>();
  for (const d of engine.registry ?? []) m.set(d.type, d);
  return m;
}

export function getFit(c: CircuitComponent, defs: Map<string, CircuitComponentDef>, engine: CircuitEngineAPI, cache?: FitCache): CompFit {
  const hit = cache?.get(c);
  if (hit) return hit;
  const f = fitComponent(c, defs.get(c.type), engine);
  cache?.set(c, f);
  return f;
}

export function buildModel(scene: CircuitScene, engine: CircuitEngineAPI, defs: Map<string, CircuitComponentDef>, cache?: FitCache): Model {
  const fits = scene.components.map((c) => getFit(c, defs, engine, cache));
  const fitById = new Map(fits.map((f) => [f.c.id, f]));
  const pinRefs: PinRef[] = [];
  for (const f of fits) f.world.forEach((w, i) => pinRefs.push({ compId: f.c.id, pin: w.name, p: w.p, index: i, pinCount: f.world.length, type: f.c.type }));
  const graph = buildWireGraph(scene.wires, pinRefs);
  return { scene, defs, fits, fitById, pinRefs, graph, wireById: new Map(scene.wires.map((w) => [w.id, w])) };
}

export type Hit =
  | { kind: 'handle'; wireId: string; index: number; p: Vec2 }
  | { kind: 'pin'; compId: string; pin: string; p: Vec2 }
  | { kind: 'comp'; id: string }
  | { kind: 'wire'; wireId: string; seg: number; p: Vec2 }
  | { kind: 'none' };

export function hitTest(m: Model, w: Vec2, zoom: number, selected: Set<string>, opts: { pins?: boolean; wires?: boolean; exclude?: string } = {}): Hit {
  const px = 1 / zoom;
  // vertex handles of selected wires
  for (const wire of m.scene.wires) {
    if (!selected.has(wire.id)) continue;
    for (let i = 0; i < wire.points.length; i++) {
      const p = wire.points[i];
      if (Math.abs(p.x - w.x) <= 6 * px && Math.abs(p.y - w.y) <= 6 * px) return { kind: 'handle', wireId: wire.id, index: i, p };
    }
  }
  if (opts.pins !== false) {
    const tol = Math.min(0.42, Math.max(0.22, 8 * px));
    let best: Hit = { kind: 'none' }, bd = tol;
    for (const pr of m.pinRefs) {
      if (pr.compId === opts.exclude) continue;
      const d = Math.hypot(pr.p.x - w.x, pr.p.y - w.y);
      if (d <= bd) { bd = d; best = { kind: 'pin', compId: pr.compId, pin: pr.pin, p: pr.p }; }
    }
    if (best.kind !== 'none') return best;
  }
  for (let i = m.fits.length - 1; i >= 0; i--) {
    const f = m.fits[i];
    if (f.c.id === opts.exclude) continue;
    if (hitBody(f, w)) return { kind: 'comp', id: f.c.id };
  }
  if (opts.wires !== false) {
    const tol = Math.max(0.18, 6 * px);
    let best: Hit = { kind: 'none' }, bd = tol;
    for (const wire of m.scene.wires) {
      for (let i = 0; i < wire.points.length - 1; i++) {
        const r = distPointSeg(w, wire.points[i], wire.points[i + 1]);
        if (r.d <= bd) { bd = r.d; best = { kind: 'wire', wireId: wire.id, seg: i, p: nearestGridOnSegment(wire.points[i], wire.points[i + 1], w) }; }
      }
    }
    if (best.kind !== 'none') return best;
  }
  return { kind: 'none' };
}

export function allPins(m: Model): Vec2[] { return m.pinRefs.map((p) => p.p); }

/** Normalize wires of a scene (junction splitting, collinear merge, end-to-end merge). */
export function normalizeScene(scene: CircuitScene, engine: CircuitEngineAPI, defs: Map<string, CircuitComponentDef>, cache?: FitCache, keepCollinear?: Set<string>): CircuitScene {
  const pins: Vec2[] = [];
  for (const c of scene.components) for (const w of getFit(c, defs, engine, cache).world) pins.push(w.p);
  const wires = normalizeWires(scene.wires, { pins, keepCollinear, genId: makeIdGen([...scene.wires.map((w) => w.id), ...scene.components.map((c) => c.id)]) });
  return { ...scene, wires };
}

/**
 * Move / rotate / mirror a selection (components + wires). Wires attached to moved pins or
 * to moved wire vertices are rubber-banded so they stay connected and orthogonal.
 */
export function transformSelection(
  scene: CircuitScene, engine: CircuitEngineAPI, defs: Map<string, CircuitComponentDef>, cache: FitCache | undefined,
  compIds: Set<string>, wireIds: Set<string>, delta: Vec2, rot: number, mirror: boolean, pivotIn?: Vec2
): CircuitScene {
  const selComps = scene.components.filter((c) => compIds.has(c.id));
  const selWires = scene.wires.filter((w) => wireIds.has(w.id));
  let pivot = pivotIn;
  if (!pivot) {
    const pts = selComps.length ? selComps.map((c) => c.position) : selWires.flatMap((w) => w.points);
    const n = pts.length || 1;
    pivot = { x: Math.round(pts.reduce((t, p) => t + p.x, 0) / n), y: Math.round(pts.reduce((t, p) => t + p.y, 0) / n) };
  }
  const r = ((rot % 4) + 4) % 4;
  const pv = pivot;
  const tp = (p: Vec2): Vec2 => {
    let x = p.x, y = p.y;
    if (mirror) x = 2 * pv.x - x;
    for (let i = 0; i < r; i++) { const dx = x - pv.x, dy = y - pv.y; x = pv.x - dy; y = pv.y + dx; }
    return { x: x + delta.x, y: y + delta.y };
  };
  const moveMap = new Map<string, Vec2>();
  const comps = scene.components.map((c) => {
    if (!compIds.has(c.id)) return c;
    const nc: CircuitComponent = { ...c, position: tp(c.position), rotation: (((c.rotation ?? 0) + r) % 4) as 0 | 1 | 2 | 3, mirrored: mirror ? !c.mirrored : c.mirrored };
    const before = getFit(c, defs, engine, cache).world;
    const after = getFit(nc, defs, engine, cache).world;
    for (const b of before) {
      const a = after.find((q) => q.name === b.name);
      if (a) moveMap.set(key(b.p), a.p);
    }
    return nc;
  });
  const moved = new Map<string, Wire>();
  for (const w of selWires) {
    const pts = w.points.map(tp);
    w.points.forEach((p, i) => moveMap.set(key(p), pts[i]));
    moved.set(w.id, { ...w, points: pts });
  }
  const wires = scene.wires.map((w) => {
    const mw = moved.get(w.id);
    if (mw) return mw;
    const n = w.points.length;
    if (n < 2) return w;
    const s = moveMap.get(key(w.points[0])), e = moveMap.get(key(w.points[n - 1]));
    if (!s && !e) return w;
    const dsx = s ? s.x - w.points[0].x : 0, dsy = s ? s.y - w.points[0].y : 0;
    if (s && e && dsx === e.x - w.points[n - 1].x && dsy === e.y - w.points[n - 1].y) {
      return { ...w, points: w.points.map((p) => ({ x: p.x + dsx, y: p.y + dsy })) };
    }
    let pts = w.points;
    if (s) pts = rubberBandEnd(pts, 'start', s);
    if (e) pts = rubberBandEnd(pts, 'end', e);
    return { ...w, points: pts };
  });
  return { ...scene, components: comps, wires: rerouteCrossing(scene, comps, wires, engine, defs, cache, compIds) };
}

/** World body rect of a fitted component. */
function worldBody(f: CompFit): Rect {
  return transformRect(f.m, f.rect);
}

/** Grid points strictly inside a rect. */
function strictlyInside(p: Vec2, r: Rect): boolean {
  return p.x > r.x0 + 1e-9 && p.x < r.x1 - 1e-9 && p.y > r.y0 + 1e-9 && p.y < r.y1 - 1e-9;
}

/**
 * Rubber-banding keeps wires orthogonal but can drag a lead across a body or over a pin (e.g.
 * rotating a part 180° pulls each lead across the other pin, which the netlist would then join
 * through the T-junction rule). Such wires are re-routed around the bodies instead.
 */
function rerouteCrossing(
  scene: CircuitScene, comps: CircuitComponent[], wires: Wire[], engine: CircuitEngineAPI,
  defs: Map<string, CircuitComponentDef>, cache: FitCache | undefined, movedIds: Set<string>
): Wire[] {
  if (!movedIds.size) return wires;
  const before = new Map(scene.wires.map((w) => [w.id, w]));
  const fits = comps.map((c) => getFit(c, defs, engine, cache));
  const movedBodies = fits.filter((f) => movedIds.has(f.c.id)).map(worldBody);
  const pins = fits.flatMap((f) => f.world.map((w) => ({ f, name: w.name, p: w.p })));
  const pinAt = new Map(pins.map((q) => [key(q.p), q]));
  const bad = (pts: Vec2[]): boolean => {
    const first = pts[0], last = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (const q of pins) if (onSegmentInterior(q.p, a, b)) return true;
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      if (n > 4000) continue;
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n : 0;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if ((p.x === first.x && p.y === first.y) || (p.x === last.x && p.y === last.y)) continue; // own pins
        if (movedBodies.some((r) => strictlyInside(p, r))) return true;
      }
    }
    return false;
  };
  const isBad = wires.map((w) => {
    const old = before.get(w.id);
    return !!old && old.points !== w.points && w.points.length >= 2 && bad(w.points);
  });
  if (!isBad.some(Boolean)) return wires;
  const out = wires.slice();
  const bodies = buildRouteContext(fits.map(worldBody), pins.map((q) => q.p), []);
  for (let wi = 0; wi < out.length; wi++) {
    if (!isBad[wi]) continue;
    const w = out[wi];
    // obstacles: bodies, pins, and the other wires that are staying (or were already re-routed)
    const local = buildRouteContext([], [], out.filter((_, j) => j !== wi && (!isBad[j] || j < wi)));
    const ctx = { blocked: new Set([...bodies.blocked, ...local.blocked]), hOcc: local.hOcc, vOcc: local.vOcc };
    const a = w.points[0], b = w.points[w.points.length - 1];
    ctx.blocked.delete(key(a));
    ctx.blocked.delete(key(b));
    const pa = pinAt.get(key(a)), pb = pinAt.get(key(b));
    const oa = pa ? pinOutward(pa.f, pa.name) : null;
    const ob = pb ? pinOutward(pb.f, pb.name) : null;
    const route = autoRoute(a, b, ctx, { startDir: oa ? dirOf(oa) : undefined, endDir: ob ? dirOf({ x: -ob.x, y: -ob.y }) : undefined });
    if (route.length >= 2 && !bad(route)) out[wi] = { ...w, points: route };
  }
  return out;
}
