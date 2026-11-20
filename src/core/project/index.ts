/**
 * .obw project document: create / serialize / parse / validate / migrate.
 * Pure TypeScript — no DOM or Node APIs.
 */
import {
  APP_VERSION, FILE_EXTENSION, FILE_MAGIC, FORMAT_VERSION,
  type CircuitComponent, type CircuitScene, type ObwDocument, type OpticalComponent,
  type OpticsScene, type OpticsSettings, type OptoLink, type ParamValue, type Vec2,
  type ViewState, type Wire
} from '../types';

export { FILE_EXTENSION, FILE_MAGIC, FORMAT_VERSION };

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

export interface ParseResult {
  doc: ObwDocument;
  warnings: string[];
}

export const DEFAULT_OPTICS_SETTINGS: OpticsSettings = {
  maxBounces: 64,
  minIntensity: 1e-4,
  ambientMedium: 'air',
  raysPerSource: 32,
  temperatureC: 20,
  spectralSamples: 24
};

export const DEFAULT_CIRCUIT_SETTINGS: CircuitScene['settings'] = {
  timestep: 1e-5,
  simSpeed: 1,
  gmin: 1e-12
};

export function createEmptyDocument(title = 'Untitled Project'): ObwDocument {
  const now = new Date().toISOString();
  return {
    format: FILE_MAGIC,
    version: FORMAT_VERSION,
    meta: { title, created: now, modified: now, appVersion: APP_VERSION, dimension: '2d' },
    optics: { components: [], settings: { ...DEFAULT_OPTICS_SETTINGS } },
    circuit: { components: [], wires: [], settings: { ...DEFAULT_CIRCUIT_SETTINGS } },
    links: [],
    view: {
      optics: { cx: 0, cy: 0, zoom: 2 },
      circuit: { cx: 0, cy: 0, zoom: 20 },
      activeTab: 'optics'
    }
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Top-level key order for readability; any other keys sorted alphabetically after. */
const TOP_ORDER = ['format', 'version', 'meta', 'optics', 'circuit', 'links', 'view'];
const PREFERRED = ['id', 'kind', 'type', 'name', 'position', 'rotation', 'mirrored', 'locked', 'pose3d', 'props', 'points'];

function sortKeys(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v, depth + 1));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const order = depth === 0 ? TOP_ORDER : PREFERRED;
    keys.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sortKeys(obj[k], depth + 1);
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 0;
  return value;
}

