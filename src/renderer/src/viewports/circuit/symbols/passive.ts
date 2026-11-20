import type { PinDef, Vec2 } from '@core/types';
import { potValue } from '../format';
import { arrowHead, circ, findPin, humps, icBox, ln, pinPair, rectMid, twoTerm, zigzag, type SymCtx } from './draw';

export function resistor(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  twoTerm(s, pp[0].offset, pp[1].offset, 2.0, (bl, av) => zigzag(s.g, -bl / 2, bl / 2, Math.min(0.28, av * 0.8), 6));
}

function farthestPair(pins: PinDef[]): [PinDef, PinDef] {
  let best: [PinDef, PinDef] = [pins[0], pins[1]], bd = -1;
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const d = Math.hypot(pins[i].offset.x - pins[j].offset.x, pins[i].offset.y - pins[j].offset.y);
    if (d > bd) { bd = d; best = [pins[i], pins[j]]; }
  }
  return best;
}

export function potentiometer(s: SymCtx): void {
  if (s.pins.length < 3) return resistor(s);
  const wiper = findPin(s.pins, /^(w|wiper|wip|tap)$/i);
  const ends = wiper ? s.pins.filter((p) => p !== wiper).slice(0, 2) as [PinDef, PinDef] : farthestPair(s.pins);
  const wp = wiper ?? s.pins.find((p) => !ends.includes(p))!;
  const pos = potValue(s.c, s.st, s.potOverride);
  const g = s.g;
  twoTerm(s, ends[0].offset, ends[1].offset, 2.0, (bl, av, f) => {
    const amp = Math.min(0.28, av * 0.6);
    zigzag(g, -bl / 2, bl / 2, amp, 6);
    const w = f.toFrame(wp.offset);
    const side = w.y < 0 ? -1 : 1;
    const tipX = -bl / 2 + bl * Math.max(0.05, Math.min(0.95, pos));
    const knee = side * Math.min(Math.abs(w.y), Math.max(amp + 0.45, 0.6));
    g.save();
    if (s.running) g.strokeStyle = s.hover ? s.col.hot : g.strokeStyle;
    g.beginPath();
    g.moveTo(w.x, w.y);
    g.lineTo(w.x, knee);
    g.lineTo(tipX, knee);
    g.lineTo(tipX, side * (amp + 0.14));
    g.stroke();
    arrowHead(g, tipX, knee, tipX, side * (amp + 0.02), 0.2);
    g.restore();
  });
}

function isPolarised(s: SymCtx): boolean {
  const p = s.c.props ?? {};
  if (p.polarized === true || p.polarised === true || p.electrolytic === true) return true;
  const kind = String(p.kind ?? p.variant ?? p.dielectric ?? p.capType ?? '');
  return /electro|polar|tant/i.test(kind) || s.pins.some((q) => q.name === '+');
}

export function capacitor(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const pol = isPolarised(s);
  const g = s.g;
  const gap = 0.26;
  twoTerm(s, pp[0].offset, pp[1].offset, gap, (_bl, av) => {
    const hp = Math.min(0.6, av);
    g.save();
    g.lineWidth = s.lw * 1.3;
    ln(g, -gap / 2, -hp, -gap / 2, hp);
    if (pol) {
      g.beginPath();
      g.moveTo(gap / 2 + 0.14, -hp);
      g.quadraticCurveTo(gap / 2 - 0.14, 0, gap / 2 + 0.14, hp);
      g.stroke();
    } else ln(g, gap / 2, -hp, gap / 2, hp);
    g.restore();
    if (pol) {
      g.save(); g.lineWidth = s.lw * 0.8;
      const px = -gap / 2 - 0.3, py = -hp * 0.75, k = 0.1;
      ln(g, px - k, py, px + k, py); ln(g, px, py - k, px, py + k);
      g.restore();
    }
  });
}

export function inductor(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 2.0, (bl, av) => {
    humps(g, -bl / 2, bl / 2, 4, -1);
    const core = s.c.props?.core;
    if (core === true || (typeof core === 'string' && core !== 'air' && core !== 'none')) {
      const y = Math.min(av * 0.8, 0.2);
      ln(g, -bl / 2, y, bl / 2, y);
      ln(g, -bl / 2, y + 0.1, bl / 2, y + 0.1);
    }
  });
}

