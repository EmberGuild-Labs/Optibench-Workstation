/**
 * Imperative core of the optics viewport: owns the canvases, the frame loop, caches and
 * pointer/keyboard state. The React wrapper (index.tsx) only mounts it and feeds props.
 * Fully controlled: the scene/selection/view are never mutated, only re-emitted via callbacks.
 */
import type { ComponentGeometry, OpticalComponent, OpticsScene, TraceResult, Vec2, ViewState, OpticsEngineAPI } from '@core/types';
import { PALETTE_DND_MIME, type OpticsViewportProps, type PaletteDragPayload } from '../contracts';
import { GLRenderer } from './gl/GLRenderer';
import { buildLightData, type LightData } from './lightData';
import { computeMirrorFronts, computeNormals, type NormalMark } from './analysis';
import { drawOverlay, rotationKnob, type OverlayUI } from './overlay';
import { GeometryCache, buildGlassMesh, hitTest } from './sceneCache';
import { clamp, dist, rectsIntersect, screenToWorld, worldToScreen } from './math';
import { safeRGB } from './style';
import { drawEnvelopes, envelopePaths, type EnvelopePath } from './gaussian';
import {
  BeamPicker, HoverTip, beamTip, componentTip, computeBeamLabels, drawAnnotations, drawBeamLabels, snapPoint,
  type BeamLabel, type InfoCtx, type Snap
} from './measureInfo';
import type { ComponentDef } from '@core/types';

const MIN_ZOOM = 0.02, MAX_ZOOM = 400;
const SNAP = 0.5;            // mm
const HOLE_PITCH = 25;       // mm (Alt-snap)
const ROT_SNAP = Math.PI / 12;

type Drag =
  | { kind: 'pan'; start: Vec2; view: ViewState }
  | { kind: 'move'; startW: Vec2; startS: Vec2; ids: Set<string>; scene: OpticsScene; moved: boolean; clickId: string; wasSelected: boolean; additive: boolean; last: OpticsScene | null }
  | { kind: 'marquee'; a: Vec2; b: Vec2; startS: Vec2; additive: boolean; base: string[]; last: string }
  | { kind: 'rotate'; id: string; center: Vec2; a0: number; r0: number; scene: OpticsScene; last: OpticsScene | null }
  | { kind: 'handle'; id: string; key: string; scene: OpticsScene; last: OpticsScene | null }
  | { kind: 'measure'; downS: Vec2 };

export class OpticsViewportRuntime {
  private wrap: HTMLDivElement;
  private glCanvas: HTMLCanvasElement;
  private ovCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: GLRenderer | null = null;
  private getProps: () => OpticsViewportProps;
  private ro: ResizeObserver;
  private raf = 0;
  private size = { w: 0, h: 0, dpr: 1 };

  private cache = new GeometryCache();
  private geoms = new Map<string, ComponentGeometry>();
  private labels = new Map<string, string>();
  private lastEngine: OpticsEngineAPI | null = null;
  private lastScene: OpticsScene | null = null;
  private lastTrace: TraceResult | null | undefined = undefined;
  private lastWinKey = '';
  private envelopes: { trace: TraceResult | null; scene: OpticsScene | null; list: EnvelopePath[] } = { trace: null, scene: null, list: [] };
  private light: LightData | null = null;
  private mirrorFronts = new Map<string, number>();
  private normals: NormalMark[] = [];
  private normalsDirty = true;

  private hover: string | null = null;
  private drag: Drag | null = null;
  private ui: OverlayUI = {};
  private spaceDown = false;
  private pointerInside = false;
  private zoomAnim: { target: number; anchorS: Vec2; anchorW: Vec2; view: ViewState } | null = null;
  private lastTool = '';
  private frameNo = 0;

  // measurement overlays
  private tip: HoverTip;
  private picker = new BeamPicker();
  private defs = new Map<string, ComponentDef>();
  private measurePending: { kind: 'distance' | 'angle'; points: Vec2[]; downS: Vec2 } | null = null;
  private measureCursor: Snap | null = null;
  private beamLabels: { trace: TraceResult | null; scene: OpticsScene | null; list: BeamLabel[] } = { trace: null, scene: null, list: [] };

