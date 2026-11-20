/**
 * Symbol drawing context + primitives. Symbols draw in the component's LOCAL grid frame
 * (rotation 0, before mirroring); the renderer has already applied the fitted transform.
 * Everything is scaled to the def's footprint and actual pin offsets.
 */
import type { CircuitComponent, CircuitComponentDef, CircuitComponentState, PinDef, Vec2 } from '@core/types';
import type { Rect } from '../geometry';

export interface TextOpts {
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  color?: string;
  weight?: string;
  mono?: boolean;
  /** draw a rounded background box behind the text (screen space) */
  bg?: string;
  /** inward direction in the current frame: auto-aligns text away from that edge */
  inward?: Vec2;
  minPx?: number;
}

export interface SymPalette {
  stroke: string;
  fill: string;      // background-coloured fill (hollow contacts)
  body: string;      // IC / box body fill
  text: string;
  dim: string;
  accent: string;
  hot: string;       // interactive highlight
}

export interface SymCtx {
  g: CanvasRenderingContext2D;
  c: CircuitComponent;
  def?: CircuitComponentDef;
  pins: PinDef[];
  rect: Rect;
  st?: CircuitComponentState;
  running: boolean;
  lw: number;                 // stroke width in grid units
  col: SymPalette;
  time: number;               // seconds (animation)
  zoom: number;               // px per grid unit
  dpr: number;
  hover: boolean;
  potOverride?: number;
  ghost?: boolean;
  text(x: number, y: number, s: string, size: number, o?: TextOpts): void;
  glow(x: number, y: number, r: number, rgb: [number, number, number], k: number): void;
}

export type SymbolFn = (s: SymCtx) => void;

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

export function ln(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}

export function poly(g: CanvasRenderingContext2D, pts: number[], close = false, fill?: string | null, stroke = true): void {
  if (pts.length < 4) return;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  if (close) g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) g.stroke();
}

export function circ(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill?: string | null, stroke = true): void {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) g.stroke();
}

export function arrowHead(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number, color?: string): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
  g.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
  g.closePath();
  g.fillStyle = color ?? (g.strokeStyle as string);
  g.fill();
}

export function arrow(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ln(g, x1, y1, x2 - Math.cos(a) * size * 0.6, y2 - Math.sin(a) * size * 0.6);
  arrowHead(g, x1, y1, x2, y2, size);
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y); g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr); g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h); g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr); g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

export function zigzag(g: CanvasRenderingContext2D, x0: number, x1: number, amp: number, n = 6): void {
  const L = x1 - x0;
  g.beginPath();
  g.moveTo(x0, 0);
  for (let k = 0; k < n; k++) g.lineTo(x0 + (L * (2 * k + 1)) / (2 * n), k % 2 === 0 ? -amp : amp);
  g.lineTo(x1, 0);
  g.stroke();
}

export function humps(g: CanvasRenderingContext2D, x0: number, x1: number, n = 4, side = -1): void {
  const r = (x1 - x0) / (2 * n);
  g.beginPath();
  g.moveTo(x0, 0);
  for (let k = 0; k < n; k++) {
    const cx = x0 + r * (2 * k + 1);
    g.arc(cx, 0, r, Math.PI, 0, side > 0);
  }
  g.stroke();
}

// ---------------------------------------------------------------------------
// pins & frames
// ---------------------------------------------------------------------------

export function findPin(pins: PinDef[], re: RegExp, exclude: PinDef[] = []): PinDef | undefined {
  return pins.find((p) => re.test(p.name) && !exclude.includes(p));
}

/** [positive/first, negative/second] pin of a two-terminal part. */
export function pinPair(pins: PinDef[], posRe: RegExp = /^(\+|p|pos|a|anode|1|in|plus|vcc|v\+)$/i): [PinDef, PinDef] | null {
  if (pins.length < 2) return null;
  const pos = findPin(pins, posRe) ?? pins[0];
  const neg = pins.find((p) => p !== pos) ?? pins[1];
  return [pos, neg];
}

export function rectMid(r: Rect): Vec2 { return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }; }

/** Perpendicular half-extent of the body around point m for axis direction (ux,uy). */
export function availPerp(r: Rect, m: Vec2, ux: number, uy: number): number {
  let a: number;
  if (Math.abs(ux) >= Math.abs(uy)) a = Math.min(m.y - r.y0, r.y1 - m.y);
  else a = Math.min(m.x - r.x0, r.x1 - m.x);
  if (!(a > 0.05)) a = 0.5;
  return Math.max(0.3, Math.min(1.6, a));
}

export interface Frame { len: number; avail: number; ux: number; uy: number; mid: Vec2; toFrame(p: Vec2): Vec2 }

/** Apply a frame with origin at the midpoint of pa→pb and +x along pa→pb. Caller save/restore. */
export function axisFrame(s: SymCtx, pa: Vec2, pb: Vec2): Frame {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  s.g.transform(ux, uy, -uy, ux, mid.x, mid.y);
  const avail = availPerp(s.rect, mid, ux, uy);
  return {
    len, avail, ux, uy, mid,
    toFrame: (p: Vec2) => { const x = p.x - mid.x, y = p.y - mid.y; return { x: x * ux + y * uy, y: -x * uy + y * ux }; }
  };
}

/**
 * Standard two-terminal layout: leads from each pin to the body, body centred between.
 * body(bl, avail, frame) draws from -bl/2..bl/2 on the x axis.
 */
