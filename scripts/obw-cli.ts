/**
 * obw — Optibench Workstation project tool (generator / validator / headless simulator).
 *
 * Run through the launcher (bundles this file with rolldown, then calls `main`):
 *
 *   node scripts/obw.mjs help
 *   node scripts/obw.mjs validate examples/05-blinking-led-555.obw [--nets]
 *   node scripts/obw.mjs simulate examples/05-blinking-led-555.obw --seconds 2 [--dt 0.001] [--verbose]
 *   node scripts/obw.mjs trace examples/01-prism-rainbow.obw [--wl 550] [--per 3]
 *   node scripts/obw.mjs list-components [optics|circuit] [--md]
 *   node scripts/obw.mjs pins ic.555 [rotation 0..3] [--mirror]
 *   node scripts/obw.mjs new my-project.obw "My Project" [--force]
 *   node scripts/obw.mjs frame my-project.obw        (re-frames the view state and rewrites the file)
 *
 * Everything is also exported for tests (tests/examples.test.ts imports this module directly). It is named obw-cli.ts, not obw.ts,
 * so that '../scripts/obw' imports cannot resolve to the obw.mjs launcher by accident.
 * Pure engine code only — no Electron, no DOM.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CoSimulator } from '../src/core/cosim';
import {
  buildNetlist, circuitEngine, createSimulatorWithOptions, getPinPositions, registryMap, transformOffset,
} from '../src/core/circuit/index';
import { REGISTRY as OPTICS_REGISTRY, componentTimeTransmission, opticsEngine, sourceTemporalEnvelope } from '../src/core/optics/index';
import { createEmptyDocument, parseDocument, serializeDocument } from '../src/core/project/index';
import type {
  CircuitComponent, CircuitComponentDef, CircuitEngineAPI, CircuitState, ComponentDef, DetectorReading, ObwDocument,
  OpticalComponent, ParamDef, ParamValue, TraceResult, Vec2, ViewState,
} from '../src/core/types';

// =============================================================================================
// Registry helpers
// =============================================================================================

const OPTICS_BY_TYPE = new Map<string, ComponentDef>(OPTICS_REGISTRY.map((d) => [d.type, d]));
export const opticsDef = (type: string): ComponentDef | undefined => OPTICS_BY_TYPE.get(type);
export const circuitDef = (type: string): CircuitComponentDef | undefined => registryMap.get(type);

function pinDefsOf(def: CircuitComponentDef, props: Record<string, ParamValue> = {}) {
  return typeof def.pins === 'function' ? def.pins(props) : def.pins;
}

/** Circuit engine whose simulators never drop simulated time (no wall-clock budget). */
export const offlineCircuitEngine: CircuitEngineAPI = {
  ...circuitEngine,
  createSimulator: (scene) => createSimulatorWithOptions(scene, { wallBudgetMs: Infinity }),
};

/** Optional pins that may legitimately be left unconnected (reported as info, not warnings). */
const OPTIONAL_PINS: Record<string, string[]> = {
  'ic.555': ['CTRL', 'RESET'],
  'display.7seg': ['dp'],
  'display.matrix': ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
  'digital.counter': ['RST', 'Q0', 'Q1', 'Q2', 'Q3'],
  'digital.bcd7seg': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  'passive.potentiometer': ['A', 'B', 'W'],
  'passive.transformer': [],
  'switch.spdt': ['A', 'B'],
  'switch.relay': ['NO', 'NC', 'COM'],
  'osc.crystal': ['VCC', 'GND'],
  'ic.opamp': ['V+', 'V-'],
  'ic.comparator': ['V+', 'V-'],
  'ic.shift595': ['OE', 'SRCLR', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q7S'],
  'ic.decoder138': ['G1', 'G2A', 'G2B', 'Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7'],
  'ic.hbridge': ['EN'],
};

const fmtNum = (v: number, digits = 4): string => {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-12) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(digits - 1);
  return String(Number(v.toPrecision(digits)));
};

/** Engineering-notation formatter with SI prefixes. */
export function si(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return `${v} ${unit}`;
  if (Math.abs(v) < 1e-15) return `0 ${unit}`;
  const pre: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  const a = Math.abs(v);
  for (const [f, p] of pre) if (a >= f * 0.9995) return `${Number((v / f).toPrecision(digits))} ${p}${unit}`;
  return `${v.toExponential(digits - 1)} ${unit}`;
}

// =============================================================================================
// Geometry helpers (bounds for framing / overlap checks)
// =============================================================================================

interface Box { minx: number; miny: number; maxx: number; maxy: number }
const emptyBox = (): Box => ({ minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity });
const growBox = (b: Box, p: Vec2): void => {
  b.minx = Math.min(b.minx, p.x); b.miny = Math.min(b.miny, p.y);
  b.maxx = Math.max(b.maxx, p.x); b.maxy = Math.max(b.maxy, p.y);
};
const boxValid = (b: Box): boolean => Number.isFinite(b.minx) && b.maxx >= b.minx;
const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx)) * Math.max(0, Math.min(a.maxy, b.maxy) - Math.max(a.miny, b.miny));
const area = (b: Box): number => Math.max(0, b.maxx - b.minx) * Math.max(0, b.maxy - b.miny);

export function opticsBounds(c: OpticalComponent): Box | null {
  try {
    const g = opticsEngine.getGeometry(c);
    return { minx: g.bounds.min.x, miny: g.bounds.min.y, maxx: g.bounds.max.x, maxy: g.bounds.max.y };
  } catch {
    return null;
  }
}

/** Footprint of a circuit component in world grid units (from the registry `size`, rotated). */
export function circuitBounds(c: CircuitComponent): Box | null {
  const def = circuitDef(c.type);
  if (!def) return null;
  const s = def.size;
  const b = emptyBox();
  for (const [x, y] of [[s.ox, s.oy], [s.ox + s.w, s.oy], [s.ox, s.oy + s.h], [s.ox + s.w, s.oy + s.h]]) {
    const o = transformOffset({ x, y }, c.rotation ?? 0, c.mirrored);
    growBox(b, { x: c.position.x + o.x, y: c.position.y + o.y });
  }
  return b;
}

/** View states that frame the content of each tab (assumes a ~900×560 px viewport). */
export function frameView(doc: ObwDocument): { optics: ViewState; circuit: ViewState } {
  const ob = emptyBox();
  for (const c of doc.optics.components) {
    const b = opticsBounds(c);
    if (b) { growBox(ob, { x: b.minx, y: b.miny }); growBox(ob, { x: b.maxx, y: b.maxy }); }
  }
  const cb = emptyBox();
  for (const c of doc.circuit.components) {
    const b = circuitBounds(c);
    if (b) { growBox(cb, { x: b.minx, y: b.miny }); growBox(cb, { x: b.maxx, y: b.maxy }); }
  }
  for (const w of doc.circuit.wires) for (const p of w.points) growBox(cb, p);
  const fit = (b: Box, W: number, H: number, pad: number, zmin: number, zmax: number, def: ViewState): ViewState => {
    if (!boxValid(b)) return def;
    const w = b.maxx - b.minx + 2 * pad, h = b.maxy - b.miny + 2 * pad;
    const zoom = Math.min(zmax, Math.max(zmin, Math.min(W / Math.max(w, 1e-6), H / Math.max(h, 1e-6))));
    const r = (v: number) => Math.round(v * 100) / 100;
    return { cx: r((b.minx + b.maxx) / 2), cy: r((b.miny + b.maxy) / 2), zoom: r(zoom) };
  };
  return {
    optics: fit(ob, 900, 560, 25, 0.2, 40, { cx: 0, cy: 0, zoom: 2 }),
    circuit: fit(cb, 900, 560, 3, 4, 60, { cx: 0, cy: 0, zoom: 20 }),
  };
}

