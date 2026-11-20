/**
 * Measurement overlays for the optics bench: hover tooltips (beams, components, detectors),
 * persistent measure annotations with snapping, and the optional "beam info" labels.
 */
import type { ComponentDef, ComponentGeometry, DetectorReading, OpticalComponent, OpticsEngineAPI, RaySegment, TraceResult, Vec2, ViewState } from '@core/types';
import type { MeasureAnnotation } from '../contracts';
import { SegmentGrid } from '../../lib/beamIndex';
import { formatSI } from '../../lib/units';
import { spectrumPeak, screenCentroid } from '../../lib/sweep';
import { chip, drawMeasure } from './overlay';
import { closestOnSegment, dist, pointInPolygon, worldToScreen } from './math';
import { safeRGB } from './style';

const FONT = '11px Tahoma, Verdana, "Segoe UI", sans-serif';
const DEG = 180 / Math.PI;

import { HoverTip, type TipContent, type TipRow } from '../../lib/hoverTip';
export { HoverTip, type TipContent, type TipRow };


// ---------------------------------------------------------------------------
// Tooltip content
// ---------------------------------------------------------------------------

export function rgbCssOf(rgb: [number, number, number]): string {
  // normalise to full brightness so dim (deep violet / IR-edge) colours still read as a hue
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
  const k = 1 / m;
  return `rgb(${Math.round(255 * Math.min(1, rgb[0] * k))},${Math.round(255 * Math.min(1, rgb[1] * k))},${Math.round(255 * Math.min(1, rgb[2] * k))})`;
}

export function dBm(w: number): string {
  if (!(w > 0)) return '−∞ dBm';
  return `${(10 * Math.log10(w / 1e-3)).toFixed(1).replace('-', '−')} dBm`;
}

function fmtTime(t: number): string {
  return formatSI(t, 's', 4);
}

export interface InfoCtx {
  engine: OpticsEngineAPI;
  components: OpticalComponent[];
  geoms: Map<string, ComponentGeometry>;
  labels: Map<string, string>;
  defs: Map<string, ComponentDef>;
  ambient: string;
}

const compName = (ctx: InfoCtx, c: OpticalComponent): string => c.name || ctx.labels.get(c.type) || c.type;

function materialLabel(ctx: InfoCtx, id: string | undefined): string {
  if (!id) return '—';
  return ctx.engine.materials?.find((m) => m.id === id)?.label ?? id;
}

/** Medium a point is in: glass body of a component containing it, else the ambient medium. */
export function mediumAt(ctx: InfoCtx, p: Vec2, seg: RaySegment): string {
  if (seg.inMedium) {
    for (let i = ctx.components.length - 1; i >= 0; i--) {
      const c = ctx.components[i];
      const g = ctx.geoms.get(c.id);
      if (!g || p.x < g.bounds.min.x || p.x > g.bounds.max.x || p.y < g.bounds.min.y || p.y > g.bounds.max.y) continue;
      if (g.paths.some((pt) => pt.closed && pt.points.length > 2 && (pt.role === 'body' || pt.role === 'surface') && pointInPolygon(p, pt.points))) {
        const mat = typeof c.props.material === 'string' ? c.props.material : g.material;
        return `${materialLabel(ctx, mat)} (${compName(ctx, c)})`;
      }
    }
    return 'Medium (non-ambient)';
  }
  return materialLabel(ctx, ctx.ambient);
}

