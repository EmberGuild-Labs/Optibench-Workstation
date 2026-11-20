/**
 * Visual classification of component geometry paths and material tints.
 * Shared by the WebGL layer (glass fills) and the Canvas2D layer (everything else).
 */
import type { ComponentGeometry, OpticalComponent, OpticsEngineAPI } from '@core/types';

export type Look =
  | 'glass'      // closed transmissive body (filled in WebGL, rim in 2D)
  | 'surface'    // open optical surface (thin glassy stroke)
  | 'metal'      // mirror
  | 'black'      // absorber / beam dump
  | 'blade'      // aperture blades
  | 'sensor'     // detector housing
  | 'face'       // detector active face
  | 'housing'    // source housing (anodized)
  | 'fiber'      // fiber cable
  | 'decor';

export type GeomPath = ComponentGeometry['paths'][number];

export function classifyPath(c: OpticalComponent, geom: ComponentGeometry, path: GeomPath): Look {
  const t = c.type;
  switch (path.role) {
    case 'mirror': return 'metal';
    case 'absorber': return 'black';
    case 'detector': return 'face';
    case 'emitter': return 'housing';
    case 'aperture': return 'blade';
    case 'decor': return t.startsWith('fiber') ? 'fiber' : 'decor';
    case 'surface': return path.closed && path.points.length > 2 ? 'glass' : 'surface';
    case 'body':
    default: {
      if (t.startsWith('source.') || geom.paths.some((p) => p.role === 'emitter')) return 'housing';
      if (t.startsWith('detector.') || geom.paths.some((p) => p.role === 'detector')) return 'sensor';
      if (t.startsWith('absorber.')) return 'black';
      if (t.startsWith('aperture.')) return 'blade';
      if (t.startsWith('fiber')) return 'fiber';
      return path.closed && path.points.length > 2 ? 'glass' : 'surface';
    }
  }
}

type RGB = [number, number, number];

/** Glass tint (linear-ish RGB 0..1) for the WebGL glass shader and the 2D rim. */
export function glassTint(c: OpticalComponent, material: string | undefined, engine: OpticsEngineAPI): RGB {
  const t = c.type;
  const m = (material ?? String(c.props.material ?? '')).toLowerCase();
  if (t.startsWith('filter.')) {
    if (t === 'filter.nd') return [0.38, 0.38, 0.41];
    const nm = Number(c.props.center ?? c.props.cutoff ?? c.props.wavelength ?? c.props.cuton ?? NaN);
    if (Number.isFinite(nm)) {
      const rgb = safeRGB(engine, nm);
      const mx = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
      return [0.25 + 0.75 * rgb[0] / mx, 0.25 + 0.75 * rgb[1] / mx, 0.25 + 0.75 * rgb[2] / mx];
    }
    return [0.9, 0.55, 0.35];
  }
  if (t.startsWith('polarizer')) return [0.5, 0.62, 0.55];
  if (t.startsWith('waveplate')) return [0.75, 0.95, 0.85];
  if (t.startsWith('magneto')) return [0.95, 0.82, 0.45];
  if (t.startsWith('nonlinear')) return [0.85, 0.72, 1.0];
  if (t.startsWith('medium.grin')) return [0.55, 1.0, 0.8];
  if (t === 'mirror.dichroic' || t.startsWith('splitter')) return [0.7, 0.9, 1.0];
  if (/water/.test(m)) return [0.35, 0.65, 1.0];
  if (/sf|flint|f2|lasf|nsf/.test(m)) return [0.95, 0.9, 0.72];
  if (/silica|quartz|fused/.test(m)) return [0.82, 0.95, 1.0];
  if (/sapphire/.test(m)) return [0.55, 0.65, 1.0];
  if (/acryl|pmma|polycarb/.test(m)) return [0.72, 1.0, 0.9];
  if (/diamond/.test(m)) return [0.95, 0.97, 1.0];
  if (/calcite|bbo|ktp|lithium|ln/.test(m)) return [0.88, 0.85, 1.0];
  if (/caf2|fluor/.test(m)) return [0.9, 1.0, 0.95];
  if (/zns|znse|germanium|si$/.test(m)) return [1.0, 0.75, 0.45];
  return [0.58, 0.85, 1.0];
}

const rgbCache = new WeakMap<OpticsEngineAPI, Map<number, RGB>>();
export function safeRGB(engine: OpticsEngineAPI, nm: number): RGB {
  let m = rgbCache.get(engine);
  if (!m) { m = new Map(); rgbCache.set(engine, m); }
  const k = Math.round(nm * 2);
  let v = m.get(k);
  if (!v) {
    try {
      const r = engine.wavelengthToRGB(k / 2);
      v = [Math.max(0, r[0] || 0), Math.max(0, r[1] || 0), Math.max(0, r[2] || 0)];
    } catch {
      v = [1, 1, 1];
    }
    m.set(k, v);
  }
  return v;
}

/** Fiber jacket colour: yellow single-mode, orange multimode (by core diameter, mm). */
export function fiberJacket(c: OpticalComponent): string {
  const core = Number(c.props.coreDiameter ?? c.props.core ?? 0.009);
  const mode = String(c.props.mode ?? c.props.fiberType ?? '').toLowerCase();
  if (mode.includes('multi')) return '#f07c1e';
  if (mode.includes('single')) return '#f2c22e';
  // engine param is in mm (0.009 mm single-mode … 1 mm polymer); values > 2 are assumed µm
  const mm = core > 2 ? core / 1000 : core;
  return mm > 0.015 ? '#f07c1e' : '#f2c22e';
}

export const ACCENT = '#00e5ff';
export const ACCENT_RGB = '0,229,255';
