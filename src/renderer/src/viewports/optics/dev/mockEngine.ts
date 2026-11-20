/**
 * DEV ONLY — a tiny stand-in for the real optics engine so the viewport can be exercised
 * in isolation (dev/preview.html). Implements OpticsEngineAPI with a handful of component
 * types and a minimal sequential ray tracer (reflection, dispersive refraction with Fresnel
 * splits, TIR, absorbers, detectors with hits, a fiber that re-emits at its far end).
 */
import type {
  ComponentDef, ComponentGeometry, DetectorReading, OpticalComponent, OpticsEngineAPI, OpticsScene,
  OpticsSettings, RaySegment, TraceResult, Vec2,
} from '@core/types';

type Role = ComponentGeometry['paths'][number]['role'];
let uid = 1;

const defs: ComponentDef[] = [
  { type: 'source.laser', label: 'Laser', category: 'Sources', description: 'HeNe-ish laser', params: [{ key: 'power', label: 'Power', kind: 'number', unit: 'W', default: 0.005 }, { key: 'wavelength', label: 'λ', kind: 'wavelength', unit: 'nm', default: 632.8 }] },
  { type: 'source.white', label: 'White Light', category: 'Sources', description: 'Broadband source', params: [{ key: 'power', label: 'Power', kind: 'number', unit: 'W', default: 0.05 }] },
  { type: 'prism.equilateral', label: 'Equilateral Prism', category: 'Prisms', description: 'SF11 prism', params: [{ key: 'size', label: 'Side', kind: 'number', unit: 'mm', default: 40 }] },
  { type: 'lens.biconvex', label: 'Biconvex Lens', category: 'Lenses', description: 'BK7 lens', params: [{ key: 'diameter', label: 'Diameter', kind: 'number', unit: 'mm', default: 30 }] },
  { type: 'block.slab', label: 'Glass Slab', category: 'Prisms', description: 'Fused silica slab', params: [] },
  { type: 'mirror.flat', label: 'Flat Mirror', category: 'Mirrors', description: 'Silver mirror', params: [{ key: 'length', label: 'Length', kind: 'number', unit: 'mm', default: 30 }] },
  { type: 'mirror.dichroic', label: 'Dichroic Mirror', category: 'Mirrors', description: 'Dichroic', params: [] },
  { type: 'detector.screen', label: 'Screen', category: 'Detectors', description: 'Screen', params: [{ key: 'length', label: 'Length', kind: 'number', unit: 'mm', default: 60 }] },
  { type: 'detector.power', label: 'Power Meter', category: 'Detectors', description: 'Power meter', params: [] },
  { type: 'absorber.block', label: 'Beam Dump', category: 'Apertures', description: 'Absorber', params: [] },
  { type: 'aperture.slit', label: 'Slit', category: 'Apertures', description: 'Slit', params: [{ key: 'width', label: 'Width', kind: 'number', unit: 'mm', default: 2 }] },
  { type: 'fiber.cable', label: 'Fiber Cable', category: 'Fiber', description: 'Fiber', params: [{ key: 'coreDiameter', label: 'Core', kind: 'number', unit: 'µm', default: 9 }] },
  { type: 'lens.custom', label: 'Concave Blob (test)', category: 'Lenses', description: 'Concave polygon test', params: [] },
];

function defaults(type: string): Record<string, number | string | boolean> {
  const d = defs.find((x) => x.type === type);
  const out: Record<string, number | string | boolean> = {};
  for (const p of d?.params ?? []) out[p.key] = p.default;
  return out;
}

