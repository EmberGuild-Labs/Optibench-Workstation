/** Canvas2D frame renderer for the circuit viewport. */
import type { CircuitComponent, CircuitState, Vec2, ViewState } from '@core/types';
import { type CompFit, key } from './geometry';
import type { Hit, Model } from './model';
import { rgba, valueLabel, voltageColor } from './format';
import { drawSymbol, NO_LABEL, type SymCtx } from './symbols';
import type { SymPalette, TextOpts } from './symbols/draw';
import { roundRect } from './symbols/draw';

/** Classic-professional light theme (docs/THEME.md "Viewports"): white schematic paper. */
export const COLORS = {
  bg: '#ffffff',
  gridDot: 'rgba(0,0,0,0.16)',
  gridMajor: 'rgba(0,0,0,0.30)',
  stroke: '#000000',
  text: '#000000',
  dim: '#404040',
  value: '#000000',
  body: '#ffffff',
  accent: '#0a246a',
  hot: '#c04000',
  wire: '#303030',
  pin: '#000000',
  pinOpen: '#606060',
  current: '#e07800',
  link: '#800080'
};

export const SANS = 'Tahoma, "Microsoft Sans Serif", "Segoe UI", sans-serif';
export const MONO = '"Lucida Console", Consolas, monospace';

export interface Overlay {
  hover: Hit | null;
  wiringPath: Vec2[] | null;
  wiringCursor: Vec2 | null;
  hotPoint: Vec2 | null;
  marquee: { a: Vec2; b: Vec2 } | null;  // screen px
  ghost: CompFit | null;
  potOverride: Map<string, number>;
}

export interface FrameInput {
  g: CanvasRenderingContext2D;
  w: number; h: number; dpr: number;
  view: ViewState;
  model: Model;
  state: CircuitState | null;
  running: boolean;
  selection: Set<string>;
  linkedIds: Set<string>;
  display: { showGrid: boolean; animateCurrent: boolean; colorByVoltage: boolean };
  overlay: Overlay;
  time: number;
  edgeFlow: Float64Array | null;
  phases: Float64Array | null;
  groupV: Float64Array | null;
  gridCache: { key: string; canvas: HTMLCanvasElement | null };
}

const DOT_SPACING = 0.9;

function drawGrid(fi: FrameInput): void {
  const { g, w, h, dpr, view } = fi;
  const z = view.zoom;
  let step = 1;
  while (step * z < 10) step *= 5;
  const k = `${w}x${h}@${dpr}|${view.cx.toFixed(4)},${view.cy.toFixed(4)},${z.toFixed(4)}`;
  const gc = fi.gridCache;
  if (gc.key !== k || !gc.canvas) {
    const cv = gc.canvas ?? document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, cv.width, cv.height);
    const x0 = Math.floor((view.cx - w / 2 / z) / step) * step, x1 = view.cx + w / 2 / z;
    const y0 = Math.floor((view.cy - h / 2 / z) / step) * step, y1 = view.cy + h / 2 / z;
    const sz = Math.max(1, Math.round(1.3 * dpr));
    const major = step * 5;
    for (let pass = 0; pass < 2; pass++) {
      c.fillStyle = pass === 0 ? COLORS.gridDot : COLORS.gridMajor;
      for (let x = x0; x <= x1; x += step) {
        const isMx = Math.abs(Math.round(x / major) * major - x) < 1e-6;
        const sx = Math.round(((x - view.cx) * z + w / 2) * dpr);
        for (let y = y0; y <= y1; y += step) {
          const isMy = Math.abs(Math.round(y / major) * major - y) < 1e-6;
          const isM = isMx && isMy;
          if ((pass === 1) !== isM) continue;
          const sy = Math.round(((y - view.cy) * z + h / 2) * dpr);
          const s2 = isM ? sz + 1 : sz;
          c.fillRect(sx - (s2 >> 1), sy - (s2 >> 1), s2, s2);
        }
      }
    }
    gc.canvas = cv; gc.key = k;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(gc.canvas!, 0, 0);
}

