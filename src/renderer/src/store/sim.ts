/** High-frequency simulation output (trace results, circuit state). Kept apart from the shell store. */
import { create } from 'zustand';
import type { CircuitState, OpticsScene, TraceResult } from '@core/types';
import type { Trace3DResult } from '@core/types3d';

export interface SimOutput {
  trace: TraceResult | null;
  /** Latest 3D trace (only produced while the optics workspace is in 3D mode). */
  trace3d: Trace3DResult | null;
  /** Wall-clock ms of the last 3D trace (worker round trip). */
  trace3dWallMs: number;
  circuit: CircuitState | null;
  /** Wall-clock ms of the last optics trace (worker round trip or in-thread). */
  traceWallMs: number;
  traceSource: 'worker' | 'main' | 'cosim' | null;
  /**
   * Simulated time (s) since Play from stopped / Reset, accumulated by the driver at
   * timeScale × wall time (independent of the circuit's internal step grid).
   */
  time: number;
  /**
   * Optics scene as currently driven by actuator links (rotations applied to copies); null when the
   * document scene is drawn as is. Never written back to the document.
   */
  drivenScene: OpticsScene | null;
  set(p: Partial<Omit<SimOutput, 'set'>>): void;
}

export const useSim = create<SimOutput>()((set) => ({
  trace: null,
  trace3d: null,
  trace3dWallMs: 0,
  circuit: null,
  traceWallMs: 0,
  traceSource: null,
  time: 0,
  drivenScene: null,
  set: (p) => set(p)
}));
