/**
 * 2D polarization ray tracer.
 *
 * Polarization: every ray carries the 2x2 coherency matrix J = <E E^dagger> of its field in the
 * (p, s) basis (p in the bench plane and perpendicular to the ray, s out of the plane). This is
 * the Jones-vector outer product, transforms as J' = M J M^dagger under any Jones matrix M and,
 * unlike a bare Jones vector, also represents unpolarized / partially polarized light exactly.
 * In a 2D bench the plane of incidence is always the bench plane, so the Fresnel coefficients act
 * directly on the p and s components. The triad (s, p, k) is right-handed (Fresnel convention in
 * which r_p = -r_s at normal incidence); polarization angles are measured from p towards s.
 *
 * Media: each ray keeps a persistent stack of the bodies it is inside, so nested and overlapping
 * bodies resolve to the right pair of indices at every interface; hits that are inconsistent with
 * the stack (leaving a body the ray is not in) are rejected, which makes touching bodies robust.
 */
import type { DetectorReading, OpticsDrive, OpticsScene, OpticsSettings, RaySegment, TraceResult } from '../types';
import { wavelengthToRGB } from './color';
import { compile, type Compiled } from './compile';
import { SK, hit, intersect, surfNormal, type Body, type CComp, type DetectorRT, type Surf, type Volume } from './geometry';
import { getMaterial, type Material } from './materials';
import { defaultSettings } from './registry';
import { bucketsToIntensity, fieldBuckets, sortHits, type CohGroup, type WHit } from './wave';

export interface TraceEnergy {
  /** Total power launched by all sources (W). */
  emitted: number;
  /** Absorbed by detectors. */
  detected: number;
  /** Absorbed by absorbers, apertures, filters, polarizers, mirror coatings, media, fibre losses, horizons. */
  absorbed: number;
  /** Left the scene. */
  escaped: number;
  /** Discarded by the minIntensity / maxBounces limits. */
  dropped: number;
}

export interface DetailedTraceResult extends TraceResult { energy: TraceEnergy }

interface StackNode { body: Body; next: StackNode | null }

interface Src { id: string; power: number; fwhm: number }

/** Speed of light in mm/s. */
const C_MM = 2.99792458e11;

interface Ray {
  x: number; y: number; dx: number; dy: number;
  wl: number; p: number; pmin: number; p0: number;
  a: number; b: number; c: number; d: number; // coherency matrix: Jpp, Jss, Re Jps, Im Jps (trace 1)
  stack: StackNode | null;
  vol: Volume | null;
  depth: number;
  src: Src;
  l1: Surf | null; l2: Surf | null; // surfaces just interacted with at the current point
  /** Time since emission (s) and geometric path length (mm). */
  t: number; gl: number;
  // ---- wave mode (grp < 0: ray mode, fields unused) ----
  /** Optical path length (mm), extra phase (rad), coherence group, branch hash. */
  opl: number; ph: number; grp: number; br: number;
  /** Unit Jones vector (p, s). */
  jpr: number; jpi: number; jsr: number; jsi: number;
  /** Nominal beamlet radius at launch (mm) and angular spacing to the neighbouring ray (rad). */
  wd: number; wdv: number;
}

const FAR = 1e4;        // mm, length of rays leaving the scene
const MAX_STEPS = 6000; // curved-path integration steps per ray
const MAX_SEGMENTS = 400000; // hard budget: beyond this the remaining rays are discarded (booked as dropped)
const MAX_HITS = 20000;

const RT = new Float64Array(2);
const NK = new Float64Array(2);
const MJ = new Float64Array(8);
const CF = new Float64Array(4);
const SAV = new Float64Array(8);
const savePol = (r: Ray): void => { SAV[0] = r.a; SAV[1] = r.b; SAV[2] = r.c; SAV[3] = r.d; SAV[4] = r.jpr; SAV[5] = r.jpi; SAV[6] = r.jsr; SAV[7] = r.jsi; };
const restorePol = (r: Ray): void => { r.a = SAV[0]; r.b = SAV[1]; r.c = SAV[2]; r.d = SAV[3]; r.jpr = SAV[4]; r.jpi = SAV[5]; r.jsr = SAV[6]; r.jsi = SAV[7]; };
/** Mirror-type reflection of an ideal thin reflector: r_p = +1, r_s = -1 (handedness flip). */
const flipS = (k: Ray): void => { k.c = -k.c; k.d = -k.d; k.jsr = -k.jsr; k.jsi = -k.jsi; };
const mix = (h: number, v: number): number => (Math.imul(h ^ v, 0x01000193) + 0x9e3779b9) | 0;

const now = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
};

// ---------------------------------------------------------------------------
// Polarization helpers (operate in place, return the power factor = new trace)
// ---------------------------------------------------------------------------

/** Diagonal Jones matrix diag(mp, ms) with complex entries. */
function applyDiag(r: Ray, pr: number, pi: number, sr: number, si: number): number {
  const a = (pr * pr + pi * pi) * r.a, b = (sr * sr + si * si) * r.b;
  // mp * conj(ms)
  const xr = pr * sr + pi * si, xi = pi * sr - pr * si;
  const c = xr * r.c - xi * r.d, d = xr * r.d + xi * r.c;
  const tr = a + b;
  if (tr <= 1e-300) { r.a = 0.5; r.b = 0.5; r.c = 0; r.d = 0; return 0; }
  r.a = a / tr; r.b = b / tr; r.c = c / tr; r.d = d / tr;
  if (r.grp >= 0) {
    const jpr = pr * r.jpr - pi * r.jpi, jpi = pr * r.jpi + pi * r.jpr;
    const jsr = sr * r.jsr - si * r.jsi, jsi = sr * r.jsi + si * r.jsr;
    const nn = Math.sqrt(jpr * jpr + jpi * jpi + jsr * jsr + jsi * jsi);
    if (nn > 1e-150) { r.jpr = jpr / nn; r.jpi = jpi / nn; r.jsr = jsr / nn; r.jsi = jsi / nn; }
  }
  return tr;
}

/** General Jones matrix M (row-major complex, index 0 = p, 1 = s). */
function applyJones(r: Ray, M: Float64Array): number {
  const a = r.a, b = r.b, c = r.c, d = r.d;
  const m00r = M[0], m00i = M[1], m01r = M[2], m01i = M[3], m10r = M[4], m10i = M[5], m11r = M[6], m11i = M[7];
  // A = M J,  J = [[a, c+id], [c-id, b]]
  const A00r = m00r * a + m01r * c + m01i * d, A00i = m00i * a + m01i * c - m01r * d;
  const A01r = m00r * c - m00i * d + m01r * b, A01i = m00i * c + m00r * d + m01i * b;
  const A10r = m10r * a + m11r * c + m11i * d, A10i = m10i * a + m11i * c - m11r * d;
  const A11r = m10r * c - m10i * d + m11r * b, A11i = m10i * c + m10r * d + m11i * b;
  // J' = A M^dagger
  const na = A00r * m00r + A00i * m00i + A01r * m01r + A01i * m01i;
  const nb = A10r * m10r + A10i * m10i + A11r * m11r + A11i * m11i;
  const ncr = A00r * m10r + A00i * m10i + A01r * m11r + A01i * m11i;
  const nci = A00i * m10r - A00r * m10i + A01i * m11r - A01r * m11i;
  const tr = na + nb;
  if (tr <= 1e-300) { r.a = 0.5; r.b = 0.5; r.c = 0; r.d = 0; return 0; }
  r.a = na / tr; r.b = nb / tr; r.c = ncr / tr; r.d = nci / tr;
  if (r.grp >= 0) {
    const pr = r.jpr, pi = r.jpi, sr = r.jsr, si = r.jsi;
    const jpr = m00r * pr - m00i * pi + m01r * sr - m01i * si, jpi = m00r * pi + m00i * pr + m01r * si + m01i * sr;
    const jsr = m10r * pr - m10i * pi + m11r * sr - m11i * si, jsi = m10r * pi + m10i * pr + m11r * si + m11i * sr;
    const nn = Math.sqrt(jpr * jpr + jpi * jpi + jsr * jsr + jsi * jsi);
    if (nn > 1e-150) { r.jpr = jpr / nn; r.jpi = jpi / nn; r.jsr = jsr / nn; r.jsi = jsi / nn; }
  }
  return tr;
}

