/**
 * Parameter sweep runner — pure, engines injected (so it runs in a Web Worker, on the main thread
 * in idle-time chunks, or in unit tests with fake engines).
 *
 * For every sweep value the document is copied, one parameter is set, and the document is
 * simulated headless: an optics trace, a circuit transient of `settle` seconds, or a co-simulation
 * when the document has opto-links. The live document is never touched.
 */
import type {
  CircuitScene, CircuitSimulator, CircuitState, DetectorReading, ObwDocument, OpticsScene, TraceResult
} from '@core/types';

export type SweepScale = 'linear' | 'log';
export type SweepDomain = 'optics' | 'circuit';

/** `param` is a registry prop key, or a placement pseudo-param: '@rotation' (deg), '@x', '@y'. */
export interface SweepTarget { domain: SweepDomain; id: string; param: string }

export type SweepOutputKind =
  | 'detectorPower' | 'spectrumPeak' | 'screenCentroid'
  | 'nodeVoltage' | 'componentCurrent' | 'ledBrightness' | 'probeMean';

export interface SweepOutput { kind: SweepOutputKind; id: string; /** nodeVoltage: pin name (default first pin) */ pin?: string }

export interface SweepSpec {
  target: SweepTarget;
  start: number;
  stop: number;
  steps: number;
  scale: SweepScale;
  outputs: SweepOutput[];
  /** Circuit / co-sim transient length per point (s). */
  settle: number;
  /** Ticks per settle window (circuit outputs are averaged over the second half). Default 100. */
  samples?: number;
}

export interface SweepPoint { index: number; value: number; outputs: (number | null)[]; error?: string }

export interface SweepResult { spec: SweepSpec; values: number[]; points: SweepPoint[]; cancelled: boolean; ms: number }

export interface CoSimLike {
  tick(dt: number): { circuit: CircuitState; trace: TraceResult | null };
  readonly lastTrace?: TraceResult | null;
}

export interface SweepDeps {
  trace(scene: OpticsScene): TraceResult;
  createSimulator(scene: CircuitScene): CircuitSimulator;
  /** Needed only for documents with opto-links. */
  createCoSim?(doc: ObwDocument): CoSimLike;
}

export interface SweepHooks {
  onPoint?(p: SweepPoint, done: number, total: number): void;
  /** Called between ticks / points; return a promise to give the event loop a turn. */
  yield?(): void | Promise<void>;
  cancelled?(): boolean;
}

export const OPTICS_OUTPUTS: SweepOutputKind[] = ['detectorPower', 'spectrumPeak', 'screenCentroid'];
export const CIRCUIT_OUTPUTS: SweepOutputKind[] = ['nodeVoltage', 'componentCurrent', 'ledBrightness', 'probeMean'];

export const OUTPUT_INFO: Record<SweepOutputKind, { label: string; unit: string; domain: SweepDomain }> = {
  detectorPower: { label: 'Detector power', unit: 'W', domain: 'optics' },
  spectrumPeak: { label: 'Spectrum peak', unit: 'nm', domain: 'optics' },
  screenCentroid: { label: 'Screen centroid', unit: 'mm', domain: 'optics' },
  nodeVoltage: { label: 'Node voltage', unit: 'V', domain: 'circuit' },
  componentCurrent: { label: 'Component current', unit: 'A', domain: 'circuit' },
  ledBrightness: { label: 'LED brightness', unit: '', domain: 'circuit' },
  probeMean: { label: 'Probe mean', unit: 'V', domain: 'circuit' }
};

export const PSEUDO_PARAMS: Record<string, { label: string; unit: string }> = {
  '@rotation': { label: 'Rotation', unit: '°' },
  '@x': { label: 'Position X', unit: 'mm' },
  '@y': { label: 'Position Y', unit: 'mm' }
};

/** The sweep values (inclusive end points). Log scale requires start, stop > 0 (falls back to linear). */
export function sweepValues(start: number, stop: number, steps: number, scale: SweepScale): number[] {
  const n = Math.max(1, Math.min(10000, Math.round(steps)));
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return [];
  if (n === 1) return [start];
  const out: number[] = [];
  const log = scale === 'log' && start > 0 && stop > 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(log ? Math.exp(Math.log(start) + (Math.log(stop) - Math.log(start)) * t) : start + (stop - start) * t);
  }
  return out;
}

