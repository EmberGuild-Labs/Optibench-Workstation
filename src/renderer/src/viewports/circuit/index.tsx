/**
 * CircuitViewport — schematic editor with smart cables (auto-routed orthogonal wires,
 * T-junctions, rubber-banding, segment/vertex editing) and live simulation rendering.
 */
import { useEffect, useRef } from 'react';
import type { CircuitComponent, CircuitScene, Vec2, Wire } from '@core/types';
import { PALETTE_DND_MIME, type CircuitViewportProps, type PaletteDragPayload } from '../contracts';
import { type CompFit, eq, key, pinOutward, rectContains, rectsIntersect, snap } from './geometry';
import { buildModel, defMap, getFit, hitTest, normalizeScene, transformSelection, type FitCache, type Hit, type Model } from './model';
import { groupVoltages, solveEdgeCurrents } from './netlist';
import { autoRoute, buildRouteContext, dirOf, type RouteContext } from './routing';
import { insertVertex, makeIdGen, moveSegment, moveVertex } from './wires';
import { nextDesignator, potValue } from './format';
import { renderFrame, type Overlay } from './render';
import { HoverTip } from '../../lib/hoverTip';
import { circuitTip, hitKey } from './hoverInfo';

type Ix =
  | { kind: 'idle' }
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'marquee'; a: Vec2; b: Vec2; additive: boolean; base: string[] }
  | { kind: 'move'; start: Vec2; downS: Vec2; comps: Set<string>; wires: Set<string>; orig: CircuitScene; delta: Vec2; rot: number; mirror: boolean; moved: boolean; clickId: string; additive: boolean; pivot: Vec2 }
  | { kind: 'segment'; wireId: string; seg: number; orig: CircuitScene; start: Vec2; downS: Vec2; moved: boolean; last: Vec2 }
  | { kind: 'vertex'; wireId: string; index: number; orig: CircuitScene; downS: Vec2; moved: boolean; last: Vec2 }
  | { kind: 'wiring'; pieces: Vec2[][]; anchor: Vec2; startDir?: number; fromPin: boolean; prefDir?: number; dragging: boolean; downS: Vec2; moved: boolean; ctx: RouteContext; route: Vec2[]; target: Vec2 | null; targetDir?: number }
  | { kind: 'pot'; id: string; startY: number; startVal: number }
  | { kind: 'press'; id: string };

const DRAG_PX = 3;
const POT_TYPES = new Set(['passive.potentiometer']);
const PUSH_TYPES = new Set(['switch.push']);
const TOGGLE_TYPES = new Set(['switch.spst', 'switch.spdt']);
const ZOOM_MIN = 3, ZOOM_MAX = 240;

function sceneWithWires(s: CircuitScene, wires: Wire[]): CircuitScene { return { ...s, wires }; }