  constructor(wrap: HTMLDivElement, gl: HTMLCanvasElement, ov: HTMLCanvasElement, getProps: () => OpticsViewportProps) {
    this.wrap = wrap; this.glCanvas = gl; this.ovCanvas = ov; this.getProps = getProps;
    this.ctx = ov.getContext('2d')!;
    this.tip = new HoverTip(wrap);
    try {
      this.renderer = new GLRenderer(gl);
      if (!this.renderer.ok) { this.renderer.dispose(); this.renderer = null; }
    } catch (err) {
      console.error(err);
      this.renderer = null;
    }
    if (!this.renderer) gl.style.display = 'none';
    else this.renderer.onRestored = () => { this.lastScene = null; this.lastTrace = undefined; };

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    this.resize();

    wrap.addEventListener('pointerdown', this.onPointerDown);
    wrap.addEventListener('pointermove', this.onPointerMove);
    wrap.addEventListener('pointerup', this.onPointerUp);
    wrap.addEventListener('pointercancel', this.onPointerUp);
    wrap.addEventListener('pointerleave', this.onPointerLeave);
    wrap.addEventListener('pointerenter', this.onPointerEnter);
    wrap.addEventListener('wheel', this.onWheel, { passive: false });
    wrap.addEventListener('contextmenu', this.onContextMenu);
    wrap.addEventListener('keydown', this.onKeyDown);
    wrap.addEventListener('dragover', this.onDragOver);
    wrap.addEventListener('drop', this.onDrop);
    wrap.addEventListener('auxclick', this.preventMiddle);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    (wrap as unknown as { __opticsRuntime?: OpticsViewportRuntime }).__opticsRuntime = this; // diagnostics hook
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const w = this.wrap;
    w.removeEventListener('pointerdown', this.onPointerDown);
    w.removeEventListener('pointermove', this.onPointerMove);
    w.removeEventListener('pointerup', this.onPointerUp);
    w.removeEventListener('pointercancel', this.onPointerUp);
    w.removeEventListener('pointerleave', this.onPointerLeave);
    w.removeEventListener('pointerenter', this.onPointerEnter);
    w.removeEventListener('wheel', this.onWheel);
    w.removeEventListener('contextmenu', this.onContextMenu);
    w.removeEventListener('keydown', this.onKeyDown);
    w.removeEventListener('dragover', this.onDragOver);
    w.removeEventListener('drop', this.onDrop);
    w.removeEventListener('auxclick', this.preventMiddle);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.renderer?.dispose();
    this.renderer = null;
    this.tip.dispose();
    this.picker.dispose();
  }

  // ------------------------------------------------------------------ sizing / frame
  private resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.size = { w, h, dpr };
    for (const c of [this.glCanvas, this.ovCanvas]) {
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    try {
      const t0 = performance.now();
      this.renderNow(now);
      // cheap CPU frame-time probe for diagnostics (data-frame-ms on the viewport element)
      if ((this.frameNo = (this.frameNo + 1) % 30) === 0) this.wrap.dataset.frameMs = (performance.now() - t0).toFixed(2);
    } catch (err) {
      console.error('[optics viewport] frame failed', err);
    }
  };

  /** Render both layers synchronously (also used for PNG capture). */
  renderNow(now = performance.now()): void {
    const p = this.getProps();
    if ((window.devicePixelRatio || 1) !== this.size.dpr && Math.min(3, window.devicePixelRatio || 1) !== this.size.dpr) this.resize();
    if (p.tool !== this.lastTool) {
      this.lastTool = p.tool;
      if (p.tool !== 'measure') { this.ui.measure = null; this.measurePending = null; this.measureCursor = null; }
      if (p.tool !== 'select') this.tip.hide();
      this.updateCursor();
    }
    this.stepZoom(p);
    this.sync(p);
    const { w, h, dpr } = this.size;
    const t = now / 1000;
    const o = clamp(p.display.rayOpacity, 0, 1);
    const exposure = 0.05 + 1.6 * Math.pow(o, 1.3);
    if (this.renderer?.ok) {
      this.renderer.render({
        width: this.glCanvas.width, height: this.glCanvas.height, dpr, view: p.view, time: t,
        showGrid: p.display.showGrid, bloom: p.display.bloom, exposure,
      });
    }
    if (p.display.showNormals && this.normalsDirty) {
      this.normals = computeNormals(p.scene.components, this.geoms, p.trace);
      this.normalsDirty = false;
    }
    drawOverlay({
      ctx: this.ctx, w, h, dpr, view: p.view, time: t, engine: p.engine,
      components: p.scene.components, geoms: this.geoms, labels: this.labels,
      selection: new Set(p.selection), hover: this.drag ? null : this.hover, linkedIds: p.linkedIds,
      display: p.display, light: this.light, trace: p.trace, mirrorFronts: this.mirrorFronts,
      normals: p.display.showNormals ? this.normals : [], ui: this.ui,
      underlay: this.renderer?.ok ? undefined : (ctx) => this.fallbackUnderlay(ctx, p, exposure),
      post: (ctx) => this.drawPost(ctx, p),
    });
    // live values (detector readings) in a visible tooltip
    if (this.tip.visible && this.frameNo % 10 === 0) this.tip.refresh();
  }

