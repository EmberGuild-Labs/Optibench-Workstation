/**
 * Converts a TraceResult into GPU-ready instance buffers (ray quads + glow sprites)
 * plus small per-component summaries used by the 2D layer (emitter glow colour,
 * detector face glow, fiber end glow).
 *
 * Intensity model
 * ---------------
 * For every source we group its depth-0 segments by (origin, direction): each group is
 * one geometric "beam"; members are its spectral samples. A ray's HDR colour is
 *   rgb(λ) · power · colourScale_s · B(P_s)
 * where colourScale_s normalises a full beam (sum over its spectral samples) to a
 * max channel of 1 — so white light sums to white and a lone laser is fully saturated —
 * and B(P) = log-ish brightness of the source's total power (1 µW … 10 W all visible).
 * The user exposure (display.rayOpacity) is applied as a uniform in the composite.
 */
import type { ComponentGeometry, OpticalComponent, OpticsEngineAPI, TraceResult, Vec2 } from '@core/types';
import { safeRGB } from './style';
import { segmentWindows, type TimeWindow } from '../../lib/timeView';

export const RAY_STRIDE = 12;    // floats per ray instance
export const SPRITE_STRIDE = 8;  // floats per sprite instance

export interface LightData {
  rays: Float32Array;
  rayCount: number;
  sprites: Float32Array;
  spriteCount: number;
  emitters: Map<string, { p: Vec2; rgb: [number, number, number]; level: number }>;
  detectors: Map<string, { rgb: [number, number, number]; level: number }>;
  fiberEnds: Map<string, { a: number; b: number; rgb: [number, number, number] }>;
}

/** log-ish brightness of a total power (W). 1 mW -> 0.6, 1 W -> 1.2, 1 µW -> 0.18 */
export function brightness(P: number): number {
  if (!(P > 0)) return 0;
  return Math.min(1.8, Math.max(0.12, 0.6 + 0.2 * Math.log10(P / 1e-3)));
}

let rayScratch = new Float32Array(0);
let spriteScratch = new Float32Array(0);