// =============================================================================================
// Validation
// =============================================================================================

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  info: string[];
  /** net id -> list of `${componentLabel}:${pin}` (for --nets). */
  nets: Record<string, string[]>;
}

const label = (c: { id: string; name?: string; type: string }) => (c.name ? `${c.name} (${c.id})` : c.id);

function checkParams(where: string, defs: ParamDef[], props: Record<string, ParamValue>, rep: ValidationReport): void {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(props)) {
    const d = byKey.get(k);
    if (!d) { rep.warnings.push(`${where}: unknown prop "${k}" (ignored by the engine). Known: ${defs.map((p) => p.key).join(', ') || '(none)'}`); continue; }
    switch (d.kind) {
      case 'number':
      case 'wavelength':
        if (typeof v !== 'number' || !Number.isFinite(v)) { rep.errors.push(`${where}: prop "${k}" must be a number, got ${JSON.stringify(v)}`); break; }
        if (d.min !== undefined && v < d.min) rep.errors.push(`${where}: prop "${k}" = ${v} below minimum ${d.min}${d.unit ? ' ' + d.unit : ''}`);
        if (d.max !== undefined && v > d.max) rep.errors.push(`${where}: prop "${k}" = ${v} above maximum ${d.max}${d.unit ? ' ' + d.unit : ''}`);
        break;
      case 'boolean':
        if (typeof v !== 'boolean') rep.errors.push(`${where}: prop "${k}" must be true/false, got ${JSON.stringify(v)}`);
        break;
      case 'select':
        if (!d.options?.some((o) => o.value === v)) rep.errors.push(`${where}: prop "${k}" = ${JSON.stringify(v)} is not one of ${d.options?.map((o) => o.value).join(' | ')}`);
        break;
      case 'string':
      case 'color':
        if (typeof v !== 'string') rep.errors.push(`${where}: prop "${k}" must be a string, got ${JSON.stringify(v)}`);
        break;
    }
  }
}

const ptKey = (p: Vec2) => `${p.x},${p.y}`;
function onSegmentInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  const inside = p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  return inside && ptKey(p) !== ptKey(a) && ptKey(p) !== ptKey(b);
}

const EMITTER_CIRCUIT = new Set(['opto.laser_diode', 'semi.led']);
const DETECTOR_CIRCUIT = new Set(['opto.photodiode', 'opto.ldr', 'opto.solar_cell']);

