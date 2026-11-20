/**
 * Component library (.obwlib) — reusable groups of optics components, circuit components with
 * the wires between them, and the opto-links among them.
 * Pure TypeScript (no DOM / Node APIs): used by the renderer, by main for validation, and by tests.
 *
 * Coordinates inside a library item are relative to the group's own origin (the centre of its
 * bounding box per domain; circuit origin rounded to the grid) so it can be dropped anywhere.
 */
import type { CircuitComponent, ObwDocument, OpticalComponent, OptoLink, ParamValue, Vec2, Wire } from '../types';

export const LIBRARY_MAGIC = 'optibench-library';
export const LIBRARY_VERSION = 1;
export const LIBRARY_EXTENSION = 'obwlib';

export interface LibraryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  created: string;
  modified?: string;
  /** Shipped with the app (read-only, not stored in userData). */
  builtin?: boolean;
  optics: OpticalComponent[];
  circuit: { components: CircuitComponent[]; wires: Wire[] };
  links: OptoLink[];
}

export interface LibraryFile {
  format: typeof LIBRARY_MAGIC;
  version: number;
  items: LibraryItem[];
}

export type PinFn = (c: CircuitComponent) => { name: string; p: Vec2 }[];

const key = (p: Vec2): string => `${p.x},${p.y}`;

// ---------------------------------------------------------------------------
// Selection -> group
// ---------------------------------------------------------------------------

/**
 * Wires that belong to a selection of circuit components: every explicitly selected wire, plus
 * every wire whose end points all land on a pin of a selected component or on a vertex /
 * segment of another wire already in the group (fix-point, so junction chains come along).
 */
export function groupWires(wires: Wire[], comps: CircuitComponent[], selectedWireIds: Iterable<string>, pins: PinFn): string[] {
  const chosen = new Set(selectedWireIds);
  const anchors = new Set<string>();
  for (const c of comps) {
    try { for (const p of pins(c)) anchors.add(key(p.p)); } catch { /* unknown type */ }
  }
  const onWire = (p: Vec2, w: Wire): boolean => {
    for (let i = 0; i < w.points.length; i++) {
      const a = w.points[i];
      if (a.x === p.x && a.y === p.y) return true;
      const b = w.points[i + 1];
      if (!b) break;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross === 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) return true;
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of wires) {
      if (chosen.has(w.id) || w.points.length < 2) continue;
      const ends = [w.points[0], w.points[w.points.length - 1]];
      const ok = ends.every((p) => anchors.has(key(p)) || wires.some((o) => o !== w && chosen.has(o.id) && onWire(p, o)));
      if (ok) { chosen.add(w.id); changed = true; }
    }
  }
  return wires.filter((w) => chosen.has(w.id)).map((w) => w.id);
}

function opticsCentre(list: OpticalComponent[]): Vec2 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const c of list) {
    add(c.position.x, c.position.y);
    if (typeof c.props?.endX === 'number' && typeof c.props?.endY === 'number') add(c.props.endX, c.props.endY);
  }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
}

function circuitCentre(comps: CircuitComponent[], wires: Wire[]): Vec2 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Vec2): void => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const c of comps) add(c.position);
  for (const w of wires) for (const p of w.points) add(p);
  return Number.isFinite(x0) ? { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) } : { x: 0, y: 0 };
}

function shiftOptics(c: OpticalComponent, d: Vec2): OpticalComponent {
  const next: OpticalComponent = { ...structuredClone(c), position: { x: c.position.x + d.x, y: c.position.y + d.y } };
  if (typeof c.props?.endX === 'number' && typeof c.props?.endY === 'number') {
    next.props = { ...next.props, endX: (c.props.endX as number) + d.x, endY: (c.props.endY as number) + d.y };
  }
  return next;
}

/** Build the content of a library item from a document selection (ids are kept; positions made relative). */
export function extractGroup(
  doc: Pick<ObwDocument, 'optics' | 'circuit' | 'links'>,
  sel: { optics: string[]; circuit: string[] },
  pins: PinFn
): Pick<LibraryItem, 'optics' | 'circuit' | 'links'> {
  const os = new Set(sel.optics), cs = new Set(sel.circuit);
  const optics = doc.optics.components.filter((c) => os.has(c.id));
  const comps = doc.circuit.components.filter((c) => cs.has(c.id));
  const wireIds = new Set(groupWires(doc.circuit.wires, comps, doc.circuit.wires.filter((w) => cs.has(w.id)).map((w) => w.id), pins));
  const wires = doc.circuit.wires.filter((w) => wireIds.has(w.id));
  const oIds = new Set(optics.map((c) => c.id)), cIds = new Set(comps.map((c) => c.id));
  const links = doc.links.filter((l) => oIds.has(l.opticsId) && cIds.has(l.circuitId));
  const oc = opticsCentre(optics), cc = circuitCentre(comps, wires);
  return {
    optics: optics.map((c) => shiftOptics(c, { x: -oc.x, y: -oc.y })),
    circuit: {
      components: comps.map((c) => ({ ...structuredClone(c), position: { x: c.position.x - cc.x, y: c.position.y - cc.y } })),
      wires: wires.map((w) => ({ ...structuredClone(w), points: w.points.map((p) => ({ x: p.x - cc.x, y: p.y - cc.y })) }))
    },
    links: links.map((l) => structuredClone(l))
  };
}

