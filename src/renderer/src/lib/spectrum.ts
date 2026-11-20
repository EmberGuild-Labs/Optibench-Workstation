/** Fallback visible-spectrum colour (Bruton approximation) used when no engine is available. */
export function wavelengthToRGBFallback(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490 && nm >= 440) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510 && nm >= 490) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580 && nm >= 510) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645 && nm >= 580) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780 && nm >= 645) { r = 1; }
  let f = 0;
  if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm >= 420 && nm <= 700) f = 1;
  else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / 80;
  return [r * f, g * f, b * f];
}

export type RGBFn = (nm: number) => [number, number, number];

export function rgbCss(rgb: [number, number, number], alpha = 1, minLum = 0): string {
  let [r, g, b] = rgb.map((c) => Math.max(0, Math.min(1, c)));
  const lum = Math.max(r, g, b);
  if (lum < minLum) {
    // invisible (UV/IR): show a dim violet/red hint instead of black
    const k = minLum - lum;
    r += k * 0.6; b += k * 0.8; g += k * 0.2;
  }
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** CSS linear-gradient of the spectrum between lo and hi nm. */
export function spectrumGradient(fn: RGBFn, lo = 380, hi = 780, stops = 24): string {
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const nm = lo + ((hi - lo) * i) / stops;
    parts.push(`${rgbCss(fn(nm), 1, 0.12)} ${((i / stops) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
