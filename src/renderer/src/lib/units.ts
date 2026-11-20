/** SI prefix formatting / parsing for the inspector, instruments and status bar. */

const PREFIXES: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']
];

/** Units that take SI prefixes. Units that already carry a prefix (mm, nm, µF) are shown as-is. */
const BASE_UNITS = new Set(['Ω', 'ohm', 'F', 'H', 'V', 'A', 'W', 'Hz', 's', 'T', 'J', 'S', 'C', 'Wb', 'lx', 'W/m²', 'A/W', 'V/V']);

/** Units whose given prefix should be normalised to the base unit before re-prefixing. */
const PREFIXED: Record<string, [number, string]> = {
  'kΩ': [1e3, 'Ω'], 'MΩ': [1e6, 'Ω'], 'µF': [1e-6, 'F'], 'uF': [1e-6, 'F'], 'nF': [1e-9, 'F'], 'pF': [1e-12, 'F'],
  'mH': [1e-3, 'H'], 'µH': [1e-6, 'H'], 'mA': [1e-3, 'A'], 'mV': [1e-3, 'V'], 'mW': [1e-3, 'W'], 'kHz': [1e3, 'Hz'],
  'MHz': [1e6, 'Hz'], 'ms': [1e-3, 's'], 'µs': [1e-6, 's'], 'mT': [1e-3, 'T']
};

export function trimNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '−∞' : '—';
  if (n === 0) return '0';
  const s = Number(n.toPrecision(digits)).toString();
  return s.replace('-', '−');
}

/** Format with SI prefix: formatSI(4700, 'Ω') -> '4.7 kΩ', formatSI(1e-4, 'F') -> '100 µF'. */
export function formatSI(value: number, unit = '', digits = 4): string {
  if (!Number.isFinite(value)) return `${trimNum(value)}${unit ? ' ' + unit : ''}`;
  let v = value;
  let u = unit;
  if (PREFIXED[u]) { v = value * PREFIXED[u][0]; u = PREFIXED[u][1]; }
  if (!u || !BASE_UNITS.has(u)) return `${trimNum(v, digits)}${u ? ' ' + u : ''}`;
  if (v === 0) return `0 ${u}`;
  const a = Math.abs(v);
  for (const [f, p] of PREFIXES) {
    if (a >= f * 0.99995) return `${trimNum(v / f, digits)} ${p}${u}`;
  }
  const [f, p] = PREFIXES[PREFIXES.length - 1];
  return `${trimNum(v / f, digits)} ${p}${u}`;
}

const SUFFIX: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, meg: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15
};

/**
 * Parse user input such as "4.7k", "100u", "1e-3", "2.2 MΩ", "−5". Values are interpreted in the
 * param's display unit: if `unit` already carries a prefix (e.g. 'µF'), "100n" becomes 0.1 (µF).
 */
export function parseSI(text: string, unit = ''): number | null {
  let s = text.trim().replace(/[−–]/g, '-').replace(/,/g, '.');
  if (!s) return null;
  const base = PREFIXED[unit]?.[1] ?? unit;
  if (base && s.endsWith(base)) s = s.slice(0, -base.length).trim();
  else if (unit && s.endsWith(unit)) s = s.slice(0, -unit.length).trim();
  s = s.replace(/(ohms?|Ω)$/i, '').trim();
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[TGMkKmuµμnpf])?$/i.exec(s);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const suf = m[2];
  if (suf) {
    const key = suf.toLowerCase() === 'meg' ? 'meg' : suf;
    const mul = SUFFIX[key];
    if (mul === undefined) return null;
    v *= mul;
    if (PREFIXED[unit]) v /= PREFIXED[unit][0];
  }
  return v;
}

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

export function formatTime(t: number): string {
  return formatSI(t, 's', 4);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