/** Full semantic validation of a parsed document (parse warnings are added by `validateText`). */
export function validateDocument(doc: ObwDocument): ValidationReport {
  const rep: ValidationReport = { errors: [], warnings: [], info: [], nets: {} };

  // ---------------------------------------------------------------- meta
  if (!doc.meta.title || doc.meta.title === 'Untitled Project') rep.warnings.push('meta.title: give the project a descriptive title');
  if (!doc.meta.description) rep.info.push('meta.description: empty (a one-paragraph description helps users)');

  // ---------------------------------------------------------------- optics
  const oBoxes: { c: OpticalComponent; b: Box }[] = [];
  for (const c of doc.optics.components) {
    const where = `optics ${label(c)} [${c.type}]`;
    const def = opticsDef(c.type);
    if (!def) { rep.errors.push(`${where}: unknown optics type. Run \`list-components optics\``); continue; }
    checkParams(where, def.params, c.props, rep);
    if (!Number.isFinite(c.rotation)) rep.errors.push(`${where}: rotation must be a finite number (radians)`);
    else if (Math.abs(c.rotation) > 2 * Math.PI + 1e-9) rep.warnings.push(`${where}: rotation ${c.rotation} rad — rotation is in RADIANS (did you pass degrees?)`);
    const b = opticsBounds(c);
    if (!b) rep.errors.push(`${where}: engine failed to build geometry`);
    else oBoxes.push({ c, b });
  }
  for (let i = 0; i < oBoxes.length; i++) {
    for (let j = i + 1; j < oBoxes.length; j++) {
      const A = oBoxes[i], B = oBoxes[j];
      if (A.c.type === 'field.gravity' || B.c.type === 'field.gravity' || A.c.type === 'fiber.cable' || B.c.type === 'fiber.cable') continue;
      const ov = overlapArea(A.b, B.b), small = Math.min(area(A.b), area(B.b));
      if (small > 0 && ov > 0.5 * small) rep.warnings.push(`optics: ${label(A.c)} and ${label(B.c)} overlap substantially (bounding boxes) — check spacing`);
    }
  }
  if (doc.optics.components.length && !doc.optics.components.some((c) => c.type.startsWith('source.')) &&
      !doc.links.some((l) => l.kind === 'emitter')) rep.warnings.push('optics: no light source');

  // ---------------------------------------------------------------- circuit
  const cs = doc.circuit;
  const comps = cs.components;
  const pinsAt = new Map<string, { comp: CircuitComponent; pin: string }[]>();
  const allPins: { comp: CircuitComponent; pin: string; p: Vec2 }[] = [];
  for (const c of comps) {
    const where = `circuit ${label(c)} [${c.type}]`;
    const def = circuitDef(c.type);
    if (!def) { rep.errors.push(`${where}: unknown circuit type. Run \`list-components circuit\``); continue; }
    checkParams(where, def.params, c.props, rep);
    if (!Number.isInteger(c.position.x) || !Number.isInteger(c.position.y)) rep.errors.push(`${where}: position must be integer grid coordinates`);
    for (const pp of getPinPositions(c)) {
      const k = ptKey(pp.p);
      if (!pinsAt.has(k)) pinsAt.set(k, []);
      pinsAt.get(k)!.push({ comp: c, pin: pp.name });
      allPins.push({ comp: c, pin: pp.name, p: pp.p });
    }
  }
  // bodies overlapping
  for (let i = 0; i < comps.length; i++) {
    const a = circuitBounds(comps[i]);
    if (!a) continue;
    for (let j = i + 1; j < comps.length; j++) {
      const b = circuitBounds(comps[j]);
      if (b && overlapArea(a, b) > 0.01) rep.warnings.push(`circuit: ${label(comps[i])} and ${label(comps[j])} footprints overlap — move them apart`);
    }
  }
  // pins sharing a point with a pin of another component (direct pin-to-pin contact)
  for (const [k, list] of pinsAt) {
    if (list.length > 1) {
      const names = list.map((e) => `${label(e.comp)}:${e.pin}`);
      if (new Set(list.map((e) => e.comp.id)).size > 1 && !list.every((e) => e.comp.type === 'misc.ground')) rep.info.push(`circuit: pins touch directly at (${k}): ${names.join(', ')}`);
      if (list.some((e, i) => list.findIndex((f) => f.comp.id === e.comp.id) !== i)) rep.errors.push(`circuit: two pins of the same component coincide at (${k}): ${names.join(', ')}`);
    }
  }
  // wires
  const vertexSet = new Set<string>();
  for (const w of cs.wires) for (const p of w.points) vertexSet.add(ptKey(p));
  for (const w of cs.wires) {
    const where = `circuit wire ${w.id}`;
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1], b = w.points[i];
      if (a.x === b.x && a.y === b.y) rep.warnings.push(`${where}: zero-length segment at (${ptKey(a)}) (duplicate vertex)`);
      else if (a.x !== b.x && a.y !== b.y) rep.warnings.push(`${where}: diagonal segment (${ptKey(a)})→(${ptKey(b)}); use orthogonal segments`);
      // pins lying on the segment interior do NOT connect
      for (const pin of allPins) {
        if (onSegmentInterior(pin.p, a, b)) {
          rep.errors.push(`${where}: passes over pin ${label(pin.comp)}:${pin.pin} at (${ptKey(pin.p)}) mid-segment — pins connect only at wire vertices. Add a vertex there if a connection is intended, otherwise reroute`);
        }
      }
    }
    // dangling ends
    for (const end of [w.points[0], w.points[w.points.length - 1]]) {
      const k = ptKey(end);
      if (pinsAt.has(k)) continue;
      let joined = false;
      for (const o of cs.wires) {
        if (o === w) {
          // a closed loop of itself or self-T
          const idx = o.points.map(ptKey);
          if (idx.filter((x) => x === k).length > 1) joined = true;
          continue;
        }
        if (o.points.some((p) => ptKey(p) === k)) { joined = true; break; }
        for (let i = 1; i < o.points.length; i++) if (onSegmentInterior(end, o.points[i - 1], o.points[i])) { joined = true; break; }
        if (joined) break;
      }
      if (!joined) rep.warnings.push(`${where}: end (${k}) is dangling (no pin or other wire there)`);
    }
  }
  // nets
  if (comps.length) {
    const nl = buildNetlist(cs);
    const byNet = new Map<string, string[]>();
    for (const c of comps) {
      const def = circuitDef(c.type);
      if (!def) continue;
      for (const pd of pinDefsOf(def, c.props)) {
        const net = nl.pinNets[`${c.id}:${pd.name}`];
        if (!byNet.has(net)) byNet.set(net, []);
        byNet.get(net)!.push(`${c.name ?? c.id}:${pd.name}`);
      }
    }
    for (const [net, pins] of byNet) rep.nets[net] = pins;
    for (const c of comps) {
      const def = circuitDef(c.type);
      if (!def || c.type === 'misc.ground') continue;
      for (const pd of pinDefsOf(def, c.props)) {
        const net = nl.pinNets[`${c.id}:${pd.name}`];
        if (net === 'GND') continue;
        if ((byNet.get(net)?.length ?? 0) <= 1) {
          const optional = OPTIONAL_PINS[c.type]?.includes(pd.name);
          (optional ? rep.info : rep.warnings).push(`circuit ${label(c)} [${c.type}]: pin ${pd.name} is floating (connected to nothing)`);
        }
      }
    }
    if (!nl.hasGround) rep.warnings.push('circuit: no misc.ground symbol — add one (digital parts and probes are referenced to ground)');
    // two-terminal parts shorted (both pins on one net)
    for (const c of comps) {
      const def = circuitDef(c.type);
      if (!def) continue;
      const pd = pinDefsOf(def, c.props);
      if (pd.length === 2 && c.type !== 'misc.ground') {
        const a = nl.pinNets[`${c.id}:${pd[0].name}`], b = nl.pinNets[`${c.id}:${pd[1].name}`];
        if (a === b) rep.warnings.push(`circuit ${label(c)} [${c.type}]: both pins on the same net (${a}) — shorted`);
      }
    }
  }

  // ---------------------------------------------------------------- links
  const oById = new Map(doc.optics.components.map((c) => [c.id, c]));
  const cById = new Map(comps.map((c) => [c.id, c]));
  for (const l of doc.links) {
    const where = `link ${l.id} (${l.kind})`;
    const o = oById.get(l.opticsId), c = cById.get(l.circuitId);
    if (!o) { rep.errors.push(`${where}: opticsId "${l.opticsId}" not found`); continue; }
    if (!c) { rep.errors.push(`${where}: circuitId "${l.circuitId}" not found`); continue; }
    if (l.kind === 'emitter') {
      if (!o.type.startsWith('source.')) rep.errors.push(`${where}: optics side must be a source.* (got ${o.type})`);
      if (!EMITTER_CIRCUIT.has(c.type)) rep.errors.push(`${where}: circuit side must be opto.laser_diode or semi.led (got ${c.type})`);
      const nominal = o.props.power ?? opticsDef(o.type)?.params.find((p) => p.key === 'power')?.default;
      rep.info.push(`${where}: optics power = circuit opticalPower (W); source nominal power ${nominal} W only sets the scale`);
      if (o.props.power === undefined) rep.warnings.push(`${where}: set ${o.id}.props.power explicitly (the bridge uses the document value as the nominal power; a missing value falls back to 1 mW)`);
    } else if (l.kind === 'detector') {
      if (!o.type.startsWith('detector.')) rep.errors.push(`${where}: optics side must be a detector.* (got ${o.type})`);
      if (!DETECTOR_CIRCUIT.has(c.type)) rep.errors.push(`${where}: circuit side must be opto.photodiode / opto.ldr / opto.solar_cell (got ${c.type})`);
    } else {
      const tp = l.targetProp || 'bField';
      const pd = opticsDef(o.type)?.params.find((p) => p.key === tp);
      if (tp === 'rotation') {
        // special target: the co-simulator turns the optical component itself (degrees = gain * quantity + offset)
        rep.info.push(`${where}: drives the rotation of ${o.id} (degrees = ${l.gain ?? 1} x ${l.source ?? 'default quantity'} + ${l.offset ?? 0})`);
      } else if (!pd) rep.errors.push(`${where}: targetProp "${tp}" is not a param of ${o.type} (${opticsDef(o.type)?.params.map((p) => p.key).join(', ')})`);
      else if (pd.kind !== 'number' && pd.kind !== 'wavelength') rep.errors.push(`${where}: targetProp "${tp}" is not numeric`);
    }
  }

  // ---------------------------------------------------------------- view framing
  const fv = frameView(doc);
  const check = (tab: 'optics' | 'circuit', has: boolean) => {
    const v = doc.view?.[tab];
    if (!has || !v) return;
    const f = fv[tab];
    const scale = 900 / f.zoom;
    if (Math.abs(v.cx - f.cx) > scale / 3 || Math.abs(v.cy - f.cy) > scale / 4 || v.zoom > f.zoom * 2.5 || v.zoom < f.zoom / 4) {
      rep.warnings.push(`view.${tab} does not frame the content; suggested ${JSON.stringify(f)} (run \`frame\`)`);
    }
  };
  check('optics', doc.optics.components.length > 0);
  check('circuit', comps.length > 0);
  return rep;
}

/** Parse + validate text. Parse warnings become validation warnings (they mean the file was "repaired"). */
export function validateText(text: string): { doc: ObwDocument | null; report: ValidationReport } {
  try {
    const { doc, warnings } = parseDocument(text);
    const report = validateDocument(doc);
    report.warnings.unshift(...warnings.map((w) => `parse: ${w}`));
    return { doc, report };
  } catch (e) {
    return { doc: null, report: { errors: [`parse: ${(e as Error).message}`], warnings: [], info: [], nets: {} } };
  }
}

