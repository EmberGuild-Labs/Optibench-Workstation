/// <reference lib="webworker" />
/** Off-main-thread 3D optics tracer (optics3dEngine.trace3D) for the 3D optics viewport. */
import { optics3dEngine } from '@core/optics3d';
import type { OpticsDrive, OpticsScene } from '@core/types';
import type { Trace3DResult } from '@core/types3d';

export interface Trace3DRequest { id: number; scene: OpticsScene; drive?: OpticsDrive }
export type Trace3DResponse =
  | { id: number; ok: true; result: Trace3DResult; ms: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<Trace3DRequest>) => {
  const { id, scene, drive } = ev.data;
  const t0 = performance.now();
  try {
    const r = optics3dEngine.trace3D(scene, drive);
    // keep only the contract fields (the detailed result may carry extra diagnostics)
    const result: Trace3DResult = { segments: r.segments, detectors: r.detectors, stats: r.stats };
    const msg: Trace3DResponse = { id, ok: true, result, ms: performance.now() - t0 };
    ctx.postMessage(msg);
  } catch (e) {
    const msg: Trace3DResponse = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(msg);
  }
};
