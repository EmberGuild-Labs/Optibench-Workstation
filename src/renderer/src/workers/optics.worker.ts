/// <reference lib="webworker" />
/** Off-main-thread optics tracer for the live edit-mode preview. */
import { opticsEngine } from '@core/optics';
import type { OpticsDrive, OpticsScene, TraceResult } from '@core/types';

export interface TraceRequest { id: number; scene: OpticsScene; drive?: OpticsDrive }
export type TraceResponse =
  | { id: number; ok: true; result: TraceResult; ms: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<TraceRequest>) => {
  const { id, scene, drive } = ev.data;
  const t0 = performance.now();
  try {
    const result = opticsEngine.trace(scene, drive);
    const msg: TraceResponse = { id, ok: true, result, ms: performance.now() - t0 };
    ctx.postMessage(msg);
  } catch (e) {
    const msg: TraceResponse = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(msg);
  }
};