function worldTransform(fi: FrameInput): void {
  const { g, w, h, dpr, view } = fi;
  const z = view.zoom;
  g.setTransform(z * dpr, 0, 0, z * dpr, (w / 2 - view.cx * z) * dpr, (h / 2 - view.cy * z) * dpr);
}

function toScreen(fi: FrameInput, p: Vec2): Vec2 {
  return { x: ((p.x - fi.view.cx) * fi.view.zoom + fi.w / 2) * fi.dpr, y: ((p.y - fi.view.cy) * fi.view.zoom + fi.h / 2) * fi.dpr };
}

function makeText(fi: FrameInput) {
  const { g, dpr } = fi;
  const z = fi.view.zoom;
  return (x: number, y: number, s: string, size: number, o: TextOpts = {}): void => {
    if (!s) return;
    let px = size * z;
    if (px < (o.minPx ?? 4.5)) return;
    px = Math.min(px, 48);
    const m = g.getTransform();
    const dx = m.a * x + m.c * y + m.e, dy = m.b * x + m.d * y + m.f;
    let align: CanvasTextAlign = o.align ?? 'center';
    let base: CanvasTextBaseline = o.baseline ?? 'middle';
    if (o.inward) {
      const vx = m.a * o.inward.x + m.c * o.inward.y, vy = m.b * o.inward.x + m.d * o.inward.y;
      if (Math.abs(vx) >= Math.abs(vy)) { align = vx > 0 ? 'left' : 'right'; base = 'middle'; }
      else { align = 'center'; base = vy > 0 ? 'top' : 'bottom'; }
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.shadowBlur = 0;
    g.font = `${o.weight ?? '500'} ${(px * dpr).toFixed(1)}px ${o.mono ? MONO : SANS}`;
    g.textAlign = align;
    g.textBaseline = base;
    if (o.bg) {
      const tw = g.measureText(s).width, th = px * dpr;
      const padX = 4 * dpr, padY = 2 * dpr;
      const lx = align === 'center' ? dx - tw / 2 : align === 'right' || align === 'end' ? dx - tw : dx;
      const ty = base === 'middle' ? dy - th / 2 : base === 'bottom' ? dy - th : dy;
      roundRect(g, lx - padX, ty - padY, tw + 2 * padX, th + 2 * padY, 3 * dpr);
      g.fillStyle = o.bg; g.fill();
      g.strokeStyle = '#000000'; g.lineWidth = dpr; g.stroke();
    }
    g.fillStyle = o.color ?? COLORS.text;
    g.fillText(s, dx, dy);
    g.restore();
  };
}

function makeGlow(g: CanvasRenderingContext2D) {
  return (x: number, y: number, r: number, rgb: [number, number, number], k: number): void => {
    if (r <= 0 || k <= 0) return;
    g.save();
    g.shadowBlur = 0;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(rgb, 0.7 * k));
    gr.addColorStop(0.35, rgba(rgb, 0.3 * k));
    gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.restore();
  };
}

export function symbolLineWidthPx(zoom: number): number {
  return Math.max(1.25, Math.min(2.6, zoom * 0.075));
}

function drawComponent(fi: FrameInput, f: CompFit, opts: { selected: boolean; hover: boolean; ghost?: boolean }): void {
  const { g } = fi;
  const z = fi.view.zoom;
  const lw = symbolLineWidthPx(z) / z;
  const pal: SymPalette = {
    stroke: opts.selected ? COLORS.accent : opts.hover && !fi.running ? '#3a5a9a' : COLORS.stroke,
    fill: COLORS.bg, body: COLORS.body, text: COLORS.text, dim: COLORS.dim, accent: COLORS.accent, hot: COLORS.hot
  };
  g.save();
  worldTransform(fi);
  const m = f.m;
  g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  if (opts.ghost) g.globalAlpha = 0.45;
  g.strokeStyle = pal.stroke;
  g.fillStyle = pal.stroke;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (opts.selected) g.lineWidth = lw * 1.25;
  const s: SymCtx = {
    g, c: f.c, def: f.def, pins: f.pins, rect: f.rect,
    st: fi.state?.components?.[f.c.id], running: fi.running, lw, col: pal, time: fi.time, zoom: z, dpr: fi.dpr,
    hover: opts.hover, potOverride: fi.overlay.potOverride.get(f.c.id), ghost: opts.ghost,
    text: makeText(fi), glow: makeGlow(g)
  };
  try { drawSymbol(s); } catch { /* never let a symbol break the frame */ }
  g.restore();
}

