/**
 * Canvas2D layer drawn on top of the WebGL light layer: component bodies (except glass fills,
 * which live in WebGL so light shines "through" them), glass rims/highlights, selection,
 * handles, labels, link badges, normals, polarization ticks, marquee and measure ruler.
 */
import type { ComponentGeometry, OpticalComponent, OpticsEngineAPI, TraceResult, Vec2, ViewState } from '@core/types';
import type { LightData } from './lightData';
import type { NormalMark } from './analysis';
import { classifyPath, fiberJacket, glassTint, type GeomPath, safeRGB } from './style';
import { rotate, worldToScreen } from './math';

export interface OverlayUI {
  marquee?: { a: Vec2; b: Vec2 } | null;
  measure?: { a: Vec2; b: Vec2 } | null;
  rotating?: { id: string; angle: number } | null;
  hoverHandle?: string | null;  // 'rotate' | handle key
}

export interface OverlayState {
  ctx: CanvasRenderingContext2D;
  w: number; h: number; dpr: number;
  view: ViewState;
  time: number;
  engine: OpticsEngineAPI;
  components: OpticalComponent[];
  geoms: Map<string, ComponentGeometry>;
  labels: Map<string, string>;
  selection: Set<string>;
  hover: string | null;
  linkedIds: Set<string>;
  display: { showNormals: boolean; showPolarization: boolean; rayOpacity: number };
  light: LightData | null;
  trace: TraceResult | null;
  mirrorFronts: Map<string, number>;
  normals: NormalMark[];
  ui: OverlayUI;
  /** Optional painter run right after clearing (used for the no-WebGL fallback). */
  underlay?: (ctx: CanvasRenderingContext2D) => void;
  /** Optional painter run last, in screen (CSS px) space: measurements, beam labels. */
  post?: (ctx: CanvasRenderingContext2D) => void;
}

const FONT = '11px Tahoma, Verdana, "Segoe UI", sans-serif';

let noisePattern: CanvasPattern | null = null;
function getNoise(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (noisePattern) return noisePattern;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  const img = g.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 18;
  }
  g.putImageData(img, 0, 0);
  noisePattern = ctx.createPattern(c, 'repeat');
  return noisePattern;
}

function pathTo(ctx: CanvasRenderingContext2D, pts: Vec2[], closed: boolean) {
  ctx.beginPath();
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (closed) ctx.closePath();
}

const rgba = (c: [number, number, number], a: number, k = 255) =>
  `rgba(${Math.round(Math.min(1, c[0]) * k)},${Math.round(Math.min(1, c[1]) * k)},${Math.round(Math.min(1, c[2]) * k)},${a})`;

/** Furthest geometry point from the component origin (rotation invariant radius). */
export function componentRadius(c: OpticalComponent, g: ComponentGeometry | undefined): number {
  let r = 4;
  if (!g) return r;
  for (const p of g.paths) for (const q of p.points) r = Math.max(r, Math.hypot(q.x - c.position.x, q.y - c.position.y));
  return r;
}

/** Rotation knob position in world mm (above the component in its local frame). */
export function rotationKnob(c: OpticalComponent, g: ComponentGeometry | undefined, zoom: number): Vec2 {
  const R = componentRadius(c, g) + 26 / zoom;
  const up = rotate({ x: 0, y: -1 }, c.rotation);
  return { x: c.position.x + up.x * R, y: c.position.y + up.y * R };
}

