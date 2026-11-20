import { describe, expect, it } from 'vitest';
import { countOffPlane, hasOffPlanePose, poseValues, undriveScene, withPose, POSE_FIELDS } from '../../src/renderer/src/lib/pose3d';
import { beamRadius, envelopePaths, firstInteraction } from '../../src/renderer/src/viewports/optics/gaussian';
import { opticsEngine, gaussianBeamProfile } from '../../src/core/optics';
import { convert2Dto3D, flatten3Dto2D, frameOf } from '../../src/core/optics3d';
import type { OpticalComponent, OpticsScene } from '../../src/core/types';

const comp = (extra: Partial<OpticalComponent> = {}): OpticalComponent => ({
  id: 'm', type: 'mirror.flat', position: { x: 10, y: 20 }, rotation: 0.3, props: {}, ...extra
});

describe('3D pose inspector mapping', () => {
  it('reads missing / partial / garbage poses as zero', () => {
    expect(poseValues(comp())).toEqual({ z: 0, pitch: 0, roll: 0 });
    expect(poseValues(comp({ pose3d: { z: 5, pitch: NaN, roll: 'x' as unknown as number } }))).toEqual({ z: 5, pitch: 0, roll: 0 });
    expect(POSE_FIELDS.map((f) => f.key)).toEqual(['z', 'pitch', 'roll']);
  });
  it('writes one field and keeps the others and the 2D data', () => {
    const c = comp({ pose3d: { z: 1, pitch: 2, roll: 3 } });
    const z = withPose(c, 'z', 42);
    expect(z.pose3d).toEqual({ z: 42, pitch: 2, roll: 3 });
    expect(z.position).toBe(c.position);
    expect(z.rotation).toBe(c.rotation);
    expect(withPose(c, 'pitch', -10).pose3d).toEqual({ z: 1, pitch: -10, roll: 3 });
    expect(withPose(c, 'roll', 90).pose3d).toEqual({ z: 1, pitch: 2, roll: 90 });
    expect(c.pose3d).toEqual({ z: 1, pitch: 2, roll: 3 }); // immutable
  });
  it('normalises angles to (-180, 180] and ignores non-finite input', () => {
    expect(withPose(comp(), 'pitch', 270).pose3d!.pitch).toBe(-90);
    expect(withPose(comp(), 'roll', -190).pose3d!.roll).toBe(170);
    expect(withPose(comp(), 'roll', 180).pose3d!.roll).toBe(180);
    expect(withPose(comp(), 'pitch', 720).pose3d!.pitch).toBe(0);
    expect(withPose(comp(), 'z', -1000).pose3d!.z).toBe(-1000); // heights are not wrapped
    const c = comp();
    expect(withPose(c, 'z', NaN)).toBe(c);
    expect(withPose(c, 'z', Infinity)).toBe(c);
  });
  it('returns the same object when nothing changes', () => {
    const c = comp({ pose3d: { z: 1, pitch: 2, roll: 3 } });
    expect(withPose(c, 'z', 1)).toBe(c);
  });
  it('pitch edited in the inspector tips the 3D frame (engine convention)', () => {
    const c = withPose(comp({ rotation: 0, position: { x: 0, y: 0 } }), 'pitch', 45);
    const f = frameOf(c);
    // positive pitch tips local +x DOWN (towards -Z)
    expect(f.X.z).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(f.X.x).toBeCloseTo(Math.SQRT1_2, 12);
    const z = withPose(c, 'z', 30);
    expect(frameOf(z).o.z).toBe(30);
  });
  it('flags off-plane components for the 2D badge', () => {
    expect(hasOffPlanePose(comp())).toBe(false);
    expect(hasOffPlanePose(comp({ pose3d: { z: 0, pitch: 0, roll: 0 } }))).toBe(false);
    expect(hasOffPlanePose(comp({ pose3d: { z: 0.5, pitch: 0, roll: 0 } }))).toBe(true);
    expect(hasOffPlanePose(comp({ pose3d: { z: 0, pitch: 0, roll: -3 } }))).toBe(true);
    const scene: OpticsScene = { components: [comp(), comp({ id: 'b', pose3d: { z: 3, pitch: 0, roll: 0 } })], settings: opticsEngine.defaultSettings() };
    expect(countOffPlane(scene)).toBe(1);
  });
  it('2D -> 3D conversion is lossless and idempotent; poses survive a round trip through the 2D view', () => {
    const scene: OpticsScene = { components: [comp(), comp({ id: 'b', pose3d: { z: 3, pitch: 4, roll: 5 } })], settings: opticsEngine.defaultSettings() };
    const s3 = convert2Dto3D(scene);
    expect(s3.components[0].pose3d).toEqual({ z: 0, pitch: 0, roll: 0 });
    expect(s3.components[1].pose3d).toEqual({ z: 3, pitch: 4, roll: 5 });
    expect(convert2Dto3D(s3)).toEqual(s3);
    // the app never flattens when switching back to 2D (flatten is the explicit lossy export)
    expect(flatten3Dto2D(s3).components[1].pose3d).toBeUndefined();
  });
});

