/**
 * Imperative three.js runtime behind <Optics3DViewport>. Owns the renderer, scene graph, camera,
 * gizmo and all pointer / keyboard handling. The React wrapper calls `sync()` after every render
 * with fresh props; everything else is event-driven with an on-demand render loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { OpticalComponent, OpticsScene } from '@core/types';
import type { ComponentGeometry3D, Mesh3D, Vec3 } from '@core/types3d';
import { DEFAULT_TABLE_DEPTH } from '@core/types3d';
import { PALETTE_DND_MIME, type PaletteDragPayload } from '../contracts';
import type { CameraPreset, Optics3DViewportProps } from './props';
import { BeamLayer } from './beams';
import { OpticalTable } from './table';
import { MaterialLibrary, emissiveMaterial, lookOf } from './materials';
import { Gizmo, GIZMO_PX, RING_RADIUS } from './gizmo';
import {
  AXIS_VEC, HANDLE_LABEL, PLANE_AXES, PLANE_NORMAL, angleAround, closestOnAxis, isPlane, isRing, nudgeComponents,
  rayPlane, rotateComponents, translateComponents, type HandleKey, type Ray, type RingKey,
} from './edit';
import { DEG, rotateStepDeg, rotationAxes, snap, translateStep, worldPoseOf, wrapPi } from './pose';

const BG = '#101214';
const FOV = 35;

interface Entry {
  c: OpticalComponent;
  geomKey: string;
  group: THREE.Group;
  geos: THREE.BufferGeometry[];
  own: THREE.Material[];
  emitters: THREE.MeshStandardMaterial[];
  faces: { mat: THREE.MeshStandardMaterial; mesh: THREE.Mesh }[];
  faceTex: THREE.DataTexture | null;
  /** bounds of the optic itself (no mount) and of everything */
  optic: THREE.Box3;
  all: THREE.Box3;
}

interface Drag {
  key: HandleKey;
  base: OpticsScene;
  ids: Set<string>;
  anchorId: string;
  pivot: THREE.Vector3;
  startClient: { x: number; y: number };
  t0?: number;
  start?: THREE.Vector3;
  // rings
  axis?: THREE.Vector3;
  planeMode?: boolean;
  ref?: Vec3;
  prevAngle?: number;
  total?: number;
  tangent?: { x: number; y: number };
  startValue?: number;
  last: OpticsScene | null;
  label: string;
}

export interface RuntimeUI {
  labels: HTMLDivElement;
  readout: HTMLDivElement;
}

export interface RuntimeCallbacks {
  onContextLost(lost: boolean): void;
  onRestored(): void;
}

