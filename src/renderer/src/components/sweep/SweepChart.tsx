/**
 * Classic line chart for sweep results: white plot area, grey grid, black axes, coloured series with
 * markers, left/right value axes (first two units), hover cursor and click-to-select a point.
 */
import { useRef, useState } from 'react';
import { useCanvas } from '../dock/canvas';
import { formatSI } from '../../lib/units';

export interface ChartSeries { label: string; unit: string; data: (number | null)[]; color: string }

export const SERIES_COLORS = ['#0000ff', '#ff0000', '#008000', '#800080', '#c06000', '#008080', '#808000', '#000080'];

const FONT = '11px Tahoma, "Microsoft Sans Serif", sans-serif';

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi - lo < 1e-300) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  }
  return out;
}

function fmt(v: number, unit: string): string {
  if (unit === '°' || unit === 'nm' || unit === 'mm' || unit === '') return `${Number(v.toPrecision(4))}${unit && unit !== '°' ? '' : unit}`;
  return formatSI(v, unit, 3);
}

function marker(g: CanvasRenderingContext2D, k: number, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.strokeStyle = color;
  const r = 3;
  switch (k % 4) {
    case 0: g.fillRect(Math.round(x) - r, Math.round(y) - r, 2 * r + 1, 2 * r + 1); break;
    case 1: g.beginPath(); g.arc(x, y, r + 0.5, 0, Math.PI * 2); g.fill(); break;
    case 2: g.beginPath(); g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y + r); g.lineTo(x - r - 1, y + r); g.closePath(); g.fill(); break;
    default: g.beginPath(); g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); g.fill();
  }
}

