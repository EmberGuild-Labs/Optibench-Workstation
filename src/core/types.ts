/**
 * Optibench Workstation — shared contracts.
 *
 * This file is the single source of truth that the optics engine, circuit engine,
 * co-simulation bridge, project I/O and UI all code against. Engines are pure
 * TypeScript (no DOM, no Node APIs) so they can run in the renderer, in a Web Worker,
 * in a CLI, or later in a 3D build / macOS build unchanged.
 *
 * Units (always SI-ish, stated per field):
 *   optics positions  : millimetres (mm), +x right, +y DOWN (screen convention)
 *   angles            : radians, rotation positive = clockwise on screen (because +y is down)
 *   wavelength        : nanometres (nm)
 *   optical power     : watts (W)
 *   magnetic field    : tesla (T)
 *   circuit positions : grid units (1 unit = one grid cell, pins sit on integer coords)
 *   time              : seconds (s)
 */

export const APP_NAME = 'Optibench Workstation';
export const APP_VERSION = '0.1.0-beta';
export const FILE_EXTENSION = 'obw'; // Optibench Workstation project
export const FILE_MAGIC = 'optibench-workstation';
export const FORMAT_VERSION = 1;

export interface Vec2 { x: number; y: number }

// ---------------------------------------------------------------------------
// Generic component description (shared by optics + circuit registries)
// ---------------------------------------------------------------------------

export type ParamValue = number | string | boolean;

export interface ParamDef {
  key: string;
  label: string;
  kind: 'number' | 'boolean' | 'select' | 'string' | 'color' | 'wavelength';
  unit?: string;          // display unit, e.g. 'nm', 'mm', 'Ω', 'µF'
  min?: number;
  max?: number;
  step?: number;
  log?: boolean;          // slider should be logarithmic (resistances, capacitances…)
  options?: { value: string; label: string }[]; // for 'select'
  default: ParamValue;
  help?: string;          // tooltip text
  group?: string;         // inspector section, e.g. 'Geometry', 'Material', 'Electrical'
}

export interface ComponentDef {
  type: string;           // unique type id, e.g. 'prism.equilateral', 'resistor'
  label: string;          // 'Equilateral Prism'
  category: string;       // palette section, e.g. 'Sources', 'Lenses', 'Passive'
  description: string;    // one-paragraph physics/behaviour description shown in UI
  params: ParamDef[];
  /** Optional icon hint for the palette; UI may ignore. */
  icon?: string;
}

// ---------------------------------------------------------------------------
// Optics scene (2D for v0.1; the schema reserves z/3D fields for the future)
// ---------------------------------------------------------------------------

export interface OpticalComponent {
  id: string;
  type: string;                         // key into the optics registry
  name?: string;                        // user label
  position: Vec2;                       // mm
  rotation: number;                     // rad
  props: Record<string, ParamValue>;    // values for the registry ParamDefs
  locked?: boolean;
  /**
   * 3D pose extras (used when meta.dimension === '3d'). The 2D design is exactly the z = 0
   * "beam plane" slice: position.x/y map to world X/Y on the table, `rotation` is yaw about +Z.
   * Missing = { z: 0, pitch: 0, roll: 0 }. See src/core/types3d.ts.
   */
  pose3d?: { z: number; pitch: number; roll: number }; // mm, degrees, degrees
}

export interface OpticsSettings {
  maxBounces: number;            // max interactions per ray path (default 64)
  minIntensity: number;          // drop rays below this fraction of source power (default 1e-4)
  ambientMedium: string;         // material id, default 'air'
  raysPerSource: number;         // default ray budget per source (sources may override)
  temperatureC: number;          // affects some materials (default 20)
  spectralSamples: number;       // samples for broadband sources (default 24)
  /**
   * Wave optics (default false). Rays additionally carry optical path length, phase and a Jones
   * vector; detectors sum fields coherently (interference), narrow apertures diffract.
   */
  waveMode?: boolean;
}

export interface OpticsScene {
  components: OpticalComponent[];
  settings: OpticsSettings;
}

/** One straight piece of a traced ray path, ready to draw. */
export interface RaySegment {
  a: Vec2;                 // start (mm)
  b: Vec2;                 // end (mm)
  wavelength: number;      // nm
  power: number;           // W carried by this ray
  /** Linear polarization state summary for visualisation: angle of major axis (rad) & degree (0..1). */
  polAngle?: number;
  polDegree?: number;
  sourceId: string;
  depth: number;           // interaction count
  /** Rays inside a medium other than ambient (for subtle visual differentiation). */
  inMedium?: boolean;
  /** Time since emission (s) at which light reaches `a` / `b` (group velocity; fibre delay included). */
  t0?: number;
  t1?: number;
}

