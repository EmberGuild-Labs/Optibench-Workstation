import { formatSI } from '../format';
import { circ, humps, ln, pinPair, rectMid, roundRect, twoTerm, type SymCtx } from './draw';

const WARM: [number, number, number] = [255, 196, 102];

export function lamp(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const b = s.running ? Math.max(0, Math.min(1, Number(s.st?.brightness ?? 0))) : 0;
  const len = Math.hypot(pp[1].offset.x - pp[0].offset.x, pp[1].offset.y - pp[0].offset.y);
  twoTerm(s, pp[0].offset, pp[1].offset, Math.min(1.3, len - 0.3), (bl, av) => {
    const r = Math.min(bl / 2, Math.max(av, 0.45));
    if (b > 0.005) s.glow(0, 0, r * (1.4 + 2.6 * b), WARM, Math.min(1, 0.2 + b));
    circ(g, 0, 0, r, b > 0.005 ? `rgba(255,${170 + 50 * b | 0},${40 + 60 * b | 0},${0.35 + 0.65 * b})` : s.col.body);
    const k = r * 0.7071;
    ln(g, -k, -k, k, k); ln(g, -k, k, k, -k);
  }, 0.15);
}

export function buzzer(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const st = s.st;
  const active = s.running && !!st && (Math.abs(Number(st.current ?? 0)) > 1e-4 || st.on === true || st.active === true);
  twoTerm(s, pp[0].offset, pp[1].offset, 1.0, (bl) => {
    const r = bl / 2;
    g.beginPath();
    g.moveTo(-r, 0); g.arc(0, 0, r, Math.PI, 0, false); g.closePath();
    g.fillStyle = s.col.body; g.fill(); g.stroke();
    ln(g, -r * 0.5, 0, -r * 0.5, -r * 0.4);
    if (active) {
      g.save();
      for (let i = 0; i < 3; i++) {
        const ph = (s.time * 3 + i / 3) % 1;
        g.globalAlpha = 1 - ph;
        g.beginPath(); g.arc(0, 0, r + 0.15 + ph * 0.6, -Math.PI * 0.42, -Math.PI * 0.08); g.stroke();
      }
      g.restore();
    }
  });
}

export function coil(s: SymCtx): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const I = s.running ? Number(s.st?.current ?? 0) : 0;
  twoTerm(s, pp[0].offset, pp[1].offset, 2.0, (bl, av) => {
    // iron core
    const ch = Math.min(0.14, av * 0.3);
    g.save();
    g.fillStyle = '#a0a0a0';
    g.fillRect(-bl / 2 - 0.15, -0.05 - ch, bl + 0.3, ch * 2);
    g.restore();
    humps(g, -bl / 2, bl / 2, 4, -1);
    // field lines (dashed loops); brighter + animated with current
    const k = Math.min(1, Math.abs(I) / 0.5);
    g.save();
    g.lineWidth = s.lw * 0.7;
    g.setLineDash([0.12, 0.12]);
    g.lineDashOffset = -s.time * Math.sign(I) * 0.8;
    g.globalAlpha = 0.25 + 0.75 * k;
    if (k > 0.02) g.strokeStyle = '#1050c0';
    for (const sc of [1, 1.45]) {
      g.beginPath();
      g.ellipse(0, -0.05, bl / 2 + 0.35 * sc, Math.max(0.42, av * 0.6) * sc, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  });
}

export function meter(s: SymCtx, letter: 'V' | 'A'): void {
  const pp = pinPair(s.pins);
  if (!pp) return;
  const g = s.g;
  const len = Math.hypot(pp[1].offset.x - pp[0].offset.x, pp[1].offset.y - pp[0].offset.y);
  twoTerm(s, pp[0].offset, pp[1].offset, Math.min(1.6, len - 0.3), (bl, av) => {
    const r = Math.min(bl / 2, Math.max(av, 0.55));
    circ(g, 0, 0, r, s.col.body);
    // dial tick arc
    g.save(); g.lineWidth = s.lw * 0.6; g.beginPath(); g.arc(0, r * 0.25, r * 0.7, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke(); g.restore();
    s.text(0, r * 0.1, letter, r * 0.9, { weight: '700' });
    g.save(); g.lineWidth = s.lw * 0.8;
    const px = -r - 0.12, py = -0.28;
    ln(g, px - 0.08, py, px + 0.08, py); ln(g, px, py - 0.08, px, py + 0.08);
    g.restore();
    if (s.running) {
      const st = s.st;
      const txt = typeof st?.text === 'string' && st.text ? st.text
        : letter === 'V' ? formatSI(Number(st?.voltage ?? 0), 'V') : formatSI(Number(st?.current ?? 0), 'A');
      s.text(0, r + 0.42, txt, 0.34, { mono: true, color: '#000000', bg: '#ffffe1' });
    }
  });
}

const CH_COLORS = ['#f7d046', '#3fd4ff', '#ff5cc8', '#5b8cff'];

export function probe(s: SymCtx): void {
  const pin = s.pins[0];
  if (!pin) return;
  const g = s.g;
  const p = pin.offset;
  const c = rectMid(s.rect);
  let dx = c.x - p.x, dy = c.y - p.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { dx = 1; dy = -1; }
  const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
  const far = Math.max(0.8, Math.hypot(s.rect.x1 - s.rect.x0, s.rect.y1 - s.rect.y0) * 0.5 + dl * 0.5);
  const sc = Math.max(0.5, Math.min(1.3, far / 1.9));
  const ch = Math.max(1, Math.round(Number(s.c.props?.channel ?? 1)) || 1);
  const color = typeof s.c.props?.color === 'string' && s.c.props.color.startsWith('#') ? s.c.props.color : CH_COLORS[(ch - 1) % 4];
  g.save();
  g.transform(dx * sc, dy * sc, -dy * sc, dx * sc, p.x, p.y);
  g.lineWidth = s.lw / sc;
  ln(g, 0, 0, 0.4, 0);                       // needle
  roundRect(g, 0.4, -0.15, 1.1, 0.3, 0.1);   // body
  g.fillStyle = '#1e242c'; g.fill(); g.stroke();
  g.fillStyle = color;
  g.fillRect(0.58, -0.15, 0.14, 0.3);        // channel band
  g.strokeStyle = color;
  g.lineWidth = (s.lw * 1.8) / sc;
  g.beginPath(); g.moveTo(1.5, 0); g.quadraticCurveTo(1.75, 0, 1.9, 0.18); g.stroke(); // cable
  g.restore();
  const tx = p.x + dx * sc * 1.0 - dy * sc * 0.45, ty = p.y + dy * sc * 1.0 + dx * sc * 0.45;
  s.text(tx, ty, `CH${ch}`, 0.28, { color, weight: '700', mono: true });
}
