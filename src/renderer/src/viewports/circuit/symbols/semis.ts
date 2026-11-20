import type { PinDef, Vec2 } from '@core/types';
import { emitterRGB, rgba } from '../format';
import { arrow, arrowHead, circ, findPin, lightArrows, ln, pinPair, poly, twoTerm, zigzag, type SymCtx } from './draw';

const ANODE = /^(a|anode|\+|p|1|in)$/i;

function diodeShape(s: SymCtx, hh: number, fill?: string | null): void {
  poly(s.g, [-0.32, -hh, -0.32, hh, 0.32, 0], true, fill ?? null);
}

export function diode(s: SymCtx): void {
  const pp = pinPair(s.pins, ANODE);
  if (!pp) return;
  twoTerm(s, pp[0].offset, pp[1].offset, 0.64, (_bl, av) => {
    const hh = Math.min(0.4, av);
    diodeShape(s, hh, s.col.body);
    ln(s.g, 0.32, -hh, 0.32, hh);
  });
}

export function zener(s: SymCtx): void {
  const pp = pinPair(s.pins, ANODE);
  if (!pp) return;
  twoTerm(s, pp[0].offset, pp[1].offset, 0.64, (_bl, av) => {
    const hh = Math.min(0.4, av);
    diodeShape(s, hh, s.col.body);
    poly(s.g, [0.2, -hh - 0.08, 0.32, -hh, 0.32, hh, 0.44, hh + 0.08]);
  });
}

function brightnessOf(s: SymCtx): number {
  if (!s.running || !s.st) return 0;
  const b = s.st.brightness;
  if (typeof b === 'number') return Math.max(0, Math.min(1, b));
  const op = s.st.opticalPower;
  if (typeof op === 'number') return Math.max(0, Math.min(1, op / (Number(s.c.props?.power) || 0.005)));
  return 0;
}

export function led(s: SymCtx): void {
  const pp = pinPair(s.pins, ANODE);
  if (!pp) return;
  const rgb = emitterRGB(s.c.props ?? {}, '#ff3030');
  const b = brightnessOf(s);
  twoTerm(s, pp[0].offset, pp[1].offset, 0.64, (_bl, av) => {
    const hh = Math.min(0.4, av);
    if (b > 0.005) s.glow(0, 0, 0.5 + 1.6 * b, rgb, Math.min(1, 0.25 + b));
    diodeShape(s, hh, b > 0.005 ? rgba(rgb, 0.25 + 0.75 * b) : s.col.body);
    ln(s.g, 0.32, -hh, 0.32, hh);
    lightArrows(s, 0.02, -hh - 0.08, false, b > 0.05 ? rgba(rgb, 0.6 + 0.4 * b) : undefined);
  });
}

export function laserDiode(s: SymCtx): void {
  const pp = pinPair(s.pins, ANODE);
  if (!pp) return;
  const rgb = emitterRGB(s.c.props ?? {}, '#ff2020');
  const b = brightnessOf(s);
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 0.64, (_bl, av) => {
    const hh = Math.min(0.4, av);
    if (b > 0.005) s.glow(0.1, -hh - 0.35, 0.4 + 1.2 * b, rgb, Math.min(1, 0.3 + b));
    diodeShape(s, hh, b > 0.005 ? rgba(rgb, 0.3 + 0.7 * b) : s.col.body);
    ln(g, 0.32, -hh, 0.32, hh);
    // parallel straight "coherent" arrows going up
    g.save();
    if (b > 0.05) g.strokeStyle = rgba(rgb, 0.7 + 0.3 * b);
    for (const x of [-0.1, 0.16]) arrow(g, x, -hh - 0.05, x, -hh - 0.55, 0.13);
    g.restore();
  });
}

export function photodiode(s: SymCtx): void {
  const pp = pinPair(s.pins, ANODE);
  if (!pp) return;
  twoTerm(s, pp[0].offset, pp[1].offset, 0.64, (_bl, av) => {
    const hh = Math.min(0.4, av);
    diodeShape(s, hh, s.col.body);
    ln(s.g, 0.32, -hh, 0.32, hh);
    lightArrows(s, -0.12, -hh - 0.06, true, lightColor(s));
  });
}

function lightColor(s: SymCtx): string | undefined {
  const op = s.st?.opticalPower;
  if (s.running && typeof op === 'number' && op > 0) return '#d08000';
  return undefined;
}

export function ldr(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 1.6, (bl, av) => {
    const r = Math.min(bl / 2 + 0.1, Math.max(av, 0.55));
    zigzag(g, -bl / 2, bl / 2, Math.min(0.22, av * 0.6), 6);
    g.save(); g.lineWidth = s.lw * 0.8; circ(g, 0, 0, Math.min(r, bl / 2 + 0.12)); g.restore();
    lightArrows(s, -0.3, -Math.min(r, bl / 2 + 0.12) + 0.02, true, lightColor(s));
  });
}

export function solarCell(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 1.2, (bl, av) => {
    const r = Math.min(bl / 2, Math.max(0.5, av));
    g.save(); g.lineWidth = s.lw * 0.8; circ(g, 0, 0, r, s.col.body); g.restore();
    const hp = r * 0.6;
    ln(g, -bl / 2, 0, -0.1, 0); ln(g, 0.1, 0, bl / 2, 0);
    ln(g, -0.1, -hp, -0.1, hp);
    g.save(); g.lineWidth = s.lw * 2; ln(g, 0.1, -hp * 0.5, 0.1, hp * 0.5); g.restore();
    lightArrows(s, -0.55, -r - 0.05, true, lightColor(s));
  }, 0.1);
}