const tv = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);
const pv = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const fmt = (v: number, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
const sgn = (v: number, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

export class Optics3DRuntime {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private overlay = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture;
  private key = new THREE.DirectionalLight('#fff4e8', 2.1);
  private fill = new THREE.DirectionalLight('#bcd2ff', 0.55);
  private hemi = new THREE.HemisphereLight('#c7d2e0', '#1a1b1d', 0.55);
  private table: OpticalTable;
  private beams = new BeamLayer();
  private mats: MaterialLibrary;
  private gizmo = new Gizmo();
  private compRoot = new THREE.Group();
  private entries = new Map<string, Entry>();
  private bracketGeo: THREE.BufferGeometry;
  private bracketSel = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
  private bracketHover = new THREE.LineBasicMaterial({ color: '#8fb3e0', transparent: true, opacity: 0.75, depthTest: false, toneMapped: false });
  private brackets: THREE.LineSegments[] = [];
  private triad: { scene: THREE.Scene; camera: THREE.OrthographicCamera; dispose(): void };
  private raycaster = new THREE.Raycaster();
  private ro: ResizeObserver;
  private size = { w: 1, h: 1, dpr: 1 };
  private raf = 0;
  private dirty = true;
  private lost = false;
  private disposed = false;
  private anim: { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number } | null = null;
  private drag: Drag | null = null;
  private down: { x: number; y: number; button: number; moved: boolean } | null = null;
  private hoverId: string | null = null;
  private last: { scene?: OpticsScene; engine?: unknown; trace?: unknown; depth?: number; grid?: boolean; sel?: string; pulseKey?: string } = {};
  private labelEls = new Map<string, HTMLDivElement>();
  showLabels = true;
  haze = true;
  private firstFrame = true;

  constructor(
    private wrap: HTMLDivElement,
    private canvas: HTMLCanvasElement,
    private ui: RuntimeUI,
    private getProps: () => Optics3DViewportProps,
    private cb: RuntimeCallbacks,
  ) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer = r;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(BG, 1);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 2000, 8000);
    this.pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTex = this.pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.42;

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target, this.hemi);

    this.mats = new MaterialLibrary(() => this.getProps().opticsEngine);
    this.table = new OpticalTable(r.capabilities.getMaxAnisotropy());
    this.scene.add(this.table.group, this.compRoot, this.beams.group);

    this.overlay.add(this.gizmo.root);
    this.bracketGeo = bracketGeometry();
    this.triad = makeTriad();

    // camera + controls (Z up)
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-200, -500, 400);
    this.raycaster.params.Line = { threshold: 2 };

    // our pointerdown must run before OrbitControls' (registered in capture phase on the wrapper)
    wrap.addEventListener('pointerdown', this.onPointerDown, true);
    wrap.addEventListener('pointermove', this.onPointerMove);
    wrap.addEventListener('pointerup', this.onPointerUp);
    wrap.addEventListener('pointercancel', this.onPointerCancel);
    wrap.addEventListener('pointerleave', this.onPointerLeave);
    wrap.addEventListener('contextmenu', this.onContextMenu);
    wrap.addEventListener('keydown', this.onKeyDown);
    wrap.addEventListener('dragover', this.onDragOver);
    wrap.addEventListener('drop', this.onDrop);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);

    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.14;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.rotateSpeed = 0.85;
    c.zoomSpeed = 1.1;
    c.minDistance = 20;
    c.maxDistance = 12000;
    c.maxPolarAngle = Math.PI * 0.6;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.keys = { LEFT: '', UP: '', RIGHT: '', BOTTOM: '' };
    c.addEventListener('change', () => { this.dirty = true; });
    c.addEventListener('start', () => { this.anim = null; });
    this.controls = c;

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.42, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    this.resize();
    this.showLabels = getProps().showLabels ?? true;
    this.sync();
    this.setCameraPreset(getProps().initialCamera ?? 'iso', false);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ======================================================================== sync with props
  sync() {
    if (this.disposed) return;
    const p = this.getProps();
    const depth = p.tableDepth ?? DEFAULT_TABLE_DEPTH;
    let boundsChanged = false;
    if (p.scene !== this.last.scene || p.engine3d !== this.last.engine || depth !== this.last.depth) {
      const engineChanged = p.engine3d !== this.last.engine || depth !== this.last.depth;
      const seen = new Set<string>();
      for (const c of p.scene.components) {
        seen.add(c.id);
        const e = this.entries.get(c.id);
        if (e && e.c === c && !engineChanged) continue;
        const gk = geomKey(c, depth);
        if (e && !engineChanged && e.geomKey === gk) { e.c = c; continue; }
        if (e) this.disposeEntry(e);
        this.entries.set(c.id, this.buildEntry(c, depth, gk));
        boundsChanged = true;
      }
      for (const [id, e] of this.entries) if (!seen.has(id)) { this.disposeEntry(e); this.entries.delete(id); boundsChanged = true; }
      this.last.scene = p.scene; this.last.engine = p.engine3d; this.last.depth = depth;
      this.dirty = true;
    }
    if (boundsChanged || p.display.showGrid !== this.last.grid) {
      this.fitTable(depth, p.display.showGrid);
      this.last.grid = p.display.showGrid;
    }
    const tvp = p.timeView?.mode === 'pulse' && (p.timeView.period ?? 0) > 0 ? { period: p.timeView.period!, width: p.timeView.pulseWidth ?? 0 } : null;
    const pk = tvp ? `${tvp.period}|${tvp.width}` : '';
    if (p.trace3d !== this.last.trace || boundsChanged || pk !== this.last.pulseKey) {
      this.last.pulseKey = pk;
      this.beams.update({ trace: p.trace3d, engine2d: p.opticsEngine, pulses: tvp });
      this.updateGlow();
      this.last.trace = p.trace3d;
      this.dirty = true;
    }
    this.bloom.enabled = p.display.bloom;
    this.controls.mouseButtons.LEFT = p.tool === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.updateSelectionVisuals();
    this.dirty = true;
  }

  private buildEntry(c: OpticalComponent, depth: number, gk: string): Entry {
    const p = this.getProps();
    const group = new THREE.Group();
    group.userData.id = c.id;
    const e: Entry = { c, geomKey: gk, group, geos: [], own: [], emitters: [], faces: [], faceTex: null, optic: new THREE.Box3(), all: new THREE.Box3() };
    let g: ComponentGeometry3D;
    try {
      g = p.engine3d.getGeometry3D(c, depth);
    } catch (err) {
      console.error('[optics3d] getGeometry3D failed for', c.type, err);
      g = { meshes: [], bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } };
    }
    for (const m of g.meshes) {
      if (!m.positions?.length || !m.indices?.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      if (m.normals?.length === m.positions.length) geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      else geo.computeVertexNormals();
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      e.geos.push(geo);
      const look = lookOf(c, m);
      let mat: THREE.Material;
      if (look === 'emitter') { const em = emissiveMaterial('emitter'); e.own.push(em); e.emitters.push(em); mat = em; }
      else if (look === 'face') { const fm = emissiveMaterial('face'); e.own.push(fm); mat = fm; }
      else mat = this.mats.get(c, m, look);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.id = c.id;
      mesh.userData.role = m.role;
      mesh.castShadow = look !== 'glass' && look !== 'field';
      mesh.receiveShadow = look !== 'glass' && look !== 'emitter';
      if (look === 'glass') mesh.renderOrder = 2;
      group.add(mesh);
      if (look === 'face') { e.faces.push({ mat: mat as THREE.MeshStandardMaterial, mesh }); planarUV(geo, m, c, p.engine3d); }
      if (look === 'glass') {
        // crisp faint rim so glass reads on the dark scene
        const eg = new THREE.EdgesGeometry(geo, 28);
        e.geos.push(eg);
        const lm = new THREE.LineBasicMaterial({ color: (mat as THREE.MeshPhysicalMaterial).attenuationColor.clone().lerp(new THREE.Color(1, 1, 1), 0.5), transparent: true, opacity: 0.4, depthWrite: false });
        e.own.push(lm);
        const lines = new THREE.LineSegments(eg, lm);
        lines.userData.id = c.id;
        lines.raycast = () => {};
        group.add(lines);
      }
      const bb = geo.boundingBox!;
      e.all.union(bb);
      if (m.role !== 'mount') e.optic.union(bb);
    }
    if (e.optic.isEmpty()) e.optic.copy(e.all);
    if (e.all.isEmpty()) {
      const w = worldPoseOf(c).p;
      e.all.setFromCenterAndSize(tv(w), new THREE.Vector3(10, 10, 10));
      e.optic.copy(e.all);
    }
    this.compRoot.add(group);
    return e;
  }

  private disposeEntry(e: Entry) {
    this.compRoot.remove(e.group);
    for (const g of e.geos) g.dispose();
    for (const m of e.own) m.dispose();
    e.faceTex?.dispose();
    this.labelEls.get(e.c.id)?.remove();
    this.labelEls.delete(e.c.id);
  }

  private fitTable(depth: number, grid: boolean) {
    const b = this.sceneBox(false);
    const bb = b.isEmpty() ? { minX: -300, minY: -200, maxX: 300, maxY: 200 } : { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y };
    this.table.fit(bb, depth, grid);
    const r = this.table.rect;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const span = Math.max(r.x1 - r.x0, r.y1 - r.y0);
    this.key.position.set(cx - span * 0.35, cy - span * 0.55, span * 0.9);
    this.key.target.position.set(cx, cy, -depth);
    this.fill.position.set(cx + span * 0.5, cy + span * 0.6, span * 0.4);
    this.fill.target.position.set(cx, cy, 0);
    const sc = this.key.shadow.camera;
    const half = span * 0.75;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = span * 3;
    sc.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
  }

  /** Emitter apertures in beam colour, detector faces glowing with power / image. */
  private updateGlow() {
    const p = this.getProps();
    const det = p.trace3d?.detectors ?? {};
    for (const e of this.entries.values()) {
      const s = this.beams.sources.get(e.c.id);
      for (const m of e.emitters) {
        if (s) m.emissive.setRGB(s.rgb[0], s.rgb[1], s.rgb[2]).multiplyScalar(0.8 * s.level);
        else m.emissive.setRGB(0.02, 0.02, 0.02);
      }
      if (!e.faces.length) continue;
      const rd = det[e.c.id];
      e.faceTex?.dispose();
      e.faceTex = null;
      const level = rd && rd.power > 1e-12 ? Math.min(1, Math.max(0.12, 0.45 + 0.15 * Math.log10(rd.power / 1e-3))) : 0;
      const img = rd?.image;
      if (img && img.w > 0 && img.h > 0 && img.data.length >= img.w * img.h) {
        const tex = imageTexture(img, p.opticsEngine);
        e.faceTex = tex;
        for (const f of e.faces) { f.mat.emissiveMap = tex; f.mat.emissive.setRGB(1, 1, 1).multiplyScalar(0.25 + 2.4 * level); f.mat.needsUpdate = true; }
      } else {
        for (const f of e.faces) {
          if (f.mat.emissiveMap) { f.mat.emissiveMap = null; f.mat.needsUpdate = true; }
          f.mat.emissive.setRGB(0.1, 0.9, 0.85).multiplyScalar(level * 0.9);
        }
      }
    }
  }

  // ======================================================================== selection visuals
  private primary(p: Optics3DViewportProps): OpticalComponent | null {
    const comps = p.scene.components;
    for (let i = p.selection.length - 1; i >= 0; i--) {
      const c = comps.find((q) => q.id === p.selection[i]);
      if (c && !c.locked) return c;
    }
    return null;
  }

  private movable(p: Optics3DViewportProps): OpticalComponent[] {
    const ids = new Set(p.selection);
    return p.scene.components.filter((c) => ids.has(c.id) && !c.locked);
  }

  private gizmoPivot(p: Optics3DViewportProps): THREE.Vector3 | null {
    const mv = this.movable(p);
    if (!mv.length) return null;
    if (mv.length === 1) return tv(worldPoseOf(mv[0]).p);
    const s = new THREE.Vector3();
    for (const c of mv) s.add(tv(worldPoseOf(c).p));
    return s.multiplyScalar(1 / mv.length);
  }

  private updateSelectionVisuals() {
    const p = this.getProps();
    for (const b of this.brackets) b.visible = false;
    let i = 0;
    const show = (box: THREE.Box3, mat: THREE.LineBasicMaterial) => {
      let b = this.brackets[i];
      if (!b) { b = new THREE.LineSegments(this.bracketGeo, mat); b.renderOrder = 90; this.brackets.push(b); this.overlay.add(b); }
      b.material = mat;
      const size = box.getSize(new THREE.Vector3()).addScalar(3);
      box.getCenter(b.position);
      b.scale.copy(size);
      b.visible = true;
      i++;
    };
    const sel = new Set(p.selection);
    for (const id of sel) { const e = this.entries.get(id); if (e) show(e.optic, this.bracketSel); }
    if (this.hoverId && !sel.has(this.hoverId)) { const e = this.entries.get(this.hoverId); if (e) show(e.optic, this.bracketHover); }

    const prim = this.primary(p);
    const pivot = this.drag ? this.drag.pivot : this.gizmoPivot(p);
    const tool = p.tool === 'select' || p.tool === 'measure';
    if (prim && pivot && tool) {
      const w = worldPoseOf(prim);
      const ax = rotationAxes(w.yaw, w.pitch);
      this.gizmo.setPose(pivot, { pitch: tv(ax.pitch), roll: tv(ax.roll) });
      this.gizmo.root.visible = true;
    } else {
      this.gizmo.root.visible = false;
      this.gizmo.setHover(null);
    }
  }

  // ======================================================================== camera
  private sceneBox(opticOnly = true, ids?: Set<string>): THREE.Box3 {
    const b = new THREE.Box3();
    for (const e of this.entries.values()) if (!ids || ids.has(e.c.id)) b.union(opticOnly ? e.optic : e.all);
    return b;
  }

  private fitDistance(radius: number): number {
    const vf = (FOV * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    return (radius / Math.sin(Math.min(vf, hf))) * 1.05;
  }

  setCameraPreset(preset: CameraPreset, animate = true) {
    const p = this.getProps();
    const box = this.sceneBox(true);
    const center = box.isEmpty() ? new THREE.Vector3(p.view.cx, -p.view.cy, 0) : box.getCenter(new THREE.Vector3());
    if (!box.isEmpty()) center.z = THREE.MathUtils.clamp(center.z, -20, 20);
    const radius = box.isEmpty() ? 250 : Math.max(60, box.getBoundingSphere(new THREE.Sphere()).radius);
    let dir: THREE.Vector3;
    let dist = this.fitDistance(radius);
    switch (preset) {
      case 'top': {
        dir = new THREE.Vector3(0, -1e-4, 1);
        // match the 2D framing: visible height (mm) = viewport height (px) / zoom (px/mm)
        if (box.isEmpty() || this.firstFrame) {
          if (p.view.zoom > 0) dist = (this.size.h / p.view.zoom) / 2 / Math.tan((FOV * Math.PI) / 360);
          if (box.isEmpty()) center.set(p.view.cx, -p.view.cy, 0);
        }
        break;
      }
      case 'front': dir = new THREE.Vector3(0, -1, 0.14); break;
      case 'side': dir = new THREE.Vector3(1, 0, 0.14); break;
      case 'iso':
      default: dir = new THREE.Vector3(-0.5, -1, 0.82); dist *= 0.92; break;
    }
    dir.normalize();
    this.flyTo(center.clone().addScaledVector(dir, dist), center, animate);
  }

  /** Frame the selection (or everything) keeping the current viewing direction. */
  frameSelection(animate = true) {
    const p = this.getProps();
    const ids = p.selection.length ? new Set(p.selection) : undefined;
    let box = this.sceneBox(true, ids);
    if (box.isEmpty()) box = this.sceneBox(true);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(ids ? 25 : 60, sphere.radius);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(sphere.center.clone().addScaledVector(dir, this.fitDistance(r)), sphere.center.clone(), animate);
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
      this.anim = null;
    } else {
      this.anim = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, start: performance.now(), dur: 480 };
    }
    this.dirty = true;
  }

  private stepAnim(now: number) {
    const a = this.anim;
    if (!a) return;
    const k = Math.min(1, (now - a.start) / a.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    // interpolate around the target (spherical-ish) so the camera swings instead of cutting through the table
    const tgt = a.t0.clone().lerp(a.t1, e);
    const o0 = a.p0.clone().sub(a.t0), o1 = a.p1.clone().sub(a.t1);
    const l = THREE.MathUtils.lerp(o0.length(), o1.length(), e);
    const d0 = o0.normalize(), d1 = o1.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(d0, d1);
    const qi = new THREE.Quaternion().slerp(q, e);
    const dir = d0.clone().applyQuaternion(qi).normalize();
    this.camera.position.copy(tgt).addScaledVector(dir, l);
    this.controls.target.copy(tgt);
    this.camera.lookAt(tgt);
    if (k >= 1) this.anim = null;
    this.dirty = true;
  }

  // ======================================================================== render loop
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lost) return;
    if (this.anim) this.stepAnim(now);
    else if (this.controls.update()) this.dirty = true;
    if (this.dirty) { this.dirty = false; this.render(); }
  };

  private render() {
    const p = this.getProps();
    const cam = this.camera;
    const dist = cam.position.distanceTo(this.controls.target);
    cam.near = Math.max(0.5, dist / 400);
    cam.far = Math.max(5000, dist * 40);
    cam.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.6; fog.far = dist * 6 + 2000;

    const tvw = p.timeView;
    const pulse = tvw?.pulseWidth ?? Math.max(this.beams.maxT * 0.08, 1e-12);
    const pxPerMm = this.size.h / (2 * Math.tan((FOV * Math.PI) / 360) * dist);
    this.beams.setFrame({
      width: this.size.w, height: this.size.h, dpr: this.size.dpr, near: cam.near,
      exposure: Math.max(0.05, 2 * (p.display.rayOpacity ?? 0.7)), haze: this.haze,
      mode: tvw?.mode === 'pulse' ? 'pulse' : 'steady', t: tvw?.t ?? 0, pulse, pxPerMm,
    });
    this.gizmo.update(cam, this.size.h);

    const r = this.renderer;
    this.composer.render();
    r.autoClear = false;
    r.clearDepth();
    r.render(this.overlay, cam);
    // axis triad, bottom-left
    const S = 84;
    r.setScissorTest(true);
    r.setScissor(6, 6, S, S);
    r.setViewport(6, 6, S, S);
    r.clearDepth();
    const tc = this.triad.camera;
    tc.position.copy(cam.position).sub(this.controls.target).normalize().multiplyScalar(5);
    tc.up.copy(cam.up);
    tc.quaternion.copy(cam.quaternion);
    r.render(this.triad.scene, tc);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    r.autoClear = true;
    this.updateLabels();
    this.firstFrame = false;
  }

  private updateLabels() {
    const p = this.getProps();
    const host = this.ui.labels;
    const show = this.showLabels && !this.drag;
    host.style.display = show ? '' : 'none';
    if (!show) return;
    const reg = p.opticsEngine.registry;
    const seen = new Set<string>();
    const v = new THREE.Vector3();
    const sel = new Set(p.selection);
    for (const e of this.entries.values()) {
      seen.add(e.c.id);
      let el = this.labelEls.get(e.c.id);
      if (!el) { el = document.createElement('div'); el.className = 'o3d-label'; host.appendChild(el); this.labelEls.set(e.c.id, el); }
      const text = e.c.name || reg.find((d) => d.type === e.c.type)?.label || e.c.type;
      if (el.textContent !== text) el.textContent = text;
      e.optic.getCenter(v);
      v.z = e.optic.max.z + 4;
      v.project(this.camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const x = (v.x * 0.5 + 0.5) * this.size.w, y = (-v.y * 0.5 + 0.5) * this.size.h;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      el.classList.toggle('o3d-sel', sel.has(e.c.id));
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) { el.remove(); this.labelEls.delete(id); }
  }

  private resize() {
    const r = this.wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
    this.size = { w, h, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    if (!this.lost) this.render();
  }

  requestRender() { this.dirty = true; }

  /** PNG of a freshly rendered frame. */
  capturePNG(): Promise<Blob> {
    this.render();
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }

  // ======================================================================== picking helpers
  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private rayAt(e: { clientX: number; clientY: number }): Ray {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return { o: pv(this.raycaster.ray.origin), d: pv(this.raycaster.ray.direction) };
  }
  private pickComponent(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.compRoot, true);
    for (const h of hits) { const id = h.object.userData.id; if (id) return id; }
    return null;
  }
  private pickGizmo(e: { clientX: number; clientY: number }) {
    const p = this.getProps();
    if (!this.gizmo.root.visible || (p.tool !== 'select' && p.tool !== 'measure')) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.gizmo.pick(this.raycaster);
  }
  /** Beam-plane (z = 0) point under the cursor. */
  private planePoint(e: { clientX: number; clientY: number }, z = 0): Vec3 | null {
    return rayPlane(this.rayAt(e), { x: 0, y: 0, z }, { x: 0, y: 0, z: 1 });
  }
  /** world -> client px (also used by QA scripts) */
  toScreen(v: THREE.Vector3): { x: number; y: number } {
    const q = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (q.x * 0.5 + 0.5) * r.width, y: r.top + (-q.y * 0.5 + 0.5) * r.height };
  }

  // ======================================================================== pointer
  private onPointerDown = (e: PointerEvent) => {
    this.wrap.focus({ preventScroll: true });
    if ((e.target as HTMLElement) !== this.canvas) return; // overlay buttons
    const p = this.getProps();
    this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (e.button !== 0) return;
    if (p.tool === 'place' && p.placeType) {
      e.stopPropagation();
      e.preventDefault();
      const w = this.planePoint(e);
      if (w) this.place(p.placeType, w, e);
      this.down = null;
      return;
    }
    const g = this.pickGizmo(e);
    if (g) {
      e.stopPropagation();
      e.preventDefault();
      this.startDrag(g.key, g.point, e);
      try { this.wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.getProps();
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) this.down.moved = true;
    if (this.drag) { this.updateDrag(e); return; }
    const w = this.planePoint(e);
    p.onCursor?.(w ? { x: w.x, y: -w.y } : null);
    if (e.buttons) return; // orbiting / panning
    const g = this.pickGizmo(e);
    this.gizmo.setHover(g?.key ?? null);
    const id = g ? null : this.pickComponent(e);
    if (id !== this.hoverId) { this.hoverId = id; this.updateSelectionVisuals(); }
    this.canvas.style.cursor = g ? (isRing(g.key) ? 'grab' : 'move') : p.tool === 'place' ? 'crosshair' : id ? 'pointer' : 'default';
    this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag) { this.endDrag(true); try { this.wrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ } return; }
    const d = this.down;
    this.down = null;
    if (!d || d.moved || d.button !== 0 || e.button !== 0) return;
    if ((e.target as HTMLElement) !== this.canvas) return;
    const p = this.getProps();
    if (p.tool === 'place') return;
    const id = this.pickComponent(e);
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (multi) {
      if (!id) return;
      const s = p.selection.includes(id) ? p.selection.filter((x) => x !== id) : [...p.selection, id];
      p.onSelectionChange(s);
    } else {
      const next = id ? [id] : [];
      if (next.length !== p.selection.length || next.some((x, i) => x !== p.selection[i])) p.onSelectionChange(next);
    }
  };

  private onPointerCancel = () => { if (this.drag) this.cancelDrag(); this.down = null; };
  private onPointerLeave = () => {
    this.getProps().onCursor?.(null);
    if (this.hoverId) { this.hoverId = null; this.updateSelectionVisuals(); }
    this.gizmo.setHover(null);
    this.dirty = true;
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const d = this.down;
    this.down = null;
    if (d && d.moved) return; // right-drag was a pan
    if ((e.target as HTMLElement) !== this.canvas) return;
    const p = this.getProps();
    const id = this.pickComponent(e);
    if (id && !p.selection.includes(id)) p.onSelectionChange([id]);
    p.onContextMenu?.(id, { x: e.clientX, y: e.clientY });
  };

  // ======================================================================== gizmo drags
  private compName(c: OpticalComponent | undefined): string {
    if (!c) return '';
    return c.name || this.getProps().opticsEngine.registry.find((d) => d.type === c.type)?.label || c.type;
  }

  private startDrag(key: HandleKey, grab: THREE.Vector3, e: PointerEvent) {
    const p = this.getProps();
    const prim = this.primary(p);
    const pivot = this.gizmoPivot(p);
    if (!prim || !pivot) return;
    const ids = new Set(this.movable(p).map((c) => c.id));
    const many = ids.size > 1;
    const what = many ? `${ids.size} components` : this.compName(prim);
    const d: Drag = { key, base: p.scene, ids, anchorId: prim.id, pivot: pivot.clone(), startClient: { x: e.clientX, y: e.clientY }, last: null, label: '' };
    const ray = this.rayAt(e);
    if (isRing(key)) {
      const w = worldPoseOf(prim);
      const axis = tv(rotationAxes(w.yaw, w.pitch)[key]).normalize();
      d.axis = axis;
      d.startValue = w[key];
      d.total = 0;
      const view = pivot.clone().sub(this.camera.position).normalize();
      d.planeMode = Math.abs(view.dot(axis)) > 0.22;
      if (d.planeMode) {
        const hit = rayPlane(ray, pv(pivot), pv(axis)) ?? pv(grab);
        d.ref = { x: hit.x - pivot.x, y: hit.y - pivot.y, z: hit.z - pivot.z };
        d.prevAngle = 0;
      } else {
        // edge-on ring: drag along the ring's screen tangent at the grab point
        const rel = grab.clone().sub(pivot);
        const tan = axis.clone().cross(rel).normalize().multiplyScalar(this.gizmo.unit * 0.5);
        const s0 = this.toScreen(grab), s1 = this.toScreen(grab.clone().add(tan));
        const l = Math.hypot(s1.x - s0.x, s1.y - s0.y);
        d.tangent = l > 1e-3 ? { x: (s1.x - s0.x) / l, y: (s1.y - s0.y) / l } : { x: 1, y: 0 };
      }
      d.label = `Rotate ${what} (${HANDLE_LABEL[key].toLowerCase()})`;
    } else if (isPlane(key)) {
      const hit = rayPlane(ray, pv(pivot), PLANE_NORMAL[key]);
      if (!hit) return;
      d.start = tv(hit);
      d.label = `Move ${what}`;
    } else {
      const t = closestOnAxis(ray, pv(pivot), AXIS_VEC[key]);
      if (t === null) return;
      d.t0 = t;
      d.label = `Move ${what}`;
    }
    this.drag = d;
    this.gizmo.setActive(key);
    this.canvas.style.cursor = isRing(key) ? 'grabbing' : 'move';
    this.controls.enabled = false;
    this.dirty = true;
  }

  private updateDrag(e: PointerEvent) {
    const d = this.drag!;
    const p = this.getProps();
    const ray = this.rayAt(e);
    let next: OpticsScene | null = null;
    let text = '';
    if (isRing(d.key)) {
      const axis = d.axis!;
      if (d.planeMode) {
        const hit = rayPlane(ray, pv(d.pivot), pv(axis));
        if (hit) {
          const a = angleAround(hit, pv(d.pivot), pv(axis), d.ref!);
          d.total! += wrapPi(a - d.prevAngle!);
          d.prevAngle = a;
        }
      } else {
        const dx = e.clientX - d.startClient.x, dy = e.clientY - d.startClient.y;
        d.total = (dx * d.tangent!.x + dy * d.tangent!.y) / (GIZMO_PX * RING_RADIUS);
      }
      const r = rotateComponents(d.base, d.ids, d.anchorId, d.key as RingKey, d.total!, rotateStepDeg(e), pv(d.pivot));
      next = r.scene;
      text = `${HANDLE_LABEL[d.key]} ${fmt(r.value / DEG)}°  (Δ ${sgn(r.delta / DEG)}°)`;
    } else {
      const step = translateStep(e);
      let delta: Vec3 | null = null;
      let axes: ('x' | 'y' | 'z')[];
      if (isPlane(d.key)) {
        axes = PLANE_AXES[d.key];
        const hit = rayPlane(ray, pv(d.pivot), PLANE_NORMAL[d.key]);
        if (hit) delta = { x: hit.x - d.start!.x, y: hit.y - d.start!.y, z: hit.z - d.start!.z };
      } else {
        axes = [d.key as 'x' | 'y' | 'z'];
        const t = closestOnAxis(ray, pv(d.pivot), AXIS_VEC[d.key as 'x' | 'y' | 'z']);
        if (t !== null) {
          // guard against the ray grazing parallel to the axis (huge jumps)
          const tt = THREE.MathUtils.clamp(t - d.t0!, -20000, 20000);
          const a = AXIS_VEC[d.key as 'x' | 'y' | 'z'];
          delta = { x: a.x * tt, y: a.y * tt, z: a.z * tt };
        }
      }
      if (delta) {
        const r = translateComponents(d.base, d.ids, d.anchorId, delta, axes, step);
        next = r.scene;
        const anchor = r.scene.components.find((c) => c.id === d.anchorId);
        const wp = anchor ? worldPoseOf(anchor).p : { x: 0, y: 0, z: 0 };
        text = axes.map((k) => `${k.toUpperCase()} ${fmt(wp[k])}  (Δ ${sgn(r.delta[k])})`).join('   ') + ' mm';
      }
    }
    if (next) {
      d.last = next;
      p.onSceneChange(next, { commit: false });
    }
    if (text) this.showReadout(text, e);
  }

  private showReadout(text: string, e: { clientX: number; clientY: number }) {
    const el = this.ui.readout;
    const r = this.wrap.getBoundingClientRect();
    el.textContent = text;
    el.style.display = '';
    const x = Math.min(r.width - 10, Math.max(4, e.clientX - r.left + 16)), y = Math.max(4, e.clientY - r.top + 18);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private endDrag(commit: boolean) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ui.readout.style.display = 'none';
    this.gizmo.setActive(null);
    this.controls.enabled = true;
    this.canvas.style.cursor = 'default';
    const p = this.getProps();
    if (commit && d.last && d.last !== d.base) p.onSceneChange(d.last, { commit: true, label: d.label });
    this.updateSelectionVisuals();
    this.dirty = true;
  }

  private cancelDrag() {
    const d = this.drag;
    if (!d) return;
    if (d.last) this.getProps().onSceneChange(d.base, { commit: false });
    d.last = null;
    this.endDrag(false);
  }

  // ======================================================================== keyboard
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && t !== this.wrap && /INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName)) return;
    const p = this.getProps();
    if (e.key === 'Escape') {
      if (this.drag) { e.preventDefault(); e.stopPropagation(); this.cancelDrag(); }
      return;
    }
    if (this.drag) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.frameSelection(); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.setCameraPreset('top'); return; }
    }
    const step = e.ctrlKey || e.metaKey ? 0.1 : e.shiftKey ? 10 : 1;
    const map: Record<string, Vec3> = {
      ArrowLeft: { x: -step, y: 0, z: 0 }, ArrowRight: { x: step, y: 0, z: 0 },
      ArrowUp: { x: 0, y: step, z: 0 }, ArrowDown: { x: 0, y: -step, z: 0 },
      PageUp: { x: 0, y: 0, z: step }, PageDown: { x: 0, y: 0, z: -step },
    };
    const dv = map[e.key];
    if (dv && p.selection.length) {
      e.preventDefault();
      const next = nudgeComponents(p.scene, new Set(p.selection), dv);
      if (next.components.some((c, i) => c !== p.scene.components[i])) p.onSceneChange(next, { commit: true, label: e.key.startsWith('Page') ? 'Nudge Z' : 'Nudge' });
    }
  };

  // ======================================================================== palette drop / place
  private place(type: string, w: Vec3, e: { ctrlKey: boolean; metaKey?: boolean }) {
    const p = this.getProps();
    const step = e.ctrlKey || e.metaKey ? 0 : 1;
    let c: OpticalComponent;
    try {
      c = p.opticsEngine.createComponent(type, { x: snap(w.x, step), y: snap(-w.y, step) });
    } catch (err) {
      console.error('[optics3d] createComponent failed', err);
      return;
    }
    c = { ...c, pose3d: { z: 0, pitch: 0, roll: 0 } };
    const label = p.opticsEngine.registry.find((d) => d.type === type)?.label ?? type;
    p.onSceneChange({ ...p.scene, components: [...p.scene.components, c] }, { commit: true, label: `Add ${label}` });
    p.onSelectionChange([c.id]);
  }

  private onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).includes(PALETTE_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      const w = this.planePoint(e);
      this.getProps().onCursor?.(w ? { x: w.x, y: -w.y } : null);
    }
  };

  private onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer?.getData(PALETTE_DND_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: PaletteDragPayload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || payload.domain !== 'optics' || typeof payload.type !== 'string') return;
    this.wrap.focus({ preventScroll: true });
    const w = this.planePoint(e);
    if (w) this.place(payload.type, w, e);
  };

  // ======================================================================== context loss
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.cb.onContextLost(true);
  };
  private onRestored = () => {
    this.lost = false;
    this.cb.onContextLost(false);
    this.cb.onRestored();
  };

  // ======================================================================== teardown
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const w = this.wrap;
    w.removeEventListener('pointerdown', this.onPointerDown, true);
    w.removeEventListener('pointermove', this.onPointerMove);
    w.removeEventListener('pointerup', this.onPointerUp);
    w.removeEventListener('pointercancel', this.onPointerCancel);
    w.removeEventListener('pointerleave', this.onPointerLeave);
    w.removeEventListener('contextmenu', this.onContextMenu);
    w.removeEventListener('keydown', this.onKeyDown);
    w.removeEventListener('dragover', this.onDragOver);
    w.removeEventListener('drop', this.onDrop);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.controls.dispose();
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    this.beams.dispose();
    this.table.dispose();
    this.mats.dispose();
    this.gizmo.dispose();
    this.bracketGeo.dispose();
    this.bracketSel.dispose();
    this.bracketHover.dispose();
    this.triad.dispose();
    this.envTex.dispose();
    this.pmrem.dispose();
    this.key.shadow.map?.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
    this.renderer.renderLists.dispose();
    // leave the (possibly reused, e.g. React StrictMode remount) GL context in default unpack state
    const gl = this.renderer.getContext();
    if (!gl.isContextLost()) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    this.renderer.dispose();
  }
}

