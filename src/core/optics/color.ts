/**
 * Colour science helpers.
 *
 * wavelengthToRGB uses the CIE 1931 2-degree colour matching functions in the analytic multi-lobe
 * Gaussian fit of Wyman, Sloan & Shirley (JCGT 2013), converts XYZ -> linear sRGB (D65) and brings
 * out-of-gamut spectral colours into gamut by desaturating towards white (adding the minimum
 * channel). The result is LINEAR sRGB scaled so that the brightest spectral colour has a maximum
 * channel of 1; because luminance follows the eye's sensitivity, summing the returned colours of
 * an equal-energy spectrum gives approximately white.
 *
 * Invisible light: below 380 nm / above 780 nm the CMFs vanish, which would make UV / IR beams
 * impossible to see on the bench. As a DISPLAY HINT (not colorimetry) a dim violet floor is blended
 * in below ~410 nm and a dim deep-red floor above ~690 nm, so UV renders dim violet and IR dim red.
 */

function lobe(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 2-degree colour matching functions (Wyman et al. 2013 fit). */
export function cieXYZ(nm: number): [number, number, number] {
  const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

export function xyzToLinearSRGB(X: number, Y: number, Z: number): [number, number, number] {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
}

function gamutMap(rgb: [number, number, number]): [number, number, number] {
  const m = Math.min(rgb[0], rgb[1], rgb[2]);
  if (m < 0) { rgb[0] -= m; rgb[1] -= m; rgb[2] -= m; }
  return rgb;
}

function rawSpectral(nm: number): [number, number, number] {
  const [X, Y, Z] = cieXYZ(nm);
  return gamutMap(xyzToLinearSRGB(X, Y, Z));
}

let NORM = 0;
function norm(): number {
  if (NORM) return NORM;
  let mx = 0;
  for (let l = 380; l <= 780; l++) {
    const c = rawSpectral(l);
    mx = Math.max(mx, c[0], c[1], c[2]);
  }
  NORM = 1 / mx;
  return NORM;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Linear sRGB (0..1) of monochromatic light of vacuum wavelength `nm`. See file header for UV/IR handling. */
export function wavelengthToRGB(nm: number): [number, number, number] {
  const k = norm();
  const c = rawSpectral(nm);
  let r = c[0] * k, g = c[1] * k, b = c[2] * k;
  if (nm < 410) {
    // UV display hint: dim violet, fading slowly towards deep UV.
    const w = smooth((410 - nm) / 30) * (0.55 + 0.45 * smooth((nm - 200) / 180));
    r = Math.max(r, 0.11 * w); b = Math.max(b, 0.2 * w);
  } else if (nm > 690) {
    // IR display hint: dim deep red, fading slowly towards the far IR.
    const w = smooth((nm - 690) / 90) * (0.5 + 0.5 * smooth((2000 - nm) / 1220));
    r = Math.max(r, 0.2 * w);
  }
  return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
}

/**
 * Colour of a sampled spectrum (power per sample). Returns linear sRGB normalised so the largest
 * channel is 1 (chromaticity only) plus the relative luminance Y per unit power.
 */
export function spectrumToRGB(wavelengths: ArrayLike<number>, powers: ArrayLike<number>): { rgb: [number, number, number]; luminance: number } {
  let X = 0, Y = 0, Z = 0, P = 0;
  for (let i = 0; i < wavelengths.length; i++) {
    const p = powers[i];
    if (!(p > 0)) continue;
    const c = cieXYZ(wavelengths[i]);
    X += c[0] * p; Y += c[1] * p; Z += c[2] * p; P += p;
  }
  if (P <= 0) return { rgb: [0, 0, 0], luminance: 0 };
  const rgb = gamutMap(xyzToLinearSRGB(X, Y, Z));
  const mx = Math.max(rgb[0], rgb[1], rgb[2]);
  if (mx <= 1e-12) {
    // only invisible light: fall back to the display hint of the power-weighted mean wavelength
    let m = 0;
    for (let i = 0; i < wavelengths.length; i++) m += wavelengths[i] * Math.max(0, powers[i]);
    return { rgb: wavelengthToRGB(m / P), luminance: 0 };
  }
  return { rgb: [rgb[0] / mx, rgb[1] / mx, rgb[2] / mx], luminance: Y / P };
}

/** sRGB opto-electronic transfer function (linear 0..1 -> display-encoded 0..1). */
export function linearToSRGB(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Blackbody spectral radiance (Planck), arbitrary units, wavelength in nm. */
export function planck(nm: number, kelvin: number): number {
  const l = nm * 1e-9;
  const x = 1.438776877e-2 / (l * Math.max(kelvin, 100));
  return 1 / (Math.pow(nm / 1000, 5) * Math.expm1(x));
}