// ---------------------------------------------------------------------------
// Group -> document (fresh ids, remapped wires / links)
// ---------------------------------------------------------------------------

export function makeUniqueId(used: Set<string>, rand: () => number = Math.random): (prefix: string) => string {
  return (prefix: string) => {
    let id = '';
    do { id = `${prefix}_${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`; } while (used.has(id));
    used.add(id);
    return id;
  };
}

/** Next free reference designator (R1 -> R3 when R1, R2 are taken). Names without a number are kept. */
export function freeDesignator(name: string | undefined, taken: Set<string>): string | undefined {
  if (!name) return name;
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return name;
  if (!taken.has(name)) return name;
  let k = 1;
  while (taken.has(`${m[1]}${k}`)) k++;
  return `${m[1]}${k}`;
}

export interface Instantiated {
  optics: OpticalComponent[];
  circuit: CircuitComponent[];
  wires: Wire[];
  links: OptoLink[];
  /** old id -> new id (components, wires and links) */
  idMap: Map<string, string>;
}

/**
 * Copy a library item into a document: every component, wire and link gets a fresh id that does
 * not collide with the document; links are remapped to the new component ids; designators are
 * renumbered; the optics part is centred on `at.optics` (mm) and the circuit part on `at.circuit`
 * (grid units, rounded).
 */
export function instantiateGroup(
  item: Pick<LibraryItem, 'optics' | 'circuit' | 'links'>,
  doc: Pick<ObwDocument, 'optics' | 'circuit' | 'links'>,
  at: { optics: Vec2; circuit: Vec2 },
  rand: () => number = Math.random
): Instantiated {
  const used = new Set<string>([
    ...doc.optics.components.map((c) => c.id),
    ...doc.circuit.components.map((c) => c.id),
    ...doc.circuit.wires.map((w) => w.id),
    ...doc.links.map((l) => l.id)
  ]);
  const mk = makeUniqueId(used, rand);
  const idMap = new Map<string, string>();
  const names = new Set(doc.circuit.components.map((c) => c.name).filter((n): n is string => !!n));
  const ca = { x: Math.round(at.circuit.x), y: Math.round(at.circuit.y) };

  const optics = item.optics.map((c) => {
    const id = mk('o');
    idMap.set(c.id, id);
    return { ...shiftOptics(c, at.optics), id };
  });
  const circuit = item.circuit.components.map((c) => {
    const id = mk('c');
    idMap.set(c.id, id);
    const name = freeDesignator(c.name, names);
    if (name) names.add(name);
    return { ...structuredClone(c), id, name, position: { x: c.position.x + ca.x, y: c.position.y + ca.y } };
  });
  const wires = item.circuit.wires.map((w) => {
    const id = mk('w');
    idMap.set(w.id, id);
    return { ...structuredClone(w), id, points: w.points.map((p) => ({ x: p.x + ca.x, y: p.y + ca.y })) };
  });
  const links: OptoLink[] = [];
  for (const l of item.links) {
    const o = idMap.get(l.opticsId), c = idMap.get(l.circuitId);
    if (!o || !c) continue;
    const id = mk('l');
    idMap.set(l.id, id);
    links.push({ ...structuredClone(l), id, opticsId: o, circuitId: c });
  }
  return { optics, circuit, wires, links, idMap };
}

// ---------------------------------------------------------------------------
// Validation / file format
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec2 => isObj(v) && isNum(v.x) && isNum(v.y);
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);

function cleanProps(v: unknown): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') out[k] = x;
  return out;
}

