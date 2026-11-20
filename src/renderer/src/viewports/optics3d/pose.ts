/**
 * Document pose  <->  3D world mapping (pure, no three.js dependency).
 *
 * Contract (src/core/types3d.ts):
 *   world X = position.x          world Y = −position.y          world Z = pose3d.z
 *   yaw (about +Z, rad) = −rotation
 *   orientation = Rz(yaw) · Ry(pitch) · Rx(roll),  pitch/roll in DEGREES in the document.
 *
 * Every edit the 3D viewport makes goes through these helpers so the round trip is exact.
 */
import type { OpticalComponent, Vec2 } from '@core/types';
import type { Pose3D, Vec3 } from '@core/types3d';

export const DEG = Math.PI / 180;

export interface WorldPose {
  /** world position (mm) */
  p: Vec3;
  /** radians */
  yaw: number;
  pitch: number;
  roll: number;
}

export function pose3dOf(c: OpticalComponent): Pose3D {
  const q = c.pose3d;
  return { z: num(q?.z), pitch: num(q?.pitch), roll: num(q?.roll) };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Document position (2D x/y + pose3d.z) -> world position. */
export function docToWorldPos(position: Vec2, z: number): Vec3 {
  return { x: position.x, y: -position.y, z };
}

/** World position -> document {position, z}. */
export function worldToDocPos(p: Vec3): { position: Vec2; z: number } {
  return { position: { x: p.x, y: zero(-p.y) }, z: p.z };
}

const zero = (v: number) => (Object.is(v, -0) ? 0 : v);

export function worldPoseOf(c: OpticalComponent): WorldPose {
  const q = pose3dOf(c);
  return {
    p: docToWorldPos(c.position, q.z),
    yaw: zero(-num(c.rotation)),
    pitch: q.pitch * DEG,
    roll: q.roll * DEG,
  };
}

/** Return a copy of `c` placed at the given world pose (angles in radians). Unchanged fields are kept by reference. */
export function applyWorldPose(c: OpticalComponent, w: WorldPose): OpticalComponent {
  const { position, z } = worldToDocPos(w.p);
  return {
    ...c,
    position,
    rotation: zero(-w.yaw),
    pose3d: { z, pitch: roundAngle(w.pitch / DEG), roll: roundAngle(w.roll / DEG) },
  };
}

/** Kill float fuzz like 14.999999999 from deg<->rad conversion (1e-9 deg resolution). */
function roundAngle(d: number): number {
  const r = Math.round(d * 1e9) / 1e9;
  return zero(r);
}

/** Wrap an angle in radians to (−π, π]. */
export function wrapPi(a: number): number {
  let r = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (r <= -Math.PI + 1e-12) r = Math.PI;
  return r;
}

/** Wrap an angle in degrees to (−180, 180]. */
export function wrapDeg(d: number): number {
  return wrapPi(d * DEG) / DEG;
}

/** Row-major 3x3 rotation matrix R = Rz(yaw)·Ry(pitch)·Rx(roll) (radians). */
export function rotationMatrix(yaw: number, pitch: number, roll: number): number[] {
  const cz = Math.cos(yaw), sz = Math.sin(yaw);
  const cy = Math.cos(pitch), sy = Math.sin(pitch);
  const cx = Math.cos(roll), sx = Math.sin(roll);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function mul(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/** Component-local point (local +x = 2D +x, local y = −2D local y, z up) -> world. */
export function localToWorld(c: OpticalComponent, l: Vec3): Vec3 {
  const w = worldPoseOf(c);
  const r = mul(rotationMatrix(w.yaw, w.pitch, w.roll), l);
  return { x: w.p.x + r.x, y: w.p.y + r.y, z: w.p.z + r.z };
}

/** World point -> component-local. */
export function worldToLocal(c: OpticalComponent, p: Vec3): Vec3 {
  const w = worldPoseOf(c);
  const m = rotationMatrix(w.yaw, w.pitch, w.roll);
  const d = { x: p.x - w.p.x, y: p.y - w.p.y, z: p.z - w.p.z };
  // transpose
  return {
    x: m[0] * d.x + m[3] * d.y + m[6] * d.z,
    y: m[1] * d.x + m[4] * d.y + m[7] * d.z,
    z: m[2] * d.x + m[5] * d.y + m[8] * d.z,
  };
}

/**
 * Rotation axes the gizmo rings rotate about (world space, unit vectors). Changing one Euler
 * angle of R = Rz(yaw)·Ry(pitch)·Rx(roll) is exactly a rotation about:
 *   yaw   -> world +Z
 *   pitch -> Rz(yaw)·ŷ            ("local Y" after yaw)
 *   roll  -> Rz(yaw)·Ry(pitch)·x̂  (fully local X — the component's optical axis)
 */
export function rotationAxes(yaw: number, pitch: number): { yaw: Vec3; pitch: Vec3; roll: Vec3 } {
  const cz = Math.cos(yaw), sz = Math.sin(yaw), cy = Math.cos(pitch), sy = Math.sin(pitch);
  return {
    yaw: { x: 0, y: 0, z: 1 },
    pitch: { x: -sz, y: cz, z: 0 },
    roll: { x: cz * cy, y: sz * cy, z: -sy },
  };
}

// ---------------------------------------------------------------------------------- snapping

export interface SnapMods { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean }

/** Translation snap step (mm): 1 mm default, Shift = 10 mm, Ctrl/Cmd = none (0). */
export function translateStep(m: SnapMods): number {
  if (m.ctrlKey || m.metaKey) return 0;
  return m.shiftKey ? 10 : 1;
}

/** Rotation snap step (degrees): 1° default, Shift = 15°, Ctrl/Cmd = none (0). */
export function rotateStepDeg(m: SnapMods): number {
  if (m.ctrlKey || m.metaKey) return 0;
  return m.shiftKey ? 15 : 1;
}

export function snap(v: number, step: number): number {
  if (!(step > 0)) return v;
  return zero(Math.round(v / step) * step);
}