/** Rotate the polarization ellipse by `ang` (from p towards s). */
function rotatePol(r: Ray, ang: number): void {
  const c2 = Math.cos(2 * ang), s2 = Math.sin(2 * ang);
  const s1 = r.a - r.b, s2v = 2 * r.c;
  const n1 = s1 * c2 - s2v * s2, n2 = s1 * s2 + s2v * c2;
  r.a = 0.5 * (1 + n1); r.b = 0.5 * (1 - n1); r.c = 0.5 * n2;
  if (r.grp >= 0) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const pr = r.jpr, pi = r.jpi, sr = r.jsr, si = r.jsi;
    r.jpr = c * pr - s * sr; r.jpi = c * pi - s * si; r.jsr = s * pr + c * sr; r.jsi = s * pi + c * si;
  }
}

/**
 * Complex Fresnel amplitude coefficients for an absorbing medium (n + ik) seen from a dielectric
 * of index n1 at incidence cosine ci. Writes rs (re, im), rp (re, im) into `out`.
 */
export function fresnelComplex(n1: number, nr: number, ni: number, ci: number, out: Float64Array): void {
  // m = (nr + i ni)/n1 ; ct = sqrt(1 - sin^2 / m^2)
  const mr = nr / n1, mi = ni / n1;
  const m2r = mr * mr - mi * mi, m2i = 2 * mr * mi;
  const s2 = 1 - ci * ci;
  const den = m2r * m2r + m2i * m2i;
  const wr = 1 - (s2 * m2r) / den, wi = (s2 * m2i) / den;
  // principal sqrt
  const mag = Math.hypot(wr, wi);
  let ctr = Math.sqrt(Math.max(0, (mag + wr) / 2)), cti = Math.sqrt(Math.max(0, (mag - wr) / 2));
  if (wi < 0) cti = -cti;
  // m * ct
  const ar = mr * ctr - mi * cti, ai = mr * cti + mi * ctr;
  // rs = (ci - m ct)/(ci + m ct)
  let nr_ = ci - ar, ni_ = -ai, dr = ci + ar, di = ai, dd = dr * dr + di * di;
  out[0] = (nr_ * dr + ni_ * di) / dd; out[1] = (ni_ * dr - nr_ * di) / dd;
  // rp = (m ci - ct)/(m ci + ct)
  nr_ = mr * ci - ctr; ni_ = mi * ci - cti; dr = mr * ci + ctr; di = mi * ci + cti; dd = dr * dr + di * di;
  out[2] = (nr_ * dr + ni_ * di) / dd; out[3] = (ni_ * dr - nr_ * di) / dd;
}

/** Silica fibre attenuation in dB/km: Rayleigh scattering + IR absorption edge + UV tail + OH overtone. */
export function silicaAttenuationDbPerKm(nm: number): number {
  const um = Math.max(0.2, nm / 1000);
  const rayleigh = 0.8 / (um * um * um * um);
  const ir = 7.81e11 * Math.exp(-48.48 / um);
  const uv = 1.0e-3 * Math.exp(4.63 / um) * 0.15;
  const oh = 0.4 * Math.exp(-(((um - 1.383) / 0.025) ** 2)) + 0.05 * Math.exp(-(((um - 0.95) / 0.02) ** 2));
  return rayleigh + ir + uv + oh;
}

const hash01 = (a: number, b: number, c: number): number => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

// ---------------------------------------------------------------------------