/** Validate an untrusted library item (from userData or an imported .obwlib). Throws on malformed input. */
export function validateLibraryItem(raw: unknown): LibraryItem {
  if (!isObj(raw)) throw new Error('Library item is not an object.');
  const name = str(raw.name).trim();
  if (!name) throw new Error('Library item has no name.');
  const optics: OpticalComponent[] = [];
  for (const c of Array.isArray(raw.optics) ? raw.optics : []) {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.type !== 'string' || !isVec(c.position)) throw new Error(`"${name}": invalid optics component.`);
    const o: OpticalComponent = { id: c.id, type: c.type, position: { x: c.position.x, y: c.position.y }, rotation: isNum(c.rotation) ? c.rotation : 0, props: cleanProps(c.props) };
    if (typeof c.name === 'string') o.name = c.name;
    if (c.locked === true) o.locked = true;
    if (isObj(c.pose3d) && isNum(c.pose3d.z) && isNum(c.pose3d.pitch) && isNum(c.pose3d.roll)) o.pose3d = { z: c.pose3d.z, pitch: c.pose3d.pitch, roll: c.pose3d.roll };
    optics.push(o);
  }
  const rc = isObj(raw.circuit) ? raw.circuit : {};
  const components: CircuitComponent[] = [];
  for (const c of Array.isArray(rc.components) ? rc.components : []) {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.type !== 'string' || !isVec(c.position)) throw new Error(`"${name}": invalid circuit component.`);
    const r = isNum(c.rotation) ? ((Math.round(c.rotation) % 4) + 4) % 4 : 0;
    const o: CircuitComponent = { id: c.id, type: c.type, position: { x: Math.round(c.position.x), y: Math.round(c.position.y) }, rotation: r as 0 | 1 | 2 | 3, props: cleanProps(c.props) };
    if (typeof c.name === 'string') o.name = c.name;
    if (c.mirrored === true) o.mirrored = true;
    components.push(o);
  }
  const wires: Wire[] = [];
  for (const w of Array.isArray(rc.wires) ? rc.wires : []) {
    if (!isObj(w) || typeof w.id !== 'string' || !Array.isArray(w.points) || !w.points.every(isVec)) throw new Error(`"${name}": invalid wire.`);
    const o: Wire = { id: w.id, points: (w.points as Vec2[]).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) };
    if (typeof w.color === 'string') o.color = w.color;
    if (typeof w.label === 'string') o.label = w.label;
    wires.push(o);
  }
  const oIds = new Set(optics.map((c) => c.id)), cIds = new Set(components.map((c) => c.id));
  const links: OptoLink[] = [];
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    if (!isObj(l) || typeof l.id !== 'string' || typeof l.opticsId !== 'string' || typeof l.circuitId !== 'string') continue;
    if (l.kind !== 'emitter' && l.kind !== 'detector' && l.kind !== 'actuator') continue;
    if (!oIds.has(l.opticsId) || !cIds.has(l.circuitId)) continue;
    const o: OptoLink = { id: l.id, kind: l.kind, opticsId: l.opticsId, circuitId: l.circuitId };
    if (typeof l.targetProp === 'string') o.targetProp = l.targetProp;
    if (isNum(l.gain)) o.gain = l.gain;
    if (isNum(l.offset)) o.offset = l.offset;
    links.push(o);
  }
  if (!optics.length && !components.length) throw new Error(`"${name}" contains no components.`);
  const item: LibraryItem = {
    id: str(raw.id) || `lib_${Date.now().toString(36)}`,
    name: name.slice(0, 120),
    category: (str(raw.category).trim() || 'General').slice(0, 60),
    description: str(raw.description).slice(0, 2000),
    created: str(raw.created) || new Date().toISOString(),
    optics,
    circuit: { components, wires },
    links
  };
  if (typeof raw.modified === 'string') item.modified = raw.modified;
  return item;
}

export function serializeLibraryFile(items: LibraryItem[]): string {
  const file: LibraryFile = { format: LIBRARY_MAGIC, version: LIBRARY_VERSION, items: items.map(({ builtin: _b, ...it }) => it) };
  return JSON.stringify(file, null, 2) + '\n';
}

/** Parse a .obwlib file (or a bare item / array of items). Throws with a readable message. */
export function parseLibraryFile(text: string): LibraryItem[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${(e as Error).message}`); }
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (isObj(raw) && Array.isArray(raw.items)) {
    if (raw.format !== undefined && raw.format !== LIBRARY_MAGIC) throw new Error('Not an Optibench library file.');
    if (isNum(raw.version) && raw.version > LIBRARY_VERSION) throw new Error(`Library format version ${raw.version} is newer than this app supports.`);
    list = raw.items;
  } else if (isObj(raw)) list = [raw];
  else throw new Error('Not an Optibench library file.');
  if (!list.length) throw new Error('The library file contains no items.');
  return list.map(validateLibraryItem);
}

/** Domains an item touches (for palette filtering and placement). */
export function itemDomains(item: Pick<LibraryItem, 'optics' | 'circuit'>): ('optics' | 'circuit')[] {
  const d: ('optics' | 'circuit')[] = [];
  if (item.optics.length) d.push('optics');
  if (item.circuit.components.length) d.push('circuit');
  return d;
}
