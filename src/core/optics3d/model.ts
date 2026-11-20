/**
 * 3D optical model of a component, derived from the SAME description the 2D engine uses.
 *
 * Every 2D component type builds a `Built` record (local-space primitives: segments, circular arcs,
 * parabolas, plus behaviour callbacks — Fresnel bodies, Jones matrices, R/T curves, metal n/k …).
 * This module calls the very same `build()` and LIFTS each 2D primitive into a 3D surface, either
 *
 *   revolve  — surface of revolution about the optical axis (local x):
 *              vertical segment → disc / annulus,  other segment → cylinder / cone,
 *              arc centred on the axis → spherical cap,  parabola → paraboloid
 *   extrude  — prism along the table normal (local z) of height H, centred on the beam plane:
 *              segment → rectangle,  arc → cylinder section,  parabola → parabolic cylinder,
 *              refracting outlines additionally get top / bottom caps (polygons)
 *
 * so the z = 0 cross-section of the 3D model is exactly the 2D geometry, new component types added
 * to the 2D registry work in 3D automatically, and the meshes drawn by getGeometry3D are generated
 * from these very surfaces (what is drawn is what is traced).
 *
 * All surface data live in the part's L2 frame (x, 2D-y, z) — see math.ts.
 */
import type { OpticalComponent, OpticsSettings, ParamValue } from '../types';
import type { Vec3 } from '../types3d';
import { Props, type Built, type Role, type SourceSpec, type SurfSpec } from '../optics/components/common';
import { SK, makeXf, type Prim, type Xf } from '../optics/geometry';
import type { Material } from '../optics/materials';
import { getDefaults, getTypeDef } from '../optics/registry';
import { frameFrom, frameOf, l2Of, poseOf, type Frame } from './math';

export const G = { DISC: 0, CONE: 1, SPHERE: 2, PARAB: 3, XSEG: 4, XARC: 5, XPAR: 6, CAP: 7 } as const;

export interface Part {
  id: string;
  /** L2 frame. */
  f: Frame;
  ox: number; oy: number; oz: number;
  Xx: number; Xy: number; Xz: number; Yx: number; Yy: number; Yz: number; Zx: number; Zy: number; Zz: number;
  surfs: Surf3[];
  /** Bounding sphere (world). */
  bx: number; by: number; bz: number; br2: number; br: number;
  /** Local (L2) extents of all surfaces. */
  ext: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; rmax: number };
}

export interface Vol3 {
  kind: 'grin' | 'gravity';
  /** Index at a world point (−1 = captured); writes the world-space gradient into gx, gy, gz. */
  eval(x: number, y: number, z: number, wl: number): number;
  gx: number; gy: number; gz: number;
  step(x: number, y: number, z: number): number;
  parts: Part[];
  cx: number; cy: number; cz: number; radius: number;
}

export interface Body3 {
  mat: Material;
  coating: number;
  alphaExtra: number;
  /** Magnetic flux density (T), world frame. */
  Bx: number; By: number; Bz: number;
  vol: Vol3 | null;
  shg: { kappa: number; pm: number; bw: number } | null;
  part: Part;
}

export interface Det3 {
  id: string; kind: string;
  power: number;
  profile: number[] | null; spectrum: number[] | null;
  hits: { p: { x: number; y: number }; wavelength: number; power: number }[] | null;
  hits3d: { p: Vec3; u: number; v: number; wavelength: number; power: number }[];
  range: [number, number];
  w: number; h: number; img: number[]; rgb: number[];
  widthMm: number; heightMm: number;
  /** RGB of the 1D profile, camera settings, Stokes sums, wavemeter sums, concentrator ratio + entrance tally. */
  prgb: number[] | null;
  cam: { exposure: number; gain: number; sat: number; auto: boolean } | null;
  st: Float64Array | null; wm: Float64Array | null;
  cg: number; aux: number;
}

export interface Fiber3 { nCore: number; na: number; lengthM: number; model: string; attDb: number; pm: boolean; faces: Surf3[] }

export interface Surf3 {
  g: number; kind: number; sign: number; part: Part;
  x0: number; x1: number; r0: number; r1: number;
  nx: number; ny: number;
  cx: number; cy: number; r: number; mx: number; my: number; cosHalf: number; a0: number; a1: number;
  ax: number; ay: number; ex: number; ey: number; len: number;
  f: number; h: number;
  /** Parabola section: local y range (XPAR); PARAB uses r0..r1 as the radial range. */
  h0: number; h1: number;
  z0: number; z1: number;
  poly: number[] | null;
  /** In-plane parametrisation of planar surfaces: tangent (2D), centre, width (along t), height. */
  tx: number; ty: number; ucx: number; ucy: number; wid: number; hgt: number;
  body: Body3 | null; spec: SurfSpec | null; det: Det3 | null; vol: Vol3 | null; fiber: Fiber3 | null; end: number;
  role: Role; hidden: boolean;
}

