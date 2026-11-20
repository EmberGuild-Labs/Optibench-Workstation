/**
 * Symbols for the analog / interface ICs, electromechanical parts and extra passives:
 * ic.opamp, ic.comparator, ic.regulator, ic.shift595, ic.decoder138, ic.hbridge,
 * misc.motor, misc.servo, passive.thermistor, passive.fuse, source.clock.
 * All geometry derives from the def's pin offsets (rotation-0 frame), so leads end exactly on pins.
 */
import type { PinDef, Vec2 } from '@core/types';
import { arrow, bodyBox, circ, findPin, icBox, ln, pinPair, pinStubs, poly, rectMid, roundRect, twoTerm, type SymCtx } from './draw';

const DEG = Math.PI / 180;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// op-amp / comparator triangle
// ---------------------------------------------------------------------------

interface Tri { back: number; apex: number; cy: number; hb: number; halfAt(x: number): number }

function amplifierTriangle(s: SymCtx, comparator: boolean): void {
  const g = s.g;
  const inP = findPin(s.pins, /^in\+$/i);
  const inN = findPin(s.pins, /^in-$/i);
  const out = findPin(s.pins, /^out$/i);
  const vp = findPin(s.pins, /^v\+$/i);
  const vn = findPin(s.pins, /^v-$/i);
  if (!inP || !inN || !out) { icBox(s, comparator ? 'CMP' : 'OPA'); return; }
  const inX = Math.max(inP.offset.x, inN.offset.x);
  const back = inX + Math.min(1, (out.offset.x - inX) * 0.18);
  const apex = out.offset.x - Math.min(1, (out.offset.x - inX) * 0.18);
  const cy = out.offset.y;
  const ext = Math.max(Math.abs(inP.offset.y - cy), Math.abs(inN.offset.y - cy));
  const yMax = Math.min(cy - s.rect.y0, s.rect.y1 - cy);
  const hb = Math.max(ext + 0.5, Math.min(yMax - 0.15, (apex - back) * 0.45));
  const tri: Tri = { back, apex, cy, hb, halfAt: (x) => hb * Math.max(0, 1 - (x - back) / (apex - back)) };
  poly(g, [back, cy - hb, apex, cy, back, cy + hb], true, s.col.body);
  // inputs / output leads
  ln(g, inP.offset.x, inP.offset.y, back, inP.offset.y);
  ln(g, inN.offset.x, inN.offset.y, back, inN.offset.y);
  const clip = s.running ? String(s.st?.clipping ?? 'none') : 'none';
  g.save();
  if (!comparator && clip !== 'none' && clip !== 'undefined') g.strokeStyle = '#c04000';
  ln(g, apex, cy, out.offset.x, out.offset.y);
  g.restore();
  // supply leads into the slanted edges
  for (const p of [vp, vn]) {
    if (!p) continue;
    const x = Math.max(back + 0.05, Math.min(apex - 0.05, p.offset.x));
    const h = tri.halfAt(x);
    const ey = p.offset.y < cy ? cy - h : cy + h;
    ln(g, p.offset.x, p.offset.y, x, ey);
    s.text(x + 0.18, p.offset.y < cy ? ey - 0.32 : ey + 0.32, p === vp ? 'V+' : 'V−', 0.26, { color: s.col.dim, mono: true, align: 'left' });
  }
  // + / − marks just inside the back edge
  const mk = 0.13, mx = back + 0.32;
  g.save();
  g.lineWidth = s.lw * 0.9;
  ln(g, mx - mk, inN.offset.y, mx + mk, inN.offset.y);
  ln(g, mx - mk, inP.offset.y, mx + mk, inP.offset.y); ln(g, mx, inP.offset.y - mk, mx, inP.offset.y + mk);
  g.restore();
  const cx = back + (apex - back) * 0.45;
  if (comparator) {
    // hysteresis glyph (two offset steps)
    g.save(); g.lineWidth = s.lw * 0.8;
    const w = 0.22, h = 0.16;
    poly(g, [cx - w * 1.6, cy + h, cx + w * 0.4, cy + h, cx + w * 0.4, cy - h, cx + w * 1.6, cy - h]);
    poly(g, [cx - w * 1.6, cy + h, cx - w * 0.4, cy + h, cx - w * 0.4, cy - h, cx + w * 1.6, cy - h]);
    g.restore();
    // open-collector mark near the output: underlined diamond
    const ox = apex - (apex - back) * 0.2, d = 0.1;
    g.save(); g.lineWidth = s.lw * 0.8;
    poly(g, [ox - d, cy, ox, cy - d, ox + d, cy, ox, cy + d], true);
    ln(g, ox - d, cy + d * 1.6, ox + d, cy + d * 1.6);
    g.restore();
    if (s.running && s.st?.sinking === true) s.text(out.offset.x - 0.1, cy - 0.35, 'L', 0.26, { color: s.col.dim, mono: true, align: 'right' });
  } else if (clip === 'high' || clip === 'low') {
    s.text(cx, cy + 0.02, 'SAT', 0.24, { color: '#c04000', weight: '700', mono: true });
  }
}

