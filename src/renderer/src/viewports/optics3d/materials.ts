/**
 * Mesh3D role -> three.js material. Materials are cached per look key and shared between meshes;
 * per-component emissive materials (emitters, detector faces) are created per component and
 * disposed with it.
 */
import * as THREE from 'three';
import type { OpticalComponent, OpticsEngineAPI } from '@core/types';
import type { Mesh3D } from '@core/types3d';
import { fiberJacket, glassTint } from '../optics/style';

export type Look3D = 'glass' | 'mirror' | 'anodized' | 'steel' | 'black' | 'blade' | 'housing' | 'sensor' | 'face' | 'emitter' | 'jacket' | 'decor' | 'magnet' | 'marker' | 'field';

const NON_GLASS = /^(source|detector|absorber|aperture|fiber)/;

export function lookOf(c: OpticalComponent, m: Mesh3D): Look3D {
  const mat = (m.material ?? '').toLowerCase();
  const t = c.type;
  switch (m.role) {
    case 'mirror': return 'mirror';
    case 'absorber': return 'black';
    case 'detector': return 'face';
    case 'emitter': return 'emitter';
    case 'aperture': return 'blade';
    case 'mount': return mat === 'metal' || mat === 'steel' ? 'steel' : 'anodized';
    case 'decor':
      if (t.startsWith('fiber')) return 'jacket';
      if (mat === 'metal' || mat === 'steel') return 'steel';
      if (mat === 'rubber') return 'black';
      if (mat === 'substrate') return 'glass';
      if (mat === 'magnet') return 'magnet';
      if (mat === 'marker') return 'marker';
      if (mat === 'field') return 'field';
      return mat === 'anodized' ? 'anodized' : 'decor';
    case 'body':
    case 'surface':
    default:
      if (mat === 'metal' || mat === 'steel') return 'steel';
      if (mat === 'anodized') return 'anodized';
      if (mat === 'rubber') return t.startsWith('fiber') ? 'jacket' : 'black';
      if (t.startsWith('fiber')) return 'jacket';
      if (t.startsWith('source.')) return 'housing';
      if (t.startsWith('detector.')) return 'sensor';
      if (t.startsWith('absorber.')) return 'black';
      if (t.startsWith('aperture.')) return 'blade';
      if (NON_GLASS.test(t)) return 'anodized';
      return 'glass';
  }
}

/** Approximate refractive index for the glass look (rendering only). */
export function iorFor(material: string | undefined): number {
  const m = (material ?? '').toLowerCase();
  if (/water/.test(m)) return 1.333;
  if (/sf11|sf10|lasf|nsf|sf6/.test(m)) return 1.78;
  if (/f2|flint|sf/.test(m)) return 1.62;
  if (/silica|quartz|fused/.test(m)) return 1.458;
  if (/sapphire/.test(m)) return 1.77;
  if (/diamond/.test(m)) return 2.42;
  if (/acryl|pmma/.test(m)) return 1.49;
  if (/polycarb/.test(m)) return 1.585;
  if (/caf2|fluor/.test(m)) return 1.434;
  if (/calcite/.test(m)) return 1.6;
  if (/zns|znse/.test(m)) return 2.35;
  return 1.517;
}

