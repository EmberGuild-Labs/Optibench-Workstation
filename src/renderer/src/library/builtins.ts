/**
 * Built-in library items shipped with the app. Generated at runtime from the engine registries so
 * default props and pin positions always match the engines (unknown types are skipped / replaced).
 */
import type { CircuitComponent, OpticalComponent, OptoLink, Vec2, Wire } from '@core/types';
import type { LibraryItem } from '@core/project/library';
import { circuitDef, circuitEngine, opticsDef, opticsEngine } from '../engines';

const CREATED = '2026-11-19T00:00:00.000Z';

function optic(id: string, type: string, name: string, x: number, y: number, rotation: number, props: Record<string, number | string | boolean> = {}): OpticalComponent | null {
  if (!opticsDef(type)) return null;
  try {
    const c = opticsEngine.createComponent(type, { x, y });
    return { ...c, id, name, rotation, props: { ...c.props, ...props } };
  } catch { return null; }
}

function part(id: string, type: string, name: string, x: number, y: number, props: Record<string, number | string | boolean> = {}, rotation: 0 | 1 | 2 | 3 = 0): CircuitComponent | null {
  if (!circuitDef(type)) return null;
  try {
    const c = circuitEngine.createComponent(type, { x, y });
    return { ...c, id, name, rotation, position: { x, y }, props: { ...c.props, ...props } };
  } catch { return null; }
}

/** Circuit builder: components + polyline wires whose ends are given as `comp:pin` or points. */
class Sch {
  comps: CircuitComponent[] = [];
  wires: Wire[] = [];
  private n = 0;
  constructor(private prefix: string) {}
  add(c: CircuitComponent | null): boolean {
    if (!c) return false;
    this.comps.push(c);
    return true;
  }
  pin(ref: string): Vec2 {
    const [id, name] = ref.split(':');
    const c = this.comps.find((x) => x.id === id);
    if (!c) throw new Error(`no component ${id}`);
    const p = circuitEngine.getPinPositions(c).find((q) => q.name === name);
    if (!p) throw new Error(`no pin ${ref}`);
    return p.p;
  }
  wire(...pts: (string | Vec2)[]): void {
    const points = pts.map((p) => (typeof p === 'string' ? this.pin(p) : p));
    this.wires.push({ id: `${this.prefix}_w${++this.n}`, points: points.map((p) => ({ x: p.x, y: p.y })) });
  }
}

function item(id: string, name: string, category: string, description: string, optics: (OpticalComponent | null)[], sch: Sch | null, links: OptoLink[] = []): LibraryItem | null {
  const o = optics.filter((c): c is OpticalComponent => !!c);
  if (!o.length && !sch?.comps.length) return null;
  return {
    id, name, category, description, created: CREATED, builtin: true,
    optics: o,
    circuit: { components: sch?.comps ?? [], wires: sch?.wires ?? [] },
    links
  };
}

function beamExpander(): LibraryItem | null {
  // Galilean 4x expander: f1 = -25 mm, f2 = +100 mm, separation f1 + f2 = 75 mm
  return item('builtin:beam-expander', 'Beam Expander 4× (2-lens)', 'Optics', 'Galilean beam expander: f = −25 mm and f = +100 mm lenses 75 mm apart. Expands a collimated beam 4× along +x.', [
    optic('bx_l1', 'lens.biconcave', 'L1 (f −25)', -37.5, 0, 0, { focalLength: -25, diameter: 12.7 }),
    optic('bx_l2', 'lens.biconvex', 'L2 (f 100)', 37.5, 0, 0, { focalLength: 100, diameter: 25.4 })
  ], null);
}

function periscope(): LibraryItem | null {
  return item('builtin:periscope', 'Periscope (2 mirrors)', 'Optics', 'Two flat mirrors at 45° that raise a beam travelling along +x by 60 mm (towards −y) and send it on parallel to its original path.', [
    optic('ps_m1', 'mirror.flat', 'M1', 0, 30, Math.PI / 4, { size: 30 }),
    optic('ps_m2', 'mirror.flat', 'M2', 0, -30, Math.PI / 4, { size: 30 })
  ], null);
}

