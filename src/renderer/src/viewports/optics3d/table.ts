/**
 * Optical breadboard: dark matte slab whose top surface sits at z = −tableDepth, with an optional
 * low-contrast tapped-hole pattern on a 25 mm pitch (holes at integer multiples of 25 mm, so the
 * world origin is on a hole).
 */
import * as THREE from 'three';

export const HOLE_PITCH = 25;
const SLAB = 18; // mm thickness

function holeTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  // countersink ring + dark tapped hole (M6 on 25 mm -> ~0.24 of the pitch)
  const c = S / 2;
  const rg = g.createRadialGradient(c, c, S * 0.1, c, c, S * 0.2);
  rg.addColorStop(0, '#6a6a6a');
  rg.addColorStop(0.65, '#b4b4b4');
  rg.addColorStop(1, '#ffffff');
  g.fillStyle = rg;
  g.beginPath(); g.arc(c, c, S * 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#303030';
  g.beginPath(); g.arc(c, c, S * 0.105, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export class OpticalTable {
  readonly group = new THREE.Group();
  private top: THREE.Mesh;
  private slab: THREE.Mesh;
  private holes: THREE.CanvasTexture;
  private topMat: THREE.MeshStandardMaterial;
  private slabMat: THREE.MeshStandardMaterial;
  private key = '';
  /** Current table rectangle (world mm). */
  rect = { x0: -300, y0: -200, x1: 300, y1: 200 };

  constructor(maxAnisotropy: number) {
    this.holes = holeTexture();
    this.holes.anisotropy = Math.min(8, maxAnisotropy);
    this.topMat = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.82, metalness: 0.12, envMapIntensity: 0.45 });
    this.slabMat = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5 });
    this.top = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.topMat);
    this.top.receiveShadow = true;
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.slabMat);
    this.slab.receiveShadow = true;
    this.group.add(this.top, this.slab);
    this.group.userData.table = true;
  }

  /** Size the table to cover `b` (world xy bounds) + margin; snapped to the hole grid. */
  fit(b: { minX: number; minY: number; maxX: number; maxY: number }, depth: number, showGrid: boolean) {
    const m = 125;
    const P = HOLE_PITCH;
    let x0 = Math.floor((b.minX - m) / P) * P - P / 2, x1 = Math.ceil((b.maxX + m) / P) * P + P / 2;
    let y0 = Math.floor((b.minY - m) / P) * P - P / 2, y1 = Math.ceil((b.maxY + m) / P) * P + P / 2;
    if (x1 - x0 < 600) { const c = Math.round((x0 + x1) / 2 / P) * P; x0 = c - 300 - P / 2; x1 = c + 300 + P / 2; }
    if (y1 - y0 < 450) { const c = Math.round((y0 + y1) / 2 / P) * P; y0 = c - 225 - P / 2; y1 = c + 225 + P / 2; }
    const key = `${x0},${y0},${x1},${y1},${depth},${showGrid}`;
    if (key === this.key) return;
    this.key = key;
    this.rect = { x0, y0, x1, y1 };
    const w = x1 - x0, h = y1 - y0;
    this.top.scale.set(w, h, 1);
    this.top.position.set((x0 + x1) / 2, (y0 + y1) / 2, -depth);
    this.slab.scale.set(w, h, SLAB);
    this.slab.position.set((x0 + x1) / 2, (y0 + y1) / 2, -depth - SLAB / 2 - 0.05);
    if (showGrid) {
      this.holes.repeat.set(w / P, h / P);
      // tile corners at x0 (= k·P − P/2) put hole centres on multiples of P
      this.holes.offset.set(0, 0);
      this.topMat.map = this.holes;
    } else {
      this.topMat.map = null;
    }
    this.topMat.needsUpdate = true;
  }

  dispose() {
    this.top.geometry.dispose();
    this.slab.geometry.dispose();
    this.topMat.dispose();
    this.slabMat.dispose();
    this.holes.dispose();
  }
}
