/**
 * getGeometry3D: render / picking meshes for every optical component, in WORLD mm.
 *
 * The optically active meshes are generated from the very surfaces the 3D tracer intersects
 * (model.ts), so what is drawn is what is traced. On top of that each component family gets
 * non-optical "dressing" (holder rings, housings, substrates, magnets) and a mount down to the
 * table (base clamp + post holder + post, role 'mount').
 *
 * ROLES / MATERIALS (Mesh3D.role, Mesh3D.material):
 *   body      refracting glass; material = optics material id ('bk7', 'tgg', 'custom', …)
 *   surface   thin transmissive element; material ∈ 'splitter' | 'pbs-coating' | 'grating' | 'polarizer' |
 *             'waveplate' | 'filter' | 'ideal-lens' | 'fiber-core' | 'modulator' | <type prefix>
 *   mirror    reflecting face; material = coating ('silver' | 'aluminium' | 'gold' | 'ideal' | 'dichroic' | 'grating')
 *   absorber  black surfaces; material 'absorber' (beam dump, ferrule faces) or 'horizon' (gravity)
 *   detector  sensitive face; material 'screen' (white diffuse) or 'sensor'
 *   emitter   emitting aperture / LED dome / laser gain rod; material 'emitter' | 'led' | 'gain'
 *   aperture  opaque blades / jaws / chopper wheel; material 'anodized' (or 'modulator' for the attenuating shutter)
 *   decor     non-optical device parts; material 'anodized' (housings) | 'substrate' (mirror glass) |
 *             'magnet' | 'marker' (axis index marks) | 'steel' (ferrules) | 'rubber' (fibre jacket) |
 *             'field' (faint sphere of influence of field.gravity)
 *   mount     holder rings / platforms ('anodized'), posts and screws ('steel')
 * Thin sheets are emitted double-faced (two coincident faces with opposite normals / winding).
 */
import type { OpticalComponent } from '../types';
import { DEFAULT_TABLE_DEPTH, type ComponentGeometry3D, type Vec3 } from '../types3d';
import { SK } from '../optics/geometry';
import { defaultSettings } from '../optics/registry';
import { framePoint, poseOf, yawOf, type Frame } from './math';
import { MeshBuilder, type MeshRole } from './mesh';
import { G, buildModel, type Model3, type Part, type Surf3 } from './model';