function xf(c: OpticalComponent, pts: Vec2[]): Vec2[] {
  const co = Math.cos(c.rotation), si = Math.sin(c.rotation);
  return pts.map((p) => ({ x: c.position.x + p.x * co - p.y * si, y: c.position.y + p.x * si + p.y * co }));
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function geometry(c: OpticalComponent): ComponentGeometry {
  const paths: ComponentGeometry['paths'] = [];
  const P = (pts: Vec2[], closed: boolean, role: Role) => paths.push({ points: xf(c, pts), closed, role });
  let material: string | undefined;
  const handles: { key: string; p: Vec2 }[] = [];
  switch (c.type) {
    case 'source.laser': case 'source.white':
      P(rect(-46, -7, 0, 7), true, 'emitter'); break;
    case 'prism.equilateral': {
      const s = Number(c.props.size ?? 40), h = (s * Math.sqrt(3)) / 2;
      P([{ x: 0, y: -h * 2 / 3 }, { x: s / 2, y: h / 3 }, { x: -s / 2, y: h / 3 }], true, 'body');
      material = 'sf11'; break;
    }
    case 'lens.biconvex': {
      const D = Number(c.props.diameter ?? 30), R = 50, half = D / 2;
      const sag = R - Math.sqrt(R * R - half * half);
      const pts: Vec2[] = [];
      const N = 24;
      for (let i = 0; i <= N; i++) { const y = -half + (D * i) / N; pts.push({ x: sag + 1.5 - (R - Math.sqrt(R * R - y * y)), y }); }
      for (let i = 0; i <= N; i++) { const y = half - (D * i) / N; pts.push({ x: -(sag + 1.5) + (R - Math.sqrt(R * R - y * y)), y }); }
      P(pts, true, 'body'); material = 'bk7'; break;
    }
    case 'block.slab': P(rect(-10, -20, 10, 20), true, 'body'); material = 'fused_silica'; break;
    case 'lens.custom': P([{ x: -15, y: -15 }, { x: 15, y: -15 }, { x: 4, y: 0 }, { x: 15, y: 15 }, { x: -15, y: 15 }, { x: -6, y: 0 }], true, 'body'); material = 'bk7'; break;
    case 'mirror.flat': case 'mirror.dichroic': {
      const L = Number(c.props.length ?? 30) / 2;
      P([{ x: 0, y: -L }, { x: 0, y: L }], false, 'mirror'); break;
    }
    case 'detector.screen': {
      const L = Number(c.props.length ?? 60) / 2;
      P(rect(0.6, -L - 2, 5, L + 2), true, 'body');
      P([{ x: 0, y: -L }, { x: 0, y: L }], false, 'detector'); break;
    }
    case 'detector.power':
      P(rect(0.5, -12, 16, 12), true, 'body');
      P([{ x: 0, y: -6 }, { x: 0, y: 6 }], false, 'detector'); break;
    case 'absorber.block': P(rect(-6, -14, 6, 14), true, 'absorber'); break;
    case 'aperture.slit': {
      const w = Number(c.props.width ?? 2) / 2;
      P(rect(-1, -20, 1, -w), true, 'aperture');
      P(rect(-1, w, 1, 20), true, 'aperture'); break;
    }
    case 'fiber.cable': {
      const a = c.position, b = { x: Number(c.props.endX ?? a.x + 120), y: Number(c.props.endY ?? a.y) };
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const pts: Vec2[] = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * L * 0.18 });
      }
      paths.push({ points: pts, closed: false, role: 'decor' });
      handles.push({ key: 'end', p: b });
      break;
    }
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of paths) for (const q of p.points) { minx = Math.min(minx, q.x); miny = Math.min(miny, q.y); maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y); }
  if (!Number.isFinite(minx)) { minx = maxx = c.position.x; miny = maxy = c.position.y; }
  return { paths, material, bounds: { min: { x: minx, y: miny }, max: { x: maxx, y: maxy } }, handles };
}

function nIndex(material: string | undefined, nm: number): number {
  const l = nm / 1000;
  if (material === 'sf11') return 1.745 + 0.0135 / (l * l);
  if (material === 'fused_silica') return 1.448 + 0.0035 / (l * l);
  return 1.5046 + 0.0042 / (l * l);
}

// CIE-ish wavelength -> RGB (Bruton + falloff), linear-ish
function wavelengthToRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  let f = 0;
  if (nm >= 380 && nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm < 701) f = 1;
  else if (nm <= 780) f = 0.3 + (0.7 * (780 - nm)) / 80;
  return [r * f, g * f, b * f];
}

interface Edge { a: Vec2; b: Vec2; comp: OpticalComponent; role: Role; material?: string; closed: boolean }

