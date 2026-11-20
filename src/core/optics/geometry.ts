/**
 * Geometry primitives shared by the tracer and getGeometry().
 *
 * Components describe themselves with LOCAL-space primitives (segments, circular arcs, parabolas);
 * the same primitives are (a) converted to world-space `Surf` records for exact analytic ray
 * intersection and (b) tessellated to polylines for drawing, so what is drawn is what is traced.
 *
 * Conventions: +x right, +y DOWN, rotation positive = clockwise on screen. With y down the usual
 * matrix [c -s; s c] is a clockwise rotation on screen, so world = pos + R(rot) * local.
 */
import type { Vec2 } from '../types';
import type { Material } from './materials';

export type Prim =
  | { k: 'seg'; ax: number; ay: number; bx: number; by: number }
  /** Circular arc traversed from angle a0 to a1 (radians, may decrease). */
  | { k: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }
  /** Parabola x = -y^2/(4f), |y| <= h (vertex at local origin, focus at x = -f). Optional y0..y1 selects an off-axis section. */
  | { k: 'par'; f: number; h: number; y0?: number; y1?: number };

export interface Xf { px: number; py: number; cs: number; sn: number }

export const makeXf = (pos: Vec2, rot: number): Xf => ({ px: pos.x, py: pos.y, cs: Math.cos(rot), sn: Math.sin(rot) });
export const IDENTITY: Xf = { px: 0, py: 0, cs: 1, sn: 0 };

export function toWorld(xf: Xf, x: number, y: number): Vec2 {
  return { x: xf.px + xf.cs * x - xf.sn * y, y: xf.py + xf.sn * x + xf.cs * y };
}

/** Surface behaviour kinds. */
export const SK = {
  REFRACT: 0, THIN: 1, METAL: 2, DETECTOR: 3, PBS: 4, IDEAL: 5, GRATING: 6, JONES: 7, FIELD: 8, FIBER: 9, DIFFRACT: 10,
  /** Wave-mode diffracting aperture plane (records the incident field, re-emits Huygens-Fresnel fans). */
  WAVEAP: 11,
  /** Acousto-optic Bragg cell: p1 = acoustic wavelength (mm), p2 = peak efficiency, p3 = interaction length (mm), p4 = crystal index. */
  AOM: 12,
  /** Ground-glass diffuser: p1 = cone half angle (rad), p2 = rays, p3 = seed, p4 = transmission. */
  DIFFUSE: 13,
  /** Transparent tally plane: adds the power of rays crossing along the front normal's opposite to det.aux. */
  TALLY: 14,
} as const;

export interface Body {
  mat: Material;
  /** 0 none, 1 single-layer MgF2 quarter-wave (exact thin-film), 2 ideal AR (R = 0). */
  coating: number;
  alphaExtra: number;          // extra absorption 1/mm
  bx: number; by: number;      // magnetic flux density vector in world frame (T)
  vol: Volume | null;          // gradient-index volume
  shg: { kappa: number; pm: number; bw: number } | null;
  comp: CComp | null;
  /** Per-wavelength cache of [phase index, group index] (filled lazily by the tracer). */
  nc?: Map<number, Float64Array>;
}

/** A region in which rays follow curved paths (GRIN medium or gravitational field). */
export interface Volume {
  kind: 'grin' | 'gravity';
  /** Evaluate index at world point; writes gradient into gx, gy. Returns n (or -1 for "captured"). */
  eval(x: number, y: number, wl: number): number;
  gx: number; gy: number;
  step(x: number, y: number): number;
  comps: CComp[];              // components to hit-test while marching (incl. own boundary)
  cx: number; cy: number; radius: number; // gravity only
}

export type DetectorKind = 'power' | 'screen' | 'spectrometer' | 'photodiode' | 'camera' | 'polarimeter' | 'wavemeter' | 'concentrator';

