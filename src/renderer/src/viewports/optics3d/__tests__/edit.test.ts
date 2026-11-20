import { describe, expect, it } from 'vitest';
import type { OpticalComponent, OpticsScene } from '@core/types';
import { angleAround, closestOnAxis, nudgeComponents, rayPlane, rotateComponents, translateComponents } from '../edit';
import { DEG, rotateStepDeg, translateStep, worldPoseOf } from '../pose';

const C = (id: string, x: number, y: number, rot = 0, extra: Partial<OpticalComponent> = {}): OpticalComponent =>
  ({ id, type: 'lens.biconvex', position: { x, y }, rotation: rot, props: {}, ...extra });
const S = (...c: OpticalComponent[]): OpticsScene =>
  ({ components: c, settings: { maxBounces: 64, minIntensity: 1e-4, ambientMedium: 'air', raysPerSource: 32, temperatureC: 20, spectralSamples: 24 } });

describe('drag math', () => {
  it('closestOnAxis: point on the axis nearest a skew ray', () => {
    expect(closestOnAxis({ o: { x: 5, y: -10, z: 3 }, d: { x: 0, y: 1, z: 0 } }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(5, 9);
    expect(closestOnAxis({ o: { x: 0, y: 0, z: 10 }, d: { x: 1, y: 0, z: 0 } }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
  it('rayPlane', () => {
    expect(rayPlane({ o: { x: 1, y: 2, z: 10 }, d: { x: 0, y: 0, z: -1 } }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toEqual({ x: 1, y: 2, z: 0 });
    expect(rayPlane({ o: { x: 0, y: 0, z: 10 }, d: { x: 0, y: 0, z: 1 } }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
  });
  it('angleAround is right-handed about the axis', () => {
    expect(angleAround({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2, 12);
  });
  it('snap steps from modifiers', () => {
    expect(translateStep({ shiftKey: false, ctrlKey: false })).toBe(1);
    expect(translateStep({ shiftKey: true, ctrlKey: false })).toBe(10);
    expect(translateStep({ shiftKey: false, ctrlKey: true })).toBe(0);
    expect(rotateStepDeg({ shiftKey: true, ctrlKey: false })).toBe(15);
    expect(rotateStepDeg({ shiftKey: false, ctrlKey: true })).toBe(0);
  });
});

describe('scene edits', () => {
  it('translate along world X snaps the anchor to 1 mm and ignores other axes', () => {
    const r = translateComponents(S(C('a', 0.4, 5)), new Set(['a']), 'a', { x: 10.3, y: 99, z: 99 }, ['x'], 1);
    expect(r.scene.components[0].position).toEqual({ x: 11, y: 5 });
    expect(r.scene.components[0].pose3d!.z).toBe(0);
  });
  it('world +Y moves document y negative; Shift snaps to 10 mm', () => {
    const r = translateComponents(S(C('a', 0, 0)), new Set(['a']), 'a', { x: 0, y: 23, z: 0 }, ['y'], 10);
    expect(r.scene.components[0].position.y).toBe(-20);
  });
  it('Z goes to pose3d.z; Ctrl (step 0) = exact', () => {
    const r = translateComponents(S(C('a', 0, 0)), new Set(['a']), 'a', { x: 0, y: 0, z: 12.345 }, ['z'], 0);
    expect(r.scene.components[0].pose3d!.z).toBe(12.345);
  });
  it('multi-selection keeps spacing, skips locked and unselected parts', () => {
    const s = S(C('a', 0.5, 0), C('b', 30.5, 10), C('c', 50, 0, 0, { locked: true }), C('d', 90, 0));
    const [a, b, c, d] = translateComponents(s, new Set(['a', 'b', 'c']), 'a', { x: 10, y: 0, z: 0 }, ['x'], 1).scene.components;
    expect(b.position.x - a.position.x).toBe(30);
    expect(c).toBe(s.components[2]);
    expect(d).toBe(s.components[3]);
  });
  it('yaw with Shift snaps to absolute 15° and maps to -rotation', () => {
    const r = rotateComponents(S(C('a', 0, 0, -(7 * DEG))), new Set(['a']), 'a', 'yaw', 10 * DEG, 15);
    expect(worldPoseOf(r.scene.components[0]).yaw).toBeCloseTo(15 * DEG, 9);
    expect(r.scene.components[0].rotation).toBeCloseTo(-15 * DEG, 9);
  });
  it('pitch / roll are stored in degrees', () => {
    const p = rotateComponents(S(C('a', 0, 0)), new Set(['a']), 'a', 'pitch', 30 * DEG, 1).scene.components[0];
    expect(p.pose3d!.pitch).toBe(30);
    const q = rotateComponents(S(p), new Set(['a']), 'a', 'roll', -45 * DEG, 0).scene.components[0];
    expect(q.pose3d!.roll).toBe(-45);
    expect(q.pose3d!.pitch).toBe(30);
  });
  it('group yaw orbits positions around the pivot', () => {
    const r = rotateComponents(S(C('a', 10, 0), C('b', -10, 0)), new Set(['a', 'b']), 'a', 'yaw', 90 * DEG, 0, { x: 0, y: 0, z: 0 });
    expect(r.scene.components[0].position.x).toBeCloseTo(0, 9);
    expect(r.scene.components[0].position.y).toBeCloseTo(-10, 9);
  });
  it('nudge', () => {
    const n = nudgeComponents(S(C('a', 0, 0)), new Set(['a']), { x: 1, y: 10, z: -2 });
    expect(n.components[0].position).toEqual({ x: 1, y: -10 });
    expect(n.components[0].pose3d!.z).toBe(-2);
  });
});