function trace(scene: OpticsScene): TraceResult {
  const t0 = performance.now();
  const segs: RaySegment[] = [];
  const detectors: Record<string, DetectorReading> = {};
  const edges: Edge[] = [];
  const fibers: OpticalComponent[] = [];
  for (const c of scene.components) {
    const g = geometry(c);
    if (c.type.startsWith('fiber')) fibers.push(c);
    if (c.type.startsWith('detector')) detectors[c.id] = { power: 0, hits: [] };
    for (const p of g.paths) {
      if (p.role === 'decor') continue;
      const pts = p.points;
      for (let i = 0; i < pts.length - 1; i++) edges.push({ a: pts[i], b: pts[i + 1], comp: c, role: p.role, material: g.material, closed: p.closed });
      if (p.closed) edges.push({ a: pts[pts.length - 1], b: pts[0], comp: c, role: p.role, material: g.material, closed: true });
    }
  }
  interface Ray { o: Vec2; d: Vec2; nm: number; P: number; depth: number; medium: string | null; src: string; pol: number; polDeg: number }
  const stack: Ray[] = [];
  for (const c of scene.components) {
    if (!c.type.startsWith('source')) continue;
    const d = { x: Math.cos(c.rotation), y: Math.sin(c.rotation) };
    const n = { x: -d.y, y: d.x };
    const P = Number(c.props.power ?? 0.005);
    if (c.type === 'source.laser') {
      const nm = Number(c.props.wavelength ?? 632.8);
      for (let k = -1; k <= 1; k++) stack.push({ o: { x: c.position.x + n.x * k * 0.4, y: c.position.y + n.y * k * 0.4 }, d, nm, P: P / 3, depth: 0, medium: null, src: c.id, pol: 0, polDeg: 1 });
    } else {
      const S = 24;
      for (let k = -2; k <= 2; k++) for (let i = 0; i < S; i++) {
        const nm = 400 + (300 * i) / (S - 1);
        stack.push({ o: { x: c.position.x + n.x * k * 0.6, y: c.position.y + n.y * k * 0.6 }, d, nm, P: P / (5 * S), depth: 0, medium: null, src: c.id, pol: 0, polDeg: 0 });
      }
    }
  }
  let guard = 0;
  while (stack.length && guard++ < 200000) {
    const r = stack.pop()!;
    if (r.depth > 40 || r.P < 1e-9) continue;
    let best = 3000, hit: Edge | null = null;
    for (const e of edges) {
      const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y;
      const den = r.d.x * ey - r.d.y * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = e.a.x - r.o.x, ay = e.a.y - r.o.y;
      const t = (ax * ey - ay * ex) / den;
      const u = (ax * r.d.y - ay * r.d.x) / den;
      if (t > 1e-4 && t < best && u >= 0 && u <= 1) { best = t; hit = e; }
    }
    const b = { x: r.o.x + r.d.x * best, y: r.o.y + r.d.y * best };
    segs.push({ a: r.o, b, wavelength: r.nm, power: r.P, sourceId: r.src, depth: r.depth, inMedium: r.medium !== null, polAngle: r.pol, polDegree: r.polDeg });
    if (!hit) continue;
    const ex = hit.b.x - hit.a.x, ey = hit.b.y - hit.a.y, el = Math.hypot(ex, ey);
    let nx = -ey / el, ny = ex / el;
    if (nx * r.d.x + ny * r.d.y > 0) { nx = -nx; ny = -ny; }
    const cosi = -(nx * r.d.x + ny * r.d.y);
    const refl = { x: r.d.x + 2 * cosi * nx, y: r.d.y + 2 * cosi * ny };
    const o = { x: b.x + nx * 1e-3, y: b.y + ny * 1e-3 };
    const oIn = { x: b.x - nx * 1e-3, y: b.y - ny * 1e-3 };
    switch (hit.role) {
      case 'mirror':
        stack.push({ ...r, o, d: refl, depth: r.depth + 1, P: r.P * 0.97 }); break;
      case 'detector': {
        const rd = detectors[hit.comp.id];
        if (rd) { rd.power += r.P; rd.hits!.push({ p: b, wavelength: r.nm, power: r.P }); }
        break;
      }
      case 'body': case 'surface': {
        if (hit.comp.type.startsWith('detector') || hit.comp.type.startsWith('source')) break;
        const inside = r.medium === hit.comp.id;
        const nG = nIndex(hit.material, r.nm);
        const n1 = inside ? nG : 1, n2 = inside ? 1 : nG;
        const eta = n1 / n2;
        const k = 1 - eta * eta * (1 - cosi * cosi);
        if (k < 0) { stack.push({ ...r, o, d: refl, depth: r.depth + 1 }); break; }
        const cost = Math.sqrt(k);
        const tdir = { x: eta * r.d.x + (eta * cosi - cost) * nx, y: eta * r.d.y + (eta * cosi - cost) * ny };
        const R0 = ((n1 - n2) / (n1 + n2)) ** 2;
        const R = R0 + (1 - R0) * Math.pow(1 - (n1 > n2 ? cost : cosi), 5);
        stack.push({ ...r, o: oIn, d: tdir, depth: r.depth + 1, P: r.P * (1 - R), medium: inside ? null : hit.comp.id });
        if (R * r.P > 2e-6 && r.depth < 8) stack.push({ ...r, o, d: refl, depth: r.depth + 1, P: r.P * R, pol: Math.PI / 2, polDeg: Math.min(1, r.polDeg + 0.5) });
        break;
      }
      default: break; // absorber / aperture / emitter housing stop the ray
    }
  }
  // fiber: light landing near the input is re-emitted at the far end
  for (const f of fibers) {
    let P = 0; const nms: number[] = [];
    for (const s of segs) if (Math.hypot(s.b.x - f.position.x, s.b.y - f.position.y) < 2.5 && s.sourceId !== f.id) { P += s.power; nms.push(s.wavelength); }
    if (P > 0) {
      const end = { x: Number(f.props.endX ?? f.position.x + 120), y: Number(f.props.endY ?? f.position.y) };
      for (let i = -3; i <= 3; i++) {
        const a = (i / 3) * 0.12;
        segs.push({ a: end, b: { x: end.x + Math.cos(a) * 250, y: end.y + Math.sin(a) * 250 }, wavelength: nms[0] ?? 633, power: P / 7, sourceId: f.id, depth: 0 });
      }
    }
  }
  return { segments: segs, detectors, stats: { rays: stack.length, segments: segs.length, ms: performance.now() - t0 } };
}