export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  constructor(private engine2d: () => OpticsEngineAPI) {}

  /** Shared material for a static look. Glass is keyed by tint/ior. */
  get(c: OpticalComponent, m: Mesh3D, look: Look3D): THREE.Material {
    let key: string = look;
    let tint: [number, number, number] | null = null;
    let ior = 1.5;
    if (look === 'glass') {
      tint = glassTint(c, m.material, this.engine2d());
      ior = iorFor(m.material ?? String(c.props.material ?? ''));
      key = `glass:${tint.map((v) => v.toFixed(2)).join(',')}:${ior.toFixed(3)}`;
    } else if (look === 'mirror') {
      key = `mirror:${mirrorCoat(c, m)}`;
    } else if (look === 'jacket') {
      key = `jacket:${fiberJacket(c)}`;
    }
    let mat = this.cache.get(key);
    if (mat) return mat;
    mat = this.create(c, look, tint, ior, m);
    this.cache.set(key, mat);
    return mat;
  }

  private create(c: OpticalComponent, look: Look3D, tint: [number, number, number] | null, ior: number, m: Mesh3D): THREE.Material {
    switch (look) {
      case 'glass': {
        const t = tint ?? [0.6, 0.85, 1];
        const col = new THREE.Color().setRGB(0.82 + 0.18 * t[0], 0.82 + 0.18 * t[1], 0.82 + 0.18 * t[2], THREE.SRGBColorSpace);
        return new THREE.MeshPhysicalMaterial({
          color: col, metalness: 0, roughness: 0.05, transmission: 0.94, ior, thickness: 14,
          attenuationColor: new THREE.Color().setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace), attenuationDistance: 60,
          specularIntensity: 1, clearcoat: 0.3, clearcoatRoughness: 0.05, envMapIntensity: 1.4,
          depthWrite: false, side: THREE.FrontSide,
        });
      }
      case 'mirror': {
        const coat = mirrorCoat(c, m);
        if (coat.includes('dichroic')) return new THREE.MeshStandardMaterial({ color: '#9fe3ff', metalness: 0.9, roughness: 0.05, envMapIntensity: 1.4, transparent: true, opacity: 0.85 });
        const color = coat.includes('gold') ? '#ffd27a' : coat.includes('copper') ? '#f2a27a' : coat.includes('alum') ? '#d9dde2' : '#eef1f4';
        return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.04, envMapIntensity: 1.6 });
      }
      case 'steel': return new THREE.MeshStandardMaterial({ color: '#a7adb4', metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
      case 'anodized': return new THREE.MeshStandardMaterial({ color: '#17181b', metalness: 0.55, roughness: 0.42, envMapIntensity: 0.9 });
      case 'housing': return new THREE.MeshStandardMaterial({ color: '#232529', metalness: 0.6, roughness: 0.38, envMapIntensity: 0.9 });
      case 'sensor': return new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.5, roughness: 0.45, envMapIntensity: 0.8 });
      case 'black': return new THREE.MeshStandardMaterial({ color: '#0b0b0c', metalness: 0.1, roughness: 0.85, envMapIntensity: 0.4 });
      case 'blade': return new THREE.MeshStandardMaterial({ color: '#1d1e21', metalness: 0.75, roughness: 0.5, envMapIntensity: 0.8, side: THREE.DoubleSide });
      case 'jacket': return new THREE.MeshStandardMaterial({ color: fiberJacket(c), metalness: 0, roughness: 0.55, envMapIntensity: 0.6 });
      case 'magnet': return new THREE.MeshStandardMaterial({ color: '#4a4c52', metalness: 0.8, roughness: 0.35 });
      case 'marker': return new THREE.MeshStandardMaterial({ color: '#d9d9d9', metalness: 0, roughness: 0.6 });
      case 'field': return new THREE.MeshBasicMaterial({ color: '#7fa7ff', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
      case 'decor': return new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.4, roughness: 0.5 });
      default: return new THREE.MeshStandardMaterial({ color: '#444', roughness: 0.6 });
    }
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

/** Mirror coating id: mesh material from the 3D engine (silver/aluminium/gold/ideal/dichroic/grating) or the `coating` prop. */
function mirrorCoat(c: OpticalComponent, m: Mesh3D): string {
  const mm = (m.material ?? '').toLowerCase();
  return mm && mm !== 'metal' ? mm : String(c.props.coating ?? '').toLowerCase();
}

/** Per-component emissive material (emitter aperture / detector face). Owned by the component entry. */
export function emissiveMaterial(kind: 'emitter' | 'face'): THREE.MeshStandardMaterial {
  return kind === 'emitter'
    ? new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.2, roughness: 0.3, emissive: '#000000', emissiveIntensity: 1 })
    : new THREE.MeshStandardMaterial({ color: '#0d1014', metalness: 0.3, roughness: 0.35, emissive: '#000000', emissiveIntensity: 1 });
}