export interface DetectorRT {
  id: string; kind: DetectorKind;
  power: number; profile: number[] | null; spectrum: number[] | null;
  hits: { p: Vec2; wavelength: number; power: number }[] | null;
  range: [number, number];
  /** Linear RGB profile (3 per bin) for screens / cameras. */
  rgb?: number[] | null;
  /** Camera: exposure (s), gain, saturation energy (J), auto-exposure. */
  cam?: { exposure: number; gain: number; sat: number; auto: boolean } | null;
  /** Unnormalised Stokes sums (W). */
  st?: Float64Array | null;
  /** Wavemeter sums: P, P*wl, P*wl^2, P*fwhm^2. */
  wm?: Float64Array | null;
  /** Concentrator: geometric concentration and power that entered the entrance aperture. */
  cg?: number; aux?: number;
  /** Wave mode: recorded field samples (see wave.ts) and the face they were recorded on. */
  wh?: unknown[] | null; face?: Surf | null;
  /** Never sum coherently on this detector (e.g. concentrator absorber). */
  incoh?: boolean;
}

/** Wave-mode aperture plane: openings as [lo, hi] fractions-of-length positions (mm along the face from its start point). */
export interface WaveApRT {
  open: [number, number][];
  hits: unknown[];
  pending: number;
}

export interface FiberRT {
  nCore: number; na: number; lengthM: number; model: string; attDb: number; pm: boolean;
  faces: Surf[]; // [A, B]
}

/** World-space surface record (monomorphic for speed). g: 0 segment, 1 arc, 2 parabola. */
export interface Surf {
  g: number;
  ax: number; ay: number; ex: number; ey: number; len: number; nx: number; ny: number; // segment (n = canonical normal)
  cx: number; cy: number; r: number; mx: number; my: number; cosHalf: number;          // arc
  xf: Xf; f: number; h: number; h0: number; h1: number;                                  // parabola (h0..h1 = local y range)
  /** Multiplies the canonical normal (segment: (ey,-ex)/len, arc: radial, parabola: local +x side) to give the outward / front normal. */
  sign: number;
  kind: number;
  comp: CComp;
  body: Body | null;
  // behaviour data
  rt: ((wl: number, out: Float64Array) => void) | null; // THIN: out[0]=R, out[1]=T
  backAbsorb: boolean;                                  // THIN / METAL: only the front side is active
  metal: ((wl: number, out: Float64Array) => void) | null; // METAL: complex index
  rScale: number;
  det: DetectorRT | null;
  jones: ((wl: number, forward: boolean, M: Float64Array) => void) | null;
  p1: number; p2: number; p3: number; p4: number;       // kind-specific numbers
  vol: Volume | null;
  fiber: FiberRT | null;
  end: number;
  /** Sequential id within one trace (branch hashing in wave mode). */
  idx: number;
  wap: WaveApRT | null;
}

export interface CComp {
  id: string;
  surfs: Surf[];
  minx: number; miny: number; maxx: number; maxy: number;
}

export function blankSurf(comp: CComp): Surf {
  return {
    g: 0, ax: 0, ay: 0, ex: 0, ey: 0, len: 0, nx: 0, ny: 0, cx: 0, cy: 0, r: 0, mx: 0, my: 0, cosHalf: 0,
    xf: IDENTITY, f: 0, h: 0, h0: 0, h1: 0, sign: 1, kind: SK.THIN, comp, body: null, rt: null, backAbsorb: false, metal: null,
    rScale: 1, det: null, jones: null, p1: 0, p2: 0, p3: 0, p4: 0, vol: null, fiber: null, end: 0, idx: 0, wap: null,
  };
}