export function CircuitViewport(props: CircuitViewportProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const P = useRef(props);
  P.current = props;
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const ix = useRef<Ix>({ kind: 'idle' });
  const preview = useRef<CircuitScene | null>(null);
  const hover = useRef<Hit | null>(null);
  const cursorW = useRef<Vec2 | null>(null);
  const space = useRef(false);
  const raf = useRef(0);
  const fitCache = useRef<FitCache>(new WeakMap());
  const defsRef = useRef<{ engine: unknown; defs: ReturnType<typeof defMap> } | null>(null);
  const modelRef = useRef<Model | null>(null);
  const flowRef = useRef<{ graph: unknown; state: unknown; flow: Float64Array | null; gv: Float64Array | null }>({ graph: null, state: null, flow: null, gv: null });
  const phaseRef = useRef<{ graph: unknown; phases: Float64Array | null }>({ graph: null, phases: null });
  const timeRef = useRef({ last: 0, t: 0 });
  const potOverride = useRef(new Map<string, number>());
  const gridCache = useRef<{ key: string; canvas: HTMLCanvasElement | null }>({ key: '', canvas: null });
  const ghostRef = useRef<{ type: string; base: CircuitComponent } | null>(null);
  const tipRef = useRef<HoverTip | null>(null);
  const tipCache = useRef<{ flow: Float64Array | null; key: unknown }>({ flow: null, key: null });
  const tipFrame = useRef(0);

  // ------------------------------------------------------------------ model
  const defs = (): ReturnType<typeof defMap> => {
    const e = P.current.engine;
    if (!defsRef.current || defsRef.current.engine !== e) defsRef.current = { engine: e, defs: defMap(e) };
    return defsRef.current.defs;
  };
  const scene = (): CircuitScene => preview.current ?? P.current.scene;
  const model = (): Model => {
    const s = scene();
    const m = modelRef.current;
    if (m && m.scene === s && m.defs === defs()) return m;
    const nm = buildModel(s, P.current.engine, defs(), fitCache.current);
    modelRef.current = nm;
    return nm;
  };
  const selSet = (): Set<string> => new Set(P.current.selection);

  // ------------------------------------------------------------------ view helpers
  const toWorld = (cx: number, cy: number): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = P.current.view;
    return { x: (cx - r.left - r.width / 2) / v.zoom + v.cx, y: (cy - r.top - r.height / 2) / v.zoom + v.cy };
  };
  const toLocalS = (cx: number, cy: number): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  // ------------------------------------------------------------------ drawing
  const schedule = (): void => {
    if (!raf.current) raf.current = requestAnimationFrame(frame);
  };
  const frame = (now: number): void => {
    raf.current = 0;
    const cv = canvasRef.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const p = P.current;
    const tr = timeRef.current;
    const dt = tr.last ? Math.min(0.1, (now - tr.last) / 1000) : 0;
    tr.last = now;
    tr.t += dt;
    const m = model();
    // sim-derived data
    let flow: Float64Array | null = null, gv: Float64Array | null = null;
    if (p.running && p.state) {
      const fr = flowRef.current;
      if (fr.graph !== m.graph || fr.state !== p.state) {
        fr.graph = m.graph; fr.state = p.state;
        fr.flow = p.display.animateCurrent ? solveEdgeCurrents(m.graph, p.state) : null;
        fr.gv = groupVoltages(m.graph, p.state);
      }
      flow = fr.flow; gv = fr.gv;
      const ph = phaseRef.current;
      if (ph.graph !== m.graph || !ph.phases || ph.phases.length !== m.graph.edges.length) {
        ph.graph = m.graph; ph.phases = new Float64Array(m.graph.edges.length);
      }
      if (flow) {
        for (let i = 0; i < flow.length; i++) {
          const I = flow[i];
          const a = Math.abs(I);
          if (a < 1e-9) continue;
          const speed = Math.sign(I) * Math.min(7, Math.max(0.35, 1.5 * (Math.log10(a) + 6.5)));
          ph.phases![i] = (ph.phases![i] + speed * dt) % 1e6;
        }
      }
    }
    const ov = buildOverlay(m);
    const { w, h, dpr } = size.current;
    if (w <= 0 || h <= 0) return;
    renderFrame({
      g, w, h, dpr, view: p.view, model: m, state: p.state, running: p.running,
      selection: selSet(), linkedIds: p.linkedIds ?? new Set(), display: p.display, overlay: ov,
      time: tr.t, edgeFlow: flow, phases: phaseRef.current.phases, groupV: gv, gridCache: gridCache.current
    });
    if (tipRef.current?.visible && (tipFrame.current = (tipFrame.current + 1) % 8) === 0) tipRef.current.refresh();
    if (p.running) schedule();
    else tr.last = 0;
  };

  /** Hover tooltip for the hit under the pointer (live values once the simulation has a state). */
  const updateTip = (h: Hit, sPos: Vec2): void => {
    const tip = tipRef.current;
    if (!tip) return;
    const p = P.current;
    if (p.tool !== 'select' && p.tool !== 'probe' && p.tool !== 'wire') { tip.hide(); return; }
    const k = h.kind === 'none' ? null : hitKey(h);
    if (!k || ((h.kind === 'wire' || h.kind === 'handle') && !p.state)) { tip.hide(); return; }
    tip.set(k, sPos, () => circuitTip(h, model(), P.current.state, tipCache.current));
  };

  const buildOverlay = (m: Model): Overlay => {
    const p = P.current;
    const st = ix.current;
    const ov: Overlay = { hover: hover.current, wiringPath: null, wiringCursor: null, hotPoint: null, marquee: null, ghost: null, potOverride: potOverride.current };
    if (st.kind === 'wiring') {
      ov.wiringPath = [...st.pieces.flatMap((pc, i) => (i === 0 ? pc : pc.slice(1))), ...(st.pieces.length ? st.route.slice(1) : st.route)];
      ov.wiringCursor = st.route.length ? st.route[st.route.length - 1] : st.anchor;
      ov.hotPoint = st.target;
    } else if (st.kind === 'marquee') {
      ov.marquee = { a: worldToCss(st.a), b: worldToCss(st.b) };
    } else if ((p.tool === 'wire' || p.tool === 'select' || p.tool === 'probe') && hover.current) {
      const hv = hover.current;
      if (hv.kind === 'pin') ov.hotPoint = hv.p;
      else if ((p.tool === 'wire' || p.tool === 'probe') && hv.kind === 'wire') ov.hotPoint = hv.p;
    }
    if (p.tool === 'place' && p.placeType && cursorW.current && st.kind === 'idle') {
      const base = ghostBase(p.placeType);
      if (base) {
        const g = snap(cursorW.current);
        const c = { ...base, position: g };
        ov.ghost = getFit(c, m.defs, p.engine, fitCache.current);
      }
    }
    return ov;
  };

  const worldToCss = (w: Vec2): Vec2 => {
    const v = P.current.view;
    return { x: (w.x - v.cx) * v.zoom + size.current.w / 2, y: (w.y - v.cy) * v.zoom + size.current.h / 2 };
  };

  const ghostBase = (type: string): CircuitComponent | null => {
    if (ghostRef.current?.type === type) return ghostRef.current.base;
    try {
      const base = P.current.engine.createComponent(type, { x: 0, y: 0 });
      ghostRef.current = { type, base };
      return base;
    } catch { return null; }
  };

  // ------------------------------------------------------------------ scene edits
  const emit = (next: CircuitScene, label: string | null): void => {
    const p = P.current;
    if (label === null) { preview.current = next; p.onSceneChange(next, { commit: false }); }
    else { preview.current = null; p.onSceneChange(next, { commit: true, label }); }
    schedule();
  };
  const normalized = (s: CircuitScene, keep?: Set<string>): CircuitScene => normalizeScene(s, P.current.engine, defs(), fitCache.current, keep);
  const nameOf = (id: string): string => scene().components.find((c) => c.id === id)?.name ?? 'Item';

  const addComponent = (type: string, at: Vec2): void => {
    const p = P.current;
    let c: CircuitComponent;
    try { c = p.engine.createComponent(type, at); } catch { return; }
    const s = p.scene;
    const ids = new Set([...s.components.map((q) => q.id), ...s.wires.map((w) => w.id)]);
    if (ids.has(c.id)) c = { ...c, id: makeIdGen(ids, 'c')() };
    c = { ...c, position: snap(at), name: nextDesignator(c, s.components) };
    const next = { ...s, components: [...s.components, c] };
    emit(next, `Add ${c.name}`);
    p.onSelectionChange([c.id]);
  };

  const placeProbe = (target: Vec2, dir: Vec2): void => {
    const p = P.current;
    const s = p.scene;
    let pc: CircuitComponent;
    try { pc = p.engine.createComponent('meter.probe', { x: 0, y: 0 }); } catch { return; }
    const fit0 = getFit({ ...pc, position: { x: 0, y: 0 } }, defs(), p.engine, fitCache.current);
    const off = fit0.world[0]?.p ?? { x: 0, y: 0 };
    const q = { x: target.x + dir.x * 3, y: target.y + dir.y * 3 };
    const ids = new Set([...s.components.map((c) => c.id), ...s.wires.map((w) => w.id)]);
    if (ids.has(pc.id)) pc = { ...pc, id: makeIdGen(ids, 'c')() };
    const existing = s.components.filter((c) => c.type === 'meter.probe').length;
    const def = defs().get('meter.probe');
    const props = { ...pc.props };
    const chParam = def?.params?.find((d) => d.key === 'channel');
    if (chParam) {
      if (chParam.kind === 'select' && chParam.options?.length) props.channel = chParam.options[existing % chParam.options.length].value;
      else if (chParam.kind === 'number') props.channel = Math.min(chParam.max ?? 4, existing + 1);
    }
    pc = { ...pc, props, position: { x: Math.round(q.x - off.x), y: Math.round(q.y - off.y) }, name: nextDesignator(pc, s.components) };
    const pinP = getFit(pc, defs(), p.engine, fitCache.current).world[0]?.p ?? q;
    const wid = makeIdGen(ids, 'w')();
    const wire: Wire = { id: wid, points: dir.x !== 0 ? [target, { x: pinP.x, y: target.y }, pinP] : [target, { x: target.x, y: pinP.y }, pinP] };
    const next = normalized({ ...s, components: [...s.components, pc], wires: [...s.wires, wire] });
    emit(next, `Add Probe ${pc.name}`);
    p.onSelectionChange([pc.id]);
  };

  const deleteSelection = (): void => {
    const p = P.current;
    const sel = new Set(p.selection);
    if (!sel.size) return;
    const s = p.scene;
    const next = normalized({ ...s, components: s.components.filter((c) => !sel.has(c.id)), wires: s.wires.filter((w) => !sel.has(w.id)) });
    emit(next, sel.size === 1 ? `Delete ${nameOf([...sel][0])}` : `Delete ${sel.size} items`);
    p.onSelectionChange([]);
  };

  const transformSel = (delta: Vec2, rot: number, mirror: boolean, label: string): void => {
    const p = P.current;
    const s = p.scene;
    const sel = new Set(p.selection);
    const comps = new Set(s.components.filter((c) => sel.has(c.id)).map((c) => c.id));
    const wires = new Set(s.wires.filter((w) => sel.has(w.id)).map((w) => w.id));
    if (!comps.size && !wires.size) return;
    const next = normalized(transformSelection(s, p.engine, defs(), fitCache.current, comps, wires, delta, rot, mirror));
    emit(next, label);
  };

  // ------------------------------------------------------------------ wiring
  const routeCtx = (m: Model, start: Vec2): RouteContext => {
    const bodies = m.fits.map((f) => {
      // body rect in world, excluding pins (pins are separate obstacles)
      const r = f.rect;
      const pts = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 }].map((q) => ({ x: f.m.a * q.x + f.m.c * q.y + f.m.e, y: f.m.b * q.x + f.m.d * q.y + f.m.f }));
      return { x0: Math.min(pts[0].x, pts[1].x), y0: Math.min(pts[0].y, pts[1].y), x1: Math.max(pts[0].x, pts[1].x), y1: Math.max(pts[0].y, pts[1].y) };
    });
    const ctx = buildRouteContext(bodies, m.pinRefs.map((p) => p.p), m.scene.wires);
    ctx.blocked.delete(key(start));
    return ctx;
  };

  const startWiring = (from: Vec2, downS: Vec2, dragging: boolean, startDir?: number): void => {
    const m = model();
    ix.current = { kind: 'wiring', pieces: [], anchor: from, startDir, fromPin: startDir !== undefined, dragging, downS, moved: false, ctx: routeCtx(m, from), route: [from], target: null };
    schedule();
  };

  /** Target under cursor while wiring: pin, or grid point on a wire. */
  const wiringTarget = (w: Vec2): { p: Vec2; dir?: number; kind: 'pin' | 'wire' } | null => {
    const m = model();
    const h = hitTest(m, w, P.current.view.zoom, new Set());
    if (h.kind === 'pin') {
      const f = m.fitById.get(h.compId);
      const o = f ? pinOutward(f, h.pin) : null;
      return { p: h.p, dir: o ? dirOf({ x: -o.x, y: -o.y }) : undefined, kind: 'pin' };
    }
    if (h.kind === 'wire' || h.kind === 'handle') return { p: h.p, kind: 'wire' };
    return null;
  };

  const updateWiringRoute = (w: Vec2): void => {
    const st = ix.current;
    if (st.kind !== 'wiring') return;
    const tgt = wiringTarget(w);
    const end = tgt ? tgt.p : snap(w);
    st.target = tgt ? tgt.p : null;
    // mouse-direction preference for the L orientation, fixed once the cursor leaves the anchor cell
    const d = { x: w.x - st.anchor.x, y: w.y - st.anchor.y };
    if (st.prefDir === undefined && Math.hypot(d.x, d.y) >= 0.75) st.prefDir = dirOf(d);
    if (Math.hypot(d.x, d.y) < 0.3) st.prefDir = undefined;
    // a pin's outward direction wins for the first leg; otherwise follow the mouse movement
    const sd = st.pieces.length === 0 && st.fromPin ? st.startDir : st.prefDir ?? st.startDir;
    const ctx = st.ctx;
    // allow ending on the target even if it is an obstacle
    st.route = autoRoute(st.anchor, end, ctx, { startDir: sd, endDir: tgt?.dir });
    st.targetDir = tgt?.dir;
  };

  const addWaypoint = (): void => {
    const st = ix.current;
    if (st.kind !== 'wiring') return;
    const end = st.route[st.route.length - 1];
    if (!end || eq(end, st.anchor)) return;
    st.pieces.push(st.route);
    st.anchor = end;
    st.prefDir = undefined;
    st.startDir = dirOf({ x: end.x - st.route[st.route.length - 2].x, y: end.y - st.route[st.route.length - 2].y });
    st.ctx.blocked.delete(key(end));
    st.route = [end];
  };

  const finishWiring = (): void => {
    const st = ix.current;
    if (st.kind !== 'wiring') return;
    const all: Vec2[] = [];
    for (const pc of [...st.pieces, st.route]) for (const q of pc) if (!all.length || !eq(all[all.length - 1], q)) all.push(q);
    ix.current = { kind: 'idle' };
    if (all.length < 2) { schedule(); return; }
    const p = P.current;
    const s = p.scene;
    const id = makeIdGen([...s.wires.map((w) => w.id), ...s.components.map((c) => c.id)], 'w')();
    const next = normalized(sceneWithWires(s, [...s.wires, { id, points: all }]));
    emit(next, 'Add Wire');
    // select the new wire (or whatever it merged into)
    const lastPt = all[all.length - 1];
    const found = next.wires.find((w) => w.id === id) ?? next.wires.find((w) => w.points.some((q) => eq(q, lastPt)));
    p.onSelectionChange(found ? [found.id] : []);
  };

  const cancelWiring = (): void => {
    if (ix.current.kind === 'wiring') { ix.current = { kind: 'idle' }; schedule(); }
  };

  /** Click while wiring: finish on pin/wire, else add a waypoint. */
  const wiringClick = (w: Vec2): void => {
    const st = ix.current;
    if (st.kind !== 'wiring') return;
    updateWiringRoute(w);
    const tgt = wiringTarget(w);
    const startPt = st.pieces.length ? st.pieces[0][0] : st.anchor;
    if (tgt && !(st.pieces.length === 0 && eq(tgt.p, st.anchor))) {
      if (eq(tgt.p, startPt) && st.pieces.length === 0) { cancelWiring(); return; }
      finishWiring();
      return;
    }
    addWaypoint();
    schedule();
  };

  // ------------------------------------------------------------------ pointer handling
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    wrapRef.current?.focus({ preventScroll: true });
    const cv = canvasRef.current!;
    const w = toWorld(e.clientX, e.clientY);
    const sPos = toLocalS(e.clientX, e.clientY);
    cursorW.current = w;
    if (e.button === 2) return; // context menu handled separately
    if (e.button === 1 || space.current || p.tool === 'pan') {
      e.preventDefault();
      capture(cv, e.pointerId);
      ix.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: p.view.cx, cy: p.view.cy };
      return;
    }
    tipRef.current?.hide();
    if (e.button !== 0) return;
    capture(cv, e.pointerId);
    if (ix.current.kind === 'wiring') { wiringClick(w); return; }
    const m = model();
    const sel = selSet();
    const hit = hitTest(m, w, p.view.zoom, sel);

    // live interaction with switches / buttons / pots
    if (p.running) {
      const cid = hit.kind === 'comp' ? hit.id : hit.kind === 'pin' ? hit.compId : null;
      const c = cid ? m.fitById.get(cid)?.c : undefined;
      if (c && (hit.kind === 'comp' || POT_TYPES.has(c.type))) {
        const def = m.defs.get(c.type);
        if (POT_TYPES.has(c.type) && hit.kind === 'comp') {
          ix.current = { kind: 'pot', id: c.id, startY: e.clientY, startVal: potValue(c, p.state?.components?.[c.id], potOverride.current.get(c.id)) };
          return;
        }
        if (PUSH_TYPES.has(c.type)) { p.onInteract(c.id, 'press'); ix.current = { kind: 'press', id: c.id }; return; }
        if (TOGGLE_TYPES.has(c.type) || (def?.interactive && !POT_TYPES.has(c.type))) { p.onInteract(c.id, 'toggle'); return; }
      }
    }

    if (p.tool === 'probe') {
      if (hit.kind === 'pin') {
        const f = m.fitById.get(hit.compId);
        placeProbe(hit.p, (f && pinOutward(f, hit.pin)) || { x: 0, y: -1 });
      } else if (hit.kind === 'wire' || hit.kind === 'handle') {
        // leave the wire perpendicular to the probed segment so the lead never overlaps it
        const wr = m.wireById.get(hit.wireId);
        const seg = hit.kind === 'wire' ? hit.seg : Math.max(0, Math.min(hit.index, (wr?.points.length ?? 2) - 2));
        const a = wr?.points[seg], b = wr?.points[seg + 1];
        placeProbe(hit.p, a && b && a.x === b.x ? { x: 1, y: 0 } : { x: 0, y: -1 });
      }
      return;
    }
    if (p.tool === 'place') {
      if (p.placeType) addComponent(p.placeType, snap(w));
      return;
    }
    if (p.tool === 'wire') {
      if (hit.kind === 'pin') {
        const f = m.fitById.get(hit.compId);
        const o = f ? pinOutward(f, hit.pin) : null;
        startWiring(hit.p, sPos, true, o ? dirOf(o) : undefined);
        return;
      }
      if (hit.kind === 'wire' || hit.kind === 'handle') { startWiring(hit.p, sPos, true); return; }
      if (hit.kind === 'none') { startWiring(snap(w), sPos, true); return; }
    }
    // select tool (and component hits in wire tool)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hit.kind === 'handle') {
      ix.current = { kind: 'vertex', wireId: hit.wireId, index: hit.index, orig: p.scene, downS: sPos, moved: false, last: hit.p };
      return;
    }
    if (hit.kind === 'pin') {
      const f = m.fitById.get(hit.compId);
      const o = f ? pinOutward(f, hit.pin) : null;
      startWiring(hit.p, sPos, true, o ? dirOf(o) : undefined);
      return;
    }
    if (hit.kind === 'comp' || hit.kind === 'wire') {
      const id = hit.kind === 'comp' ? hit.id : hit.wireId;
      let selection = p.selection;
      if (additive) {
        selection = sel.has(id) ? selection.filter((x) => x !== id) : [...selection, id];
        p.onSelectionChange(selection);
        if (!selection.includes(id)) return;
      } else if (!sel.has(id)) {
        selection = [id];
        p.onSelectionChange(selection);
      }
      if (hit.kind === 'wire' && (selection.length === 1 || !additive) && !selection.some((x) => m.fitById.has(x))) {
        ix.current = { kind: 'segment', wireId: hit.wireId, seg: hit.seg, orig: p.scene, start: w, downS: sPos, moved: false, last: { x: 0, y: 0 } };
        return;
      }
      const ss = new Set(selection);
      const comps = new Set(p.scene.components.filter((c) => ss.has(c.id)).map((c) => c.id));
      const wires = new Set(p.scene.wires.filter((x) => ss.has(x.id)).map((x) => x.id));
      const pts = comps.size ? p.scene.components.filter((c) => comps.has(c.id)).map((c) => c.position) : p.scene.wires.filter((x) => wires.has(x.id)).flatMap((x) => x.points);
      const n = pts.length || 1;
      const pivot = { x: Math.round(pts.reduce((t, q) => t + q.x, 0) / n), y: Math.round(pts.reduce((t, q) => t + q.y, 0) / n) };
      ix.current = { kind: 'move', start: w, downS: sPos, comps, wires, orig: p.scene, delta: { x: 0, y: 0 }, rot: 0, mirror: false, moved: false, clickId: id, additive, pivot };
      return;
    }
    // empty: marquee
    ix.current = { kind: 'marquee', a: w, b: w, additive, base: additive ? p.selection : [] };
    if (!additive && p.selection.length) p.onSelectionChange([]);
    schedule();
  };

  const updateMovePreview = (): void => {
    const st = ix.current;
    if (st.kind !== 'move') return;
    const p = P.current;
    const next = transformSelection(st.orig, p.engine, defs(), fitCache.current, st.comps, st.wires, st.delta, st.rot, st.mirror, st.pivot);
    emit(next, null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const w = toWorld(e.clientX, e.clientY);
    const sPos = toLocalS(e.clientX, e.clientY);
    cursorW.current = w;
    p.onCursor?.(snap(w));
    const st = ix.current;
    const far = (d: Vec2): boolean => Math.hypot(sPos.x - d.x, sPos.y - d.y) > DRAG_PX;
    switch (st.kind) {
      case 'pan': {
        const z = p.view.zoom;
        p.onViewChange({ cx: st.cx - (e.clientX - st.sx) / z, cy: st.cy - (e.clientY - st.sy) / z, zoom: z });
        return;
      }
      case 'marquee': {
        st.b = w;
        schedule();
        return;
      }
      case 'move': {
        if (!st.moved && !far(st.downS)) return;
        st.moved = true;
        const d = { x: Math.round(w.x - st.start.x), y: Math.round(w.y - st.start.y) };
        if (d.x !== st.delta.x || d.y !== st.delta.y) { st.delta = d; updateMovePreview(); }
        return;
      }
      case 'segment': {
        if (!st.moved && !far(st.downS)) return;
        st.moved = true;
        const d = { x: Math.round(w.x - st.start.x), y: Math.round(w.y - st.start.y) };
        if (eq(d, st.last)) return;
        st.last = d;
        const wires = st.orig.wires.map((x) => (x.id === st.wireId ? { ...x, points: moveSegment(x.points, st.seg, d) } : x));
        emit(sceneWithWires(st.orig, wires), null);
        return;
      }
      case 'vertex': {
        if (!st.moved && !far(st.downS)) return;
        st.moved = true;
        const g = snap(w);
        if (eq(g, st.last)) return;
        st.last = g;
        const wires = st.orig.wires.map((x) => (x.id === st.wireId ? { ...x, points: moveVertex(x.points, st.index, g) } : x));
        emit(sceneWithWires(st.orig, wires), null);
        return;
      }
      case 'wiring': {
        if (st.dragging && !st.moved && far(st.downS)) st.moved = true;
        updateWiringRoute(w);
        schedule();
        return;
      }
      case 'pot': {
        const v = Math.max(0, Math.min(1, st.startVal - (e.clientY - st.startY) / 160));
        potOverride.current.set(st.id, v);
        p.onInteract(st.id, { set: v });
        schedule();
        return;
      }
      default: {
        const m = model();
        const h = hitTest(m, w, p.view.zoom, selSet());
        const prev = hover.current;
        hover.current = h.kind === 'none' ? null : h;
        updateCursor(h);
        updateTip(h, sPos);
        if (JSON.stringify(prev) !== JSON.stringify(hover.current) || p.tool === 'place') schedule();
      }
    }
  };

  const updateCursor = (h: Hit): void => {
    const cv = canvasRef.current;
    if (!cv) return;
    const p = P.current;
    let c = 'default';
    if (p.tool === 'pan' || space.current) c = 'grab';
    else if (p.tool === 'place') c = 'copy';
    else if (p.tool === 'wire' || p.tool === 'probe') c = 'crosshair';
    else if (h.kind === 'pin') c = 'crosshair';
    else if (h.kind === 'handle') c = 'move';
    else if (h.kind === 'comp') {
      const t = model().fitById.get(h.id)?.c.type ?? '';
      c = p.running && (POT_TYPES.has(t) || PUSH_TYPES.has(t) || TOGGLE_TYPES.has(t)) ? (POT_TYPES.has(t) ? 'ns-resize' : 'pointer') : 'move';
    } else if (h.kind === 'wire') {
      const wr = model().wireById.get(h.wireId);
      const a = wr?.points[h.seg], b = wr?.points[h.seg + 1];
      c = a && b ? (a.y === b.y ? 'ns-resize' : a.x === b.x ? 'ew-resize' : 'move') : 'move';
    }
    if (cv.style.cursor !== c) cv.style.cursor = c;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const cv = canvasRef.current!;
    try { if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const st = ix.current;
    const w = toWorld(e.clientX, e.clientY);
    switch (st.kind) {
      case 'pan': ix.current = { kind: 'idle' }; return;
      case 'marquee': {
        ix.current = { kind: 'idle' };
        const m = model();
        const r = { x0: Math.min(st.a.x, st.b.x), y0: Math.min(st.a.y, st.b.y), x1: Math.max(st.a.x, st.b.x), y1: Math.max(st.a.y, st.b.y) };
        const crossing = st.b.x < st.a.x;
        const ids = new Set(st.base);
        for (const f of m.fits) if (crossing ? rectsIntersect(r, f.bounds) : rectContains(r, f.bounds)) ids.add(f.c.id);
        for (const wr of m.scene.wires) {
          const xs = wr.points.map((q) => q.x), ys = wr.points.map((q) => q.y);
          const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
          if (crossing ? rectsIntersect(r, b) && wr.points.some((q, i) => i > 0 && segRect(wr.points[i - 1], q, r)) : rectContains(r, b)) ids.add(wr.id);
        }
        p.onSelectionChange([...ids]);
        schedule();
        return;
      }
      case 'move': {
        ix.current = { kind: 'idle' };
        if (st.moved && (st.delta.x || st.delta.y || st.rot || st.mirror)) {
          const next = normalized(transformSelection(st.orig, p.engine, defs(), fitCache.current, st.comps, st.wires, st.delta, st.rot, st.mirror, st.pivot));
          const n = st.comps.size + st.wires.size;
          emit(next, n === 1 ? `Move ${st.comps.size ? nameOf([...st.comps][0]) : 'Wire'}` : `Move ${n} items`);
        } else {
          if (st.moved) { preview.current = null; p.onSceneChange(st.orig, { commit: false }); }
          if (!st.moved && !st.additive && p.selection.length > 1) p.onSelectionChange([st.clickId]);
        }
        schedule();
        return;
      }
      case 'segment':
      case 'vertex': {
        ix.current = { kind: 'idle' };
        if (st.moved) {
          const cur = scene();
          emit(normalized(cur), 'Edit Wire');
        }
        schedule();
        return;
      }
      case 'wiring': {
        if (st.dragging) {
          st.dragging = false;
          if (st.moved) {
            updateWiringRoute(w);
            const tgt = wiringTarget(w);
            if (tgt && !eq(tgt.p, st.pieces.length ? st.pieces[0][0] : st.anchor)) finishWiring();
            else addWaypoint();
          }
        }
        schedule();
        return;
      }
      case 'pot': ix.current = { kind: 'idle' }; return;
      case 'press': p.onInteract(st.id, 'release'); ix.current = { kind: 'idle' }; schedule(); return;
      default: return;
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const p = P.current;
    const w = toWorld(e.clientX, e.clientY);
    const st = ix.current;
    if (st.kind === 'wiring') {
      // end a dangling wire here
      updateWiringRoute(w);
      if (st.route.length <= 1 && st.pieces.length === 0) { cancelWiring(); return; }
      finishWiring();
      return;
    }
    if (p.tool !== 'select' && p.tool !== 'wire') return;
    const m = model();
    const h = hitTest(m, w, p.view.zoom, selSet(), { pins: false });
    if (h.kind === 'wire') {
      const wire = m.wireById.get(h.wireId);
      if (!wire || wire.points.some((q) => eq(q, h.p))) return;
      const wires = p.scene.wires.map((x) => (x.id === h.wireId ? { ...x, points: insertVertex(x.points, h.seg, h.p) } : x));
      emit(normalized(sceneWithWires(p.scene, wires), new Set([h.wireId])), 'Insert Vertex');
      p.onSelectionChange([h.wireId]);
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    const p = P.current;
    if (ix.current.kind === 'wiring') { cancelWiring(); return; }
    const w = toWorld(e.clientX, e.clientY);
    const h = hitTest(model(), w, p.view.zoom, selSet(), { pins: false });
    const id = h.kind === 'comp' ? h.id : h.kind === 'wire' || h.kind === 'handle' ? h.wireId : null;
    if (id && !p.selection.includes(id)) p.onSelectionChange([id]);
    p.onContextMenu?.(id, { x: e.clientX, y: e.clientY });
  };

  const onPointerLeave = (): void => {
    tipRef.current?.hide();
    cursorW.current = null;
    P.current.onCursor?.(null);
    if (hover.current) { hover.current = null; }
    schedule();
  };

  // ------------------------------------------------------------------ keyboard
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const p = P.current;
    const t = e.target as HTMLElement;
    if (t && t !== wrapRef.current && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const st = ix.current;
    const k = e.key;
    // Only keys the viewport actually acts on are consumed (preventDefault) so the shell's
    // global shortcuts (shortcuts.ts checks defaultPrevented) never double-fire.
    if (k === ' ') { space.current = true; updateCursor(hover.current ?? { kind: 'none' }); return; } // shell owns Space-pan
    const hasSel = p.selection.length > 0;
    if (k === 'Escape') {
      if (st.kind === 'wiring') { e.preventDefault(); cancelWiring(); }
      else if (st.kind === 'move' || st.kind === 'segment' || st.kind === 'vertex') {
        e.preventDefault();
        // commit the original scene: the store recognises a no-op commit, ends the preview and adds no undo step
        ix.current = { kind: 'idle' }; preview.current = null; p.onSceneChange(st.orig, { commit: true }); schedule();
      } else if (st.kind === 'marquee') { e.preventDefault(); ix.current = { kind: 'idle' }; schedule(); }
      else if (hasSel) { e.preventDefault(); p.onSelectionChange([]); }
      return;
    }
    if (st.kind === 'wiring' && k === 'Backspace') {
      e.preventDefault();
      if (st.pieces.length) {
        const last = st.pieces.pop()!;
        st.anchor = last[0];
        st.prefDir = undefined;
        if (cursorW.current) updateWiringRoute(cursorW.current); else st.route = [st.anchor];
      } else cancelWiring();
      schedule();
      return;
    }
    if (st.kind === 'wiring' && k === 'Enter') { e.preventDefault(); finishWiring(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+A etc. belong to the shell
    if (k === 'r' || k === 'R') {
      if (st.kind === 'move') { e.preventDefault(); st.rot = (st.rot + (e.shiftKey ? 3 : 1)) % 4; st.moved = true; updateMovePreview(); return; }
      if (st.kind === 'idle' && hasSel) { e.preventDefault(); transformSel({ x: 0, y: 0 }, e.shiftKey ? 3 : 1, false, 'Rotate'); }
      return;
    }
    if (k === 'm' || k === 'M') {
      if (st.kind === 'move') { e.preventDefault(); st.mirror = !st.mirror; st.moved = true; updateMovePreview(); return; }
      if (st.kind === 'idle' && hasSel) { e.preventDefault(); transformSel({ x: 0, y: 0 }, 0, true, 'Mirror'); }
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && st.kind === 'idle' && hasSel) { e.preventDefault(); deleteSelection(); return; }
    if (k.startsWith('Arrow') && st.kind === 'idle' && hasSel) {
      e.preventDefault();
      const n = e.shiftKey ? 5 : 1;
      const d = k === 'ArrowLeft' ? { x: -n, y: 0 } : k === 'ArrowRight' ? { x: n, y: 0 } : k === 'ArrowUp' ? { x: 0, y: -n } : { x: 0, y: n };
      transformSel(d, 0, false, 'Nudge');
    }
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === ' ') { space.current = false; updateCursor(hover.current ?? { kind: 'none' }); }
  };

  // ------------------------------------------------------------------ drag & drop from palette
  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (Array.from(e.dataTransfer.types).includes(PALETTE_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    const raw = e.dataTransfer.getData(PALETTE_DND_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: PaletteDragPayload | null = null;
    try { payload = JSON.parse(raw) as PaletteDragPayload; } catch { payload = null; }
    if (!payload || payload.domain !== 'circuit' || !payload.type) return;
    addComponent(payload.type, snap(toWorld(e.clientX, e.clientY)));
    wrapRef.current?.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------------ effects
  useEffect(() => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const resize = (): void => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      schedule();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq?.addEventListener?.('change', resize);
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = P.current;
      const w = toWorld(e.clientX, e.clientY);
      if (p.running) {
        const h = hitTest(model(), w, p.view.zoom, new Set(), { pins: false, wires: false });
        const c = h.kind === 'comp' ? model().fitById.get(h.id)?.c : undefined;
        if (c && POT_TYPES.has(c.type)) {
          const cur = potValue(c, p.state?.components?.[c.id], potOverride.current.get(c.id));
          const v = Math.max(0, Math.min(1, cur - Math.sign(e.deltaY) * 0.05));
          potOverride.current.set(c.id, v);
          p.onInteract(c.id, { set: v });
          schedule();
          return;
        }
      }
      const v = p.view;
      const k = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0015);
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * k));
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left - r.width / 2, sy = e.clientY - r.top - r.height / 2;
      p.onViewChange({ cx: w.x - sx / zoom, cy: w.y - sy / zoom, zoom });
    };
    cv.addEventListener('wheel', wheel, { passive: false });
    const tip = new HoverTip(wrap);
    tipRef.current = tip;
    return () => {
      tip.dispose();
      tipRef.current = null;
      ro.disconnect();
      mq?.removeEventListener?.('change', resize);
      cv.removeEventListener('wheel', wheel);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // redraw on any prop change; drop stale previews once the shell has a new scene and no drag is active
  useEffect(() => {
    const k = ix.current.kind;
    if (preview.current && k !== 'move' && k !== 'segment' && k !== 'vertex') preview.current = null;
    // clear pot overrides once the sim reports values (or stops)
    if (!props.running) potOverride.current.clear();
    if (props.tool !== 'wire' && props.tool !== 'select' && ix.current.kind === 'wiring') ix.current = { kind: 'idle' };
    schedule();
  });

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onBlur={() => { space.current = false; }}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', outline: 'none', background: '#ffffff' }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ position: 'absolute', inset: 0, display: 'block', touchAction: 'none' }}
      />
    </div>
  );
}

function capture(cv: HTMLCanvasElement, id: number): void {
  try { cv.setPointerCapture(id); } catch { /* synthetic / inactive pointer */ }
}

function segRect(a: Vec2, b: Vec2, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return x0 <= r.x1 && x1 >= r.x0 && y0 <= r.y1 && y1 >= r.y0;
}

export default CircuitViewport;
export type { CompFit };