// =============================================================================================
// Headless co-simulation
// =============================================================================================

class Stat {
  n = 0; min = Infinity; max = -Infinity; sum = 0;
  add(v: number) { if (!Number.isFinite(v)) return; this.n++; this.sum += v; if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
  get mean() { return this.n ? this.sum / this.n : NaN; }
}

/** Counts edges of a boolean/threshold signal. */
class Edges {
  last: boolean | null = null; rises = 0; falls = 0; highTicks = 0; ticks = 0; firstRise = NaN; lastRise = NaN;
  add(b: boolean, t: number) {
    this.ticks++;
    if (b) this.highTicks++;
    if (this.last !== null && b !== this.last) {
      if (b) { this.rises++; if (Number.isNaN(this.firstRise)) this.firstRise = t; this.lastRise = t; } else this.falls++;
    }
    this.last = b;
  }
  /** Frequency estimate from rising edges (Hz). */
  get freq() { return this.rises >= 2 ? (this.rises - 1) / (this.lastRise - this.firstRise) : NaN; }
  get duty() { return this.ticks ? this.highTicks / this.ticks : NaN; }
}

const SEG_TABLE = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const SEG_CHARS: Record<number, string> = { 0x77: 'A', 0x7c: 'b', 0x39: 'C', 0x5e: 'd', 0x79: 'E', 0x71: 'F', 0x40: '-' };
/** Decode a 7-segment brightness array (a..g, dp) into a character ('' = blank, '?' = unknown pattern). */
export function decode7seg(segments: number[] | undefined, threshold = 0.3): string {
  if (!segments) return '';
  let mask = 0;
  for (let i = 0; i < 7; i++) if ((segments[i] ?? 0) > threshold) mask |= 1 << i;
  if (mask === 0) return '';
  const d = SEG_TABLE.indexOf(mask);
  if (d >= 0) return String(d);
  return SEG_CHARS[mask] ?? '?';
}

export interface ComponentSim {
  id: string;
  name?: string;
  type: string;
  /** numeric state key -> stats. */
  stats: Record<string, { min: number; max: number; mean: number }>;
  /** boolean state key -> edges. */
  edges: Record<string, { rises: number; falls: number; duty: number; freq: number }>;
  /** 7-seg: decoded characters in order of appearance (consecutive duplicates removed). */
  digits?: string[];
  /** Matrix: mean brightness per cell (row-major 64). */
  matrixMean?: number[];
  /** Matrix: brightness per cell at the end of the run. */
  matrixFinal?: number[];
  /** Probe: frequency estimated from mid-level crossings of the voltage. */
  freq?: number;
  /** Probe: voltage stats over the last 25 % of the run (steady state, after start-up transients). */
  tail?: { min: number; max: number; mean: number };
  /** Distinct values seen for discrete keys (counter count, bcd value, region...). */
  values?: Record<string, (string | number)[]>;
  final: Record<string, unknown>;
}

export interface DetectorSim {
  id: string;
  name?: string;
  type: string;
  power: { min: number; max: number; mean: number; final: number };
  /** Spectrometer: final spectrum, range, peak wavelength, band powers. */
  spectrum?: { range: [number, number]; bins: number[]; peakNm: number; centroidNm: number; bands: Record<string, number> };
  /** Screen: hit count, extent along the screen (local), wavelength ordering. */
  screen?: { hits: number; profile: number[]; wavelengthSpan: [number, number] | null; spreadMm: number; centerMm: number; rmsMm: number; colorOrder?: string };
}

export interface SimulationReport {
  seconds: number;
  dt: number;
  simulatedTime: number;
  ticks: number;
  nonConvergedTicks: number;
  errors: string[];
  traces: number;
  traceStats: { rays: number; segments: number; ms: number } | null;
  energy?: { emitted: number; detected: number; absorbed: number; escaped: number; dropped: number };
  components: ComponentSim[];
  detectors: DetectorSim[];
  /** Time series sampled every tick: t, plus selected quantities (for tests). */
  series: { t: number[]; [key: string]: number[] };
  lastTrace: TraceResult | null;
}

export interface SimOptions {
  seconds?: number;
  dt?: number;
  /** Extra series to record: `${componentId}.${stateKey}` for circuit, `det:${opticsId}` for detector power. */
  record?: string[];
  /** Interactions to apply at given times. */
  actions?: { t: number; id: string; action: 'toggle' | 'press' | 'release' | { set: number } }[];
}

const DISCRETE_KEYS = new Set(['count', 'value', 'region', 'mode', 'position', 'text']);

export function simulateDocument(doc: ObwDocument, opts: SimOptions = {}): SimulationReport {
  const seconds = opts.seconds ?? 0.5;
  const dt = opts.dt ?? 1e-3;
  let virtualMs = 0;
  const co = new CoSimulator(doc, opticsEngine, offlineCircuitEngine, {
    now: () => virtualMs, opticsInterval: Math.max(1, dt * 1000),
    temporal: { sourceTemporalEnvelope, componentTimeTransmission }, // pulsed / modulated lasers, chopper wheels
  });
  const errors = new Set<string>();
  if (co.error) errors.add(co.error);

  const compStats = new Map<string, { stats: Map<string, Stat>; edges: Map<string, Edges>; values: Map<string, (string | number)[]>; digits: string[]; matrix?: number[]; vEdges?: Edges }>();
  for (const c of doc.circuit.components) compStats.set(c.id, { stats: new Map(), edges: new Map(), values: new Map(), digits: [] });
  const detIds = doc.optics.components.filter((c) => c.type.startsWith('detector.'));
  const detStats = new Map(detIds.map((d) => [d.id, new Stat()]));
  const series: SimulationReport['series'] = { t: [] };
  for (const r of opts.record ?? []) series[r] = [];

  // pass 1: probe min/max to set crossing thresholds -> do one simulation, recording voltage samples
  const probeSamples = new Map<string, number[]>();
  for (const c of doc.circuit.components) if (c.type === 'meter.probe') probeSamples.set(c.id, []);

  const actions = [...(opts.actions ?? [])].sort((a, b) => a.t - b.t);
  let ai = 0;
  let traces = 0, nonConv = 0, ticks = 0;
  let last: CircuitState | null = null;
  const n = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < n; i++) {
    while (ai < actions.length && actions[ai].t <= i * dt + 1e-12) { co.interact(actions[ai].id, actions[ai].action); ai++; }
    virtualMs += dt * 1000;
    const tick = co.tick(dt);
    ticks++;
    if (tick.trace) traces++;
    const st = tick.circuit;
    last = st;
    if (!st.converged) nonConv++;
    if (st.error) errors.add(st.error);
    if (co.error) errors.add(co.error);
    const t = st.time || (i + 1) * dt;
    series.t.push(t);
    for (const c of doc.circuit.components) {
      const s = st.components[c.id];
      const acc = compStats.get(c.id)!;
      if (!s) continue;
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'number') {
          if (!acc.stats.has(k)) acc.stats.set(k, new Stat());
          acc.stats.get(k)!.add(v);
        } else if (typeof v === 'boolean') {
          if (!acc.edges.has(k)) acc.edges.set(k, new Edges());
          acc.edges.get(k)!.add(v, t);
        }
        if (DISCRETE_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string') && !(c.type === 'meter.probe' || c.type.startsWith('meter.')) && !(k === 'text' && c.type !== 'digital.counter' && c.type !== 'digital.bcd7seg')) {
          if (!acc.values.has(k)) acc.values.set(k, []);
          const arr = acc.values.get(k)!;
          if (arr[arr.length - 1] !== v && arr.length < 200) arr.push(v);
        }
      }
      if (c.type === 'display.7seg') {
        const d = decode7seg(s.segments);
        if (acc.digits[acc.digits.length - 1] !== d && acc.digits.length < 500) acc.digits.push(d);
      }
      if (c.type === 'display.matrix' && Array.isArray(s.segments)) {
        acc.matrix ??= new Array(64).fill(0);
        for (let k = 0; k < 64; k++) acc.matrix[k] += (s.segments[k] ?? 0);
      }
      if (c.type === 'meter.probe' && typeof s.voltage === 'number') probeSamples.get(c.id)!.push(s.voltage);
    }
    const tr = co.lastTrace;
    for (const d of detIds) detStats.get(d.id)!.add(tr?.detectors?.[d.id]?.power ?? 0);
    for (const r of opts.record ?? []) {
      if (r.startsWith('det:')) series[r].push(tr?.detectors?.[r.slice(4)]?.power ?? 0);
      else {
        const dot = r.indexOf('.');
        const id = r.slice(0, dot), key = r.slice(dot + 1);
        const v = st.components[id]?.[key];
        series[r].push(typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
      }
    }
  }

  const components: ComponentSim[] = doc.circuit.components.map((c) => {
    const acc = compStats.get(c.id)!;
    const stats: ComponentSim['stats'] = {};
    for (const [k, s] of acc.stats) stats[k] = { min: s.min, max: s.max, mean: s.mean };
    const edges: ComponentSim['edges'] = {};
    for (const [k, e] of acc.edges) edges[k] = { rises: e.rises, falls: e.falls, duty: e.duty, freq: e.freq };
    const out: ComponentSim = { id: c.id, name: c.name, type: c.type, stats, edges, final: {} };
    const fin = last?.components[c.id];
    if (fin) for (const [k, v] of Object.entries(fin)) if (k !== 'history' && k !== 'segments') out.final[k] = v;
    if (c.type === 'display.7seg') out.digits = acc.digits;
    if (acc.matrix) out.matrixMean = acc.matrix.map((v) => v / Math.max(1, ticks));
    if (c.type === 'display.matrix' && Array.isArray(fin?.segments)) out.matrixFinal = (fin!.segments as number[]).slice();
    if (acc.values.size) { out.values = {}; for (const [k, v] of acc.values) out.values[k] = v; }
    const ps = probeSamples.get(c.id);
    if (ps && ps.length > 4) {
      const ts = new Stat();
      for (const v of ps.slice(Math.floor(ps.length * 0.75))) ts.add(v);
      out.tail = { min: ts.min, max: ts.max, mean: ts.mean };
      let mn = Infinity, mx = -Infinity;
      for (const v of ps) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      if (mx - mn > 1e-3 * Math.max(1, Math.abs(mx))) {
        const mid = (mn + mx) / 2, hyst = (mx - mn) * 0.1;
        const e = new Edges();
        let state = ps[0] > mid;
        ps.forEach((v, i) => { if (state && v < mid - hyst) state = false; else if (!state && v > mid + hyst) state = true; e.add(state, (i + 1) * dt); });
        out.freq = e.freq;
      }
    }
    return out;
  });

  const tr = co.lastTrace as (TraceResult & { energy?: SimulationReport['energy'] }) | null;
  const detectors: DetectorSim[] = detIds.map((d) => {
    const s = detStats.get(d.id)!;
    const r: DetectorReading | undefined = tr?.detectors?.[d.id];
    const out: DetectorSim = { id: d.id, name: d.name, type: d.type, power: { min: s.min, max: s.max, mean: s.mean, final: r?.power ?? 0 } };
    if (r?.spectrum && r.spectrumRange) {
      const [a, b] = r.spectrumRange;
      const nb = r.spectrum.length, w = (b - a) / nb;
      let pk = 0, tot = 0, cen = 0;
      const bands: Record<string, number> = { 'violet <450': 0, 'blue 450-495': 0, 'green 495-570': 0, 'yellow-orange 570-620': 0, 'red >620': 0 };
      r.spectrum.forEach((p, i) => {
        const nm = a + (i + 0.5) * w;
        if (p > r.spectrum![pk]) pk = i;
        tot += p; cen += p * nm;
        const k = nm < 450 ? 'violet <450' : nm < 495 ? 'blue 450-495' : nm < 570 ? 'green 495-570' : nm < 620 ? 'yellow-orange 570-620' : 'red >620';
        bands[k] += p;
      });
      out.spectrum = { range: [a, b], bins: r.spectrum, peakNm: a + (pk + 0.5) * w, centroidNm: tot > 0 ? cen / tot : NaN, bands };
    }
    if (d.type === 'detector.screen' && r) {
      const hits = r.hits ?? [];
      let wl0 = Infinity, wl1 = -Infinity;
      // position along the screen face: project on local y axis
      const c = Math.cos(d.rotation), sn = Math.sin(d.rotation);
      const along = (p: Vec2) => -(p.x - d.position.x) * sn + (p.y - d.position.y) * c;
      let a0 = Infinity, a1 = -Infinity;
      for (const h of hits) { wl0 = Math.min(wl0, h.wavelength); wl1 = Math.max(wl1, h.wavelength); const u = along(h.p); a0 = Math.min(a0, u); a1 = Math.max(a1, u); }
      let pw = 0, m1 = 0, m2 = 0;
      for (const h of hits) { const u = along(h.p); pw += h.power; m1 += h.power * u; m2 += h.power * u * u; }
      const centerMm = pw > 0 ? m1 / pw : 0, rmsMm = pw > 0 ? Math.sqrt(Math.max(0, m2 / pw - centerMm * centerMm)) : 0;
      let colorOrder: string | undefined;
      if (hits.length > 2 && wl1 - wl0 > 50) {
        const blue = hits.filter((h) => h.wavelength < 480), red = hits.filter((h) => h.wavelength > 620);
        if (blue.length && red.length) {
          const mb = blue.reduce((s, h) => s + along(h.p), 0) / blue.length, mr = red.reduce((s, h) => s + along(h.p), 0) / red.length;
          colorOrder = `red at local y≈${fmtNum(mr, 3)} mm, blue at local y≈${fmtNum(mb, 3)} mm (separation ${fmtNum(Math.abs(mr - mb), 3)} mm)`;
        }
      }
      out.screen = { hits: hits.length, profile: r.profile ?? [], wavelengthSpan: hits.length ? [wl0, wl1] : null, spreadMm: hits.length ? a1 - a0 : 0, centerMm, rmsMm, colorOrder };
    }
    return out;
  });

  return {
    seconds, dt, simulatedTime: last?.time ?? 0, ticks, nonConvergedTicks: nonConv, errors: [...errors], traces,
    traceStats: tr?.stats ?? null, energy: tr?.energy, components, detectors, series, lastTrace: tr,
  };
}

