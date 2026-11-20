/**
 * Gaussian beam envelope overlay (View ▸ Gaussian Beam Envelope): ±w(z) along each laser's axis,
 * from the exit aperture to the first interaction of its central rays, plus the waist marker.
 *   w(z) = w0 · sqrt(1 + ((z − z_waist) / z_R)²)      (gaussianBeamProfile of the optics engine)
 */
import type { OpticalComponent, TraceResult, Vec2, ViewState } from '@core/types';
import { gaussianBeamProfile } from '../../../../core/optics'; // relative: also loaded by vitest (no @core alias there)
import { worldToScreen } from './math';

export const GAUSSIAN_TYPES = new Set(['source.laser', 'source.laser_cavity']);

export interface EnvelopePath { id: string; upper: Vec2[]; lower: Vec2[]; waist: Vec2 | null; w0: number; zR: number; length: number }

/** w(z) of a beam profile (mm). */
export function beamRadius(z: number, p: { waistPos: number; w0: number; zR: number }): number {
  const zr = p.zR > 0 ? p.zR : 1e-9;
  const u = (z - p.waistPos) / zr;
  return p.w0 * Math.sqrt(1 + u * u);
}

/** Distance (mm) from the laser exit to its first interaction: median length of its depth-0 segments. */
export function firstInteraction(c: OpticalComponent, trace: TraceResult | null, fallback = 300): number {
  const L: number[] = [];
  for (const s of trace?.segments ?? []) {
    if (s.sourceId !== c.id || s.depth !== 0) continue;
    L.push(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
  }
  if (!L.length) return fallback;
  L.sort((a, b) => a - b);
  return Math.max(1, Math.min(5000, L[L.length >> 1]));
}

/** Envelope polylines in WORLD mm for every laser of the scene. */
export function envelopePaths(components: OpticalComponent[], trace: TraceResult | null): EnvelopePath[] {
  const out: EnvelopePath[] = [];
  for (const c of components) {
    if (!GAUSSIAN_TYPES.has(c.type)) continue;
    let gb: { waistPos: number; w0: number; zR: number; theta: number };
    try { gb = gaussianBeamProfile(c); } catch { continue; }
    if (!(gb.w0 > 0) || !Number.isFinite(gb.w0)) continue;
    const len = firstInteraction(c, trace);
    const dx = Math.cos(c.rotation), dy = Math.sin(c.rotation);
    const nx = -dy, ny = dx;
    const N = 48;
    const upper: Vec2[] = [], lower: Vec2[] = [];
    for (let i = 0; i <= N; i++) {
      const z = (len * i) / N;
      const w = beamRadius(z, gb);
      const x = c.position.x + dx * z, y = c.position.y + dy * z;
      upper.push({ x: x + nx * w, y: y + ny * w });
      lower.push({ x: x - nx * w, y: y - ny * w });
    }
    const waist = gb.waistPos >= 0 && gb.waistPos <= len ? { x: c.position.x + dx * gb.waistPos, y: c.position.y + dy * gb.waistPos } : null;
    out.push({ id: c.id, upper, lower, waist, w0: gb.w0, zR: gb.zR, length: len });
  }
  return out;
}

export function drawEnvelopes(ctx: CanvasRenderingContext2D, paths: EnvelopePath[], view: ViewState, w: number, h: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (const p of paths) {
    ctx.strokeStyle = 'rgba(255, 236, 140, 0.85)';
    ctx.setLineDash([4, 3]);
    for (const line of [p.upper, p.lower]) {
      ctx.beginPath();
      line.forEach((q, i) => { const s = worldToScreen(q, view, w, h); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (p.waist) {
      const s = worldToScreen(p.waist, view, w, h);
      ctx.strokeStyle = 'rgba(255, 236, 140, 0.95)';
      ctx.beginPath(); ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x + 4, s.y + 4); ctx.moveTo(s.x - 4, s.y + 4); ctx.lineTo(s.x + 4, s.y - 4); ctx.stroke();
    }
    const end = worldToScreen(p.upper[p.upper.length - 1], view, w, h);
    const label = `w0 ${fmtMm(p.w0)}  zR ${fmtMm(p.zR)}`;
    ctx.font = '11px Tahoma, "Microsoft Sans Serif", sans-serif';
    const tw = ctx.measureText(label).width;
    const x = Math.min(w - tw - 8, Math.max(4, end.x + 6)), y = Math.min(h - 6, Math.max(14, end.y - 4));
    ctx.fillStyle = 'rgba(16,18,20,0.8)';
    ctx.fillRect(x - 3, y - 11, tw + 6, 15);
    ctx.fillStyle = '#ffec8c';
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

function fmtMm(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 1000) return `${(v / 1000).toPrecision(3)} m`;
  if (v >= 1) return `${v.toPrecision(3)} mm`;
  return `${(v * 1000).toPrecision(3)} µm`;
}