export interface Model3 {
  c: OpticalComponent;
  type: string;
  P: Props;
  built: Built;
  /** Contract-local frame of the component. */
  frame: Frame;
  /** parts[0] is the component itself; further parts are sub-frames (fibre end B). */
  parts: Part[];
  bodies: Body3[];
  source: SourceSpec | null;
  det: Det3 | null;
  vol: Vol3 | null;
  fiber: Fiber3 | null;
  mode: 'revolve' | 'extrude';
  /** Extrusion height (mm). */
  H: number;
  /** Tessellated body outline (flat x, y list in L2) or null. */
  outline: number[] | null;
  material?: string;
}

// ---------------------------------------------------------------------------

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function newPart(id: string, f: Frame): Part {
  return {
    id, f, ox: f.o.x, oy: f.o.y, oz: f.o.z,
    Xx: f.X.x, Xy: f.X.y, Xz: f.X.z, Yx: f.Y.x, Yy: f.Y.y, Yz: f.Y.z, Zx: f.Z.x, Zy: f.Z.y, Zz: f.Z.z,
    surfs: [], bx: f.o.x, by: f.o.y, bz: f.o.z, br2: 0, br: 0,
    ext: { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, rmax: 0 },
  };
}

function blank(part: Part): Surf3 {
  return {
    g: G.DISC, kind: SK.THIN, sign: 1, part, x0: 0, x1: 0, r0: 0, r1: 0, nx: 1, ny: 0,
    cx: 0, cy: 0, r: 0, mx: 1, my: 0, cosHalf: -2, a0: 0, a1: 0, ax: 0, ay: 0, ex: 0, ey: 0, len: 1,
    f: 1, h: 0, h0: 0, h1: 0, z0: 0, z1: 0, poly: null, tx: 0, ty: 1, ucx: 0, ucy: 0, wid: 1, hgt: 1,
    body: null, spec: null, det: null, vol: null, fiber: null, end: 0, role: 'surface', hidden: false,
  };
}

/** Tessellate a 2D primitive into flat (x, y) points, inclusive of both ends. */
export function tessPrim(p: Prim, out: number[], arcStep = 0.1): void {
  if (p.k === 'seg') out.push(p.ax, p.ay, p.bx, p.by);
  else if (p.k === 'arc') {
    const sweep = p.a1 - p.a0;
    const n = Math.max(6, Math.min(160, Math.ceil(Math.abs(sweep) / arcStep)));
    for (let i = 0; i <= n; i++) { const a = p.a0 + (sweep * i) / n; out.push(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)); }
  } else {
    const n = 32, y0 = p.y0 ?? -p.h, y1 = p.y1 ?? p.h;
    for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; out.push(-(y * y) / (4 * p.f), y); }
  }
}

function loopOf(prims: Prim[]): number[] {
  const flat: number[] = [], tmp: number[] = [];
  for (const p of prims) {
    tmp.length = 0; tessPrim(p, tmp);
    for (let i = 0; i < tmp.length; i += 2) {
      const n = flat.length;
      if (n >= 2 && Math.abs(flat[n - 2] - tmp[i]) < 1e-9 && Math.abs(flat[n - 1] - tmp[i + 1]) < 1e-9) continue;
      flat.push(tmp[i], tmp[i + 1]);
    }
  }
  const n = flat.length;
  if (n >= 4 && Math.abs(flat[0] - flat[n - 2]) < 1e-9 && Math.abs(flat[1] - flat[n - 1]) < 1e-9) flat.length = n - 2;
  return flat;
}

function signedArea(l: number[]): number {
  let a = 0;
  for (let i = 0, n = l.length / 2; i < n; i++) { const j = (i + 1) % n; a += l[2 * i] * l[2 * j + 1] - l[2 * j] * l[2 * i + 1]; }
  return a / 2;
}

function cosRange(a0: number, a1: number): [number, number] {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  if (hi - lo >= 2 * Math.PI - 1e-9) return [-1, 1];
  let mn = Math.min(Math.cos(lo), Math.cos(hi)), mx = Math.max(Math.cos(lo), Math.cos(hi));
  for (let m = Math.ceil(lo / Math.PI); m * Math.PI <= hi; m++) { if (m % 2 === 0) mx = 1; else mn = -1; }
  return [mn, mx];
}

const REVOLVE_PREFIX = ['lens.', 'mirror.', 'polarizer.', 'waveplate.', 'filter.', 'magneto.', 'field.', 'fiber.', 'beam.', 'diffuser.'];
const REVOLVE_TYPES = new Set(['aperture.iris', 'detector.power', 'detector.spectrometer']);