export function beamTip(ctx: InfoCtx, seg: RaySegment, at: Vec2): TipContent {
  const rgb = safeRGB(ctx.engine, seg.wavelength);
  const src = ctx.components.find((c) => c.id === seg.sourceId);
  const rows: TipRow[] = [
    { k: 'Wavelength', v: `${seg.wavelength.toFixed(1)} nm`, swatch: rgbCssOf(rgb) },
    { k: 'Power', v: `${formatSI(seg.power, 'W')}  (${dBm(seg.power)})` },
    {
      k: 'Polarization',
      v: seg.polDegree === undefined || seg.polAngle === undefined
        ? 'not tracked'
        : seg.polDegree < 0.02 ? 'unpolarized' : `${(seg.polAngle * DEG).toFixed(1)}°, ${(seg.polDegree * 100).toFixed(0)} % polarized`
    },
    { k: 'Interactions', v: String(seg.depth) },
    { k: 'Source', v: src ? compName(ctx, src) : seg.sourceId || '—' },
    { k: 'Medium', v: mediumAt(ctx, at, seg) }
  ];
  if (typeof seg.t0 === 'number' && typeof seg.t1 === 'number' && Number.isFinite(seg.t0) && Number.isFinite(seg.t1)) {
    rows.push({ k: 'Time of flight', v: `${fmtTime(seg.t0)} → ${fmtTime(seg.t1)}` });
  }
  return { title: 'Light beam', rows };
}

function fmtParam(v: unknown, unit: string | undefined, def: ComponentDef['params'][number]): string {
  if (typeof v === 'number') {
    if (def.kind === 'wavelength') return `${v.toFixed(1)} nm`;
    return unit ? formatSI(v, unit, 4) : formatSI(v, '', 4);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (def.kind === 'select') return def.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v ?? '—');
}

export function detectorRows(c: OpticalComponent, r: DetectorReading | undefined): TipRow[] {
  if (!r) return [{ k: 'Reading', v: 'no light' }];
  const rows: TipRow[] = [{ k: 'Power', v: `${formatSI(r.power, 'W')}  (${dBm(r.power)})` }];
  const pk = spectrumPeak(r);
  if (pk !== null) rows.push({ k: 'Spectrum peak', v: `${pk.toFixed(1)} nm` });
  if (typeof r.meanWavelength === 'number') rows.push({ k: 'Mean λ', v: `${r.meanWavelength.toFixed(2)} nm` });
  if (typeof r.linewidth === 'number') rows.push({ k: 'Linewidth', v: `${r.linewidth.toFixed(3)} nm` });
  const size = typeof c.props.size === 'number' ? c.props.size : 1;
  const cen = screenCentroid(r, size);
  if (cen !== null && r.profile && r.profile.length > 1) rows.push({ k: 'Centroid', v: `${cen.toFixed(2)} mm` });
  if (r.stokes) rows.push({ k: 'DOP / azimuth', v: `${(r.stokes.dop * 100).toFixed(0)} % / ${(r.stokes.azimuth * DEG).toFixed(1)}°` });
  if (typeof r.concentration === 'number') rows.push({ k: 'Concentration', v: `${r.concentration.toFixed(1)}×` });
  if (r.hits) rows.push({ k: 'Ray hits', v: String(r.hits.length) });
  return rows;
}

export function componentTip(ctx: InfoCtx, c: OpticalComponent, trace: TraceResult | null): TipContent {
  const def = ctx.defs.get(c.type);
  const rows: TipRow[] = [];
  const isDet = c.type.startsWith('detector.') || !!trace?.detectors?.[c.id];
  if (isDet) rows.push(...detectorRows(c, trace?.detectors?.[c.id]));
  else if (def) {
    for (const pd of def.params) {
      if (rows.length >= 4) break;
      if (pd.kind !== 'number' && pd.kind !== 'wavelength' && pd.kind !== 'select') continue;
      if (/^custom/i.test(pd.key) && c.props.material !== 'custom') continue;
      const v = c.props[pd.key] ?? pd.default;
      const sw = pd.kind === 'wavelength' && typeof v === 'number' ? rgbCssOf(safeRGB(ctx.engine, v)) : undefined;
      rows.push({ k: pd.label, v: fmtParam(v, pd.unit, pd), swatch: sw });
    }
  }
  rows.push({ k: 'Position', v: `${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)} mm  ∠ ${(c.rotation * DEG).toFixed(1)}°` });
  return { title: compName(ctx, c), sub: ctx.labels.get(c.type) ?? c.type, rows };
}

