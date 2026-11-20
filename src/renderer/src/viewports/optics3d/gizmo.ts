/**
 * Combined move/rotate gizmo (custom; three's TransformControls is single-mode and has no
 * document-aware snapping): three world-axis arrows (X red, Y green, Z blue), three plane squares
 * (coloured by their normal axis) and three rotation rings — yaw about world Z, pitch about the
 * component's local Y (after yaw), roll about its local X (optical axis).
 *
 * Constant screen size: the root is scaled every frame from the camera distance so that one gizmo
 * unit = GIZMO_PX css pixels. Rendered in the overlay pass (after bloom / tone mapping) so it is
 * crisp and always on top of the scene.
 */
import * as THREE from 'three';
import type { HandleKey, AxisKey, PlaneKey, RingKey } from './edit';

export const GIZMO_PX = 92;
export const RING_RADIUS = 1.32;

const COL: Record<AxisKey, number> = { x: 0xf0453a, y: 0x4cc94c, z: 0x3d8bff };
const HOVER = 0xffd84a;

interface Handle {
  key: HandleKey;
  obj: THREE.Object3D;          // holder (oriented)
  mats: THREE.MeshBasicMaterial[];
  pick: THREE.Mesh;
  base: number;                 // base colour
  baseOpacity: number;
  fade: number;                 // 0..1 view-dependent visibility
}

function basic(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: true, toneMapped: false, side: THREE.DoubleSide });
}
const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });

export class Gizmo {
  readonly root = new THREE.Group();
  private handles = new Map<HandleKey, Handle>();
  private geos: THREE.BufferGeometry[] = [];
  private ringHolder: Record<RingKey, THREE.Group> = { yaw: new THREE.Group(), pitch: new THREE.Group(), roll: new THREE.Group() };
  private hover: HandleKey | null = null;
  private active: HandleKey | null = null;
  private enabled = { translate: true, rotate: true };
  /** world mm per gizmo unit (after update) */
  unit = 1;

  constructor() {
    this.root.name = 'gizmo';
    this.root.renderOrder = 100;
    const g = <T extends THREE.BufferGeometry>(x: T) => { this.geos.push(x); return x; };
    // ---- arrows (built along +Y, then rotated onto the axis)
    const shaft = g(new THREE.CylinderGeometry(0.016, 0.016, 0.72, 10).translate(0, 0.2 + 0.36, 0));
    const head = g(new THREE.ConeGeometry(0.062, 0.24, 18).translate(0, 0.92 + 0.12, 0));
    const pickArrow = g(new THREE.CylinderGeometry(0.085, 0.085, 0.98, 8).translate(0, 0.18 + 0.49, 0));
    const orient: Record<AxisKey, THREE.Euler> = { x: new THREE.Euler(0, 0, -Math.PI / 2), y: new THREE.Euler(0, 0, 0), z: new THREE.Euler(Math.PI / 2, 0, 0) };
    for (const k of ['x', 'y', 'z'] as AxisKey[]) {
      const holder = new THREE.Group();
      holder.rotation.copy(orient[k]);
      const m = basic(COL[k]);
      holder.add(new THREE.Mesh(shaft, m), new THREE.Mesh(head, m));
      const pick = new THREE.Mesh(pickArrow, PICK_MAT);
      holder.add(pick);
      this.add(k, holder, [m], pick, COL[k], 1);
    }
    // ---- plane squares
    const sq = g(new THREE.PlaneGeometry(0.2, 0.2));
    const sqEdge = g(new THREE.EdgesGeometry(sq));
    const pl: Record<PlaneKey, { n: AxisKey; pos: THREE.Vector3; rot: THREE.Euler }> = {
      xy: { n: 'z', pos: new THREE.Vector3(0.36, 0.36, 0), rot: new THREE.Euler(0, 0, 0) },
      xz: { n: 'y', pos: new THREE.Vector3(0.36, 0, 0.36), rot: new THREE.Euler(Math.PI / 2, 0, 0) },
      yz: { n: 'x', pos: new THREE.Vector3(0, 0.36, 0.36), rot: new THREE.Euler(0, Math.PI / 2, 0) },
    };
    for (const k of ['xy', 'xz', 'yz'] as PlaneKey[]) {
      const holder = new THREE.Group();
      holder.position.copy(pl[k].pos);
      holder.rotation.copy(pl[k].rot);
      const fill = basic(COL[pl[k].n], 0.32);
      fill.depthWrite = false;
      const edge = new THREE.LineBasicMaterial({ color: COL[pl[k].n], transparent: true, toneMapped: false });
      holder.add(new THREE.Mesh(sq, fill), new THREE.LineSegments(sqEdge, edge));
      const pick = new THREE.Mesh(sq, PICK_MAT);
      holder.add(pick);
      this.add(k, holder, [fill, edge as unknown as THREE.MeshBasicMaterial], pick, COL[pl[k].n], 0.32);
    }
    // ---- rings (torus lies in its local XY plane, axis = local +Z)
    const ring = g(new THREE.TorusGeometry(RING_RADIUS, 0.016, 8, 128));
    const pickRing = g(new THREE.TorusGeometry(RING_RADIUS, 0.075, 6, 64));
    const ringCol: Record<RingKey, number> = { yaw: COL.z, pitch: COL.y, roll: COL.x };
    for (const k of ['yaw', 'pitch', 'roll'] as RingKey[]) {
      const holder = this.ringHolder[k];
      const m = basic(ringCol[k], 0.95);
      holder.add(new THREE.Mesh(ring, m));
      const pick = new THREE.Mesh(pickRing, PICK_MAT);
      holder.add(pick);
      this.add(k, holder, [m], pick, ringCol[k], 0.95);
    }
    // centre dot
    const dot = new THREE.Mesh(g(new THREE.SphereGeometry(0.045, 16, 12)), basic(0xffffff, 0.9));
    this.root.add(dot);
    this.root.traverse((o) => { o.renderOrder = 100; });
    this.root.visible = false;
  }