// =============================================================================================
// Text reports
// =============================================================================================

const KEY_METRICS: Record<string, string[]> = {
  'semi.led': ['brightness', 'current', 'opticalPower'],
  'opto.laser_diode': ['current', 'opticalPower'],
  'opto.photodiode': ['opticalPower', 'photocurrent', 'voltage', 'current'],
  'opto.ldr': ['opticalPower', 'resistance'],
  'opto.solar_cell': ['opticalPower', 'photocurrent', 'current', 'voltage'],
  'opto.coil': ['current', 'bField'],
  'meter.probe': ['voltage'],
  'meter.voltmeter': ['value'],
  'meter.ammeter': ['value'],
  'ic.555': ['voltage'],
  'semi.npn': ['ic', 'ib', 'vce'],
  'semi.pnp': ['ic', 'ib', 'vce'],
  'semi.nmos': ['id', 'vgs', 'vds'],
  'semi.pmos': ['id', 'vgs', 'vds'],
  'passive.capacitor': ['voltage', 'current'],
  'passive.resistor': ['current', 'power'],
  'passive.transformer': ['voltage', 'secondaryVoltage', 'secondaryCurrent'],
  'semi.diode': ['current'],
  'misc.lamp': ['brightness'],
  'display.7seg': ['current'],
  'display.matrix': ['current'],
  'source.ac': ['current'],
  'source.function_gen': ['voltage', 'current'],
  'source.psu': ['current'],
  'source.battery': ['current', 'chargePercent'],
};
const UNITS: Record<string, string> = {
  current: 'A', voltage: 'V', power: 'W', opticalPower: 'W', photocurrent: 'A', bField: 'T', resistance: 'Ω', ic: 'A', ib: 'A', vce: 'V',
  id: 'A', vgs: 'V', vds: 'V', secondaryVoltage: 'V', secondaryCurrent: 'A', value: '', brightness: '', chargePercent: '%',
};
const BORING_TYPES = new Set(['misc.ground']);