// ---------------------------------------------------------------------------
// Beam hit index (rebuilt lazily once per trace)
// ---------------------------------------------------------------------------

export class BeamPicker {
  private grid: SegmentGrid | null = null;
  private trace: TraceResult | null = null;
  private idle = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingTrace: TraceResult | null = null;

  /**
   * Build the index for `trace` in idle time once traces have been stable for 250 ms (no hitch on the
   * first hover after an edit; no wasted rebuilds while a co-simulation re-traces every frame).
   */
  prepare(trace: TraceResult | null): void {
    if (!trace || trace === this.trace || typeof requestIdleCallback !== 'function') return;
    this.pendingTrace = trace;
    if (this.timer) clearTimeout(this.timer);
    if (this.idle) { cancelIdleCallback(this.idle); this.idle = 0; }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.idle = requestIdleCallback(() => {
        this.idle = 0;
        const t = this.pendingTrace;
        this.pendingTrace = null;
        if (t && t !== this.trace && t.segments?.length) { this.trace = t; this.grid = new SegmentGrid(t.segments); }
      }, { timeout: 2000 });
    }, 250);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.idle) cancelIdleCallback(this.idle);
    this.timer = null; this.idle = 0; this.grid = null; this.trace = null; this.pendingTrace = null;
  }

  pick(trace: TraceResult | null, w: Vec2, tolMm: number): { seg: RaySegment; q: Vec2; index: number } | null {
    if (!trace || !trace.segments?.length) return null;
    if (trace !== this.trace || !this.grid) { this.trace = trace; this.grid = new SegmentGrid(trace.segments); }
    const segs = trace.segments;
    const h = this.grid.nearest(w, tolMm, (i) => segs[i].power > 0);
    return h ? { seg: segs[h.index], q: h.q, index: h.index } : null;
  }
}

// ---------------------------------------------------------------------------
// Snapping for the measure tool
// ---------------------------------------------------------------------------

export interface Snap { p: Vec2; kind: 'centre' | 'surface' | 'free'; id?: string }

export function snapPoint(w: Vec2, components: OpticalComponent[], geoms: Map<string, ComponentGeometry>, zoom: number, enabled: boolean): Snap {
  if (!enabled) return { p: w, kind: 'free' };
  const rc = 9 / zoom, rs = 6 / zoom;
  let best: Snap | null = null, bd = rc;
  for (const c of components) {
    const d = dist(c.position, w);
    if (d <= bd) { bd = d; best = { p: { ...c.position }, kind: 'centre', id: c.id }; }
  }
  if (best) return best;
  bd = rs;
  for (const c of components) {
    const g = geoms.get(c.id);
    if (!g) continue;
    const b = g.bounds;
    if (w.x < b.min.x - rs || w.x > b.max.x + rs || w.y < b.min.y - rs || w.y > b.max.y + rs) continue;
    for (const path of g.paths) {
      if (path.role === 'decor') continue;
      const pts = path.points, n = pts.length;
      const last = path.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const r = closestOnSegment(w, pts[i], pts[(i + 1) % n]);
        if (r.d <= bd) { bd = r.d; best = { p: r.q, kind: 'surface', id: c.id }; }
      }
    }
  }
  return best ?? { p: w, kind: 'free' };
}

// ---------------------------------------------------------------------------
// Drawing: annotations, pending measurement, snap marker
// ---------------------------------------------------------------------------

