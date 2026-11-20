import type { PinDef, Vec2 } from '@core/types';
import { switchOn } from '../format';
import { circ, findPin, ln, pinPair, twoTerm, type SymCtx } from './draw';

function contact(s: SymCtx, x: number, y: number): void {
  circ(s.g, x, y, 0.09, s.col.fill);
}

function hotStroke(s: SymCtx): void {
  if (s.running && s.hover) s.g.strokeStyle = s.col.hot;
}

/** SPST lever between two points (in the current frame). */
function spstBetween(s: SymCtx, pa: Vec2, pb: Vec2, closed: boolean): void {
  const g = s.g;
  twoTerm(s, pa, pb, 1.4, (bl) => {
    const x0 = -bl / 2, x1 = bl / 2;
    g.save();
    hotStroke(s);
    const ang = closed ? 0.06 : 0.5;
    const L = bl * (closed ? 1 : 0.96);
    ln(g, x0, 0, x0 + Math.cos(ang) * L, -Math.sin(ang) * L);
    g.restore();
    contact(s, x0, 0);
    contact(s, x1, 0);
  });
}

export function spst(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  spstBetween(s, pp[0].offset, pp[1].offset, switchOn(s.c, s.st, s.running));
}

/** Identify the common pin of a 3-pin changeover: by name, else the one apart from the other two. */
function splitSpdt(pins: PinDef[]): { com: PinDef; off: PinDef; on: PinDef } | null {
  if (pins.length < 3) return null;
  let com = findPin(pins, /^(c|com|common|p|pole|0|in)$/i);
  if (!com) {
    let best = pins[0], bd = Infinity;
    for (const cand of pins) {
      const o = pins.filter((p) => p !== cand);
      const d = Math.hypot(o[0].offset.x - o[1].offset.x, o[0].offset.y - o[1].offset.y);
      if (d < bd) { bd = d; best = cand; }
    }
    com = best;
  }
  const rest = pins.filter((p) => p !== com);
  // engine: SPDT pins [COM, A, B], state.on = COM-A closed; relay: on = COM-NO
  let on = findPin(rest, /^(no|a|1|t1|on|out1)$/i);
  let off = findPin(rest, /^(nc|b|2|t2|off|out2)$/i, on ? [on] : []);
  if (!on) on = rest.find((p) => p !== off) ?? rest[1];
  if (!off) off = rest.find((p) => p !== on) ?? rest[0];
  return { com, off, on };
}

function spdtDraw(s: SymCtx, sp: { com: PinDef; off: PinDef; on: PinDef }, on: boolean): Vec2 {
  const g = s.g;
  const cp = sp.com.offset, t1 = sp.off.offset, t2 = sp.on.offset;
  const K = { x: (t1.x + t2.x) / 2, y: (t1.y + t2.y) / 2 };
  let ux = K.x - cp.x, uy = K.y - cp.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L; uy /= L;
  const vx = -uy, vy = ux;
  const proj = (p: Vec2): { u: number; v: number } => ({ u: (p.x - cp.x) * ux + (p.y - cp.y) * uy, v: (p.x - cp.x) * vx + (p.y - cp.y) * vy });
  const at = (u: number, v: number): Vec2 => ({ x: cp.x + ux * u + vx * v, y: cp.y + uy * u + vy * v });
  const lead = Math.min(0.5, L * 0.25);
  const P = at(lead, 0);
  ln(g, cp.x, cp.y, P.x, P.y);
  const qs: Vec2[] = [];
  for (const t of [t1, t2]) {
    const pr = proj(t);
    const q = at(Math.max(lead + 0.6, pr.u - Math.min(0.5, pr.u * 0.25)), pr.v);
    ln(g, q.x, q.y, t.x, t.y);
    qs.push(q);
  }
  const tgt = on ? qs[1] : qs[0];
  g.save();
  hotStroke(s);
  const dx = tgt.x - P.x, dy = tgt.y - P.y, dl = Math.hypot(dx, dy) || 1;
  ln(g, P.x, P.y, tgt.x - (dx / dl) * 0.1, tgt.y - (dy / dl) * 0.1);
  g.restore();
  contact(s, P.x, P.y);
  for (const q of qs) contact(s, q.x, q.y);
  return { x: (P.x + tgt.x) / 2, y: (P.y + tgt.y) / 2 };
}

export function spdt(s: SymCtx): void {
  const sp = splitSpdt(s.pins);
  if (!sp) return spst(s);
  spdtDraw(s, sp, switchOn(s.c, s.st, s.running));
}

export function pushButton(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const pressed = switchOn(s.c, s.st, s.running);
  twoTerm(s, pp[0].offset, pp[1].offset, 1.2, (bl) => {
    const x0 = -bl / 2, x1 = bl / 2;
    contact(s, x0, 0); contact(s, x1, 0);
    g.save();
    hotStroke(s);
    const by = pressed ? -0.12 : -0.36;
    ln(g, x0 - 0.06, by, x1 + 0.06, by);
    ln(g, 0, by, 0, -0.72);
    ln(g, -0.2, -0.72, 0.2, -0.72);
    g.restore();
  });
}

const COIL = /coil|^(a1|a2|l1|l2|k1|k2|c1|c2|coil[+-]?|in[+-]?)$/i;

export function relay(s: SymCtx): void {
  const g = s.g;
  let coil = s.pins.filter((p) => COIL.test(p.name));
  if (coil.length !== 2) coil = s.pins.slice(0, 2);
  const contacts = s.pins.filter((p) => !coil.includes(p));
  const energised = switchOn(s.c, s.st, s.running);
  let coilMid: Vec2 | null = null;
  if (coil.length === 2) {
    const a = coil[0].offset, b = coil[1].offset;
    coilMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    twoTerm(s, a, b, 0.9, (bl, av) => {
      const h = Math.min(0.45, av * 0.9);
      g.save();
      g.beginPath(); g.rect(-bl / 2, -h, bl, h * 2);
      g.fillStyle = energised && s.running ? 'rgba(90,170,255,0.18)' : s.col.body; g.fill(); g.stroke();
      ln(g, -bl / 2, h, bl / 2, -h);
      g.restore();
    });
  }
  let lever: Vec2 | null = null;
  if (contacts.length >= 3) {
    const sp = splitSpdt(contacts);
    if (sp) lever = spdtDraw(s, sp, energised);
  } else if (contacts.length === 2) {
    const a = contacts[0].offset, b = contacts[1].offset;
    spstBetween(s, a, b, energised);
    lever = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (coilMid && lever) {
    g.save();
    g.setLineDash([0.12, 0.1]);
    g.lineWidth = s.lw * 0.7;
    ln(g, coilMid.x, coilMid.y, lever.x, lever.y);
    g.restore();
  }
}