  private add(key: HandleKey, obj: THREE.Object3D, mats: THREE.MeshBasicMaterial[], pick: THREE.Mesh, base: number, baseOpacity: number) {
    pick.userData.handle = key;
    this.root.add(obj);
    this.handles.set(key, { key, obj, mats, pick, base, baseOpacity, fade: 1 });
  }

  setEnabled(translate: boolean, rotate: boolean) { this.enabled = { translate, rotate }; }

  /** Place at `pivot` (world) and orient the pitch / roll rings for the given yaw / pitch (rad). */
  setPose(pivot: THREE.Vector3, axes: { pitch: THREE.Vector3; roll: THREE.Vector3 }) {
    this.root.position.copy(pivot);
    const z = new THREE.Vector3(0, 0, 1);
    this.ringHolder.yaw.quaternion.identity();
    this.ringHolder.pitch.quaternion.setFromUnitVectors(z, axes.pitch.clone().normalize());
    this.ringHolder.roll.quaternion.setFromUnitVectors(z, axes.roll.clone().normalize());
  }

  /** Constant screen size + view-dependent fading. Call every frame before rendering. */
  update(camera: THREE.PerspectiveCamera, viewportHeightCss: number) {
    if (!this.root.visible) return;
    const dist = camera.position.distanceTo(this.root.position);
    const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / Math.max(1, viewportHeightCss);
    this.unit = worldPerPx * GIZMO_PX;
    this.root.scale.setScalar(this.unit);
    const view = this.root.position.clone().sub(camera.position).normalize();
    const axis: Record<AxisKey, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    for (const h of this.handles.values()) {
      let fade = 1;
      if (h.key === 'x' || h.key === 'y' || h.key === 'z') {
        const d = Math.abs(view.dot(axis[h.key]));
        fade = 1 - THREE.MathUtils.smoothstep(d, 0.9, 0.985);
      } else if (h.key === 'xy' || h.key === 'xz' || h.key === 'yz') {
        const n = h.key === 'xy' ? axis.z : h.key === 'xz' ? axis.y : axis.x;
        fade = THREE.MathUtils.smoothstep(Math.abs(view.dot(n)), 0.12, 0.3);
      }
      const isT = !(h.key === 'yaw' || h.key === 'pitch' || h.key === 'roll');
      if (isT ? !this.enabled.translate : !this.enabled.rotate) fade = 0;
      h.fade = fade;
      h.obj.visible = fade > 0.02;
      this.style(h);
    }
  }

  private style(h: Handle) {
    const hot = this.active === h.key || (!this.active && this.hover === h.key);
    const dim = this.active !== null && this.active !== h.key;
    for (const m of h.mats) {
      m.color.setHex(hot ? HOVER : h.base);
      const op = hot ? Math.max(0.9, h.baseOpacity) : h.baseOpacity;
      m.opacity = op * h.fade * (dim ? 0.18 : 1);
    }
  }

  /** Handle under the ray (closest), ignoring faded-out handles. */
  pick(raycaster: THREE.Raycaster): { key: HandleKey; point: THREE.Vector3 } | null {
    if (!this.root.visible) return null;
    this.root.updateMatrixWorld(true);
    const picks: THREE.Object3D[] = [];
    for (const h of this.handles.values()) if (h.fade > 0.35) picks.push(h.pick);
    const hits = raycaster.intersectObjects(picks, false);
    if (!hits.length) return null;
    // prefer arrows / planes over rings when both are within a small depth band
    // arrows / planes are small and specific; the large rings only win when nothing else is hit
    const pref = hits.find((x) => !/yaw|pitch|roll/.test(x.object.userData.handle));
    const h = pref ?? hits[0];
    return { key: h.object.userData.handle as HandleKey, point: h.point.clone() };
  }

  setHover(k: HandleKey | null) { if (k !== this.hover) { this.hover = k; this.restyle(); } }
  setActive(k: HandleKey | null) { if (k !== this.active) { this.active = k; this.restyle(); } }
  get hovered() { return this.hover; }
  private restyle() { for (const h of this.handles.values()) this.style(h); }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && m !== PICK_MAT) m.dispose();
    });
  }
}