function revolvable(p: Prim): boolean {
  if (p.k === 'arc') return Math.abs(p.cy) < 1e-9;
  if (p.k === 'seg') return Math.abs(p.ax - p.bx) < 1e-9 || p.ay * p.by >= -1e-12;
  return true;
}

/** Height (mm) of extruded components: prop `height3d` if set, else a per-type natural size. */
function extrudeHeight(type: string, P: Props, prims: Prim[]): number {
  const h3 = P.raw('height3d');
  if (typeof h3 === 'number' && h3 > 0) return h3;
  const pick = (k: string): number => { const v = P.raw(k); return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0; };
  if (type === 'block.semicircle') { const r = pick('radius'); if (r) return r; }
  for (const k of ['size', 'height', 'diameter', 'aperture', 'entranceWidth']) { const v = pick(k); if (v) return v; }
  let lo = Infinity, hi = -Infinity;
  const pts: number[] = [];
  for (const p of prims) tessPrim(p, pts);
  for (let i = 1; i < pts.length; i += 2) { lo = Math.min(lo, pts[i]); hi = Math.max(hi, pts[i]); }
  return hi > lo ? Math.max(1, hi - lo) : 10;
}

function liftRevolve(p: Prim, sign: number, part: Part): Surf3 {
  const s = blank(part);
  s.sign = sign;
  if (p.k === 'seg') {
    let ax = p.ax, ay = p.ay, bx = p.bx, by = p.by;
    const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1e-12;
    const nx = ey / len;
    let ny = -ex / len;
    if (Math.abs(ax - bx) < 1e-9) {
      s.g = G.DISC; s.x0 = s.x1 = ax;
      s.r0 = ay * by < 0 ? 0 : Math.min(Math.abs(ay), Math.abs(by));
      s.r1 = Math.max(Math.abs(ay), Math.abs(by));
      s.nx = nx >= 0 ? 1 : -1; s.ny = 0;
      s.tx = 0; s.ty = ey >= 0 ? 1 : -1; s.ucx = ax; s.ucy = 0; s.wid = s.hgt = 2 * s.r1;
    } else {
      if (ay + by < 0) { ay = -ay; by = -by; ny = -ny; }
      ay = Math.max(0, ay); by = Math.max(0, by);
      if (ax > bx) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
      s.g = G.CONE; s.x0 = ax; s.r0 = ay; s.x1 = bx; s.r1 = by; s.nx = nx; s.ny = ny;
    }
  } else if (p.k === 'arc') {
    s.g = G.SPHERE; s.cx = p.cx; s.cy = 0; s.r = p.r; s.a0 = p.a0; s.a1 = p.a1;
    const [mn, mx] = cosRange(p.a0, p.a1);
    s.x0 = p.cx + p.r * mn - 1e-9; s.x1 = p.cx + p.r * mx + 1e-9;
  } else {
    s.g = G.PARAB; s.f = p.f; s.h = p.h;
    const y0 = p.y0 ?? -p.h, y1 = p.y1 ?? p.h;
    s.r0 = y0 * y1 > 0 ? Math.min(Math.abs(y0), Math.abs(y1)) : 0; s.r1 = Math.max(Math.abs(y0), Math.abs(y1));
  }
  return s;
}

function liftExtrude(p: Prim, sign: number, part: Part, z0: number, z1: number): Surf3 {
  const s = blank(part);
  s.sign = sign; s.z0 = z0; s.z1 = z1;
  if (p.k === 'seg') {
    s.g = G.XSEG; s.ax = p.ax; s.ay = p.ay; s.ex = p.bx - p.ax; s.ey = p.by - p.ay;
    s.len = Math.hypot(s.ex, s.ey) || 1e-12;
    s.nx = s.ey / s.len; s.ny = -s.ex / s.len;
    s.tx = s.ex / s.len; s.ty = s.ey / s.len; s.ucx = p.ax + s.ex / 2; s.ucy = p.ay + s.ey / 2; s.wid = s.len; s.hgt = z1 - z0;
  } else if (p.k === 'arc') {
    s.g = G.XARC; s.cx = p.cx; s.cy = p.cy; s.r = p.r; s.a0 = p.a0; s.a1 = p.a1;
    const mid = (p.a0 + p.a1) / 2, half = Math.abs(p.a1 - p.a0) / 2;
    s.mx = Math.cos(mid); s.my = Math.sin(mid); s.cosHalf = half >= Math.PI - 1e-12 ? -2 : Math.cos(half);
  } else {
    s.g = G.XPAR; s.f = p.f; s.h = p.h; s.h0 = p.y0 ?? -p.h; s.h1 = p.y1 ?? p.h;
  }
  return s;
}