function matrixArt(cells: number[]): string[] {
  const ch = (v: number) => (v > 0.6 ? '█' : v > 0.3 ? '▓' : v > 0.1 ? '▒' : v > 0.02 ? '░' : '·');
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) rows.push(cells.slice(r * 8, r * 8 + 8).map(ch).join(' '));
  return rows;
}

export function formatSimulation(rep: SimulationReport, verbose = false): string {
  const L: string[] = [];
  L.push(`Simulated ${fmtNum(rep.simulatedTime)} s of ${rep.seconds} s in ${rep.ticks} ticks of ${si(rep.dt, 's')}; optics traces: ${rep.traces}`);
  L.push(rep.nonConvergedTicks ? `!! circuit did not converge on ${rep.nonConvergedTicks} tick(s)` : 'Circuit convergence: OK on every tick');
  for (const e of rep.errors) L.push(`!! ${e}`);
  if (rep.traceStats) {
    L.push(`Last trace: ${rep.traceStats.rays} rays, ${rep.traceStats.segments} segments, ${fmtNum(rep.traceStats.ms, 3)} ms`);
    const e = rep.energy;
    if (e && e.emitted > 0) L.push(`  energy: emitted ${si(e.emitted, 'W')} | detected ${(100 * e.detected / e.emitted).toFixed(1)} % | absorbed ${(100 * e.absorbed / e.emitted).toFixed(1)} % | escaped ${(100 * e.escaped / e.emitted).toFixed(1)} % | dropped ${(100 * e.dropped / e.emitted).toFixed(1)} %`);
  }
  if (rep.detectors.length) {
    L.push('', 'OPTICAL DETECTORS');
    for (const d of rep.detectors) {
      const p = d.power;
      const vary = p.max - p.min > 1e-3 * Math.max(p.max, 1e-15);
      L.push(`  ${d.name ?? d.id} [${d.type}]: ${si(p.final, 'W')} final` + (vary ? ` (min ${si(p.min, 'W')}, max ${si(p.max, 'W')}, mean ${si(p.mean, 'W')})` : ''));
      if (d.spectrum) {
        const s = d.spectrum;
        L.push(`    spectrum ${s.range[0]}–${s.range[1]} nm, ${s.bins.length} bins: peak ${fmtNum(s.peakNm, 4)} nm, centroid ${fmtNum(s.centroidNm, 4)} nm`);
        L.push('    bands: ' + Object.entries(s.bands).map(([k, v]) => `${k}: ${si(v, 'W')}`).join(' | '));
      }
      if (d.screen) {
        const s = d.screen;
        L.push(`    screen: ${s.hits} hits, full spread ${fmtNum(s.spreadMm, 3)} mm, power-weighted centre ${fmtNum(s.centerMm, 3)} mm / RMS width ${fmtNum(s.rmsMm, 3)} mm (along the screen)` + (s.wavelengthSpan ? `, λ ${fmtNum(s.wavelengthSpan[0], 4)}–${fmtNum(s.wavelengthSpan[1], 4)} nm` : ''));
        if (s.colorOrder) L.push(`    ${s.colorOrder}`);
      }
    }
  }
  if (rep.components.length) {
    L.push('', 'CIRCUIT');
    for (const c of rep.components) {
      if (BORING_TYPES.has(c.type)) continue;
      const keys = verbose ? Object.keys(c.stats) : (KEY_METRICS[c.type] ?? (c.type.startsWith('digital.') ? [] : ['voltage', 'current'])).filter((k) => c.stats[k]);
      const parts: string[] = [];
      for (const k of keys) {
        const s = c.stats[k];
        const u = UNITS[k] ?? '';
        const fmt = (v: number) => (u ? si(v, u) : fmtNum(v, 3));
        parts.push(Math.abs(s.max - s.min) <= 1e-9 * Math.max(1, Math.abs(s.max)) ? `${k} ${fmt(s.max)}` : `${k} ${fmt(s.min)}…${fmt(s.max)} (mean ${fmt(s.mean)})`);
      }
      const on = c.edges.on;
      if (on && (on.rises || on.falls)) parts.push(`on/off: ${on.rises} rises, duty ${(on.duty * 100).toFixed(0)} %${Number.isFinite(on.freq) ? `, ≈${si(on.freq, 'Hz')}` : ''}`);
      else if (on) parts.push(on.duty > 0.5 ? 'on (steady)' : 'off (steady)');
      if (c.freq !== undefined && Number.isFinite(c.freq)) parts.push(`≈${si(c.freq, 'Hz')}`);
      if (c.tail) parts.push(`last 25 %: ${si(c.tail.min, 'V')}…${si(c.tail.max, 'V')} (p-p ${si(c.tail.max - c.tail.min, 'V')})`);
      if (c.digits) parts.push(`digits shown: ${c.digits.map((d) => (d === '' ? '·' : d)).join(' ')}`);
      if (c.values) for (const [k, v] of Object.entries(c.values)) if (k !== 'text' || verbose) parts.push(`${k}: ${v.slice(0, 40).join(' ')}${v.length > 40 ? ' …' : ''}`);
      if (c.final.text && (c.type.startsWith('meter.') || c.type === 'opto.coil' || c.type === 'source.battery')) parts.push(`reads "${c.final.text}"`);
      for (const flag of ['overdriven', 'overheating', 'overVoltage', 'reverseBiased', 'blown']) if (c.edges[flag] && (c.edges[flag].duty > 0)) parts.push(`!! ${flag} ${(c.edges[flag].duty * 100).toFixed(0)} % of the time`);
      if (c.final.region !== undefined && c.values?.region === undefined) parts.push(`region ${c.final.region}`);
      L.push(`  ${c.name ?? c.id} [${c.type}]: ${parts.join('; ') || '-'}`);
      if (c.matrixMean) {
        const a = matrixArt(c.matrixMean), f = c.matrixFinal ? matrixArt(c.matrixFinal) : [];
        L.push(`      ${'mean brightness'.padEnd(18)}  final frame`);
        a.forEach((row, i) => L.push(`      ${row.padEnd(18)}  ${f[i] ?? ''}`));
      }
    }
  }
  return L.join('\n');
}