export interface DetectorReading {
  power: number;                     // total W absorbed by the detector
  /** Optional 1D intensity profile across the detector face (for screens/cameras), arbitrary bins. */
  profile?: number[];
  /** Optional spectrum: power per wavelength bin; bins given by spectrumRange. */
  spectrum?: number[];
  spectrumRange?: [number, number];  // nm
  /** Per-ray hit points for drawing spots on screens. */
  hits?: { p: Vec2; wavelength: number; power: number }[];
  /** Linear sRGB colour profile matching `profile`: flat [r0,g0,b0, r1,g1,b1, ...] (screens / cameras). */
  profileRGB?: number[];
  /**
   * Polarimeter: s0 in W; s1..s3 normalised by s0 (-1..1; s1 = p vs s, s2 = +45 vs -45 deg,
   * s3 > 0 right-circular); dop 0..1; azimuth and ellipticity angle in radians.
   */
  stokes?: { s0: number; s1: number; s2: number; s3: number; dop: number; azimuth: number; ellipticity: number };
  /** Wavemeter: power-weighted mean vacuum wavelength (nm) and FWHM linewidth estimate (nm). */
  meanWavelength?: number;
  linewidth?: number;
  /** Solar concentrator: flux concentration at the absorber (geometric ratio x optical efficiency). */
  concentration?: number;
}

export interface TraceResult {
  segments: RaySegment[];
  detectors: Record<string, DetectorReading>;
  stats: { rays: number; segments: number; ms: number };
}

/**
 * Values injected by the co-simulation bridge before each trace.
 * Keys are optical component ids.
 */
export interface OpticsDrive {
  /** Multiplies a source's configured power (0..∞). 0 = off. Missing = 1. */
  sourceScale?: Record<string, number>;
  /** Override numeric props of components at runtime (e.g. B-field of an electromagnet in T). */
  propOverrides?: Record<string, Record<string, number>>;
  /**
   * Simulation time in seconds. When given, time-dependent components (chopper wheel, modulated
   * laser) are evaluated at this instant; when omitted they use their time average.
   */
  time?: number;
}

/** Drawable outline for rendering + hit-testing, in WORLD coordinates (mm). */
export interface ComponentGeometry {
  /** Closed or open polylines. Curved surfaces are pre-tessellated. */
  paths: { points: Vec2[]; closed: boolean; role: 'body' | 'surface' | 'mirror' | 'absorber' | 'detector' | 'emitter' | 'aperture' | 'decor' }[];
  /** Material hint for rendering glass tint etc. */
  material?: string;
  /** Axis-aligned bounds in world mm. */
  bounds: { min: Vec2; max: Vec2 };
  /** Extra handles for interactive editing (e.g. fiber end points), world mm. */
  handles?: { key: string; p: Vec2 }[];
}

/** Interface the optics engine module (src/core/optics/index.ts) must export. */
export interface OpticsEngineAPI {
  registry: ComponentDef[];
  defaultSettings(): OpticsSettings;
  createComponent(type: string, position: Vec2): OpticalComponent;
  getGeometry(c: OpticalComponent): ComponentGeometry;
  trace(scene: OpticsScene, drive?: OpticsDrive): TraceResult;
  materials: { id: string; label: string }[];
  /** CIE-based conversion for rendering. Returns linear-ish sRGB 0..1. */
  wavelengthToRGB(nm: number): [number, number, number];
}

// ---------------------------------------------------------------------------
// Circuit scene
// ---------------------------------------------------------------------------

export interface PinDef {
  name: string;          // 'A', 'K', '+', '-', 'P1', 'seg_a' …
  offset: Vec2;          // integer grid offset from component origin at rotation 0
}

export interface CircuitComponentDef extends ComponentDef {
  pins: PinDef[] | ((props: Record<string, ParamValue>) => PinDef[]);
  /** Body footprint in grid units at rotation 0, relative to origin. */
  size: { w: number; h: number; ox: number; oy: number };
  /** Whether the component is interactive during simulation (switch, button, pot). */
  interactive?: boolean;
}

export interface CircuitComponent {
  id: string;
  type: string;
  name?: string;                         // reference designator, e.g. 'R1'
  position: Vec2;                        // grid units (integers)
  rotation: 0 | 1 | 2 | 3;               // quarter turns clockwise
  mirrored?: boolean;
  props: Record<string, ParamValue>;
}

