/**
 * Time control + slow-motion light rendering helpers (pure, unit-tested in tests/ui/timeView.test.ts).
 *
 *  - Time scale = simulated seconds per wall-clock second. 1 = realtime, 1e-9 = "1 ns/s".
 *  - Pulse view: when the light's time of flight across the bench (or a pulse period) takes a
 *    noticeable wall time at the current scale, the optics views draw only light whose time of
 *    flight lies in a window [tFront − width, tFront] (RaySegment t0/t1), so pulses travel.
 *      pulsed lasers  : one window per pulse, repeated every 1/repRate (several pulses in flight)
 *      CW sources     : the light front propagating from switch-on (t = 0 at Play / Reset); once
 *                       it has crossed the whole bench the view switches back to the steady beam.
 */
import type { OpticalComponent } from '@core/types';
import { formatSI } from './units';

export const TIME_SCALE_MIN = 1e-15;
export const TIME_SCALE_MAX = 1e3;

export const TIME_SCALE_PRESETS: { label: string; value: number }[] = [
  { label: 'Realtime', value: 1 },
  { label: '1 ms/s', value: 1e-3 },
  { label: '1 µs/s', value: 1e-6 },
  { label: '1 ns/s', value: 1e-9 },
  { label: '100 ps/s', value: 1e-10 },
  { label: '10 ps/s', value: 1e-11 }
];

const PREFIX: Record<string, number> = {
  '': 1, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15
};

function num(s: string): number | null {
  const t = s.trim().replace(/[−–]/g, '-').replace(/,/g, '.');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(t)) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

/** "1 ns", "100ps", "2 µs", "1 s", "1e-9 s", "3 min" → seconds (null if not a duration). */
function duration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?\s*(k|m|u|µ|μ|n|p|f)?\s*(s|sec|secs|second|seconds)$/i.exec(t);
  if (m) {
    const v = m[1] === undefined ? 1 : parseFloat(m[1]);
    const p = PREFIX[(m[2] ?? '').replace('μ', 'µ')];
    return Number.isFinite(v) && p !== undefined ? v * p : null;
  }
  const mm = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?\s*(min|mins|minute|minutes|h|hr|hour|hours)$/i.exec(t);
  if (mm) {
    const v = mm[1] === undefined ? 1 : parseFloat(mm[1]);
    return v * (mm[2].startsWith('m') ? 60 : 3600);
  }
  return num(t);
}

/**
 * Parse a human time-scale entry. Accepted forms (case-insensitive, spaces optional):
 *   "realtime" | "real time" | "rt" | "live"        → 1
 *   "1 ns/s", "100 ps / s", "1 µs per s", "1us/sec" → simulated duration per wall second
 *   "1 ns/ms" (per millisecond of wall time)          → 1e-6
 *   "1/1e9", "1:1e9"                                   → ratio
 *   "1e-9", "0.5", "2x", "0.25×", "×10"                → plain factor
 * Returns null for anything that is not a positive finite scale; the result is clamped to
 * [TIME_SCALE_MIN, TIME_SCALE_MAX].
 */
export function parseTimeScale(input: string): number | null {
  const raw = String(input ?? '').trim().toLowerCase().replace(/[−–]/g, '-');
  if (!raw) return null;
  if (/^(real[\s-]?time|rt|live|1:1)$/.test(raw)) return 1;
  let v: number | null = null;
  const per = /^(.+?)\s*(?:\/|\bper\b)\s*(.+)$/.exec(raw);
  const ratio = /^(.+?)\s*:\s*(.+)$/.exec(raw);
  if (per) {
    const a = duration(per[1]);
    const bStr = per[2].trim();
    // "1/1e9" (pure numbers) is a ratio; "1 ns/s" is duration over duration
    const b = duration(/^[a-zµμ]/i.test(bStr) ? `1 ${bStr}` : bStr);
    if (a !== null && b !== null && b !== 0) v = a / b;
  } else if (ratio) {
    const a = num(ratio[1]), b = num(ratio[2]);
    if (a !== null && b !== null && b !== 0) v = a / b;
  } else {
    const x = /^(?:[x×]\s*)?([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(?:[x×]|times)?$/i.exec(raw);
    if (x) v = parseFloat(x[1]);
  }
  if (v === null || !Number.isFinite(v) || !(v > 0)) return null;
  return Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, v));
}

