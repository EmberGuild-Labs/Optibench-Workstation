/**
 * Pure helpers for the Instruments dock (no DOM): colour strips, false-colour maps, polarization
 * ellipse geometry, fringe visibility, wavelength <-> frequency conversions.
 */

export type RGB8 = [number, number, number];

const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Linear-light 0..1 -> sRGB-encoded 0..255 (IEC 61966-2-1 transfer curve), clamped. */
export function linearToSrgb8(v: number): number {
  const x = Math.max(0, Math.min(1, fin(v)));
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * One displayable colour per profile bin. With `rgb` (flat linear r,g,b per bin, any scale) the
 * colours are normalised by the largest channel of the whole strip, then gamma-encoded; without it
 * a grey ramp of the normalised profile is returned. NaN / negative values count as 0.
 */
export function profileStrip(profile: ArrayLike<number>, rgb?: ArrayLike<number> | null): RGB8[] {
  const n = profile.length;
  const out: RGB8[] = new Array(n);
  if (rgb && rgb.length >= n * 3) {
    let mx = 0;
    for (let i = 0; i < n * 3; i++) { const v = fin(rgb[i]); if (v > mx) mx = v; }
    const k = mx > 0 ? 1 / mx : 0;
    for (let i = 0; i < n; i++) {
      out[i] = [linearToSrgb8(fin(rgb[3 * i]) * k), linearToSrgb8(fin(rgb[3 * i + 1]) * k), linearToSrgb8(fin(rgb[3 * i + 2]) * k)];
    }
    return out;
  }
  const mx = maxOf(profile);
  for (let i = 0; i < n; i++) {
    const g = linearToSrgb8(mx > 0 ? Math.max(0, fin(profile[i])) / mx : 0);
    out[i] = [g, g, g];
  }
  return out;
}

export function maxOf(a: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const v = fin(a[i]); if (v > m) m = v; }
  return m;
}

/** "Inferno"-like false-colour map, t in 0..1 -> RGB 0..255 (black -> purple -> orange -> pale yellow). */
const STOPS: [number, number, number, number][] = [
  [0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]
];
export function falseColor(t: number): RGB8 {
  const x = Math.max(0, Math.min(1, fin(t)));
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1], b = STOPS[i];
    if (x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      return [Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f)];
    }
  }
  const l = STOPS[STOPS.length - 1];
  return [l[1], l[2], l[3]];
}

/**
 * RGBA pixels (w*h*4) for a detector image. `rgb` (interleaved linear, any scale) gives true colour
 * normalised to the brightest channel; otherwise `data` is false-coloured (sqrt scale so faint
 * fringes stay visible). Missing / short arrays render black.
 */
export function imagePixels(img: { w: number; h: number; data: ArrayLike<number>; rgb?: ArrayLike<number> }): Uint8ClampedArray {
  const w = Math.max(0, Math.floor(fin(img.w))), h = Math.max(0, Math.floor(fin(img.h)));
  const n = w * h;
  const px = new Uint8ClampedArray(n * 4);
  const rgb = img.rgb && img.rgb.length >= n * 3 ? img.rgb : null;
  if (rgb) {
    let mx = 0;
    for (let i = 0; i < n * 3; i++) { const v = fin(rgb[i]); if (v > mx) mx = v; }
    const k = mx > 0 ? 1 / mx : 0;
    for (let i = 0; i < n; i++) {
      px[4 * i] = linearToSrgb8(fin(rgb[3 * i]) * k);
      px[4 * i + 1] = linearToSrgb8(fin(rgb[3 * i + 1]) * k);
      px[4 * i + 2] = linearToSrgb8(fin(rgb[3 * i + 2]) * k);
      px[4 * i + 3] = 255;
    }
    return px;
  }
  const data = img.data ?? [];
  const mx = maxOf(data);
  for (let i = 0; i < n; i++) {
    const v = i < data.length ? Math.max(0, fin(data[i])) : 0;
    const c = falseColor(mx > 0 ? Math.sqrt(v / mx) : 0);
    px[4 * i] = c[0]; px[4 * i + 1] = c[1]; px[4 * i + 2] = c[2]; px[4 * i + 3] = 255;
  }
  return px;
}

/**
 * Fringe visibility (Imax − Imin)/(Imax + Imin) in a window of ±n/8 bins around the brightest bin.
 * Returns null when the profile is empty or dark.
 */
export function fringeVisibility(profile: ArrayLike<number>): number | null {
  const n = profile.length;
  if (!n) return null;
  let bi = 0, mx = -Infinity;
  for (let i = 0; i < n; i++) { const v = fin(profile[i]); if (v > mx) { mx = v; bi = i; } }
  if (!(mx > 0)) return null;
  const half = Math.max(1, Math.round(n / 8));
  let mn = Infinity;
  for (let i = Math.max(0, bi - half); i <= Math.min(n - 1, bi + half); i++) mn = Math.min(mn, Math.max(0, fin(profile[i])));
  return (mx - mn) / (mx + mn);
}

/**
 * Polarization ellipse traced by the E-field: azimuth ψ (rad, major axis from +x), ellipticity χ
 * (rad, tan χ = b/a, χ > 0 right-handed). Returns `n` points (unit major semi-axis, math axes,
 * y up), traversed in the rotation sense of the field (counter-clockwise for χ > 0 as seen by the
 * viewer looking into the beam).
 */
export function ellipsePoints(azimuth: number, ellipticity: number, n = 64): { x: number; y: number }[] {
  const psi = fin(azimuth), chi = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, fin(ellipticity)));
  const a = Math.cos(chi), b = Math.sin(chi);
  const c = Math.cos(psi), s = Math.sin(psi);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const u = a * Math.cos(t), v = b * Math.sin(t);
    out.push({ x: u * c - v * s, y: u * s + v * c });
  }
  return out;
}

export function handedness(ellipticity: number, tol = 0.01): 'right' | 'left' | 'linear' {
  const e = fin(ellipticity);
  return Math.abs(e) < tol ? 'linear' : e > 0 ? 'right' : 'left';
}

/** Stokes (s1, s2) projected into the unit disc (Poincaré sphere seen from the north pole). */
export function poincareXY(s1: number, s2: number): { x: number; y: number } {
  let x = fin(s1), y = fin(s2);
  const r = Math.hypot(x, y);
  if (r > 1) { x /= r; y /= r; }
  return { x, y };
}

const C_NM_THZ = 299792.458; // c in nm·THz

/** Vacuum wavelength (nm) -> frequency (THz). */
export function wavelengthToTHz(nm: number): number {
  return nm > 0 ? C_NM_THZ / nm : 0;
}

/** Linewidth Δλ (nm) at centre λ (nm) -> Δν (Hz). */
export function linewidthHz(lambdaNm: number, dLambdaNm: number): number {
  if (!(lambdaNm > 0) || !(dLambdaNm >= 0)) return 0;
  return (C_NM_THZ * 1e12 * dLambdaNm) / (lambdaNm * lambdaNm);
}

/** Linewidth (nm) formatted in nm / pm / fm. */
export function formatLinewidth(nm: number): string {
  const v = fin(nm);
  if (v <= 0) return '0 pm';
  if (v >= 1) return `${v.toPrecision(4)} nm`;
  if (v >= 1e-3) return `${(v * 1e3).toPrecision(4)} pm`;
  return `${(v * 1e6).toPrecision(4)} fm`;
}

export const RAD2DEG = 180 / Math.PI;