/** Copy of `doc` with the target parameter set (structural sharing for everything else). */
export function applySweepValue(doc: ObwDocument, t: SweepTarget, value: number): ObwDocument {
  if (t.domain === 'optics') {
    const components = doc.optics.components.map((c) => {
      if (c.id !== t.id) return c;
      if (t.param === '@rotation') return { ...c, rotation: (value * Math.PI) / 180 };
      if (t.param === '@x' || t.param === '@y') {
        const position = { ...c.position, [t.param === '@x' ? 'x' : 'y']: value };
        const dx = position.x - c.position.x, dy = position.y - c.position.y;
        const props = typeof c.props.endX === 'number' && typeof c.props.endY === 'number'
          ? { ...c.props, endX: (c.props.endX as number) + dx, endY: (c.props.endY as number) + dy } : c.props;
        return { ...c, position, props };
      }
      return { ...c, props: { ...c.props, [t.param]: value } };
    });
    return { ...doc, optics: { ...doc.optics, components } };
  }
  const components = doc.circuit.components.map((c) => (c.id === t.id ? { ...c, props: { ...c.props, [t.param]: value } } : c));
  return { ...doc, circuit: { ...doc.circuit, components } };
}

/** Current value of the target parameter in a document (for defaults / restore). */
export function readSweepValue(doc: ObwDocument, t: SweepTarget): number | null {
  if (t.domain === 'optics') {
    const c = doc.optics.components.find((x) => x.id === t.id);
    if (!c) return null;
    if (t.param === '@rotation') return (c.rotation * 180) / Math.PI;
    if (t.param === '@x') return c.position.x;
    if (t.param === '@y') return c.position.y;
    const v = c.props[t.param];
    return typeof v === 'number' ? v : null;
  }
  const c = doc.circuit.components.find((x) => x.id === t.id);
  const v = c?.props[t.param];
  return typeof v === 'number' ? v : null;
}

// ---------------------------------------------------------------------------
// Output extraction
// ---------------------------------------------------------------------------