export function twoTerm(s: SymCtx, pa: Vec2, pb: Vec2, prefBody: number, body: (bl: number, avail: number, f: Frame) => void, minLead = 0.2): void {
  const g = s.g;
  g.save();
  const f = axisFrame(s, pa, pb);
  const bl = Math.max(Math.min(prefBody, f.len - 2 * minLead), Math.min(prefBody, f.len * 0.6));
  ln(g, -f.len / 2, 0, -bl / 2, 0);
  ln(g, bl / 2, 0, f.len / 2, 0);
  body(bl, f.avail, f);
  g.restore();
}

/** Box inset so that pins sitting on the footprint edge get visible stubs. */
export function bodyBox(s: SymCtx, inset = 0.5): Rect {
  const r = { ...s.rect };
  const on = (v: number, e: number): boolean => Math.abs(v - e) < 1e-6;
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const ix = Math.min(inset, w * 0.2), iy = Math.min(inset, h * 0.2);
  if (s.pins.some((p) => on(p.offset.x, s.rect.x0))) r.x0 += ix;
  if (s.pins.some((p) => on(p.offset.x, s.rect.x1))) r.x1 -= ix;
  if (s.pins.some((p) => on(p.offset.y, s.rect.y0))) r.y0 += iy;
  if (s.pins.some((p) => on(p.offset.y, s.rect.y1))) r.y1 -= iy;
  return r;
}

/** Draw pin stubs from pins to the nearest edge of box; returns per-pin edge points + inward normals. */
export function pinStubs(s: SymCtx, box: Rect, pins: PinDef[] = s.pins): { pin: PinDef; e: Vec2; n: Vec2 }[] {
  const out: { pin: PinDef; e: Vec2; n: Vec2 }[] = [];
  for (const pd of pins) {
    const p = pd.offset;
    const cx = Math.max(box.x0, Math.min(box.x1, p.x)), cy = Math.max(box.y0, Math.min(box.y1, p.y));
    let e: Vec2, n: Vec2;
    if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) {
      // outside: project onto box
      e = { x: cx, y: cy };
      if (p.x < box.x0) n = { x: 1, y: 0 };
      else if (p.x > box.x1) n = { x: -1, y: 0 };
      else if (p.y < box.y0) n = { x: 0, y: 1 };
      else n = { x: 0, y: -1 };
    } else {
      // inside/on edge: nearest edge
      const d = [p.x - box.x0, box.x1 - p.x, p.y - box.y0, box.y1 - p.y];
      const k = d.indexOf(Math.min(...d));
      e = k === 0 ? { x: box.x0, y: p.y } : k === 1 ? { x: box.x1, y: p.y } : k === 2 ? { x: p.x, y: box.y0 } : { x: p.x, y: box.y1 };
      n = k === 0 ? { x: 1, y: 0 } : k === 1 ? { x: -1, y: 0 } : k === 2 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    }
    if (Math.hypot(e.x - p.x, e.y - p.y) > 1e-6) ln(s.g, p.x, p.y, e.x, e.y);
    out.push({ pin: pd, e, n });
  }
  return out;
}

const PRETTY: Record<string, string> = { VCC: 'V+', GND: 'GND', DIS: 'DIS', THR: 'THR', TRIG: 'TRI', CTRL: 'CV' };

/** DIP-style IC: body box, notch, pin stubs + names, centred title. */
export function icBox(s: SymCtx, title: string, opts: { subtitle?: string; labels?: boolean; notch?: boolean; fill?: string } = {}): Rect {
  const g = s.g;
  const box = bodyBox(s);
  g.save();
  roundRect(g, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 0.12);
  g.fillStyle = opts.fill ?? s.col.body;
  g.fill();
  g.stroke();
  if (opts.notch !== false && box.x1 - box.x0 >= 1.5) {
    const cx = (box.x0 + box.x1) / 2;
    g.beginPath(); g.arc(cx, box.y0, 0.18, 0, Math.PI, false); g.stroke();
  }
  g.restore();
  const stubs = pinStubs(s, box);
  if (opts.labels !== false) {
    for (const st of stubs) {
      const name = PRETTY[st.pin.name.toUpperCase()] ?? st.pin.name;
      s.text(st.e.x + st.n.x * 0.15, st.e.y + st.n.y * 0.15, name, 0.32, { inward: st.n, color: s.col.dim, mono: true });
    }
  }
  const c = rectMid(box);
  const big = Math.min(0.55, (box.x1 - box.x0) * 0.22, (box.y1 - box.y0) * 0.35, ((box.x1 - box.x0) * 0.85) / Math.max(1, title.length * 0.62));
  s.text(c.x, c.y - (opts.subtitle ? big * 0.45 : 0), title, Math.max(0.3, big), { weight: '600' });
  if (opts.subtitle) s.text(c.x, c.y + big * 0.65, opts.subtitle, Math.max(0.24, big * 0.6), { color: s.col.dim });
  return box;
}

/** Light arrows (inbound for detectors, outbound for emitters) placed above the x axis. */
export function lightArrows(s: SymCtx, x: number, y: number, inbound: boolean, color?: string, n = 2): void {
  const g = s.g;
  g.save();
  if (color) { g.strokeStyle = color; }
  const L = 0.42, hs = 0.13;
  for (let i = 0; i < n; i++) {
    const ox = x + i * 0.26;
    const ax = ox, ay = y, bx = ox + L * 0.7, by = y - L * 0.7;
    if (inbound) arrow(g, bx + 0.08, by - 0.08, ax, ay, hs);
    else arrow(g, ax, ay, bx + 0.08, by - 0.08, hs);
  }
  g.restore();
}