function surfExtent(s: Surf3, e: Part['ext']): void {
  const add = (x: number, y: number, z: number) => {
    if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
    if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y;
    if (z < e.z0) e.z0 = z; if (z > e.z1) e.z1 = z;
  };
  const rev = (x0: number, x1: number, r: number) => { add(x0, -r, -r); add(x1, r, r); if (r > e.rmax) e.rmax = r; };
  switch (s.g) {
    case G.DISC: rev(s.x0, s.x0, s.r1); break;
    case G.CONE: rev(s.x0, s.x1, Math.max(s.r0, s.r1)); break;
    case G.SPHERE: {
      const inside = s.cx >= s.x0 && s.cx <= s.x1;
      const rho = (x: number) => Math.sqrt(Math.max(0, s.r * s.r - (x - s.cx) * (x - s.cx)));
      rev(s.x0, s.x1, inside ? s.r : Math.max(rho(s.x0), rho(s.x1)));
      break;
    }
    case G.PARAB: { const xe = -(s.r1 * s.r1) / (4 * s.f); rev(Math.min(0, xe), Math.max(0, xe), s.r1); break; }
    case G.XSEG: add(s.ax, s.ay, s.z0); add(s.ax + s.ex, s.ay + s.ey, s.z1); break;
    case G.XARC: add(s.cx - s.r, s.cy - s.r, s.z0); add(s.cx + s.r, s.cy + s.r, s.z1); break;
    case G.XPAR: { const xa = -(s.h0 * s.h0) / (4 * s.f), xb = -(s.h1 * s.h1) / (4 * s.f), xm = s.h0 * s.h1 < 0 ? 0 : xa; add(Math.min(xa, xb, xm), s.h0, s.z0); add(Math.max(xa, xb, xm), s.h1, s.z1); break; }
    default: { const p = s.poly!; for (let i = 0; i < p.length; i += 2) add(p[i], p[i + 1], s.z0); }
  }
}

function finishPart(pt: Part): void {
  const e = pt.ext;
  e.x0 = e.y0 = e.z0 = Infinity; e.x1 = e.y1 = e.z1 = -Infinity; e.rmax = 0;
  for (const s of pt.surfs) surfExtent(s, e);
  if (!pt.surfs.length) { e.x0 = e.y0 = e.z0 = e.x1 = e.y1 = e.z1 = 0; }
  const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, cz = (e.z0 + e.z1) / 2;
  const r = 0.5 * Math.hypot(e.x1 - e.x0, e.y1 - e.y0, e.z1 - e.z0) + 1e-6;
  pt.bx = pt.ox + pt.Xx * cx + pt.Yx * cy + pt.Zx * cz;
  pt.by = pt.oy + pt.Xy * cx + pt.Yy * cy + pt.Zy * cz;
  pt.bz = pt.oz + pt.Xz * cx + pt.Yz * cy + pt.Zz * cz;
  pt.br = r; pt.br2 = r * r;
}

function grinVolume(pt: Part, g: NonNullable<NonNullable<Built['body']>['grin']>, tC: number): Vol3 {
  const { n0, dn, halfHeight: h } = g;
  const linear = g.profile === 'linear';
  const curv = Math.abs(dn) > 1e-9 ? h * Math.sqrt(1.5 / (2 * Math.abs(dn))) : 1e9;
  const stepLen = Math.max(0.15, Math.min(2.5, curv / 14, h / 2));
  let lastWl = -1, lastN0 = 0;
  const vol: Vol3 = {
    kind: 'grin', gx: 0, gy: 0, gz: 0, parts: [], cx: 0, cy: 0, cz: 0, radius: 0,
    eval(x, y, z, w) {
      if (w !== lastWl) { lastWl = w; lastN0 = n0.n(w, tC); }
      const ly = (x - pt.ox) * pt.Yx + (y - pt.oy) * pt.Yy + (z - pt.oz) * pt.Yz;
      const q = ly / h;
      let n: number, g1: number;
      if (linear) { n = lastN0 + dn * q; g1 = dn / h; } else { n = lastN0 - dn * q * q; g1 = (-2 * dn * q) / h; }
      if (n < 1) { n = 1; g1 = 0; }
      vol.gx = pt.Yx * g1; vol.gy = pt.Yy * g1; vol.gz = pt.Yz * g1;
      return n;
    },
    step: () => stepLen,
  };
  return vol;
}