export const opamp = (s: SymCtx): void => amplifierTriangle(s, false);
export const comparator = (s: SymCtx): void => amplifierTriangle(s, true);

// ---------------------------------------------------------------------------
// regulator / DIP ICs
// ---------------------------------------------------------------------------

export function regulator(s: SymCtx): void {
  const model = String(s.c.props?.model ?? '7805');
  let title = model;
  if (model === 'custom') {
    const v = num(s.c.props?.voltage, 5);
    title = `${v}V`;
  }
  const box = icBox(s, title, { subtitle: 'REG', notch: false });
  if (s.running) {
    const mode = String(s.st?.mode ?? '');
    if (mode && mode !== 'REG') s.text(rectMid(box).x, box.y0 + 0.28, mode, 0.24, { color: '#c04000', weight: '700', mono: true });
  }
}

/** DIP box with explicit labels: active-low names get a leading '/'. */
function dip(s: SymCtx, title: string, subtitle: string, activeLow: RegExp): Rect2 {
  const box = icBox(s, title, { subtitle, labels: false });
  for (const pd of s.pins) {
    const e = edgePoint(box, pd.offset);
    const name = activeLow.test(pd.name) ? `/${pd.name}` : pd.name;
    s.text(e.p.x + e.n.x * 0.15, e.p.y + e.n.y * 0.15, name, 0.3, { inward: e.n, color: s.col.dim, mono: true });
  }
  return box;
}

type Rect2 = { x0: number; y0: number; x1: number; y1: number };

function edgePoint(box: Rect2, p: Vec2): { p: Vec2; n: Vec2 } {
  if (p.x <= box.x0) return { p: { x: box.x0, y: p.y }, n: { x: 1, y: 0 } };
  if (p.x >= box.x1) return { p: { x: box.x1, y: p.y }, n: { x: -1, y: 0 } };
  if (p.y <= box.y0) return { p: { x: p.x, y: box.y0 }, n: { x: 0, y: 1 } };
  return { p: { x: p.x, y: box.y1 }, n: { x: 0, y: -1 } };
}

function bitRow(s: SymCtx, box: Rect2, bits: unknown[], y: number, n: number): void {
  const g = s.g;
  const c = rectMid(box);
  const w = 0.28, gap = 0.08;
  const total = n * w + (n - 1) * gap;
  g.save();
  g.lineWidth = s.lw * 0.6;
  for (let i = 0; i < n; i++) {
    const x = c.x - total / 2 + i * (w + gap);
    const on = bits[i] === true || (typeof bits[i] === 'number' && (bits[i] as number) > 0.5);
    g.beginPath(); g.rect(x, y, w, w);
    g.fillStyle = on ? '#e03020' : s.col.fill;
    g.fill(); g.stroke();
    if (on) s.glow(x + w / 2, y + w / 2, w * 1.4, [255, 60, 40], 0.5);
  }
  g.restore();
}

export function shift595(s: SymCtx): void {
  const box = dip(s, '595', 'SHIFT REG', /^(oe|srclr)$/i);
  if (s.running && Array.isArray(s.st?.outputs)) {
    bitRow(s, box, (s.st!.outputs as unknown[]).slice(0, 8), rectMid(box).y + 1.1, 8);
  }
}

