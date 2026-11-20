/**
 * Pure editing math for the 3D gizmo (no three.js): ray/axis projection, ray/plane hits,
 * ring angles and the scene transforms they produce. Unit-tested in __tests__/edit.test.ts.
 */
import type { OpticalComponent, OpticsScene } from '@core/types';
import type { Vec3 } from '@core/types3d';
import { applyWorldPose, DEG, rotationAxes, snap, worldPoseOf, wrapPi, type WorldPose } from './pose';

// ------------------------------------------------------------------------------ vec3
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return scale(a, 1 / l); };

export interface Ray { o: Vec3; d: Vec3 }

/**
 * Parameter t of the point on the line (p0 + t·axis) closest to the ray. This is what makes an
 * arrow drag follow the cursor exactly along the axis. Returns null when the ray is (nearly)
 * parallel to the axis — the caller should ignore that move.
 */
export function closestOnAxis(ray: Ray, p0: Vec3, axis: Vec3): number | null {
  const u = norm(axis), v = norm(ray.d), w0 = sub(p0, ray.o);
  const b = dot(u, v), d = dot(u, w0), e = dot(v, w0);
  const den = 1 - b * b;
  if (den < 1e-6) return null;
  return (b * e - d) / den;
}

/** Ray–plane intersection (plane through p0 with normal n). null when parallel or behind the ray. */
export function rayPlane(ray: Ray, p0: Vec3, n: Vec3): Vec3 | null {
  const den = dot(n, ray.d);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(p0, ray.o), n) / den;
  if (t < 0) return null;
  return add(ray.o, scale(ray.d, t));
}

/** Signed angle (rad) of point p around `axis` through `c`, measured from reference direction `ref` (⊥ axis). */
export function angleAround(p: Vec3, c: Vec3, axis: Vec3, ref: Vec3): number {
  const a = norm(axis);
  const d = sub(p, c);
  const inPlane = sub(d, scale(a, dot(d, a)));
  const r = norm(sub(ref, scale(a, dot(ref, a))));
  const s = cross(a, r);
  return Math.atan2(dot(inPlane, s), dot(inPlane, r));
}

/** Any unit vector perpendicular to `a`. */
export function perpendicular(a: Vec3): Vec3 {
  const n = norm(a);
  const t = Math.abs(n.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
  return norm(cross(t, n));
}

// ------------------------------------------------------------------------------ scene edits

export type AxisKey = 'x' | 'y' | 'z';
export type PlaneKey = 'xy' | 'xz' | 'yz';
export type RingKey = 'yaw' | 'pitch' | 'roll';
export type HandleKey = AxisKey | PlaneKey | RingKey;

export const AXIS_VEC: Record<AxisKey, Vec3> = { x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) };
export const PLANE_NORMAL: Record<PlaneKey, Vec3> = { xy: v3(0, 0, 1), xz: v3(0, 1, 0), yz: v3(1, 0, 0) };
export const PLANE_AXES: Record<PlaneKey, AxisKey[]> = { xy: ['x', 'y'], xz: ['x', 'z'], yz: ['y', 'z'] };

export function isRing(k: HandleKey): k is RingKey { return k === 'yaw' || k === 'pitch' || k === 'roll'; }
export function isPlane(k: HandleKey): k is PlaneKey { return k === 'xy' || k === 'xz' || k === 'yz'; }

/**
 * Translate the selected (unlocked) components of `base` by a world delta. The anchor (primary)
 * component's resulting world coordinates are snapped on the moved axes (absolute grid), and the
 * same corrected delta is applied to all others so relative spacing is preserved.
 */
export function translateComponents(
  base: OpticsScene, ids: ReadonlySet<string>, anchorId: string, delta: Vec3, axes: AxisKey[], step: number,
): { scene: OpticsScene; delta: Vec3 } {
  const anchor = base.components.find((c) => c.id === anchorId);
  let d = { ...delta };
  if (anchor) {
    const p0 = worldPoseOf(anchor).p;
    for (const k of ['x', 'y', 'z'] as AxisKey[]) {
      if (!axes.includes(k)) { d[k] = 0; continue; }
      d[k] = snap(p0[k] + d[k], step) - p0[k];
    }
  }
  const components = base.components.map((c) => {
    if (!ids.has(c.id) || c.locked) return c;
    const w = worldPoseOf(c);
    return applyWorldPose(c, { ...w, p: add(w.p, d) });
  });
  return { scene: { ...base, components }, delta: d };
}

/**
 * Rotate the selected components about one of their Euler axes by `deltaRad` (relative to `base`).
 * With a snap step the anchor's resulting angle is snapped to absolute multiples of the step.
 * For yaw with several components, positions also orbit around `pivot` (rigid group rotation in
 * the table plane). Pitch / roll are applied per component about its own origin.
 */
export function rotateComponents(
  base: OpticsScene, ids: ReadonlySet<string>, anchorId: string, ring: RingKey, deltaRad: number, stepDeg: number, pivot?: Vec3,
): { scene: OpticsScene; delta: number; value: number } {
  const anchor = base.components.find((c) => c.id === anchorId);
  let delta = deltaRad;
  let value = 0;
  if (anchor) {
    const w = worldPoseOf(anchor);
    const cur = w[ring];
    const target = stepDeg > 0 ? snap((cur + deltaRad) / DEG, stepDeg) * DEG : cur + deltaRad;
    delta = target - cur;
    value = wrapPi(target);
  }
  const movable = base.components.filter((c) => ids.has(c.id) && !c.locked);
  const orbit = ring === 'yaw' && movable.length > 1 && pivot;
  const cs = Math.cos(delta), sn = Math.sin(delta);
  const components = base.components.map((c) => {
    if (!ids.has(c.id) || c.locked) return c;
    const w = worldPoseOf(c);
    const next: WorldPose = { ...w, [ring]: wrapPi(w[ring] + delta) };
    if (orbit) {
      const dx = w.p.x - pivot.x, dy = w.p.y - pivot.y;
      next.p = { x: pivot.x + dx * cs - dy * sn, y: pivot.y + dx * sn + dy * cs, z: w.p.z };
    }
    return applyWorldPose(c, next);
  });
  return { scene: { ...base, components }, delta, value };
}

/** World-space rotation axis for a ring of component `c`. */
export function ringAxis(c: OpticalComponent, ring: RingKey): Vec3 {
  const w = worldPoseOf(c);
  return rotationAxes(w.yaw, w.pitch)[ring];
}

/** Nudge (keyboard): world delta in mm applied to selected unlocked components (no snapping). */
export function nudgeComponents(base: OpticsScene, ids: ReadonlySet<string>, d: Vec3): OpticsScene {
  return {
    ...base,
    components: base.components.map((c) => {
      if (!ids.has(c.id) || c.locked) return c;
      const w = worldPoseOf(c);
      return applyWorldPose(c, { ...w, p: add(w.p, d) });
    }),
  };
}

export const HANDLE_LABEL: Record<HandleKey, string> = {
  x: 'X', y: 'Y', z: 'Z', xy: 'XY', xz: 'XZ', yz: 'YZ', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll',
};