  private drawPost(ctx: CanvasRenderingContext2D, p: OpticsViewportProps): void {
    const { w, h } = this.size;
    if (p.display.beamInfo) {
      const bl = this.beamLabels;
      if (bl.trace !== p.trace || bl.scene !== p.scene) {
        bl.trace = p.trace; bl.scene = p.scene;
        bl.list = computeBeamLabels(p.trace, p.scene.components, this.geoms);
      }
      drawBeamLabels(ctx, bl.list, p.engine, p.view, w, h);
    }
    if (p.display.gaussianEnvelope) {
      const ev = this.envelopes;
      if (ev.trace !== p.trace || ev.scene !== p.scene) {
        ev.trace = p.trace; ev.scene = p.scene;
        ev.list = envelopePaths(p.scene.components, p.trace);
      }
      drawEnvelopes(ctx, ev.list, p.view, w, h);
    }
    const pend = this.measurePending;
    let pending: { kind: 'distance' | 'angle'; points: Vec2[] } | null = null;
    if (pend && p.tool === 'measure') {
      const pts = [...pend.points];
      if (this.measureCursor) pts.push(this.measureCursor.p);
      pending = { kind: pend.kind, points: pts };
    }
    drawAnnotations(ctx, p.measurements ?? [], p.selectedMeasurement, pending, p.tool === 'measure' ? this.measureCursor : null, p.view, w, h);
  }

  private infoCtx(p: OpticsViewportProps): InfoCtx {
    return { engine: p.engine, components: p.scene.components, geoms: this.geoms, labels: this.labels, defs: this.defs, ambient: p.scene.settings?.ambientMedium ?? 'air' };
  }

  /** Hover tooltip: component (detector = live reading) under the pointer, else the nearest beam. */
  private updateTip(s: Vec2, w: Vec2, p: OpticsViewportProps): void {
    if (p.tool !== 'select' || this.spaceDown || this.drag) { this.tip.hide(); return; }
    if (this.hover) {
      const id = this.hover;
      this.tip.set('c:' + id, s, () => {
        const q = this.getProps();
        const c = q.scene.components.find((x) => x.id === id);
        return c ? componentTip(this.infoCtx(q), c, q.trace) : null;
      });
      return;
    }
    if (this.ui.hoverHandle) { this.tip.hide(); return; }
    const hit = this.picker.pick(p.trace, w, 4 / p.view.zoom);
    if (!hit) { this.tip.hide(); return; }
    const seg = hit.seg, q = hit.q;
    this.tip.set('b:' + hit.index, s, () => beamTip(this.infoCtx(this.getProps()), seg, q));
  }

  private measureSnap(w: Vec2, e: { ctrlKey: boolean; metaKey?: boolean }, p: OpticsViewportProps): Snap {
    return snapPoint(w, p.scene.components, this.geoms, p.view.zoom, !(e.ctrlKey || e.metaKey));
  }

  private finishMeasure(p: OpticsViewportProps): void {
    const m = this.measurePending;
    if (!m) return;
    const need = m.kind === 'distance' ? 2 : 3;
    if (m.points.length < need) return;
    this.measurePending = null;
    const pts = m.points.slice(0, need);
    if (m.kind === 'distance' && dist(pts[0], pts[1]) < 1e-9) return;
    p.onMeasure?.({ kind: m.kind, points: pts });
  }

