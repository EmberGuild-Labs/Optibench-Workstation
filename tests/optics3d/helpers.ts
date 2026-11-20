import type { OpticalComponent, OpticsSettings, RaySegment } from '../../src/core/types';
import type { Ray3Segment } from '../../src/core/types3d';
import { trace } from '../../src/core/optics';
import { trace3D } from '../../src/core/optics3d';
import { scene } from '../optics/helpers';

export { comp, laser, scene, DEG } from '../optics/helpers';

export const run2 = (components: OpticalComponent[], settings: Partial<OpticsSettings> = {}) => trace(scene(components, settings));
export const run3 = (components: OpticalComponent[], settings: Partial<OpticsSettings> = {}) => trace3D(scene(components, settings));

export const dir3 = (s: Ray3Segment) => {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z, l = Math.hypot(dx, dy, dz);
  return { x: dx / l, y: dy / l, z: dz / l };
};

/** Largest deviations between a 2D trace and the z = 0 3D trace of the same scene (segment by segment). */
export function compare(components: OpticalComponent[], settings: Partial<OpticsSettings> = {}) {
  const a = run2(components, settings), b = run3(components, settings);
  let pos = 0, pow = 0, z = 0, pol = 0;
  const n = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < n; i++) {
    const s: RaySegment = a.segments[i], t = b.segments[i];
    pos = Math.max(pos, Math.abs(s.a.x - t.a.x), Math.abs(s.a.y + t.a.y), Math.abs(s.b.x - t.b.x), Math.abs(s.b.y + t.b.y));
    z = Math.max(z, Math.abs(t.a.z), Math.abs(t.b.z));
    pow = Math.max(pow, Math.abs(s.power - t.power));
    if ((s.polDegree ?? 0) > 1e-6) {
      let d = (s.polAngle ?? 0) - (t.polAngle ?? 0);
      d -= Math.PI * Math.round(d / Math.PI);
      pol = Math.max(pol, Math.abs(d) * (s.polDegree ?? 0), Math.abs((s.polDegree ?? 0) - (t.polDegree ?? 0)));
    }
  }
  return { n2: a.segments.length, n3: b.segments.length, pos, pow, z, pol, a, b };
}