/** Schwarzschild optical metric in isotropic coordinates — identical to the 2D engine, radial in 3D. */
function gravityVolume(c: Vec3, rs: number, radius: number): Vol3 {
  const vol: Vol3 = {
    kind: 'gravity', gx: 0, gy: 0, gz: 0, parts: [], cx: c.x, cy: c.y, cz: c.z, radius,
    eval(x, y, z) {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const rho = Math.hypot(dx, dy, dz);
      const a = rs / (4 * Math.max(rho, 1e-9));
      if (a >= 0.97) return -1;
      const n = ((1 + a) * (1 + a) * (1 + a)) / (1 - a);
      const k = (-(a / rho) * (1 + a) * (1 + a) * (4 - 2 * a)) / ((1 - a) * (1 - a)) / rho;
      vol.gx = k * dx; vol.gy = k * dy; vol.gz = k * dz;
      return n;
    },
    step(x, y, z) {
      const rho = Math.hypot(x - c.x, y - c.y, z - c.z);
      return Math.max(0.02, Math.min(6, 0.12 * rho));
    },
  };
  return vol;
}

export function buildModel(c: OpticalComponent, settings: OpticsSettings, overrides?: Record<string, number>, time?: number): Model3 {
  const def = getTypeDef(c.type);
  const props: Record<string, ParamValue> = overrides ? { ...c.props, ...overrides } : (c.props ?? {});
  const P = new Props(props, getDefaults(c.type));
  const pos = { x: fin(c.position?.x, 0), y: fin(c.position?.y, 0) };
  const rot = fin(c.rotation, 0);
  const xf = makeXf(pos, rot);
  let built: Built;
  // wave optics is not implemented in 3D: components are always built in ray mode
  const bset: OpticsSettings = settings.waveMode ? { ...settings, waveMode: false } : settings;
  try { built = def ? def.build({ c, P, settings: bset, xf, time }) : {}; } catch { built = {}; }

  const pose = poseOf(c);
  const frame = frameOf(c);
  const main = newPart(c.id, l2Of(frame));
  const parts: Part[] = [main];
  const subs = new Map<Xf, Part>();
  const partFor = (x?: Xf): Part => {
    if (!x) return main;
    let p = subs.get(x);
    if (!p) {
      if (built.fiber) {
        // independently placed second end (world 2D position + its own height / pitch)
        const f = frameFrom({ x: x.px, y: x.py }, Math.atan2(x.sn, x.cs), fin(props.endZ, pose.z), fin(props.endPitch, 0), 0);
        p = newPart(`${c.id}#${parts.length}`, l2Of(f));
      } else {
        // rigid sub-frame of the component: express it relative to the component and carry the full 3D pose
        const dxw = x.px - xf.px, dyw = x.py - xf.py;
        const lx = xf.cs * dxw + xf.sn * dyw, ly = -xf.sn * dxw + xf.cs * dyw;
        const rc = x.cs * xf.cs + x.sn * xf.sn, rs = x.sn * xf.cs - x.cs * xf.sn;
        const m = main.f;
        const v = (a: number, b: number) => ({ x: m.X.x * a + m.Y.x * b, y: m.X.y * a + m.Y.y * b, z: m.X.z * a + m.Y.z * b });
        const d = v(lx, ly);
        p = newPart(`${c.id}#${parts.length}`, { o: { x: m.o.x + d.x, y: m.o.y + d.y, z: m.o.z + d.z }, X: v(rc, rs), Y: v(-rs, rc), Z: m.Z });
      }
      subs.set(x, p); parts.push(p);
    }
    return p;
  };

  const allPrims: Prim[] = [...(built.outline ?? []), ...(built.surfaces ?? []).map((s) => s.prim)];
  let mode: 'revolve' | 'extrude' = REVOLVE_TYPES.has(c.type) || REVOLVE_PREFIX.some((p) => c.type.startsWith(p)) ? 'revolve' : 'extrude';
  if (mode === 'revolve' && !allPrims.every(revolvable)) mode = 'extrude';
  const H = extrudeHeight(c.type, P, allPrims);
  const z0 = -H / 2, z1 = H / 2;

  const seen = new Set<string>();
  const push = (s: Surf3): boolean => {
    if (mode === 'revolve') {
      const key = [s.part.id, s.body ? bodies.indexOf(s.body) : -1, s.g, s.kind, s.role, s.x0, s.x1, s.r0, s.r1, s.cx, s.r, s.f, s.h, s.end].map((v) => (typeof v === 'number' ? v.toFixed(7) : v)).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
    }
    s.part.surfs.push(s);
    return true;
  };
  const lift = (p: Prim, sign: number, part: Part, za = z0, zb = z1): Surf3 => (mode === 'revolve' ? liftRevolve(p, sign, part) : liftExtrude(p, sign, part, za, zb));

  const bodies: Body3[] = [];
  let vol: Vol3 | null = null;
  let outline: number[] | null = null;
  const solids: { outline: Prim[]; body: NonNullable<Built['body']> }[] = [];
  if (built.outline && built.body) solids.push({ outline: built.outline, body: built.body });
  for (const ex of built.extra ?? []) solids.push(ex);
  for (const sd of solids) {
    const b = sd.body;
    const loop = loopOf(sd.outline);
    if (!outline) outline = loop;
    const orient = signedArea(loop) >= 0 ? 1 : -1;
    let bvol: Vol3 | null = null;
    if (b.grin) { bvol = grinVolume(main, b.grin, settings.temperatureC); vol = bvol; }
    const bl = b.bLocal ?? 0;
    const body: Body3 = {
      mat: b.material, coating: b.coating ?? 0, alphaExtra: b.alphaExtra ?? 0,
      Bx: bl * main.Xx, By: bl * main.Xy, Bz: bl * main.Xz, vol: bvol, shg: b.shg ?? null, part: main,
    };
    bodies.push(body);
    for (const p of sd.outline) {
      const s = lift(p, p.k === 'arc' ? orient * (p.a1 > p.a0 ? 1 : -1) : orient, main);
      s.kind = SK.REFRACT; s.body = body; s.role = 'body';
      push(s);
    }
    if (mode === 'extrude') {
      for (const top of [1, -1]) {
        const s = blank(main);
        s.g = G.CAP; s.kind = SK.REFRACT; s.body = body; s.role = 'body'; s.sign = top; s.z0 = s.z1 = top > 0 ? z1 : z0; s.poly = loop;
        push(s);
      }
    }
  }

  let fiber: Fiber3 | null = null;
  if (built.fiber) fiber = { ...built.fiber, faces: [] };
  if (built.gravity && built.gravity.rs > 1e-9) vol = gravityVolume(frame.o, built.gravity.rs, built.gravity.radius);

  let det: Det3 | null = null;
  if (built.detector) {
    const d = built.detector;
    const kind = String(d.kind);
    const bins = Math.max(1, Math.round(d.bins || 0));
    const img = kind === 'screen' || kind === 'camera';
    det = {
      id: c.id, kind, power: 0, range: d.range,
      profile: img ? new Array<number>(bins).fill(0) : null,
      spectrum: kind === 'spectrometer' ? new Array<number>(bins).fill(0) : null,
      hits: kind === 'screen' ? [] : null,
      hits3d: [], w: 0, h: 0, img: [], rgb: [], widthMm: 0, heightMm: 0,
      prgb: img ? new Array<number>(bins * 3).fill(0) : null,
      cam: d.cam ?? null,
      st: kind === 'polarimeter' ? new Float64Array(4) : null,
      wm: kind === 'wavemeter' ? new Float64Array(4) : null,
      cg: d.cg ?? 1, aux: 0,
    };
  }

  const slit = c.type === 'aperture.slit' || c.type === 'aperture.double_slit';
  const slitH = slit ? Math.min(H, Math.max(0.01, fin(props.slitHeight, 0.6 * H))) : H;
  for (const sp of built.surfaces ?? []) {
    if (sp.kind === SK.FIELD && !vol) continue;
    const part = partFor(sp.xf);
    const dz = slit && sp.kind === SK.DIFFRACT ? slitH / 2 : H / 2;
    const s = lift(sp.prim, sp.flip ? -1 : 1, part, -dz, dz);
    s.kind = sp.kind; s.spec = sp; s.role = sp.role as Role; s.hidden = !!sp.hidden; s.end = sp.end ?? 0;
    if (sp.kind === SK.TALLY) s.det = det;
    if (sp.kind === SK.DETECTOR) {
      s.det = det;
      if (det && det.w === 0 && (s.g === G.DISC || s.g === G.XSEG)) {
        det.widthMm = s.wid; det.heightMm = s.hgt;
        const base = det.profile ? Math.max(8, Math.min(128, det.profile.length)) : 32;
        const asp = s.hgt / Math.max(s.wid, 1e-9);
        det.w = asp > 1 ? Math.max(1, Math.round(base / asp)) : base;
        det.h = asp > 1 ? base : Math.max(1, Math.round(base * asp));
        det.img = new Array<number>(det.w * det.h).fill(0);
        det.rgb = new Array<number>(det.w * det.h * 3).fill(0);
      }
    }
    if (sp.kind === SK.FIELD) s.vol = vol;
    if (!push(s)) continue;
    if (sp.kind === SK.FIBER && fiber) { s.fiber = fiber; fiber.faces[s.end] = s; }
  }

  // 3D-only completions ---------------------------------------------------------
  if (slit && mode === 'extrude' && slitH < H - 1e-9) {
    // slits are rectangular openings: close the plate above and below every gap between the jaws
    const onPlane = (q: SurfSpec): boolean => q.kind === SK.THIN && !q.xf && q.prim.k === 'seg' && Math.abs(q.prim.ax) < 1e-9 && Math.abs(q.prim.bx) < 1e-9;
    const jaws = (built.surfaces ?? []).filter(onPlane);
    const iv = jaws.map((q) => (q.prim.k === 'seg' ? [Math.min(q.prim.ay, q.prim.by), Math.max(q.prim.ay, q.prim.by)] : [0, 0])).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i + 1 < iv.length; i++) {
      const ya = iv[i][1], yb = iv[i + 1][0];
      if (!(yb - ya > 1e-9)) continue;
      for (const [za, zb] of [[slitH / 2, H / 2], [-H / 2, -slitH / 2]]) {
        const s = liftExtrude({ k: 'seg', ax: 0, ay: ya, bx: 0, by: yb }, 1, main, za, zb);
        s.kind = SK.THIN; s.spec = jaws[0]; s.role = 'aperture';
        push(s);
      }
    }
  }
  if (c.type === 'absorber.block' && mode === 'extrude') {
    // beam dump: close the box so rays arriving from above / below are absorbed too
    const segs = (built.surfaces ?? []).filter((s) => s.kind === SK.THIN && s.prim.k === 'seg');
    if (segs.length >= 3) {
      const poly = loopOf(segs.map((s) => s.prim));
      for (const top of [1, -1]) {
        const s = blank(main);
        s.g = G.CAP; s.kind = SK.THIN; s.spec = segs[0]; s.role = 'absorber'; s.hidden = true; s.sign = top; s.z0 = s.z1 = top > 0 ? z1 : z0; s.poly = poly;
        push(s);
      }
    }
  }

  for (const p of parts) finishPart(p);
  if (vol && vol.kind === 'grin') { vol.cx = main.bx; vol.cy = main.by; vol.cz = main.bz; vol.radius = main.br; }

  const m: Model3 = { c, type: c.type, P, built, frame, parts, bodies, source: built.source ?? null, det, vol, fiber, mode, H, outline };
  if (built.material) m.material = built.material;
  return m;
}

