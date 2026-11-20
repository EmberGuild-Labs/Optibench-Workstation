/**
 * Light rendering: every Ray3Segment becomes one instanced, camera-facing ribbon with a gaussian
 * cross-section, drawn additively in linear HDR (so overlapping spectral samples sum to white and
 * the bloom pass picks up the bright cores). Intensity follows the 2D viewport's model
 * (wavelengthToRGB × power, per-source normalisation, log-ish brightness).
 *
 * Pulse mode (timeView.mode === 'pulse'): the vertex shader clips each segment to the part whose
 * time of flight lies in [t − pulseWidth, t], so a pulse front travels smoothly along segments;
 * the fragment shader shapes a soft envelope with a bright leading edge.
 */
import * as THREE from 'three';
import type { OpticsEngineAPI } from '@core/types';
import type { Ray3Segment, Trace3DResult } from '@core/types3d';
import { safeRGB } from '../optics/style';
import { brightness } from '../optics/lightData';

const VERT = /* glsl */ `
attribute vec2 corner;            // x: 0 = start, 1 = end;  y: -1..1 across
attribute vec3 iA;
attribute vec3 iB;
attribute vec3 iColor;
attribute vec2 iTime;             // t0, t1 (s)
uniform vec2 uResolution;         // drawing-buffer px
uniform float uWidthPx;
uniform float uMode;              // 0 steady, 1 pulse
uniform float uTime;             // ns
uniform float uPulse;
uniform float uNear;
varying vec3 vColor;
varying float vAcross;
varying float vPhase;             // 0 = tail of pulse … 1 = front (pulse mode)

void main() {
  float s0 = 0.0, s1 = 1.0;
  vColor = iColor;
  vPhase = 1.0;
  if (uMode > 0.5) {
    float dt = max(iTime.y - iTime.x, 1e-9);
    s0 = clamp((uTime - uPulse - iTime.x) / dt, 0.0, 1.0);
    s1 = clamp((uTime - iTime.x) / dt, 0.0, 1.0);
    if (s1 - s0 <= 1e-6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  vec3 A = mix(iA, iB, s0);
  vec3 B = mix(iA, iB, s1);
  vec4 va = modelViewMatrix * vec4(A, 1.0);
  vec4 vb = modelViewMatrix * vec4(B, 1.0);
  float nz = -uNear;
  if (va.z > nz && vb.z > nz) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (va.z > nz) va = mix(vb, va, (nz - vb.z) / (va.z - vb.z));
  if (vb.z > nz) vb = mix(va, vb, (nz - va.z) / (vb.z - va.z));
  vec4 ca = projectionMatrix * va;
  vec4 cb = projectionMatrix * vb;
  vec2 sa = ca.xy / ca.w * 0.5 * uResolution;
  vec2 sb = cb.xy / cb.w * 0.5 * uResolution;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float hw = 0.5 * uWidthPx;
  vec4 p = corner.x < 0.5 ? ca : cb;
  vec2 off = perp * corner.y * hw + dir * (corner.x * 2.0 - 1.0) * hw * 0.5;
  gl_Position = p + vec4(off / (0.5 * uResolution) * p.w, 0.0, 0.0);
  vAcross = corner.y;
  if (uMode > 0.5) {
    float s = mix(s0, s1, corner.x);
    float tf = mix(iTime.x, iTime.y, s);
    vPhase = clamp(1.0 - (uTime - tf) / max(uPulse, 1e-9), 0.0, 1.0);
  }
}`;

const FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uMode;
uniform float uSharp;
varying vec3 vColor;
varying float vAcross;
varying float vPhase;
void main() {
  float a = vAcross;
  float core = exp(-a * a * uSharp);
  float env = 1.0;
  if (uMode > 0.5) env = 1.6 * (0.25 + 0.75 * smoothstep(0.0, 0.9, vPhase) + 1.5 * smoothstep(0.82, 1.0, vPhase));
  vec3 c = vColor * core * uIntensity * env;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface BeamUpdateInput {
  trace: Trace3DResult | null;
  engine2d: OpticsEngineAPI;
  /**
   * Repeated pulses (pulse mode with a repetition period): every segment is instanced once per
   * pulse that can be on it, with its times shifted by −k·period, so one window [t − w, t] shows
   * every pulse in flight (t = front of the newest pulse, 0 ≤ t < period + w).
   */
  pulses?: { period: number; width: number } | null;
}

const MAX_COPIES = 48;

export interface SourceGlow { rgb: [number, number, number]; level: number }

export class BeamLayer {
  readonly group = new THREE.Group();
  private geo = new THREE.InstancedBufferGeometry();
  private core: THREE.Mesh;
  private haze: THREE.Mesh;
  readonly coreMat: THREE.ShaderMaterial;
  readonly hazeMat: THREE.ShaderMaterial;
  private capacity = 0;
  private aA!: THREE.InstancedBufferAttribute;
  private aB!: THREE.InstancedBufferAttribute;
  private aC!: THREE.InstancedBufferAttribute;
  private aT!: THREE.InstancedBufferAttribute;
  /** Latest segment start time (s) = time of the last interaction on the bench; scales the default pulse width. */
  maxT = 0;
  /** Per-source glow colour + brightness for emitter apertures. */
  sources = new Map<string, SourceGlow>();

  constructor() {
    const corner = new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]);
    this.geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.ensure(1024);
    this.geo.instanceCount = 0;
    const uniforms = () => ({
      uResolution: { value: new THREE.Vector2(1, 1) }, uWidthPx: { value: 2.5 }, uMode: { value: 0 }, uTime: { value: 0 },
      uPulse: { value: 1e-10 }, uNear: { value: 1 }, uIntensity: { value: 1 }, uSharp: { value: 3.2 },
    });
    const common = { vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: true };
    this.coreMat = new THREE.ShaderMaterial({ ...common, uniforms: uniforms() });
    this.hazeMat = new THREE.ShaderMaterial({ ...common, uniforms: uniforms() });
    this.hazeMat.uniforms.uSharp.value = 2.0;
    this.core = new THREE.Mesh(this.geo, this.coreMat);
    this.haze = new THREE.Mesh(this.geo, this.hazeMat);
    for (const m of [this.core, this.haze]) { m.frustumCulled = false; m.renderOrder = 10; this.group.add(m); }
    this.haze.renderOrder = 9;
  }

  private ensure(n: number) {
    if (n <= this.capacity) return;
    const cap = Math.max(1024, Math.ceil(n * 1.3));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.geo.setAttribute('iA', this.aA);
    this.geo.setAttribute('iB', this.aB);
    this.geo.setAttribute('iColor', this.aC);
    this.geo.setAttribute('iTime', this.aT);
    this.capacity = cap;
  }

  update({ trace, engine2d, pulses }: BeamUpdateInput) {
    const segs = trace?.segments ?? [];
    const n = segs.length;
    // ---- per-source normalisation (same model as the 2D viewport) -------------------
    interface Acc { total: number; beams: Set<string>; r: number; g: number; b: number; scale: number; B: number }
    const src = new Map<string, Acc>();
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      if (s.depth !== 0) continue;
      let acc = src.get(s.sourceId);
      if (!acc) { acc = { total: 0, beams: new Set(), r: 0, g: 0, b: 0, scale: 1, B: 1 }; src.set(s.sourceId, acc); }
      const p = s.power > 0 ? s.power : 0;
      acc.total += p;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z, l = Math.hypot(dx, dy, dz) || 1;
      acc.beams.add(`${Math.round(s.a.x * 100)},${Math.round(s.a.y * 100)},${Math.round(s.a.z * 100)},${Math.round((dx / l) * 1000)},${Math.round((dy / l) * 1000)},${Math.round((dz / l) * 1000)}`);
      const rgb = safeRGB(engine2d, s.wavelength);
      acc.r += rgb[0] * p; acc.g += rgb[1] * p; acc.b += rgb[2] * p;
    }
    this.sources.clear();
    for (const [id, acc] of src) {
      const mx = Math.max(acc.r, acc.g, acc.b);
      acc.scale = mx > 0 ? Math.sqrt(acc.beams.size) / mx : 0;
      acc.B = brightness(acc.total);
      const cm = Math.max(mx, 1e-30);
      this.sources.set(id, { rgb: [acc.r / cm, acc.g / cm, acc.b / cm], level: acc.B });
    }
    const P = pulses && pulses.period > 0 && Number.isFinite(pulses.period) ? pulses.period : 0;
    const PW = P > 0 && Number.isFinite(pulses!.width) ? Math.max(0, pulses!.width) : 0;
    const copyRange = (s: Ray3Segment): [number, number] => {
      if (!(P > 0)) return [0, 0];
      const t0 = Number.isFinite(s.t0) ? s.t0! : 0, t1 = Number.isFinite(s.t1) ? s.t1! : t0;
      const lo = Math.max(0, Math.floor((t0 - P - PW) / P)), hi = Math.max(lo, Math.ceil((t1 + PW) / P));
      return [lo, Math.min(hi, lo + MAX_COPIES - 1)];
    };
    let need = n;
    if (P > 0) { need = 0; for (let i = 0; i < n; i++) { const [lo, hi] = copyRange(segs[i]); need += hi - lo + 1; } }
    this.ensure(need);
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, C = this.aC.array as Float32Array, T = this.aT.array as Float32Array;
    let k = 0;
    let maxT = 0;
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      let acc = src.get(s.sourceId);
      if (!acc) { acc = { total: s.power, beams: new Set(['x']), r: 0, g: 0, b: 0, scale: s.power > 0 ? 1 / s.power : 0, B: brightness(s.power) }; src.set(s.sourceId, acc); }
      const f = Math.max(0, s.power) * acc.scale * acc.B * (s.inMedium ? 0.82 : 1);
      if (!(f > 1e-5)) continue;
      const rgb = safeRGB(engine2d, s.wavelength);
      A[k * 3] = s.a.x; A[k * 3 + 1] = s.a.y; A[k * 3 + 2] = s.a.z;
      B[k * 3] = s.b.x; B[k * 3 + 1] = s.b.y; B[k * 3 + 2] = s.b.z;
      C[k * 3] = rgb[0] * f; C[k * 3 + 1] = rgb[1] * f; C[k * 3 + 2] = rgb[2] * f;
      const t0 = Number.isFinite(s.t0) ? s.t0! : 0;
      const t1 = Number.isFinite(s.t1) ? s.t1! : t0;
      T[k * 2] = t0 * 1e9; T[k * 2 + 1] = t1 * 1e9; // ns keeps float32 precision comfortable
      if (t0 > maxT) maxT = t0; // last interaction time (escaping rays' far ends would dominate t1)
      k++;
      if (P > 0) {
        // copies for pulses emitted k·P earlier (first copy above is k = lo after the shift below)
        const [lo, hi] = copyRange(s);
        const j0 = k - 1;
        T[j0 * 2] = (t0 - lo * P) * 1e9; T[j0 * 2 + 1] = (t1 - lo * P) * 1e9;
        for (let c = lo + 1; c <= hi; c++) {
          A[k * 3] = A[j0 * 3]; A[k * 3 + 1] = A[j0 * 3 + 1]; A[k * 3 + 2] = A[j0 * 3 + 2];
          B[k * 3] = B[j0 * 3]; B[k * 3 + 1] = B[j0 * 3 + 1]; B[k * 3 + 2] = B[j0 * 3 + 2];
          C[k * 3] = C[j0 * 3]; C[k * 3 + 1] = C[j0 * 3 + 1]; C[k * 3 + 2] = C[j0 * 3 + 2];
          T[k * 2] = (t0 - c * P) * 1e9; T[k * 2 + 1] = (t1 - c * P) * 1e9;
          k++;
        }
      }
    }
    this.maxT = maxT;
    for (const a of [this.aA, this.aB, this.aC, this.aT]) { a.needsUpdate = true; a.clearUpdateRanges(); }
    this.geo.instanceCount = k;
  }

  get count() { return this.geo.instanceCount; }

  setFrame(o: { width: number; height: number; dpr: number; near: number; exposure: number; haze: boolean; mode: 'steady' | 'pulse'; t: number; pulse: number; pxPerMm: number }) {
    // core width: thin crisp line ~2.2 css px, a touch wider when zoomed in on a beam (≈0.9 mm physical)
    const coreCss = Math.min(6, Math.max(2.2, 0.9 * o.pxPerMm));
    for (const [m, w, gain] of [[this.coreMat, coreCss, 1.45 * o.exposure], [this.hazeMat, coreCss * 7, 0.03 * o.exposure]] as const) {
      const u = m.uniforms;
      u.uResolution.value.set(o.width * o.dpr, o.height * o.dpr);
      u.uWidthPx.value = w * o.dpr;
      u.uNear.value = o.near;
      u.uIntensity.value = gain;
      u.uMode.value = o.mode === 'pulse' ? 1 : 0;
      u.uTime.value = o.t * 1e9;
      u.uPulse.value = o.pulse * 1e9;
    }
    this.haze.visible = o.haze;
  }

  dispose() {
    this.geo.dispose();
    this.coreMat.dispose();
    this.hazeMat.dispose();
  }
}