/** A wire is a polyline on the grid. Nets are formed by shared points / pins. */
export interface Wire {
  id: string;
  points: Vec2[];          // integer grid points, orthogonal segments preferred
  color?: string;          // user cable colour
  label?: string;          // net label
}

export interface CircuitScene {
  components: CircuitComponent[];
  wires: Wire[];
  settings: { timestep: number; simSpeed: number; gmin: number };
}

/** Live state of one component after a step — used by UI to draw LEDs, displays, meters. */
export interface CircuitComponentState {
  current?: number;                      // A through primary branch
  voltage?: number;                      // V across primary pins
  power?: number;                        // W dissipated
  brightness?: number;                   // 0..1 for LEDs / lamps
  segments?: number[];                   // 0..1 brightness per segment (7-seg: a..g,dp) or per matrix cell (row-major)
  on?: boolean;                          // switch / relay state
  text?: string;                         // meter readout etc.
  [k: string]: unknown;
}

export interface CircuitState {
  time: number;
  nodeVoltages: Record<string, number>;          // keyed by net id
  pinNets: Record<string, string>;               // `${componentId}:${pinName}` -> net id
  components: Record<string, CircuitComponentState>;
  converged: boolean;
  error?: string;
}

/** Interface the circuit engine module (src/core/circuit/index.ts) must export. */
export interface CircuitEngineAPI {
  registry: CircuitComponentDef[];
  defaultSettings(): CircuitScene['settings'];
  createComponent(type: string, position: Vec2): CircuitComponent;
  /** World-space pin positions (grid units) honouring rotation/mirroring. */
  getPinPositions(c: CircuitComponent): { name: string; p: Vec2 }[];
  /** Create a simulator instance for a scene. Rebuild when topology changes. */
  createSimulator(scene: CircuitScene): CircuitSimulator;
}

export interface CircuitSimulator {
  /** Advance simulated time by `dt` seconds (internally sub-steps as needed). */
  step(dt: number): CircuitState;
  /** Toggle / press interactive components. */
  interact(componentId: string, action: 'toggle' | 'press' | 'release' | { set: number }): void;
  /** Inject external quantities (photodiode light power in W, etc.). */
  setExternal(componentId: string, key: string, value: number): void;
  /** Update a component's props without rebuilding (value tweaks while running). */
  updateProps(componentId: string, props: Record<string, ParamValue>): void;
  reset(): void;
  getState(): CircuitState;
}

// ---------------------------------------------------------------------------
// Opto-electronic links (circuit <-> optics co-simulation)
// ---------------------------------------------------------------------------

/**
 * emitter  : circuit component current/brightness drives an optical source's power
 *            (circuit 'laser_diode' / 'led_emitter' -> optics 'source.*')
 * detector : optical detector power feeds a circuit photodiode/LDR/solar cell
 *            (optics 'detector.*' -> circuit 'photodiode' etc.)
 * actuator : circuit quantity drives an optical prop (e.g. coil current -> Faraday B-field,
 *            voltage -> Pockels/LC modulator, servo -> mirror angle)
 */
export interface OptoLink {
  id: string;
  kind: 'emitter' | 'detector' | 'actuator';
  circuitId: string;
  opticsId: string;
  /** For actuators: which optical prop to drive and the gain (prop = gain * circuit quantity + offset). */
  targetProp?: string;
  gain?: number;
  offset?: number;
  /**
   * For actuators: which circuit quantity drives the prop. 'current' (A), 'voltage' (V), 'angle'
   * (state.angleDeg of a servo / motor, degrees), 'speed' (state.speed, rad/s), 'brightness' (0..1).
   * Default: current for coils / inductors, angle for a servo or motor driving 'rotation', else voltage.
   * The special targetProp 'rotation' turns the optical component: rotation in DEGREES = gain * quantity + offset.
   */
  source?: 'current' | 'voltage' | 'angle' | 'speed' | 'brightness';
}

// ---------------------------------------------------------------------------
// Project document (.obw)
// ---------------------------------------------------------------------------

export interface ViewState { cx: number; cy: number; zoom: number }

export interface ObwDocument {
  format: typeof FILE_MAGIC;
  version: number;                 // FORMAT_VERSION
  meta: {
    title: string;
    description?: string;
    author?: string;
    created: string;               // ISO date
    modified: string;              // ISO date
    appVersion: string;
    /** Reserved: '2d' now, '3d' in a future version. */
    dimension: '2d' | '3d';
  };
  optics: OpticsScene;
  circuit: CircuitScene;
  links: OptoLink[];
  view?: { optics?: ViewState; circuit?: ViewState; activeTab?: 'optics' | 'circuit' | 'split' };
}
