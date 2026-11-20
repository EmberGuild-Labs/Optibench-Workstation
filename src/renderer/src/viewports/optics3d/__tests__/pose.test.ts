import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OpticalComponent } from '@core/types';
import type { Vec3 } from '@core/types3d';
import { optics3dEngine } from '../../../../../core/optics3d';
import {
  DEG, applyWorldPose, docToWorldPos, localToWorld, rotationAxes, rotationMatrix, worldPoseOf, worldToDocPos, worldToLocal, wrapDeg,
} from '../pose';

const comp = (x: number, y: number, rot: number, z = 0, pitch = 0, roll = 0): OpticalComponent => ({
  id: 'c', type: 'mirror.flat', position: { x, y }, rotation: rot, props: {}, pose3d: { z, pitch, roll },
});
const close = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9);
};
const rnd = (s: number) => (Math.random() - 0.5) * s;

describe('document <-> world mapping', () => {
  it('maps position.x -> X, position.y -> -Y, pose3d.z -> Z', () => {
    expect(docToWorldPos({ x: 12, y: 34 }, 5)).toEqual({ x: 12, y: -34, z: 5 });
    expect(worldToDocPos({ x: 12, y: -34, z: 5 })).toEqual({ position: { x: 12, y: 34 }, z: 5 });
  });
  it('yaw = -rotation, pitch/roll degrees <-> radians', () => {
    const w = worldPoseOf(comp(1, 2, 0.5, 3, 30, -45));
    expect(w.yaw).toBeCloseTo(-0.5, 12);
    expect(w.pitch).toBeCloseTo(30 * DEG, 12);
    expect(w.roll).toBeCloseTo(-45 * DEG, 12);
  });
  it('missing pose3d defaults to zero', () => {
    const c: OpticalComponent = { id: 'a', type: 't', position: { x: 1, y: 2 }, rotation: 0, props: {} };
    expect(worldPoseOf(c)).toEqual({ p: { x: 1, y: -2, z: 0 }, yaw: 0, pitch: 0, roll: 0 });
  });
  it('round-trips exactly through applyWorldPose', () => {
    for (let i = 0; i < 200; i++) {
      const c = comp(rnd(800), rnd(800), rnd(6), rnd(60), Math.round(rnd(170)) || 0, Math.round(rnd(340)) || 0);
      const back = applyWorldPose(c, worldPoseOf(c));
      expect(back.position.x).toBe(c.position.x);
      expect(back.position.y).toBeCloseTo(c.position.y, 12);
      expect(back.rotation).toBeCloseTo(c.rotation, 12);
      expect(back.pose3d!.z).toBe(c.pose3d!.z);
      expect(back.pose3d!.pitch).toBe(c.pose3d!.pitch);
      expect(back.pose3d!.roll).toBe(c.pose3d!.roll);
    }
  });
  it('moving +X in world increases position.x; moving +Y in world decreases position.y', () => {
    const c = comp(10, 10, 0);
    const w = worldPoseOf(c);
    const n = applyWorldPose(c, { ...w, p: { x: w.p.x + 5, y: w.p.y + 7, z: 3 } });
    expect(n.position).toEqual({ x: 15, y: 3 });
    expect(n.pose3d!.z).toBe(3);
  });
  it('positive yaw (CCW seen from above) is a negative 2D rotation', () => {
    const c = comp(0, 0, 0);
    const n = applyWorldPose(c, { ...worldPoseOf(c), yaw: 30 * DEG });
    expect(n.rotation).toBeCloseTo(-30 * DEG, 12);
  });
});

describe('orientation matrix', () => {
  it('equals three.js Euler(roll, pitch, yaw, "ZYX") = Rz·Ry·Rx', () => {
    for (let i = 0; i < 50; i++) {
      const y = rnd(6), p = rnd(3), r = rnd(6);
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r, p, y, 'ZYX')).elements; // column-major
      const R = rotationMatrix(y, p, r);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) expect(R[row * 3 + col]).toBeCloseTo(m[col * 4 + row], 12);
    }
  });
  it('localToWorld / worldToLocal agree with the 3D engine', () => {
    for (let i = 0; i < 100; i++) {
      const c = comp(rnd(400), rnd(400), rnd(6), rnd(50), rnd(120), rnd(300));
      const l = { x: rnd(20), y: rnd(20), z: rnd(20) };
      close(localToWorld(c, l), optics3dEngine.localToWorld(c, l));
      const w = localToWorld(c, l);
      close(worldToLocal(c, w), l);
      close(optics3dEngine.worldToLocal(c, w), l);
    }
  });
  it('unrotated part: local +x = world +X, 2D local +y (down) = world -Y', () => {
    const c = comp(0, 0, 0);
    close(localToWorld(c, { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });
    close(localToWorld(c, { x: 0, y: -1, z: 0 }), { x: 0, y: -1, z: 0 });
  });
  it('a +90° 2D rotation (clockwise on screen) turns local +x to world -Y', () => {
    close(localToWorld(comp(0, 0, Math.PI / 2), { x: 1, y: 0, z: 0 }), { x: 0, y: -1, z: 0 });
  });
  it('gizmo ring axes are the true derivative axes of each Euler angle', () => {
    const h = 1e-6;
    const toM = (a: number[]) => new THREE.Matrix3().set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
    for (let i = 0; i < 30; i++) {
      const y = rnd(6), p = rnd(2.5), r = rnd(6);
      const ax = rotationAxes(y, p);
      const Ri = toM(rotationMatrix(y, p, r)).invert();
      const cases: ['yaw' | 'pitch' | 'roll', number[]][] = [['yaw', rotationMatrix(y + h, p, r)], ['pitch', rotationMatrix(y, p + h, r)], ['roll', rotationMatrix(y, p, r + h)]];
      for (const [k, dR] of cases) {
        // dR · R⁻¹ ≈ I + h·[w]×   (elements column-major: e[col*3+row])
        const e = toM(dR).multiply(Ri).elements;
        const w = { x: (e[5] - e[7]) / (2 * h), y: (e[6] - e[2]) / (2 * h), z: (e[1] - e[3]) / (2 * h) };
        const a = ax[k];
        expect(w.x).toBeCloseTo(a.x, 5); expect(w.y).toBeCloseTo(a.y, 5); expect(w.z).toBeCloseTo(a.z, 5);
      }
    }
  });
  it('wrapDeg', () => {
    expect(wrapDeg(190)).toBeCloseTo(-170, 9);
    expect(wrapDeg(-180)).toBeCloseTo(180, 9);
    expect(wrapDeg(45)).toBeCloseTo(45, 9);
  });
});
