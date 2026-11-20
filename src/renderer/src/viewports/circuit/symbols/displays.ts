import { emitterRGB, rgba } from '../format';
import { bodyBox, circ, pinStubs, roundRect, type SymCtx } from './draw';

function moduleBody(s: SymCtx): { x0: number; y0: number; x1: number; y1: number } {
  const g = s.g;
  const box = bodyBox(s, 0.4);
  g.save();
  roundRect(g, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 0.15);
  g.fillStyle = '#07090c';
  g.fill();
  g.lineWidth = s.lw;
  g.stroke();
  g.restore();
  g.save();
  g.lineWidth = s.lw * 0.8;
  const stubs = pinStubs(s, box);
  g.restore();
  if (s.zoom > 26) {
    for (const st of stubs) s.text(st.e.x + st.n.x * 0.12, st.e.y + st.n.y * 0.12, st.pin.name, 0.24, { inward: st.n, color: s.col.dim, mono: true });
  }
  return box;
}

// segment polygons in a 0..1 (w=0.62) x 0..1 digit box, a..g
const W = 0.62, T = 0.1;
function segPoly(k: number): number[] {
  const h = (x0: number, x1: number, y: number): number[] => [x0, y, x0 + T / 2, y - T / 2, x1 - T / 2, y - T / 2, x1, y, x1 - T / 2, y + T / 2, x0 + T / 2, y + T / 2];
  const v = (x: number, y0: number, y1: number): number[] => [x, y0, x + T / 2, y0 + T / 2, x + T / 2, y1 - T / 2, x, y1, x - T / 2, y1 - T / 2, x - T / 2, y0 + T / 2];
  const g = 0.03;
  switch (k) {
    case 0: return h(T / 2 + g, W - T / 2 - g, T / 2);
    case 1: return v(W - T / 2, T / 2 + g, 0.5 - g);
    case 2: return v(W - T / 2, 0.5 + g, 1 - T / 2 - g);
    case 3: return h(T / 2 + g, W - T / 2 - g, 1 - T / 2);
    case 4: return v(T / 2, 0.5 + g, 1 - T / 2 - g);
    case 5: return v(T / 2, T / 2 + g, 0.5 - g);
    default: return h(T / 2 + g, W - T / 2 - g, 0.5);
  }
}

export function sevenSeg(s: SymCtx): void {
  const g = s.g;
  const box = moduleBody(s);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const H = Math.min(bh * 0.78, (bw * 0.78) / (W + 0.2));
  const ox = box.x0 + (bw - (W + 0.18) * H) / 2 + 0.06 * H, oy = box.y0 + (bh - H) / 2;
  const rgb = emitterRGB(s.c.props ?? {}, '#ff3b2f');
  const segs = s.running ? (s.st?.segments ?? []) : [];
  g.save();
  g.translate(ox, oy);
  g.transform(H, 0, -0.08 * H, H, 0.08 * H, 0); // italic skew
  for (let k = 0; k < 7; k++) {
    const v = Math.max(0, Math.min(1, Number(segs[k] ?? 0)));
    const pts = segPoly(k);
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    if (v > 0.02) {
      g.shadowColor = rgba(rgb, 0.9);
      g.shadowBlur = Math.max(2, 0.35 * s.zoom * s.dpr * v);
      g.fillStyle = rgba(rgb, 0.35 + 0.65 * v);
    } else {
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(60,40,40,0.35)';
    }
    g.fill();
  }
  const dp = Math.max(0, Math.min(1, Number(segs[7] ?? 0)));
  g.beginPath(); g.arc(W + 0.09, 1 - T / 2, T * 0.6, 0, Math.PI * 2);
  if (dp > 0.02) { g.shadowColor = rgba(rgb, 0.9); g.shadowBlur = Math.max(2, 0.35 * s.zoom * s.dpr * dp); g.fillStyle = rgba(rgb, 0.35 + 0.65 * dp); }
  else { g.shadowBlur = 0; g.fillStyle = 'rgba(60,40,40,0.35)'; }
  g.fill();
  g.restore();
}

export function ledMatrix(s: SymCtx): void {
  const g = s.g;
  const box = moduleBody(s);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const cell = Math.min(bw, bh) * 0.9 / 8;
  const ox = box.x0 + (bw - cell * 8) / 2, oy = box.y0 + (bh - cell * 8) / 2;
  const rgb = emitterRGB(s.c.props ?? {}, '#ff2d2d');
  const segs = s.running ? (s.st?.segments ?? []) : [];
  g.save();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = Math.max(0, Math.min(1, Number(segs[r * 8 + c] ?? 0)));
    const x = ox + cell * (c + 0.5), y = oy + cell * (r + 0.5);
    if (v > 0.02) {
      s.glow(x, y, cell * (0.6 + 0.6 * v), rgb, 0.5 * v);
      circ(g, x, y, cell * 0.36, rgba([Math.min(255, rgb[0] + 60 * v), Math.min(255, rgb[1] + 60 * v), Math.min(255, rgb[2] + 60 * v)], 0.4 + 0.6 * v), false);
    } else circ(g, x, y, cell * 0.36, '#1a1f27', false);
  }
  g.restore();
}