const SETTINGS = defaultSettings();
const WORLD: Frame = { o: { x: 0, y: 0, z: 0 }, X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Mesh one traced surface in the current (part L2) frame. */
function surfMesh(mb: MeshBuilder, s: Surf3, both: boolean): void {
  const sg = s.sign;
  switch (s.g) {
    case G.DISC: mb.lathe([s.x0, s.r0, s.nx * sg, 0, s.x0, s.r1, s.nx * sg, 0], 48, both); break;
    case G.CONE: mb.lathe([s.x0, s.r0, s.nx * sg, s.ny * sg, s.x1, s.r1, s.nx * sg, s.ny * sg], 48, both); break;
    case G.SPHERE: {
      const t0 = Math.acos(clamp((s.x1 - s.cx) / s.r, -1, 1)), t1 = Math.acos(clamp((s.x0 - s.cx) / s.r, -1, 1));
      const n = clamp(Math.ceil((t1 - t0) / 0.06), 6, 40);
      const prof: number[] = [];
      for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n, c = Math.cos(t), sn = Math.sin(t); prof.push(s.cx + s.r * c, s.r * sn, c * sg, sn * sg); }
      mb.lathe(prof, 48, both);
      break;
    }
    case G.PARAB: {
      const prof: number[] = [];
      for (let i = 0; i <= 20; i++) { const r = s.r0 + ((s.r1 - s.r0) * i) / 20, g = r / (2 * s.f), l = sg / Math.sqrt(1 + g * g); prof.push(-(r * r) / (4 * s.f), r, l, g * l); }
      mb.lathe(prof, 48, both);
      break;
    }
    case G.XSEG: {
      const bx = s.ax + s.ex, by = s.ay + s.ey;
      mb.face([s.ax, s.ay, s.z0, bx, by, s.z0, bx, by, s.z1, s.ax, s.ay, s.z1], [s.nx * sg, s.ny * sg, 0], both);
      break;
    }
    case G.XARC: {
      const sweep = s.a1 - s.a0, n = clamp(Math.ceil(Math.abs(sweep) / 0.08), 6, 96);
      for (let side = 0; side < (both ? 2 : 1); side++) {
        const k = side === 0 ? sg : -sg;
        let prev = -1;
        for (let i = 0; i <= n; i++) {
          const a = s.a0 + (sweep * i) / n, c = Math.cos(a), sn = Math.sin(a);
          const v = mb.vert(s.cx + s.r * c, s.cy + s.r * sn, s.z0, c * k, sn * k, 0);
          mb.vert(s.cx + s.r * c, s.cy + s.r * sn, s.z1, c * k, sn * k, 0);
          if (prev >= 0) mb.quad(prev, v, v + 1, prev + 1);
          prev = v;
        }
      }
      break;
    }
    case G.XPAR: {
      for (let side = 0; side < (both ? 2 : 1); side++) {
        const k = side === 0 ? sg : -sg;
        let prev = -1;
        for (let i = 0; i <= 32; i++) {
          const y = s.h0 + ((s.h1 - s.h0) * i) / 32, g = y / (2 * s.f), l = k / Math.sqrt(1 + g * g);
          const v = mb.vert(-(y * y) / (4 * s.f), y, s.z0, l, g * l, 0);
          mb.vert(-(y * y) / (4 * s.f), y, s.z1, l, g * l, 0);
          if (prev >= 0) mb.quad(prev, v, v + 1, prev + 1);
          prev = v;
        }
      }
      break;
    }
    default:
      mb.polygon(s.poly!, s.z0, sg);
      if (both) mb.polygon(s.poly!, s.z0, -sg);
  }
}

function sheetMaterial(type: string, s: Surf3, m: Model3): string {
  switch (s.role) {
    case 'mirror': return type === 'mirror.dichroic' ? 'dichroic' : type.startsWith('grating.') ? 'grating' : String(m.P.raw('coating') ?? 'silver');
    case 'absorber': return 'absorber';
    case 'detector': return m.det?.kind === 'screen' ? 'screen' : 'sensor';
    case 'aperture': return type === 'aperture.shutter' && s.spec?.rt && m.P.str('mode') !== 'blade' ? 'modulator' : 'anodized';
    case 'decor': return 'anodized';
    default:
      if (s.kind === SK.FIBER) return 'fiber-core';
      if (s.kind === SK.PBS) return 'pbs-coating';
      if (s.kind === SK.IDEAL) return 'ideal-lens';
      return type.split('.')[0];
  }
}

/** Ring (hollow cylinder) holder around the optical axis. */
const ring = (mb: MeshBuilder, x0: number, x1: number, rIn: number, rOut: number) => { mb.use('mount', 'anodized').cyl(x0, x1, rOut, rIn, 48); };

/**
 * Mount from the table up to `top` (world): base clamp 25 x 58 x ≤10 mm, Ø25.4 post holder with a
 * thumbscrew, Ø12.7 post. Vertical in the world regardless of the component's pitch / roll.
 */
function mount(mb: MeshBuilder, top: Vec3, yaw: number, zTable: number, slim = false): void {
  const D = top.z - zTable;
  if (!(D > 0.5)) return;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  mb.setFrame({ o: { x: top.x, y: top.y, z: zTable }, X: { x: c, y: s, z: 0 }, Y: { x: -s, y: c, z: 0 }, Z: { x: 0, y: 0, z: 1 } });
  const baseT = Math.min(10, D * 0.35);
  mb.use('mount', 'anodized').box(-12.5, -29, 0, 12.5, 29, baseT);
  const rest = D - baseT;
  let from = baseT;
  if (!slim && rest > 18) {
    const hh = rest * 0.6;
    mb.use('mount', 'anodized').rod([0, 0, baseT], [0, 0, baseT + hh], 12.7, 0, 28);
    if (hh > 16) mb.use('mount', 'steel').rod([0, 12, baseT + hh - 7], [0, 22, baseT + hh - 7], 3, 0, 12);
    from = baseT + hh - 0.5;
  }
  mb.use('mount', 'steel').rod([0, 0, from], [0, 0, D], slim ? 3 : 6.35, 0, 24);
}

