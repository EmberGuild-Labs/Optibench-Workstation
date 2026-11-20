/** Shared building blocks for component definitions. */
import type { ComponentDef, OpticalComponent, OpticsSettings, ParamDef, ParamValue, Vec2 } from '../../types';
import type { DetectorKind, Prim, Xf } from '../geometry';
import { MATERIALS, customMaterial, getMaterial, type Material } from '../materials';

export type Role = 'body' | 'surface' | 'mirror' | 'absorber' | 'detector' | 'emitter' | 'aperture' | 'decor';

export interface SurfSpec {
  prim: Prim;
  kind: number;
  role: Role;
  /** Use a different transform than the component's (e.g. fiber end B). */
  xf?: Xf;
  /** Front / outward normal is the opposite of the canonical one. */
  flip?: boolean;
  rt?: (wl: number, out: Float64Array) => void;
  backAbsorb?: boolean;
  metal?: (wl: number, out: Float64Array) => void;
  rScale?: number;
  jones?: (wl: number, forward: boolean, M: Float64Array) => void;
  p1?: number; p2?: number; p3?: number; p4?: number;
  end?: number;
  /** Traced but not drawn (e.g. the open gap of a diffracting slit). */
  hidden?: boolean;
  /** WAVEAP: openings as [lo, hi] in mm along the segment from its first point. */
  open?: [number, number][];
}

export interface BodyOpts {
  material: Material;
  coating?: number;
  alphaExtra?: number;
  /** Magnetic flux density along the local +x axis (T). */
  bLocal?: number;
  grin?: { n0: Material; dn: number; halfHeight: number; profile: string };
  shg?: { kappa: number; pm: number; bw: number };
}

export interface SourceSpec {
  power: number;
  /** Spatial rays in the local frame: origin (x, y), direction angle (rad, 0 = +x), weight (sum = 1). */
  /**
   * Wave-mode extras per ray: `opl` initial optical path (mm) so that the launch points lie on one
   * wavefront, `wd` nominal 1/e^2 beamlet radius (mm), `wdv` angular spacing to the neighbour (rad).
   */
  spatial: { x: number; y: number; ang: number; w: number; opl?: number; wd?: number; wdv?: number }[];
  wl: number[];
  wlW: number[]; // sum = 1
  /** Coherency matrix [Jpp, Jss, Re Jps, Im Jps], trace 1. */
  pol: [number, number, number, number];
  /** Spatially coherent across all spatial rays (laser, collimated beam, point source). Default true. */
  coherent?: boolean;
  /** Width (nm) of the rectangular sub-band each spectral sample stands for (0 = monochromatic line). */
  wlBw?: number[];
  /** Gaussian line FWHM (nm) of a source represented by a single spectral sample. */
  lineFwhm?: number;
}

export interface Built {
  outline?: Prim[];
  body?: BodyOpts;
  surfaces?: SurfSpec[];
  decor?: { prims?: Prim[]; pts?: number[]; closed: boolean; role: Role; xf?: Xf }[];
  source?: SourceSpec;
  detector?: {
    kind: DetectorKind; bins: number; range: [number, number];
    cam?: { exposure: number; gain: number; sat: number; auto: boolean };
    /** Concentrator: geometric concentration ratio. */
    cg?: number;
    incoh?: boolean;
  };
  /** Additional refracting bodies of a compound element (cemented prisms). */
  extra?: { outline: Prim[]; body: BodyOpts }[];
  gravity?: { rs: number; radius: number };
  fiber?: { nCore: number; na: number; lengthM: number; model: string; attDb: number; pm: boolean };
  handles?: { key: string; p: Vec2 }[];
  material?: string;
}

export class Props {
  constructor(private props: Record<string, ParamValue>, private defaults: Record<string, ParamValue>) {}
  raw(key: string): ParamValue | undefined {
    const v = this.props[key];
    return v === undefined || v === null ? this.defaults[key] : v;
  }
  num(key: string): number {
    const v = this.raw(key);
    const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
    const d = this.defaults[key];
    return typeof d === 'number' ? d : 0;
  }
  str(key: string): string { return String(this.raw(key) ?? ''); }
  bool(key: string): boolean {
    const v = this.raw(key);
    return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0.5 : v === 'true';
  }
  /** Positive number with a floor (guards against degenerate geometry). */
  pos(key: string, min = 1e-3): number { return Math.max(min, Math.abs(this.num(key))); }
}