export function formatValidation(rep: ValidationReport, showNets = false): string {
  const L: string[] = [];
  for (const e of rep.errors) L.push(`ERROR   ${e}`);
  for (const w of rep.warnings) L.push(`WARN    ${w}`);
  for (const i of rep.info) L.push(`info    ${i}`);
  if (showNets) {
    L.push('', 'NETS');
    for (const [net, pins] of Object.entries(rep.nets).sort()) L.push(`  ${net.padEnd(28)} ${pins.join(', ')}`);
  }
  L.push('', rep.errors.length ? `FAILED: ${rep.errors.length} error(s), ${rep.warnings.length} warning(s)` : `OK: 0 errors, ${rep.warnings.length} warning(s)`);
  return L.join('\n');
}

/**
 * Human-readable trace: per source and interaction depth, the strongest distinct segments.
 * `wl` keeps only the wavelength sample nearest to it (handy for broadband sources).
 */
export function formatTrace(doc: ObwDocument, tr: TraceResult, opts: { perDepth?: number; wl?: number; maxDepth?: number } = {}): string {
  const per = opts.perDepth ?? 3, maxDepth = opts.maxDepth ?? 12;
  const L: string[] = [];
  const name = new Map(doc.optics.components.map((c) => [c.id, c.name ?? c.id]));
  L.push(`${tr.stats.rays} rays, ${tr.segments.length} segments. Per interaction depth d: the ${per} strongest distinct segments` +
    (opts.wl !== undefined ? ` (λ nearest ${opts.wl} nm only)` : '') + '. dir = travel direction in screen degrees (0 = +x, 90 = +y/down).');
  const bySrc = new Map<string, typeof tr.segments>();
  for (const s of tr.segments) { if (!bySrc.has(s.sourceId)) bySrc.set(s.sourceId, []); bySrc.get(s.sourceId)!.push(s); }
  for (const [src, all] of bySrc) {
    let segs = all;
    const wls = [...new Set(all.map((s) => s.wavelength))].sort((a, b) => a - b);
    if (opts.wl !== undefined && wls.length) {
      const target = wls.reduce((b, w) => (Math.abs(w - opts.wl!) < Math.abs(b - opts.wl!) ? w : b), wls[0]);
      segs = all.filter((s) => s.wavelength === target);
    }
    L.push(`source ${name.get(src) ?? src}: ${all.length} segments, λ ${fmtNum(wls[0], 4)}${wls.length > 1 ? `–${fmtNum(wls[wls.length - 1], 4)} nm (${wls.length} samples)` : ' nm'}`);
    const byDepth = new Map<number, typeof segs>();
    for (const s of segs) { if (!byDepth.has(s.depth)) byDepth.set(s.depth, []); byDepth.get(s.depth)!.push(s); }
    for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
      if (d > maxDepth) { L.push(`  … deeper interactions omitted (max depth ${Math.max(...byDepth.keys())})`); break; }
      const list = byDepth.get(d)!;
      const tot = list.reduce((s, x) => s + x.power, 0);
      L.push(`  d${d}: ${list.length} segments, ${si(tot, 'W')} total`);
      const seen = new Set<string>();
      for (const s of [...list].sort((a, b) => b.power - a.power)) {
        const ang = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
        const k = `${Math.round(s.a.x / 2)},${Math.round(s.a.y / 2)},${Math.round(ang)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        L.push(`     (${fmtNum(s.a.x, 5)}, ${fmtNum(s.a.y, 5)}) → (${fmtNum(s.b.x, 5)}, ${fmtNum(s.b.y, 5)})  dir ${ang.toFixed(1)}°  λ ${fmtNum(s.wavelength, 4)} nm  ${si(s.power, 'W')}${s.inMedium ? '  [in medium]' : ''}${s.polDegree !== undefined && s.polDegree > 0.5 ? `  pol ${((s.polAngle ?? 0) * 180 / Math.PI).toFixed(0)}°` : ''}`);
        if (seen.size >= per) break;
      }
    }
  }
  L.push('detectors:');
  for (const [id, r] of Object.entries(tr.detectors)) L.push(`  ${name.get(id) ?? id}: ${si(r.power, 'W')}${r.hits ? `, ${r.hits.length} hits` : ''}`);
  return L.join('\n');
}

// =============================================================================================
// Component listings
// =============================================================================================

function paramSummary(p: ParamDef): string {
  let s = `${p.key}=${JSON.stringify(p.default)}`;
  if (p.unit) s += ` ${p.unit}`;
  if (p.kind === 'select') s += ` {${p.options?.map((o) => o.value).join('|')}}`;
  else if ((p.kind === 'number' || p.kind === 'wavelength') && (p.min !== undefined || p.max !== undefined)) s += ` [${p.min ?? '-∞'}..${p.max ?? '∞'}]`;
  return s;
}

export function pinsText(def: CircuitComponentDef, rotation = 0, mirrored = false): string {
  const pins = pinDefsOf(def, {});
  return pins.map((p) => { const o = transformOffset(p.offset, rotation, mirrored); return `${p.name}@(${o.x},${o.y})`; }).join(' ');
}

const mdEsc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function listComponents(which: 'optics' | 'circuit' | 'all', md = false): string {
  const L: string[] = [];
  if (which !== 'circuit') {
    if (md) {
      L.push('# Optics components', '', 'Generated from the live registry by `node scripts/obw.mjs list-components optics --md`.', '',
        'Positions in mm, `rotation` in radians (clockwise on screen, +y is down). Every prop below is in the unit shown; angle-like props (`deg`) are DEGREES.', '');
      let cat = '';
      for (const d of OPTICS_REGISTRY) {
        if (d.category !== cat) { cat = d.category; L.push(`## ${cat}`, ''); }
        L.push(`### \`${d.type}\` — ${d.label}`, '', mdEsc(d.description), '', '| prop | default | unit | range / options | help |', '|---|---|---|---|---|');
        for (const p of d.params) {
          const range = p.kind === 'select' ? p.options!.map((o) => `\`${o.value}\``).join(', ') : p.kind === 'boolean' ? 'true / false' : `${p.min ?? ''} … ${p.max ?? ''}`;
          L.push(`| \`${p.key}\` | ${JSON.stringify(p.default)} | ${p.unit ?? ''} | ${range} | ${mdEsc(p.help ?? p.label)} |`);
        }
        L.push('');
      }
    } else {
      L.push('OPTICS (positions mm, rotation rad; props in listed units)');
      let cat = '';
      for (const d of OPTICS_REGISTRY) {
        if (d.category !== cat) { cat = d.category; L.push(`  -- ${cat}`); }
        L.push(`  ${d.type.padEnd(22)} ${d.params.map(paramSummary).join(', ')}`);
      }
    }
  }
  if (which !== 'optics') {
    if (md) {
      L.push('# Circuit components', '', 'Generated from the live registry by `node scripts/obw.mjs list-components circuit --md`.', '',
        'Positions are integer grid units, `rotation` is 0..3 quarter turns clockwise ((x,y) → (−y,x) per turn), `mirrored` flips x before rotating. Pins are listed at rotation 0 as offsets from the component origin; `footprint` is ox,oy,w,h. Use `node scripts/obw.mjs pins <type> <rotation>` for rotated offsets.', '');
      let cat = '';
      for (const d of circuitEngine.registry) {
        if (d.category !== cat) { cat = d.category; L.push(`## ${cat}`, ''); }
        L.push(`### \`${d.type}\` — ${d.label}`, '', mdEsc(d.description), '', `Pins: ${pinsText(d).split(' ').map((p) => `\`${p}\``).join(' ')} · footprint ${d.size.ox},${d.size.oy},${d.size.w},${d.size.h}${d.interactive ? ' · interactive' : ''}`, '');
        if (d.params.length) {
          L.push('| prop | default | unit | range / options | help |', '|---|---|---|---|---|');
          for (const p of d.params) {
            const range = p.kind === 'select' ? p.options!.map((o) => `\`${o.value}\``).join(', ') : p.kind === 'boolean' ? 'true / false' : p.kind === 'number' ? `${p.min ?? ''} … ${p.max ?? ''}` : '';
            L.push(`| \`${p.key}\` | ${JSON.stringify(p.default)} | ${p.unit ?? ''} | ${range} | ${mdEsc(p.help ?? p.label)} |`);
          }
          L.push('');
        }
      }
    } else {
      L.push('CIRCUIT (positions integer grid units, rotation 0..3 quarter turns CW; pins at rotation 0)');
      let cat = '';
      for (const d of circuitEngine.registry) {
        if (d.category !== cat) { cat = d.category; L.push(`  -- ${cat}`); }
        L.push(`  ${d.type.padEnd(22)} pins ${pinsText(d)}`);
        if (d.params.length) L.push(`  ${''.padEnd(22)} ${d.params.map(paramSummary).join(', ')}`);
      }
    }
  }
  return L.join('\n');
}