/** Pretty JSON, stable key order, trailing newline. Does not mutate `doc`. */
export function serializeDocument(doc: ObwDocument): string {
  return JSON.stringify(sortKeys(doc, 0), null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

type Migration = (raw: Record<string, unknown>, warnings: string[]) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a version-n document to version n+1. */
const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release drafts had no `links` and stored optics settings at top level.
  0: (raw, warnings) => {
    const out = { ...raw };
    if (!('links' in out)) out.links = [];
    warnings.push('Migrated document from format version 0 to 1.');
    return out;
  }
};

export function migrate(raw: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  let version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > FORMAT_VERSION) {
    throw new ProjectParseError(
      `This project was saved with a newer format (version ${version}). ` +
      `This build of Optibench Workstation supports up to version ${FORMAT_VERSION}. Please update the app.`
    );
  }
  let cur = raw;
  while (version < FORMAT_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) throw new ProjectParseError(`No migration available from format version ${version}.`);
    cur = m(cur, warnings);
    version++;
    cur.version = version;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Ctx {
  warnings: string[] = [];
  warn(path: string, msg: string): void { this.warnings.push(`${path}: ${msg}`); }

  num(o: Obj, key: string, def: number, path: string, opts: { min?: number; max?: number; int?: boolean } = {}): number {
    const v = o[key];
    if (v === undefined) return def;
    if (!isNum(v)) { this.warn(`${path}.${key}`, `expected a number, got ${describe(v)}; using ${def}`); return def; }
    let n = v;
    if (opts.int && !Number.isInteger(n)) { n = Math.round(n); this.warn(`${path}.${key}`, `expected an integer; rounded to ${n}`); }
    if (opts.min !== undefined && n < opts.min) { this.warn(`${path}.${key}`, `${n} below minimum ${opts.min}; clamped`); n = opts.min; }
    if (opts.max !== undefined && n > opts.max) { this.warn(`${path}.${key}`, `${n} above maximum ${opts.max}; clamped`); n = opts.max; }
    return n;
  }

  str(o: Obj, key: string, def: string, path: string): string {
    const v = o[key];
    if (v === undefined) return def;
    if (typeof v !== 'string') { this.warn(`${path}.${key}`, `expected a string, got ${describe(v)}; using default`); return def; }
    return v;
  }

  optStr(o: Obj, key: string, path: string): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') { this.warn(`${path}.${key}`, `expected a string, got ${describe(v)}; ignored`); return undefined; }
    return v;
  }

  vec(o: Obj, key: string, path: string, int = false): Vec2 {
    const v = o[key];
    if (!isObj(v)) { this.warn(`${path}.${key}`, `missing or invalid position; using (0, 0)`); return { x: 0, y: 0 }; }
    return { x: this.num(v, 'x', 0, `${path}.${key}`, { int }), y: this.num(v, 'y', 0, `${path}.${key}`, { int }) };
  }

  props(o: Obj, path: string): Record<string, ParamValue> {
    const v = o.props;
    const out: Record<string, ParamValue> = {};
    if (v === undefined) return out;
    if (!isObj(v)) { this.warn(`${path}.props`, 'expected an object; ignored'); return out; }
    for (const [k, pv] of Object.entries(v)) {
      if (typeof pv === 'string' || typeof pv === 'boolean' || isNum(pv)) out[k] = pv;
      else this.warn(`${path}.props.${k}`, `unsupported value ${describe(pv)}; dropped`);
    }
    return out;
  }

  arr(o: Obj, key: string, path: string): unknown[] {
    const v = o[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { this.warn(`${path}.${key}`, 'expected an array; ignored'); return []; }
    return v;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return typeof v;
}

function uniqueId(id: unknown, used: Set<string>, prefix: string, path: string, ctx: Ctx): string {
  let s = typeof id === 'string' && id.trim() ? id : '';
  if (!s) { s = `${prefix}${used.size + 1}`; ctx.warn(path, `missing id; assigned "${s}"`); }
  if (used.has(s)) {
    let n = 2;
    while (used.has(`${s}_${n}`)) n++;
    ctx.warn(path, `duplicate id "${s}"; renamed to "${s}_${n}"`);
    s = `${s}_${n}`;
  }
  used.add(s);
  return s;
}

function parseOptics(v: unknown, ctx: Ctx, ids: Set<string>): OpticsScene {
  const path = 'optics';
  const o: Obj = isObj(v) ? v : (ctx.warn(path, 'missing; using empty optics scene'), {});
  const s: Obj = isObj(o.settings) ? o.settings : {};
  const d = DEFAULT_OPTICS_SETTINGS;
  const sp = `${path}.settings`;
  const settings: OpticsSettings = {
    maxBounces: ctx.num(s, 'maxBounces', d.maxBounces, sp, { min: 1, max: 10000, int: true }),
    minIntensity: ctx.num(s, 'minIntensity', d.minIntensity, sp, { min: 0, max: 1 }),
    ambientMedium: ctx.str(s, 'ambientMedium', d.ambientMedium, sp),
    raysPerSource: ctx.num(s, 'raysPerSource', d.raysPerSource, sp, { min: 1, max: 100000, int: true }),
    temperatureC: ctx.num(s, 'temperatureC', d.temperatureC, sp, { min: -273.15, max: 2000 }),
    spectralSamples: ctx.num(s, 'spectralSamples', d.spectralSamples, sp, { min: 1, max: 1000, int: true })
  };
  // optional wave-optics switch (interference / diffraction); omitted = ray mode
  if (typeof s.waveMode === 'boolean') settings.waveMode = s.waveMode;
  const components: OpticalComponent[] = [];
  ctx.arr(o, 'components', path).forEach((c, i) => {
    const cp = `${path}.components[${i}]`;
    if (!isObj(c)) { ctx.warn(cp, 'not an object; dropped'); return; }
    if (typeof c.type !== 'string' || !c.type) { ctx.warn(cp, 'missing type; dropped'); return; }
    const comp: OpticalComponent = {
      id: uniqueId(c.id, ids, 'o', cp, ctx),
      type: c.type,
      position: ctx.vec(c, 'position', cp),
      rotation: ctx.num(c, 'rotation', 0, cp),
      props: ctx.props(c, cp)
    };
    const name = ctx.optStr(c, 'name', cp);
    if (name !== undefined) comp.name = name;
    if (c.locked === true) comp.locked = true;
    if (c.pose3d !== undefined) {
      const pp = `${cp}.pose3d`;
      if (!isObj(c.pose3d)) ctx.warn(pp, `expected an object, got ${describe(c.pose3d)}; ignored`);
      else {
        comp.pose3d = {
          z: ctx.num(c.pose3d, 'z', 0, pp),
          pitch: ctx.num(c.pose3d, 'pitch', 0, pp),
          roll: ctx.num(c.pose3d, 'roll', 0, pp)
        };
      }
    }
    components.push(comp);
  });
  return { components, settings };
}

function parseCircuit(v: unknown, ctx: Ctx, ids: Set<string>): CircuitScene {
  const path = 'circuit';
  const o: Obj = isObj(v) ? v : (ctx.warn(path, 'missing; using empty circuit'), {});
  const s: Obj = isObj(o.settings) ? o.settings : {};
  const d = DEFAULT_CIRCUIT_SETTINGS;
  const sp = `${path}.settings`;
  const settings = {
    timestep: ctx.num(s, 'timestep', d.timestep, sp, { min: 1e-12, max: 1 }),
    simSpeed: ctx.num(s, 'simSpeed', d.simSpeed, sp, { min: 1e-15, max: 1e9 }),
    gmin: ctx.num(s, 'gmin', d.gmin, sp, { min: 0, max: 1 })
  };
  const components: CircuitComponent[] = [];
  ctx.arr(o, 'components', path).forEach((c, i) => {
    const cp = `${path}.components[${i}]`;
    if (!isObj(c)) { ctx.warn(cp, 'not an object; dropped'); return; }
    if (typeof c.type !== 'string' || !c.type) { ctx.warn(cp, 'missing type; dropped'); return; }
    let rot = ctx.num(c, 'rotation', 0, cp, { int: true });
    if (rot < 0 || rot > 3) { const r = ((rot % 4) + 4) % 4; ctx.warn(`${cp}.rotation`, `must be 0..3; normalised to ${r}`); rot = r; }
    const comp: CircuitComponent = {
      id: uniqueId(c.id, ids, 'c', cp, ctx),
      type: c.type,
      position: ctx.vec(c, 'position', cp, true),
      rotation: rot as 0 | 1 | 2 | 3,
      props: ctx.props(c, cp)
    };
    const name = ctx.optStr(c, 'name', cp);
    if (name !== undefined) comp.name = name;
    if (c.mirrored === true) comp.mirrored = true;
    components.push(comp);
  });
  const wires: Wire[] = [];
  ctx.arr(o, 'wires', path).forEach((w, i) => {
    const wp = `${path}.wires[${i}]`;
    if (!isObj(w)) { ctx.warn(wp, 'not an object; dropped'); return; }
    const pts: Vec2[] = [];
    ctx.arr(w, 'points', wp).forEach((p, j) => {
      if (isObj(p) && isNum(p.x) && isNum(p.y)) pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
      else ctx.warn(`${wp}.points[${j}]`, 'invalid point; dropped');
    });
    if (pts.length < 2) { ctx.warn(wp, 'wire needs at least 2 points; dropped'); return; }
    const wire: Wire = { id: uniqueId(w.id, ids, 'w', wp, ctx), points: pts };
    const color = ctx.optStr(w, 'color', wp);
    const label = ctx.optStr(w, 'label', wp);
    if (color !== undefined) wire.color = color;
    if (label !== undefined) wire.label = label;
    wires.push(wire);
  });
  return { components, wires, settings };
}

function parseLinks(v: unknown, ctx: Ctx, optics: OpticsScene, circuit: CircuitScene): OptoLink[] {
  const out: OptoLink[] = [];
  if (v === undefined) return out;
  if (!Array.isArray(v)) { ctx.warn('links', 'expected an array; ignored'); return out; }
  const oIds = new Set(optics.components.map((c) => c.id));
  const cIds = new Set(circuit.components.map((c) => c.id));
  const used = new Set<string>();
  v.forEach((l, i) => {
    const lp = `links[${i}]`;
    if (!isObj(l)) { ctx.warn(lp, 'not an object; dropped'); return; }
    const kind = l.kind;
    if (kind !== 'emitter' && kind !== 'detector' && kind !== 'actuator') { ctx.warn(lp, `invalid kind ${JSON.stringify(kind)}; dropped`); return; }
    if (typeof l.circuitId !== 'string' || !cIds.has(l.circuitId)) { ctx.warn(lp, `circuitId ${JSON.stringify(l.circuitId)} does not exist; dropped`); return; }
    if (typeof l.opticsId !== 'string' || !oIds.has(l.opticsId)) { ctx.warn(lp, `opticsId ${JSON.stringify(l.opticsId)} does not exist; dropped`); return; }
    const link: OptoLink = { id: uniqueId(l.id, used, 'link', lp, ctx), kind, circuitId: l.circuitId, opticsId: l.opticsId };
    if (kind === 'actuator') {
      const tp = ctx.optStr(l, 'targetProp', lp);
      if (!tp) { ctx.warn(lp, 'actuator link without targetProp; dropped'); return; }
      link.targetProp = tp;
      link.gain = ctx.num(l, 'gain', 1, lp);
      link.offset = ctx.num(l, 'offset', 0, lp);
      if (l.source !== undefined) {
        const src = l.source;
        if (src === 'current' || src === 'voltage' || src === 'angle' || src === 'speed' || src === 'brightness') link.source = src;
        else ctx.warn(lp, `invalid source ${JSON.stringify(src)} (current | voltage | angle | speed | brightness); using the default quantity`);
      }
    } else {
      if (l.gain !== undefined) link.gain = ctx.num(l, 'gain', 1, lp);
      if (l.offset !== undefined) link.offset = ctx.num(l, 'offset', 0, lp);
      const tp = ctx.optStr(l, 'targetProp', lp);
      if (tp) link.targetProp = tp;
    }
    out.push(link);
  });
  return out;
}

function parseView(v: unknown, ctx: Ctx): ObwDocument['view'] {
  const def = createEmptyDocument().view!;
  if (v === undefined) return def;
  if (!isObj(v)) { ctx.warn('view', 'expected an object; using defaults'); return def; }
  const vs = (key: 'optics' | 'circuit'): ViewState => {
    const o = v[key];
    const d = def[key]!;
    if (!isObj(o)) return d;
    return {
      cx: ctx.num(o, 'cx', d.cx, `view.${key}`),
      cy: ctx.num(o, 'cy', d.cy, `view.${key}`),
      zoom: ctx.num(o, 'zoom', d.zoom, `view.${key}`, { min: 1e-4, max: 1e5 })
    };
  };
  const at = v.activeTab;
  let activeTab: 'optics' | 'circuit' | 'split' = 'optics';
  if (at === 'optics' || at === 'circuit' || at === 'split') activeTab = at;
  else if (at !== undefined) ctx.warn('view.activeTab', `invalid value ${JSON.stringify(at)}; using "optics"`);
  return { optics: vs('optics'), circuit: vs('circuit'), activeTab };
}

/**
 * Parse and validate .obw text. Throws ProjectParseError for unrecoverable problems
 * (invalid JSON, wrong file type, newer format). Fixes everything else with warnings.
 */
export function parseDocument(text: string): ParseResult {
  let raw: unknown;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    throw new ProjectParseError(`The file is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new ProjectParseError('The file does not contain a project object.');
  if (raw.format !== FILE_MAGIC) {
    throw new ProjectParseError(
      `Not an Optibench Workstation project (expected format "${FILE_MAGIC}", found ${JSON.stringify(raw.format ?? null)}).`
    );
  }
  const ctx = new Ctx();
  const m = migrate(raw, ctx.warnings);

  const metaRaw: Obj = isObj(m.meta) ? m.meta : (ctx.warn('meta', 'missing; using defaults'), {});
  const now = new Date().toISOString();
  const dim = metaRaw.dimension;
  if (dim !== undefined && dim !== '2d' && dim !== '3d') ctx.warn('meta.dimension', `invalid value ${JSON.stringify(dim)}; using "2d"`);
  const meta: ObwDocument['meta'] = {
    title: ctx.str(metaRaw, 'title', 'Untitled Project', 'meta') || 'Untitled Project',
    created: ctx.str(metaRaw, 'created', now, 'meta'),
    modified: ctx.str(metaRaw, 'modified', now, 'meta'),
    appVersion: ctx.str(metaRaw, 'appVersion', APP_VERSION, 'meta'),
    dimension: dim === '3d' ? '3d' : '2d'
  };
  const description = ctx.optStr(metaRaw, 'description', 'meta');
  const author = ctx.optStr(metaRaw, 'author', 'meta');
  if (description !== undefined) meta.description = description;
  if (author !== undefined) meta.author = author;

  const ids = new Set<string>();
  const optics = parseOptics(m.optics, ctx, ids);
  const circuit = parseCircuit(m.circuit, ctx, ids);
  const links = parseLinks(m.links, ctx, optics, circuit);
  const view = parseView(m.view, ctx);

  return {
    doc: { format: FILE_MAGIC, version: FORMAT_VERSION, meta, optics, circuit, links, view },
    warnings: ctx.warnings
  };
}

/** Base name without extension, for window titles. */
export function displayNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(new RegExp(`\\.${FILE_EXTENSION}$`, 'i'), '');
}
