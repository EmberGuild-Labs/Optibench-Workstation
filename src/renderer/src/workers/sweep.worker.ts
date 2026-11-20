/// <reference lib="webworker" />
/** Off-main-thread parameter sweep: headless optics traces / circuit transients / co-simulation. */
import { opticsEngine } from '@core/optics';
import { circuitEngine } from '@core/circuit';
import { CoSimulator } from '@core/cosim';
import type { ObwDocument } from '@core/types';
import { runSweep, type SweepPoint, type SweepSpec } from '../lib/sweep';

export interface SweepRequest { id: number; doc: ObwDocument; spec: SweepSpec }
export type SweepMessage =
  | { id: number; type: 'point'; point: SweepPoint; done: number; total: number }
  | { id: number; type: 'done'; ms: number; cancelled: boolean }
  | { id: number; type: 'error'; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<SweepRequest>) => {
  const { id, doc, spec } = ev.data;
  try {
    const r = await runSweep(doc, spec, {
      trace: (scene) => opticsEngine.trace(scene),
      createSimulator: (scene) => circuitEngine.createSimulator(scene),
      // opticsInterval 0: re-trace whenever the co-sim drive changes (no wall-clock throttling headless)
      createCoSim: (d) => new CoSimulator(d, opticsEngine, circuitEngine, { opticsInterval: 0 })
    }, {
      onPoint: (point, done, total) => ctx.postMessage({ id, type: 'point', point, done, total } satisfies SweepMessage)
    });
    ctx.postMessage({ id, type: 'done', ms: r.ms, cancelled: r.cancelled } satisfies SweepMessage);
  } catch (e) {
    ctx.postMessage({ id, type: 'error', error: e instanceof Error ? e.message : String(e) } satisfies SweepMessage);
  }
};