  private sync(p: OpticsViewportProps) {
    let sceneChanged = false;
    if (p.engine !== this.lastEngine) {
      this.lastEngine = p.engine;
      this.labels = new Map(p.engine.registry.map((d) => [d.type, d.label]));
      this.defs = new Map(p.engine.registry.map((d) => [d.type, d]));
      this.lastScene = null; this.lastTrace = undefined;
    }
    if (p.scene !== this.lastScene) {
      this.lastScene = p.scene;
      this.geoms = this.cache.all(p.engine, p.scene.components);
      if (this.renderer) {
        const gm = buildGlassMesh(p.scene.components, this.geoms, p.engine);
        this.renderer.setGlass(gm.data, gm.verts);
      }
      sceneChanged = true;
      if (this.hover && !this.geoms.has(this.hover)) this.hover = null;
    }
    const tv = p.timeView;
    const win = tv && tv.mode === 'pulse'
      ? { front: tv.t, width: tv.pulseWidth ?? Number.POSITIVE_INFINITY, period: tv.period ?? 0 }
      : null;
    const winKey = win ? `${win.front}|${win.width}|${win.period}` : '';
    const winChanged = winKey !== this.lastWinKey;
    this.lastWinKey = winKey;
    if (p.trace !== this.lastTrace || sceneChanged || winChanged) {
      const realTraceChanged = p.trace !== this.lastTrace;
      const traceChanged = realTraceChanged || winChanged;
      this.lastTrace = p.trace;
      if (traceChanged || p.scene.components.some((c) => c.type.startsWith('fiber'))) {
        this.light = buildLightData(p.trace, p.engine, p.scene.components, (c) => this.cache.get(p.engine, c), win);
        this.renderer?.setRays(this.light.rays, this.light.rayCount);
        this.renderer?.setSprites(this.light.sprites, this.light.spriteCount);
      }
      if (realTraceChanged || sceneChanged) {
        this.mirrorFronts = computeMirrorFronts(p.scene.components, this.geoms, p.trace);
        // prebuild the beam hover index in idle time while the pointer is over the bench
        if (realTraceChanged && this.pointerInside) this.picker.prepare(p.trace);
        this.normalsDirty = true;
      }
    }
  }

