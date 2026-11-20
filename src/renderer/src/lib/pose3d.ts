/**
 * Inspector "3D Pose" mapping (pure). The document keeps 3D extras in `pose3d` = { z (mm),
 * pitch (deg), roll (deg) }; yaw is the 2D `rotation`. Missing pose = all zero.
 */
import type { OpticalComponent, OpticsScene } from '@core/types';

export type PoseKey = 'z' | 'pitch' | 'roll';
export const POSE_FIELDS: { key: PoseKey; label: string; unit: string; help: string }[] = [
  { key: 'z', label: 'Z (height)', unit: 'mm', help: 'Height above the z = 0 beam plane (world +Z up)' },
  { key: 'pitch', label: 'Pitch', unit: '°', help: 'Tilt about the local Y axis; positive tips local +x down' },
  { key: 'roll', label: 'Roll', unit: '°', help: 'Rotation about the local X (optical) axis' }
];

const fin = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function poseValues(c: Pick<OpticalComponent, 'pose3d'>): Record<PoseKey, number> {
  return { z: fin(c.pose3d?.z), pitch: fin(c.pose3d?.pitch), roll: fin(c.pose3d?.roll) };
}

/** Angles are normalised to (−180, 180]; non-finite input leaves the component unchanged. */
export function withPose(c: OpticalComponent, key: PoseKey, value: number): OpticalComponent {
  if (!Number.isFinite(value)) return c;
  let v = value;
  if (key !== 'z') {
    v = ((v % 360) + 360) % 360;
    if (v > 180) v -= 360;
    if (Math.abs(v) < 1e-12) v = 0;
  }
  const cur = poseValues(c);
  if (cur[key] === v && c.pose3d) return c;
  return { ...c, pose3d: { ...cur, [key]: v } };
}

/** True when a component sits off the beam plane or is tilted (2D shows only its z = 0 projection). */
export function hasOffPlanePose(c: Pick<OpticalComponent, 'pose3d'>): boolean {
  const p = poseValues(c);
  return Math.abs(p.z) > 1e-9 || Math.abs(p.pitch) > 1e-9 || Math.abs(p.roll) > 1e-9;
}

export function countOffPlane(scene: OpticsScene): number {
  return scene.components.reduce((n, c) => n + (hasOffPlanePose(c) ? 1 : 0), 0);
}

/**
 * Edits made on the actuator-driven display copy (servo / galvo rotations from the co-simulation)
 * must not bake the driven rotation into the document: for every component whose rotation was
 * driven and is still the driven value, restore the document rotation.
 */
export function undriveScene(next: OpticsScene, driven: OpticsScene | null, doc: OpticsScene): OpticsScene {
  if (!driven || driven === doc) return next;
  const dmap = new Map(driven.components.map((c) => [c.id, c]));
  const omap = new Map(doc.components.map((c) => [c.id, c]));
  let changed = false;
  const components = next.components.map((c) => {
    const d = dmap.get(c.id), o = omap.get(c.id);
    if (!d || !o || d.rotation === o.rotation || c.rotation !== d.rotation) return c;
    changed = true;
    return { ...c, rotation: o.rotation };
  });
  return changed ? { ...next, components } : next;
}