export interface BuildCtx {
  c: OpticalComponent; P: Props; settings: OpticsSettings; xf: Xf;
  /** Simulation time (s) from OpticsDrive.time; undefined = static / time-averaged trace. */
  time?: number;
}

export interface TypeDef { def: ComponentDef; build(ctx: BuildCtx): Built }

export const DEG = Math.PI / 180;

// ---- ParamDef helpers -----------------------------------------------------

export function num(key: string, label: string, def: number, unit: string, min: number, max: number, step: number, group: string, help: string, log = false): ParamDef {
  const p: ParamDef = { key, label, kind: 'number', unit, min, max, step, default: def, group, help };
  if (log) p.log = true;
  return p;
}
export function wl(key: string, label: string, def: number, group: string, help: string, min = 200, max = 2000): ParamDef {
  return { key, label, kind: 'wavelength', unit: 'nm', min, max, step: 0.1, default: def, group, help };
}
export function bool(key: string, label: string, def: boolean, group: string, help: string): ParamDef {
  return { key, label, kind: 'boolean', default: def, group, help };
}
export function str(key: string, label: string, def: string, group: string, help: string): ParamDef {
  return { key, label, kind: 'string', default: def, group, help };
}
export function sel(key: string, label: string, def: string, options: [string, string][], group: string, help: string): ParamDef {
  return { key, label, kind: 'select', default: def, options: options.map(([value, l]) => ({ value, label: l })), group, help };
}

const SOLID_MATERIALS = MATERIALS.filter((m) => m.id !== 'vacuum' && m.id !== 'air');

/** Material select + custom index/Abbe parameters. */
export function matParams(def: string): ParamDef[] {
  return [
    {
      key: 'material', label: 'Material', kind: 'select', default: def, group: 'Optical',
      options: SOLID_MATERIALS.map((m) => ({ value: m.id, label: m.label })),
      help: 'Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red.',
    },
    num('customIndex', 'Custom index n_d', 1.5, '', 1, 4, 0.001, 'Optical', 'Refractive index at 587.6 nm, used only when Material = Custom.'),
    num('customAbbe', 'Custom Abbe number', 60, '', 5, 120, 0.1, 'Optical', 'Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom.'),
  ];
}

export function resolveMat(P: Props): Material {
  const id = P.str('material');
  if (id === 'custom') return customMaterial(Math.max(1, P.num('customIndex')), P.num('customAbbe'));
  return getMaterial(id);
}

export const COATING_PARAM = sel('coating', 'Surface coating', 'none', [
  ['none', 'Uncoated (Fresnel)'], ['mgf2', 'MgF2 quarter-wave @ 550 nm'], ['ideal', 'Ideal AR (no reflection)'],
], 'Optical', 'Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs).');

export const coatingCode = (s: string) => (s === 'mgf2' ? 1 : s === 'ideal' ? 2 : 0);

export const SIZE = (def: number, help = 'Clear height of the element (extent perpendicular to the optical axis).') =>
  num('size', 'Size', def, 'mm', 1, 500, 0.5, 'Geometry', help);

// ---- shape helpers --------------------------------------------------------

export const seg = (ax: number, ay: number, bx: number, by: number): Prim => ({ k: 'seg', ax, ay, bx, by });

/** Closed polygon (flat x,y list) -> segment primitives. */
export function polygon(pts: number[]): Prim[] {
  const out: Prim[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(seg(pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]));
  }
  return out;
}

export const rect = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

/** Vertical thin-element face: segment from (x,-h/2) to (x,+h/2); canonical normal = local +x. */
export const face = (size: number, x = 0): Prim => seg(x, -size / 2, x, size / 2);

export function define(type: string, label: string, category: string, description: string, params: ParamDef[], build: (ctx: BuildCtx) => Built): TypeDef {
  return { def: { type, label, category, description, params, icon: type }, build };
}