  private fallbackUnderlay(ctx: CanvasRenderingContext2D, p: OpticsViewportProps, exposure: number) {
    const { w, h, dpr } = this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05080e';
    ctx.fillRect(0, 0, w, h);
    const v = p.view;
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * (w / 2 - v.cx * v.zoom), dpr * (h / 2 - v.cy * v.zoom));
    if (p.display.showGrid) {
      ctx.fillStyle = 'rgba(40,55,80,0.6)';
      const x0 = Math.floor((v.cx - w / 2 / v.zoom) / HOLE_PITCH) * HOLE_PITCH, x1 = v.cx + w / 2 / v.zoom;
      const y0 = Math.floor((v.cy - h / 2 / v.zoom) / HOLE_PITCH) * HOLE_PITCH, y1 = v.cy + h / 2 / v.zoom;
      if (HOLE_PITCH * v.zoom > 6) for (let x = x0; x <= x1; x += HOLE_PITCH) for (let y = y0; y <= y1; y += HOLE_PITCH) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.283); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.5 / v.zoom, 0.5);
    const segs = p.trace?.segments ?? [];
    const lim = Math.min(segs.length, 20000);
    for (let i = 0; i < lim; i++) {
      const s = segs[i];
      const c = safeRGB(p.engine, s.wavelength);
      ctx.strokeStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${clamp(0.25 * exposure, 0.05, 1)})`;
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ capture
  async capturePNG(): Promise<Blob> {
    this.renderNow();
    const out = document.createElement('canvas');
    out.width = this.ovCanvas.width; out.height = this.ovCanvas.height;
    const c = out.getContext('2d')!;
    // drawing buffer is still valid within this task (preserveDrawingBuffer:false is fine)
    if (this.renderer?.ok) c.drawImage(this.glCanvas, 0, 0);
    c.drawImage(this.ovCanvas, 0, 0);
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
  }

  // ------------------------------------------------------------------ helpers
  private local(e: { clientX: number; clientY: number }): Vec2 {
    const r = this.wrap.getBoundingClientRect();
    // ResizeObserver delivery can lag a layout change; never map input with a stale size
    if (Math.round(r.width) !== this.size.w || Math.round(r.height) !== this.size.h) this.resize();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private toWorld(s: Vec2, view = this.getProps().view): Vec2 {
    return screenToWorld(s, view, this.size.w, this.size.h);
  }
  private snapV(v: number, e: { ctrlKey: boolean; altKey: boolean; metaKey?: boolean }): number {
    if (e.ctrlKey || e.metaKey) return v;
    if (e.altKey) return Math.round(v / HOLE_PITCH) * HOLE_PITCH;
    return Math.round(v / SNAP) * SNAP;
  }
  /** Latest props with caches synced (input can arrive before the next animation frame). */
  private fresh(): OpticsViewportProps {
    const p = this.getProps();
    this.sync(p);
    return p;
  }
  private compName(c: OpticalComponent): string {
    return c.name || this.labels.get(c.type) || c.type;
  }
  private updateCursor(kind?: string) {
    const p = this.getProps();
    let cur = 'default';
    if (this.drag?.kind === 'pan') cur = 'grabbing';
    else if (this.drag?.kind === 'move') cur = 'move';
    else if (this.drag?.kind === 'rotate') cur = 'grabbing';
    else if (this.spaceDown || p.tool === 'pan') cur = 'grab';
    else if (p.tool === 'measure') cur = 'crosshair';
    else if (p.tool === 'place') cur = 'copy';
    else if (kind === 'handle') cur = 'grab';
    else if (kind === 'comp') cur = 'move';
    if (this.wrap.style.cursor !== cur) this.wrap.style.cursor = cur;
  }

  /** Translate components (and fiber far ends stored in props.endX/endY). */
  private moveComponents(scene: OpticsScene, ids: Set<string>, delta: (c: OpticalComponent) => Vec2): OpticsScene {
    return {
      ...scene,
      components: scene.components.map((c) => {
        if (!ids.has(c.id) || c.locked) return c;
        const d = delta(c);
        if (d.x === 0 && d.y === 0) return c;
        const next: OpticalComponent = { ...c, position: { x: c.position.x + d.x, y: c.position.y + d.y } };
        if (typeof c.props.endX === 'number' && typeof c.props.endY === 'number') {
          next.props = { ...c.props, endX: (c.props.endX as number) + d.x, endY: (c.props.endY as number) + d.y };
        }
        return next;
      }),
    };
  }

  private singleSelected(p: OpticsViewportProps): OpticalComponent | null {
    if (p.selection.length !== 1) return null;
    const c = p.scene.components.find((x) => x.id === p.selection[0]);
    return c && !c.locked ? c : null;
  }

  /** Which edit handle (rotation knob / geometry handle) is under a screen point. */
  private handleAt(s: Vec2, p: OpticsViewportProps): { kind: 'rotate' } | { kind: 'handle'; key: string } | null {
    if (p.tool !== 'select') return null;
    const c = this.singleSelected(p);
    if (!c) return null;
    const g = this.geoms.get(c.id);
    for (const hd of g?.handles ?? []) {
      if (dist(worldToScreen(hd.p, p.view, this.size.w, this.size.h), s) < 9) return { kind: 'handle', key: hd.key };
    }
    const k = worldToScreen(rotationKnob(c, g, p.view.zoom), p.view, this.size.w, this.size.h);
    if (dist(k, s) < 10) return { kind: 'rotate' };
    return null;
  }

  private place(type: string, w: Vec2, e: { ctrlKey: boolean; altKey: boolean; metaKey?: boolean }) {
    const p = this.fresh();
    let c: OpticalComponent;
    try {
      c = p.engine.createComponent(type, { x: this.snapV(w.x, e), y: this.snapV(w.y, e) });
    } catch (err) {
      console.error('[optics viewport] createComponent failed', err);
      return;
    }
    const next: OpticsScene = { ...p.scene, components: [...p.scene.components, c] };
    p.onSceneChange(next, { commit: true, label: `Add ${this.labels.get(type) ?? type}` });
    p.onSelectionChange([c.id]);
  }

  // ------------------------------------------------------------------ zoom
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.getProps();
    const s = this.local(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
    const cur = this.zoomAnim?.view ?? p.view;
    const target = clamp((this.zoomAnim?.target ?? cur.zoom) * factor, MIN_ZOOM, MAX_ZOOM);
    this.zoomAnim = { target, anchorS: s, anchorW: this.toWorld(s, cur), view: { ...cur } };
  };

  private stepZoom(p: OpticsViewportProps) {
    const a = this.zoomAnim;
    if (!a) return;
    const lz = Math.log(a.view.zoom), lt = Math.log(a.target);
    const nz = Math.abs(lt - lz) < 0.002 ? a.target : Math.exp(lz + (lt - lz) * 0.28);
    const { w, h } = this.size;
    const v: ViewState = { zoom: nz, cx: a.anchorW.x - (a.anchorS.x - w / 2) / nz, cy: a.anchorW.y - (a.anchorS.y - h / 2) / nz };
    a.view = v;
    p.onViewChange(v);
    if (nz === a.target) this.zoomAnim = null;
  }

  // ------------------------------------------------------------------ pointer
  private preventMiddle = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
  private onPointerEnter = () => { this.pointerInside = true; };
  private onPointerLeave = () => {
    this.pointerInside = false;
    this.tip.hide();
    if (!this.drag) { this.hover = null; this.ui.hoverHandle = null; this.measureCursor = null; }
    this.getProps().onCursor?.(null);
  };

  private onPointerDown = (e: PointerEvent) => {
    const p = this.fresh();
    this.wrap.focus({ preventScroll: true });
    const s = this.local(e);
    const w = this.toWorld(s);
    this.tip.hide();
    if (e.button === 1 || (e.button === 0 && (this.spaceDown || p.tool === 'pan'))) {
      e.preventDefault();
      this.zoomAnim = null;
      this.drag = { kind: 'pan', start: s, view: { ...p.view } };
      this.wrap.setPointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    this.wrap.setPointerCapture(e.pointerId);

    if (p.tool === 'measure') {
      // click-click distance (or press-drag-release); Shift+first click: angle through three points
      const sp = this.measureSnap(w, e, p);
      const pt = this.measurePending?.kind === 'distance' && e.shiftKey && this.measureCursor ? this.measureCursor.p : sp.p;
      if (!this.measurePending) this.measurePending = { kind: e.shiftKey ? 'angle' : 'distance', points: [pt], downS: s };
      else { this.measurePending.points.push(pt); this.finishMeasure(p); }
      this.drag = { kind: 'measure', downS: s };
      this.measureCursor = sp;
      return;
    }
    if (p.tool === 'place') {
      if (p.placeType) this.place(p.placeType, w, e);
      return;
    }
    // select tool
    this.ui.measure = null;
    const hd = this.handleAt(s, p);
    const single = this.singleSelected(p);
    if (hd && single) {
      if (hd.kind === 'rotate') {
        this.drag = { kind: 'rotate', id: single.id, center: single.position, a0: Math.atan2(w.y - single.position.y, w.x - single.position.x), r0: single.rotation, scene: p.scene, last: null };
        this.ui.rotating = { id: single.id, angle: single.rotation };
      } else {
        this.drag = { kind: 'handle', id: single.id, key: hd.key, scene: p.scene, last: null };
      }
      this.updateCursor();
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const id = hitTest(w, p.scene.components, this.geoms, 5 / p.view.zoom);
    if (id) {
      const wasSelected = p.selection.includes(id);
      let sel = p.selection;
      if (additive) {
        sel = wasSelected ? p.selection.filter((x) => x !== id) : [...p.selection, id];
        p.onSelectionChange(sel);
        if (wasSelected) return;
      } else if (!wasSelected) {
        sel = [id];
        p.onSelectionChange(sel);
      }
      this.drag = { kind: 'move', startW: w, startS: s, ids: new Set(sel), scene: p.scene, moved: false, clickId: id, wasSelected, additive, last: null };
    } else {
      this.drag = { kind: 'marquee', a: w, b: w, startS: s, additive, base: additive ? p.selection : [], last: '' };
      this.ui.marquee = { a: w, b: w };
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.fresh();
    const s = this.local(e);
    const w = this.toWorld(s);
    p.onCursor?.(w);
    const d = this.drag;
    if (p.tool === 'measure' && (!d || d.kind === 'measure')) {
      let sp = this.measureSnap(w, e, p);
      const pend = this.measurePending;
      if (pend && pend.kind === 'distance' && pend.points.length === 1 && e.shiftKey && sp.kind === 'free') {
        // Shift while measuring a distance: constrain to 15 degree steps
        const a = pend.points[0];
        const L = dist(a, w), ang = Math.round(Math.atan2(w.y - a.y, w.x - a.x) / ROT_SNAP) * ROT_SNAP;
        sp = { p: { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }, kind: 'free' };
      }
      this.measureCursor = sp;
      if (!d) { this.hover = null; this.ui.hoverHandle = null; this.updateCursor(); }
      return;
    }
    if (!d) {
      if (p.tool === 'select' && !this.spaceDown) {
        const hd = this.handleAt(s, p);
        this.ui.hoverHandle = hd ? (hd.kind === 'rotate' ? 'rotate' : hd.key) : null;
        this.hover = hd ? null : hitTest(w, p.scene.components, this.geoms, 5 / p.view.zoom);
        this.updateCursor(hd ? 'handle' : this.hover ? 'comp' : undefined);
        this.updateTip(s, w, p);
      } else {
        this.tip.hide();
        this.hover = null; this.ui.hoverHandle = null;
        this.updateCursor();
      }
      return;
    }
    switch (d.kind) {
      case 'pan': {
        const z = d.view.zoom;
        p.onViewChange({ zoom: z, cx: d.view.cx - (s.x - d.start.x) / z, cy: d.view.cy - (s.y - d.start.y) / z });
        break;
      }
      case 'move': {
        if (!d.moved && dist(s, d.startS) < 3) return;
        d.moved = true;
        this.updateCursor();
        const dx = w.x - d.startW.x, dy = w.y - d.startW.y;
        const next = this.moveComponents(d.scene, d.ids, (c) => ({
          x: this.snapV(c.position.x + dx, e) - c.position.x,
          y: this.snapV(c.position.y + dy, e) - c.position.y,
        }));
        d.last = next;
        p.onSceneChange(next, { commit: false });
        break;
      }
      case 'marquee': {
        d.b = w;
        this.ui.marquee = { a: d.a, b: w };
        const r = { min: { x: Math.min(d.a.x, w.x), y: Math.min(d.a.y, w.y) }, max: { x: Math.max(d.a.x, w.x), y: Math.max(d.a.y, w.y) } };
        const ids = new Set(d.base);
        for (const c of p.scene.components) {
          const g = this.geoms.get(c.id);
          if (g && rectsIntersect(r, g.bounds)) ids.add(c.id);
        }
        const list = [...ids];
        const key = list.join('|');
        if (key !== d.last) { d.last = key; p.onSelectionChange(list); }
        break;
      }
      case 'rotate': {
        const a = Math.atan2(w.y - d.center.y, w.x - d.center.x);
        let r = d.r0 + (a - d.a0);
        if (e.shiftKey) r = Math.round(r / ROT_SNAP) * ROT_SNAP;
        r = Math.atan2(Math.sin(r), Math.cos(r));
        const next: OpticsScene = { ...d.scene, components: d.scene.components.map((c) => (c.id === d.id ? { ...c, rotation: r } : c)) };
        d.last = next;
        this.ui.rotating = { id: d.id, angle: r };
        p.onSceneChange(next, { commit: false });
        break;
      }
      case 'handle': {
        const x = this.snapV(w.x, e), y = this.snapV(w.y, e);
        const next: OpticsScene = {
          ...d.scene,
          components: d.scene.components.map((c) => (c.id === d.id ? { ...c, props: { ...c.props, [`${d.key}X`]: x, [`${d.key}Y`]: y } } : c)),
        };
        d.last = next;
        p.onSceneChange(next, { commit: false });
        break;
      }
      case 'measure':
        break;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.getProps();
    // apply the final pointer position (some input sources skip the last pointermove)
    if (this.drag && e.type === 'pointerup') this.onPointerMove(e);
    const d = this.drag;
    this.drag = null;
    if (this.wrap.hasPointerCapture(e.pointerId)) this.wrap.releasePointerCapture(e.pointerId);
    if (!d) return;
    switch (d.kind) {
      case 'move': {
        if (d.moved && d.last) {
          const moving = d.scene.components.filter((c) => d.ids.has(c.id) && !c.locked);
          const label = moving.length === 1 ? `Move ${this.compName(moving[0])}` : `Move ${moving.length} components`;
          p.onSceneChange(d.last, { commit: true, label });
        } else if (!d.moved && !d.additive && d.wasSelected && p.selection.length > 1) {
          p.onSelectionChange([d.clickId]);
        }
        break;
      }
      case 'marquee': {
        const s = this.local(e);
        if (dist(s, d.startS) < 3 && !d.additive && p.selection.length) p.onSelectionChange([]);
        this.ui.marquee = null;
        break;
      }
      case 'rotate': {
        this.ui.rotating = null;
        if (d.last) {
          const c = d.scene.components.find((x) => x.id === d.id);
          p.onSceneChange(d.last, { commit: true, label: `Rotate ${c ? this.compName(c) : ''}`.trim() });
        }
        break;
      }
      case 'handle': {
        if (d.last) {
          const c = d.scene.components.find((x) => x.id === d.id);
          p.onSceneChange(d.last, { commit: true, label: `Edit ${c ? this.compName(c) : ''} ${d.key}`.trim() });
        }
        break;
      }
      case 'measure': {
        // press-drag-release measures a distance in one gesture
        const m = this.measurePending;
        if (m && m.kind === 'distance' && m.points.length === 1 && dist(this.local(e), d.downS) > 4 && this.measureCursor) {
          m.points.push(this.measureCursor.p);
          this.finishMeasure(p);
        }
        break;
      }
    }
    this.updateCursor();
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const p = this.fresh();
    const w = this.toWorld(this.local(e));
    const id = hitTest(w, p.scene.components, this.geoms, 5 / p.view.zoom);
    if (id && !p.selection.includes(id)) p.onSelectionChange([id]);
    p.onContextMenu?.(id, { x: e.clientX, y: e.clientY });
  };

  // ------------------------------------------------------------------ keyboard
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && t !== this.wrap && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    const p = this.getProps();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); }
      return;
    }
    if (e.key === 'Escape') {
      // consume Esc only when it cancels something of ours; otherwise let the shell handle it (tool reset / deselect)
      const consumed = !!this.drag || !!this.ui.measure || !!this.measurePending;
      this.measurePending = null;
      this.tip.hide();
      // a no-op commit of the original scene ends the store's preview without an undo step
      if (this.drag && 'scene' in this.drag && this.drag.last) p.onSceneChange(this.drag.scene, { commit: true });
      if (this.drag?.kind === 'marquee' && !this.drag.additive) p.onSelectionChange(this.drag.base);
      this.drag = null; this.ui.marquee = null; this.ui.rotating = null; this.ui.measure = null;
      if (consumed) { e.preventDefault(); e.stopPropagation(); this.updateCursor(); }
      return;
    }
    const arrows: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const a = arrows[e.key];
    if (a && p.selection.length && !this.drag) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const next = this.moveComponents(p.scene, new Set(p.selection), () => ({ x: a.x * step, y: a.y * step }));
      if (next.components.some((c, i) => c !== p.scene.components[i])) p.onSceneChange(next, { commit: true, label: 'Nudge' });
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' && this.spaceDown) { this.spaceDown = false; this.updateCursor(); }
  };
  private onBlur = () => { this.spaceDown = false; };

  // ------------------------------------------------------------------ palette drop
  private onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).includes(PALETTE_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      this.getProps().onCursor?.(this.toWorld(this.local(e)));
    }
  };
  private onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer?.getData(PALETTE_DND_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: PaletteDragPayload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || payload.domain !== 'optics' || typeof payload.type !== 'string') return;
    this.wrap.focus({ preventScroll: true });
    this.place(payload.type, this.toWorld(this.local(e)), e);
  };

  get isPointerInside(): boolean { return this.pointerInside; }
}