export function decoder138(s: SymCtx): void {
  const box = dip(s, '138', '3→8 DEC', /^(g2a|g2b|y\d)$/i);
  if (s.running && Array.isArray(s.st?.outputs)) {
    // outputs are active-low: lit = selected (LOW)
    const bits = (s.st!.outputs as unknown[]).slice(0, 8).map((b) => b === false);
    bitRow(s, box, bits, rectMid(box).y + 1.1, 8);
  }
}

export function hbridge(s: SymCtx): void {
  const box = icBox(s, 'H-BRIDGE', { subtitle: 'L293' });
  const g = s.g;
  const c = rectMid(box);
  const dir = s.running ? String(s.st?.direction ?? '') : '';
  const y = c.y + 1.2;
  g.save();
  g.lineWidth = s.lw * 1.1;
  if (dir === 'forward') { g.strokeStyle = '#107010'; arrow(g, c.x - 0.6, y, c.x + 0.6, y, 0.25); }
  else if (dir === 'reverse') { g.strokeStyle = '#107010'; arrow(g, c.x + 0.6, y, c.x - 0.6, y, 0.25); }
  else if (dir === 'brake') { ln(g, c.x - 0.4, y - 0.08, c.x + 0.4, y - 0.08); ln(g, c.x - 0.4, y + 0.08, c.x + 0.4, y + 0.08); }
  g.restore();
}

// ---------------------------------------------------------------------------
// electromechanical
// ---------------------------------------------------------------------------

export function motor(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const len = Math.hypot(pp[1].offset.x - pp[0].offset.x, pp[1].offset.y - pp[0].offset.y);
  const ang = s.running ? num(s.st?.angleDeg) * DEG : 0;
  twoTerm(s, pp[0].offset, pp[1].offset, Math.min(1.7, len - 0.3), (bl, av) => {
    const r = Math.min(bl / 2, Math.max(av, 0.62));
    circ(g, 0, 0, r, s.col.body);
    s.text(0, 0, 'M', r * 0.85, { weight: '700' });
    // rotor indicator: a dot on a rim track that turns with the shaft
    g.save();
    g.lineWidth = s.lw * 0.6;
    g.strokeStyle = s.col.dim;
    circ(g, 0, 0, r * 0.82, null);
    g.restore();
    const px = Math.cos(ang) * r * 0.82, py = Math.sin(ang) * r * 0.82;
    circ(g, px, py, Math.max(0.06, r * 0.1), s.running ? '#0a246a' : (g.strokeStyle as string), false);
    // + mark at the first pin side
    g.save(); g.lineWidth = s.lw * 0.8;
    const mx = -r - 0.18, my = -0.3, k = 0.08;
    ln(g, mx - k, my, mx + k, my); ln(g, mx, my - k, mx, my + k);
    g.restore();
  });
}

export function servo(s: SymCtx): void {
  const g = s.g;
  const box = bodyBox(s, 0.5);
  g.save();
  roundRect(g, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 0.12);
  g.fillStyle = s.col.body; g.fill(); g.stroke();
  g.restore();
  const stubs = pinStubs(s, box);
  for (const st of stubs) s.text(st.e.x + st.n.x * 0.15, st.e.y + st.n.y * 0.15, st.pin.name, 0.26, { inward: st.n, color: s.col.dim, mono: true });
  const range = num(s.c.props?.range, 180);
  const deg = s.running && typeof s.st?.angleDeg === 'number' ? (s.st.angleDeg as number) : num(s.c.props?.initialAngle, range / 2);
  // pivot towards the side without pins (horn side)
  const sig = findPin(s.pins, /^sig$/i);
  const c = rectMid(box);
  const side = sig && sig.offset.x < c.x ? 1 : -1;
  const pv = { x: c.x + side * (box.x1 - box.x0) * 0.18, y: c.y };
  const L = Math.min((box.x1 - box.x0) * 0.42, (box.y1 - box.y0) * 0.42, 1.1);
  // 0° .. range sweeps symmetric around the outward direction
  const a = (deg - range / 2) * DEG + (side > 0 ? 0 : Math.PI);
  const ex = pv.x + Math.cos(a) * L, ey = pv.y + Math.sin(a) * L;
  g.save();
  g.lineWidth = s.lw * 0.6; g.strokeStyle = s.col.dim;
  g.beginPath(); g.arc(pv.x, pv.y, L * 0.9, (-range / 2) * DEG + (side > 0 ? 0 : Math.PI), (range / 2) * DEG + (side > 0 ? 0 : Math.PI)); g.stroke();
  g.restore();
  g.save();
  g.lineWidth = s.lw * 2.2;
  if (s.running) g.strokeStyle = '#0a246a';
  ln(g, pv.x, pv.y, ex, ey);
  g.restore();
  circ(g, ex, ey, 0.08, s.col.body);
  circ(g, pv.x, pv.y, 0.16, s.col.body);
  s.text(c.x - side * (box.x1 - box.x0) * 0.22, box.y1 - 0.25, 'SERVO', 0.22, { color: s.col.dim, weight: '600' });
}