function build(c: OpticalComponent, tableDepth: number): ComponentGeometry3D {
  const m = buildModel(c, SETTINGS);
  const mb = new MeshBuilder();
  const type = m.type, P = m.P;
  const main = m.parts[0], e = main.ext;
  const yaw = yawOf(c), zTable = -tableDepth;
  const handles: { key: string; p: Vec3 }[] = [];
  const posts: { part: Part; x: number; y?: number; bottom: number; slim?: boolean }[] = [];
  const mirrorLike = main.surfs.some((s) => s.role === 'mirror' && s.kind !== SK.GRATING) && !m.bodies.length;

  // ---- optically active surfaces (exactly what the tracer intersects) ----------------
  for (const pt of m.parts) {
    mb.setFrame(pt.f);
    for (const s of pt.surfs) {
      if (s.hidden) continue;
      if (type === 'chopper.wheel' && s.role === 'aperture') continue; // drawn as a slotted wheel below
      if (s.body) { mb.use('body', s.body === m.bodies[0] ? (m.material ?? s.body.mat.id ?? 'glass') : (s.body.mat.id ?? m.material ?? 'glass')); surfMesh(mb, s, false); continue; }
      if (s.kind === SK.FIELD) { mb.use('decor', 'field'); surfMesh(mb, s, false); continue; }
      const single = (s.role === 'mirror' && !!s.spec?.backAbsorb) || (s.role === 'detector' && (s.spec?.p1 ?? 0) > 0);
      mb.use(s.role as MeshRole, sheetMaterial(type, s, m));
      surfMesh(mb, s, !single);
    }
  }

  // ---- dressing -----------------------------------------------------------------------
  mb.setFrame(main.f);
  const fam = type.split('.')[0];
  if (fam === 'source' || (m.source && !main.surfs.length)) {
    const emitter = (r: number) => { mb.use('emitter', 'emitter').lathe([0.02, 0, 1, 0, 0.02, r, 1, 0], 32); };
    if (type === 'source.laser') {
      mb.use('decor', 'anodized').cyl(-45, 0, 8, 0, 40);
      emitter(clamp(P.pos('beamDiameter') * 0.8, 0.6, 6));
      posts.push({ part: main, x: -22, bottom: 8 });
    } else if (type === 'source.laser_cavity') {
      // open resonator on a rail: high reflector, pumped gain rod, output coupler (non-traced device parts)
      const L = P.pos('cavityLength', 1);
      mb.use('decor', 'anodized').box(-L - 3, -12, -13, 2, 12, -10.5);
      mb.box(-0.68 * L, -6, -10.5, -0.32 * L, 6, -6.5); // pump module under the rod
      mb.use('decor', 'substrate').cyl(-L - 3, -L - 0.05, 9, 0, 32);
      mb.use('mirror', 'silver').lathe([-L, 0, 1, 0, -L, 9, 1, 0], 32);
      mb.use('emitter', 'gain').cyl(-0.72 * L, -0.28 * L, 5, 0, 32);
      mb.use('mirror', 'dichroic').cyl(-1.5, -0.5, 9, 0, 32);
      mb.use('mount', 'anodized').cyl(-L - 3.5, -L + 0.5, 11, 9, 32);
      mb.cyl(-2, 0, 11, 9, 32);
      emitter(clamp(P.pos('beamDiameter') * 0.8, 0.6, 6));
      posts.push({ part: main, x: -L / 2, bottom: 13 });
    } else if (type === 'source.led') {
      mb.use('decor', 'anodized').cyl(-6, -5, 3.6, 0, 32);
      const prof: number[] = [-5, 3, 0, 1, -3, 3, 0, 1];
      for (let i = 0; i <= 10; i++) { const t = (Math.PI / 2) * (1 - i / 10); prof.push(-3 + 3 * Math.cos(t), 3 * Math.sin(t), Math.cos(t), Math.sin(t)); }
      mb.use('emitter', 'led').lathe(prof, 32);
      posts.push({ part: main, x: -4, bottom: 3.6 });
    } else if (type === 'source.point') {
      mb.use('emitter', 'emitter').sphere(0, 0, 0, 2, 24, 12);
      posts.push({ part: main, x: 0, bottom: 2, slim: true });
    } else if (type === 'source.beam') {
      const W = P.pos('beamWidth'), h = W / 2 + 2;
      mb.use('decor', 'anodized').box(-12, -h, -h, 0, h, h);
      emitter(W / 2);
      posts.push({ part: main, x: -6, bottom: h });
    } else {
      const len = type === 'source.white' ? 40 : 30, r = type === 'source.white' ? 11 : 8;
      mb.use('decor', 'anodized').cyl(-len, 0, r, 0, 40);
      const bw = P.raw('beamWidth');
      emitter(clamp(typeof bw === 'number' ? bw / 2 : 3, 1, r - 1));
      posts.push({ part: main, x: -len / 2, bottom: r });
    }
  } else if (type === 'fiber.cable' || m.fiber) {
    const ends: Vec3[] = [], dirs: Vec3[] = [];
    for (const face of m.fiber?.faces ?? []) {
      if (!face) continue;
      const pt = face.part, d = -(face.nx * face.sign); // connector extends away from the emitting side
      const fr = pt.ext.rmax, cr = face.r1;
      mb.setFrame(pt.f);
      mb.use('decor', 'steel').cyl(0, 10 * d, fr, cr, 24);
      mb.use('decor', 'anodized').cyl(10 * d, 22 * d, fr + 1.5, 0, 24);
      ends.push(framePoint(pt.f, 22 * d, 0, 0)); dirs.push({ x: pt.f.X.x * d, y: pt.f.X.y * d, z: pt.f.X.z * d });
      posts.push({ part: pt, x: 16 * d, bottom: fr + 1.5 });
    }
    if (ends.length === 2) {
      // jacket: cubic Bezier leaving each connector along its axis
      const [a0, b0] = ends, k = Math.max(15, Math.hypot(b0.x - a0.x, b0.y - a0.y, b0.z - a0.z) / 3);
      const a1 = { x: a0.x + dirs[0].x * k, y: a0.y + dirs[0].y * k, z: a0.z + dirs[0].z * k };
      const b1 = { x: b0.x + dirs[1].x * k, y: b0.y + dirs[1].y * k, z: b0.z + dirs[1].z * k };
      const path: Vec3[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        path.push({ x: w0 * a0.x + w1 * a1.x + w2 * b1.x + w3 * b0.x, y: w0 * a0.y + w1 * a1.y + w2 * b1.y + w3 * b0.y, z: w0 * a0.z + w1 * a1.z + w2 * b1.z + w3 * b0.z });
      }
      mb.setFrame(WORLD);
      mb.use('decor', 'rubber').tube(path, 1.5, 10);
    }
    if (m.parts[1]) handles.push({ key: 'end', p: { ...m.parts[1].f.o } });
  } else if (type === 'field.gravity' || m.built.gravity) {
    const rs = Math.max(m.built.gravity?.rs ?? 0, 0.8);
    mb.use('absorber', 'horizon').sphere(0, 0, 0, rs, 32, 16);
    if (!m.vol) mb.use('decor', 'field').sphere(0, 0, 0, P.pos('radius', 1), 48, 24);
    posts.push({ part: main, x: 0, bottom: rs, slim: true });
  } else if (m.mode === 'revolve') {
    const rmax = Math.max(e.rmax, 0.5);
    if (m.bodies.length) {
      if (type === 'lens.ball') {
        ring(mb, -1.5, 1.5, rmax, rmax + 3);
        posts.push({ part: main, x: 0, bottom: rmax + 3 });
      } else if (fam === 'magneto') {
        const L = (e.x1 - e.x0) / 2, cx = (e.x0 + e.x1) / 2;
        const iso = type === 'magneto.isolator' || rmax > (m.outline ? Math.max(...m.outline.filter((_, i) => i % 2 === 1).map(Math.abs)) : rmax) + 1e-6;
        const rb = m.outline ? Math.max(...m.outline.filter((_, i) => i % 2 === 1).map(Math.abs)) : rmax;
        const rIn = iso ? rmax : rb + 0.5, rOut = rIn + Math.max(4, rb * 0.8);
        mb.use('decor', 'magnet').cyl(cx - (iso ? L : L * 0.8), cx + (iso ? L : L * 0.8), rOut, rIn, 48);
        mb.use('decor', 'marker').box(cx - L * 0.5, -0.8, rOut, cx + L * 0.5, 0.8, rOut + 0.6); // pass-direction mark
        posts.push({ part: main, x: cx, bottom: rOut });
      } else {
        // lens: holder ring around the cylindrical edge
        let xa = Infinity, xb = -Infinity;
        for (const s of main.surfs) if (s.g === G.CONE && Math.abs(s.r0 - rmax) < 1e-6 && Math.abs(s.r1 - rmax) < 1e-6) { xa = Math.min(xa, s.x0); xb = Math.max(xb, s.x1); }
        if (!(xb >= xa)) { xa = (e.x0 + e.x1) / 2; xb = xa; }
        const mid = (xa + xb) / 2, hw = Math.max(2, (xb - xa) / 2 + 1);
        ring(mb, mid - hw, mid + hw, rmax, rmax + 4);
        posts.push({ part: main, x: mid, bottom: rmax + 4 });
      }
    } else if (mirrorLike) {
      const front = main.surfs.find((s) => s.role === 'mirror')!;
      const single = !!front.spec?.backAbsorb;
      // which way does the reflecting side face at the vertex?
      const nFront = front.g === G.SPHERE ? (front.a0 + front.a1) / 2 : 0;
      const sFront = (front.g === G.SPHERE ? Math.cos(nFront) : front.nx) * front.sign >= 0 ? 1 : -1;
      const bdir = -sFront, t = clamp((2 * rmax) / 6, 3, 12);
      const xEdge = front.g === G.DISC ? front.x0 : front.g === G.PARAB ? -(front.r1 * front.r1) / (4 * front.f) : bdir > 0 ? e.x1 : e.x0;
      const xFar = bdir > 0 ? e.x1 : e.x0;
      const xb = single ? xFar + bdir * t : xFar;
      if (single) {
        mb.use('decor', 'substrate').lathe([xEdge, rmax, 0, 1, xb, rmax, 0, 1], 48);
        mb.lathe([xb, 0, bdir, 0, xb, rmax, bdir, 0], 48);
      }
      const lo = Math.min(e.x0, e.x1, xb) - 1, hi = Math.max(e.x0, e.x1, xb) + 1;
      ring(mb, lo, Math.max(hi, lo + 4), rmax, rmax + 5);
      posts.push({ part: main, x: (lo + hi) / 2, bottom: rmax + 5 });
    } else if (fam === 'polarizer' || fam === 'waveplate') {
      const rOut = rmax + 7;
      ring(mb, -4, 4, rmax, rOut);
      const raw = P.raw(fam === 'polarizer' ? 'angle' : 'fastAxis');
      const th = ((typeof raw === 'number' ? raw : 0) * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
      // index marks on the transmission / fast axis: a = cos θ · (2D local y) + sin θ · z
      mb.within(mb.sub([0, 0, 0], [1, 0, 0], [0, ct, st], [0, -st, ct]), () => {
        mb.use('decor', 'marker').box(-1, rOut - 0.5, -1, 1, rOut + 2.5, 1);
        mb.box(-1, -rOut - 2.5, -1, 1, -rOut + 0.5, 1);
      });
      posts.push({ part: main, x: 0, bottom: rOut });
    } else if (fam === 'detector') {
      const dp = type === 'detector.spectrometer' ? 14 : 8, ro = rmax + 3;
      mb.use('decor', 'anodized').lathe([0, rmax, -1, 0, 0, ro, -1, 0], 40);
      mb.lathe([0, ro, 0, 1, dp, ro, 0, 1], 40);
      mb.lathe([dp, 0, 1, 0, dp, ro, 1, 0], 40);
      posts.push({ part: main, x: dp / 2, bottom: ro });
    } else {
      const hw = type === 'aperture.iris' ? 3 : 2.5, rOut = rmax + (type === 'aperture.iris' ? 3 : 4);
      const cx = (e.x0 + e.x1) / 2;
      ring(mb, Math.min(e.x0, cx - hw), Math.max(e.x1, cx + hw), rmax, rOut);
      posts.push({ part: main, x: cx, bottom: rOut });
    }
  } else {
    // extruded components
    const H = m.H;
    if (!main.surfs.length) {
      mb.use('decor', 'anodized').box(-5, -5, -5, 5, 5, 5); // unknown / empty component: generic box
      e.x0 = e.y0 = -5; e.x1 = e.y1 = 5;
    }
    if (type === 'absorber.block') mb.use('absorber', 'absorber').box(e.x0, e.y0, -H / 2, e.x1, e.y1, H / 2);
    if (fam === 'detector' && m.det && m.det.kind !== 'screen') {
      const dp = Math.max(4, Math.min(30, (e.y1 - e.y0) * 0.6));
      mb.use('decor', 'anodized').box(e.x1 + 0.05, e.y0 - 1.5, -H / 2 - 1.5, e.x1 + dp, e.y1 + 1.5, H / 2 + 1.5);
    }
    if (type === 'aperture.shutter') {
      mb.use('mount', 'anodized').box(-2, e.y0 - 2, -H / 2 - 2, 2, e.y0, H / 2 + 2);
      mb.box(-2, e.y1, -H / 2 - 2, 2, e.y1 + 2, H / 2 + 2);
    }
    const thin = e.x1 - e.x0 < 8, cx = (e.x0 + e.x1) / 2;
    const zb = main.surfs.length ? e.z0 : -5;
    if (type === 'mirror.galvo') {
      // galvanometer: mirror on a vertical motor shaft through the component origin
      mb.use('mount', 'steel').rod([0, 0, zb - 4], [0, 0, zb], 1.6, 0, 12);
      mb.use('decor', 'anodized').rod([0, 0, zb - 28], [0, 0, zb - 4], 7, 0, 28);
      posts.push({ part: main, x: 0, bottom: -zb + 28 });
    } else if (type === 'chopper.wheel') {
      // slotted wheel in the x = 0 plane, hub beside the beam (2D local y = size/2 + 4), plus motor
      const size = e.y1 - e.y0, hub = size / 2 + 4, R = size + 6;
      const N = clamp(Math.round(P.num('slots')), 1, 200), duty = clamp(P.num('duty'), 0, 1);
      const ph = (P.num('phase') * Math.PI) / 180;
      mb.within(mb.sub([0, hub, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), () => {
        mb.use('aperture', 'anodized').lathe([0, 0, 1, 0, 0, 3.5, 1, 0], 32, true);
        mb.lathe([0, R - 1, 1, 0, 0, R, 1, 0], 64, true);
        for (let i = 0; i < N; i++) {
          // blade i covers the closed fraction (1 − duty) of its period
          const a0 = ph + (2 * Math.PI * (i + duty)) / N, a1 = ph + (2 * Math.PI * (i + 1)) / N;
          const steps = Math.max(1, Math.ceil((a1 - a0) / 0.12));
          for (let k = 0; k < steps; k++) {
            const u0 = a0 + ((a1 - a0) * k) / steps, u1 = a0 + ((a1 - a0) * (k + 1)) / steps;
            const c0 = Math.cos(u0), s0 = Math.sin(u0), c1 = Math.cos(u1), s1 = Math.sin(u1);
            mb.face([0, 3.5 * c0, 3.5 * s0, 0, (R - 1) * c0, (R - 1) * s0, 0, (R - 1) * c1, (R - 1) * s1, 0, 3.5 * c1, 3.5 * s1], [1, 0, 0], true);
          }
        }
        mb.use('decor', 'anodized').cyl(1, 20, 9, 0, 28);
      });
      posts.push({ part: main, x: 10, bottom: 9 - 0 });
      posts[posts.length - 1].y = hub;
    } else {
      if (type === 'modulator.aom') {
        // Bragg cell: crystal block around the interaction plane with the piezo transducer on one side
        const L = P.pos('length', 0.1) / 2;
        mb.use('body', 'custom').box(-L, e.y0, e.z0, L, e.y1, e.z1);
        mb.use('decor', 'anodized').box(-L * 0.8, e.y1, e.z0, L * 0.8, e.y1 + 3, e.z1);
        mb.use('absorber', 'absorber').box(-L * 0.8, e.y0 - 2, e.z0, L * 0.8, e.y0, e.z1);
        mb.use('mount', 'anodized').box(-L, e.y0 - 2, zb - 3, L, e.y1 + 3, zb);
      } else if (thin) mb.use('mount', 'anodized').box(cx - 4, e.y0, zb - 4, cx + 4, e.y1, zb + 1.5);
      else mb.use('mount', 'anodized').box(e.x0, e.y0, zb - 3, e.x1, e.y1, zb);
      posts.push({ part: main, x: cx, bottom: -zb + (thin && type !== 'modulator.aom' ? 4 : 3) });
    }
    void H;
  }

  // ---- mounts down to the table -------------------------------------------------------------
  for (const p of posts) {
    const o = framePoint(p.part.f, p.x, p.y ?? 0, 0);
    const partYaw = Math.atan2(p.part.f.X.y, p.part.f.X.x);
    mount(mb, { x: o.x, y: o.y, z: o.z - p.bottom + 0.3 }, Number.isFinite(partYaw) ? partYaw : yaw, zTable, p.slim);
  }

  const out = mb.finish();
  if (!out.meshes.length) { out.min = { ...main.f.o }; out.max = { ...main.f.o }; }
  const g: ComponentGeometry3D = { meshes: out.meshes, bounds: { min: out.min, max: out.max } };
  if (handles.length) g.handles = handles;
  return g;
}

// ---------------------------------------------------------------------------
// Cache keyed by type + props + pose (meshes are in world coordinates).
// ---------------------------------------------------------------------------

const CACHE = new Map<string, ComponentGeometry3D>();
const CACHE_MAX = 600;

export function getGeometry3D(c: OpticalComponent, tableDepth: number = DEFAULT_TABLE_DEPTH): ComponentGeometry3D {
  const td = Number.isFinite(tableDepth) ? tableDepth : DEFAULT_TABLE_DEPTH;
  const p = poseOf(c);
  let key: string;
  try { key = JSON.stringify([c.type, c.props, c.position?.x, c.position?.y, c.rotation, p.z, p.pitch, p.roll, td]); } catch { key = ''; }
  const hit = key ? CACHE.get(key) : undefined;
  if (hit) { CACHE.delete(key); CACHE.set(key, hit); return hit; }
  const g = build(c, td);
  if (key) {
    if (CACHE.size >= CACHE_MAX) { const first = CACHE.keys().next().value; if (first !== undefined) CACHE.delete(first); }
    CACHE.set(key, g);
  }
  return g;
}

export const clearGeometryCache = (): void => { CACHE.clear(); };