export function angleOf(pts: Vec2[]): number {
  const [a, v, b] = pts;
  const a1 = Math.atan2(a.y - v.y, a.x - v.x), a2 = Math.atan2(b.y - v.y, b.x - v.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d * DEG;
}

export function measureText(m: Pick<MeasureAnnotation, 'kind' | 'points'>): string {
  if (m.kind === 'angle') return m.points.length >= 3 ? `${angleOf(m.points).toFixed(2)}°` : '—';
  const [a, b] = m.points;
  if (!a || !b) return '—';
  const d = dist(a, b);
  return d >= 1000 ? `${(d / 1000).toFixed(4)} m` : `${d.toFixed(d < 10 ? 3 : 2)} mm`;
}

function drawAngle(ctx: CanvasRenderingContext2D, pts: Vec2[], view: ViewState, w: number, h: number, selected: boolean) {
  const S = pts.map((p) => worldToScreen(p, view, w, h));
  ctx.save();
  ctx.lineCap = 'butt';
  const path = () => { ctx.beginPath(); ctx.moveTo(S[0].x, S[0].y); ctx.lineTo(S[1].x, S[1].y); if (S[2]) ctx.lineTo(S[2].x, S[2].y); };
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 3; path(); ctx.stroke();
  ctx.strokeStyle = selected ? '#ffff00' : '#ffffff'; ctx.lineWidth = 1; path(); ctx.stroke();
  for (const p of S) { ctx.fillStyle = '#000'; ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3); }
  if (S[2]) {
    const a1 = Math.atan2(S[0].y - S[1].y, S[0].x - S[1].x), a2 = Math.atan2(S[2].y - S[1].y, S[2].x - S[1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const r = Math.max(14, Math.min(40, Math.min(dist(S[0], S[1]), dist(S[2], S[1])) * 0.4));
    ctx.beginPath(); ctx.arc(S[1].x, S[1].y, r, a1, a1 + d, d < 0);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = selected ? '#ffff00' : '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
    const mid = a1 + d / 2;
    ctx.restore();
    chip(ctx, `${angleOf(pts).toFixed(1)}°`, S[1].x + Math.cos(mid) * (r + 18), S[1].y + Math.sin(mid) * (r + 12), selected);
    return;
  }
  ctx.restore();
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D, list: MeasureAnnotation[], selected: string | null | undefined,
  pending: { kind: 'distance' | 'angle'; points: Vec2[] } | null, snap: Snap | null,
  view: ViewState, w: number, h: number
): void {
  for (const m of list) {
    const sel = m.id === selected;
    if (m.kind === 'distance' && m.points.length >= 2) drawMeasure(ctx, { a: m.points[0], b: m.points[1] }, view, w, h, sel);
    else if (m.kind === 'angle' && m.points.length >= 3) drawAngle(ctx, m.points, view, w, h, sel);
  }
  if (pending && pending.points.length) {
    if (pending.kind === 'distance' && pending.points.length >= 2) drawMeasure(ctx, { a: pending.points[0], b: pending.points[1] }, view, w, h);
    else drawAngle(ctx, pending.points, view, w, h, false);
  }
  if (snap && snap.kind !== 'free') {
    const s = worldToScreen(snap.p, view, w, h);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000'; ctx.fillStyle = snap.kind === 'centre' ? '#ffff00' : '#00ffff';
    if (snap.kind === 'centre') { ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 9, 9); ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 8, 8); }
    else { ctx.beginPath(); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y); ctx.lineTo(s.x, s.y + 5); ctx.lineTo(s.x - 5, s.y); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Beam info overlay: power & λ labels on beams leaving each component
// ---------------------------------------------------------------------------

export interface BeamLabel { compId: string; a: Vec2; dir: Vec2; len: number; power: number; wlMin: number; wlMax: number; wlMean: number }

const insideBox = (p: Vec2, g: ComponentGeometry, pad: number): boolean =>
  p.x >= g.bounds.min.x - pad && p.x <= g.bounds.max.x + pad && p.y >= g.bounds.min.y - pad && p.y <= g.bounds.max.y + pad;

export function computeBeamLabels(trace: TraceResult | null, components: OpticalComponent[], geoms: Map<string, ComponentGeometry>, max = 40): BeamLabel[] {
  if (!trace?.segments?.length) return [];
  const boxes = components.map((c) => ({ c, g: geoms.get(c.id) })).filter((x): x is { c: OpticalComponent; g: ComponentGeometry } => !!x.g);
  boxes.sort((a, b) => area(a.g) - area(b.g)); // smallest first: most specific owner
  const groups = new Map<string, BeamLabel & { wsum: number }>();
  const BUCKET = (8 * Math.PI) / 180;
  for (const s of trace.segments) {
    if (!(s.power > 0)) continue;
    const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (L < 1e-6) continue;
    const owner = boxes.find((x) => insideBox(s.a, x.g, 0.5));
    if (!owner || insideBox(s.b, owner.g, 0.5)) continue;
    const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    const k = `${owner.c.id}|${Math.round(ang / BUCKET)}`;
    let g = groups.get(k);
    if (!g) {
      g = { compId: owner.c.id, a: s.a, dir: { x: (s.b.x - s.a.x) / L, y: (s.b.y - s.a.y) / L }, len: L, power: 0, wlMin: Infinity, wlMax: -Infinity, wlMean: 0, wsum: 0 };
      groups.set(k, g);
    }
    g.power += s.power;
    g.wlMin = Math.min(g.wlMin, s.wavelength); g.wlMax = Math.max(g.wlMax, s.wavelength);
    g.wlMean += s.wavelength * s.power; g.wsum += s.power;
    if (s.power > 0 && L > g.len * 0.5 && s.power * 2 > g.power) { g.a = s.a; g.len = L; }
  }
  const list = [...groups.values()].map(({ wsum, ...g }) => ({ ...g, wlMean: wsum > 0 ? g.wlMean / wsum : g.wlMin }));
  const top = list.reduce((m, g) => Math.max(m, g.power), 0);
  return list.filter((g) => g.power >= top * 1e-4).sort((a, b) => b.power - a.power).slice(0, max);
}

function area(g: ComponentGeometry): number {
  return Math.max(1e-6, (g.bounds.max.x - g.bounds.min.x) * (g.bounds.max.y - g.bounds.min.y));
}

export function drawBeamLabels(ctx: CanvasRenderingContext2D, labels: BeamLabel[], engine: OpticsEngineAPI, view: ViewState, w: number, h: number): void {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const placed: { x: number; y: number; w: number }[] = [];
  for (const l of labels) {
    const dPx = Math.min(l.len * view.zoom * 0.5, 46);
    const a = worldToScreen(l.a, view, w, h);
    const x = a.x + l.dir.x * dPx, y = a.y + l.dir.y * dPx;
    if (x < -40 || y < -10 || x > w + 40 || y > h + 10) continue;
    const wl = l.wlMax - l.wlMin > 2 ? `${l.wlMin.toFixed(0)}–${l.wlMax.toFixed(0)} nm` : `${l.wlMean.toFixed(1)} nm`;
    const text = `${formatSI(l.power, 'W', 3)} · ${wl}`;
    const tw = Math.ceil(ctx.measureText(text).width) + 18;
    const X = Math.round(x + 4), Y = Math.round(y - 8);
    if (placed.some((p) => Math.abs(p.y - Y) < 16 && X < p.x + p.w && X + tw > p.x)) continue;
    placed.push({ x: X, y: Y, w: tw });
    ctx.fillStyle = 'rgba(16,18,20,0.88)';
    ctx.fillRect(X, Y, tw, 16);
    ctx.strokeStyle = 'rgba(200,200,200,0.55)'; ctx.lineWidth = 1;
    ctx.strokeRect(X + 0.5, Y + 0.5, tw - 1, 15);
    if (l.wlMax - l.wlMin > 40) {
      // broadband: tiny spectrum swatch
      const gr = ctx.createLinearGradient(X + 4, 0, X + 12, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, rgbCssOf(safeRGB(engine, l.wlMin + ((l.wlMax - l.wlMin) * i) / 6)));
      ctx.fillStyle = gr;
    } else ctx.fillStyle = rgbCssOf(safeRGB(engine, l.wlMean));
    ctx.fillRect(X + 4, Y + 4, 8, 8);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText(text, X + 15, Y + 8.5);
    // leader tick from the beam to the label
    ctx.strokeStyle = 'rgba(232,232,232,0.6)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(X, Y + 8); ctx.stroke();
  }
}
