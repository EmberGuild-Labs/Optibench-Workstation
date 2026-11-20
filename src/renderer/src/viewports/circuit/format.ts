/** SI formatting, component value labels, designators and colour helpers. */
import type { CircuitComponent, CircuitComponentDef, CircuitComponentState, ParamValue } from '@core/types';

const PREFIX: [number, string][] = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
const PREFIX_FACTOR: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, 'µ': 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
const BASE_UNITS = ['Ω', 'F', 'H', 'V', 'A', 'Hz', 'W', 's', 'ohm'];

export function formatSI(v: number, unit = '', sig = 3): string {
  if (!Number.isFinite(v)) return `— ${unit}`.trim();
  if (v === 0) return `0${unit}`;
  const a = Math.abs(v);
  let pf: [number, string] = PREFIX[PREFIX.length - 1];
  for (const p of PREFIX) if (a >= p[0] * 0.9995) { pf = p; break; }
  const n = v / pf[0];
  const s = String(parseFloat(n.toPrecision(sig)));
  return `${s}${pf[1]}${unit}`;
}

/** Converts a value stored in a prefixed display unit (e.g. 'µF') to base unit. */
export function toBase(v: number, unit: string | undefined): { v: number; unit: string } {
  if (!unit) return { v, unit: '' };
  if (BASE_UNITS.includes(unit)) return { v, unit: unit === 'ohm' ? 'Ω' : unit };
  const p = unit[0], rest = unit.slice(1);
  if (PREFIX_FACTOR[p] && BASE_UNITS.includes(rest)) return { v: v * PREFIX_FACTOR[p], unit: rest === 'ohm' ? 'Ω' : rest };
  return { v, unit };
}

const KEY_UNITS: Record<string, string> = {
  resistance: 'Ω', r: 'Ω', capacitance: 'F', c: 'F', inductance: 'H', l: 'H', voltage: 'V', v: 'V', emf: 'V',
  current: 'A', i: 'A', frequency: 'Hz', freq: 'Hz', f: 'Hz', power: 'W', amplitude: 'V', vpeak: 'V', vz: 'V',
  zenerVoltage: 'V', breakdown: 'V', ratio: ':1', turns: ' turns'
};

const VALUE_KEYS: Record<string, string[]> = {
  'passive.resistor': ['resistance', 'r', 'value'],
  'passive.potentiometer': ['resistance', 'r', 'value'],
  'passive.capacitor': ['capacitance', 'c', 'value'],
  'passive.inductor': ['inductance', 'l', 'value'],
  'passive.transformer': ['ratio', 'turnsRatio', 'n'],
  'source.battery': ['voltage', 'emf', 'v'],
  'source.psu': ['voltage', 'v'],
  'source.ac': ['amplitude', 'voltage', 'vpeak', 'frequency'],
  'source.function_gen': ['frequency', 'freq', 'amplitude'],
  'source.current': ['current', 'i'],
  'osc.crystal': ['frequency', 'freq'],
  'semi.zener': ['zenerVoltage', 'vz', 'breakdown'],
  'semi.led': ['color', 'colour', 'wavelength'],
  'misc.lamp': ['power', 'voltage'],
  'opto.coil': ['inductance', 'turns'],
  'opto.laser_diode': ['wavelength'],
  'meter.probe': ['channel']
};

const NO_VALUE = new Set(['misc.ground', 'meter.voltmeter', 'meter.ammeter']);

function fmtParam(key: string, v: ParamValue, def?: CircuitComponentDef): string | null {
  const pd = def?.params?.find((p) => p.key === key);
  if (typeof v === 'number') {
    if (pd?.kind === 'wavelength' || key === 'wavelength') return `${Math.round(v)}nm`;
    if (key === 'channel') return `CH${v}`;
    const unit = pd?.unit ?? KEY_UNITS[key] ?? '';
    if (unit.startsWith(':') || unit.startsWith(' ')) return `${parseFloat(v.toPrecision(3))}${unit}`;
    const b = toBase(v, unit);
    if (!b.unit || BASE_UNITS.includes(b.unit)) return formatSI(b.v, b.unit);
    return `${parseFloat(v.toPrecision(3))}${b.unit}`;
  }
  if (typeof v === 'string' && v.length && v.length < 24) {
    if (pd?.kind === 'select') return (pd.options?.find((o) => o.value === v)?.label ?? v).replace(/\s*\(.*\)\s*$/, '');
    if (pd?.kind === 'color' || key === 'color' || key === 'colour') return v.startsWith('#') ? null : v;
    return v;
  }
  return null;
}

/** Second label line: value with SI prefix, e.g. "4.7kΩ". */
export function valueLabel(c: CircuitComponent, def?: CircuitComponentDef): string {
  if (NO_VALUE.has(c.type)) return '';
  const props = c.props ?? {};
  const keys = VALUE_KEYS[c.type];
  if (keys) {
    const parts: string[] = [];
    for (const k of keys) {
      if (props[k] === undefined) continue;
      const s = fmtParam(k, props[k], def);
      if (s) parts.push(s);
      if (c.type !== 'source.ac' || parts.length >= 2) break;
    }
    if (parts.length) return parts.join(' ');
  }
  // generic fallback only for simple valued parts (ICs / semis expose internal model params)
  if (def && /^(passive|source|osc)\.|^misc\.lamp$|^opto\.(coil|ldr)$/.test(c.type)) {
    for (const pd of def.params ?? []) {
      if (pd.kind !== 'number' || !pd.unit) continue;
      const v = props[pd.key];
      if (typeof v === 'number') { const s = fmtParam(pd.key, v, def); if (s) return s; }
    }
  }
  return '';
}