// =============================================================================================
// CLI
// =============================================================================================

const HELP = `obw — Optibench Workstation project tool

  validate <file.obw> [--nets]            parse + semantic checks (types, props, wires on pins, links, view)
  simulate <file.obw> [--seconds 0.5] [--dt 0.001] [--verbose] [--json]
                                          headless co-simulation report (detectors, LEDs, 7-seg digits, probes…)
  trace <file.obw> [--wl 550] [--per 3] [--depth 12]
                                          one optics trace: strongest ray segments per source and interaction
                                          depth (--wl keeps one wavelength sample) + detector powers
  list-components [optics|circuit] [--md] registry: types, props (defaults, units, ranges), pins
  pins <type> [rotation] [--mirror]       pin offsets of a circuit type at a rotation (0..3)
  new <file.obw> [title] [--force]        create an empty project
  frame <file.obw>                        set view.optics / view.circuit to frame the content; rewrites the file

Exit code 1 when validation fails or a command errors.`;

function flag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) { args.splice(i, 1); return true; }
  return false;
}
function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) { const v = args[i + 1]; args.splice(i, 2); return v; }
  return undefined;
}

function load(path: string | undefined): ObwDocument {
  if (!path) throw new Error('missing <file.obw> argument');
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const { doc, report } = validateText(readFileSync(path, 'utf8'));
  if (!doc) throw new Error(report.errors.join('\n'));
  return doc;
}

export async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const cmd = args.shift();
  try {
    switch (cmd) {
      case 'validate': {
        const nets = flag(args, '--nets');
        const path = args[0];
        if (!path) throw new Error('usage: validate <file.obw>');
        const { report } = validateText(readFileSync(path, 'utf8'));
        console.log(formatValidation(report, nets));
        return report.errors.length ? 1 : 0;
      }
      case 'simulate': {
        const verbose = flag(args, '--verbose');
        const json = flag(args, '--json');
        const seconds = Number(option(args, '--seconds') ?? 0.5);
        const dt = Number(option(args, '--dt') ?? 1e-3);
        const doc = load(args[0]);
        const rep = simulateDocument(doc, { seconds, dt });
        if (json) {
          const { lastTrace, series, ...rest } = rep;
          void lastTrace; void series;
          console.log(JSON.stringify(rest, null, 1));
        } else console.log(formatSimulation(rep, verbose));
        return rep.errors.length ? 1 : 0;
      }
      case 'trace': {
        const per = Number(option(args, '--per') ?? 3);
        const wlOpt = option(args, '--wl');
        const maxDepth = Number(option(args, '--depth') ?? 12);
        const doc = load(args[0]);
        console.log(formatTrace(doc, opticsEngine.trace(doc.optics), { perDepth: per, wl: wlOpt === undefined ? undefined : Number(wlOpt), maxDepth }));
        return 0;
      }
      case 'list-components': {
        const md = flag(args, '--md');
        const which = (args[0] ?? 'all') as 'optics' | 'circuit' | 'all';
        if (!['optics', 'circuit', 'all'].includes(which)) throw new Error('usage: list-components [optics|circuit] [--md]');
        console.log(listComponents(which, md));
        return 0;
      }
      case 'pins': {
        const mirror = flag(args, '--mirror');
        const type = args[0];
        const rot = Number(args[1] ?? 0);
        const def = type ? circuitDef(type) : undefined;
        if (!def) {
          if (type && opticsDef(type)) throw new Error(`${type} is an optics component; pins are a circuit concept`);
          throw new Error(`unknown circuit type ${type ?? '(none)'}`);
        }
        const b = circuitBounds({ id: 'x', type: def.type, position: { x: 0, y: 0 }, rotation: rot as 0, mirrored: mirror, props: {} })!;
        console.log(`${def.type} rotation ${rot}${mirror ? ' mirrored' : ''}: ${pinsText(def, rot, mirror)}`);
        console.log(`footprint x ${b.minx}..${b.maxx}, y ${b.miny}..${b.maxy}`);
        return 0;
      }
      case 'new': {
        const force = flag(args, '--force');
        const path = args[0];
        if (!path) throw new Error('usage: new <file.obw> [title]');
        if (existsSync(path) && !force) throw new Error(`${path} exists (use --force to overwrite)`);
        writeFileSync(path, serializeDocument(createEmptyDocument(args[1] ?? 'Untitled Project')));
        console.log(`created ${path}`);
        return 0;
      }
      case 'frame': {
        const path = args[0];
        const doc = load(path);
        const fv = frameView(doc);
        doc.view = { ...(doc.view ?? {}), optics: fv.optics, circuit: fv.circuit };
        writeFileSync(path!, serializeDocument(doc));
        console.log(`framed ${path}: optics ${JSON.stringify(fv.optics)}, circuit ${JSON.stringify(fv.circuit)}`);
        return 0;
      }
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        return 0;
      default:
        console.error(`unknown command "${cmd}"\n\n${HELP}`);
        return 1;
    }
  } catch (e) {
    console.error(`obw ${cmd}: ${(e as Error).message}`);
    return 1;
  }
}
