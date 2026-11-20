/**
 * Optibench Workstation — 3D optics contracts (v0.1 "3D mode").
 *
 * World frame (mm, right-handed, Z UP from the table):
 *   world X =  2D x
 *   world Y = −2D y        (2D +y points down the screen; the top-down 3D camera looks from +Z
 *                            with X right and Y up, so it shows exactly the 2D picture)
 *   world Z = height above the beam plane (pose3d.z)
 *   yaw about +Z = −(2D rotation)   (2D rotation is clockwise-positive on screen)
 * Use the helpers in src/core/optics3d (to3D / from3D) rather than re-deriving this.
 *
 * The 2D scene is the z = 0 slice (the "beam plane"). The optical table surface is at
 * z = -tableDepth (default 75 mm, typical post height). Converting 2D → 3D therefore needs no data
 * change: every component gets pose3d = {z:0,pitch:0,roll:0} and is revolved/extruded into 3D.
 *
 * Orientation of a component = Rz(yaw) · Ry(pitch) · Rx(roll), applied to its LOCAL frame
 * (local +x = the component's 2D local +x, local y = −(2D local y), local z = up).
 * pitch/roll are in degrees; yaw derives from the 2D `rotation` (radians) as above.
 */
import type { OpticalComponent, OpticsScene, OpticsDrive, DetectorReading } from './types';

export interface Vec3 { x: number; y: number; z: number }

export interface Pose3D { z: number; pitch: number; roll: number }
export const DEFAULT_POSE3D: Pose3D = { z: 0, pitch: 0, roll: 0 };
export const DEFAULT_TABLE_DEPTH = 75; // mm below the beam plane

/** Indexed triangle mesh in WORLD mm, for rendering + picking. */
export interface Mesh3D {
  positions: Float32Array;   // xyz triplets
  normals: Float32Array;     // xyz triplets (per vertex)
  indices: Uint32Array;
  role: 'body' | 'surface' | 'mirror' | 'absorber' | 'detector' | 'emitter' | 'aperture' | 'decor' | 'mount';
  material?: string;         // optics material id for glass tint, or 'metal', 'anodized', 'rubber'…
}

export interface ComponentGeometry3D {
  meshes: Mesh3D[];
  bounds: { min: Vec3; max: Vec3 };
  /** Mechanical mount (post + holder) down to the table, role 'mount'. Included in meshes. */
  handles?: { key: string; p: Vec3 }[];
}

export interface Ray3Segment {
  a: Vec3; b: Vec3;
  wavelength: number;   // nm
  power: number;        // W
  sourceId: string;
  depth: number;
  /** Time of flight (s) at a and b measured from emission, using group index (for slow-motion pulses). */
  t0?: number; t1?: number;
  polAngle?: number; polDegree?: number;
  inMedium?: boolean;
}

export interface DetectorReading3D extends DetectorReading {
  /** 2D image on the detector face (row-major, w×h), power per pixel (W); rgb optional interleaved. */
  image?: { w: number; h: number; data: number[]; rgb?: number[] };
}

export interface Trace3DResult {
  segments: Ray3Segment[];
  detectors: Record<string, DetectorReading3D>;
  stats: { rays: number; segments: number; ms: number };
}

export interface Optics3DEngineAPI {
  getGeometry3D(c: OpticalComponent, tableDepth?: number): ComponentGeometry3D;
  trace3D(scene: OpticsScene, drive?: OpticsDrive): Trace3DResult;
  /** World transform helpers. */
  poseOf(c: OpticalComponent): Pose3D;
  localToWorld(c: OpticalComponent, p: Vec3): Vec3;
  worldToLocal(c: OpticalComponent, p: Vec3): Vec3;
}
