/**
 * 3D polarization ray tracer — the vector form of src/core/optics/tracer.ts.
 *
 * Geometry: analytic intersections with discs, cones / cylinders, spheres, paraboloids, extruded
 * segments / arcs / parabolas and polygon caps (model.ts), in each part's local frame, behind a
 * bounding-sphere test per part.
 *
 * Polarization: every ray carries the 2x2 coherency matrix J (Jpp, Jss, Re Jps, Im Jps; trace 1) in
 * an explicit transverse basis: the unit vector p (stored), s = p × k, so that (s, p, k) is the same
 * right-handed triad as in the 2D engine. At every interface the matrix is rotated into the true
 * plane-of-incidence basis (s = k × n), the Fresnel / thin-film / metal amplitude coefficients are
 * applied, and the basis is carried onto the outgoing ray (p' = k' × s). Jones elements
 * (polarizers, wave plates) are evaluated in the element basis s_el = local z projected ⊥ k, so
 * rolling an element about its axis really turns its transmission / fast axis. For rays in the z = 0
 * plane of an untilted scene s is the table normal, which is exactly the 2D convention; the
 * reported polAngle is measured in that canonical basis (p = k × Z, towards s = Z).
 *
 * Time of flight: t advances by L · n_g / c with the group index n_g = n − λ dn/dλ of the medium.
 *
 * Wave optics (OpticsSettings.waveMode) is NOT implemented in 3D: the flag is ignored and the scene
 * is traced in ray mode (slits clip geometrically, detectors sum power incoherently).
 * OpticsDrive.time is honoured (chopper gate, modulated laser envelope), as in 2D.
 */
import type { OpticsDrive, OpticsScene, OpticsSettings } from '../types';
import type { DetectorReading3D, Ray3Segment, Trace3DResult, Vec3 } from '../types3d';
import { wavelengthToRGB } from '../optics/color';
import { SK } from '../optics/geometry';
import { getMaterial, type Material } from '../optics/materials';
import { defaultSettings } from '../optics/registry';
import { fresnelComplex, silicaAttenuationDbPerKm } from '../optics/tracer';
import { G, NV, buildModel, intersect3, normal3, type Body3, type Det3, type Model3, type Part, type Surf3, type Vol3 } from './model';
import { sampleSource } from './sources3d';

export interface Trace3DEnergy { emitted: number; detected: number; absorbed: number; escaped: number; dropped: number }

/** Detector reading with 3D extras (structurally a DetectorReading3D). */
export interface DetectorReading3DEx extends DetectorReading3D {
  /**
   * image: row-major w×h, row 0 = top (local +z), column 0 = the 2D local −y edge, i.e. the image
   * is seen from the side the light comes from (looking along local +x) with table-up = image-up.
   * widthMm / heightMm = physical size of the imaged face.
   */
  image?: { w: number; h: number; data: number[]; rgb?: number[]; widthMm?: number; heightMm?: number };
  /** Hit points in world 3D plus face coordinates (u along 2D local y, v = local z; mm from centre). */
  hits3d?: { p: Vec3; u: number; v: number; wavelength: number; power: number }[];
}

export interface DetailedTrace3DResult extends Trace3DResult {
  detectors: Record<string, DetectorReading3DEx>;
  energy: Trace3DEnergy;
}

interface StackNode { body: Body3; next: StackNode | null }
interface Src { id: string; power: number; fwhm: number }

interface Ray {
  x: number; y: number; z: number; dx: number; dy: number; dz: number;
  px: number; py: number; pz: number;
  wl: number; p: number; pmin: number; p0: number;
  a: number; b: number; c: number; d: number;
  stack: StackNode | null; vol: Vol3 | null;
  depth: number; src: Src; l1: Surf3 | null; l2: Surf3 | null;
  t: number;
}

const FAR = 1e4;
const MAX_STEPS = 6000;
const MAX_SEGMENTS = 400000;
const MAX_HITS = 20000;
const C_MM = 299792458e3; // mm / s

const RT = new Float64Array(2);
const NK = new Float64Array(2);
const MJ = new Float64Array(8);
const CF = new Float64Array(4);

const now = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
};

function applyDiag(r: Ray, pr: number, pi: number, sr: number, si: number): number {
  const a = (pr * pr + pi * pi) * r.a, b = (sr * sr + si * si) * r.b;
  const xr = pr * sr + pi * si, xi = pi * sr - pr * si;
  const c = xr * r.c - xi * r.d, d = xr * r.d + xi * r.c;
  const tr = a + b;
  if (tr <= 1e-300) { r.a = 0.5; r.b = 0.5; r.c = 0; r.d = 0; return 0; }
  r.a = a / tr; r.b = b / tr; r.c = c / tr; r.d = d / tr;
  return tr;
}

function applyJones(r: Ray, M: Float64Array): number {
  const a = r.a, b = r.b, c = r.c, d = r.d;
  const m00r = M[0], m00i = M[1], m01r = M[2], m01i = M[3], m10r = M[4], m10i = M[5], m11r = M[6], m11i = M[7];
  const A00r = m00r * a + m01r * c + m01i * d, A00i = m00i * a + m01i * c - m01r * d;
  const A01r = m00r * c - m00i * d + m01r * b, A01i = m00i * c + m00r * d + m01i * b;
  const A10r = m10r * a + m11r * c + m11i * d, A10i = m10i * a + m11i * c - m11r * d;
  const A11r = m10r * c - m10i * d + m11r * b, A11i = m10i * c + m10r * d + m11i * b;
  const na = A00r * m00r + A00i * m00i + A01r * m01r + A01i * m01i;
  const nb = A10r * m10r + A10i * m10i + A11r * m11r + A11i * m11i;
  const ncr = A00r * m10r + A00i * m10i + A01r * m11r + A01i * m11i;
  const nci = A00i * m10r - A00r * m10i + A01i * m11r - A01r * m11i;
  const tr = na + nb;
  if (tr <= 1e-300) { r.a = 0.5; r.b = 0.5; r.c = 0; r.d = 0; return 0; }
  r.a = na / tr; r.b = nb / tr; r.c = ncr / tr; r.d = nci / tr;
  return tr;
}

/** Rotate the polarization ellipse by `ang` (from p towards s). */
function rotatePol(r: Ray, ang: number): void {
  const c2 = Math.cos(2 * ang), s2 = Math.sin(2 * ang);
  const s1 = r.a - r.b, s2v = 2 * r.c;
  const n1 = s1 * c2 - s2v * s2, n2 = s1 * s2 + s2v * c2;
  r.a = 0.5 * (1 + n1); r.b = 0.5 * (1 - n1); r.c = 0.5 * n2;
}

/** Re-express the coherency matrix in the basis whose s vector is (sx, sy, sz) (unit, ⊥ k); p = k × s. */
function basisS(r: Ray, sx: number, sy: number, sz: number): void {
  const npx = r.dy * sz - r.dz * sy, npy = r.dz * sx - r.dx * sz, npz = r.dx * sy - r.dy * sx;
  const osx = r.py * r.dz - r.pz * r.dy, osy = r.pz * r.dx - r.px * r.dz, osz = r.px * r.dy - r.py * r.dx;
  let c = npx * r.px + npy * r.py + npz * r.pz, s = npx * osx + npy * osy + npz * osz;
  const l = Math.hypot(c, s);
  if (l > 1e-12) {
    c /= l; s /= l;
    // components in a basis turned by +phi = ellipse turned by −phi
    const c2 = c * c - s * s, s2 = -2 * c * s;
    const s1 = r.a - r.b, s2v = 2 * r.c;
    const n1 = s1 * c2 - s2v * s2, n2 = s1 * s2 + s2v * c2;
    r.a = 0.5 * (1 + n1); r.b = 0.5 * (1 - n1); r.c = 0.5 * n2;
  }
  r.px = npx; r.py = npy; r.pz = npz;
}