const PREFIXES: Record<string, string> = {
  'source.battery': 'B', 'source.psu': 'PS', 'source.ac': 'V', 'source.function_gen': 'FG', 'source.current': 'I',
  'misc.ground': 'GND', 'osc.crystal': 'Y', 'ic.555': 'U', 'passive.resistor': 'R', 'passive.potentiometer': 'RV',
  'passive.capacitor': 'C', 'passive.inductor': 'L', 'passive.transformer': 'T', 'semi.diode': 'D', 'semi.zener': 'D',
  'semi.led': 'LED', 'semi.npn': 'Q', 'semi.pnp': 'Q', 'semi.nmos': 'M', 'semi.pmos': 'M', 'switch.spst': 'S',
  'switch.spdt': 'S', 'switch.push': 'SW', 'switch.relay': 'K', 'display.7seg': 'DS', 'display.matrix': 'DS',
  'meter.voltmeter': 'VM', 'meter.ammeter': 'AM', 'meter.probe': 'PR', 'digital.and': 'U', 'digital.or': 'U',
  'digital.not': 'U', 'digital.nand': 'U', 'digital.xor': 'U', 'digital.counter': 'U', 'digital.bcd7seg': 'U',
  'misc.lamp': 'LP', 'misc.buzzer': 'BZ', 'opto.photodiode': 'PD', 'opto.ldr': 'LDR', 'opto.solar_cell': 'SC',
  'opto.laser_diode': 'LD', 'opto.coil': 'L'
};

export function designatorPrefix(c: CircuitComponent): string {
  const fromName = c.name ? /^([A-Za-z]+)/.exec(c.name)?.[1] : undefined;
  if (fromName) return fromName;
  if (PREFIXES[c.type]) return PREFIXES[c.type];
  const tail = c.type.split('.').pop() ?? 'X';
  return tail.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'X';
}

/** Next free designator for c among existing components (R1, R2, …). */
export function nextDesignator(c: CircuitComponent, existing: CircuitComponent[]): string {
  const base = designatorPrefix(c);
  const re = new RegExp(`^${base.replace(/[^A-Za-z]/g, '')}(\\d+)$`);
  let max = 0;
  for (const o of existing) {
    const m = re.exec(o.name ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}${max + 1}`;
}

// ---------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------

export function wavelengthRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  else if (nm > 780) { r = 0.8; }
  else { r = 0.5; b = 0.8; }
  return [r, g, b];
}

const NAMED: Record<string, string> = {
  red: '#ff3030', green: '#39ff5a', blue: '#3d7bff', yellow: '#ffe23a', orange: '#ff9a2a', white: '#f4f6ff',
  amber: '#ffb000', purple: '#b04dff', violet: '#9b4dff', uv: '#9b4dff', ir: '#b0203a', infrared: '#b0203a',
  cyan: '#33f0ff', pink: '#ff5ab4', warm: '#ffd08a'
};

export function hexToRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(rgb: [number, number, number], a: number): string {
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Emission colour of an LED / laser from props (color name/hex or wavelength nm). */
export function emitterRGB(props: Record<string, ParamValue>, fallback = '#ff3030'): [number, number, number] {
  const c = props.color ?? props.colour;
  if (typeof c === 'string') {
    const hx = hexToRgb(c) ?? (NAMED[c.toLowerCase()] ? hexToRgb(NAMED[c.toLowerCase()]) : null);
    if (hx) return hx;
  }
  const wl = props.wavelength;
  if (typeof wl === 'number' && wl > 300) {
    const [r, g, b] = wavelengthRGB(wl);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return hexToRgb(fallback)!;
}

/** Voltage colour: blue (negative) → black (0) → red (positive). t in [-1, 1]. */
export function voltageColor(t: number): string {
  const x = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  // readable on white paper: blue (-) -> near-black (0) -> red (+)
  const grey: [number, number, number] = [32, 32, 32];
  const pos: [number, number, number] = [214, 24, 24];
  const neg: [number, number, number] = [24, 72, 214];
  const k = Math.pow(Math.abs(x), 0.7);
  const tgt = x >= 0 ? pos : neg;
  return `rgb(${Math.round(grey[0] + (tgt[0] - grey[0]) * k)},${Math.round(grey[1] + (tgt[1] - grey[1]) * k)},${Math.round(grey[2] + (tgt[2] - grey[2]) * k)})`;
}

// ---------------------------------------------------------------------------
// interactive component values
// ---------------------------------------------------------------------------

const POT_KEYS = ['position', 'wiper', 'pos', 'set', 'ratio', 'value'];

export function potValue(c: CircuitComponent, st?: CircuitComponentState, override?: number): number {
  if (override !== undefined) return override;
  for (const k of POT_KEYS) { const v = st?.[k]; if (typeof v === 'number' && v >= 0 && v <= 1) return v; }
  for (const k of POT_KEYS) { const v = c.props?.[k]; if (typeof v === 'number') return v > 1 ? Math.min(1, v / 100) : Math.max(0, v); }
  return 0.5;
}

/** Contact state of a switch: state.on while running, else from props. */
export function switchOn(c: CircuitComponent, st: CircuitComponentState | undefined, running: boolean): boolean {
  if (running && st && typeof st.on === 'boolean') return st.on;
  const p = c.props ?? {};
  for (const k of ['closed', 'on', 'pressed', 'state', 'position', 'energized']) {
    const v = p[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string') return /^(closed|on|a|1|true|no)$/i.test(v); // SPDT position 'A' = on
  }
  return false;
}