// ---------------------------------------------------------------------------
// Ray / surface intersection in the part's L2 frame (direction must be unit length).
// ---------------------------------------------------------------------------

let Q0 = 0, Q1 = 0;
/** Real roots of A t² + B t + C = 0, sorted into Q0 <= Q1. */
function roots(A: number, B: number, C: number): boolean {
  if (A > -1e-14 && A < 1e-14) {
    if (B > -1e-14 && B < 1e-14) return false;
    Q0 = Q1 = -C / B;
    return true;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const q = -0.5 * (B + (B >= 0 ? sq : -sq));
  let t0 = q / A, t1 = q !== 0 ? C / q : t0;
  if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
  Q0 = t0; Q1 = t1;
  return true;
}

function inPoly(p: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const yi = p[i + 1], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) inside = !inside;
  }
  return inside;
}

/** Smallest t in (tmin, tmax) at which o + t d meets the surface, or −1. */
export function intersect3(s: Surf3, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, tmax: number): number {
  switch (s.g) {
    case G.DISC: {
      if (dx > -1e-14 && dx < 1e-14) return -1;
      const t = (s.x0 - ox) / dx;
      if (t <= tmin || t >= tmax) return -1;
      const y = oy + t * dy, z = oz + t * dz, q = y * y + z * z;
      return q <= s.r1 * s.r1 && q >= s.r0 * s.r0 ? t : -1;
    }
    case G.XSEG: {
      const den = dx * s.ey - dy * s.ex;
      if (den > -1e-14 && den < 1e-14) return -1;
      const wx = s.ax - ox, wy = s.ay - oy;
      const t = (wx * s.ey - wy * s.ex) / den;
      if (t <= tmin || t >= tmax) return -1;
      const u = (wx * dy - wy * dx) / den;
      if (u < 0 || u > 1) return -1;
      const z = oz + t * dz;
      return z >= s.z0 && z <= s.z1 ? t : -1;
    }
    case G.SPHERE: {
      const cx = ox - s.cx;
      if (!roots(1, 2 * (cx * dx + oy * dy + oz * dz), cx * cx + oy * oy + oz * oz - s.r * s.r)) return -1;
      const t0 = Q0, t1 = Q1;
      if (t0 > tmin && t0 < tmax) { const x = ox + t0 * dx; if (x >= s.x0 && x <= s.x1) return t0; }
      if (t1 > tmin && t1 < tmax) { const x = ox + t1 * dx; if (x >= s.x0 && x <= s.x1) return t1; }
      return -1;
    }
    case G.CONE: {
      const k = (s.r1 - s.r0) / (s.x1 - s.x0);
      const q0 = s.r0 + k * (ox - s.x0), kd = k * dx;
      if (!roots(dy * dy + dz * dz - kd * kd, 2 * (oy * dy + oz * dz - q0 * kd), oy * oy + oz * oz - q0 * q0)) return -1;
      const t0 = Q0, t1 = Q1;
      if (t0 > tmin && t0 < tmax) { const x = ox + t0 * dx; if (x >= s.x0 && x <= s.x1 && q0 + kd * t0 >= 0) return t0; }
      if (t1 > tmin && t1 < tmax) { const x = ox + t1 * dx; if (x >= s.x0 && x <= s.x1 && q0 + kd * t1 >= 0) return t1; }
      return -1;
    }
    case G.PARAB: {
      const f4 = 4 * s.f, h2 = s.r1 * s.r1, l2 = s.r0 * s.r0;
      if (!roots(dy * dy + dz * dz, 2 * (oy * dy + oz * dz) + f4 * dx, oy * oy + oz * oz + f4 * ox)) return -1;
      const t0 = Q0, t1 = Q1;
      if (t0 > tmin && t0 < tmax) { const y = oy + t0 * dy, z = oz + t0 * dz, q = y * y + z * z; if (q <= h2 && q >= l2) return t0; }
      if (t1 > tmin && t1 < tmax) { const y = oy + t1 * dy, z = oz + t1 * dz, q = y * y + z * z; if (q <= h2 && q >= l2) return t1; }
      return -1;
    }
    case G.XARC: {
      const cx = ox - s.cx, cy = oy - s.cy;
      const A = dx * dx + dy * dy;
      if (A < 1e-18) return -1;
      if (!roots(A, 2 * (cx * dx + cy * dy), cx * cx + cy * cy - s.r * s.r)) return -1;
      const t0 = Q0, t1 = Q1, lim = s.cosHalf * s.r;
      if (t0 > tmin && t0 < tmax) {
        const z = oz + t0 * dz;
        if (z >= s.z0 && z <= s.z1 && (cx + t0 * dx) * s.mx + (cy + t0 * dy) * s.my >= lim) return t0;
      }
      if (t1 > tmin && t1 < tmax) {
        const z = oz + t1 * dz;
        if (z >= s.z0 && z <= s.z1 && (cx + t1 * dx) * s.mx + (cy + t1 * dy) * s.my >= lim) return t1;
      }
      return -1;
    }
    case G.XPAR: {
      const f4 = 4 * s.f;
      if (!roots(dy * dy, 2 * oy * dy + f4 * dx, oy * oy + f4 * ox)) return -1;
      const t0 = Q0, t1 = Q1;
      if (t0 > tmin && t0 < tmax) { const y = oy + t0 * dy, z = oz + t0 * dz; if (y >= s.h0 && y <= s.h1 && z >= s.z0 && z <= s.z1) return t0; }
      if (t1 > tmin && t1 < tmax) { const y = oy + t1 * dy, z = oz + t1 * dz; if (y >= s.h0 && y <= s.h1 && z >= s.z0 && z <= s.z1) return t1; }
      return -1;
    }
    default: {
      if (dz > -1e-14 && dz < 1e-14) return -1;
      const t = (s.z0 - oz) / dz;
      if (t <= tmin || t >= tmax) return -1;
      return inPoly(s.poly!, ox + t * dx, oy + t * dy) ? t : -1;
    }
  }
}

