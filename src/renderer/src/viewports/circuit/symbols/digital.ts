import type { PinDef, Vec2 } from '@core/types';
import { circ, icBox, ln, rectMid, type SymCtx } from './draw';

export type GateKind = 'and' | 'or' | 'not' | 'nand' | 'xor' | 'nor' | 'xnor' | 'buf';

const OUT = /^(y|q|out|o|z|x|output)$/i;

export function gate(s: SymCtx, kind: GateKind): void {
  const g = s.g;
  const pins = s.pins;
  const c0 = rectMid(s.rect);
  let out = pins.find((p) => OUT.test(p.name) && !/^x$/i.test(p.name)) ?? pins.find((p) => OUT.test(p.name));
  if (!out && pins.length) out = pins.reduce((a, b) => (b.offset.x > a.offset.x ? b : a));
  const ins = pins.filter((p) => p !== out);
  // axis: from inputs toward output
  let u: Vec2 = { x: 1, y: 0 };
  if (out && ins.length) {
    const mi = { x: ins.reduce((t, p) => t + p.offset.x, 0) / ins.length, y: ins.reduce((t, p) => t + p.offset.y, 0) / ins.length };
    const dx = out.offset.x - mi.x, dy = out.offset.y - mi.y;
    u = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
  }
  const v = { x: -u.y, y: u.x };
  g.save();
  g.transform(u.x, u.y, v.x, v.y, c0.x, c0.y);
  const toF = (p: Vec2): Vec2 => ({ x: (p.x - c0.x) * u.x + (p.y - c0.y) * u.y, y: (p.x - c0.x) * v.x + (p.y - c0.y) * v.y });
  const fin = ins.map((p) => toF(p.offset));
  const fout = out ? toF(out.offset) : { x: 1.5, y: 0 };
  const inX = fin.length ? Math.max(...fin.map((p) => p.x)) : -1.5;
  const span = fout.x - inX;
  const Lb = Math.max(0.9, Math.min(2.0, span - 0.7));
  const bubble = kind === 'nand' || kind === 'not' || kind === 'nor' || kind === 'xnor';
  const br = 0.13;
  const x1 = inX + (span - Lb) / 2 + Lb - (bubble ? br : 0), x0 = x1 - Lb + (bubble ? br : 0);
  const cy = fout.y;
  const ext = fin.length ? Math.max(...fin.map((p) => Math.abs(p.y - cy))) : 0;
  let hb = Math.max(ext + 0.3, 0.6, Lb * 0.42);
  if (kind === 'not' || kind === 'buf') hb = Math.min(hb, Math.max(0.45, Lb * 0.45));
  const top = cy - hb, bot = cy + hb;
  const fill = s.col.body;
  g.beginPath();
  let backX = (_y: number): number => x0;
  if (kind === 'and' || kind === 'nand') {
    const xm = Math.max(x0 + 0.1, x1 - hb);
    const rr = x1 - xm;
    g.moveTo(x0, top); g.lineTo(xm, top);
    g.ellipse(xm, cy, rr, hb, 0, -Math.PI / 2, Math.PI / 2);
    g.lineTo(x0, bot); g.closePath();
  } else if (kind === 'not' || kind === 'buf') {
    g.moveTo(x0, top); g.lineTo(x1, cy); g.lineTo(x0, bot); g.closePath();
  } else {
    // OR family
    const xo = kind === 'xor' || kind === 'xnor' ? x0 + 0.2 : x0;
    const k = hb * 0.45;
    g.moveTo(xo, top);
    g.quadraticCurveTo(xo + (x1 - xo) * 0.62, top, x1, cy);
    g.quadraticCurveTo(xo + (x1 - xo) * 0.62, bot, xo, bot);
    g.quadraticCurveTo(xo + k, cy, xo, top);
    g.closePath();
    const bx = kind === 'xor' || kind === 'xnor' ? x0 : xo;
    backX = (y: number) => { const t = (y - top) / (bot - top); return bx + 2 * t * (1 - t) * k; };
  }
  g.fillStyle = fill; g.fill(); g.stroke();
  if (kind === 'xor' || kind === 'xnor') {
    const k = hb * 0.45;
    g.beginPath(); g.moveTo(x0, top); g.quadraticCurveTo(x0 + k, cy, x0, bot); g.stroke();
  }
  let tip = x1;
  if (bubble) { circ(g, x1 + br, cy, br, fill); tip = x1 + 2 * br; }
  // leads
  for (const p of fin) {
    const t = Math.max(top, Math.min(bot, p.y));
    const bxp = backX(t);
    if (p.y < top || p.y > bot) { ln(g, p.x, p.y, bxp, p.y); }
    else ln(g, p.x, p.y, bxp, p.y);
  }
  if (out) ln(g, tip, cy, fout.x, fout.y);
  g.restore();
}

export function counter(s: SymCtx): void {
  icBox(s, 'CTR', { subtitle: String(s.c.props?.bits ?? s.c.props?.modulus ?? '') || undefined });
}

export function bcdDecoder(s: SymCtx): void {
  icBox(s, 'BCD', { subtitle: '→ 7SEG' });
}

export function genericIC(s: SymCtx, title: string, sub?: string): void {
  if (!s.pins.length) {
    const g = s.g, r = s.rect;
    g.save(); g.beginPath(); g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); g.fillStyle = s.col.body; g.fill(); g.stroke(); g.restore();
    s.text((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, title, 0.35);
    return;
  }
  icBox(s, title, { subtitle: sub, notch: s.pins.length > 3 });
}

export type { PinDef };
