/**
 * Wave-optics field reconstruction on a plane (detector face or diffracting aperture).
 *
 * Every ray that reaches the plane is recorded as a `WHit`: position u along the face, transverse
 * direction cosine, optical path length, extra phase, power and unit Jones vector. Rays are
 * grouped by
 *   - coherence group  (same source, spectral sample and polarization mode -> mutually coherent)
 *   - branch           (same sequence of surfaces / split decisions -> same sheet of the wavefront)
 * Within a branch neighbouring rays sample one smooth wavefront, so the field between two rays is
 * interpolated: amplitude sqrt(P_i / d_i) (d_i = local ray spacing = ray density) linearly, phase
 * by a cubic Hermite spline through the rays' absolute phases 2 pi OPL / lambda with slopes
 * 2 pi n sin(theta) / lambda (each ray is a local plane wave; the spline adds the wavefront
 * curvature). A lone ray is deposited as a local plane wave with a Gaussian transverse envelope
 * of its nominal beamlet radius. Different branches of one group are summed coherently
 * (interference); p and s components are kept separate, so orthogonal polarizations do not
 * interfere (Fresnel-Arago). Different groups add in intensity.
 *
 * Temporal coherence: a group's spectral sample stands for a sub-band (rectangular, width bw) or a
 * Gaussian line (FWHM); fields are binned by optical path into buckets much shorter than the
 * coherence length L_c = lambda^2 / d_lambda and bucket pairs interfere with the degree of
 * coherence gamma(dOPL) (sinc for a rectangular band, Gaussian for a Gaussian line).
 */

export interface WHit {
  /** Position along the face from its start point (mm). */
  u: number;
  /** n * (d . t): index times the direction cosine along the face. */
  kt: number;
  /** Optical path length sum(n ds) from the source (mm). */
  opl: number;
  /** Extra phase (rad): thin-element reflections, gratings, ideal lenses ... */
  ph: number;
  /** Power (W). */
  p: number;
  /** Unit Jones vector (p, s), complex; carries Fresnel / metal / TIR / retarder phases. */
  jpr: number; jpi: number; jsr: number; jsi: number;
  wl: number;
  grp: number;
  br: number;
  /** Nominal beamlet 1/e^2 radius along the face (mm) and nominal d(kt)/du (1/mm), for lone rays. */
  w: number;
  cv: number;
  /** Arrival time (s). */
  t: number;
  /** +1: travelling along the face's front normal, -1: against it. */
  side: number;
}

export interface CohGroup {
  wl: number;
  /** Rectangular sub-band width (nm), 0 = line. */
  bw: number;
  /** Gaussian line FWHM (nm), 0 = monochromatic. */
  fwhm: number;
  /** Source line width for wavemeters (nm). */
  srcFwhm: number;
}

/** Coherence length in mm (Infinity for a monochromatic group). */
export function coherenceLengthMm(g: CohGroup): number {
  const d = g.bw > 0 ? g.bw : g.fwhm;
  return d > 0 ? (g.wl * g.wl) / d * 1e-6 : Infinity;
}

/** Degree of temporal coherence for an optical path difference `d` (mm). */
export function degreeOfCoherence(g: CohGroup, d: number): number {
  if (g.bw > 0) {
    const x = (Math.PI * d * 1e6 * g.bw) / (g.wl * g.wl);
    return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
  }
  if (g.fwhm > 0) {
    const x = (Math.PI * d * 1e6 * g.fwhm) / (g.wl * g.wl);
    return Math.exp(-(x * x) / (4 * Math.LN2));
  }
  return 1;
}

export interface Bucket {
  /** Field samples: [Re Ep, Im Ep, Re Es, Im Es] per sample position, in sqrt(W/mm). */
  F: Float64Array;
  /** Power-weighted sums (divide by p). */
  opl: number; t: number; kt: number; p: number;
  key: number;
}

