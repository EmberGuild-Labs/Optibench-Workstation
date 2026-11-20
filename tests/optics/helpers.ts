import type { OpticalComponent, OpticsScene, OpticsSettings, ParamValue, RaySegment } from '../../src/core/types';
import { opticsEngine, trace, type DetailedTraceResult } from '../../src/core/optics';

export const DEG = Math.PI / 180;

let n = 0;
export function comp(type: string, x: number, y: number, rotationDeg = 0, props: Record<string, ParamValue> = {}, id?: string): OpticalComponent {
  const c = opticsEngine.createComponent(type, { x, y });
  c.id = id ?? `${type}_${n++}`;
  c.rotation = rotationDeg * DEG;
  Object.assign(c.props, props);
  return c;
}

export function scene(components: OpticalComponent[], settings: Partial<OpticsSettings> = {}): OpticsScene {
  return { components, settings: { ...opticsEngine.defaultSettings(), ...settings } };
}

export function run(components: OpticalComponent[], settings: Partial<OpticsSettings> = {}): DetailedTraceResult {
  return trace(scene(components, settings));
}

/** Single-ray laser. */
export function laser(x: number, y: number, rotationDeg = 0, props: Record<string, ParamValue> = {}, id = 'laser'): OpticalComponent {
  return comp('source.laser', x, y, rotationDeg, { rays: 1, power: 1, wavelength: 587.56, divergence: 0, ...props }, id);
}

export const dir = (s: RaySegment) => {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l = Math.hypot(dx, dy);
  return { x: dx / l, y: dy / l };
};
export const angleOf = (s: RaySegment) => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
export const len = (s: RaySegment) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
export const totalBalance = (r: DetailedTraceResult) => r.energy.detected + r.energy.absorbed + r.energy.escaped + r.energy.dropped;