export const mockEngine: OpticsEngineAPI = {
  registry: defs,
  defaultSettings: (): OpticsSettings => ({ maxBounces: 64, minIntensity: 1e-4, ambientMedium: 'air', raysPerSource: 5, temperatureC: 20, spectralSamples: 24 }),
  createComponent(type, position) {
    const props = defaults(type);
    if (type === 'fiber.cable') { props.endX = position.x + 120; props.endY = position.y; }
    return { id: `c${Date.now().toString(36)}${uid++}`, type, position: { ...position }, rotation: 0, props };
  },
  getGeometry: geometry,
  trace,
  materials: [{ id: 'bk7', label: 'N-BK7' }, { id: 'sf11', label: 'SF11' }, { id: 'fused_silica', label: 'Fused silica' }],
  wavelengthToRGB,
};

export function demoScene(): OpticsScene {
  const mk = (type: string, x: number, y: number, rot = 0, extra: Record<string, number | string | boolean> = {}, name?: string): OpticalComponent => {
    const c = mockEngine.createComponent(type, { x, y });
    return { ...c, rotation: rot, props: { ...c.props, ...extra }, name };
  };
  return {
    settings: mockEngine.defaultSettings(),
    components: [
      mk('source.white', -200, 20, -0.45, {}, 'White LED'),
      mk('prism.equilateral', -80, -38, 0.13),
      mk('detector.screen', 45, 62, 0.7, { length: 90 }),
      mk('source.laser', -190, 130, 0, { power: 0.002 }, 'HeNe 633'),
      mk('lens.biconvex', -90, 130),
      mk('mirror.flat', 0, 130, Math.PI / 4 + Math.PI / 2),
      mk('block.slab', 0, 190, 0.3),
      mk('absorber.block', 0, 255),
      mk('source.laser', -190, -130, 0, { wavelength: 532, power: 0.5 }, 'DPSS 532'),
      mk('aperture.slit', -110, -130, 0, { width: 3 }),
      mk('fiber.cable', -60, -130, 0, { endX: 60, endY: -170 }),
      mk('detector.power', 200, -170, 0),
      mk('lens.custom', 150, 150, 0.2),
    ],
  };
}