export function SweepChart({ x, xLabel, xUnit, logX, series, selected, onSelect, onHover }: {
  x: number[]; xLabel: string; xUnit: string; logX: boolean; series: ChartSeries[];
  selected: number | null; onSelect(i: number | null): void; onHover?(i: number | null): void;
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const geo = useRef<{ l: number; r: number; xs: number[] }>({ l: 0, r: 0, xs: [] });

  const ref = useCanvas((g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const units = [...new Set(series.map((s) => s.unit))];
    const leftU = units[0], rightU = units[1];
    const pad = { l: 58, r: rightU !== undefined ? 58 : 14, t: series.length ? 24 : 10, b: 34 };
    const pw = Math.max(10, w - pad.l - pad.r), ph = Math.max(10, h - pad.t - pad.b);
    g.font = FONT;
    if (!x.length) {
      g.fillStyle = '#808080'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('No sweep results yet — Simulation ▸ Parameter Sweep…', w / 2, h / 2);
      return;
    }
    // x scale
    const xv = x.filter((v) => Number.isFinite(v));
    let x0 = Math.min(...xv), x1 = Math.max(...xv);
    const useLog = logX && x0 > 0;
    if (x1 === x0) { x0 -= 0.5; x1 += 0.5; }
    const X = (v: number): number => pad.l + (useLog ? (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) : (v - x0) / (x1 - x0)) * pw;
    // y scales per unit (left: first unit, right: second; others normalised to the right axis)
    const range = (u: string): [number, number] => {
      let lo = Infinity, hi = -Infinity;
      for (const s of series) if (s.unit === u) for (const v of s.data) if (v !== null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!Number.isFinite(lo)) return [0, 1];
      if (hi - lo < Math.abs(hi) * 1e-9 + 1e-300) { const d = Math.abs(hi) * 0.05 || 1; return [lo - d, hi + d]; }
      const m = (hi - lo) * 0.06;
      return [lo - m, hi + m];
    };
    const ranges = new Map(units.map((u) => [u, range(u)] as const));
    const Y = (v: number, u: string): number => { const [lo, hi] = ranges.get(u)!; return pad.t + ph - ((v - lo) / (hi - lo)) * ph; };

    // grid + ticks
    g.strokeStyle = '#d8d8d8'; g.lineWidth = 1;
    g.fillStyle = '#000'; g.textBaseline = 'top'; g.textAlign = 'center';
    const xt = useLog ? logTicks(x0, x1) : niceTicks(x0, x1, Math.max(2, Math.floor(pw / 80)));
    for (const t of xt) {
      const px = Math.round(X(t)) + 0.5;
      if (px < pad.l - 1 || px > pad.l + pw + 1) continue;
      g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke();
      g.fillText(fmt(t, xUnit), px, pad.t + ph + 4);
    }
    const yAxis = (u: string | undefined, side: 'l' | 'r'): void => {
      if (u === undefined) return;
      const [lo, hi] = ranges.get(u)!;
      const yt = niceTicks(lo, hi, Math.max(2, Math.floor(ph / 36)));
      g.textBaseline = 'middle';
      g.textAlign = side === 'l' ? 'right' : 'left';
      for (const t of yt) {
        const py = Math.round(Y(t, u)) + 0.5;
        if (py < pad.t - 1 || py > pad.t + ph + 1) continue;
        if (side === 'l') { g.strokeStyle = '#d8d8d8'; g.beginPath(); g.moveTo(pad.l, py); g.lineTo(pad.l + pw, py); g.stroke(); }
        g.fillStyle = '#000';
        g.fillText(fmt(t, u), side === 'l' ? pad.l - 5 : pad.l + pw + 5, py);
        g.strokeStyle = '#000'; g.beginPath();
        if (side === 'l') { g.moveTo(pad.l - 3, py); g.lineTo(pad.l, py); } else { g.moveTo(pad.l + pw, py); g.lineTo(pad.l + pw + 3, py); }
        g.stroke();
      }
    };
    yAxis(leftU, 'l');
    yAxis(rightU, 'r');
    // axes
    g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad.l + 0.5, pad.t); g.lineTo(pad.l + 0.5, pad.t + ph + 0.5); g.lineTo(pad.l + pw, pad.t + ph + 0.5);
    if (rightU !== undefined) { g.moveTo(pad.l + pw + 0.5, pad.t); g.lineTo(pad.l + pw + 0.5, pad.t + ph + 0.5); }
    g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = '#000';
    g.fillText(`${xLabel}${xUnit ? ` (${xUnit})` : ''}${useLog ? '  [log]' : ''}`, pad.l + pw / 2, h - 2);

    // series (clip to plot)
    g.save();
    g.beginPath(); g.rect(pad.l, pad.t - 4, pw + 1, ph + 8); g.clip();
    series.forEach((s, k) => {
      const u = s.unit;
      g.strokeStyle = s.color; g.lineWidth = 1.5;
      g.beginPath();
      let pen = false;
      s.data.forEach((v, i) => {
        if (v === null || !Number.isFinite(v) || i >= x.length) { pen = false; return; }
        const px = X(x[i]), py = Y(v, u);
        if (!pen) { g.moveTo(px, py); pen = true; } else g.lineTo(px, py);
      });
      g.stroke();
      s.data.forEach((v, i) => { if (v !== null && Number.isFinite(v) && i < x.length) marker(g, k, X(x[i]), Y(v, u), s.color); });
    });
    g.restore();

    // cursor + selection
    const vline = (i: number, dashed: boolean, color: string): void => {
      if (i < 0 || i >= x.length) return;
      const px = Math.round(X(x[i])) + 0.5;
      g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dashed ? [3, 2] : []);
      g.beginPath(); g.moveTo(px, pad.t); g.lineTo(px, pad.t + ph); g.stroke();
      g.setLineDash([]);
    };
    if (selected !== null) {
      vline(selected, false, '#0a246a');
      series.forEach((s) => {
        const v = s.data[selected];
        if (v === null || v === undefined || !Number.isFinite(v)) return;
        const px = X(x[selected]), py = Y(v, s.unit);
        g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(Math.round(px) - 5.5, Math.round(py) - 5.5, 11, 11);
      });
    }
    if (hover !== null && hover !== selected) vline(hover, true, '#000');

    // legend: one row above the plot area
    g.font = FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
    let lx = pad.l;
    series.forEach((s, k) => {
      const tag = s.unit === rightU && rightU !== leftU ? ' →' : '';
      const text = `${s.label}${s.unit ? ` [${s.unit}]` : ''}${tag}`;
      const tw = g.measureText(text).width;
      if (lx + 24 + tw > w - 4 && lx > pad.l) return;
      g.strokeStyle = s.color; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(lx, 10); g.lineTo(lx + 18, 10); g.stroke();
      marker(g, k, lx + 9, 10, s.color);
      g.fillStyle = '#000';
      g.fillText(text, lx + 22, 10.5, w - lx - 26);
      lx += 22 + tw + 16;
    });
    geo.current = { l: pad.l, r: pad.l + pw, xs: x.map((v) => X(v)) };
  }, [x, series, selected, hover, logX, xLabel, xUnit]);

  const nearest = (clientX: number): number | null => {
    const c = ref.current;
    if (!c || !x.length) return null;
    const r = c.getBoundingClientRect();
    const px = clientX - r.left;
    const { l, r: rr, xs } = geo.current;
    if (px < l - 12 || px > rr + 12) return null;
    let bi = 0, bd = Infinity;
    xs.forEach((v, i) => { const d = Math.abs(v - px); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };

  return (
    <canvas
      ref={ref}
      aria-label="Sweep chart"
      onMouseMove={(e) => { const i = nearest(e.clientX); if (i !== hover) { setHover(i); onHover?.(i); } }}
      onMouseLeave={() => { setHover(null); onHover?.(null); }}
      onClick={(e) => onSelect(nearest(e.clientX))}
    />
  );
}