/** Convert a local primitive into a world-space surface. */
export function primToSurf(p: Prim, xf: Xf, comp: CComp): Surf {
  const s = blankSurf(comp);
  if (p.k === 'seg') {
    const a = toWorld(xf, p.ax, p.ay), b = toWorld(xf, p.bx, p.by);
    s.g = 0; s.ax = a.x; s.ay = a.y; s.ex = b.x - a.x; s.ey = b.y - a.y;
    s.len = Math.hypot(s.ex, s.ey) || 1e-12;
    s.nx = s.ey / s.len; s.ny = -s.ex / s.len;
  } else if (p.k === 'arc') {
    const c = toWorld(xf, p.cx, p.cy);
    const rot = Math.atan2(xf.sn, xf.cs);
    const mid = (p.a0 + p.a1) / 2 + rot;
    s.g = 1; s.cx = c.x; s.cy = c.y; s.r = p.r; s.mx = Math.cos(mid); s.my = Math.sin(mid);
    const half = Math.abs(p.a1 - p.a0) / 2;
    s.cosHalf = half >= Math.PI ? -2 : Math.cos(half);
  } else {
    s.g = 2; s.xf = xf; s.f = p.f; s.h = p.h;
    s.h0 = p.y0 ?? -p.h; s.h1 = p.y1 ?? p.h;
    if (s.h0 > s.h1) { const t = s.h0; s.h0 = s.h1; s.h1 = t; }
  }
  return s;
}

/** Tessellate a primitive into local-space points (inclusive of both ends). */
export function tessellate(p: Prim, out: number[]): void {
  if (p.k === 'seg') {
    out.push(p.ax, p.ay, p.bx, p.by);
  } else if (p.k === 'arc') {
    const sweep = p.a1 - p.a0;
    // chord error below ~2 um or 3 degrees per step, whichever is finer (capped)
    const byErr = Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - 0.002 / Math.max(p.r, 0.01))));
    const n = Math.max(6, Math.min(128, Math.ceil(Math.max(byErr, Math.abs(sweep) / 0.12))));
    for (let i = 0; i <= n; i++) {
      const a = p.a0 + (sweep * i) / n;
      out.push(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a));
    }
  } else {
    const n = 48;
    const lo = p.y0 ?? -p.h, hi = p.y1 ?? p.h;
    for (let i = 0; i <= n; i++) {
      const y = lo + ((hi - lo) * i) / n;
      out.push(-(y * y) / (4 * p.f), y);
    }
  }
}

// ---------------------------------------------------------------------------
// Ray / surface intersection. Results are written to the module-level `hit` record.
// ---------------------------------------------------------------------------

export const hit = { t: 0, nx: 0, ny: 0, u: 0 };

/**
 * Smallest t in (tmin, tmax) at which the ray o + t d meets the surface, or -1.
 * Does not compute the normal; call `surfNormal` for the accepted hit.
 */