/** Symbols that draw beyond their footprint (arrows / envelopes): push labels further out. */
const RAISED = new Set(['semi.led', 'opto.laser_diode', 'opto.photodiode', 'opto.ldr', 'opto.solar_cell', 'switch.push']);
const ENVELOPE = new Set(['semi.npn', 'semi.pnp', 'semi.nmos', 'semi.pmos', 'opto.solar_cell']);

function labelFor(f: CompFit): [string, string] {
  return [f.c.name ?? '', valueLabel(f.c, f.def)];
}

function drawLabels(fi: FrameInput): void {
  const z = fi.view.zoom;
  if (z < 7) return;
  const { g, dpr } = fi;
  const px = 11; // Tahoma 11px per THEME.md
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.textBaseline = 'middle';
  for (const f of fi.model.fits) {
    if (NO_LABEL.has(f.c.type)) continue;
    const [name, val] = labelFor(f);
    if (!name && !val) continue;
    const b = f.bounds;
    const horiz = b.x1 - b.x0 >= b.y1 - b.y0;
    const sel = fi.selection.has(f.c.id);
    if (horiz) {
      const p = toScreen(fi, { x: (b.x0 + b.x1) / 2, y: b.y0 - (RAISED.has(f.c.type) ? 0.45 : 0) });
      g.textAlign = 'center';
      const y = p.y - 5 * dpr;
      g.font = `bold ${(px * dpr).toFixed(1)}px ${SANS}`;
      const nameW = name ? g.measureText(name).width : 0;
      g.font = `${(px * dpr).toFixed(1)}px ${SANS}`;
      const valW = val ? g.measureText(val).width : 0;
      const gap = name && val ? 5 * dpr : 0;
      const total = nameW + gap + valW;
      let x = p.x - total / 2;
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      if (name) { g.font = `bold ${(px * dpr).toFixed(1)}px ${SANS}`; g.fillStyle = sel ? COLORS.accent : COLORS.text; g.fillText(name, x, y); x += nameW + gap; }
      if (val) { g.font = `${(px * dpr).toFixed(1)}px ${SANS}`; g.fillStyle = COLORS.value; g.fillText(val, x, y); }
    } else {
      const p = toScreen(fi, { x: b.x1 + (ENVELOPE.has(f.c.type) ? 0.5 : 0), y: (b.y0 + b.y1) / 2 });
      const x = p.x + 6 * dpr;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      if (name && val) {
        g.font = `bold ${(px * dpr).toFixed(1)}px ${SANS}`; g.fillStyle = sel ? COLORS.accent : COLORS.text; g.fillText(name, x, p.y - px * 0.62 * dpr);
        g.font = `${(px * dpr).toFixed(1)}px ${SANS}`; g.fillStyle = COLORS.value; g.fillText(val, x, p.y + px * 0.62 * dpr);
      } else {
        g.font = `bold ${(px * dpr).toFixed(1)}px ${SANS}`; g.fillStyle = name ? (sel ? COLORS.accent : COLORS.text) : COLORS.value; g.fillText(name || val, x, p.y);
      }
    }
  }
  g.restore();
}