/** Display form: 1 → "Realtime", 2 → "2×", 1e-9 → "1 ns/s", 1e-10 → "100 ps/s". */
export function formatTimeScale(v: number): string {
  if (!Number.isFinite(v) || !(v > 0)) return '—';
  if (Math.abs(v - 1) < 1e-9) return 'Realtime';
  if (v > 1) return `${Number(v.toPrecision(4))}×`;
  return `${formatSI(v, 's', 4)}/s`;
}

/** Simulated-time readout for the status bar: "t = 1.234 ns". */
export function formatSimTime(t: number): string {
  if (!Number.isFinite(t)) return 't = —';
  return `t = ${formatSI(Math.max(0, t), 's', 4)}`;
}

// ---------------------------------------------------------------------------------------------
// Pulse windows
// ---------------------------------------------------------------------------------------------

export interface TimeWindow {
  /** Time of flight (s since emission) of the leading edge of the newest pulse / CW front. */
  front: number;
  /** Window length (s); Infinity for a CW front (everything already emitted is lit). */
  width: number;
  /** Pulse period (s) when repeated pulses are in flight; 0 = a single pulse / front. */
  period: number;
}

/**
 * Part of a segment [t0, t1] (time of flight at its ends) lit by a window [front − width, front].
 * Returns the fractions [s0, s1] (0 = start, 1 = end) or null when the window misses the segment.
 */
export function clipToWindow(t0: number, t1: number, front: number, width: number): [number, number] | null {
  if (!Number.isFinite(t0)) return null;
  if (!Number.isFinite(t1)) t1 = t0;
  const lo = front - width, hi = front;
  if (hi < t0 || lo > t1) return null;
  const dt = t1 - t0;
  if (!(dt > 0)) return hi >= t0 && lo <= t0 ? [0, 1] : null;
  const s0 = Math.max(0, Math.min(1, (lo - t0) / dt));
  const s1 = Math.max(0, Math.min(1, (hi - t0) / dt));
  return s1 > s0 ? [s0, s1] : null;
}

/** Maximum number of pulse copies drawn on one segment (very long escaping rays). */
export const MAX_PULSE_COPIES = 48;

/**
 * Every lit piece of a segment for a (possibly periodic) window: pulse k (k = 0 newest) has its
 * front at `front + k·period`. Returns fraction pairs, ordered by k.
 */