export function intersect(s: Surf, ox: number, oy: number, dx: number, dy: number, tmin: number, tmax: number): number {
  if (s.g === 0) {
    const den = dx * s.ey - dy * s.ex;
    if (den > -1e-14 && den < 1e-14) return -1;
    const wx = s.ax - ox, wy = s.ay - oy;
    const t = (wx * s.ey - wy * s.ex) / den;
    if (t <= tmin || t >= tmax) return -1;
    const u = (wx * dy - wy * dx) / den;
    if (u < 0 || u > 1) return -1;
    return t;
  }
  if (s.g === 1) {
    const ocx = ox - s.cx, ocy = oy - s.cy;
    const b = ocx * dx + ocy * dy;
    const c = ocx * ocx + ocy * ocy - s.r * s.r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    // numerically stable roots
    const q = b > 0 ? -b - sq : -b + sq;
    let t0 = q, t1 = q !== 0 ? c / q : -b;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    const lim = s.cosHalf * s.r;
    if (t0 > tmin && t0 < tmax) {
      if ((ocx + t0 * dx) * s.mx + (ocy + t0 * dy) * s.my >= lim) return t0;
    }
    if (t1 > tmin && t1 < tmax) {
      if ((ocx + t1 * dx) * s.mx + (ocy + t1 * dy) * s.my >= lim) return t1;
    }
    return -1;
  }
  // parabola: work in the local frame
  const xf = s.xf;
  const rx = ox - xf.px, ry = oy - xf.py;
  const lx = xf.cs * rx + xf.sn * ry, ly = -xf.sn * rx + xf.cs * ry;
  const ldx = xf.cs * dx + xf.sn * dy, ldy = -xf.sn * dx + xf.cs * dy;
  const f4 = 4 * s.f;
  const A = ldy * ldy, B = 2 * ly * ldy + f4 * ldx, C = ly * ly + f4 * lx;
  let best = -1;
  if (A < 1e-14) {
    if (B > -1e-14 && B < 1e-14) return -1;
    const t = -C / B;
    if (t > tmin && t < tmax) { const yy = ly + t * ldy; if (yy >= s.h0 && yy <= s.h1) best = t; }
    return best;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const q = -0.5 * (B + (B >= 0 ? sq : -sq));
  let t0 = q / A, t1 = q !== 0 ? C / q : t0;
  if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
  if (t0 > tmin && t0 < tmax) { const yy = ly + t0 * ldy; if (yy >= s.h0 && yy <= s.h1) return t0; }
  if (t1 > tmin && t1 < tmax) { const yy = ly + t1 * ldy; if (yy >= s.h0 && yy <= s.h1) return t1; }
  return -1;
}

/** Outward / front unit normal of surface `s` at world point (x, y) -> hit.nx, hit.ny (includes s.sign). */
export function surfNormal(s: Surf, x: number, y: number): void {
  if (s.g === 0) {
    hit.nx = s.nx * s.sign; hit.ny = s.ny * s.sign;
  } else if (s.g === 1) {
    const k = s.sign / s.r;
    hit.nx = (x - s.cx) * k; hit.ny = (y - s.cy) * k;
  } else {
    const xf = s.xf;
    const ly = -xf.sn * (x - xf.px) + xf.cs * (y - xf.py);
    let gx = 1, gy = ly / (2 * s.f);
    const l = s.sign / Math.hypot(gx, gy);
    gx *= l; gy *= l;
    hit.nx = xf.cs * gx - xf.sn * gy; hit.ny = xf.sn * gx + xf.cs * gy;
  }
}

/** Conservative world bounds of a surface -> [minx, miny, maxx, maxy]. */
export function surfBounds(s: Surf): [number, number, number, number] {
  if (s.g === 0) {
    const bx = s.ax + s.ex, by = s.ay + s.ey;
    return [Math.min(s.ax, bx), Math.min(s.ay, by), Math.max(s.ax, bx), Math.max(s.ay, by)];
  }
  if (s.g === 1) {
    if (s.cosHalf <= -1) return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    const half = Math.acos(s.cosHalf), mid = Math.atan2(s.my, s.mx);
    const xs = [Math.cos(mid - half), Math.cos(mid + half)], ys = [Math.sin(mid - half), Math.sin(mid + half)];
    if (s.mx >= s.cosHalf) xs.push(1);
    if (-s.mx >= s.cosHalf) xs.push(-1);
    if (s.my >= s.cosHalf) ys.push(1);
    if (-s.my >= s.cosHalf) ys.push(-1);
    return [s.cx + s.r * Math.min(...xs), s.cy + s.r * Math.min(...ys), s.cx + s.r * Math.max(...xs), s.cy + s.r * Math.max(...ys)];
  }
  const xf = s.xf;
  const x0 = -(s.h0 * s.h0) / (4 * s.f), x1 = -(s.h1 * s.h1) / (4 * s.f);
  const xa = s.h0 <= 0 && s.h1 >= 0 ? 0 : Math.abs(x0) < Math.abs(x1) ? x0 : x1; // end nearest the vertex
  const xe = Math.abs(x0) > Math.abs(x1) ? x0 : x1;
  const pts = [toWorld(xf, xa, s.h0), toWorld(xf, xa, s.h1), toWorld(xf, xe, s.h0), toWorld(xf, xe, s.h1)];
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); }
  return [a, b, c, d];
}
