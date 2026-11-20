/**
 * Turns an OpticalComponent into (a) world-space surfaces for the tracer and (b) drawable paths.
 * Both come from the same primitive description, so the rendered outline is exactly what is traced.
 */
import type { ComponentGeometry, OpticalComponent, OpticsSettings, ParamValue, Vec2 } from '../types';
import { Props, type Built, type Role, type SourceSpec } from './components/common';
import {
  SK, makeXf, primToSurf, surfBounds, tessellate, toWorld,
  type Body, type CComp, type DetectorRT, type FiberRT, type Prim, type Surf, type Volume, type Xf,
} from './geometry';
import { getDefaults, getTypeDef } from './registry';

export interface Compiled {
  c: OpticalComponent;
  comp: CComp;
  xf: Xf;
  paths: ComponentGeometry['paths'];
  handles?: { key: string; p: Vec2 }[];
  material?: string;
  body: Body | null;
  /** All refracting bodies of the component (first = `body`). */
  bodies: Body[];
  source: SourceSpec | null;
  det: DetectorRT | null;
  vol: Volume | null;
}

function primsToPath(prims: Prim[], xf: Xf): Vec2[] {
  const flat: number[] = [];
  const tmp: number[] = [];
  for (const p of prims) {
    tmp.length = 0;
    tessellate(p, tmp);
    for (let i = 0; i < tmp.length; i += 2) {
      const n = flat.length;
      if (n >= 2 && Math.abs(flat[n - 2] - tmp[i]) < 1e-9 && Math.abs(flat[n - 1] - tmp[i + 1]) < 1e-9) continue;
      flat.push(tmp[i], tmp[i + 1]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(toWorld(xf, flat[i], flat[i + 1]));
  return out;
}

function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function grinVolume(xf: Xf, g: NonNullable<NonNullable<Built['body']>['grin']>, tC: number): Volume {
  const { n0, dn, halfHeight: h } = g;
  const linear = g.profile === 'linear';
  const curv = Math.abs(dn) > 1e-9 ? h * Math.sqrt(1.5 / (2 * Math.abs(dn))) : 1e9;
  const stepLen = Math.max(0.15, Math.min(2.5, curv / 14, h / 2));
  let lastWl = -1, lastN0 = 0;
  const vol: Volume = {
    kind: 'grin', gx: 0, gy: 0, comps: [], cx: 0, cy: 0, radius: 0,
    eval(x, y, w) {
      if (w !== lastWl) { lastWl = w; lastN0 = n0.n(w, tC); }
      const ly = -xf.sn * (x - xf.px) + xf.cs * (y - xf.py);
      const q = ly / h;
      let n: number, g1: number;
      if (linear) { n = lastN0 + dn * q; g1 = dn / h; } else { n = lastN0 - dn * q * q; g1 = (-2 * dn * q) / h; }
      if (n < 1) { n = 1; g1 = 0; }
      vol.gx = -xf.sn * g1; vol.gy = xf.cs * g1;
      return n;
    },
    step: () => stepLen,
  };
  return vol;
}

function gravityVolume(center: Vec2, rs: number, radius: number): Volume {
  const vol: Volume = {
    kind: 'gravity', gx: 0, gy: 0, comps: [], cx: center.x, cy: center.y, radius,
    eval(x, y) {
      const dx = x - center.x, dy = y - center.y;
      const rho = Math.hypot(dx, dy);
      const a = rs / (4 * Math.max(rho, 1e-9));
      if (a >= 0.97) return -1; // inside / at the horizon (rho = rs/4 in isotropic coordinates)
      const n = ((1 + a) * (1 + a) * (1 + a)) / (1 - a);
      const dndrho = (-(a / rho) * (1 + a) * (1 + a) * (4 - 2 * a)) / ((1 - a) * (1 - a));
      vol.gx = (dndrho * dx) / rho; vol.gy = (dndrho * dy) / rho;
      return n;
    },
    step(x, y) {
      const rho = Math.hypot(x - center.x, y - center.y);
      return Math.max(0.02, Math.min(6, 0.12 * rho));
    },
  };
  return vol;
}

const FALLBACK_BUILT: Built = { decor: [{ pts: [-5, -5, 5, -5, 5, 5, -5, 5], closed: true, role: 'decor' }] };

export function compile(c: OpticalComponent, settings: OpticsSettings, overrides?: Record<string, number>, time?: number): Compiled {
  const def = getTypeDef(c.type);
  const xf = makeXf(c.position ?? { x: 0, y: 0 }, Number.isFinite(c.rotation) ? c.rotation : 0);
  const props: Record<string, ParamValue> = overrides ? { ...c.props, ...overrides } : (c.props ?? {});
  let built: Built;
  try {
    built = def ? def.build({ c, P: new Props(props, getDefaults(c.type)), settings, xf, time }) : FALLBACK_BUILT;
  } catch {
    built = FALLBACK_BUILT;
  }
  const comp: CComp = { id: c.id, surfs: [], minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  const paths: ComponentGeometry['paths'] = [];
  let body: Body | null = null;
  const bodies: Body[] = [];
  let vol: Volume | null = null;
  let det: DetectorRT | null = null;

  const solids: { outline: Prim[]; body: NonNullable<Built['body']> }[] = [];
  if (built.outline && built.body) solids.push({ outline: built.outline, body: built.body });
  for (const e of built.extra ?? []) solids.push(e);
  for (const sd of solids) {
    const b = sd.body;
    const outline = sd.outline;
    const loop = primsToPath(outline, xf);
    if (loop.length > 1 && Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].y - loop[loop.length - 1].y) < 1e-9) loop.pop();
    paths.push({ points: loop, closed: true, role: 'body' });
    const orient = signedArea(loop) >= 0 ? 1 : -1;
    let bvol: Volume | null = null;
    if (b.grin) { bvol = grinVolume(xf, b.grin, settings.temperatureC); vol = bvol; }
    const bl = b.bLocal ?? 0;
    const bd: Body = {
      mat: b.material, coating: b.coating ?? 0, alphaExtra: b.alphaExtra ?? 0,
      bx: bl * xf.cs, by: bl * xf.sn, vol: bvol, shg: b.shg ?? null, comp,
    };
    bodies.push(bd);
    if (!body) body = bd;
    for (const p of outline) {
      const s = primToSurf(p, xf, comp);
      s.kind = SK.REFRACT; s.body = bd;
      s.sign = p.k === 'arc' ? orient * (p.a1 > p.a0 ? 1 : -1) : orient;
      comp.surfs.push(s);
    }
  }

  let fiber: FiberRT | null = null;
  if (built.fiber) fiber = { ...built.fiber, faces: [] };
  if (built.gravity && built.gravity.rs > 1e-9) vol = gravityVolume(c.position, built.gravity.rs, built.gravity.radius);
  if (built.detector) {
    const d = built.detector;
    const img = d.kind === 'screen' || d.kind === 'camera';
    det = {
      id: c.id, kind: d.kind, power: 0, range: d.range,
      profile: img ? new Array<number>(d.bins).fill(0) : null,
      spectrum: d.kind === 'spectrometer' ? new Array<number>(d.bins).fill(0) : null,
      hits: d.kind === 'screen' ? [] : null,
      rgb: img ? new Array<number>(d.bins * 3).fill(0) : null,
      cam: d.cam ?? null,
      st: d.kind === 'polarimeter' ? new Float64Array(4) : null,
      wm: d.kind === 'wavemeter' ? new Float64Array(4) : null,
      cg: d.cg, aux: 0, wh: null, face: null, incoh: !!d.incoh,
    };
  }

  for (const sp of built.surfaces ?? []) {
    const sxf = sp.xf ?? xf;
    if (!sp.hidden) paths.push({ points: primsToPath([sp.prim], sxf), closed: false, role: sp.role as Role });
    if (sp.kind === SK.FIELD && !vol) continue; // zero-strength field: nothing to trace
    const s: Surf = primToSurf(sp.prim, sxf, comp);
    s.kind = sp.kind;
    s.sign = sp.flip ? -1 : 1;
    s.rt = sp.rt ?? null; s.backAbsorb = !!sp.backAbsorb; s.metal = sp.metal ?? null; s.rScale = sp.rScale ?? 1;
    s.jones = sp.jones ?? null;
    s.p1 = sp.p1 ?? 0; s.p2 = sp.p2 ?? 0; s.p3 = sp.p3 ?? 0; s.p4 = sp.p4 ?? 0; s.end = sp.end ?? 0;
    if (sp.kind === SK.DETECTOR || sp.kind === SK.TALLY) s.det = det;
    if (sp.kind === SK.DETECTOR && det && !det.face) det.face = s;
    if (sp.kind === SK.WAVEAP) s.wap = { open: sp.open ?? [], hits: [], pending: 0 };
    if (sp.kind === SK.FIELD) s.vol = vol;
    if (sp.kind === SK.FIBER && fiber) { s.fiber = fiber; fiber.faces[s.end] = s; }
    comp.surfs.push(s);
  }

  for (const d of built.decor ?? []) {
    const dxf = d.xf ?? xf;
    let pts: Vec2[];
    if (d.prims) pts = primsToPath(d.prims, dxf);
    else {
      pts = [];
      const a = d.pts ?? [];
      for (let i = 0; i < a.length; i += 2) pts.push(toWorld(dxf, a[i], a[i + 1]));
    }
    if (d.closed && pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9) pts.pop();
    paths.push({ points: pts, closed: d.closed, role: d.role });
  }

  for (const s of comp.surfs) {
    const b = surfBounds(s);
    if (b[0] < comp.minx) comp.minx = b[0];
    if (b[1] < comp.miny) comp.miny = b[1];
    if (b[2] > comp.maxx) comp.maxx = b[2];
    if (b[3] > comp.maxy) comp.maxy = b[3];
  }
  comp.minx -= 1e-6; comp.miny -= 1e-6; comp.maxx += 1e-6; comp.maxy += 1e-6;

  return { c, comp, xf, paths, handles: built.handles, material: built.material, body, bodies, source: built.source ?? null, det, vol };
}

export function geometryOf(c: OpticalComponent, settings: OpticsSettings): ComponentGeometry {
  const k = compile(c, settings);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of k.paths) {
    for (const q of p.points) {
      if (q.x < minx) minx = q.x;
      if (q.y < miny) miny = q.y;
      if (q.x > maxx) maxx = q.x;
      if (q.y > maxy) maxy = q.y;
    }
  }
  if (!Number.isFinite(minx)) {
    minx = c.position.x - 5; maxx = c.position.x + 5; miny = c.position.y - 5; maxy = c.position.y + 5;
  }
  const g: ComponentGeometry = { paths: k.paths, bounds: { min: { x: minx, y: miny }, max: { x: maxx, y: maxy } } };
  if (k.material) g.material = k.material;
  if (k.handles) g.handles = k.handles;
  return g;
}