/** Give the ray a new direction, keeping the s vector (which must be ⊥ to both directions). */
function turnKeepS(r: Ray, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number): void {
  r.dx = dx; r.dy = dy; r.dz = dz;
  r.px = dy * sz - dz * sy; r.py = dz * sx - dx * sz; r.pz = dx * sy - dy * sx;
}

/** Give the ray a new direction with minimal rotation of the polarization basis. */
function turn(r: Ray, dx: number, dy: number, dz: number): void {
  r.dx = dx; r.dy = dy; r.dz = dz;
  const k = r.px * dx + r.py * dy + r.pz * dz;
  let px = r.px - k * dx, py = r.py - k * dy, pz = r.pz - k * dz;
  let l = Math.hypot(px, py, pz);
  if (l < 1e-9) {
    // p was (anti)parallel to the new direction: any perpendicular will do
    if (Math.abs(dz) < 0.9) { px = dy; py = -dx; pz = 0; } else { px = 0; py = dz; pz = -dy; }
    l = Math.hypot(px, py, pz);
  }
  r.px = px / l; r.py = py / l; r.pz = pz / l;
}

/** Initial basis: s = `ref` projected ⊥ k (fallback `alt`), p = k × s. */
function initBasis(r: Ray, ref: Vec3, alt: Vec3): void {
  let k = ref.x * r.dx + ref.y * r.dy + ref.z * r.dz;
  let sx = ref.x - k * r.dx, sy = ref.y - k * r.dy, sz = ref.z - k * r.dz;
  let l = Math.hypot(sx, sy, sz);
  if (l < 1e-6) {
    k = alt.x * r.dx + alt.y * r.dy + alt.z * r.dz;
    sx = alt.x - k * r.dx; sy = alt.y - k * r.dy; sz = alt.z - k * r.dz;
    l = Math.hypot(sx, sy, sz);
  }
  sx /= l; sy /= l; sz /= l;
  r.px = r.dy * sz - r.dz * sy; r.py = r.dz * sx - r.dx * sz; r.pz = r.dx * sy - r.dy * sx;
}

const hash01 = (a: number, b: number, c: number): number => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

// ---------------------------------------------------------------------------

