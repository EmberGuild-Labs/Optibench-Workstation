/**
 * 3D ray sampling of light sources (deterministic). Rays are returned in the source's L2 frame
 * (x = emission axis, y = 2D local y, z = up). Spectrum, power and polarization come from the 2D
 * engine's SourceSpec, so both engines emit the same light.
 *
 *   source.laser / .laser_cavity   circular TEM00 beam: centre ray + concentric rings out to 1.6 w (w = 1/e²
 *                       radius), weights = exact Gaussian power of each annulus; divergence = cone
 *                       (ray tilt grows linearly with radius, as in 2D)
 *   source.white/.beam  uniform round beam of diameter `beamWidth`, rings weighted by area
 *   source.led          cos^m cone (m from the half-intensity angle), Fibonacci-spiral directions
 *                       uniform in solid angle, emitted from a square chip of side `size`
 *   source.point        isotropic into a cone of full angle `spread` (360° = whole sphere), Fibonacci
 *   anything else       the 2D ray fan in the beam plane plus the same fan turned 90° about the axis
 *
 * Ring azimuths start at the in-plane direction, so every ring contributes rays that lie exactly in
 * the z = 0 plane (the 2D picture is a subset of the 3D one). The ray count is the 2D `rays` param.
 */
import type { OpticsSettings } from '../types';
import type { Props, SourceSpec } from '../optics/components/common';
import { DEG } from './math';

export interface Ray0 { x: number; y: number; z: number; dx: number; dy: number; dz: number; w: number }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function rayCount(P: Props, fallback: number): number {
  const r = Math.round(P.num('rays'));
  return Math.max(1, Math.min(4000, r > 0 ? r : fallback));
}

/** N points on a centre + K concentric rings; ring k (1..K) holds ~ proportional-to-k points. */
function rings(N: number): { K: number; counts: number[] } {
  if (N <= 1) return { K: 0, counts: [] };
  let K = Math.max(1, Math.round(Math.sqrt((N - 1) / 3)));
  while (K > 1 && (K * (K + 1)) / 2 > N - 1) K--;
  const S = (K * (K + 1)) / 2, counts: number[] = [];
  let used = 0;
  for (let k = 1; k <= K; k++) { const m = Math.max(1, Math.floor(((N - 1) * k) / S)); counts.push(m); used += m; }
  for (let k = K - 1; used < N - 1; k = k > 0 ? k - 1 : K - 1) { counts[k]++; used++; }
  return { K, counts };
}

/** Round beam. `weight(a, b)` = relative power between radii a and b; `tilt(r)` = ray angle to the axis at radius r. */
function roundBeam(N: number, rmax: number, weight: (a: number, b: number) => number, tilt: (frac: number) => number): Ray0[] {
  const { K, counts } = rings(N);
  if (K === 0) return [{ x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, w: 1 }];
  const d = rmax / (K + 0.5);
  const out: Ray0[] = [{ x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, w: weight(0, d / 2) }];
  for (let k = 1; k <= K; k++) {
    const m = counts[k - 1], r = k * d, wk = weight((k - 0.5) * d, (k + 0.5) * d) / m;
    const a = tilt(k / (K + 0.5)), ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < m; j++) {
      const phi = (2 * Math.PI * j) / m, c = Math.cos(phi), s = Math.sin(phi);
      out.push({ x: 0, y: r * c, z: r * s, dx: ca, dy: sa * c, dz: sa * s, w: wk });
    }
  }
  let sum = 0;
  for (const r of out) sum += r.w;
  if (!(sum > 0)) { for (const r of out) r.w = 1 / out.length; } else for (const r of out) r.w /= sum;
  return out;
}

/** Fibonacci spiral over the spherical cap of half-angle tmax about +x; `wOf(cos)` = relative intensity. */
function cap(N: number, tmax: number, wOf: (cosT: number) => number, size: number): Ray0[] {
  const out: Ray0[] = [];
  const cmin = Math.cos(tmax);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const ct = N === 1 ? 1 : 1 - ((i + 0.5) / N) * (1 - cmin);
    const st = Math.sqrt(Math.max(0, 1 - ct * ct)), phi = i * GOLDEN_ANGLE;
    const w = wOf(ct);
    const y = size > 0 ? ((((i + 0.5) * 0.6180339887) % 1) - 0.5) * size : 0;
    const z = size > 0 ? ((((i + 0.5) * 0.7548776662) % 1) - 0.5) * size : 0;
    out.push({ x: 0, y, z, dx: ct, dy: st * Math.cos(phi), dz: st * Math.sin(phi), w });
    sum += w;
  }
  for (const r of out) r.w /= sum || 1;
  return out;
}

export function sampleSource(type: string, P: Props, spec: SourceSpec, settings: OpticsSettings): Ray0[] {
  const N = rayCount(P, settings.raysPerSource);
  switch (type) {
    case 'source.laser':
    case 'source.laser_cavity': {
      // divergence as the 2D engine derived it (manual value or Gaussian-beam M² model): read the
      // tilt-per-radius off the 2D fan; a single-ray fan carries it in `wdv`
      const w = P.pos('beamDiameter') / 2;
      let half = (P.num('divergence') * 1e-3) / 2;
      let far = spec.spatial[0];
      for (const q of spec.spatial) if (Math.abs(q.y) > Math.abs(far.y)) far = q;
      if (far && Math.abs(far.y) > 1e-12) half = (far.ang / far.y) * w;
      else if (far && typeof far.wdv === 'number') half = far.wdv;
      const rmax = 1.6 * w;
      const g = (r: number) => Math.exp((-2 * r * r) / (w * w));
      return roundBeam(N, rmax, (a, b) => g(a) - g(b), (frac) => ((frac * rmax) / w) * half);
    }
    case 'source.white':
    case 'source.beam': {
      const W = Math.max(0, P.num('beamWidth')), half = (P.num('divergence') * DEG) / 2;
      return roundBeam(N, W / 2, (a, b) => (W > 0 ? b * b - a * a : 1), (frac) => frac * half);
    }
    case 'source.led': {
      const half = Math.min(85, Math.max(2, P.num('halfAngle'))) * DEG;
      const m = -Math.LN2 / Math.log(Math.cos(half));
      const tmax = Math.min(89 * DEG, Math.acos(Math.pow(0.02, 1 / m)));
      return cap(N, tmax, (ct) => Math.pow(ct, m), Math.max(0, P.num('size')));
    }
    case 'source.point': {
      const spread = Math.min(360, Math.max(0.01, P.num('spread'))) * DEG;
      return cap(N, spread / 2, () => 1, 0);
    }
    default: {
      // unknown source type: lift the 2D fan (in-plane) and add a copy turned 90° about the axis
      const out: Ray0[] = [];
      for (const r of spec.spatial) {
        const ca = Math.cos(r.ang), sa = Math.sin(r.ang);
        if (Math.abs(r.y) < 1e-12 && Math.abs(sa) < 1e-12) { out.push({ x: r.x, y: 0, z: 0, dx: ca, dy: 0, dz: 0, w: r.w }); continue; }
        out.push({ x: r.x, y: r.y, z: 0, dx: ca, dy: sa, dz: 0, w: r.w / 2 });
        out.push({ x: r.x, y: 0, z: r.y, dx: ca, dy: 0, dz: sa, w: r.w / 2 });
      }
      return out;
    }
  }
}