// ========================================================================== helpers

/** Cache key for geometry: everything except identity. (Mount meshes depend on pose too.) */
function geomKey(c: OpticalComponent, depth: number): string {
  return JSON.stringify([c.type, c.position, c.rotation, c.pose3d ?? null, c.props, depth]);
}

/** Unit-cube corner brackets (each edge 25 % from the corners). */
function bracketGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const k = 0.25;
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    pts.push(x, y, z, x - Math.sign(x) * k, y, z);
    pts.push(x, y, z, x, y - Math.sign(y) * k, z);
    pts.push(x, y, z, x, y, z - Math.sign(z) * k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Planar UVs for a detector face: project to the component-local plane of least extent. */
function planarUV(geo: THREE.BufferGeometry, m: Mesh3D, c: OpticalComponent, engine: Optics3DViewportProps['engine3d']) {
  const P = m.positions;
  const n = P.length / 3;
  const L = new Float32Array(n * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    let l: Vec3;
    try { l = engine.worldToLocal(c, { x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2] }); } catch { l = { x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2] }; }
    L[i * 3] = l.x; L[i * 3 + 1] = l.y; L[i * 3 + 2] = l.z;
    lo[0] = Math.min(lo[0], l.x); lo[1] = Math.min(lo[1], l.y); lo[2] = Math.min(lo[2], l.z);
    hi[0] = Math.max(hi[0], l.x); hi[1] = Math.max(hi[1], l.y); hi[2] = Math.max(hi[2], l.z);
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const thin = ext.indexOf(Math.min(...ext));
  const [ua, va] = thin === 0 ? [1, 2] : thin === 1 ? [0, 2] : [0, 1];
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = ext[ua] > 1e-6 ? (L[i * 3 + ua] - lo[ua]) / ext[ua] : 0.5;
    uv[i * 2 + 1] = ext[va] > 1e-6 ? (L[i * 3 + va] - lo[va]) / ext[va] : 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function imageTexture(img: { w: number; h: number; data: number[]; rgb?: number[] }, engine: Optics3DViewportProps['opticsEngine']): THREE.DataTexture {
  const { w, h } = img;
  const out = new Uint8Array(w * h * 4);
  let mx = 0;
  const hasRGB = !!img.rgb && img.rgb.length >= w * h * 3;
  if (hasRGB) for (let i = 0; i < w * h * 3; i++) mx = Math.max(mx, img.rgb![i]);
  else for (let i = 0; i < w * h; i++) mx = Math.max(mx, img.data[i]);
  void engine;
  const inv = mx > 0 ? 1 / mx : 0;
  for (let k = 0; k < w * h; k++) {
    // engine image row 0 = top; texture row 0 = v 0 = bottom of the face (local −z) -> flip rows
    const i = (h - 1 - Math.floor(k / w)) * w + (k % w);
    let r: number, g: number, b: number;
    if (hasRGB) { r = img.rgb![i * 3] * inv; g = img.rgb![i * 3 + 1] * inv; b = img.rgb![i * 3 + 2] * inv; }
    else { const v = img.data[i] * inv; r = v; g = v; b = v; }
    // gentle gamma so faint light is visible
    out[k * 4] = Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, r))));
    out[k * 4 + 1] = Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, g))));
    out[k * 4 + 2] = Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, b))));
    out[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeTriad() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
  const disposables: { dispose(): void }[] = [];
  const axes: [THREE.Vector3, number, string][] = [
    [new THREE.Vector3(1, 0, 0), 0xf0453a, 'X'], [new THREE.Vector3(0, 1, 0), 0x4cc94c, 'Y'], [new THREE.Vector3(0, 0, 1), 0x3d8bff, 'Z'],
  ];
  const shaft = new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8).translate(0, 0.425, 0);
  const head = new THREE.ConeGeometry(0.13, 0.3, 14).translate(0, 1.0, 0);
  disposables.push(shaft, head);
  for (const [dir, col, name] of axes) {
    const m = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    disposables.push(m);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(shaft, m), new THREE.Mesh(head, m));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(g);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d')!;
    x.font = 'bold 44px Tahoma, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#' + col.toString(16).padStart(6, '0');
    x.fillText(name, 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.SpriteMaterial({ map: tex, toneMapped: false, depthTest: false });
    disposables.push(tex, sm);
    const s = new THREE.Sprite(sm);
    s.position.copy(dir).multiplyScalar(1.38);
    s.scale.setScalar(0.55);
    scene.add(s);
  }
  const dot = new THREE.SphereGeometry(0.09, 12, 8);
  const dm = new THREE.MeshBasicMaterial({ color: 0xdddddd, toneMapped: false });
  disposables.push(dot, dm);
  scene.add(new THREE.Mesh(dot, dm));
  return { scene, camera, dispose: () => disposables.forEach((d) => d.dispose()) };
}