export function transformer(s: SymCtx): void {
  const g = s.g;
  if (s.pins.length < 4) return inductor(s);
  const c = rectMid(s.rect);
  const pri = s.pins.filter((p) => /^(p|pri|in)/i.test(p.name));
  const sec = s.pins.filter((p) => /^(s|sec|out)/i.test(p.name));
  let A: PinDef[], B: PinDef[];
  if (pri.length === 2 && sec.length === 2) { A = pri; B = sec; }
  else {
    const byX = [...s.pins].sort((a, b) => a.offset.x - b.offset.x);
    const xs = byX[1].offset.x !== byX[2].offset.x;
    const sorted = xs ? byX : [...s.pins].sort((a, b) => a.offset.y - b.offset.y);
    A = sorted.slice(0, 2); B = sorted.slice(2, 4);
  }
  const coils: { pa: Vec2; pb: Vec2; mid: Vec2 }[] = [];
  let bodyLen = 2;
  for (const grp of [A, B]) {
    const [p1, p2] = [...grp].sort((a, b) => (a.offset.y - b.offset.y) || (a.offset.x - b.offset.x));
    const pa = p1.offset, pb = p2.offset;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    coils.push({ pa, pb, mid });
    g.save();
    twoTerm(s, pa, pb, 2.0, (bl, _av, f) => {
      bodyLen = bl;
      // humps toward the core (component centre)
      const toC = f.toFrame(c);
      humps(g, -bl / 2, bl / 2, 4, toC.y < 0 ? -1 : 1);
    });
    g.restore();
  }
  // core
  const m1 = coils[0].mid, m2 = coils[1].mid;
  const cm = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
  const dx = m2.x - m1.x, dy = m2.y - m1.y, L = Math.hypot(dx, dy) || 1;
  const nx = dx / L, ny = dy / L, tx = -ny, ty = nx;
  const h = bodyLen / 2;
  for (const o of [-0.09, 0.09]) ln(g, cm.x + nx * o - tx * h, cm.y + ny * o - ty * h, cm.x + nx * o + tx * h, cm.y + ny * o + ty * h);
  // dots at the first pin end of each coil, on the outside
  for (const [i, cl] of coils.entries()) {
    const out = i === 0 ? -1 : 1;
    const ax = cl.pb.x - cl.pa.x, ay = cl.pb.y - cl.pa.y, al = Math.hypot(ax, ay) || 1;
    const p = { x: cl.mid.x - (ax / al) * h * 0.85 + nx * out * 0.42, y: cl.mid.y - (ay / al) * h * 0.85 + ny * out * 0.42 };
    circ(g, p.x, p.y, 0.07, g.strokeStyle as string, false);
  }
}

export function crystal(s: SymCtx): void {
  if (s.pins.length >= 3) {
    // crystal oscillator module (VCC / GND / OUT): box with a crystal glyph
    const box = icBox(s, '', { notch: false });
    const g = s.g, c = rectMid(box);
    const hp = Math.min(0.45, (box.y1 - box.y0) * 0.22);
    const y = c.y - 0.25;
    ln(g, c.x - 0.7, y, c.x - 0.3, y); ln(g, c.x + 0.3, y, c.x + 0.7, y);
    ln(g, c.x - 0.3, y - hp, c.x - 0.3, y + hp); ln(g, c.x + 0.3, y - hp, c.x + 0.3, y + hp);
    g.beginPath(); g.rect(c.x - 0.16, y - hp * 0.8, 0.32, hp * 1.6); g.fillStyle = s.col.body; g.fill(); g.stroke();
    s.text(c.x, c.y + 0.55, 'OSC', 0.32, { weight: '700' });
    return;
  }
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[0].offset, pp[1].offset, 0.8, (bl, av) => {
    const hp = Math.min(0.55, av);
    ln(g, -bl / 2, -hp, -bl / 2, hp);
    ln(g, bl / 2, -hp, bl / 2, hp);
    g.beginPath(); g.rect(-0.17, -hp * 0.8, 0.34, hp * 1.6);
    g.fillStyle = s.col.body; g.fill(); g.stroke();
  }, 0.3);
}