// ---------------------------------------------------------------------------
// passives
// ---------------------------------------------------------------------------

export function thermistor(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 1.6, (bl, av) => {
    const h = Math.min(0.3, av * 0.6);
    g.save();
    g.beginPath(); g.rect(-bl / 2, -h, bl, h * 2);
    g.fillStyle = s.col.body; g.fill(); g.stroke();
    // diagonal with a flat foot (non-linear, temperature dependent)
    const dx = bl / 2 + 0.12, dy = Math.min(0.62, av + 0.05);
    poly(g, [-dx - 0.32, dy, -dx, dy, dx, -dy]);
    g.restore();
    s.text(dx - 0.05, dy + 0.02, '−t°', 0.26, { color: s.col.text, mono: true, align: 'left' });
  });
}

export function fuse(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const blown = s.running && (s.st?.blown === true || s.c.props?.blown === true);
  const heat = s.running ? Math.max(0, Math.min(1, num(s.st?.heat))) : 0;
  twoTerm(s, pp[0].offset, pp[1].offset, 1.5, (bl, av) => {
    const h = Math.min(0.24, av * 0.5);
    g.save();
    g.beginPath(); g.rect(-bl / 2, -h, bl, h * 2);
    g.fillStyle = heat > 0.5 && !blown ? `rgba(255,${200 - 120 * heat | 0},60,0.35)` : s.col.body;
    g.fill(); g.stroke();
    g.restore();
    g.save();
    if (blown) {
      g.strokeStyle = '#c00000';
      ln(g, -bl / 2, 0, -0.18, 0);
      ln(g, 0.18, 0, bl / 2, 0);
      ln(g, -0.18, 0, -0.08, -0.12);
      ln(g, 0.18, 0, 0.08, 0.12);
    } else ln(g, -bl / 2, 0, bl / 2, 0);
    g.restore();
  });
}

export function clockSource(s: SymCtx): void {
  const g = s.g;
  const out = findPin(s.pins, /^out$/i) ?? s.pins[0];
  if (!out) return;
  const box = bodyBox(s, 0.5);
  g.save();
  roundRect(g, box.x0 + 0.1, box.y0 + 0.1, box.x1 - box.x0 - 0.1, box.y1 - box.y0 - 0.2, 0.12);
  g.fillStyle = s.col.body; g.fill(); g.stroke();
  g.restore();
  pinStubs(s, box, [out] as PinDef[]);
  const c = rectMid(box);
  const w = Math.min(1.6, (box.x1 - box.x0) * 0.6), h = Math.min(0.32, (box.y1 - box.y0) * 0.2);
  const hi = s.running && s.st?.on === true;
  g.save();
  g.lineWidth = s.lw * 1.1;
  if (hi) g.strokeStyle = '#c00000';
  const x0 = c.x - w / 2;
  poly(g, [x0, c.y + h, x0 + w * 0.2, c.y + h, x0 + w * 0.2, c.y - h, x0 + w * 0.5, c.y - h, x0 + w * 0.5, c.y + h, x0 + w * 0.8, c.y + h, x0 + w * 0.8, c.y - h, x0 + w, c.y - h]);
  g.restore();
  if (hi) s.glow(out.offset.x, out.offset.y, 0.5, [255, 60, 40], 0.5);
  s.text(c.x, box.y1 - 0.18, 'CLK', 0.22, { color: s.col.dim, weight: '600', baseline: 'bottom' });
}