// ---------------------------------------------------------------------------
// transistors
// ---------------------------------------------------------------------------

interface TFrame { L: number; c: Vec2; e: Vec2 }

/** Frame with origin at the control pin, +x toward the other two, the first of them at -y. */
function transistorFrame(s: SymCtx, ctl: PinDef, top: PinDef, bot: PinDef): TFrame {
  const B = ctl.offset, C = top.offset, E = bot.offset;
  const K = { x: (C.x + E.x) / 2, y: (C.y + E.y) / 2 };
  let ux = K.x - B.x, uy = K.y - B.y;
  let L = Math.hypot(ux, uy);
  if (L < 0.3) { ux = 1; uy = 0; L = 1.5; } else { ux /= L; uy /= L; }
  let vx = -uy, vy = ux;
  if ((C.x - B.x) * vx + (C.y - B.y) * vy > 0) { vx = -vx; vy = -vy; }
  s.g.transform(ux, uy, vx, vy, B.x, B.y);
  const to = (p: Vec2): Vec2 => ({ x: (p.x - B.x) * ux + (p.y - B.y) * uy, y: (p.x - B.x) * vx + (p.y - B.y) * vy });
  return { L, c: to(C), e: to(E) };
}

export function bjt(s: SymCtx, pnp: boolean): void {
  const B = findPin(s.pins, /^(b|base)$/i) ?? s.pins[0];
  const C = findPin(s.pins, /^(c|col|collector)$/i, [B]) ?? s.pins.find((p) => p !== B)!;
  const E = findPin(s.pins, /^(e|emit|emitter)$/i, [B, C]) ?? s.pins.find((p) => p !== B && p !== C)!;
  if (!B || !C || !E) return;
  const g = s.g;
  g.save();
  const f = transistorFrame(s, B, C, E);
  const cu = f.c.x, eu = f.e.x;
  const reach = Math.min(cu, eu);
  const barX = Math.max(reach * 0.35, reach - 0.75);
  const kc = -Math.min(0.62, Math.abs(f.c.y)), ke = Math.min(0.62, Math.abs(f.e.y));
  // envelope
  const cx = (barX + reach) / 2 + 0.02, r = Math.max(0.72, (reach - barX) / 2 + 0.42);
  g.save(); g.lineWidth = s.lw * 0.8; circ(g, cx, 0, r, s.col.body); g.restore();
  ln(g, 0, 0, barX, 0);
  g.save(); g.lineWidth = s.lw * 2.2; ln(g, barX, -0.42, barX, 0.42); g.restore();
  // collector
  ln(g, barX, -0.18, cu, kc);
  ln(g, cu, kc, f.c.x, f.c.y);
  // emitter
  ln(g, barX, 0.18, eu, ke);
  ln(g, eu, ke, f.e.x, f.e.y);
  const t = pnp ? 0.35 : 0.8;
  const ax = barX + (eu - barX) * t, ay = 0.18 + (ke - 0.18) * t;
  if (pnp) arrowHead(g, eu, ke, barX + (eu - barX) * 0.25, 0.18 + (ke - 0.18) * 0.25, 0.22);
  else arrowHead(g, barX, 0.18, ax, ay, 0.22);
  g.restore();
}

export function mosfet(s: SymCtx, pmos: boolean): void {
  const G = findPin(s.pins, /^(g|gate)$/i) ?? s.pins[0];
  const D = findPin(s.pins, /^(d|drain)$/i, [G]) ?? s.pins.find((p) => p !== G)!;
  const S = findPin(s.pins, /^(s|source)$/i, [G, D]) ?? s.pins.find((p) => p !== G && p !== D)!;
  if (!G || !D || !S) return;
  const g = s.g;
  g.save();
  // PMOS conventionally has source on top: keep the drain at -y for NMOS, source for PMOS
  const f = pmos ? transistorFrame(s, G, S, D) : transistorFrame(s, G, D, S);
  const top = f.c, bot = f.e;
  const reach = Math.min(top.x, bot.x);
  const barX = Math.max(reach * 0.45, reach - 0.65);
  const gx = barX - 0.2;
  const kt = -Math.min(0.42, Math.abs(top.y)), kb = Math.min(0.42, Math.abs(bot.y));
  const cx = (gx + reach) / 2, r = Math.max(0.72, (reach - gx) / 2 + 0.4);
  g.save(); g.lineWidth = s.lw * 0.8; circ(g, cx, 0, r, s.col.body); g.restore();
  // gate
  ln(g, 0, 0, gx, 0);
  ln(g, gx, -0.42, gx, 0.42);
  // channel (enhancement: 3 segments)
  g.save(); g.lineWidth = s.lw * 1.6;
  ln(g, barX, -0.55, barX, -0.25); ln(g, barX, -0.12, barX, 0.12); ln(g, barX, 0.25, barX, 0.55);
  g.restore();
  // top / bottom terminals
  ln(g, barX, kt, top.x, kt); ln(g, top.x, kt, top.x, top.y);
  ln(g, barX, kb, bot.x, kb); ln(g, bot.x, kb, bot.x, bot.y);
  // body connection to source with arrow
  const srcY = pmos ? kt : kb, srcX = pmos ? top.x : bot.x;
  ln(g, barX, 0, srcX, 0); ln(g, srcX, 0, srcX, srcY);
  if (pmos) arrowHead(g, barX, 0, barX + 0.42, 0, 0.2);
  else arrowHead(g, srcX, 0, barX + 0.04, 0, 0.2);
  g.restore();
}
