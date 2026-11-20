/**
 * Parameter sweep state + runner glue. Runs in a Web Worker (sweep.worker.ts); if the worker cannot
 * start, falls back to the main thread in ~10 ms idle-time slices so the UI stays responsive.
 * The live document is never modified (except by "Apply value", which is one undo step).
 */
import { create } from 'zustand';
import type { ObwDocument } from '@core/types';
import { CoSimulator } from '@core/cosim';
import {
  OUTPUT_INFO, PSEUDO_PARAMS, applySweepValue, readSweepValue, runSweep, sweepCsv,
  type SweepOutput, type SweepPoint, type SweepSpec, type SweepTarget
} from '../lib/sweep';
import { circuitDef, circuitEngine, opticsDef, opticsEngine } from '../engines';
import { documentTitle, useApp } from './app';
import type { SweepMessage, SweepRequest } from '../workers/sweep.worker';

export type SweepStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface SweepState {
  /** Last configuration (dialog defaults). */
  spec: SweepSpec | null;
  /** Spec of the current / last run with display labels. */
  run: { spec: SweepSpec; paramLabel: string; paramUnit: string; outputLabels: string[]; outputUnits: string[]; docTitle: string } | null;
  status: SweepStatus;
  points: SweepPoint[];
  total: number;
  error: string | null;
  ms: number;
  selected: number | null;
  setSpec(s: SweepSpec): void;
  start(spec: SweepSpec): void;
  cancel(): void;
  select(i: number | null): void;
}

let worker: Worker | null = null;
let workerBroken = false;
let runId = 0;
let mainCancel = false;

function compLabel(doc: ObwDocument, domain: 'optics' | 'circuit', id: string): string {
  if (domain === 'optics') {
    const c = doc.optics.components.find((x) => x.id === id);
    return c?.name || opticsDef(c?.type ?? '')?.label || id;
  }
  const c = doc.circuit.components.find((x) => x.id === id);
  return c?.name || circuitDef(c?.type ?? '')?.label || id;
}

export function paramInfo(t: SweepTarget, doc: ObwDocument | null): { label: string; unit: string } {
  if (PSEUDO_PARAMS[t.param]) return PSEUDO_PARAMS[t.param];
  const type = t.domain === 'optics'
    ? doc?.optics.components.find((c) => c.id === t.id)?.type
    : doc?.circuit.components.find((c) => c.id === t.id)?.type;
  const def = type ? (t.domain === 'optics' ? opticsDef(type) : circuitDef(type)) : undefined;
  const pd = def?.params.find((p) => p.key === t.param);
  return { label: pd?.label ?? t.param, unit: pd?.unit ?? '' };
}

export function outputLabel(o: SweepOutput, doc: ObwDocument): string {
  const info = OUTPUT_INFO[o.kind];
  const name = compLabel(doc, info.domain, o.id);
  return `${info.label} (${name}${o.pin ? '.' + o.pin : ''})`;
}

const stopWorker = (): void => { worker?.terminate(); worker = null; };