export function buildLightData(
  trace: TraceResult | null,
  engine: OpticsEngineAPI,
  components: OpticalComponent[],
  geomOf: (c: OpticalComponent) => ComponentGeometry,
  /** Slow-motion window: only light inside its time-of-flight window is emitted (per-source scaling unchanged). */
  win?: TimeWindow | null,
): LightData {
  const emitters: LightData['emitters'] = new Map();
  const detectors: LightData['detectors'] = new Map();
  const fiberEnds: LightData['fiberEnds'] = new Map();
  const segs = trace?.segments ?? [];
  const n = segs.length;

  // ---- per-source normalisation -------------------------------------------------
  interface SrcAcc { total: number; beams: Set<string>; r: number; g: number; b: number; px: number; py: number; cnt: number; scale: number; B: number }
  const src = new Map<string, SrcAcc>();
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    if (s.depth !== 0) continue;
    let acc = src.get(s.sourceId);
    if (!acc) { acc = { total: 0, beams: new Set(), r: 0, g: 0, b: 0, px: 0, py: 0, cnt: 0, scale: 1, B: 1 }; src.set(s.sourceId, acc); }
    const p = s.power > 0 ? s.power : 0;
    acc.total += p;
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l = Math.hypot(dx, dy) || 1;
    acc.beams.add(`${Math.round(s.a.x * 100)},${Math.round(s.a.y * 100)},${Math.round((dx / l) * 1000)},${Math.round((dy / l) * 1000)}`);
    const rgb = safeRGB(engine, s.wavelength);
    acc.r += rgb[0] * p; acc.g += rgb[1] * p; acc.b += rgb[2] * p;
    acc.px += s.a.x; acc.py += s.a.y; acc.cnt++;
  }
  for (const [id, acc] of src) {
    const mx = Math.max(acc.r, acc.g, acc.b);
    // sqrt: parallel rays of one collimated beam overlap when zoomed out; don't let N rays blow out to N×
    // one beam's spectral sum ≈ S / nBeams; full normalisation would be nBeams / max(S).
    // Use sqrt(nBeams): each beam peaks at 1/sqrt(n), overlapping rays sum to ~sqrt(n).
    acc.scale = mx > 0 ? Math.sqrt(acc.beams.size) / mx : 0;
    acc.B = brightness(acc.total);
    const cm = Math.max(acc.r, acc.g, acc.b, 1e-30);
    emitters.set(id, { p: { x: acc.px / acc.cnt, y: acc.py / acc.cnt }, rgb: [acc.r / cm, acc.g / cm, acc.b / cm], level: acc.B });
  }
  // Sources whose rays never had depth 0 (unlikely) still get a scale.
  const fallbackScale = (id: string, power: number) => {
    let acc = src.get(id);
    if (!acc) {
      acc = { total: power, beams: new Set(['x']), r: 0, g: 0, b: 0, px: 0, py: 0, cnt: 0, scale: power > 0 ? 1 / power : 0, B: brightness(power) };
      src.set(id, acc);
    }
    return acc;
  };

  // ---- ray instances --------------------------------------------------------------
  if (win) {
    // pulse view: emit the lit pieces of every segment (several per segment for repeated pulses)
    let need = 0;
    const pieces: [number, number][][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      const w = segmentWindows(Number.isFinite(s.t0) ? s.t0! : 0, Number.isFinite(s.t1) ? s.t1! : (Number.isFinite(s.t0) ? s.t0! : 0), win);
      pieces[i] = w;
      need += w.length;
    }
    if (rayScratch.length < need * RAY_STRIDE) rayScratch = new Float32Array(Math.ceil(need * 1.25) * RAY_STRIDE + RAY_STRIDE);
    const R = rayScratch;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const w = pieces[i];
      if (!w.length) continue;
      const s = segs[i];
      const acc = src.get(s.sourceId) ?? fallbackScale(s.sourceId, s.power);
      const rgb = safeRGB(engine, s.wavelength);
      const f = Math.max(0, s.power) * acc.scale * acc.B;
      if (!(f > 1e-5)) continue;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const med = s.inMedium ? 1 : 0;
      const dim = (med ? 0.82 : 1) * 1.25; // pulses read a little brighter than the steady beam
      for (const [s0, s1] of w) {
        const o = k * RAY_STRIDE;
        R[o] = s.a.x + dx * s0; R[o + 1] = s.a.y + dy * s0; R[o + 2] = s.a.x + dx * s1; R[o + 3] = s.a.y + dy * s1;
        R[o + 4] = rgb[0] * f * dim; R[o + 5] = rgb[1] * f * dim; R[o + 6] = rgb[2] * f * dim;
        R[o + 7] = med ? 0.8 : 1;
        R[o + 8] = 0;
        R[o + 9] = med;
        R[o + 10] = s0 > 1e-6 ? 1 : 0;   // round caps at the pulse ends, butt joints at segment ends
        R[o + 11] = s1 < 1 - 1e-6 ? 1 : 0;
        k++;
      }
    }
    const sprites: number[] = [];
    for (const [, e] of emitters) {
      const lv = e.level * 1.4;
      sprites.push(e.p.x, e.p.y, 16, 1, e.rgb[0] * lv, e.rgb[1] * lv, e.rgb[2] * lv, 0);
    }
    if (spriteScratch.length < sprites.length) spriteScratch = new Float32Array(sprites.length * 2 + SPRITE_STRIDE);
    spriteScratch.set(sprites);
    return { rays: R, rayCount: k, sprites: spriteScratch, spriteCount: sprites.length / SPRITE_STRIDE, emitters, detectors, fiberEnds };
  }

  if (rayScratch.length < n * RAY_STRIDE) rayScratch = new Float32Array(Math.ceil(n * 1.25) * RAY_STRIDE + RAY_STRIDE);
  const R = rayScratch;
  let prevB: Vec2 | null = null, prevSrc = '', prevS0 = 0, prevLen = 0, prevIdx = -1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    const acc = src.get(s.sourceId) ?? fallbackScale(s.sourceId, s.power);
    const rgb = safeRGB(engine, s.wavelength);
    const f = Math.max(0, s.power) * acc.scale * acc.B;
    if (!(f > 1e-5)) { prevB = null; continue; }
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy);
    const joined = prevB !== null && prevSrc === s.sourceId && Math.abs(prevB.x - s.a.x) < 1e-3 && Math.abs(prevB.y - s.a.y) < 1e-3;
    const s0 = joined ? prevS0 + prevLen : 0;
    if (joined && prevIdx >= 0) R[prevIdx * RAY_STRIDE + 11] = 0; // previous end is a joint -> butt cap
    const o = k * RAY_STRIDE;
    const med = s.inMedium ? 1 : 0;
    const dim = med ? 0.82 : 1;
    R[o] = s.a.x; R[o + 1] = s.a.y; R[o + 2] = s.b.x; R[o + 3] = s.b.y;
    R[o + 4] = rgb[0] * f * dim; R[o + 5] = rgb[1] * f * dim; R[o + 6] = rgb[2] * f * dim;
    R[o + 7] = med ? 0.8 : 1;           // width factor
    R[o + 8] = s0;
    R[o + 9] = med;
    R[o + 10] = joined ? 0 : 1;         // round cap at start?
    R[o + 11] = 1;                      // round cap at end (cleared if next joins)
    prevB = s.b; prevSrc = s.sourceId; prevS0 = s0; prevLen = L; prevIdx = k;
    k++;
  }

  // ---- sprites -----------------------------------------------------------------------
  const sprites: number[] = [];
  const pushSprite = (x: number, y: number, radiusPx: number, r: number, g: number, b: number, soft: number) => {
    sprites.push(x, y, radiusPx, soft, r, g, b, 0);
  };
  for (const [, e] of emitters) {
    const lv = e.level * 1.4;
    pushSprite(e.p.x, e.p.y, 16, e.rgb[0] * lv, e.rgb[1] * lv, e.rgb[2] * lv, 1);
  }

  const MAX_HITS = 20000;
  let totalHits = 0;
  for (const id in trace?.detectors ?? {}) totalHits += trace!.detectors[id].hits?.length ?? 0;
  const stride = totalHits > MAX_HITS ? Math.ceil(totalHits / MAX_HITS) : 1;
  for (const id in trace?.detectors ?? {}) {
    const rd = trace!.detectors[id];
    let r = 0, g = 0, b = 0;
    const hits = rd.hits ?? [];
    let maxP = 0;
    for (const h of hits) if (h.power > maxP) maxP = h.power;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const rgb = safeRGB(engine, h.wavelength);
      r += rgb[0] * h.power; g += rgb[1] * h.power; b += rgb[2] * h.power;
      if (i % stride !== 0 || maxP <= 0) continue;
      const it = 1.1 * Math.sqrt(h.power / maxP);
      pushSprite(h.p.x, h.p.y, 5, rgb[0] * it, rgb[1] * it, rgb[2] * it, 0);
    }
    const m = Math.max(r, g, b);
    const level = rd.power > 1e-12 ? Math.min(1, Math.max(0.12, 0.45 + 0.15 * Math.log10(rd.power / 1e-3))) : 0;
    detectors.set(id, { rgb: m > 0 ? [r / m, g / m, b / m] : [0.1, 0.9, 0.85], level });
  }

  // fiber end glow: any segment touching an end
  for (const c of components) {
    if (!c.type.startsWith('fiber')) continue;
    const g = geomOf(c);
    const endH = g.handles?.find((h) => h.key === 'end')?.p ?? { x: Number(c.props.endX ?? c.position.x), y: Number(c.props.endY ?? c.position.y) };
    const ends = [c.position, endH];
    const acc = { a: 0, b: 0, rgb: [0, 0, 0] as [number, number, number] };
    const tol = 2.5;
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      for (let e = 0; e < 2; e++) {
        const p = ends[e];
        if ((Math.abs(s.a.x - p.x) < tol && Math.abs(s.a.y - p.y) < tol) || (Math.abs(s.b.x - p.x) < tol && Math.abs(s.b.y - p.y) < tol)) {
          const w = brightness(s.power);
          if (e === 0) acc.a = Math.max(acc.a, w); else acc.b = Math.max(acc.b, w);
          const rgb = safeRGB(engine, s.wavelength);
          acc.rgb[0] += rgb[0] * s.power; acc.rgb[1] += rgb[1] * s.power; acc.rgb[2] += rgb[2] * s.power;
        }
      }
    }
    if (acc.a > 0 || acc.b > 0) {
      const m = Math.max(acc.rgb[0], acc.rgb[1], acc.rgb[2], 1e-30);
      acc.rgb = [acc.rgb[0] / m, acc.rgb[1] / m, acc.rgb[2] / m];
      fiberEnds.set(c.id, acc);
      for (let e = 0; e < 2; e++) {
        const lv = (e === 0 ? acc.a : acc.b) * 1.3;
        if (lv > 0) pushSprite(ends[e].x, ends[e].y, 14, acc.rgb[0] * lv, acc.rgb[1] * lv, acc.rgb[2] * lv, 1);
      }
    }
  }

  const sc = sprites.length / SPRITE_STRIDE;
  if (spriteScratch.length < sprites.length) spriteScratch = new Float32Array(sprites.length * 2 + SPRITE_STRIDE);
  spriteScratch.set(sprites);
  return { rays: R, rayCount: k, sprites: spriteScratch, spriteCount: sc, emitters, detectors, fiberEnds };
}