export function drawOverlay(s: OverlayState): void {
  const { ctx, w, h, dpr, view } = s;
  const z = view.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  if (s.underlay) { ctx.save(); s.underlay(ctx); ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  const setWorld = () => ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - view.cx * z), dpr * (h / 2 - view.cy * z));
  const setScreen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = (n: number) => n / z; // css px -> mm

  // visible world rect for culling
  const vmin = { x: view.cx - w / 2 / z, y: view.cy - h / 2 / z };
  const vmax = { x: view.cx + w / 2 / z, y: view.cy + h / 2 / z };

  setWorld();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---------------- components ----------------
  for (const c of s.components) {
    const g = s.geoms.get(c.id);
    if (!g) continue;
    const b = g.bounds;
    if (b.max.x < vmin.x - 20 || b.min.x > vmax.x + 20 || b.max.y < vmin.y - 20 || b.min.y > vmax.y + 20) continue;
    if (!g.paths.length) {
      ctx.strokeStyle = 'rgba(150,165,190,0.6)'; ctx.lineWidth = px(1);
      ctx.setLineDash([px(3), px(3)]);
      ctx.beginPath(); ctx.arc(c.position.x, c.position.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(c.position.x - 3, c.position.y); ctx.lineTo(c.position.x + 3, c.position.y);
      ctx.moveTo(c.position.x, c.position.y - 3); ctx.lineTo(c.position.x, c.position.y + 3); ctx.stroke();
      continue;
    }
    // draw order inside a component: housings/backings first, then faces / metal, then glass rims
    const order: GeomPath[] = [...g.paths].sort((p1, p2) => rank(classifyPath(c, g, p1)) - rank(classifyPath(c, g, p2)));
    for (const p of order) {
      const look = classifyPath(c, g, p);
      const pi = g.paths.indexOf(p);
      switch (look) {
        case 'glass': drawGlassRim(s, c, g, p, px); break;
        case 'surface': drawSurface(s, c, g, p, px); break;
        case 'metal': drawMetal(s, c, p, s.mirrorFronts.get(`${c.id}:${pi}`) ?? 1, px); break;
        case 'black': drawBlack(ctx, p, px); break;
        case 'blade': drawBlade(ctx, p, px); break;
        case 'sensor': drawSensor(ctx, p, px); break;
        case 'face': drawFace(s, c, p, px); break;
        case 'housing': drawHousing(s, c, p, px); break;
        case 'fiber': drawFiber(s, c, g, p, px); break;
        default: {
          pathTo(ctx, p.points, p.closed);
          ctx.strokeStyle = 'rgba(150,162,180,0.55)'; ctx.lineWidth = px(1); ctx.stroke();
        }
      }
    }
  }

  // ---------------- normals ----------------
  if (s.display.showNormals && s.normals.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,214,120,0.75)';
    ctx.lineWidth = px(1);
    ctx.setLineDash([px(3), px(2.5)]);
    ctx.beginPath();
    const L = px(16);
    for (const m of s.normals) {
      if (m.p.x < vmin.x || m.p.x > vmax.x || m.p.y < vmin.y || m.p.y > vmax.y) continue;
      ctx.moveTo(m.p.x - m.n.x * L, m.p.y - m.n.y * L);
      ctx.lineTo(m.p.x + m.n.x * L, m.p.y + m.n.y * L);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- polarization ticks ----------------
  if (s.display.showPolarization && s.trace) drawPolarization(s, vmin, vmax);

  // ---------------- selection & hover (classic CAD: crisp 1px, no glow) ----------------
  for (const c of s.components) {
    const sel = s.selection.has(c.id);
    const hov = s.hover === c.id && !sel;
    if (!sel && !hov) continue;
    const g = s.geoms.get(c.id);
    if (!g) continue;
    ctx.lineWidth = px(1);
    ctx.lineCap = 'butt';
    for (const p of g.paths) {
      if (p.role === 'decor' && c.type.startsWith('fiber') && !sel) continue;
      pathTo(ctx, p.points, p.closed);
      if (sel) {
        ctx.setLineDash([]); ctx.strokeStyle = NAVY; ctx.stroke();
        ctx.setLineDash([px(3), px(3)]); ctx.strokeStyle = '#ffffff'; ctx.stroke();
      } else {
        ctx.setLineDash([px(1), px(2)]); ctx.strokeStyle = 'rgba(220,224,230,0.7)'; ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    if (sel) {
      // dashed bounding box + 8 small square grab handles
      setScreen();
      const a = worldToScreen(g.bounds.min, view, w, h), bb = worldToScreen(g.bounds.max, view, w, h);
      const m = 5;
      const x0 = Math.round(a.x - m) + 0.5, y0 = Math.round(a.y - m) + 0.5, x1 = Math.round(bb.x + m) + 0.5, y1 = Math.round(bb.y + m) + 0.5;
      ctx.lineWidth = 1;
      ctx.strokeStyle = NAVY; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([2, 2]); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      for (const [hx, hy] of [[x0, y0], [xm, y0], [x1, y0], [x1, ym], [x1, y1], [xm, y1], [x0, y1], [x0, ym]]) squareHandle(ctx, hx, hy, 2.5, false);
      setWorld();
    }
  }

  // ---------------- screen-space annotations ----------------
  setScreen();
  ctx.textBaseline = 'middle';

  // labels: small light text on a dark flat chip
  if (z >= 1.4) {
    ctx.font = FONT;
    ctx.textAlign = 'center';
    for (const c of s.components) {
      const g = s.geoms.get(c.id);
      if (!g) continue;
      const label = c.name || s.labels.get(c.type) || c.type;
      const p = worldToScreen({ x: (g.bounds.min.x + g.bounds.max.x) / 2, y: g.bounds.max.y }, view, w, h);
      if (p.x < -100 || p.x > w + 100 || p.y < -40 || p.y > h + 40) continue;
      const sel = s.selection.has(c.id);
      const tw = Math.ceil(ctx.measureText(label).width) + (c.locked ? 12 : 0);
      const cx = Math.round(p.x), y = Math.round(p.y + 14);
      const bx = cx - Math.ceil(tw / 2) - 4;
      ctx.fillStyle = sel ? NAVY : 'rgba(30,33,37,0.92)';
      ctx.fillRect(bx, y - 8, tw + 8, 16);
      ctx.strokeStyle = sel ? '#ffffff' : 'rgba(90,96,104,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, y - 7.5, tw + 7, 15);
      ctx.fillStyle = sel ? '#ffffff' : '#d8dadd';
      ctx.fillText(label, cx - (c.locked ? 6 : 0), y + 0.5);
      if (c.locked) drawLock(ctx, bx + tw + 1, y);
    }
  }

  // link badges
  for (const id of s.linkedIds) {
    const g = s.geoms.get(id);
    if (!g) continue;
    const p = worldToScreen({ x: g.bounds.max.x, y: g.bounds.min.y }, view, w, h);
    drawLinkBadge(ctx, Math.round(p.x + 8), Math.round(p.y - 8));
  }

  // handles for a single selection
  const selected = s.components.filter((c) => s.selection.has(c.id));
  if (selected.length === 1 && !selected[0].locked) {
    const c = selected[0];
    const g = s.geoms.get(c.id);
    const k = worldToScreen(rotationKnob(c, g, z), view, w, h);
    const o = worldToScreen(c.position, view, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(k.x, k.y); ctx.stroke();
    ctx.setLineDash([]);
    const hot = s.ui.hoverHandle === 'rotate' || s.ui.rotating?.id === c.id;
    squareHandle(ctx, k.x, k.y, 3.5, hot, true);
    // origin cross
    const ox = Math.round(o.x) + 0.5, oy = Math.round(o.y) + 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(ox - 4.5, oy); ctx.lineTo(ox + 4.5, oy);
    ctx.moveTo(ox, oy - 4.5); ctx.lineTo(ox, oy + 4.5);
    ctx.stroke();
    if (s.ui.rotating?.id === c.id) {
      const deg = ((((c.rotation * 180) / Math.PI) % 360) + 360) % 360;
      chip(ctx, `${deg.toFixed(1)}°`, k.x, k.y - 16);
    }
    for (const hd of g?.handles ?? []) {
      const p = worldToScreen(hd.p, view, w, h);
      squareHandle(ctx, p.x, p.y, 3.5, s.ui.hoverHandle === hd.key);
    }
  }

  // marquee: classic dotted navy/white rubber band
  const mq = s.ui.marquee;
  if (mq) {
    const a = worldToScreen(mq.a, view, w, h), b = worldToScreen(mq.b, view, w, h);
    const x = Math.round(Math.min(a.x, b.x)) + 0.5, y = Math.round(Math.min(a.y, b.y)) + 0.5;
    const mw = Math.round(Math.abs(a.x - b.x)), mh = Math.round(Math.abs(a.y - b.y));
    ctx.fillStyle = 'rgba(0,0,128,0.12)';
    ctx.fillRect(x, y, mw, mh);
    ctx.lineWidth = 1;
    ctx.strokeStyle = NAVY; ctx.strokeRect(x, y, mw, mh);
    ctx.setLineDash([1, 1]); ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x, y, mw, mh);
    ctx.setLineDash([]);
  }

  // measure ruler
  if (s.ui.measure) drawMeasure(ctx, s.ui.measure, view, w, h);
  if (s.post) { setScreen(); ctx.save(); s.post(ctx); ctx.restore(); }
}

const NAVY = '#000080';

/** Classic small square grab handle (white fill, navy border; hot = navy fill). */
function squareHandle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hot: boolean, rotate = false) {
  const S = Math.round(2 * r);
  const X = Math.round(x - r) + 0.5, Y = Math.round(y - r) + 0.5;
  ctx.fillStyle = hot ? NAVY : rotate ? '#c0c0c0' : '#ffffff';
  ctx.fillRect(X, Y, S, S);
  ctx.lineWidth = 1;
  ctx.strokeStyle = hot ? '#ffffff' : NAVY;
  ctx.strokeRect(X, Y, S, S);
}

function rank(l: string): number {
  switch (l) {
    case 'housing': case 'sensor': case 'black': return 0;
    case 'fiber': case 'decor': return 1;
    case 'blade': return 2;
    case 'metal': return 3;
    case 'glass': return 4;
    case 'surface': return 5;
    case 'face': return 6;
    default: return 7;
  }
}

// ---------------------------------------------------------------------------------------
function drawGlassRim(s: OverlayState, c: OpticalComponent, g: ComponentGeometry, p: GeomPath, px: (n: number) => number) {
  const { ctx } = s;
  const tint = glassTint(c, g.material, s.engine);
  // clean glass: one faint inner band + a crisp 1px edge
  ctx.save();
  pathTo(ctx, p.points, true);
  ctx.clip();
  pathTo(ctx, p.points, true);
  ctx.strokeStyle = rgba(tint, 0.14); ctx.lineWidth = px(3); ctx.stroke();
  ctx.restore();
  pathTo(ctx, p.points, true);
  ctx.strokeStyle = rgba([0.55 + 0.45 * tint[0], 0.6 + 0.4 * tint[1], 0.65 + 0.35 * tint[2]], 0.8);
  ctx.lineWidth = px(1);
  ctx.stroke();
}

function drawSurface(s: OverlayState, c: OpticalComponent, g: ComponentGeometry, p: GeomPath, px: (n: number) => number) {
  const { ctx } = s;
  const tint = glassTint(c, g.material, s.engine);
  pathTo(ctx, p.points, p.closed);
  ctx.strokeStyle = rgba(tint, 0.22); ctx.lineWidth = px(4); ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (c.type.startsWith('grating') && p.points.length >= 2) {
    // iridescent grooves
    const a = p.points[0], b = p.points[p.points.length - 1];
    const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    const ph = 0;
    for (let i = 0; i <= 6; i++) {
      const hue = ((i / 6 + ph) * 360) % 360;
      gr.addColorStop(i / 6, `hsla(${hue},90%,62%,0.55)`);
    }
    ctx.strokeStyle = gr; ctx.lineWidth = px(2.2);
    pathTo(ctx, p.points, p.closed); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(215,240,255,0.7)'; ctx.lineWidth = px(1);
  pathTo(ctx, p.points, p.closed); ctx.stroke();
  ctx.restore();
}

function offsetPolyline(pts: Vec2[], d: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    out.push({ x: pts[i].x + (-dy / l) * d, y: pts[i].y + (dx / l) * d });
  }
  return out;
}

function drawMetal(s: OverlayState, c: OpticalComponent, p: GeomPath, front: number, px: (n: number) => number) {
  const { ctx } = s;
  const pts = p.points;
  if (pts.length < 2) return;
  const dichroic = c.type === 'mirror.dichroic';
  if (p.closed) {
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const gr = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    gr.addColorStop(0, '#6d7684'); gr.addColorStop(0.45, '#e8edf3'); gr.addColorStop(0.55, '#b9c1cb'); gr.addColorStop(1, '#5d6571');
    pathTo(ctx, pts, true); ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = px(0.8); ctx.stroke();
    return;
  }
  // backing (behind the reflective face) with hatch
  const thick = Math.max(px(4), 1.4);
  const back = offsetPolyline(pts, -front * thick);
  const poly = [...pts, ...back.reverse()];
  ctx.save();
  pathTo(ctx, poly, true);
  ctx.fillStyle = '#13161b';
  ctx.fill();
  ctx.clip();
  const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const step = Math.max(px(4), 0.9);
  ctx.beginPath();
  for (let x = x0 - (y1 - y0); x < x1; x += step) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
  ctx.strokeStyle = 'rgba(160,175,195,0.16)';
  ctx.lineWidth = px(1);
  ctx.stroke();
  ctx.restore();
  pathTo(ctx, poly, true);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = px(1); ctx.stroke();
  // polished face
  const a = pts[0], b = pts[pts.length - 1];
  const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  if (dichroic) {
    gr.addColorStop(0, '#5a7cff'); gr.addColorStop(0.3, '#c58cff'); gr.addColorStop(0.5, '#f5f0ff'); gr.addColorStop(0.7, '#6fe3ff'); gr.addColorStop(1, '#4e6cff');
  } else {
    gr.addColorStop(0, '#7a8390'); gr.addColorStop(0.32, '#dfe5ec'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(0.68, '#aeb6c0'); gr.addColorStop(1, '#6c7480');
  }
  pathTo(ctx, pts, false);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = gr; ctx.lineWidth = Math.max(px(2.6), 0.6); ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const hl = offsetPolyline(pts, front * Math.max(px(0.6), 0.15));
  pathTo(ctx, hl, false);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = px(0.8); ctx.stroke();
  ctx.restore();
  ctx.lineCap = 'round';
}

function drawBlack(ctx: CanvasRenderingContext2D, p: GeomPath, px: (n: number) => number) {
  if (!p.closed) {
    pathTo(ctx, p.points, false);
    ctx.strokeStyle = '#060709'; ctx.lineWidth = Math.max(px(4), 1.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = px(1); ctx.stroke();
    return;
  }
  pathTo(ctx, p.points, true);
  ctx.fillStyle = '#07080b'; ctx.fill();
  const pat = getNoise(ctx);
  if (pat) {
    ctx.save();
    pat.setTransform(new DOMMatrix().scale(px(1), px(1)));
    ctx.fillStyle = pat; ctx.fill();
    ctx.restore();
  }
  const xs = p.points.map((q) => q.x), ys = p.points.map((q) => q.y);
  const gr = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  gr.addColorStop(0, 'rgba(120,135,160,0.10)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gr; ctx.fill();
  ctx.strokeStyle = 'rgba(150,160,180,0.14)'; ctx.lineWidth = px(1); ctx.stroke();
}

function drawBlade(ctx: CanvasRenderingContext2D, p: GeomPath, px: (n: number) => number) {
  pathTo(ctx, p.points, p.closed);
  if (p.closed) {
    ctx.fillStyle = '#090a0d'; ctx.fill();
    ctx.strokeStyle = 'rgba(130,140,158,0.35)'; ctx.lineWidth = px(1); ctx.stroke();
  } else {
    ctx.strokeStyle = '#08090c'; ctx.lineWidth = Math.max(px(4), 1.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(130,140,158,0.3)'; ctx.lineWidth = px(0.8); ctx.stroke();
  }
}

function drawSensor(ctx: CanvasRenderingContext2D, p: GeomPath, px: (n: number) => number) {
  pathTo(ctx, p.points, p.closed);
  if (p.closed) {
    const xs = p.points.map((q) => q.x), ys = p.points.map((q) => q.y);
    const gr = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    gr.addColorStop(0, '#252b36'); gr.addColorStop(0.5, '#171b23'); gr.addColorStop(1, '#0c0f14');
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = 'rgba(150,165,190,0.28)'; ctx.lineWidth = px(1); ctx.stroke();
  } else {
    ctx.strokeStyle = '#141820'; ctx.lineWidth = Math.max(px(3), 1); ctx.stroke();
  }
}

function drawFace(s: OverlayState, c: OpticalComponent, p: GeomPath, px: (n: number) => number) {
  const { ctx } = s;
  const info = s.light?.detectors.get(c.id);
  const lv = info?.level ?? 0;
  const col: [number, number, number] = info && lv > 0 ? info.rgb : [0.12, 0.8, 0.75];
  pathTo(ctx, p.points, p.closed);
  if (p.closed) { ctx.fillStyle = '#0b0f14'; ctx.fill(); }
  else { ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = Math.max(px(3.2), 1.0); ctx.lineCap = 'butt'; ctx.stroke(); }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = rgba(col, 0.9);
  ctx.shadowBlur = (4 + 18 * lv) * s.dpr;
  const a = 0.22 + 0.7 * lv;
  pathTo(ctx, p.points, p.closed);
  if (p.closed) { ctx.fillStyle = rgba(col, a * 0.5); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = px(1); ctx.stroke(); }
  else { ctx.strokeStyle = rgba(col, a); ctx.lineWidth = Math.max(px(1.6), 0.4); ctx.stroke(); }
  ctx.restore();
  ctx.lineCap = 'round';
}

function drawHousing(s: OverlayState, c: OpticalComponent, p: GeomPath, px: (n: number) => number) {
  const { ctx } = s;
  const pts = p.points;
  if (!p.closed || pts.length < 3) {
    pathTo(ctx, pts, false);
    ctx.strokeStyle = '#2a3242'; ctx.lineWidth = Math.max(px(3), 1); ctx.stroke();
    return;
  }
  let cx = 0, cy = 0, R = 0;
  for (const q of pts) { cx += q.x; cy += q.y; }
  cx /= pts.length; cy /= pts.length;
  for (const q of pts) R = Math.max(R, Math.hypot(q.x - cx, q.y - cy));
  const perp = rotate({ x: 0, y: 1 }, c.rotation);
  const gr = ctx.createLinearGradient(cx - perp.x * R * 0.6, cy - perp.y * R * 0.6, cx + perp.x * R * 0.6, cy + perp.y * R * 0.6);
  gr.addColorStop(0, '#47526a'); gr.addColorStop(0.22, '#2d3546'); gr.addColorStop(0.65, '#1b202b'); gr.addColorStop(1, '#10131a');
  pathTo(ctx, pts, true);
  ctx.fillStyle = gr; ctx.fill();
  const pat = getNoise(ctx);
  if (pat) { ctx.save(); pat.setTransform(new DOMMatrix().scale(px(1), px(1))); ctx.fillStyle = pat; ctx.fill(); ctx.restore(); }
  ctx.strokeStyle = 'rgba(170,185,210,0.32)'; ctx.lineWidth = px(1); ctx.stroke();
  // status LED
  const e = s.light?.emitters.get(c.id);
  const on = !!e && e.level > 0;
  const ax = rotate({ x: -1, y: 0 }, c.rotation);
  const lx = cx + ax.x * R * 0.45 - perp.x * R * 0.12, ly = cy + ax.y * R * 0.45 - perp.y * R * 0.12;
  const lr = Math.max(px(1.8), 0.5);
  ctx.save();
  if (on) { ctx.shadowColor = 'rgba(80,255,150,0.9)'; ctx.shadowBlur = 8 * s.dpr; }
  ctx.fillStyle = on ? '#5dff9e' : '#22302a';
  ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // aperture glow in the beam colour
  if (e && on) {
    const r = Math.max(px(12), 1.5);
    const rg = ctx.createRadialGradient(e.p.x, e.p.y, 0, e.p.x, e.p.y, r);
    const t = 1;
    rg.addColorStop(0, rgba([0.6 + 0.4 * e.rgb[0], 0.6 + 0.4 * e.rgb[1], 0.6 + 0.4 * e.rgb[2]], 0.95 * t));
    rg.addColorStop(0.25, rgba(e.rgb, 0.55 * t));
    rg.addColorStop(1, rgba(e.rgb, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(e.p.x, e.p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawFiber(s: OverlayState, c: OpticalComponent, g: ComponentGeometry, p: GeomPath, px: (n: number) => number) {
  const { ctx } = s;
  const pts = p.points;
  if (pts.length < 2) return;
  const W = Math.max(px(3.5), 2.4);
  const jacket = fiberJacket(c);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(px(1.2), px(2));
  pathTo(ctx, pts, p.closed);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = W * 1.15; ctx.stroke();
  ctx.restore();
  pathTo(ctx, pts, p.closed);
  ctx.strokeStyle = shade(jacket, -0.35); ctx.lineWidth = W; ctx.stroke();
  ctx.strokeStyle = jacket; ctx.lineWidth = W * 0.72; ctx.stroke();
  ctx.save();
  ctx.translate(-W * 0.12, -W * 0.16);
  pathTo(ctx, pts, p.closed);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = W * 0.22; ctx.stroke();
  ctx.restore();
  // connectors (ferrules) at both ends
  const glow = s.light?.fiberEnds.get(c.id);
  const ends: [Vec2, Vec2, number][] = [[pts[0], pts[1], glow?.a ?? 0], [pts[pts.length - 1], pts[pts.length - 2], glow?.b ?? 0]];
  for (const [e, nb, lv] of ends) {
    const ang = Math.atan2(e.y - nb.y, e.x - nb.x);
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(ang);
    const L = W * 2.4, H = W * 1.25;
    const gr = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
    gr.addColorStop(0, '#e9eef4'); gr.addColorStop(0.45, '#9aa3ae'); gr.addColorStop(1, '#4f5661');
    ctx.fillStyle = '#1d222b';
    ctx.fillRect(-L * 1.35, -H * 0.62, L * 0.55, H * 1.24);
    ctx.fillStyle = gr;
    ctx.fillRect(-L, -H / 2, L, H);
    ctx.fillStyle = '#d8dee6';
    ctx.fillRect(-W * 0.15, -H * 0.22, W * 0.5, H * 0.44);
    ctx.restore();
    if (lv > 0 && glow) {
      const r = Math.max(px(14), W * 3);
      const rg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      rg.addColorStop(0, rgba([0.7 + 0.3 * glow.rgb[0], 0.7 + 0.3 * glow.rgb[1], 0.7 + 0.3 * glow.rgb[2]], Math.min(1, 0.7 * lv)));
      rg.addColorStop(0.3, rgba(glow.rgb, 0.4 * lv));
      rg.addColorStop(1, rgba(glow.rgb, 0));
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  void g;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

function drawPolarization(s: OverlayState, vmin: Vec2, vmax: Vec2) {
  const { ctx, view, engine } = s;
  const z = view.zoom;
  const segs = s.trace!.segments;
  const spacing = 36 / z; // mm
  let budget = 4000;
  ctx.save();
  ctx.lineWidth = 1.2 / z;
  ctx.lineCap = 'round';
  for (let i = 0; i < segs.length && budget > 0; i++) {
    const sg = segs[i];
    const deg = sg.polDegree ?? 0;
    if (deg < 0.03 || sg.polAngle === undefined) continue;
    const minx = Math.min(sg.a.x, sg.b.x), maxx = Math.max(sg.a.x, sg.b.x), miny = Math.min(sg.a.y, sg.b.y), maxy = Math.max(sg.a.y, sg.b.y);
    if (maxx < vmin.x || minx > vmax.x || maxy < vmin.y || miny > vmax.y) continue;
    const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y, L = Math.hypot(dx, dy);
    if (L < spacing * 0.5) continue;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const rgb = safeRGB(engine, sg.wavelength);
    const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
    ctx.strokeStyle = `rgba(${Math.round(150 + 105 * rgb[0] / m)},${Math.round(150 + 105 * rgb[1] / m)},${Math.round(150 + 105 * rgb[2] / m)},0.85)`;
    ctx.fillStyle = ctx.strokeStyle;
    const inPlane = Math.abs(Math.cos(sg.polAngle)) * deg;
    const outPlane = Math.abs(Math.sin(sg.polAngle)) * deg;
    const hl = (6 / z) * inPlane;
    const off = ((sg.depth * 0.37) % 1) * spacing;
    ctx.beginPath();
    for (let t = off + spacing * 0.5; t < L && budget > 0; t += spacing, budget--) {
      const x = sg.a.x + ux * t, y = sg.a.y + uy * t;
      if (hl > 0.4 / z) { ctx.moveTo(x - nx * hl, y - ny * hl); ctx.lineTo(x + nx * hl, y + ny * hl); }
    }
    ctx.stroke();
    if (outPlane > 0.15) {
      ctx.beginPath();
      for (let t = off + spacing * 0.5; t < L; t += spacing) {
        const x = sg.a.x + ux * t, y = sg.a.y + uy * t;
        ctx.moveTo(x + (1.8 * outPlane) / z, y);
        ctx.arc(x, y, (1.8 * outPlane) / z, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Windows-classic tooltip-like chip: light grey face, black 1px border, black Tahoma text. */
export function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, selected = false) {
  ctx.font = FONT;
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = tw + 10, h = 16;
  const X = Math.round(x - w / 2) + 0.5, Y = Math.round(y - h / 2) + 0.5;
  ctx.fillStyle = selected ? '#0a246a' : '#d4d0c8';
  ctx.fillRect(X, Y, w, h);
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 1;
  ctx.strokeRect(X, Y, w, h);
  ctx.fillStyle = selected ? '#ffffff' : '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(x), Math.round(y) + 0.5);
}

export function drawMeasure(ctx: CanvasRenderingContext2D, m: { a: Vec2; b: Vec2 }, view: ViewState, w: number, h: number, selected = false) {
  const a = worldToScreen(m.a, view, w, h), b = worldToScreen(m.b, view, w, h);
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
  const dmm = Math.hypot(dx, dy);
  const ang = (Math.atan2(-dy, dx) * 180) / Math.PI; // CCW from +x, as seen on screen
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = L > 0 ? (b.x - a.x) / L : 1, uy = L > 0 ? (b.y - a.y) / L : 0;
  const nx = -uy, ny = ux;
  ctx.save();
  ctx.lineCap = 'butt';
  // dimension line: black underlay + white 1px line (reads on beams and on the dark field)
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  for (const p of [a, b]) { ctx.moveTo(p.x - nx * 6, p.y - ny * 6); ctx.lineTo(p.x + nx * 6, p.y + ny * 6); }
  const step = [1, 5, 10, 25, 50, 100, 250].find((st) => st * view.zoom >= 8) ?? 500;
  for (let d = step, i = 1; d < dmm; d += step, i++) {
    const t = d / dmm;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const k = i % 5 === 0 ? 5 : 3;
    ctx.moveTo(x, y); ctx.lineTo(x + nx * k, y + ny * k);
  }
  ctx.stroke();
  if (L > 20) {
    ctx.fillStyle = '#ffffff';
    for (const [p, sg] of [[a, 1], [b, -1]] as [Vec2, number][]) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + sg * ux * 7 + nx * 2.5, p.y + sg * uy * 7 + ny * 2.5);
      ctx.lineTo(p.x + sg * ux * 7 - nx * 2.5, p.y + sg * uy * 7 - ny * 2.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
  const fmt = dmm >= 1000 ? `${(dmm / 1000).toFixed(3)} m` : `${dmm.toFixed(dmm < 10 ? 2 : 1)} mm`;
  chip(ctx, `${fmt}   ${ang.toFixed(1)}°`, (a.x + b.x) / 2 + nx * 16, (a.y + b.y) / 2 + ny * 16, selected);
}

function drawLinkBadge(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#1e2125';
  ctx.fillRect(-7.5, -7.5, 15, 15);
  ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 1;
  ctx.strokeRect(-7.5, -7.5, 15, 15);
  ctx.rotate(-Math.PI / 4);
  ctx.strokeStyle = '#e0e2e5';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(-5.5, -2, 6, 4, 2); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-0.5, -2, 6, 4, 2); ctx.stroke();
  ctx.restore();
}

function drawLock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(196,210,230,0.7)'; ctx.fillStyle = 'rgba(196,210,230,0.7)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x, y - 2, 2.5, Math.PI, 0); ctx.stroke();
  ctx.fillRect(x - 3.5, y - 2, 7, 5.5);
  ctx.restore();
}