const POOL: Float64Array[] = [];
let poolUsed = 0;
function take(n: number): Float64Array {
  let a = POOL[poolUsed];
  if (!a || a.length !== n) { a = new Float64Array(n); POOL[poolUsed] = a; } else a.fill(0);
  poolUsed++;
  return a;
}

/** First index k with us[k] >= x. */
function lower(us: Float64Array, x: number): number {
  let lo = 0, hi = us.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (us[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

export function sortHits(hits: WHit[]): void {
  hits.sort((a, b) => a.side - b.side || a.grp - b.grp || a.br - b.br || a.u - b.u);
}

/**
 * Field of one coherence group on the sample positions `us` (ascending, mm), from
 * hits[lo..hi) which must share group and side and be sorted by (branch, u).
 * `du` is the sample spacing (lower bound for beamlet widths). The returned buckets (and their
 * arrays) are only valid until the next call.
 */
export function fieldBuckets(hits: WHit[], lo: number, hi: number, us: Float64Array, du: number, g: CohGroup): Bucket[] {
  poolUsed = 0;
  const K = us.length;
  const k0 = (2 * Math.PI * 1e6) / g.wl; // rad per mm of optical path
  const Lc = coherenceLengthMm(g);
  let oplMin = Infinity, oplMax = -Infinity;
  for (let i = lo; i < hi; i++) { const o = hits[i].opl; if (o < oplMin) oplMin = o; if (o > oplMax) oplMax = o; }
  let bwid = Number.isFinite(Lc) ? Lc / 8 : Infinity;
  const map = new Map<number, Bucket>();
  const buckets: Bucket[] = [];
  if (Number.isFinite(bwid)) {
    // keep the number of occupied buckets bounded
    for (let tries = 0; tries < 40; tries++) {
      const seen = new Set<number>();
      for (let i = lo; i < hi && seen.size <= 48; i++) seen.add(Math.floor((hits[i].opl - oplMin) / bwid));
      if (seen.size <= 48) break;
      bwid *= 2;
    }
  }
  const bucketOf = (h: WHit): Bucket => {
    const key = Number.isFinite(bwid) ? Math.floor((h.opl - oplMin) / bwid) : 0;
    let b = map.get(key);
    if (!b) { b = { F: take(4 * K), opl: 0, t: 0, kt: 0, p: 0, key }; map.set(key, b); buckets.push(b); }
    return b;
  };
  for (let i = lo; i < hi; i++) {
    const h = hits[i], b = bucketOf(h);
    b.opl += h.p * h.opl; b.t += h.p * h.t; b.kt += h.p * h.kt; b.p += h.p;
  }

  /** Lone ray: local plane wave with Gaussian envelope (unit-power normalised). */
  const gauss = (h: WHit, u: number, p: number, w: number, kt: number): void => {
    w = Math.max(w, du, 1e-6);
    const F = bucketOf(h).F;
    const a0 = Math.sqrt(p) * Math.pow(2 / (Math.PI * w * w), 0.25);
    const kA = lower(us, u - 2.6 * w), kB = lower(us, u + 2.6 * w);
    const base = k0 * h.opl + h.ph;
    for (let k = kA; k < kB; k++) {
      const d = us[k] - u;
      const a = a0 * Math.exp(-(d * d) / (w * w));
      const phi = base + k0 * (kt * d + 0.5 * h.cv * d * d);
      const c = Math.cos(phi), s = Math.sin(phi);
      const o = 4 * k;
      F[o] += a * (h.jpr * c - h.jpi * s); F[o + 1] += a * (h.jpr * s + h.jpi * c);
      F[o + 2] += a * (h.jsr * c - h.jsi * s); F[o + 3] += a * (h.jsr * s + h.jsi * c);
    }
  };

  const amp: number[] = [];
  /** Smooth run of >= 2 rays hits[a..b) (sorted by u): interpolate between neighbours. */
  const smooth = (a: number, b: number): void => {
    const m = b - a;
    amp.length = m;
    for (let i = 0; i < m; i++) {
      const h = hits[a + i];
      const d = i === 0 ? hits[a + 1].u - h.u : i === m - 1 ? h.u - hits[a + m - 2].u : (hits[a + i + 1].u - hits[a + i - 1].u) / 2;
      amp[i] = Math.sqrt(h.p / Math.max(d, 1e-9));
    }
    for (let i = 0; i < m - 1; i++) {
      const h0 = hits[a + i], h1 = hits[a + i + 1];
      const L = h1.u - h0.u;
      if (!(L > 0)) continue;
      const kA = lower(us, h0.u), kB = lower(us, h1.u);
      if (kA >= kB) continue;
      const p0 = k0 * h0.opl + h0.ph, p1 = k0 * h1.opl + h1.ph;
      const m0 = k0 * h0.kt * L, m1 = k0 * h1.kt * L;
      const a0 = amp[i], a1 = amp[i + 1];
      const F0 = bucketOf(h0).F, F1 = bucketOf(h1).F;
      for (let k = kA; k < kB; k++) {
        const t = (us[k] - h0.u) / L, t2 = t * t, t3 = t2 * t;
        const phi = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * p1 + (t3 - t2) * m1;
        const c = Math.cos(phi), s = Math.sin(phi);
        const o = 4 * k;
        let w = a0 * (1 - t);
        F0[o] += w * (h0.jpr * c - h0.jpi * s); F0[o + 1] += w * (h0.jpr * s + h0.jpi * c);
        F0[o + 2] += w * (h0.jsr * c - h0.jsi * s); F0[o + 3] += w * (h0.jsr * s + h0.jsi * c);
        w = a1 * t;
        F1[o] += w * (h1.jpr * c - h1.jpi * s); F1[o + 1] += w * (h1.jpr * s + h1.jpi * c);
        F1[o + 2] += w * (h1.jsr * c - h1.jsi * s); F1[o + 3] += w * (h1.jsr * s + h1.jsi * c);
      }
    }
    // half a spacing beyond each end, carried by the end ray with the end interval's curvature
    for (let e = 0; e < 2; e++) {
      const h = e === 0 ? hits[a] : hits[b - 1];
      const hn = e === 0 ? hits[a + 1] : hits[b - 2];
      const L = Math.abs(hn.u - h.u);
      if (!(L > 0)) continue;
      const cv = (hn.kt - h.kt) / (hn.u - h.u);
      const kA = e === 0 ? lower(us, h.u - L / 2) : lower(us, h.u);
      const kB = e === 0 ? lower(us, h.u) : lower(us, h.u + L / 2);
      const F = bucketOf(h).F, a0 = amp[e === 0 ? 0 : m - 1];
      const base = k0 * h.opl + h.ph;
      for (let k = kA; k < kB; k++) {
        const d = us[k] - h.u;
        const phi = base + k0 * (h.kt * d + 0.5 * cv * d * d);
        const c = Math.cos(phi), s = Math.sin(phi);
        const o = 4 * k;
        F[o] += a0 * (h.jpr * c - h.jpi * s); F[o + 1] += a0 * (h.jpr * s + h.jpi * c);
        F[o + 2] += a0 * (h.jsr * c - h.jsi * s); F[o + 3] += a0 * (h.jsr * s + h.jsi * c);
      }
    }
  };

  /** A run too small to resolve (focus / caustic / single ray): one merged beamlet. */
  const merged = (a: number, b: number): void => {
    if (b - a === 1) { const h = hits[a]; gauss(h, h.u, h.p, h.w, h.kt); return; }
    let P = 0, U = 0, KT = 0, best = hits[a];
    for (let i = a; i < b; i++) { const h = hits[i]; P += h.p; U += h.p * h.u; KT += h.p * h.kt; if (h.p > best.p) best = h; }
    if (!(P > 0)) return;
    U /= P; KT /= P;
    // phase of the strongest ray referred to the centroid
    const ext = hits[b - 1].u - hits[a].u;
    const ref: WHit = { ...best, opl: best.opl + best.kt * (U - best.u), cv: 0 };
    gauss(ref, U, P, Math.max(ext / 2, du), KT);
  };

  const gaps: number[] = [];
  let i = lo;
  while (i < hi) {
    let j = i + 1;
    while (j < hi && hits[j].br === hits[i].br) j++;
    // split the branch at gaps much wider than the typical ray spacing
    if (j - i >= 3) {
      gaps.length = 0;
      for (let k = i + 1; k < j; k++) gaps.push(hits[k].u - hits[k - 1].u);
      const sorted = gaps.slice().sort((x, y) => x - y);
      const med = sorted[sorted.length >> 1];
      const lim = Math.max(4 * med, 1e-9);
      let a = i;
      for (let k = i + 1; k <= j; k++) {
        if (k === j || hits[k].u - hits[k - 1].u > lim) {
          if (k - a >= 2 && hits[k - 1].u - hits[a].u >= 2 * du) smooth(a, k); else merged(a, k);
          a = k;
        }
      }
    } else if (j - i === 2 && hits[i + 1].u - hits[i].u >= 2 * du && hits[i + 1].u - hits[i].u < 4 * (hits[i].w + hits[i + 1].w + du)) {
      smooth(i, j);
    } else if (j - i === 2 && hits[i + 1].u - hits[i].u >= 2 * du) {
      merged(i, i + 1); merged(i + 1, j);
    } else merged(i, j);
    i = j;
  }
  for (const b of buckets) if (b.p > 0) { b.opl /= b.p; b.t /= b.p; b.kt /= b.p; }
  return buckets;
}

/**
 * Intensity per sample (W/mm) of one group from its buckets, including partial temporal coherence.
 * Adds into outI and accumulates the integrated coherency J = [Jpp, Jss, Re Jps, Im Jps] * du into tot.
 * Returns the integrated power (W).
 */
export function bucketsToIntensity(buckets: Bucket[], g: CohGroup, K: number, du: number, outI: Float64Array, tot: Float64Array): number {
  let P = 0;
  const nb = buckets.length;
  if (nb === 0) return 0;
  if (nb === 1) {
    const F = buckets[0].F;
    for (let k = 0; k < K; k++) {
      const o = 4 * k;
      const pr = F[o], pi = F[o + 1], sr = F[o + 2], si = F[o + 3];
      const jpp = pr * pr + pi * pi, jss = sr * sr + si * si;
      outI[k] = jpp + jss;
      tot[0] += jpp * du; tot[1] += jss * du;
      tot[2] += (pr * sr + pi * si) * du; tot[3] += (pi * sr - pr * si) * du;
      P += (jpp + jss) * du;
    }
    return P;
  }
  const gam = new Float64Array(nb * nb);
  for (let a = 0; a < nb; a++) for (let b = 0; b < nb; b++) gam[a * nb + b] = a === b ? 1 : degreeOfCoherence(g, buckets[a].opl - buckets[b].opl);
  for (let k = 0; k < K; k++) {
    const o = 4 * k;
    let jpp = 0, jss = 0, jre = 0, jim = 0;
    for (let a = 0; a < nb; a++) {
      const A = buckets[a].F;
      const apr = A[o], api = A[o + 1], asr = A[o + 2], asi = A[o + 3];
      if (apr === 0 && api === 0 && asr === 0 && asi === 0) continue;
      for (let b = 0; b < nb; b++) {
        const B = buckets[b].F;
        const bpr = B[o], bpi = B[o + 1], bsr = B[o + 2], bsi = B[o + 3];
        const gm = gam[a * nb + b];
        jpp += gm * (apr * bpr + api * bpi);
        jss += gm * (asr * bsr + asi * bsi);
        // Ep_a * conj(Es_b)
        jre += gm * (apr * bsr + api * bsi);
        jim += gm * (api * bsr - apr * bsi);
      }
    }
    if (jpp < 0) jpp = 0;
    if (jss < 0) jss = 0;
    outI[k] = jpp + jss;
    tot[0] += jpp * du; tot[1] += jss * du; tot[2] += jre * du; tot[3] += jim * du;
    P += (jpp + jss) * du;
  }
  return P;
}