export const useSweep = create<SweepState>()((set, get) => ({
  spec: null,
  run: null,
  status: 'idle',
  points: [],
  total: 0,
  error: null,
  ms: 0,
  selected: null,

  setSpec(spec) { set({ spec }); },

  start(spec) {
    const app = useApp.getState();
    const doc = app.doc;
    if (!doc) return;
    get().cancel();
    const id = ++runId;
    const pi = paramInfo(spec.target, doc);
    const info = {
      spec,
      paramLabel: `${compLabel(doc, spec.target.domain, spec.target.id)} · ${pi.label}`,
      paramUnit: pi.unit,
      outputLabels: spec.outputs.map((o) => outputLabel(o, doc)),
      outputUnits: spec.outputs.map((o) => OUTPUT_INFO[o.kind].unit),
      docTitle: documentTitle(app)
    };
    set({ spec, run: info, status: 'running', points: [], total: Math.max(1, Math.round(spec.steps)), error: null, ms: 0, selected: null });
    app.setUi({ dockOpen: true, dockTab: 'sweep' });
    app.log('info', 'sweep', `Sweep started: ${info.paramLabel} ${spec.start} → ${spec.stop} (${spec.steps} steps, ${spec.scale})`);
    const t0 = performance.now();
    const onPoint = (point: SweepPoint, _done: number, total: number): void => {
      if (id !== runId) return;
      set((s) => ({ points: [...s.points, point], total }));
      if (point.error) useApp.getState().log('warn', 'sweep', `Point ${point.index + 1} (${point.value.toPrecision(4)}): ${point.error}`);
    };
    const finish = (cancelled: boolean): void => {
      if (id !== runId) return;
      const ms = performance.now() - t0;
      set({ status: cancelled ? 'cancelled' : 'done', ms });
      useApp.getState().log('info', 'sweep', `Sweep ${cancelled ? 'cancelled' : 'finished'}: ${get().points.length} points in ${(ms / 1000).toFixed(2)} s`);
    };
    const fail = (msg: string): void => {
      if (id !== runId) return;
      set({ status: 'error', error: msg });
      useApp.getState().log('error', 'sweep', `Sweep failed: ${msg}`);
    };

    // structured clone of the document (worker message / main-thread copy): the live doc is never touched
    const snapshot = structuredClone(doc);
    if (!workerBroken) {
      try {
        worker = new Worker(new URL('../workers/sweep.worker.ts', import.meta.url), { type: 'module', name: 'parameter-sweep' });
        const w = worker;
        w.onmessage = (ev: MessageEvent<SweepMessage>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.type === 'point') onPoint(m.point, m.done, m.total);
          else if (m.type === 'done') { finish(m.cancelled); if (worker === w) stopWorker(); }
          else { fail(m.error); if (worker === w) stopWorker(); }
        };
        w.onerror = (ev) => {
          ev.preventDefault();
          if (worker === w) stopWorker();
          if (get().points.length === 0 && id === runId) {
            workerBroken = true;
            useApp.getState().log('warn', 'sweep', `Sweep worker failed (${ev.message || 'load error'}); running on the main thread.`);
            runMain(id, snapshot, spec, onPoint, finish, fail);
          } else fail(ev.message || 'worker error');
        };
        w.postMessage({ id, doc: snapshot, spec } satisfies SweepRequest);
        return;
      } catch (e) {
        workerBroken = true;
        useApp.getState().log('warn', 'sweep', `Sweep worker unavailable (${(e as Error).message}); running on the main thread.`);
      }
    }
    runMain(id, snapshot, spec, onPoint, finish, fail);
  },

  cancel() {
    if (get().status !== 'running') return;
    runId++;
    mainCancel = true;
    stopWorker();
    set({ status: 'cancelled' });
    useApp.getState().log('info', 'sweep', `Sweep cancelled after ${get().points.length} points`);
  },

  select(i) { set({ selected: i }); }
}));

/** Main-thread fallback: time-sliced so a long sweep never blocks input for more than ~12 ms. */
function runMain(id: number, doc: ObwDocument, spec: SweepSpec, onPoint: (p: SweepPoint, d: number, t: number) => void, finish: (c: boolean) => void, fail: (m: string) => void): void {
  mainCancel = false;
  let sliceStart = performance.now();
  const yieldFn = (): Promise<void> | void => {
    if (performance.now() - sliceStart < 12) return;
    return new Promise<void>((res) => {
      const go = (): void => { sliceStart = performance.now(); res(); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 50 });
      else setTimeout(go, 0);
    });
  };
  void runSweep(doc, spec, {
    trace: (s) => opticsEngine.trace(s),
    createSimulator: (s) => circuitEngine.createSimulator(s),
    createCoSim: (d) => new CoSimulator(d, opticsEngine, circuitEngine, { opticsInterval: 0 })
  }, { onPoint, yield: yieldFn, cancelled: () => mainCancel || id !== runId })
    .then((r) => finish(r.cancelled))
    .catch((e) => fail(e instanceof Error ? e.message : String(e)));
}

/** Set the swept parameter on the live document to the value of the selected point (one undo step). */
export function applySweepPoint(index: number): void {
  const sw = useSweep.getState();
  const p = sw.points[index];
  const app = useApp.getState();
  if (!p || !sw.run || !app.doc) return;
  const t = sw.run.spec.target;
  if (readSweepValue(app.doc, t) === null && !t.param.startsWith('@')) {
    app.log('warn', 'sweep', 'The swept component no longer exists.');
    return;
  }
  const next = applySweepValue(app.doc, t, p.value);
  app.mutate((snap) => ({ ...snap, optics: next.optics, circuit: next.circuit }), `Apply Sweep Value (${p.value.toPrecision(4)})`);
  app.setSelection(t.domain, [t.id]);
  app.log('info', 'sweep', `Applied ${sw.run.paramLabel} = ${p.value.toPrecision(6)}${sw.run.paramUnit ? ' ' + sw.run.paramUnit : ''}`);
}

export async function exportSweepCsv(): Promise<void> {
  const sw = useSweep.getState();
  const a = window.optibench;
  if (!sw.run || !sw.points.length || !a) return;
  const head = `${sw.run.paramLabel}${sw.run.paramUnit ? ` (${sw.run.paramUnit})` : ''}`;
  const cols = sw.run.outputLabels.map((l, i) => (sw.run!.outputUnits[i] ? `${l} (${sw.run!.outputUnits[i]})` : l));
  try {
    const p = await a.exportTextDialog(sweepCsv(head, cols, sw.points), `${sw.run.docTitle} - sweep`, 'csv');
    if (p) useApp.getState().log('info', 'sweep', `Exported ${p}`);
  } catch (e) {
    useApp.getState().log('error', 'sweep', `CSV export failed: ${(e as Error).message}`);
  }
}