export function segmentWindows(t0: number, t1: number, w: TimeWindow): [number, number][] {
  if (!Number.isFinite(t0)) return [];
  if (!Number.isFinite(t1)) t1 = t0;
  if (!(w.period > 0) || !Number.isFinite(w.width)) {
    const one = clipToWindow(t0, t1, w.front, w.width);
    return one ? [one] : [];
  }
  const out: [number, number][] = [];
  // pulse k lights the segment when front + kP − width ≤ t1 and front + kP ≥ t0
  const kMin = Math.max(0, Math.ceil((t0 - w.front) / w.period - 1e-9));
  const kMax = Math.floor((t1 + w.width - w.front) / w.period + 1e-9);
  const kEnd = Math.min(kMax, kMin + MAX_PULSE_COPIES - 1);
  for (let k = kMin; k <= kEnd; k++) {
    const c = clipToWindow(t0, t1, w.front + k * w.period, w.width);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Choosing the view mode
// ---------------------------------------------------------------------------------------------

export interface PulsedSourceInfo { id: string; repRate: number; pulseWidth: number }

/** Pulsed lasers of a scene (props.mode === 'pulsed'). */
export function pulsedSources(components: OpticalComponent[]): PulsedSourceInfo[] {
  const out: PulsedSourceInfo[] = [];
  for (const c of components) {
    if (!c.type.startsWith('source.') || c.props?.mode !== 'pulsed') continue;
    const f = Number(c.props.repRate), w = Number(c.props.pulseWidth);
    if (f > 0 && Number.isFinite(f)) out.push({ id: c.id, repRate: f, pulseWidth: w > 0 && Number.isFinite(w) ? w : 1e-10 });
  }
  return out;
}

/** Wall time (s) the bench / a pulse period must take at least for the pulse view to engage. */
export const PULSE_VIEW_MIN_WALL = 0.1;

export interface TimeViewInput {
  components: OpticalComponent[];
  /** Simulated time since Play from stopped / Reset (s). */
  simTime: number;
  timeScale: number;
  status: 'stopped' | 'running' | 'paused';
  /** Latest time of flight on the bench (s): max segment t0 (last interaction) or t1 of bounded rays. */
  maxT: number;
}

export interface TimeViewOut {
  mode: 'steady' | 'pulse';
  /** Front of the newest pulse (s of flight). */
  t: number;
  /** Visual window length (s); Infinity for a CW front. */
  pulseWidth: number;
  /** Period of repeated pulses (s), 0 = none. */
  period: number;
}

const STEADY: TimeViewOut = { mode: 'steady', t: 0, pulseWidth: 0, period: 0 };

/**
 * Decide steady vs pulse rendering and the window for the current instant.
 *  - Edit mode, or light crossing the bench faster than PULSE_VIEW_MIN_WALL of wall time → steady.
 *  - A pulsed laser whose period lasts ≥ PULSE_VIEW_MIN_WALL wall seconds → repeated pulses
 *    (window width = max(physical FWHM, 4 % of the bench time of flight), at most half a period).
 *  - Otherwise (CW): front at simTime with an infinite tail until it passed the whole bench.
 */
export function computeTimeView(inp: TimeViewInput): TimeViewOut {
  if (inp.status === 'stopped' || !(inp.timeScale > 0)) return STEADY;
  const maxT = inp.maxT > 0 && Number.isFinite(inp.maxT) ? inp.maxT : 0;
  if (!(maxT > 0)) return STEADY;
  const benchWall = maxT / inp.timeScale;
  const pulsed = pulsedSources(inp.components);
  const t = Math.max(0, inp.simTime);
  if (pulsed.length) {
    // the slowest train sets the period (others are drawn with it: one shared clock per view)
    const src = pulsed.reduce((a, b) => (b.repRate < a.repRate ? b : a));
    const P = 1 / src.repRate;
    if (P / inp.timeScale >= PULSE_VIEW_MIN_WALL || (P >= maxT && benchWall >= PULSE_VIEW_MIN_WALL)) {
      const width = Math.min(P * 0.5, Math.max(src.pulseWidth, maxT * 0.04));
      // pulses are centred on k / repRate; the newest one emitted at or before t
      const phase = t - Math.floor(t / P) * P;
      return { mode: 'pulse', t: phase + width / 2, pulseWidth: width, period: P };
    }
    return STEADY;
  }
  if (benchWall < PULSE_VIEW_MIN_WALL) return STEADY;
  if (t > maxT * 1.02) return STEADY;
  return { mode: 'pulse', t, pulseWidth: Number.POSITIVE_INFINITY, period: 0 };
}

/** Bench time of flight from segments: max t0 (last interaction) and the t1 of rays ending on a part. */
export function benchTimeOfFlight(segments: { t0?: number; t1?: number }[]): number {
  let m = 0;
  for (const s of segments) {
    const t0 = s.t0;
    if (typeof t0 === 'number' && Number.isFinite(t0) && t0 > m) m = t0;
  }
  // a single straight beam (no interactions) still needs some extent: use its t1
  if (m === 0) for (const s of segments) if (typeof s.t1 === 'number' && Number.isFinite(s.t1) && s.t1 > m) m = s.t1;
  return m;
}