function ledResistor(): LibraryItem | null {
  const s = new Sch('led');
  if (!s.add(part('led_r', 'passive.resistor', 'R1', -3, 0, { resistance: 330 }))) return null;
  if (!s.add(part('led_d', 'semi.led', 'D1', 3, 0, { color: 'red' }))) return null;
  try { s.wire('led_r:B', 'led_d:A'); } catch { return null; }
  return item('builtin:led-resistor', 'LED with Current-limit Resistor', 'Circuit', '330 Ω series resistor feeding a red LED (≈ 10 mA from 5 V). Connect the free resistor end to the supply and the LED cathode to ground.', [], s);
}

function tiaFrontEnd(): LibraryItem | null {
  const s = new Sch('tia');
  const head = optic('tia_head', 'detector.photodiode', 'PD head', 0, 0, 0);
  const links: OptoLink[] = [];
  try {
    if (circuitDef('ic.opamp') && circuitDef('opto.photodiode')) {
      // transimpedance amplifier: Vout = Iph · Rf (single 5 V supply, photodiode anode to ground)
      s.add(part('tia_u', 'ic.opamp', 'U1', 0, 0));
      s.add(part('tia_pd', 'opto.photodiode', 'PD1', -7, -1));
      s.add(part('tia_rf', 'passive.resistor', 'RF', 0, -5, { resistance: 100000 }));
      s.add(part('tia_g1', 'misc.ground', 'GND', -9, 1));
      s.add(part('tia_g2', 'misc.ground', 'GND', -3, 3));
      s.add(part('tia_g3', 'misc.ground', 'GND', 0, 4));
      s.add(part('tia_ps', 'source.psu', 'PS1', 10, -3, { voltage: 5 }));
      s.add(part('tia_g4', 'misc.ground', 'GND', 12, -1));
      s.add(part('tia_out', 'meter.probe', 'VOUT', 6, 0, { color: '#5ac8ff' }));
      s.wire('tia_pd:K', 'tia_u:IN-');
      s.wire('tia_pd:A', 'tia_g1:GND');
      s.wire('tia_u:IN+', 'tia_g2:GND');
      s.wire('tia_u:V-', 'tia_g3:GND');
      s.wire('tia_u:OUT', 'tia_out:IN');
      s.wire('tia_rf:A', { x: -4, y: -5 }, { x: -4, y: -1 });
      s.wire('tia_rf:B', { x: 4, y: -5 }, { x: 4, y: 0 });
      s.wire('tia_u:V+', { x: 0, y: -3 }, 'tia_ps:+');
      s.wire('tia_ps:-', 'tia_g4:GND');
      if (head) links.push({ id: 'tia_link', kind: 'detector', opticsId: 'tia_head', circuitId: 'tia_pd' });
      return item('builtin:tia', 'Transimpedance Photodiode Front-end', 'Opto', 'Photodiode into an op-amp transimpedance amplifier (RF = 100 kΩ, Vout = Iph · RF) on a single 5 V supply, with an output probe. Includes the optical photodiode head, opto-linked to PD1.', [head], s, links);
    }
  } catch { /* fall through to the simple version */ }
  const f = new Sch('pdr');
  if (!f.add(part('pdr_pd', 'opto.photodiode', 'PD1', 0, 0))) return null;
  f.add(part('pdr_r', 'passive.resistor', 'RL', 0, 4, { resistance: 10000 }, 0));
  f.add(part('pdr_ps', 'source.psu', 'PS1', 6, 0, { voltage: 5 }));
  f.add(part('pdr_g', 'misc.ground', 'GND', 4, 6));
  try {
    f.wire('pdr_pd:K', 'pdr_ps:+');
    f.wire('pdr_pd:A', { x: -2, y: 4 });
    f.wire('pdr_r:B', { x: 4, y: 4 }, 'pdr_g:GND');
    f.wire('pdr_ps:-', { x: 8, y: 6 }, { x: 4, y: 6 });
  } catch { return null; }
  if (head) links.push({ id: 'pdr_link', kind: 'detector', opticsId: 'tia_head', circuitId: 'pdr_pd' });
  return item('builtin:tia', 'Photodiode Front-end (load resistor)', 'Opto', 'Reverse-biased photodiode with a 10 kΩ load resistor (op-amp not available in this build).', [head], f, links);
}

let cache: LibraryItem[] | null = null;

export function builtinLibrary(): LibraryItem[] {
  if (cache) return cache;
  const out: LibraryItem[] = [];
  for (const fn of [beamExpander, periscope, ledResistor, tiaFrontEnd]) {
    try { const it = fn(); if (it) out.push(it); } catch { /* engine without these parts */ }
  }
  cache = out;
  return out;
}
