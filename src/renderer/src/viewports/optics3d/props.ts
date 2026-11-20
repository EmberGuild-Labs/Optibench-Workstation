import type { OpticsEngineAPI } from '@core/types';
import type { Optics3DEngineAPI, Trace3DResult } from '@core/types3d';
import type { OpticsViewportProps } from '../contracts';

export type CameraPreset = 'top' | 'front' | 'side' | 'iso';

export interface TimeView {
  /** 'steady' = continuous light; 'pulse' = only light whose time of flight lies in [t − pulseWidth, t]. */
  mode: 'steady' | 'pulse';
  /** Current simulated time since emission (s). */
  t: number;
  /** Pulse length (s). Default: 8 % of the latest segment start time t0 (≈ time of flight across the bench). */
  pulseWidth?: number;
  /** Pulse repetition period (s); > 0 draws every pulse in flight (front at t + k·period). */
  period?: number;
}

/**
 * Props of the 3D optics viewport: the 2D OpticsViewportProps minus `engine` / `trace`, plus the
 * 3D engine + trace. Everything else (scene, selection, display, tool, callbacks) is shared with
 * the 2D viewport so the shell can swap viewports with the same state.
 *
 * Notes
 *  - `view` (2D cx/cy/zoom) seeds the camera target and the Top preset's scale; the 3D camera is
 *    otherwise owned by the viewport and `onViewChange` is never called.
 *  - `display.showGrid` toggles the breadboard holes, `display.bloom` the bloom pass,
 *    `display.rayOpacity` is the light exposure. showNormals / showPolarization are ignored in 3D.
 *  - `tool`: 'select' (default), 'pan' (left-drag pans), 'place' (click places `placeType` on the
 *    beam plane). 'measure' behaves like 'select' in 3D.
 */
export interface Optics3DViewportProps extends Omit<OpticsViewportProps, 'engine' | 'trace'> {
  engine3d: Optics3DEngineAPI;
  trace3d: Trace3DResult | null;
  /** 2D engine: registry (labels, createComponent for palette drops) and wavelengthToRGB. */
  opticsEngine: OpticsEngineAPI;
  timeView?: TimeView;
  /** mm from the beam plane down to the table top (default 75). */
  tableDepth?: number;
  /** Initial label visibility (the in-canvas "Labels" button toggles it). Default true. */
  showLabels?: boolean;
  /** Camera preset used on mount. Default 'iso'. */
  initialCamera?: CameraPreset;
}
