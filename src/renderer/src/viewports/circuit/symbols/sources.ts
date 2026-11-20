import { formatSI } from '../format';
import { arrow, circ, icBox, ln, pinPair, rectMid, roundRect, twoTerm, type SymCtx } from './draw';

function plus(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  ln(g, x - k, y, x + k, y); ln(g, x, y - k, x, y + k);
}

export function battery(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const cells = Math.max(1, Math.min(3, Number(s.c.props?.cells ?? 2) || 2));
  const pitch = 0.22;
  const bl = pitch * (cells * 2 - 1);
  twoTerm(s, pp[0].offset, pp[1].offset, bl, (b, av) => {
    const hp = Math.min(0.6, av);
    for (let i = 0; i < cells * 2; i++) {
      const x = -b / 2 + (b / (cells * 2 - 1)) * i;
      g.save();
      if (i % 2 === 0) ln(g, x, -hp, x, hp);
      else { g.lineWidth = s.lw * 2; ln(g, x, -hp * 0.5, x, hp * 0.5); }
      g.restore();
    }
    g.save(); g.lineWidth = s.lw * 0.8; plus(g, -b / 2 - 0.25, -hp * 0.8, 0.09); g.restore();
  });
}

function waveGlyph(g: CanvasRenderingContext2D, kind: string, r: number): void {
  const w = r * 1.2, h = r * 0.45;
  g.beginPath();
  if (/squ|pulse|pwm/i.test(kind)) {
    g.moveTo(-w / 2, h); g.lineTo(-w / 2, -h); g.lineTo(0, -h); g.lineTo(0, h); g.lineTo(w / 2, h); g.lineTo(w / 2, -h);
  } else if (/tri/i.test(kind)) {
    g.moveTo(-w / 2, 0); g.lineTo(-w / 4, -h); g.lineTo(w / 4, h); g.lineTo(w / 2, 0);
  } else if (/saw|ramp/i.test(kind)) {
    g.moveTo(-w / 2, h); g.lineTo(0, -h); g.lineTo(0, h); g.lineTo(w / 2, -h);
  } else {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = -w / 2 + w * t, y = -Math.sin(t * Math.PI * 2) * h;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.stroke();
}

function circleSource(s: SymCtx, inner: (r: number) => void, rmax = 0.75): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const len = Math.hypot(pp[1].offset.x - pp[0].offset.x, pp[1].offset.y - pp[0].offset.y);
  twoTerm(s, pp[0].offset, pp[1].offset, Math.min(rmax * 2, len - 0.4), (bl) => {
    const r = bl / 2;
    circ(g, 0, 0, r, s.col.body);
    // rotate back so the glyph is drawn perpendicular to the leads (classic look)
    g.save(); g.rotate(-Math.PI / 2); inner(r); g.restore();
  });
}

export function acSource(s: SymCtx): void {
  circleSource(s, (r) => waveGlyph(s.g, 'sine', r));
}

export function functionGen(s: SymCtx): void {
  const kind = String(s.c.props?.waveform ?? s.c.props?.wave ?? s.c.props?.shape ?? 'sine');
  if (s.pins.length !== 2) {
    const box = icBox(s, 'FG', { notch: false });
    const c = rectMid(box);
    s.g.save(); s.g.translate(c.x, c.y + 0.45); waveGlyph(s.g, kind, 0.6); s.g.restore();
    return;
  }
  circleSource(s, (r) => waveGlyph(s.g, kind, r));
}

export function currentSource(s: SymCtx): void {
  const pp = pinPair(s.pins, /^(\+|out|p|pos|1)$/i);
  if (!pp) return;
  const g = s.g;
  twoTerm(s, pp[1].offset, pp[0].offset, 1.4, (bl) => {
    const r = bl / 2;
    circ(g, 0, 0, r, s.col.body);
    arrow(g, -r * 0.6, 0, r * 0.6, 0, 0.22);
  });
}

export function ground(s: SymCtx): void {
  const pin = s.pins[0];
  if (!pin) return;
  const g = s.g;
  const p = pin.offset;
  const c = rectMid(s.rect);
  let dx = c.x - p.x, dy = c.y - p.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { dx = 0; dy = 1; }
  if (Math.abs(dx) >= Math.abs(dy)) { dx = Math.sign(dx); dy = 0; } else { dy = Math.sign(dy); dx = 0; }
  const far = dx > 0 ? s.rect.x1 - p.x : dx < 0 ? p.x - s.rect.x0 : dy > 0 ? s.rect.y1 - p.y : p.y - s.rect.y0;
  const lead = Math.max(0.2, Math.min(0.6, far - 0.35));
  g.save();
  g.transform(dy, -dx, dx, dy, p.x, p.y); // frame y axis points from the pin into the body
  ln(g, 0, 0, 0, lead);
  const widths = [0.5, 0.32, 0.14];
  widths.forEach((w, i) => ln(g, -w, lead + i * 0.15, w, lead + i * 0.15));
  g.restore();
}

export function psu(s: SymCtx): void {
  const g = s.g;
  const box = icBox(s, '', { notch: false, labels: false });
  const c = rectMid(box);
  // pin markers
  for (const pd of s.pins) {
    const pos = /^(\+|p|pos|v\+|out\+?)$/i.test(pd.name);
    const neg = /^(-|−|n|neg|gnd|com|v-|out-)$/i.test(pd.name);
    const ex = Math.max(box.x0, Math.min(box.x1, pd.offset.x)), ey = Math.max(box.y0, Math.min(box.y1, pd.offset.y));
    const ix = ex + Math.sign(c.x - ex) * 0.32, iy = ey + Math.sign(c.y - ey) * 0.32;
    g.save();
    circ(g, ix, iy, 0.15, pos ? '#d9443a' : neg ? '#20252d' : s.col.body);
    g.restore();
    s.text(ix, iy, pos ? '+' : neg ? '−' : pd.name, 0.26, { weight: '700', color: '#fff' });
  }
  const V = s.running && typeof s.st?.voltage === 'number' ? s.st.voltage : Number(s.c.props?.voltage ?? 0);
  const I = s.running && typeof s.st?.current === 'number' ? Math.abs(s.st.current) : Number(s.c.props?.currentLimit ?? s.c.props?.current ?? 0);
  const w = Math.min(box.x1 - box.x0 - 0.5, 2.6), h = Math.min(box.y1 - box.y0 - 0.4, 1.0);
  if (w > 0.6 && h > 0.4) {
    g.save();
    roundRect(g, c.x - w / 2, c.y - h / 2, w, h, 0.08);
    g.fillStyle = '#071a12'; g.fill();
    g.lineWidth = s.lw * 0.6; g.stroke();
    g.restore();
    const lcd = s.running ? '#5dff9c' : '#2f7a52';
    s.text(c.x, c.y - h * 0.2, `${formatSI(V, 'V')}`, Math.min(0.36, h * 0.4), { color: lcd, mono: true, weight: '600' });
    s.text(c.x, c.y + h * 0.24, `${formatSI(I, 'A')}`, Math.min(0.28, h * 0.32), { color: lcd, mono: true });
  } else s.text(c.x, c.y, 'PSU', 0.35, { weight: '600' });
  s.text(c.x, box.y0 + 0.2, 'PSU', 0.22, { color: s.col.dim, baseline: 'top' });
}

export function ic555(s: SymCtx): void {
  icBox(s, '555', { subtitle: 'TIMER' });
}