/** Result of `normal3`: outward / front unit normal in the L2 frame (includes s.sign). */
export const NV = { x: 0, y: 0, z: 0 };

export function normal3(s: Surf3, x: number, y: number, z: number): void {
  const sg = s.sign;
  switch (s.g) {
    case G.DISC: NV.x = s.nx * sg; NV.y = 0; NV.z = 0; return;
    case G.XSEG: NV.x = s.nx * sg; NV.y = s.ny * sg; NV.z = 0; return;
    case G.SPHERE: { const k = sg / s.r; NV.x = (x - s.cx) * k; NV.y = y * k; NV.z = z * k; return; }
    case G.CONE: {
      const rho = Math.hypot(y, z);
      if (rho < 1e-12) { NV.x = s.nx >= 0 ? sg : -sg; NV.y = 0; NV.z = 0; return; }
      const k = (s.ny * sg) / rho;
      NV.x = s.nx * sg; NV.y = y * k; NV.z = z * k;
      return;
    }
    case G.PARAB: {
      const gy = y / (2 * s.f), gz = z / (2 * s.f), l = sg / Math.sqrt(1 + gy * gy + gz * gz);
      NV.x = l; NV.y = gy * l; NV.z = gz * l;
      return;
    }
    case G.XARC: { const k = sg / s.r; NV.x = (x - s.cx) * k; NV.y = (y - s.cy) * k; NV.z = 0; return; }
    case G.XPAR: { const gy = y / (2 * s.f), l = sg / Math.sqrt(1 + gy * gy); NV.x = l; NV.y = gy * l; NV.z = 0; return; }
    default: NV.x = 0; NV.y = 0; NV.z = sg;
  }
}