export function renderFrame(fi: FrameInput): void {
  const { g, w, h, dpr, model, overlay } = fi;
  const z = fi.view.zoom;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, w * dpr, h * dpr);
  if (fi.display.showGrid) drawGrid(fi);

  const wirePx = Math.max(1.5, Math.min(3.2, z * 0.085));
  const wireColor = new Map<string, string>();
  let maxV = 0;
  if (fi.running && fi.state) for (const v of Object.values(fi.state.nodeVoltages ?? {})) if (Number.isFinite(v)) maxV = Math.max(maxV, Math.abs(v));
  const byVoltage = fi.running && fi.display.colorByVoltage && !!fi.groupV;
  for (const wire of model.scene.wires) {
    let col = wire.color || COLORS.wire;
    if (byVoltage) {
      const gi = model.graph.wireGroup.get(wire.id);
      const v = gi !== undefined ? fi.groupV![gi] : NaN;
      col = voltageColor(Number.isFinite(v) && maxV > 1e-9 ? v / maxV : 0);
    }
    wireColor.set(wire.id, col);
  }

  // ---- wires
  worldTransform(fi);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const hoverWire = overlay.hover?.kind === 'wire' || overlay.hover?.kind === 'handle' ? overlay.hover.wireId : null;
  for (const wire of model.scene.wires) {
    if (wire.points.length < 2) continue;
    const sel = fi.selection.has(wire.id);
    const path = (): void => {
      g.beginPath();
      g.moveTo(wire.points[0].x, wire.points[0].y);
      for (let i = 1; i < wire.points.length; i++) g.lineTo(wire.points[i].x, wire.points[i].y);
    };
    if (sel || hoverWire === wire.id) {
      path();
      g.strokeStyle = sel ? 'rgba(10,36,106,0.28)' : 'rgba(10,36,106,0.10)';
      g.lineWidth = (wirePx + (sel ? 7 : 5)) / z;
      g.stroke();
    }
    path();
    g.strokeStyle = wireColor.get(wire.id)!;
    g.lineWidth = wirePx / z;
    g.stroke();
  }

  // ---- current dots
  if (fi.running && fi.display.animateCurrent && fi.edgeFlow && fi.phases) {
    const r = Math.max(1.7, Math.min(3.2, z * 0.075)) / z;
    g.beginPath();
    const edges = model.graph.edges, nodes = model.graph.nodes;
    for (let ei = 0; ei < edges.length; ei++) {
      const I = fi.edgeFlow[ei];
      if (!(Math.abs(I) > 1e-9)) continue;
      const e = edges[ei];
      const a = nodes[e.a].p, b = nodes[e.b].p;
      let ph = fi.phases[ei] % DOT_SPACING;
      if (ph < 0) ph += DOT_SPACING;
      for (let s = ph; s < e.len; s += DOT_SPACING) {
        const t = s / e.len;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    g.fillStyle = COLORS.current;
    g.fill();
  }

  // ---- components
  const hoverComp = overlay.hover?.kind === 'comp' ? overlay.hover.id : overlay.hover?.kind === 'pin' ? overlay.hover.compId : null;
  for (const f of model.fits) {
    const sel = fi.selection.has(f.c.id);
    if (sel || hoverComp === f.c.id) {
      worldTransform(fi);
      const b = f.bounds, pad = 0.3;
      roundRect(g, b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad, 0.3);
      g.fillStyle = sel ? 'rgba(10,36,106,0.06)' : 'rgba(10,36,106,0.03)';
      g.fill();
      if (sel) {
        g.setLineDash([4 / z, 3 / z]);
        g.strokeStyle = COLORS.accent;
        g.lineWidth = 1 / z;
        g.stroke();
        g.setLineDash([]);
      }
    }
    drawComponent(fi, f, { selected: sel, hover: hoverComp === f.c.id });
  }

  // ---- pins
  worldTransform(fi);
  const pr = Math.max(2.2, Math.min(4, z * 0.09)) / z;
  for (const p of model.pinRefs) {
    const connected = model.graph.connectedPins.has(`${p.compId}:${p.pin}`);
    g.beginPath();
    g.arc(p.p.x, p.p.y, connected ? pr * 0.85 : pr, 0, Math.PI * 2);
    if (connected) {
      const n = model.graph.nodeIndex.get(key(p.p));
      const ed = n !== undefined ? model.graph.nodes[n].edges[0] : undefined;
      g.fillStyle = byVoltage && ed !== undefined ? wireColor.get(model.graph.edges[ed].wireId) ?? COLORS.pin : COLORS.pin;
      g.fill();
    } else {
      g.fillStyle = COLORS.bg;
      g.fill();
      g.strokeStyle = COLORS.pinOpen;
      g.lineWidth = 1.2 / z;
      g.stroke();
    }
  }

  // ---- junction dots
  const jr = Math.max(2.8, Math.min(5.5, z * 0.15)) / z;
  for (const j of model.graph.junctions) {
    const n = model.graph.nodeIndex.get(key(j));
    const ed = n !== undefined ? model.graph.nodes[n].edges[0] : undefined;
    g.beginPath();
    g.arc(j.x, j.y, jr, 0, Math.PI * 2);
    g.fillStyle = byVoltage && ed !== undefined ? wireColor.get(model.graph.edges[ed].wireId) ?? '#000' : '#000000';
    g.fill();
  }

  // ---- selected wire handles
  for (const wire of model.scene.wires) {
    if (!fi.selection.has(wire.id)) continue;
    const hs = 3.5 / z;
    for (const p of wire.points) {
      g.beginPath(); g.rect(p.x - hs, p.y - hs, hs * 2, hs * 2);
      g.fillStyle = '#ffffff'; g.fill();
      g.strokeStyle = COLORS.accent; g.lineWidth = 1.2 / z; g.stroke();
    }
  }

  drawLabels(fi);

  // ---- link badges
  if (fi.linkedIds.size) {
    worldTransform(fi);
    for (const f of model.fits) {
      if (!fi.linkedIds.has(f.c.id)) continue;
      const x = f.bounds.x1 + 0.15, y = f.bounds.y0 - 0.15, r = Math.max(6, Math.min(10, z * 0.3)) / z;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = COLORS.link; g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.3 / z;
      for (const o of [-0.32, 0.32]) {
        g.beginPath();
        g.ellipse(x + o * r * 0.7, y - o * r * 0.7, r * 0.42, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  // ---- ghost (place tool)
  if (overlay.ghost) drawComponent(fi, overlay.ghost, { selected: false, hover: false, ghost: true });

  // ---- wiring preview
  worldTransform(fi);
  if (overlay.wiringPath && overlay.wiringPath.length) {
    const pts = overlay.wiringPath;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokeStyle = 'rgba(10,36,106,0.15)';
    g.lineWidth = (wirePx + 6) / z;
    g.stroke();
    g.strokeStyle = COLORS.accent;
    g.lineWidth = wirePx / z;
    g.stroke();
    for (const p of pts) {
      g.beginPath(); g.arc(p.x, p.y, 2 / z, 0, Math.PI * 2); g.fillStyle = COLORS.accent; g.fill();
    }
  }
  if (overlay.wiringCursor) {
    const c = overlay.wiringCursor;
    g.strokeStyle = 'rgba(10,36,106,0.7)';
    g.lineWidth = 1 / z;
    const k = 0.35;
    g.beginPath(); g.moveTo(c.x - k, c.y); g.lineTo(c.x + k, c.y); g.moveTo(c.x, c.y - k); g.lineTo(c.x, c.y + k); g.stroke();
  }
  if (overlay.hotPoint) {
    const c = overlay.hotPoint;
    g.beginPath(); g.arc(c.x, c.y, Math.max(0.22, 7 / z), 0, Math.PI * 2);
    g.strokeStyle = COLORS.hot; g.lineWidth = 2 / z; g.stroke();
    g.fillStyle = 'rgba(192,64,0,0.12)'; g.fill();
  }

  // ---- marquee (screen space)
  if (overlay.marquee) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { a, b } = overlay.marquee;
    const crossing = b.x < a.x;
    g.fillStyle = crossing ? 'rgba(0,128,0,0.05)' : 'rgba(10,36,106,0.06)';
    g.strokeStyle = crossing ? '#008000' : COLORS.accent;
    g.lineWidth = 1;
    g.setLineDash(crossing ? [4, 2] : [1, 1]);
    g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    g.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    g.setLineDash([]);
  }

  // ---- sim error banner
  if (fi.running && fi.state?.error) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `bold 11px ${SANS}`;
    g.textAlign = 'left'; g.textBaseline = 'top';
    const msg = `⚠ ${fi.state.error}`;
    const tw = g.measureText(msg).width;
    g.fillStyle = '#ffffe1'; g.fillRect(10, 10, tw + 16, 22);
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(10.5, 10.5, tw + 16, 22);
    g.fillStyle = '#a00000'; g.fillText(msg, 18, 15);
  }
}

export type { CircuitComponent };
