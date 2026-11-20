/**
 * 3D frames and coordinate conventions (see src/core/types3d.ts — the contract).
 *
 *   world X = 2D x, world Y = −2D y, world Z = height above the beam plane (mm, right-handed, Z up)
 *   yaw about +Z = −(2D rotation);  orientation = Rz(yaw) · Ry(pitch) · Rx(roll)
 *   component LOCAL frame: +x = 2D local +x (light travels along it), y = −(2D local y), z = up.
 *
 * Positive pitch tips local +x DOWN (towards −Z; right-hand rule about +Y), so a flat mirror
 * (normal along local x) with pitch = +45° sends a beam travelling along +X straight up (+Z).
 *
 * Internally the engine works in the "L2" frame of a part: axes (X, Y2, Z) with Y2 = −Y, i.e. the
 * 2D engine's local (x, y) plus height. Every 2D primitive can then be used verbatim. L2 is
 * left-handed, so it is only ever used for dot products (point / vector transforms); all cross
 * products (polarization bases) are evaluated in world coordinates.
 */
import type { OpticalComponent, OpticsScene, Vec2 } from '../types';
import type { Pose3D, Vec3 } from '../types3d';

export const DEG = Math.PI / 180;

export const to3D = (p2: Vec2, z = 0): Vec3 => ({ x: p2.x, y: -p2.y, z });
export const from3D = (p: Vec3): Vec2 => ({ x: p.x, y: -p.y });

const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Yaw about world +Z (radians) of a component = −(2D rotation). */
export const yawOf = (c: Pick<OpticalComponent, 'rotation'>): number => -fin(c.rotation);

export function poseOf(c: Pick<OpticalComponent, 'pose3d'>): Pose3D {
  const p = c.pose3d;
  return { z: fin(p?.z), pitch: fin(p?.pitch), roll: fin(p?.roll) };
}

/** Orthonormal frame: origin + axes expressed in world coordinates. */
export interface Frame { o: Vec3; X: Vec3; Y: Vec3; Z: Vec3 }

/** Contract-local (right-handed) frame from a 2D position / rotation plus 3D extras. */
export function frameFrom(pos2: Vec2, rot2: number, z: number, pitchDeg: number, rollDeg: number): Frame {
  const yaw = -fin(rot2), p = fin(pitchDeg) * DEG, r = fin(rollDeg) * DEG;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  return {
    o: { x: fin(pos2?.x), y: -fin(pos2?.y), z: fin(z) },
    X: { x: cy * cp, y: sy * cp, z: -sp },
    Y: { x: -sy * cr + cy * sp * sr, y: cy * cr + sy * sp * sr, z: cp * sr },
    Z: { x: sy * sr + cy * sp * cr, y: -cy * sr + sy * sp * cr, z: cp * cr },
  };
}

export function frameOf(c: OpticalComponent): Frame {
  const p = poseOf(c);
  return frameFrom(c.position ?? { x: 0, y: 0 }, c.rotation, p.z, p.pitch, p.roll);
}

/** The internal L2 frame (x, 2D-y, z) of a contract frame. */
export const l2Of = (f: Frame): Frame => ({ o: f.o, X: f.X, Y: { x: -f.Y.x, y: -f.Y.y, z: -f.Y.z }, Z: f.Z });

export function framePoint(f: Frame, x: number, y: number, z: number): Vec3 {
  return {
    x: f.o.x + f.X.x * x + f.Y.x * y + f.Z.x * z,
    y: f.o.y + f.X.y * x + f.Y.y * y + f.Z.y * z,
    z: f.o.z + f.X.z * x + f.Y.z * y + f.Z.z * z,
  };
}
export function frameVec(f: Frame, x: number, y: number, z: number): Vec3 {
  return {
    x: f.X.x * x + f.Y.x * y + f.Z.x * z,
    y: f.X.y * x + f.Y.y * y + f.Z.y * z,
    z: f.X.z * x + f.Y.z * y + f.Z.z * z,
  };
}
export function frameInv(f: Frame, p: Vec3): Vec3 {
  const x = p.x - f.o.x, y = p.y - f.o.y, z = p.z - f.o.z;
  return {
    x: x * f.X.x + y * f.X.y + z * f.X.z,
    y: x * f.Y.x + y * f.Y.y + z * f.Y.z,
    z: x * f.Z.x + y * f.Z.y + z * f.Z.z,
  };
}

export const localToWorld = (c: OpticalComponent, p: Vec3): Vec3 => framePoint(frameOf(c), p.x, p.y, p.z);
export const worldToLocal = (c: OpticalComponent, p: Vec3): Vec3 => frameInv(frameOf(c), p);

/**
 * 2D → 3D: gives every component a `pose3d` (default {z:0,pitch:0,roll:0}). Existing poses are kept
 * (sanitised), so the conversion is idempotent. No other data changes: the 2D design is the z = 0 slice.
 */
export function convert2Dto3D(scene: OpticsScene): OpticsScene {
  return { ...scene, components: (scene.components ?? []).map((c) => ({ ...c, pose3d: poseOf(c) })) };
}

/**
 * 3D → 2D: drops `pose3d`. LOSSY — height (z), pitch and roll of every component are discarded and
 * the layout collapses onto the beam plane; a design that used height (periscopes, tilted mirrors)
 * will not trace the same way in 2D. 3D-only props (`height3d`, fibre `endZ` / `endPitch`,
 * `slitHeight`) are left in `props`; the 2D engine ignores them, so a later convert2Dto3D restores
 * everything except the poses.
 */
export function flatten3Dto2D(scene: OpticsScene): OpticsScene {
  return {
    ...scene,
    components: (scene.components ?? []).map((c) => {
      const { pose3d: _dropped, ...rest } = c;
      void _dropped;
      return rest;
    }),
  };
}