describe('actuator-driven display copy', () => {
  const doc: OpticsScene = { components: [comp({ id: 'a', rotation: 0.5 }), comp({ id: 'b', rotation: 1 })], settings: opticsEngine.defaultSettings() };
  const driven: OpticsScene = { ...doc, components: [{ ...doc.components[0], rotation: 0.9 }, doc.components[1]] };
  it('restores the document rotation of driven components', () => {
    // user moved component a in the live view (rotation still the driven one)
    const next: OpticsScene = { ...driven, components: [{ ...driven.components[0], position: { x: 99, y: 0 } }, driven.components[1]] };
    const r = undriveScene(next, driven, doc);
    expect(r.components[0].rotation).toBe(0.5);
    expect(r.components[0].position.x).toBe(99);
    expect(r.components[1]).toBe(driven.components[1]);
  });
  it('keeps an explicit rotation edit and passes through without a driven scene', () => {
    const next: OpticsScene = { ...driven, components: [{ ...driven.components[0], rotation: 2 }, driven.components[1]] };
    expect(undriveScene(next, driven, doc).components[0].rotation).toBe(2);
    expect(undriveScene(next, null, doc)).toBe(next);
  });
});

describe('Gaussian beam envelope', () => {
  it('w(z) follows the Rayleigh law', () => {
    const p = { waistPos: 10, w0: 0.5, zR: 100 };
    expect(beamRadius(10, p)).toBe(0.5);
    expect(beamRadius(110, p)).toBeCloseTo(0.5 * Math.SQRT2, 12);
    expect(beamRadius(-90, p)).toBeCloseTo(0.5 * Math.SQRT2, 12);
  });
  it('builds envelopes for lasers up to the first interaction', () => {
    const laser = { ...opticsEngine.createComponent('source.laser', { x: 0, y: 0 }), id: 'L' };
    laser.props = { ...laser.props, beamModel: 'gaussian', beamDiameter: 1, m2: 1, wavelength: 1000 };
    const block = { ...opticsEngine.createComponent('absorber.block', { x: 200, y: 0 }), id: 'B' };
    const scene: OpticsScene = { components: [laser, block], settings: opticsEngine.defaultSettings() };
    const tr = opticsEngine.trace(scene);
    const L = firstInteraction(laser, tr);
    expect(L).toBeGreaterThan(150);
    expect(L).toBeLessThan(205);
    const [env] = envelopePaths(scene.components, tr);
    const gb = gaussianBeamProfile(laser);
    expect(env.w0).toBeCloseTo(gb.w0, 12);
    expect(gb.zR).toBeCloseTo((Math.PI * 0.5 * 0.5) / 1e-3, 6); // pi w0^2 / lambda, mm
    const last = env.upper[env.upper.length - 1];
    expect(last.y).toBeCloseTo(beamRadius(L, gb), 9); // normal of +x is +y (screen down)
    expect(env.lower[env.lower.length - 1].y).toBeCloseTo(-beamRadius(L, gb), 9);
  });
});