export function spectrumPeak(r: DetectorReading | undefined): number | null {
  const s = r?.spectrum;
  if (!s || !s.length) return null;
  const [lo, hi] = r!.spectrumRange ?? [380, 780];
  let bi = -1, bv = 0;
  for (let i = 0; i < s.length; i++) if (s[i] > bv) { bv = s[i]; bi = i; }
  if (bi < 0) return null;
  // parabolic interpolation around the max bin for sub-bin resolution
  let off = 0;
  if (bi > 0 && bi < s.length - 1) {
    const a = s[bi - 1], b = s[bi], c = s[bi + 1];
    const den = a - 2 * b + c;
    if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  return lo + ((hi - lo) * (bi + 0.5 + off)) / s.length;
}

/** Profile centroid across the detector face in mm from its centre (needs props.size). */
export function screenCentroid(r: DetectorReading | undefined, size: number): number | null {
  const p = r?.profile;
  if (p && p.length) {
    let sw = 0, sx = 0;
    for (let i = 0; i < p.length; i++) { sw += p[i]; sx += p[i] * (i + 0.5); }
    if (sw > 0) return (sx / sw / p.length - 0.5) * size;
  }
  return null;
}

function opticsOutput(o: SweepOutput, trace: TraceResult | null, doc: ObwDocument): number | null {
  if (!trace) return null;
  const r = trace.detectors?.[o.id];
  if (!r) return null;
  switch (o.kind) {
    case 'detectorPower': return Number.isFinite(r.power) ? r.power : null;
    case 'spectrumPeak': return spectrumPeak(r);
    case 'screenCentroid': {
      const c = doc.optics.components.find((x) => x.id === o.id);
      const size = typeof c?.props.size === 'number' ? c.props.size : 1;
      return screenCentroid(r, size);
    }
    default: return null;
  }
}

function circuitSample(o: SweepOutput, st: CircuitState, doc: ObwDocument, firstPin: (id: string) => string | undefined): number | null {
  const cs = st.components?.[o.id];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (o.kind) {
    case 'nodeVoltage': {
      const pin = o.pin ?? firstPin(o.id);
      const net = pin ? st.pinNets?.[`${o.id}:${pin}`] : undefined;
      if (net !== undefined) return num(st.nodeVoltages?.[net]);
      return null;
    }
    case 'componentCurrent': return num(cs?.current);
    case 'ledBrightness': return num(cs?.brightness);
    case 'probeMean': {
      const v = num(cs?.voltage);
      if (v !== null) return v;
      // fall back to the net of the probe's pin
      const pin = firstPin(o.id);
      const net = pin ? st.pinNets?.[`${o.id}:${pin}`] : undefined;
      return net !== undefined ? num(st.nodeVoltages?.[net]) : null;
    }
    default: void doc; return null;
  }
}

const isOpticsKind = (k: SweepOutputKind): boolean => OPTICS_OUTPUTS.includes(k);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runSweep(doc: ObwDocument, spec: SweepSpec, deps: SweepDeps, hooks: SweepHooks = {}): Promise<SweepResult> {
  const t0 = Date.now();
  const values = sweepValues(spec.start, spec.stop, spec.steps, spec.scale);
  const points: SweepPoint[] = [];
  const wantOptics = spec.outputs.some((o) => isOpticsKind(o.kind));
  const wantCircuit = spec.outputs.some((o) => !isOpticsKind(o.kind));
  const linked = (doc.links?.length ?? 0) > 0;
  // circuit changes reach optics only through links; optics changes reach the circuit only through links
  const useCosim = linked && !!deps.createCoSim && (wantCircuit || spec.target.domain === 'circuit');
  const samples = Math.max(2, Math.min(5000, Math.round(spec.samples ?? 100)));
  const settle = Math.max(1e-9, spec.settle);
  const firstPinCache = new Map<string, string | undefined>();
  let cancelled = false;

  for (let i = 0; i < values.length; i++) {
    if (hooks.cancelled?.()) { cancelled = true; break; }
    const value = values[i];
    const d = applySweepValue(doc, spec.target, value);
    const outs: (number | null)[] = spec.outputs.map(() => null);
    let error: string | undefined;
    try {
      let trace: TraceResult | null = null;
      if (wantCircuit || useCosim) {
        const sums = spec.outputs.map(() => 0), counts = spec.outputs.map(() => 0);
        const step = (st: CircuitState, k: number): void => {
          if (k < samples / 2) return;
          // a component's first pin, from the state's pin map (insertion order = pin order)
          const fp = (id: string): string | undefined => {
            const known = firstPinCache.get(id);
            if (known) return known;
            const pref = `${id}:`;
            for (const kk in st.pinNets ?? {}) if (kk.startsWith(pref)) { const p = kk.slice(pref.length); firstPinCache.set(id, p); return p; }
            return undefined;
          };
          spec.outputs.forEach((o, j) => {
            if (isOpticsKind(o.kind)) return;
            const v = circuitSample(o, st, d, fp);
            if (v !== null) { sums[j] += v; counts[j]++; }
          });
        };
        const dt = settle / samples;
        if (useCosim) {
          const co = deps.createCoSim!(d);
          for (let k = 0; k < samples; k++) {
            const r = co.tick(dt);
            if (r.trace) trace = r.trace;
            step(r.circuit, k);
            if (hooks.yield) await hooks.yield();
            if (hooks.cancelled?.()) { cancelled = true; break; }
          }
          trace = trace ?? co.lastTrace ?? null;
        } else {
          const sim = deps.createSimulator(d.circuit);
          for (let k = 0; k < samples; k++) {
            const st = sim.step(dt);
            step(st, k);
            if (hooks.yield) await hooks.yield();
            if (hooks.cancelled?.()) { cancelled = true; break; }
          }
        }
        if (cancelled) break;
        spec.outputs.forEach((o, j) => { if (!isOpticsKind(o.kind)) outs[j] = counts[j] ? sums[j] / counts[j] : null; });
      }
      if (wantOptics) {
        if (!trace) trace = deps.trace(d.optics);
        spec.outputs.forEach((o, j) => { if (isOpticsKind(o.kind)) outs[j] = opticsOutput(o, trace, d); });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const p: SweepPoint = { index: i, value, outputs: outs, ...(error ? { error } : {}) };
    points.push(p);
    hooks.onPoint?.(p, i + 1, values.length);
    if (hooks.yield) await hooks.yield();
  }
  return { spec, values, points, cancelled, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sweepCsv(paramLabel: string, outputLabels: string[], points: SweepPoint[]): string {
  const rows = [[paramLabel, ...outputLabels].map(csvCell).join(',')];
  for (const p of points) rows.push([String(p.value), ...p.outputs.map((v) => (v === null ? '' : String(v)))].join(','));
  return rows.join('\r\n') + '\r\n';
}
