/**
 * Contracts between the app shell (store, panels, menus) and the two editing viewports.
 * Viewports are self-contained React components that render a scene and turn pointer /
 * keyboard input into scene edits. They never own the document — the shell does.
 */
import type {
  OpticsScene, TraceResult, OpticalComponent, OpticsEngineAPI,
  CircuitScene, CircuitState, CircuitEngineAPI, OptoLink, ViewState, Vec2
} from '@core/types';

export interface EditOptions {
  /** true = push an undo entry (on pointer-up / discrete action); false = live preview during a drag. */
  commit: boolean;
  /** Human readable label for the undo history, e.g. 'Move Prism'. */
  label?: string;
}

/** Payload placed on dataTransfer under this MIME type when dragging from the palette. */
export const PALETTE_DND_MIME = 'application/x-optibench-component';
export interface PaletteDragPayload { domain: 'optics' | 'circuit'; type: string }

/** Persistent measure-tool annotation (world mm). distance: [a, b]; angle: [arm1, vertex, arm2]. */
export interface MeasureAnnotation { id: string; kind: 'distance' | 'angle'; points: Vec2[] }

export interface OpticsViewportProps {
  engine: OpticsEngineAPI;
  scene: OpticsScene;
  trace: TraceResult | null;
  selection: string[];                       // selected component ids
  view: ViewState;                           // cx, cy in mm, zoom = px per mm
  /** Ids of optics components that have an OptoLink (draw a small link badge). */
  linkedIds: Set<string>;
  /** Visual settings toggled from the View menu. */
  display: {
    showGrid: boolean;                       // optical table holes / grid
    bloom: boolean;
    rayOpacity: number;                      // 0..1 user exposure
    showNormals: boolean;
    showPolarization: boolean;
    /** Labels (power, λ) on beams leaving each component. */
    beamInfo?: boolean;
    /** ±w(z) Gaussian beam envelope along each laser's axis until the first interaction. */
    gaussianEnvelope?: boolean;
  };
  /**
   * Slow-motion light rendering. 'steady' (or omitted) = continuous light. 'pulse' = draw only light
   * whose time of flight (RaySegment t0/t1) lies in [t − pulseWidth, t] (pulseWidth may be Infinity
   * for a CW front), repeated every `period` seconds when > 0 (several pulses in flight).
   */
  timeView?: { mode: 'steady' | 'pulse'; t: number; pulseWidth?: number; period?: number };
  /** Persistent measure annotations to draw (owned by the shell). */
  measurements?: MeasureAnnotation[];
  selectedMeasurement?: string | null;
  /** Measure tool finished an annotation. */
  onMeasure?(m: Omit<MeasureAnnotation, 'id'>): void;
  /** Tool chosen in the toolbar. 'place' uses placeType. */
  tool: 'select' | 'pan' | 'measure' | 'place';
  placeType?: string;
  onSceneChange(next: OpticsScene, opts: EditOptions): void;
  onSelectionChange(ids: string[]): void;
  onViewChange(view: ViewState): void;
  /** Pointer position in world mm for the status bar. */
  onCursor?(p: Vec2 | null): void;
  onContextMenu?(componentId: string | null, screen: Vec2): void;
}

export interface CircuitViewportProps {
  engine: CircuitEngineAPI;
  scene: CircuitScene;
  state: CircuitState | null;                // live sim state (null when stopped)
  running: boolean;
  selection: string[];                       // component ids and wire ids
  view: ViewState;                           // cx, cy in grid units, zoom = px per grid unit
  linkedIds: Set<string>;
  display: {
    showGrid: boolean;
    animateCurrent: boolean;                 // moving dots along wires
    colorByVoltage: boolean;
  };
  tool: 'select' | 'pan' | 'wire' | 'place' | 'probe';
  placeType?: string;
  onSceneChange(next: CircuitScene, opts: EditOptions): void;
  onSelectionChange(ids: string[]): void;
  onViewChange(view: ViewState): void;
  /** Click on interactive component (switch/button/pot) while running. */
  onInteract(componentId: string, action: 'toggle' | 'press' | 'release' | { set: number }): void;
  onCursor?(p: Vec2 | null): void;
  onContextMenu?(id: string | null, screen: Vec2): void;
}

export type { OptoLink, OpticalComponent };