export function trace3D(scene: OpticsScene, drive?: OpticsDrive): DetailedTrace3DResult {
  const tStart = now();
  const settings: OpticsSettings = { ...defaultSettings(), ...(scene.settings ?? {}) };
  const maxB = Math.max(1, Math.min(10000, Math.round(settings.maxBounces)));
  const minI = Math.max(1e-12, settings.minIntensity);
  const tC = settings.temperatureC;
  const ambient: Material = getMaterial(settings.ambientMedium || 'air');
  const mgf2 = getMaterial('mgf2');
  const filmD = 550 / (4 * mgf2.n(550, tC));

  const models: Model3[] = [];
  for (const c of scene.components ?? []) models.push(buildModel(c, settings, drive?.propOverrides?.[c.id], drive?.time));

  const parts: Part[] = [];
  const bodies: Body3[] = [];
  const vols: Vol3[] = [];
  const dets: Det3[] = [];
  for (const m of models) {
    for (const p of m.parts) if (p.surfs.length) parts.push(p);
    for (const b of m.bodies) bodies.push(b);
    if (m.vol) vols.push(m.vol);
    if (m.det) dets.push(m.det);
  }
  for (const v of vols) {
    for (const p of parts) {
      const d = Math.hypot(p.bx - v.cx, p.by - v.cy, p.bz - v.cz);
      if (d <= p.br + v.radius + 1e-6) v.parts.push(p);
    }
  }

  const segments: Ray3Segment[] = [];
  const E: Trace3DEnergy = { emitted: 0, detected: 0, absorbed: 0, escaped: 0, dropped: 0 };
  const work: Ray[] = [];
  let hS: Surf3 | null = null, hT = 0, hNx = 0, hNy = 0, hNz = 0;

  // ---- media ------------------------------------------------------------------
  const bodyN = (b: Body3, x: number, y: number, z: number, w: number): number => (b.vol ? b.vol.eval(x, y, z, w) : b.mat.n(w, tC));
  const mediumN = (st: StackNode | null, x: number, y: number, z: number, w: number): number => (st ? bodyN(st.body, x, y, z, w) : ambient.n(w, tC));
  const inStack = (st: StackNode | null, b: Body3): boolean => {
    for (let n = st; n; n = n.next) if (n.body === b) return true;
    return false;
  };
  const removeFrom = (st: StackNode | null, b: Body3): StackNode | null => {
    if (!st) return null;
    if (st.body === b) return st.next;
    return { body: st.body, next: removeFrom(st.next, b) };
  };

  // group index n_g = n − λ dn/dλ (central difference), cached per material and wavelength
  const ngCache = new Map<Material, Map<number, number>>();
  const groupIndex = (m: Material, w: number): number => {
    let mm = ngCache.get(m);
    if (!mm) { mm = new Map(); ngCache.set(m, mm); }
    let v = mm.get(w);
    if (v === undefined) {
      const n = m.n(w, tC), dn = (m.n(w + 0.5, tC) - m.n(w - 0.5, tC));
      v = n - w * dn;
      if (!(v > 0) || !Number.isFinite(v)) v = n;
      mm.set(w, v);
    }
    return v;
  };
  const mediumNg = (st: StackNode | null, w: number): number => groupIndex(st ? st.body.mat : ambient, w);

  const rgbCache = new Map<number, [number, number, number]>();
  const rgbOf = (w: number): [number, number, number] => {
    let v = rgbCache.get(w);
    if (!v) { v = wavelengthToRGB(w); rgbCache.set(w, v); }
    return v;
  };

  // ---- nearest hit --------------------------------------------------------------
  function nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, list: Part[], tmax: number, r: Ray): boolean {
    let best = tmax;
    let hp: Part | null = null, lnx = 0, lny = 0, lnz = 0;
    hS = null;
    for (let pi = 0; pi < list.length; pi++) {
      const pt = list[pi];
      const cx = pt.bx - ox, cy = pt.by - oy, cz = pt.bz - oz;
      const oc2 = cx * cx + cy * cy + cz * cz;
      if (oc2 > pt.br2) {
        const tca = cx * dx + cy * dy + cz * dz;
        if (tca < 0) continue;
        const d2 = oc2 - tca * tca;
        if (d2 > pt.br2) continue;
        if (tca - Math.sqrt(pt.br2 - d2) > best) continue;
      }
      const rx = ox - pt.ox, ry = oy - pt.oy, rz = oz - pt.oz;
      const lox = rx * pt.Xx + ry * pt.Xy + rz * pt.Xz, loy = rx * pt.Yx + ry * pt.Yy + rz * pt.Yz, loz = rx * pt.Zx + ry * pt.Zy + rz * pt.Zz;
      const ldx = dx * pt.Xx + dy * pt.Xy + dz * pt.Xz, ldy = dx * pt.Yx + dy * pt.Yy + dz * pt.Yz, ldz = dx * pt.Zx + dy * pt.Zy + dz * pt.Zz;
      const surfs = pt.surfs;
      for (let si = 0; si < surfs.length; si++) {
        const s = surfs[si];
        let tmin = s === r.l1 || s === r.l2 ? 1e-6 : -1e-7;
        for (let tries = 0; tries < 3; tries++) {
          const t = intersect3(s, lox, loy, loz, ldx, ldy, ldz, tmin, best);
          if (t <= tmin) break;
          normal3(s, lox + t * ldx, loy + t * ldy, loz + t * ldz);
          if (s.kind === SK.REFRACT) {
            const entering = ldx * NV.x + ldy * NV.y + ldz * NV.z < 0;
            if (entering === inStack(r.stack, s.body!)) { tmin = t + 1e-9; continue; }
          }
          best = t; hS = s; hT = t; hp = pt; lnx = NV.x; lny = NV.y; lnz = NV.z;
          break;
        }
      }
    }
    if (hp) {
      hNx = hp.Xx * lnx + hp.Yx * lny + hp.Zx * lnz;
      hNy = hp.Xy * lnx + hp.Yy * lny + hp.Zy * lnz;
      hNz = hp.Xz * lnx + hp.Yz * lny + hp.Zz * lnz;
    }
    return hS !== null;
  }

  // ---- output -------------------------------------------------------------------
  function emit(r: Ray, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t0: number, t1: number): void {
    if (segments.length >= MAX_SEGMENTS) return;
    const s1 = r.a - r.b, s2 = 2 * r.c;
    // angle of the stored p in the canonical basis (s_c = world Z projected ⊥ k, p_c = k × s_c)
    let kz = r.dz, sx = -kz * r.dx, sy = -kz * r.dy, sz = 1 - kz * r.dz;
    let l = Math.hypot(sx, sy, sz);
    if (l < 1e-6) { kz = r.dy; sx = -kz * r.dx; sy = 1 - kz * r.dy; sz = -kz * r.dz; l = Math.hypot(sx, sy, sz); }
    sx /= l; sy /= l; sz /= l;
    const pcx = r.dy * sz - r.dz * sy, pcy = r.dz * sx - r.dx * sz, pcz = r.dx * sy - r.dy * sx;
    const phi = Math.atan2(r.px * sx + r.py * sy + r.pz * sz, r.px * pcx + r.py * pcy + r.pz * pcz);
    let ang = 0.5 * Math.atan2(s2, s1) + phi;
    ang -= Math.PI * Math.round(ang / Math.PI);
    segments.push({
      a: { x: ax, y: ay, z: az }, b: { x: bx, y: by, z: bz }, wavelength: r.wl, power: r.p,
      sourceId: r.src.id, depth: r.depth, t0, t1,
      polAngle: ang, polDegree: Math.min(1, Math.sqrt(s1 * s1 + s2 * s2)), inMedium: r.stack !== null,
    });
  }

  /** Beer-Lambert absorption and Faraday rotation over a path of length L (mm) in the current medium. */
  function attenuate(r: Ray, L: number): void {
    const st = r.stack;
    if (st) {
      const b = st.body;
      const al = b.alphaExtra + (b.mat.hasAlpha ? b.mat.alpha(r.wl) : 0);
      if (al > 0) { const pe = r.p * Math.exp(-al * L); E.absorbed += r.p - pe; r.p = pe; }
      if (b.Bx !== 0 || b.By !== 0 || b.Bz !== 0) {
        const V = b.mat.verdet(r.wl);
        if (V !== 0) rotatePol(r, V * (b.Bx * r.dx + b.By * r.dy + b.Bz * r.dz) * L * 1e-3);
      }
    } else if (ambient.hasAlpha) {
      const pe = r.p * Math.exp(-ambient.alpha(r.wl) * L);
      E.absorbed += r.p - pe; r.p = pe;
    }
  }

  function child(r: Ray, dx: number, dy: number, dz: number, p: number): Ray | null {
    if (!(p >= r.pmin)) { if (p > 0) E.dropped += p; return null; }
    const k: Ray = {
      x: r.x, y: r.y, z: r.z, dx: r.dx, dy: r.dy, dz: r.dz, px: r.px, py: r.py, pz: r.pz,
      wl: r.wl, p, pmin: r.pmin, p0: r.p0, a: r.a, b: r.b, c: r.c, d: r.d,
      stack: r.stack, vol: r.vol, depth: r.depth + 1, src: r.src, l1: r.l1, l2: r.l2, t: r.t,
    };
    turn(k, dx, dy, dz);
    work.push(k);
    return k;
  }

  function keep(r: Ray, p: number): boolean {
    if (!(p >= r.pmin)) { if (p > 0) E.dropped += p; return false; }
    r.p = p; r.depth++;
    return true;
  }

  // scratch: plane-of-incidence s vector
  let Sx = 0, Sy = 0, Sz = 1;
  function planeS(r: Ray, nx: number, ny: number, nz: number): void {
    let sx = r.dy * nz - r.dz * ny, sy = r.dz * nx - r.dx * nz, sz = r.dx * ny - r.dy * nx;
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-9) {
      // normal incidence: keep the current basis
      sx = r.py * r.dz - r.pz * r.dy; sy = r.pz * r.dx - r.px * r.dz; sz = r.px * r.dy - r.py * r.dx;
      const m = Math.hypot(sx, sy, sz) || 1;
      Sx = sx / m; Sy = sy / m; Sz = sz / m;
    } else { Sx = sx / l; Sy = sy / l; Sz = sz / l; }
  }

  // scratch: in-plane tangent frame (T along the 2D element direction, V = the other in-plane axis)
  let Tx = 0, Ty = 0, Tz = 0, Vx = 0, Vy = 0, Vz = 0;
  function tangents(s: Surf3, nx: number, ny: number, nz: number): void {
    const pt = s.part;
    let tx = pt.Xx * s.tx + pt.Yx * s.ty, ty = pt.Xy * s.tx + pt.Yy * s.ty, tz = pt.Xz * s.tx + pt.Yz * s.ty;
    const k = tx * nx + ty * ny + tz * nz;
    tx -= k * nx; ty -= k * ny; tz -= k * nz;
    let l = Math.hypot(tx, ty, tz);
    if (l < 1e-9) { tx = pt.Zx; ty = pt.Zy; tz = pt.Zz; l = 1; }
    Tx = tx / l; Ty = ty / l; Tz = tz / l;
    // V = part z made orthogonal to n and T
    let vx = pt.Zx, vy = pt.Zy, vz = pt.Zz;
    const kn = vx * nx + vy * ny + vz * nz, kt = vx * Tx + vy * Ty + vz * Tz;
    vx -= kn * nx + kt * Tx; vy -= kn * ny + kt * Ty; vz -= kn * nz + kt * Tz;
    l = Math.hypot(vx, vy, vz);
    if (l < 1e-9) { vx = ny * Tz - nz * Ty; vy = nz * Tx - nx * Tz; vz = nx * Ty - ny * Tx; l = 1; }
    Vx = vx / l; Vy = vy / l; Vz = vz / l;
  }

  // ---- interactions ---------------------------------------------------------------
  function interact(r: Ray, s: Surf3, nx: number, ny: number, nz: number): boolean {
    const dx = r.dx, dy = r.dy, dz = r.dz, w = r.wl;
    const dn = dx * nx + dy * ny + dz * nz;
    const sp = s.spec;
    switch (s.kind) {
      case SK.REFRACT: {
        const body = s.body!;
        const entering = dn < 0;
        let ci = -dn;
        if (!entering) { nx = -nx; ny = -ny; nz = -nz; ci = dn; }
        const n1 = mediumN(r.stack, r.x, r.y, r.z, w);
        const newStack: StackNode | null = entering ? { body, next: r.stack } : removeFrom(r.stack, body);
        const n2 = mediumN(newStack, r.x, r.y, r.z, w);
        const newVol = body.vol ? (entering ? body.vol : null) : r.vol;
        if (Math.abs(n1 - n2) < 1e-12) { r.stack = newStack; r.vol = newVol; return true; }
        const eta = n1 / n2;
        const sin2 = eta * eta * (1 - ci * ci);
        const rdx = dx + 2 * ci * nx, rdy = dy + 2 * ci * ny, rdz = dz + 2 * ci * nz;
        planeS(r, nx, ny, nz);
        const sx = Sx, sy = Sy, sz = Sz;
        basisS(r, sx, sy, sz);
        if (sin2 >= 1) {
          const kap = Math.sqrt(sin2 - 1);
          const del = -2 * Math.atan2(n1 * kap, n2 * ci) + 2 * Math.atan2(n2 * kap, n1 * ci);
          const cr = Math.cos(del), sr = Math.sin(del);
          const c = r.c * cr - r.d * sr, d = r.c * sr + r.d * cr;
          r.c = c; r.d = d;
          turnKeepS(r, rdx, rdy, rdz, sx, sy, sz);
          r.depth++;
          return true;
        }
        const ct = Math.sqrt(1 - sin2);
        const g = eta * ci - ct;
        let tdx = eta * dx + g * nx, tdy = eta * dy + g * ny, tdz = eta * dz + g * nz;
        const tl = 1 / Math.hypot(tdx, tdy, tdz);
        tdx *= tl; tdy *= tl; tdz *= tl;
        const pIn = r.p;
        let pT = pIn;
        if (body.coating !== 2) {
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
          const a0 = r.a, b0 = r.b, c0 = r.c, d0 = r.d;
          const fR = applyDiag(r, rpr, rpi, rsr, rsi);
          if (fR > 0) { const k = child(r, rdx, rdy, rdz, pIn * fR); if (k) turnKeepS(k, rdx, rdy, rdz, sx, sy, sz); }
          r.a = a0; r.b = b0; r.c = c0; r.d = d0;
          pT = pIn * applyDiag(r, Math.sqrt(Math.max(0, 1 - Rp)), 0, Math.sqrt(Math.max(0, 1 - Rs)), 0);
        }
        turnKeepS(r, tdx, tdy, tdz, sx, sy, sz);
        r.stack = newStack; r.vol = newVol;
        if (entering && body.shg && body.shg.kappa > 0) {
          const sh = body.shg;
          const x = (2.783 * (w - sh.pm)) / sh.bw;
          const acc = Math.abs(x) < 1e-6 ? 1 : (Math.sin(x) / x) ** 2;
          const pBeam = r.src.power * (pT / r.p0);
          const th = Math.tanh(Math.sqrt(sh.kappa * Math.max(0, pBeam)));
          const eta2 = th * th * acc;
          if (eta2 > 0) {
            const k = child(r, tdx, tdy, tdz, pT * eta2);
            if (k) {
              k.wl = w / 2; k.depth = r.depth;
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

      case SK.METAL: {
        if (sp!.backAbsorb && dn > 0) { E.absorbed += r.p; return false; }
        sp!.metal!(w, NK);
        const n1 = mediumN(r.stack, r.x, r.y, r.z, w);
        fresnelComplex(n1, NK[0], NK[1], Math.abs(dn), CF);
        planeS(r, nx, ny, nz);
        basisS(r, Sx, Sy, Sz);
        const p = r.p;
        const f = applyDiag(r, CF[2], CF[3], CF[0], CF[1]) * (sp!.rScale ?? 1);
        E.absorbed += p * (1 - f);
        turnKeepS(r, dx - 2 * dn * nx, dy - 2 * dn * ny, dz - 2 * dn * nz, Sx, Sy, Sz);
        return keep(r, p * f);
      }

      case SK.DETECTOR: {
        const det = s.det;
        if (!det || ((sp!.p1 ?? 0) > 0 && dn > 0)) { E.absorbed += r.p; return false; }
        det.power += r.p; E.detected += r.p;
        const pt = s.part;
        const rx = r.x - pt.ox, ry = r.y - pt.oy, rz = r.z - pt.oz;
        const lx = rx * pt.Xx + ry * pt.Xy + rz * pt.Xz, ly = rx * pt.Yx + ry * pt.Yy + rz * pt.Yz, lz = rx * pt.Zx + ry * pt.Zy + rz * pt.Zz;
        const um = (lx - s.ucx) * s.tx + (ly - s.ucy) * s.ty;
        const u = um / s.wid + 0.5;
        if (det.profile) {
          const n = det.profile.length;
          const bi = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
          det.profile[bi] += r.p;
          if (det.prgb) { const c = rgbOf(w); det.prgb[3 * bi] += r.p * c[0]; det.prgb[3 * bi + 1] += r.p * c[1]; det.prgb[3 * bi + 2] += r.p * c[2]; }
        }
        if (det.st) {
          // Stokes parameters in the instrument basis (s = detector local z projected ⊥ k)
          const kz = pt.Zx * dx + pt.Zy * dy + pt.Zz * dz;
          let ex = pt.Zx - kz * dx, ey = pt.Zy - kz * dy, ez = pt.Zz - kz * dz;
          let el = Math.hypot(ex, ey, ez);
          if (el < 1e-6) { const ky = pt.Yx * dx + pt.Yy * dy + pt.Yz * dz; ex = pt.Yx - ky * dx; ey = pt.Yy - ky * dy; ez = pt.Yz - ky * dz; el = Math.hypot(ex, ey, ez); }
          basisS(r, ex / el, ey / el, ez / el);
          det.st[0] += r.p; det.st[1] += r.p * (r.a - r.b); det.st[2] += r.p * 2 * r.c; det.st[3] -= r.p * 2 * r.d;
        }
        if (det.wm) { det.wm[0] += r.p; det.wm[1] += r.p * w; det.wm[2] += r.p * w * w; det.wm[3] += r.p * r.src.fwhm * r.src.fwhm; }
        if (det.w > 0) {
          const col = Math.min(det.w - 1, Math.max(0, Math.floor(u * det.w)));
          const row = Math.min(det.h - 1, Math.max(0, Math.floor((0.5 - lz / s.hgt) * det.h)));
          const i = row * det.w + col;
          det.img[i] += r.p;
          const c = rgbOf(w);
          det.rgb[3 * i] += r.p * c[0]; det.rgb[3 * i + 1] += r.p * c[1]; det.rgb[3 * i + 2] += r.p * c[2];
        }
        if (det.hits3d.length < MAX_HITS) {
          det.hits3d.push({ p: { x: r.x, y: r.y, z: r.z }, u: um, v: lz, wavelength: w, power: r.p });
          if (det.hits) det.hits.push({ p: { x: r.x, y: -r.y }, wavelength: w, power: r.p });
        }
        if (det.spectrum) {
          const n = det.spectrum.length;
          const i = Math.floor(((w - det.range[0]) / (det.range[1] - det.range[0])) * n);
          if (i >= 0 && i < n) det.spectrum[i] += r.p;
        }
        return false;
      }

      case SK.PBS: {
        const tp = sp!.p1 ?? 1, rs = sp!.p2 ?? 1, p = r.p;
        planeS(r, nx, ny, nz);
        basisS(r, Sx, Sy, Sz);
        const a0 = r.a, b0 = r.b, c0 = r.c, d0 = r.d;
        const fR = applyDiag(r, Math.sqrt(1 - tp), 0, -Math.sqrt(rs), 0);
        if (fR > 0) {
          const rdx = dx - 2 * dn * nx, rdy = dy - 2 * dn * ny, rdz = dz - 2 * dn * nz;
          const k = child(r, rdx, rdy, rdz, p * fR);
          if (k) turnKeepS(k, rdx, rdy, rdz, Sx, Sy, Sz);
        }
        r.a = a0; r.b = b0; r.c = c0; r.d = d0;
        return keep(r, p * applyDiag(r, Math.sqrt(tp), 0, Math.sqrt(1 - rs), 0));
      }

      case SK.IDEAL: {
        // paraxial thin lens: slope' = slope − h / f in both transverse directions
        const adn = Math.abs(dn);
        if (adn < 1e-9) return true;
        tangents(s, nx, ny, nz);
        const pt = s.part;
        const cx = pt.ox + pt.Xx * s.ucx + pt.Yx * s.ucy, cy = pt.oy + pt.Xy * s.ucx + pt.Yy * s.ucy, cz = pt.oz + pt.Xz * s.ucx + pt.Yz * s.ucy;
        const hx = r.x - cx, hy = r.y - cy, hz = r.z - cz;
        let f = sp!.p1 ?? 1e9, T = 1;
        if (sp!.rt) { sp!.rt(w, RT); f = RT[0]; T = RT[1]; } // chromatic / lossy thin lens (Fresnel lens)
        const mu = (dx * Tx + dy * Ty + dz * Tz) / adn - (hx * Tx + hy * Ty + hz * Tz) / f;
        const mv = (dx * Vx + dy * Vy + dz * Vz) / adn - (hx * Vx + hy * Vy + hz * Vz) / f;
        const sg = dn > 0 ? 1 : -1;
        const ox = sg * nx + mu * Tx + mv * Vx, oy = sg * ny + mu * Ty + mv * Vy, oz = sg * nz + mu * Tz + mv * Vz;
        const l = 1 / Math.hypot(ox, oy, oz);
        turn(r, ox * l, oy * l, oz * l);
        if (T < 1) { E.absorbed += r.p * (1 - T); return keep(r, r.p * T); }
        r.depth++;
        return true;
      }

      case SK.AOM: {
        // Bragg diffraction by the acoustic grating (period p1 mm along the 2D element direction): orders ±1.
        // Vector form: k_t' = k_t ± q ĝ, the component along the acoustic wavefronts is conserved.
        tangents(s, nx, ny, nz);
        const nm = mediumN(r.stack, r.x, r.y, r.z, w);
        const lam = sp!.p1 ?? 1, q = (w * 1e-6) / (nm * lam);
        const sg = dn > 0 ? 1 : -1;
        const kx = dx - dn * nx, ky = dy - dn * ny, kz = dz - dn * nz;
        const kt = kx * Tx + ky * Ty + kz * Tz;
        const kv2 = Math.max(0, kx * kx + ky * ky + kz * kz - kt * kt);
        const p = r.p;
        let e1 = 0, e2 = 0;
        for (let m = -1; m <= 1; m += 2) {
          const st = kt + m * q;
          if (!(st * st + kv2 < 1)) continue;
          const del = (Math.PI * (sp!.p3 ?? 0) * (kt + (m * q) / 2) * nm) / ((sp!.p4 ?? 1) * lam);
          const e = (sp!.p2 ?? 0) * (Math.abs(del) < 1e-9 ? 1 : (Math.sin(del) / del) ** 2);
          if (m < 0) e1 = e; else e2 = e;
        }
        const sum = e1 + e2;
        if (sum > 1) { e1 /= sum; e2 /= sum; }
        for (let m = -1; m <= 1; m += 2) {
          const e = m < 0 ? e1 : e2;
          if (!(e > 0)) continue;
          const st = kt + m * q, mq = m * q;
          const cn = Math.sqrt(1 - st * st - kv2) * sg;
          child(r, kx + mq * Tx + cn * nx, ky + mq * Ty + cn * ny, kz + mq * Tz + cn * nz, p * e);
        }
        return keep(r, p * Math.max(0, 1 - e1 - e2));
      }

      case SK.DIFFUSE: {
        // ground glass: deterministic (seeded) scatter into a CONE about the incident direction. Polar
        // offsets and Gaussian weights are those of the 2D engine; in 3D each scattered ray also gets a
        // seeded azimuth about the incident ray (azimuth 0 = the 2D in-plane direction).
        tangents(s, nx, ny, nz);
        const sg = dn > 0 ? 1 : -1;
        const K = Math.max(1, Math.round(sp!.p2 ?? 1)), cone = sp!.p1 ?? 0, seed = sp!.p3 ?? 0;
        const pt = s.part;
        const rx = r.x - pt.ox, ry = r.y - pt.oy, rz = r.z - pt.oz;
        const lx = rx * pt.Xx + ry * pt.Xy + rz * pt.Xz, ly = rx * pt.Yx + ry * pt.Yy + rz * pt.Yz, lz = rx * pt.Zx + ry * pt.Zy + rz * pt.Zz;
        const u = (lx - s.ucx) * s.tx + (ly - s.ucy) * s.ty + s.wid / 2;
        const p = r.p * (sp!.p4 ?? 1);
        E.absorbed += r.p - p;
        // e1 = element direction made ⊥ to the ray, e2 = d × e1
        const kd = Tx * dx + Ty * dy + Tz * dz;
        let e1x = Tx - kd * dx, e1y = Ty - kd * dy, e1z = Tz - kd * dz;
        const e1l = Math.hypot(e1x, e1y, e1z) || 1;
        e1x /= e1l; e1y /= e1l; e1z /= e1l;
        const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
        const a0 = Math.atan2(dx * Tx + dy * Ty + dz * Tz, Math.abs(dn));
        let tot = 0;
        const dirs: number[] = [], wt: number[] = [];
        for (let j = 0; j < K; j++) {
          const jit = hash01(u * 37.1 + j * 1.7, seed * 0.731 + j, w * 0.011) - 0.5;
          const rel = K === 1 ? 2 * jit : ((j + 0.5 + 0.9 * jit) / K - 0.5) * 2;
          const del = Math.max(-1.55, Math.min(1.55, a0 + rel * 1.5 * cone)) - a0;
          const psi = Math.PI * hash01(lz * 53.7 + j * 2.3 + 0.41, seed * 1.37 + u * 11.9, w * 0.019 + j);
          const cd = Math.cos(del), sd = Math.sin(del), cp = Math.cos(psi), sps = Math.sin(psi);
          let ox = cd * dx + sd * (cp * e1x + sps * e2x), oy = cd * dy + sd * (cp * e1y + sps * e2y), oz = cd * dz + sd * (cp * e1z + sps * e2z);
          if ((ox * nx + oy * ny + oz * nz) * sg < 0.02) { ox = dx; oy = dy; oz = dz; } // never scatter backwards through the plate
          dirs.push(ox, oy, oz);
          const g = Math.exp(-2 * rel * rel * 2.25);
          wt.push(g); tot += g;
        }
        let alive = false;
        for (let j = 0; j < K; j++) {
          const pj = (p * wt[j]) / tot;
          if (j === K - 1) { turn(r, dirs[3 * j], dirs[3 * j + 1], dirs[3 * j + 2]); alive = keep(r, pj); }
          else child(r, dirs[3 * j], dirs[3 * j + 1], dirs[3 * j + 2], pj);
        }
        return alive;
      }

      case SK.TALLY: {
        if (s.det && dn < 0) s.det.aux += r.p;
        return true;
      }

      case SK.WAVEAP: {
        // cannot occur (components are built in ray mode); treat as an opaque screen if it ever does
        E.absorbed += r.p;
        return false;
      }

      case SK.GRATING: {
        // vector grating equation: k_t' = k_t + m (λ / n d) ĝ, ĝ = grating vector (along the 2D element
        // direction); the component along the grooves is conserved, giving conical diffraction
        tangents(s, nx, ny, nz);
        const nm = mediumN(r.stack, r.x, r.y, r.z, w);
        const q = w / (nm * (sp!.p1 ?? 1e9));
        const e0 = sp!.p2 ?? 0, e1 = sp!.p3 ?? 0, e2 = sp!.p4 ?? 0;
        const reflect = s.end === 1;
        const sg = (dn > 0 ? 1 : -1) * (reflect ? -1 : 1);
        const kx = dx - dn * nx, ky = dy - dn * ny, kz = dz - dn * nz;
        const kt = kx * Tx + ky * Ty + kz * Tz;
        const kv2 = Math.max(0, kx * kx + ky * ky + kz * kz - kt * kt);
        let tot = 0;
        for (let m = -2; m <= 2; m++) {
          const st = kt + m * q;
          if (st * st + kv2 < 1) tot += m === 0 ? e0 : m === 1 || m === -1 ? e1 : e2;
        }
        if (!(tot > 0)) { E.absorbed += r.p; return false; }
        const p = r.p;
        if (reflect) {
          // specular mirror step fixes the polarization basis, the orders are then reached by minimal rotation
          planeS(r, nx, ny, nz);
          basisS(r, Sx, Sy, Sz);
          r.c = -r.c; r.d = -r.d;
          turnKeepS(r, dx - 2 * dn * nx, dy - 2 * dn * ny, dz - 2 * dn * nz, Sx, Sy, Sz);
        }
        for (let m = -2; m <= 2; m++) {
          if (m === 0) continue;
          const st = kt + m * q;
          const t2 = st * st + kv2;
          if (!(t2 < 1)) continue;
          const e = (m === 1 || m === -1 ? e1 : e2) / tot;
          if (e <= 0) continue;
          const cn = Math.sqrt(1 - t2) * sg, mq = m * q;
          child(r, kx + mq * Tx + cn * nx, ky + mq * Ty + cn * ny, kz + mq * Tz + cn * nz, p * e);
        }
        if (!(e0 > 0) || !(kt * kt + kv2 < 1)) return false;
        const cn0 = Math.sqrt(1 - kt * kt - kv2) * sg;
        turn(r, kx + cn0 * nx, ky + cn0 * ny, kz + cn0 * nz);
        return keep(r, (p * e0) / tot);
      }

      case SK.JONES: {
        // element basis: s_el = element's local z projected ⊥ k, p_el = k × s_el
        const pt = s.part;
        let k = pt.Zx * dx + pt.Zy * dy + pt.Zz * dz;
        let sx = pt.Zx - k * dx, sy = pt.Zy - k * dy, sz = pt.Zz - k * dz;
        let l = Math.hypot(sx, sy, sz);
        if (l < 1e-6) {
          k = pt.Yx * dx + pt.Yy * dy + pt.Yz * dz;
          sx = pt.Yx - k * dx; sy = pt.Yy - k * dy; sz = pt.Yz - k * dz;
          l = Math.hypot(sx, sy, sz);
        }
        basisS(r, sx / l, sy / l, sz / l);
        sp!.jones!(w, dn > 0, MJ);
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
        const fb = s.fiber;
        const other = fb ? fb.faces[1 - s.end] : null;
        if (!fb || dn > 0 || !other) { E.absorbed += r.p; return false; }
        const ci = -dn;
        const n0 = mediumN(r.stack, r.x, r.y, r.z, w);
        const sinI = Math.sqrt(Math.max(0, 1 - ci * ci));
        if (n0 * sinI > fb.na) { E.absorbed += r.p; return false; }
        const p = r.p;
        const Rf = ((n0 - fb.nCore) / (n0 + fb.nCore)) ** 2;
        if (Rf > 0) {
          planeS(r, nx, ny, nz);
          const a0 = r.a, b0 = r.b, c0 = r.c, px0 = r.px, py0 = r.py, pz0 = r.pz;
          basisS(r, Sx, Sy, Sz);
          const rdx = dx - 2 * dn * nx, rdy = dy - 2 * dn * ny, rdz = dz - 2 * dn * nz;
          const k = child(r, rdx, rdy, rdz, p * Rf);
          if (k) { k.c = -k.c; k.d = -k.d; turnKeepS(k, rdx, rdy, rdz, Sx, Sy, Sz); }
          r.a = a0; r.b = b0; r.c = c0; r.px = px0; r.py = py0; r.pz = pz0;
        }
        const dB = (fb.model === 'silica' ? silicaAttenuationDbPerKm(w) : fb.attDb) * fb.lengthM * 1e-3;
        const nOut = ambient.n(w, tC);
        const Rout = ((nOut - fb.nCore) / (nOut + fb.nCore)) ** 2;
        const pOut = p * (1 - Rf) * Math.pow(10, -dB / 10) * (1 - Rout);
        E.absorbed += p * (1 - Rf) - pOut;
        // mode scrambling: deterministic pseudo-random exit position and azimuth; the polar angle is kept
        const pi = s.part;
        const rx = r.x - pi.ox, ry = r.y - pi.oy, rz = r.z - pi.oz;
        const ly = rx * pi.Yx + ry * pi.Yy + rz * pi.Yz, lz = rx * pi.Zx + ry * pi.Zy + rz * pi.Zz;
        const u = ly / Math.max(s.wid, 1e-9) + 0.5, v = lz / Math.max(s.wid, 1e-9) + 0.5;
        const h1 = hash01(u * 91.7 + 0.31, sinI * 57.3 + s.end, w * 0.01 + v * 13.7);
        const h2 = hash01(sinI * 113.1 + 0.77, u * 39.1 + s.end * 3, w * 0.013 + v * 7.3);
        const h3 = hash01(v * 71.3 + 0.19, u * 23.9 + sinI * 31.7, w * 0.017 + s.end);
        const po = other.part;
        const rho = 0.95 * other.r1 * Math.sqrt(h1), phi = 2 * Math.PI * h3;
        const ey = rho * Math.cos(phi), ez = rho * Math.sin(phi);
        r.x = po.ox + po.Xx * other.x0 + po.Yx * ey + po.Zx * ez;
        r.y = po.oy + po.Xy * other.x0 + po.Yy * ey + po.Zy * ez;
        r.z = po.oz + po.Xz * other.x0 + po.Yz * ey + po.Zz * ez;
        const so = Math.min(0.999, (n0 * sinI) / nOut), co = Math.sqrt(1 - so * so);
        const psi = 2 * Math.PI * h2, sgn = other.nx * other.sign;
        const ax = co * sgn, ay = so * Math.cos(psi), az = so * Math.sin(psi);
        r.dx = po.Xx * ax + po.Yx * ay + po.Zx * az;
        r.dy = po.Xy * ax + po.Yy * ay + po.Zy * az;
        r.dz = po.Xz * ax + po.Yz * ay + po.Zz * az;
        initBasis(r, po.f.Z, po.f.Y);
        r.stack = null; r.vol = null; r.l1 = other; r.l2 = null;
        r.t += (fb.lengthM * 1e3 * fb.nCore) / C_MM;
        if (!fb.pm) {
          const kd = Math.exp(-fb.lengthM / 2);
          r.a = 0.5 + (r.a - 0.5) * kd; r.b = 1 - r.a; r.c *= kd; r.d *= kd;
        }
        return keep(r, pOut);
      }

      case SK.DIFFRACT: {
        // Fraunhofer single-slit pattern, spread across the slit (2D element direction) only
        tangents(s, nx, ny, nz);
        const sg = dn > 0 ? 1 : -1;
        const nm = mediumN(r.stack, r.x, r.y, r.z, w);
        const q = w / (nm * (sp!.p1 ?? 1) * 1e6 * Math.PI);
        const kx = dx - dn * nx, ky = dy - dn * ny, kz = dz - dn * nz;
        const kt = kx * Tx + ky * Ty + kz * Tz;
        const kv2 = Math.max(0, kx * kx + ky * ky + kz * kz - kt * kt);
        const K = 6, STEP = 0.45 * Math.PI;
        let tot = 0;
        for (let j = -K; j <= K; j++) {
          const st = kt + j * STEP * q;
          if (st * st + kv2 < 1) { const be = j * STEP; tot += j === 0 ? 1 : (Math.sin(be) / be) ** 2; }
        }
        if (!(tot > 0)) return true;
        const p = r.p;
        for (let j = -K; j <= K; j++) {
          if (j === 0) continue;
          const dq = j * STEP * q, st = kt + dq, t2 = st * st + kv2;
          if (!(t2 < 1)) continue;
          const be = j * STEP;
          const cn = Math.sqrt(1 - t2) * sg;
          child(r, kx + dq * Tx + cn * nx, ky + dq * Ty + cn * ny, kz + dq * Tz + cn * nz, (p * (Math.sin(be) / be) ** 2) / tot);
        }
        return keep(r, p / tot);
      }

      default: {
        // SK.THIN and any future thin kind that supplies an R/T curve; unknown kinds are transparent
        if (!sp || !sp.rt) {
          if (sp && sp.jones) { sp.jones(w, dn > 0, MJ); const p = r.p, f = applyJones(r, MJ); if (f < 1) E.absorbed += p * (1 - f); return keep(r, p * Math.min(1, f)); }
          return true;
        }
        if (sp.backAbsorb && dn > 0) { E.absorbed += r.p; return false; }
        sp.rt(w, RT);
        const R = RT[0], T = RT[1], p = r.p;
        const lost = p * (1 - R - T);
        if (lost > 0) E.absorbed += lost;
        if (!(R > 0)) return T > 0 ? keep(r, p * T) : false;
        const rdx = dx - 2 * dn * nx, rdy = dy - 2 * dn * ny, rdz = dz - 2 * dn * nz;
        planeS(r, nx, ny, nz);
        if (T > 0) {
          const a0 = r.a, b0 = r.b, c0 = r.c, px0 = r.px, py0 = r.py, pz0 = r.pz;
          basisS(r, Sx, Sy, Sz);
          const k = child(r, rdx, rdy, rdz, p * R);
          if (k) { k.c = -k.c; k.d = -k.d; turnKeepS(k, rdx, rdy, rdz, Sx, Sy, Sz); }
          r.a = a0; r.b = b0; r.c = c0; r.px = px0; r.py = py0; r.pz = pz0;
          return keep(r, p * T);
        }
        basisS(r, Sx, Sy, Sz);
        r.c = -r.c; r.d = -r.d;
        turnKeepS(r, rdx, rdy, rdz, Sx, Sy, Sz);
        return keep(r, p * R);
      }
    }
  }

  // ---- curved propagation (GRIN / gravity): RK4 on d r/ds = T/n, dT/ds = grad n ------------
  function march(r: Ray): boolean {
    const vol = r.vol!;
    const w = r.wl;
    let n = vol.eval(r.x, r.y, r.z, w);
    if (n < 0) { E.absorbed += r.p; return false; }
    // time index: local phase index scaled by the base material's n_g / n (GRIN); plain n for gravity
    let ratio = 1;
    if (vol.kind === 'grin' && r.stack) { const m = r.stack.body.mat; ratio = groupIndex(m, w) / m.n(w, tC); }
    let sx = r.x, sy = r.y, sz = r.z, st = r.t, sdx = r.dx, sdy = r.dy, sdz = r.dz;
    for (let i = 0; i < MAX_STEPS; i++) {
      const h = vol.step(r.x, r.y, r.z);
      const x = r.x, y = r.y, z = r.z;
      const Ux = n * r.dx, Uy = n * r.dy, Uz = n * r.dz;
      const d1x = r.dx, d1y = r.dy, d1z = r.dz, g1x = vol.gx, g1y = vol.gy, g1z = vol.gz;
      let nn = vol.eval(x + 0.5 * h * d1x, y + 0.5 * h * d1y, z + 0.5 * h * d1z, w);
      if (nn < 0) break;
      const d2x = (Ux + 0.5 * h * g1x) / nn, d2y = (Uy + 0.5 * h * g1y) / nn, d2z = (Uz + 0.5 * h * g1z) / nn, g2x = vol.gx, g2y = vol.gy, g2z = vol.gz;
      nn = vol.eval(x + 0.5 * h * d2x, y + 0.5 * h * d2y, z + 0.5 * h * d2z, w);
      if (nn < 0) break;
      const d3x = (Ux + 0.5 * h * g2x) / nn, d3y = (Uy + 0.5 * h * g2y) / nn, d3z = (Uz + 0.5 * h * g2z) / nn, g3x = vol.gx, g3y = vol.gy, g3z = vol.gz;
      nn = vol.eval(x + h * d3x, y + h * d3y, z + h * d3z, w);
      if (nn < 0) break;
      const d4x = (Ux + h * g3x) / nn, d4y = (Uy + h * g3y) / nn, d4z = (Uz + h * g3z) / nn, g4x = vol.gx, g4y = vol.gy, g4z = vol.gz;
      const xn = x + (h / 6) * (d1x + 2 * d2x + 2 * d3x + d4x), yn = y + (h / 6) * (d1y + 2 * d2y + 2 * d3y + d4y), zn = z + (h / 6) * (d1z + 2 * d2z + 2 * d3z + d4z);
      const Unx = Ux + (h / 6) * (g1x + 2 * g2x + 2 * g3x + g4x), Uny = Uy + (h / 6) * (g1y + 2 * g2y + 2 * g3y + g4y), Unz = Uz + (h / 6) * (g1z + 2 * g2z + 2 * g3z + g4z);
      let cdx = xn - x, cdy = yn - y, cdz = zn - z;
      const len = Math.hypot(cdx, cdy, cdz);
      if (!(len > 0)) break;
      cdx /= len; cdy /= len; cdz /= len;
      const tIdx = n * ratio;
      if (nearest(x, y, z, cdx, cdy, cdz, vol.parts, len + 1e-9, r)) {
        const s = hS!, t = Math.max(0, hT), nx = hNx, ny = hNy, nz = hNz;
        const hx = x + t * cdx, hy = y + t * cdy, hz = z + t * cdz;
        const te = r.t + (t * tIdx) / C_MM;
        turn(r, cdx, cdy, cdz);
        emit(r, sx, sy, sz, hx, hy, hz, st, te);
        attenuate(r, t);
        r.x = hx; r.y = hy; r.z = hz; r.t = te;
        if (t < 1e-6) r.l2 = r.l1; else r.l2 = null;
        r.l1 = s;
        return interact(r, s, nx, ny, nz);
      }
      turn(r, cdx, cdy, cdz);
      attenuate(r, len);
      r.x = xn; r.y = yn; r.z = zn; r.t += (len * tIdx) / C_MM;
      r.l1 = null; r.l2 = null;
      n = vol.eval(xn, yn, zn, w);
      if (n < 0) break;
      const tl = 1 / Math.hypot(Unx, Uny, Unz);
      turn(r, Unx * tl, Uny * tl, Unz * tl);
      if (r.dx * sdx + r.dy * sdy + r.dz * sdz < 0.99996) {
        emit(r, sx, sy, sz, xn, yn, zn, st, r.t);
        sx = xn; sy = yn; sz = zn; st = r.t; sdx = r.dx; sdy = r.dy; sdz = r.dz;
      }
      if (r.p < r.pmin) { emit(r, sx, sy, sz, r.x, r.y, r.z, st, r.t); E.dropped += r.p; return false; }
    }
    emit(r, sx, sy, sz, r.x, r.y, r.z, st, r.t);
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
      const ng = mediumNg(r.stack, r.wl);
      if (!nearest(r.x, r.y, r.z, r.dx, r.dy, r.dz, parts, FAR, r)) {
        emit(r, r.x, r.y, r.z, r.x + r.dx * FAR, r.y + r.dy * FAR, r.z + r.dz * FAR, r.t, r.t + (FAR * ng) / C_MM);
        attenuate(r, FAR);
        E.escaped += r.p;
        return;
      }
      const s = hS!, t = Math.max(0, hT), nx = hNx, ny = hNy, nz = hNz;
      const hx = r.x + t * r.dx, hy = r.y + t * r.dy, hz = r.z + t * r.dz;
      const te = r.t + (t * ng) / C_MM;
      emit(r, r.x, r.y, r.z, hx, hy, hz, r.t, te);
      attenuate(r, t);
      r.x = hx; r.y = hy; r.z = hz; r.t = te;
      if (t < 1e-6) r.l2 = r.l1; else r.l2 = null;
      r.l1 = s;
      if (r.p < r.pmin) { E.dropped += r.p; return; }
      if (!interact(r, s, nx, ny, nz)) return;
    }
  }

  // ---- sources ----------------------------------------------------------------------

  /** Which bodies contain a point? Probe ray per body, look at the first crossing. */
  function initialStack(x: number, y: number, z: number): StackNode | null {
    let st: StackNode | null = null;
    const dx = 0.8017837257372732, dy = 0.5345224838248488, dz = 0.2672612419124244;
    for (const b of bodies) {
      const pt = b.part;
      if (Math.hypot(x - pt.bx, y - pt.by, z - pt.bz) > pt.br) continue;
      const rx = x - pt.ox, ry = y - pt.oy, rz = z - pt.oz;
      const lox = rx * pt.Xx + ry * pt.Xy + rz * pt.Xz, loy = rx * pt.Yx + ry * pt.Yy + rz * pt.Yz, loz = rx * pt.Zx + ry * pt.Zy + rz * pt.Zz;
      const ldx = dx * pt.Xx + dy * pt.Xy + dz * pt.Xz, ldy = dx * pt.Yx + dy * pt.Yy + dz * pt.Yz, ldz = dx * pt.Zx + dy * pt.Zy + dz * pt.Zz;
      let best = Infinity, inside = false;
      for (const s of pt.surfs) {
        if (s.kind !== SK.REFRACT || s.body !== b) continue;
        const t = intersect3(s, lox, loy, loz, ldx, ldy, ldz, 1e-9, best);
        if (t > 0) {
          best = t;
          normal3(s, lox + t * ldx, loy + t * ldy, loz + t * ldz);
          inside = ldx * NV.x + ldy * NV.y + ldz * NV.z > 0;
        }
      }
      if (inside) st = { body: b, next: st };
    }
    return st;
  }

  let rayCount = 0;
  for (const m of models) {
    const sp = m.source;
    if (!sp) continue;
    const scale = drive?.sourceScale?.[m.c.id];
    const power = sp.power * (scale === undefined ? 1 : Math.max(0, scale));
    if (!(power > 0)) continue;
    const src: Src = { id: m.c.id, power, fwhm: sp.wl.length === 1 ? (sp.lineFwhm ?? 0) : 0 };
    const pt = m.parts[0];
    const st0 = bodies.length ? initialStack(pt.ox, pt.oy, pt.oz) : null;
    let vol0: Vol3 | null = st0 && st0.body.vol ? st0.body.vol : null;
    if (!vol0) {
      for (const v of vols) if (v.kind === 'gravity' && Math.hypot(pt.ox - v.cx, pt.oy - v.cy, pt.oz - v.cz) < v.radius) vol0 = v;
    }
    const rays0 = sampleSource(m.type, m.P, sp, settings);
    for (const sr of rays0) {
      const ox = pt.ox + pt.Xx * sr.x + pt.Yx * sr.y + pt.Zx * sr.z;
      const oy = pt.oy + pt.Xy * sr.x + pt.Yy * sr.y + pt.Zy * sr.z;
      const oz = pt.oz + pt.Xz * sr.x + pt.Yz * sr.y + pt.Zz * sr.z;
      const dx = pt.Xx * sr.dx + pt.Yx * sr.dy + pt.Zx * sr.dz;
      const dy = pt.Xy * sr.dx + pt.Yy * sr.dy + pt.Zy * sr.dz;
      const dz = pt.Xz * sr.dx + pt.Yz * sr.dy + pt.Zz * sr.dz;
      for (let i = 0; i < sp.wl.length; i++) {
        const p = power * sr.w * sp.wlW[i];
        if (!(p > 0)) continue;
        E.emitted += p;
        rayCount++;
        const r: Ray = {
          x: ox, y: oy, z: oz, dx, dy, dz, px: 0, py: 0, pz: 0, wl: sp.wl[i], p, pmin: p * minI, p0: p,
          a: sp.pol[0], b: sp.pol[1], c: sp.pol[2], d: sp.pol[3],
          stack: st0, vol: vol0, depth: 0, src, l1: null, l2: null, t: 0,
        };
        initBasis(r, pt.f.Z, pt.f.Y);
        work.push(r);
      }
    }
  }

  work.reverse();
  while (work.length) {
    if (segments.length >= MAX_SEGMENTS) {
      for (const r of work) E.dropped += r.p;
      work.length = 0;
      break;
    }
    propagate(work.pop()!);
  }

  const detectors: Record<string, DetectorReading3DEx> = {};
  for (const d of dets) {
    const out: DetectorReading3DEx = { power: d.power };
    if (d.profile) out.profile = d.profile;
    if (d.prgb) out.profileRGB = d.prgb;
    if (d.cam && d.profile) {
      // camera: pixel signal 0..1 = power x exposure x gain / saturation energy (or auto-exposed to a 0.9 peak);
      // `image` stays in watts per pixel
      let mx = 0;
      for (const v of d.profile) if (v > mx) mx = v;
      const sc = d.cam.auto ? (mx > 0 ? 0.9 / mx : 0) : (d.cam.exposure * d.cam.gain) / d.cam.sat;
      for (let k = 0; k < d.profile.length; k++) d.profile[k] = Math.min(1, d.profile[k] * sc);
      if (d.prgb) for (let k = 0; k < d.prgb.length; k++) d.prgb[k] = Math.min(1, d.prgb[k] * sc);
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
    if (d.kind === 'concentrator') out.concentration = d.cg * (d.aux > 0 ? Math.min(1, d.power / d.aux) : 1);
    out.hits3d = d.hits3d;
    if (d.w > 0) out.image = { w: d.w, h: d.h, data: d.img, rgb: d.rgb, widthMm: d.widthMm, heightMm: d.heightMm };
    detectors[d.id] = out;
  }

  return { segments, detectors, stats: { rays: rayCount, segments: segments.length, ms: now() - tStart }, energy: E };
}

export { G };