export function trace(scene: OpticsScene, drive?: OpticsDrive): DetailedTraceResult {
  const t0 = now();
  const settings: OpticsSettings = { ...defaultSettings(), ...(scene.settings ?? {}) };
  const WAVE = !!settings.waveMode;
  const maxB = Math.max(1, Math.min(10000, Math.round(settings.maxBounces)));
  const minI = Math.max(1e-12, settings.minIntensity);
  const tC = settings.temperatureC;
  const ambient: Material = getMaterial(settings.ambientMedium || 'air');
  const mgf2 = getMaterial('mgf2');
  const filmD = 550 / (4 * mgf2.n(550, tC)); // quarter-wave thickness in nm

  const compiled: Compiled[] = [];
  for (const c of scene.components ?? []) compiled.push(compile(c, settings, drive?.propOverrides?.[c.id], drive?.time));

  const comps: CComp[] = [];
  const bodies: Body[] = [];
  const vols: Volume[] = [];
  const detectors: Record<string, DetectorReading> = {};
  const dets: DetectorRT[] = [];
  const waps: Surf[] = [];
  let surfCount = 0;
  for (const k of compiled) {
    if (k.comp.surfs.length) comps.push(k.comp);
    for (const b of k.bodies) bodies.push(b);
    if (k.vol) vols.push(k.vol);
    if (k.det) { dets.push(k.det); if (WAVE && !k.det.incoh && k.det.face) k.det.wh = []; }
    for (const s of k.comp.surfs) { s.idx = ++surfCount; if (s.wap) waps.push(s); }
  }
  const groups: CohGroup[] = [];
  const shifted = new Map<number, number>();
  let uniq = 0x5bd1e995;
  const rgbCache = new Map<number, [number, number, number]>();
  const rgbOf = (w: number): [number, number, number] => {
    let c = rgbCache.get(w);
    if (!c) { c = wavelengthToRGB(w); rgbCache.set(w, c); }
    return c;
  };
  // phase / group index per medium and wavelength (cached)
  const ambNc = new Map<number, Float64Array>();
  const mkPair = (m: Material, w: number): Float64Array => {
    const n = m.n(w, tC);
    return Float64Array.of(n, n - (w * (m.n(w + 1, tC) - m.n(w - 1, tC))) / 2);
  };
  const nPair = (st: StackNode | null, w: number): Float64Array => {
    if (!st) { let q = ambNc.get(w); if (!q) { q = mkPair(ambient, w); ambNc.set(w, q); } return q; }
    const b = st.body;
    const nc = b.nc ?? (b.nc = new Map<number, Float64Array>());
    let q = nc.get(w);
    if (!q) { q = mkPair(b.mat, w); nc.set(w, q); }
    return q;
  };
  for (const k of compiled) {
    if (!k.vol) continue;
    const a = k.comp;
    for (const o of comps) {
      if (o.minx <= a.maxx && o.maxx >= a.minx && o.miny <= a.maxy && o.maxy >= a.miny) k.vol.comps.push(o);
    }
  }

  const segments: RaySegment[] = [];
  const E: TraceEnergy = { emitted: 0, detected: 0, absorbed: 0, escaped: 0, dropped: 0 };
  const work: Ray[] = [];
  let hS: Surf | null = null, hT = 0, hNx = 0, hNy = 0;

  // ---- media ----------------------------------------------------------------
  const bodyN = (b: Body, x: number, y: number, w: number): number => (b.vol ? b.vol.eval(x, y, w) : b.mat.n(w, tC));
  const mediumN = (st: StackNode | null, x: number, y: number, w: number): number => (st ? bodyN(st.body, x, y, w) : ambient.n(w, tC));
  const inStack = (st: StackNode | null, b: Body): boolean => {
    for (let n = st; n; n = n.next) if (n.body === b) return true;
    return false;
  };
  const removeFrom = (st: StackNode | null, b: Body): StackNode | null => {
    if (!st) return null;
    if (st.body === b) return st.next;
    return { body: st.body, next: removeFrom(st.next, b) };
  };

  // ---- nearest hit ------------------------------------------------------------
  function nearest(ox: number, oy: number, dx: number, dy: number, list: CComp[], tmax: number, r: Ray): boolean {
    let best = tmax;
    hS = null;
    const idx = 1 / dx, idy = 1 / dy;
    for (let ci = 0; ci < list.length; ci++) {
      const cp = list[ci];
      // slab test
      let t0s = -1e-6, t1s = best;
      if (dx !== 0) {
        let ta = (cp.minx - ox) * idx, tb = (cp.maxx - ox) * idx;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0s) t0s = ta;
        if (tb < t1s) t1s = tb;
      } else if (ox < cp.minx || ox > cp.maxx) continue;
      if (dy !== 0) {
        let ta = (cp.miny - oy) * idy, tb = (cp.maxy - oy) * idy;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0s) t0s = ta;
        if (tb < t1s) t1s = tb;
      } else if (oy < cp.miny || oy > cp.maxy) continue;
      if (t0s > t1s) continue;
      const surfs = cp.surfs;
      for (let si = 0; si < surfs.length; si++) {
        const s = surfs[si];
        let tmin = s === r.l1 || s === r.l2 ? 1e-6 : -1e-7;
        for (let tries = 0; tries < 3; tries++) {
          const t = intersect(s, ox, oy, dx, dy, tmin, best);
          if (t <= tmin) break;
          const px = ox + t * dx, py = oy + t * dy;
          surfNormal(s, px, py);
          if (s.kind === SK.REFRACT) {
            const entering = dx * hit.nx + dy * hit.ny < 0;
            if (entering === inStack(r.stack, s.body!)) { tmin = t + 1e-9; continue; }
          }
          best = t; hS = s; hT = t; hNx = hit.nx; hNy = hit.ny;
          break;
        }
      }
    }
    return hS !== null;
  }

  // ---- output -----------------------------------------------------------------
  function emit(r: Ray, ax: number, ay: number, bx: number, by: number, t0: number, t1: number): void {
    if (segments.length >= MAX_SEGMENTS) return;
    const s1 = r.a - r.b, s2 = 2 * r.c;
    segments.push({
      a: { x: ax, y: ay }, b: { x: bx, y: by }, wavelength: r.wl, power: r.p,
      polAngle: 0.5 * Math.atan2(s2, s1), polDegree: Math.min(1, Math.sqrt(s1 * s1 + s2 * s2)),
      sourceId: r.src.id, depth: r.depth, inMedium: r.stack !== null, t0, t1,
    });
  }

  /** Straight flight of length L in the current homogeneous medium: draw it, advance time and optical path. */
  function fly(r: Ray, bx: number, by: number, L: number): void {
    const q = nPair(r.stack, r.wl);
    const t1 = r.t + (L * q[1]) / C_MM;
    emit(r, r.x, r.y, bx, by, r.t, t1);
    r.t = t1; r.gl += L;
    if (r.grp >= 0) r.opl += L * q[0];
  }

  function waveHit(r: Ray, s: Surf, dn: number): WHit {
    const tx = s.ex / s.len, ty = s.ey / s.len;
    const n = nPair(r.stack, r.wl)[0];
    const cn = Math.max(0.05, Math.abs(dn));
    const wp = r.wd + r.wdv * r.gl;
    return {
      u: (r.x - s.ax) * tx + (r.y - s.ay) * ty, kt: n * (r.dx * tx + r.dy * ty), opl: r.opl, ph: r.ph, p: r.p,
      jpr: r.jpr, jpi: r.jpi, jsr: r.jsr, jsi: r.jsi, wl: r.wl, grp: r.grp, br: r.br,
      w: wp / cn, cv: wp > 1e-9 ? (n * cn * cn * r.wdv) / wp : 0, t: r.t, side: dn > 0 ? 1 : -1,
    };
  }

  /** Beer-Lambert absorption and Faraday rotation over a path of length L (mm) in the current medium. */
  function attenuate(r: Ray, L: number): void {
    const st = r.stack;
    if (st) {
      const b = st.body;
      const al = b.alphaExtra + (b.mat.hasAlpha ? b.mat.alpha(r.wl) : 0);
      if (al > 0) { const pe = r.p * Math.exp(-al * L); E.absorbed += r.p - pe; r.p = pe; }
      if (b.bx !== 0 || b.by !== 0) {
        const V = b.mat.verdet(r.wl);
        if (V !== 0) rotatePol(r, V * (b.bx * r.dx + b.by * r.dy) * L * 1e-3);
      }
    } else if (ambient.hasAlpha) {
      const pe = r.p * Math.exp(-ambient.alpha(r.wl) * L);
      E.absorbed += r.p - pe; r.p = pe;
    }
  }

  function child(r: Ray, dx: number, dy: number, p: number, code = 1): Ray | null {
    if (!(p >= r.pmin)) { if (p > 0) E.dropped += p; return null; }
    const k: Ray = {
      x: r.x, y: r.y, dx, dy, wl: r.wl, p, pmin: r.pmin, p0: r.p0, a: r.a, b: r.b, c: r.c, d: r.d,
      stack: r.stack, vol: r.vol, depth: r.depth + 1, src: r.src, l1: r.l1, l2: r.l2,
      t: r.t, gl: r.gl, opl: r.opl, ph: r.ph, grp: r.grp, br: r.grp >= 0 ? mix(r.br, code) : 0,
      jpr: r.jpr, jpi: r.jpi, jsr: r.jsr, jsi: r.jsi, wd: r.wd, wdv: r.wdv,
    };
    work.push(k);
    return k;
  }

  /** Continue ray `r` with power p; returns false (and books the loss) when it falls below threshold. */
  function keep(r: Ray, p: number): boolean {
    if (!(p >= r.pmin)) { if (p > 0) E.dropped += p; return false; }
    r.p = p; r.depth++;
    return true;
  }

  // ---- interactions -------------------------------------------------------------
  function interact(r: Ray, s: Surf, nx: number, ny: number): boolean {
    const dx = r.dx, dy = r.dy, w = r.wl;
    const dn = dx * nx + dy * ny;
    if (r.grp >= 0) r.br = mix(r.br, s.idx << 4);
    switch (s.kind) {
      case SK.REFRACT: {
        const body = s.body!;
        const entering = dn < 0;
        let ci = -dn;
        if (!entering) { nx = -nx; ny = -ny; ci = dn; }
        const n1 = mediumN(r.stack, r.x, r.y, w);
        const newStack: StackNode | null = entering ? { body, next: r.stack } : removeFrom(r.stack, body);
        const n2 = mediumN(newStack, r.x, r.y, w);
        const newVol = body.vol ? (entering ? body.vol : null) : r.vol;
        if (Math.abs(n1 - n2) < 1e-12) { r.stack = newStack; r.vol = newVol; return true; }
        const eta = n1 / n2;
        const sin2 = eta * eta * (1 - ci * ci);
        const rdx = dx + 2 * ci * nx, rdy = dy + 2 * ci * ny;
        if (sin2 >= 1) {
          // total internal reflection: unit modulus, polarization-dependent phase (Fresnel rhomb physics)
          const kap = Math.sqrt(sin2 - 1);
          const del = -2 * Math.atan2(n1 * kap, n2 * ci) + 2 * Math.atan2(n2 * kap, n1 * ci);
          const cr = Math.cos(del), sr = Math.sin(del);
          const c = r.c * cr - r.d * sr, d = r.c * sr + r.d * cr;
          r.c = c; r.d = d; r.dx = rdx; r.dy = rdy; r.depth++;
          if (r.grp >= 0) {
            // absolute phases of r_p and r_s (unit modulus)
            const pp = -2 * Math.atan2(n1 * kap, n2 * ci), ps = -2 * Math.atan2(n2 * kap, n1 * ci);
            const cp = Math.cos(pp), sp = Math.sin(pp), cs = Math.cos(ps), ss = Math.sin(ps);
            const jpr = r.jpr * cp - r.jpi * sp, jpi = r.jpr * sp + r.jpi * cp;
            const jsr = r.jsr * cs - r.jsi * ss, jsi = r.jsr * ss + r.jsi * cs;
            r.jpr = jpr; r.jpi = jpi; r.jsr = jsr; r.jsi = jsi;
          }
          return true;
        }
        const ct = Math.sqrt(1 - sin2);
        const tdx0 = eta * dx + (eta * ci - ct) * nx, tdy0 = eta * dy + (eta * ci - ct) * ny;
        const tl = 1 / Math.hypot(tdx0, tdy0);
        const tdx = tdx0 * tl, tdy = tdy0 * tl;
        const pIn = r.p;
        let pT = pIn;
        if (body.coating === 2) {
          // ideal AR: everything is transmitted
        } else {
          let rsr = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rsi = 0;
          let rpr = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct), rpi = 0;
          if (body.coating === 1) {
            const nf = mgf2.n(w, tC);
            const sf2 = (n1 * n1 * (1 - ci * ci)) / (nf * nf);
            if (sf2 < 1) {
              const cf = Math.sqrt(1 - sf2);
              const beta2 = (4 * Math.PI * nf * filmD * cf) / w;
              const er = Math.cos(beta2), ei = Math.sin(beta2);
              for (let pol = 0; pol < 2; pol++) {
                const r01 = pol === 0 ? (n1 * ci - nf * cf) / (n1 * ci + nf * cf) : (nf * ci - n1 * cf) / (nf * ci + n1 * cf);
                const r12 = pol === 0 ? (nf * cf - n2 * ct) / (nf * cf + n2 * ct) : (n2 * cf - nf * ct) / (n2 * cf + nf * ct);
                const nr = r01 + r12 * er, ni = r12 * ei, dr = 1 + r01 * r12 * er, di = r01 * r12 * ei, dd = dr * dr + di * di;
                const xr = (nr * dr + ni * di) / dd, xi = (ni * dr - nr * di) / dd;
                if (pol === 0) { rsr = xr; rsi = xi; } else { rpr = xr; rpi = xi; }
              }
            }
          }
          const Rs = rsr * rsr + rsi * rsi, Rp = rpr * rpr + rpi * rpi;
          savePol(r);
          const fR = applyDiag(r, rpr, rpi, rsr, rsi);
          if (fR > 0) child(r, rdx, rdy, pIn * fR);
          restorePol(r);
          pT = pIn * applyDiag(r, Math.sqrt(Math.max(0, 1 - Rp)), 0, Math.sqrt(Math.max(0, 1 - Rs)), 0);
        }
        r.dx = tdx; r.dy = tdy; r.stack = newStack; r.vol = newVol;
        if (entering && body.shg && body.shg.kappa > 0) {
          const sh = body.shg;
          const x = (2.783 * (w - sh.pm)) / sh.bw;
          const acc = Math.abs(x) < 1e-6 ? 1 : (Math.sin(x) / x) ** 2;
          const pBeam = r.src.power * (pT / r.p0);
          const th = Math.tanh(Math.sqrt(sh.kappa * Math.max(0, pBeam)));
          const eta2 = th * th * acc;
          if (eta2 > 0) {
            const k = child(r, tdx, tdy, pT * eta2, 3);
            if (k) {
              k.wl = w / 2; k.depth = r.depth;
              { const a2 = 0.5 * Math.atan2(2 * r.c, r.a - r.b) + Math.PI / 2; k.jpr = Math.cos(a2); k.jsr = Math.sin(a2); k.jpi = 0; k.jsi = 0; }
              // type-I phase matching: second harmonic polarized perpendicular to the fundamental
              const s1 = r.a - r.b, s2 = 2 * r.c;
              const ang = 0.5 * Math.atan2(s2, s1) + Math.PI / 2;
              const cc = Math.cos(ang), ss = Math.sin(ang);
              k.a = cc * cc; k.b = ss * ss; k.c = cc * ss; k.d = 0;
            }
            pT *= 1 - eta2;
          }
        }
        return keep(r, pT);
      }

      case SK.THIN: {
        if (s.backAbsorb && dn > 0) { E.absorbed += r.p; return false; }
        s.rt!(w, RT);
        const R = RT[0], T = RT[1], p = r.p;
        const lost = p * (1 - R - T);
        if (lost > 0) E.absorbed += lost;
        const rdx = dx - 2 * dn * nx, rdy = dy - 2 * dn * ny;
        if (T > 0) {
          // partial reflector: reflection leads transmission by 90 degrees (lossless beam-splitter unitarity)
          if (R > 0) { const k = child(r, rdx, rdy, p * R); if (k) { flipS(k); k.ph += Math.PI / 2; } }
          return keep(r, p * T);
        }
        if (R > 0) { r.dx = rdx; r.dy = rdy; flipS(r); return keep(r, p * R); }
        return false;
      }

      case SK.METAL: {
        if (s.backAbsorb && dn > 0) { E.absorbed += r.p; return false; }
        s.metal!(w, NK);
        const n1 = mediumN(r.stack, r.x, r.y, w);
        fresnelComplex(n1, NK[0], NK[1], Math.abs(dn), CF);
        const p = r.p;
        const f = applyDiag(r, CF[2], CF[3], CF[0], CF[1]) * s.rScale;
        E.absorbed += p * (1 - f);
        r.dx = dx - 2 * dn * nx; r.dy = dy - 2 * dn * ny;
        return keep(r, p * f);
      }

      case SK.DETECTOR: {
        const det = s.det;
        if (!det || (s.p1 > 0 && dn > 0)) { E.absorbed += r.p; return false; }
        if (det.hits && det.hits.length < MAX_HITS) det.hits.push({ p: { x: r.x, y: r.y }, wavelength: w, power: r.p });
        if (det.wh) { det.wh.push(waveHit(r, s, dn)); return false; } // wave mode: summed coherently after the trace
        det.power += r.p; E.detected += r.p;
        if (det.profile) {
          const u = ((r.x - s.ax) * s.ex + (r.y - s.ay) * s.ey) / (s.len * s.len);
          const n = det.profile.length;
          const bi = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
          det.profile[bi] += r.p;
          if (det.rgb) { const c = rgbOf(w); det.rgb[3 * bi] += r.p * c[0]; det.rgb[3 * bi + 1] += r.p * c[1]; det.rgb[3 * bi + 2] += r.p * c[2]; }
        }
        if (det.st) { det.st[0] += r.p; det.st[1] += r.p * (r.a - r.b); det.st[2] += r.p * 2 * r.c; det.st[3] -= r.p * 2 * r.d; }
        if (det.wm) { det.wm[0] += r.p; det.wm[1] += r.p * w; det.wm[2] += r.p * w * w; det.wm[3] += r.p * r.src.fwhm * r.src.fwhm; }
        if (det.spectrum) {
          const n = det.spectrum.length;
          const i = Math.floor(((w - det.range[0]) / (det.range[1] - det.range[0])) * n);
          if (i >= 0 && i < n) det.spectrum[i] += r.p;
        }
        return false;
      }

      case SK.PBS: {
        const tp = s.p1, rs = s.p2, p = r.p;
        savePol(r);
        const fR = applyDiag(r, Math.sqrt(1 - tp), 0, -Math.sqrt(rs), 0);
        if (fR > 0) { const k = child(r, dx - 2 * dn * nx, dy - 2 * dn * ny, p * fR); if (k) k.ph += Math.PI / 2; }
        restorePol(r);
        return keep(r, p * applyDiag(r, Math.sqrt(tp), 0, Math.sqrt(1 - rs), 0));
      }

      case SK.IDEAL: {
        // paraxial thin lens: tan(theta') = tan(theta) - h / f
        const tx = s.ex / s.len, ty = s.ey / s.len;
        const dt = dx * tx + dy * ty;
        const adn = Math.abs(dn);
        if (adn < 1e-9) return true;
        const h = (r.x - s.ax) * tx + (r.y - s.ay) * ty - s.len / 2;
        let f = s.p1, T = 1;
        if (s.rt) { s.rt(w, RT); f = RT[0]; T = RT[1]; } // chromatic / lossy thin lens (Fresnel lens)
        const m = dt / adn - h / f;
        const sg = dn > 0 ? 1 : -1;
        const ox = sg * nx + m * tx, oy = sg * ny + m * ty, l = 1 / Math.hypot(ox, oy);
        r.dx = ox * l; r.dy = oy * l;
        if (r.grp >= 0) r.ph -= (Math.PI * 1e6 * h * h) / (w * f); // thin-lens phase -k h^2 / (2f)
        if (T < 1) { E.absorbed += r.p * (1 - T); return keep(r, r.p * T); }
        r.depth++;
        return true;
      }

      case SK.GRATING: {
        const tx = s.ex / s.len, ty = s.ey / s.len;
        const dt = dx * tx + dy * ty;
        const nm = mediumN(r.stack, r.x, r.y, w);
        const q = w / (nm * s.p1); // lambda / (n d)
        const reflect = s.end === 1;
        const sg = (dn > 0 ? 1 : -1) * (reflect ? -1 : 1);
        let tot = 0;
        for (let m = -2; m <= 2; m++) {
          const st = dt + m * q;
          if (st > -1 && st < 1) tot += m === 0 ? s.p2 : m === 1 || m === -1 ? s.p3 : s.p4;
        }
        if (!(tot > 0)) { E.absorbed += r.p; return false; }
        const p = r.p;
        for (let m = -2; m <= 2; m++) {
          if (m === 0) continue;
          const st = dt + m * q;
          if (!(st > -1 && st < 1)) continue;
          const e = (m === 1 || m === -1 ? s.p3 : s.p4) / tot;
          if (e <= 0) continue;
          const cn = Math.sqrt(1 - st * st) * sg;
          const k = child(r, st * tx + cn * nx, st * ty + cn * ny, p * e, 10 + m);
          if (k) {
            if (reflect) flipS(k);
            // order m picks up the grating phase 2 pi m x / d
            if (k.grp >= 0) k.ph += (2 * Math.PI * m * ((r.x - s.ax) * tx + (r.y - s.ay) * ty - s.len / 2) * 1e6) / s.p1;
          }
        }
        // order 0 continues in the parent ray
        if (!(s.p2 > 0)) return false;
        const cn0 = Math.sqrt(1 - dt * dt) * sg;
        r.dx = dt * tx + cn0 * nx; r.dy = dt * ty + cn0 * ny;
        if (reflect) flipS(r);
        return keep(r, (p * s.p2) / tot);
      }

      case SK.JONES: {
        s.jones!(w, dn > 0, MJ);
        const p = r.p;
        const f = applyJones(r, MJ);
        if (f < 1) E.absorbed += p * (1 - f);
        return keep(r, p * Math.min(1, f));
      }

      case SK.FIELD: {
        r.vol = dn < 0 ? s.vol : null;
        return true;
      }

      case SK.FIBER: {
        const fb = s.fiber!;
        const other = fb.faces[1 - s.end];
        if (dn > 0 || !other) { E.absorbed += r.p; return false; }
        const ci = -dn;
        const n0 = mediumN(r.stack, r.x, r.y, w);
        const sinI = Math.sqrt(Math.max(0, 1 - ci * ci));
        if (n0 * sinI > fb.na) { E.absorbed += r.p; return false; } // outside the acceptance cone: lost in the cladding
        const p = r.p;
        const Rf = ((n0 - fb.nCore) / (n0 + fb.nCore)) ** 2;
        if (Rf > 0) { const k = child(r, dx - 2 * dn * nx, dy - 2 * dn * ny, p * Rf); if (k) flipS(k); }
        const dB = (fb.model === 'silica' ? silicaAttenuationDbPerKm(w) : fb.attDb) * fb.lengthM * 1e-3;
        const nOut = ambient.n(w, tC);
        const Rout = ((nOut - fb.nCore) / (nOut + fb.nCore)) ** 2;
        const pOut = p * (1 - Rf) * Math.pow(10, -dB / 10) * (1 - Rout);
        E.absorbed += p * (1 - Rf) - pOut;
        // mode scrambling: deterministic pseudo-random exit position and angle sign
        const u = ((r.x - s.ax) * s.ex + (r.y - s.ay) * s.ey) / (s.len * s.len);
        const h1 = hash01(u * 91.7 + 0.31, sinI * 57.3 + s.end, w * 0.01);
        const h2 = hash01(sinI * 113.1 + 0.77, u * 39.1 + s.end * 3, w * 0.013);
        const uo = 0.05 + 0.9 * h1;
        const so = Math.min(0.999, (n0 * sinI) / nOut) * (h2 < 0.5 ? -1 : 1);
        const co = Math.sqrt(1 - so * so);
        const otx = other.ex / other.len, oty = other.ey / other.len;
        const onx = other.nx * other.sign, ony = other.ny * other.sign;
        r.x = other.ax + other.ex * uo; r.y = other.ay + other.ey * uo;
        r.dx = onx * co + otx * so; r.dy = ony * co + oty * so;
        r.stack = null; r.vol = null; r.l1 = other; r.l2 = null;
        {
          // group delay length * n_g / c with the dispersion of fused silica scaled to the core index
          const q = silicaPair(w);
          const Lmm = fb.lengthM * 1e3;
          r.t += (Lmm * (fb.nCore + q[1] - q[0])) / C_MM; r.gl += Lmm;
          if (r.grp >= 0) { r.opl += Lmm * fb.nCore; r.ph += 2 * Math.PI * h1; r.br = mix(r.br, ++uniq); } // mode scrambling: random phase
        }
        if (!fb.pm) {
          const kd = Math.exp(-fb.lengthM / 2);
          r.a = 0.5 + (r.a - 0.5) * kd; r.b = 1 - r.a; r.c *= kd; r.d *= kd;
        }
        return keep(r, pOut);
      }

      case SK.DIFFRACT: {
        // Fraunhofer single-slit pattern sampled at beta = pi a sin(theta) / lambda
        const tx = s.ex / s.len, ty = s.ey / s.len;
        const dt = dx * tx + dy * ty;
        const sg = dn > 0 ? 1 : -1;
        const nm = mediumN(r.stack, r.x, r.y, w);
        const q = w / (nm * s.p1 * 1e6 * Math.PI); // d(sin theta) per unit beta
        const K = 6, STEP = 0.45 * Math.PI;
        let tot = 0;
        for (let j = -K; j <= K; j++) {
          const st = dt + j * STEP * q;
          if (st > -1 && st < 1) { const be = j * STEP; tot += j === 0 ? 1 : (Math.sin(be) / be) ** 2; }
        }
        const p = r.p;
        for (let j = -K; j <= K; j++) {
          if (j === 0) continue;
          const st = dt + j * STEP * q;
          if (!(st > -1 && st < 1)) continue;
          const be = j * STEP;
          const cn = Math.sqrt(1 - st * st) * sg;
          const k = child(r, st * tx + cn * nx, st * ty + cn * ny, (p * (Math.sin(be) / be) ** 2) / tot, 40 + j);
          if (k && Math.sin(be) / be < 0) k.ph += Math.PI;
        }
        return keep(r, p / tot);
      }

      case SK.WAVEAP: {
        // wave mode: the plane records the incident field; Huygens-Fresnel fans are launched once all rays have arrived
        const wp = s.wap!;
        wp.hits.push(waveHit(r, s, dn)); wp.pending += r.p;
        wapSrc.set(s, r.src);
        return false;
      }

      case SK.AOM: {
        // Bragg diffraction by the acoustic grating (period s.p1 mm along the face): orders +-1
        const tx = s.ex / s.len, ty = s.ey / s.len;
        const dt = dx * tx + dy * ty;
        const nm = mediumN(r.stack, r.x, r.y, w);
        const q = (w * 1e-6) / (nm * s.p1);
        const sg = dn > 0 ? 1 : -1;
        const p = r.p;
        let e1 = 0, e2 = 0;
        for (let m = -1; m <= 1; m += 2) {
          const st = dt + m * q;
          if (!(st > -1 && st < 1)) continue;
          // phase mismatch over the interaction length for an internal angle error (dt + m q/2) / n_c
          const del = (Math.PI * s.p3 * (dt + (m * q) / 2) * nm) / (s.p4 * s.p1);
          const e = s.p2 * (Math.abs(del) < 1e-9 ? 1 : (Math.sin(del) / del) ** 2);
          if (m < 0) e1 = e; else e2 = e;
        }
        const sum = e1 + e2;
        if (sum > 1) { e1 /= sum; e2 /= sum; }
        for (let m = -1; m <= 1; m += 2) {
          const e = m < 0 ? e1 : e2;
          if (!(e > 0)) continue;
          const st = dt + m * q;
          const cn = Math.sqrt(1 - st * st) * sg;
          const k = child(r, st * tx + cn * nx, st * ty + cn * ny, p * e, 10 + m);
          if (k && k.grp >= 0) {
            k.ph += (2 * Math.PI * m * ((r.x - s.ax) * tx + (r.y - s.ay) * ty - s.len / 2)) / s.p1;
            // frequency-shifted light does not interfere stationarily with the unshifted beam
            const key = k.grp * 4 + m + 1;
            let g2 = shifted.get(key);
            if (g2 === undefined) { g2 = groups.length; groups.push({ ...groups[k.grp] }); shifted.set(key, g2); }
            k.grp = g2;
          }
        }
        return keep(r, p * Math.max(0, 1 - e1 - e2));
      }

      case SK.DIFFUSE: {
        // ground glass: deterministic (seeded) scatter into a cone, Gaussian angular weights
        const tx = s.ex / s.len, ty = s.ey / s.len;
        const sg = dn > 0 ? 1 : -1;
        const K = Math.max(1, Math.round(s.p2));
        const u = (r.x - s.ax) * tx + (r.y - s.ay) * ty;
        const a0 = Math.atan2(dx * tx + dy * ty, Math.abs(dn));
        const p = r.p * s.p4;
        E.absorbed += r.p - p;
        let tot = 0;
        const ang: number[] = [], wt: number[] = [];
        for (let j = 0; j < K; j++) {
          const jit = hash01(u * 37.1 + j * 1.7, s.p3 * 0.731 + j, w * 0.011) - 0.5;
          const rel = K === 1 ? 2 * jit : ((j + 0.5 + 0.9 * jit) / K - 0.5) * 2; // -1..1 (edge = 1.5 x cone half angle)
          ang.push(Math.max(-1.55, Math.min(1.55, a0 + rel * 1.5 * s.p1)));
          const g = Math.exp(-2 * rel * rel * 2.25); // 1/e^2 at the cone half angle
          wt.push(g); tot += g;
        }
        let alive = false;
        for (let j = 0; j < K; j++) {
          const ca = Math.cos(ang[j]) * sg, sa = Math.sin(ang[j]);
          const pj = (p * wt[j]) / tot;
          const last = j === K - 1;
          let q: Ray | null;
          if (last) { r.dx = sa * tx + ca * nx; r.dy = sa * ty + ca * ny; alive = keep(r, pj); q = alive ? r : null; }
          else q = child(r, sa * tx + ca * nx, sa * ty + ca * ny, pj);
          if (q && q.grp >= 0) { q.ph += 2 * Math.PI * hash01(u * 91.3 + j, s.p3 + 0.37, w * 0.017); q.br = mix(q.br, ++uniq); }
        }
        return alive;
      }

      case SK.TALLY: {
        if (s.det && dn < 0) s.det.aux = (s.det.aux ?? 0) + r.p;
        return true;
      }
    }
    return false;
  }

  const wapSrc = new Map<Surf, Src>();
  const silicaNc = new Map<number, Float64Array>();
  const silica = getMaterial('fused_silica');
  function silicaPair(w: number): Float64Array {
    let q = silicaNc.get(w);
    if (!q) { q = mkPair(silica, w); silicaNc.set(w, q); }
    return q;
  }

  // ---- curved propagation (GRIN / gravity) ------------------------------------------
  function march(r: Ray): boolean {
    const vol = r.vol!;
    const w = r.wl;
    let n = vol.eval(r.x, r.y, w);
    if (n < 0) { E.absorbed += r.p; return false; }
    let sx = r.x, sy = r.y, sdx = r.dx, sdy = r.dy, sT = r.t;
    // dispersion offset n_g - n of the host material (gravity is achromatic)
    let dng = 0;
    if (vol.kind === 'grin' && r.stack) { const q = nPair(r.stack, w); dng = q[1] - q[0]; }
    const wave = r.grp >= 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      const h = vol.step(r.x, r.y);
      const x = r.x, y = r.y;
      const Tx = n * r.dx, Ty = n * r.dy;
      // RK4 on d r/ds = T/n, dT/ds = grad n
      const d1x = r.dx, d1y = r.dy, g1x = vol.gx, g1y = vol.gy;
      let nn = vol.eval(x + 0.5 * h * d1x, y + 0.5 * h * d1y, w);
      if (nn < 0) break;
      const d2x = (Tx + 0.5 * h * g1x) / nn, d2y = (Ty + 0.5 * h * g1y) / nn, g2x = vol.gx, g2y = vol.gy;
      nn = vol.eval(x + 0.5 * h * d2x, y + 0.5 * h * d2y, w);
      if (nn < 0) break;
      const d3x = (Tx + 0.5 * h * g2x) / nn, d3y = (Ty + 0.5 * h * g2y) / nn, g3x = vol.gx, g3y = vol.gy;
      nn = vol.eval(x + h * d3x, y + h * d3y, w);
      if (nn < 0) break;
      const d4x = (Tx + h * g3x) / nn, d4y = (Ty + h * g3y) / nn, g4x = vol.gx, g4y = vol.gy;
      const xn = x + (h / 6) * (d1x + 2 * d2x + 2 * d3x + d4x), yn = y + (h / 6) * (d1y + 2 * d2y + 2 * d3y + d4y);
      const Tnx = Tx + (h / 6) * (g1x + 2 * g2x + 2 * g3x + g4x), Tny = Ty + (h / 6) * (g1y + 2 * g2y + 2 * g3y + g4y);
      let cdx = xn - x, cdy = yn - y;
      const len = Math.hypot(cdx, cdy);
      if (!(len > 0)) break;
      cdx /= len; cdy /= len;
      if (nearest(x, y, cdx, cdy, vol.comps, len + 1e-9, r)) {
        const s = hS!, t = Math.max(0, hT), nx = hNx, ny = hNy;
        const hx = x + t * cdx, hy = y + t * cdy;
        r.t += (t * (n + dng)) / C_MM; r.gl += t;
        if (wave) r.opl += t * n;
        emit(r, sx, sy, hx, hy, sT, r.t);
        r.dx = cdx; r.dy = cdy;
        attenuate(r, t);
        r.x = hx; r.y = hy;
        if (t < 1e-6) r.l2 = r.l1; else r.l2 = null;
        r.l1 = s;
        return interact(r, s, nx, ny);
      }
      r.dx = cdx; r.dy = cdy;
      attenuate(r, len);
      r.x = xn; r.y = yn;
      r.l1 = null; r.l2 = null;
      const nPrev = n;
      n = vol.eval(xn, yn, w);
      if (n < 0) break;
      {
        const na = 0.5 * (nPrev + n);
        r.t += (len * (na + dng)) / C_MM; r.gl += len;
        if (wave) r.opl += len * na;
      }
      const tl = 1 / Math.hypot(Tnx, Tny);
      r.dx = Tnx * tl; r.dy = Tny * tl;
      if (r.dx * sdx + r.dy * sdy < 0.99996) { // > 0.5 degrees since the last emitted vertex
        emit(r, sx, sy, xn, yn, sT, r.t);
        sx = xn; sy = yn; sdx = r.dx; sdy = r.dy; sT = r.t;
      }
      if (r.p < r.pmin) { emit(r, sx, sy, r.x, r.y, sT, r.t); E.dropped += r.p; return false; }
    }
    // captured by the horizon or step budget exhausted
    emit(r, sx, sy, r.x, r.y, sT, r.t);
    E.absorbed += r.p;
    return false;
  }

  function propagate(r: Ray): void {
    for (;;) {
      if (r.depth > maxB) { E.dropped += r.p; return; }
      if (r.vol) {
        if (!march(r)) return;
        continue;
      }
      if (!nearest(r.x, r.y, r.dx, r.dy, comps, FAR, r)) {
        const ex = r.x + r.dx * FAR, ey = r.y + r.dy * FAR;
        fly(r, ex, ey, FAR);
        attenuate(r, FAR);
        E.escaped += r.p;
        return;
      }
      const s = hS!, t = Math.max(0, hT), nx = hNx, ny = hNy;
      const hx = r.x + t * r.dx, hy = r.y + t * r.dy;
      fly(r, hx, hy, t);
      attenuate(r, t);
      r.x = hx; r.y = hy;
      if (t < 1e-6) r.l2 = r.l1; else r.l2 = null;
      r.l1 = s;
      if (r.p < r.pmin) { E.dropped += r.p; return; }
      if (!interact(r, s, nx, ny)) return;
    }
  }

  // ---- sources ------------------------------------------------------------------------

  /** Which bodies contain point (x, y)? Cast a probe ray per body and look at the first crossing. */
  function initialStack(x: number, y: number): StackNode | null {
    let st: StackNode | null = null;
    const dx = 0.8910065241883679, dy = 0.45399049973954675;
    for (const b of bodies) {
      const cp = b.comp;
      if (!cp || x < cp.minx || x > cp.maxx || y < cp.miny || y > cp.maxy) continue;
      let best = Infinity, inside = false;
      for (const s of cp.surfs) {
        if (s.kind !== SK.REFRACT || s.body !== b) continue;
        const t = intersect(s, x, y, dx, dy, 1e-9, best);
        if (t > 0) { best = t; surfNormal(s, x + t * dx, y + t * dy); inside = dx * hit.nx + dy * hit.ny > 0; }
      }
      if (inside) st = { body: b, next: st };
    }
    return st;
  }

  let rayCount = 0;
  for (const k of compiled) {
    const sp = k.source;
    if (!sp) continue;
    const scale = drive?.sourceScale?.[k.c.id];
    const power = sp.power * (scale === undefined ? 1 : Math.max(0, scale));
    if (!(power > 0)) continue;
    const src: Src = { id: k.c.id, power, fwhm: sp.wl.length === 1 ? (sp.lineFwhm ?? 0) : 0 };
    // wave mode: polarization modes (a pure state is one mode; unpolarized light = two incoherent modes p and s)
    const pol = sp.pol;
    const pure = pol[0] * pol[1] - pol[2] * pol[2] - pol[3] * pol[3] < 1e-9;
    const nModes = WAVE ? (pure ? 1 : 2) : 1;
    const gBase = groups.length;
    const coh = sp.coherent !== false;
    const xf = k.xf;
    const st0 = bodies.length ? initialStack(xf.px, xf.py) : null;
    let vol0: Volume | null = st0 && st0.body.vol ? st0.body.vol : null;
    if (!vol0) {
      for (const v of vols) if (v.kind === 'gravity' && Math.hypot(xf.px - v.cx, xf.py - v.cy) < v.radius) vol0 = v;
    }
    let spIdx = 0;
    for (const sr of sp.spatial) {
      const ox = xf.px + xf.cs * sr.x - xf.sn * sr.y, oy = xf.py + xf.sn * sr.x + xf.cs * sr.y;
      const ca = Math.cos(sr.ang), sa = Math.sin(sr.ang);
      const dx = xf.cs * ca - xf.sn * sa, dy = xf.sn * ca + xf.cs * sa;
      for (let i = 0; i < sp.wl.length; i++) {
        const pAll = power * sr.w * sp.wlW[i];
        if (!(pAll > 0)) continue;
        E.emitted += pAll;
        for (let md = 0; md < nModes; md++) {
          let p = pAll, a = pol[0], b = pol[1], c = pol[2], d = pol[3];
          let jpr = 1, jpi = 0, jsr = 0, jsi = 0, grp = -1;
          if (WAVE) {
            if (pure) {
              if (a > 1e-12) { const q = Math.sqrt(a); jpr = q; jsr = c / q; jsi = -d / q; } else { jpr = 0; jsr = 1; }
            } else {
              p = pAll * (md === 0 ? a : b);
              if (!(p > 0)) continue;
              if (md === 0) { a = 1; b = 0; } else { a = 0; b = 1; jpr = 0; jsr = 1; }
              c = 0; d = 0;
            }
            // one coherence group per (spectral sample, polarization mode[, spatial ray if spatially incoherent])
            const gi = gBase + ((coh ? 0 : spIdx) * sp.wl.length + i) * nModes + md;
            if (!groups[gi]) groups[gi] = { wl: sp.wl[i], bw: sp.wlBw?.[i] ?? 0, fwhm: sp.wl.length === 1 ? (sp.lineFwhm ?? 0) : 0, srcFwhm: src.fwhm };
            grp = gi;
          }
          rayCount++;
          work.push({
            x: ox, y: oy, dx, dy, wl: sp.wl[i], p, pmin: p * minI, p0: p, a, b, c, d,
            stack: st0, vol: vol0, depth: 0, src, l1: null, l2: null,
            t: 0, gl: 0, opl: sr.opl ?? 0, ph: 0, grp, br: 17, jpr, jpi, jsr, jsi, wd: sr.wd ?? 0, wdv: sr.wdv ?? 0,
          });
        }
      }
      spIdx++;
    }
    for (let gi = gBase; gi < groups.length; gi++) if (!groups[gi]) groups[gi] = { wl: 550, bw: 0, fwhm: 0, srcFwhm: 0 };
  }

  // LIFO processing keeps the work list small; reverse so rays are traced in emission order
  work.reverse();
  const drain = (): void => {
    while (work.length) {
      if (segments.length >= MAX_SEGMENTS) {
        for (const r of work) E.dropped += r.p;
        work.length = 0;
        break;
      }
      propagate(work.pop()!);
    }
  };
  drain();

  // ---- wave mode: diffracting apertures re-emit Huygens-Fresnel fans (a few generations for folded paths) ----
  const FAN_BUDGET = 6000;
  function emitFans(s: Surf, gen: number): void {
    const wp = s.wap!;
    const hits = wp.hits as WHit[];
    const src = wapSrc.get(s)!;
    const pin = wp.pending;
    wp.hits = []; wp.pending = 0;
    let pout = 0;
    const tx = s.ex / s.len, ty = s.ey / s.len;
    // quadrature cells: openings are split into cells <= 0.1 mm (max 8 per opening), each re-radiating its own far field
    const Q = 24;
    const cells: { c: number; a: number; i0: number }[] = [];
    const usA: number[] = [];
    let nMax = 1;
    for (const [lo, hi] of wp.open) {
      const a = hi - lo;
      if (!(a > 0)) continue;
      const nc = Math.max(1, Math.min(8, Math.ceil(a / 0.1 - 1e-9)));
      if (nc > nMax) nMax = nc;
      for (let ci = 0; ci < nc; ci++) {
        const c0 = lo + (a * ci) / nc, cw = a / nc;
        cells.push({ c: c0 + cw / 2, a: cw, i0: usA.length });
        for (let q = 0; q < Q; q++) usA.push(c0 + ((q + 0.5) * cw) / Q);
      }
    }
    if (!cells.length || !hits.length) { E.absorbed += pin; return; }
    const us = Float64Array.from(usA);
    const duMin = cells.reduce((m, c) => Math.min(m, c.a / Q), Infinity);
    sortHits(hits);
    // count (side, group) runs to budget the fan size
    let runs = 0;
    for (let i = 0; i < hits.length; i++) if (i === 0 || hits[i].grp !== hits[i - 1].grp || hits[i].side !== hits[i - 1].side) runs++;
    let M = Math.max(32, Math.min(128, Math.round(256 / nMax)));
    if (runs * cells.length * M > FAN_BUDGET) M = Math.max(12, Math.floor(FAN_BUDGET / (runs * cells.length)));
    const lobes = Math.max(2, Math.min(6, M / 12));
    const nAmb = ambient.n(550, tC);
    let i = 0;
    while (i < hits.length) {
      let j = i + 1;
      while (j < hits.length && hits[j].grp === hits[i].grp && hits[j].side === hits[i].side) j++;
      const g = groups[hits[i].grp];
      const side = hits[i].side;
      const k0 = (2 * Math.PI * 1e6) / g.wl;
      const lamMm = g.wl * 1e-6;
      const bks = fieldBuckets(hits, i, j, us, duMin, g);
      // forward normal (the side the light continues to)
      const fnx = s.nx * s.sign * side, fny = s.ny * s.sign * side;
      for (let bi = 0; bi < bks.length; bi++) {
        const bk = bks[bi];
        const F = bk.F;
        const cR = Math.cos(k0 * bk.opl), sR = Math.sin(k0 * bk.opl);
        for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci];
          const dq = cell.a / Q;
          let pc = 0;
          for (let q = 0; q < Q; q++) { const o = 4 * (cell.i0 + q); pc += (F[o] * F[o] + F[o + 1] * F[o + 1] + F[o + 2] * F[o + 2] + F[o + 3] * F[o + 3]) * dq; }
          if (!(pc > pin * 1e-12)) continue;
          // local tilt of the incident wave: nearest ray of this group
          let s0 = bk.kt, best = Infinity;
          for (let h = i; h < j; h++) { const d = Math.abs(hits[h].u - cell.c); if (d < best) { best = d; s0 = hits[h].kt + hits[h].cv * (cell.c - hits[h].u); } }
          s0 /= nAmb;
          const S = Math.min((lobes * lamMm) / (nAmb * cell.a), 0.985 - Math.min(0.9, Math.abs(s0)));
          const c0 = Math.sqrt(Math.max(0, 1 - s0 * s0));
          const amp: number[] = [];
          let tot = 0;
          for (let m = 0; m < M; m++) {
            const sm = s0 + S * ((2 * (m + 0.5)) / M - 1);
            // Fraunhofer integral of the incident field over the cell, phase referred to the cell centre
            let apr = 0, api = 0, asr = 0, asi = 0;
            for (let q = 0; q < Q; q++) {
              const o = 4 * (cell.i0 + q);
              const ph = -k0 * nAmb * sm * (us[cell.i0 + q] - cell.c);
              const c = Math.cos(ph), sn = Math.sin(ph);
              apr += F[o] * c - F[o + 1] * sn; api += F[o] * sn + F[o + 1] * c;
              asr += F[o + 2] * c - F[o + 3] * sn; asi += F[o + 2] * sn + F[o + 3] * c;
            }
            const cm = Math.sqrt(Math.max(0, 1 - sm * sm));
            const ob = 0.5 * (1 + cm * c0 + sm * s0); // obliquity factor (1 + cos chi) / 2
            const wgt = (apr * apr + api * api + asr * asr + asi * asi) * ob * ob;
            amp.push(apr, api, asr, asi, wgt, sm, cm);
            tot += wgt;
          }
          if (!(tot > 0)) continue;
          const ox = s.ax + tx * cell.c, oy = s.ay + ty * cell.c;
          const br = mix(mix(mix(s.idx * 7919 + gen, ci), bk.key), side);
          for (let m = 0; m < M; m++) {
            const o = 7 * m;
            const p = (pc * amp[o + 4]) / tot;
            if (!(p > 0)) continue;
            const nn = Math.hypot(amp[o], amp[o + 1], amp[o + 2], amp[o + 3]);
            // Jones vector with the bucket's reference phase k0 * opl removed (it is carried by r.opl)
            const jpr = (amp[o] * cR + amp[o + 1] * sR) / nn, jpi = (amp[o + 1] * cR - amp[o] * sR) / nn;
            const jsr = (amp[o + 2] * cR + amp[o + 3] * sR) / nn, jsi = (amp[o + 3] * cR - amp[o + 2] * sR) / nn;
            const sm = amp[o + 5], cm = amp[o + 6];
            pout += p; rayCount++;
            work.push({
              x: ox, y: oy, dx: sm * tx + cm * fnx, dy: sm * ty + cm * fny, wl: g.wl, p, pmin: p * minI, p0: p,
              a: jpr * jpr + jpi * jpi, b: jsr * jsr + jsi * jsi, c: jpr * jsr + jpi * jsi, d: jpi * jsr - jpr * jsi,
              stack: null, vol: null, depth: 1, src, l1: s, l2: null,
              t: bk.t, gl: 0, opl: bk.opl, ph: 0, grp: hits[i].grp, br, jpr, jpi, jsr, jsi, wd: cell.a / 2, wdv: (2 * S) / M,
            });
          }
        }
      }
      i = j;
    }
    E.absorbed += Math.max(0, pin - pout);
  }
  if (WAVE && waps.length) {
    for (let gen = 0; gen < 6; gen++) {
      let any = false;
      for (const s of waps) if (s.wap!.hits.length) { emitFans(s, gen); any = true; }
      if (!any) break;
      work.reverse();
      drain();
    }
    for (const s of waps) { E.dropped += s.wap!.pending; s.wap!.hits = []; s.wap!.pending = 0; }
  }

  // ---- wave mode: coherent summation on the detector faces ----
  function finishWave(d: DetectorRT): void {
    const hits = d.wh as WHit[];
    const face = d.face!;
    const K = d.profile ? d.profile.length : 128;
    const du = face.len / K;
    const us = new Float64Array(K);
    for (let k = 0; k < K; k++) us[k] = (k + 0.5) * du;
    const I = new Float64Array(K), tot = new Float64Array(4);
    sortHits(hits);
    let i = 0;
    while (i < hits.length) {
      let j = i + 1;
      while (j < hits.length && hits[j].grp === hits[i].grp && hits[j].side === hits[i].side) j++;
      const g = groups[hits[i].grp];
      tot.fill(0);
      const P = bucketsToIntensity(fieldBuckets(hits, i, j, us, du, g), g, K, du, I, tot);
      d.power += P; E.detected += P;
      if (d.profile) {
        const c = d.rgb ? rgbOf(g.wl) : null;
        for (let k = 0; k < K; k++) {
          const v = I[k] * du;
          d.profile[k] += v;
          if (c) { d.rgb![3 * k] += v * c[0]; d.rgb![3 * k + 1] += v * c[1]; d.rgb![3 * k + 2] += v * c[2]; }
        }
      }
      if (d.spectrum) {
        const n = d.spectrum.length;
        const bi = Math.floor(((g.wl - d.range[0]) / (d.range[1] - d.range[0])) * n);
        if (bi >= 0 && bi < n) d.spectrum[bi] += P;
      }
      if (d.st) { d.st[0] += tot[0] + tot[1]; d.st[1] += tot[0] - tot[1]; d.st[2] += 2 * tot[2]; d.st[3] -= 2 * tot[3]; }
      if (d.wm) { d.wm[0] += P; d.wm[1] += P * g.wl; d.wm[2] += P * g.wl * g.wl; d.wm[3] += P * g.srcFwhm * g.srcFwhm; }
      i = j;
    }
  }

  for (const d of dets) {
    if (d.wh) finishWave(d);
    const out: DetectorReading = { power: d.power };
    if (d.profile) out.profile = d.profile;
    if (d.rgb) out.profileRGB = d.rgb;
    if (d.cam && d.profile) {
      // camera: pixel signal 0..1 = power x exposure x gain / saturation energy (or auto-exposed to a 0.9 peak)
      let mx = 0;
      for (const v of d.profile) if (v > mx) mx = v;
      const sc = d.cam.auto ? (mx > 0 ? 0.9 / mx : 0) : (d.cam.exposure * d.cam.gain) / d.cam.sat;
      for (let k = 0; k < d.profile.length; k++) d.profile[k] = Math.min(1, d.profile[k] * sc);
      if (d.rgb) for (let k = 0; k < d.rgb.length; k++) d.rgb[k] = Math.min(1, d.rgb[k] * sc);
    }
    if (d.spectrum) { out.spectrum = d.spectrum; out.spectrumRange = d.range; }
    if (d.hits) out.hits = d.hits;
    if (d.st) {
      const s0 = d.st[0];
      const s1 = s0 > 0 ? d.st[1] / s0 : 0, s2 = s0 > 0 ? d.st[2] / s0 : 0, s3 = s0 > 0 ? d.st[3] / s0 : 0;
      const dop = Math.min(1, Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3));
      out.stokes = { s0, s1, s2, s3, dop, azimuth: 0.5 * Math.atan2(s2, s1), ellipticity: dop > 1e-12 ? 0.5 * Math.asin(Math.max(-1, Math.min(1, s3 / dop))) : 0 };
    }
    if (d.wm && d.wm[0] > 0) {
      const mean = d.wm[1] / d.wm[0];
      const varr = Math.max(0, d.wm[2] / d.wm[0] - mean * mean);
      out.meanWavelength = mean;
      out.linewidth = Math.sqrt(2.354820045 * 2.354820045 * varr + d.wm[3] / d.wm[0]);
    }
    if (d.kind === 'concentrator') {
      const pinC = d.aux ?? 0;
      out.concentration = (d.cg ?? 1) * (pinC > 0 ? Math.min(1, d.power / pinC) : 1);
    }
    detectors[d.id] = out;
  }

  return { segments, detectors, stats: { rays: rayCount, segments: segments.length, ms: now() - t0 }, energy: E };
}
