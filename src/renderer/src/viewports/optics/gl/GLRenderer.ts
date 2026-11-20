/**
 * WebGL2 renderer for the optics viewport.
 *
 * Frame:
 *   1. HDR light pass  : rays (instanced capsule quads, gaussian profile) + glow sprites
 *                        -> RGBA16F target, additive blending.
 *   2. Bloom           : bright-pass (half res) -> 5-level mip chain, separable 9-tap gaussian per level.
 *   3. Default FB      : plain dark background (+ optional faint line grid), glass bodies (triangulated, fake refraction),
 *                        then tonemapped (ACES) + dithered light composited with a "screen" blend.
 *
 * Handles DPR (caller sizes the canvas), context loss/restore and RGBA8 fallback when float
 * render targets are unavailable.
 */
import * as S from './shaders';
import { RAY_STRIDE, SPRITE_STRIDE } from '../lightData';

export interface FrameParams {
  width: number; height: number;          // device px
  dpr: number;
  view: { cx: number; cy: number; zoom: number }; // zoom in CSS px per mm
  time: number;                            // seconds
  showGrid: boolean;
  bloom: boolean;
  exposure: number;
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const BLOOM_LEVELS = 5;

export class GLRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private lost = false;
  private floatTargets = false;
  private hdrScale = 1; // values stored = hdr * hdrScale (RGBA8 fallback stores scaled-down)

  private progs: Record<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> = {};
  private emptyVao: WebGLVertexArrayObject | null = null;
  private rayVao: WebGLVertexArrayObject | null = null;
  private spriteVao: WebGLVertexArrayObject | null = null;
  private glassVao: WebGLVertexArrayObject | null = null;
  private cornerBuf: WebGLBuffer | null = null;
  private rayBuf: WebGLBuffer | null = null;
  private spriteBuf: WebGLBuffer | null = null;
  private glassBuf: WebGLBuffer | null = null;
  private rayCap = 0; private spriteCap = 0; private glassCap = 0;
  private rayCount = 0; private spriteCount = 0; private glassVerts = 0;
  private hdr: Target | null = null;
  private bloomA: Target[] = []; private bloomB: Target[] = [];
  private size = { w: 0, h: 0 };

  // CPU copies so we can re-upload after a context restore
  private lastRays: Float32Array | null = null;
  private lastSprites: Float32Array | null = null;
  private lastGlass: Float32Array | null = null;

  onRestored: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', this.handleLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleRestored, false);
    this.init();
  }

  get ok(): boolean { return !!this.gl && !this.lost; }

  private handleLost = (e: Event) => { e.preventDefault(); this.lost = true; this.gl = null; };
  private handleRestored = () => {
    this.lost = false;
    this.progs = {}; this.hdr = null; this.bloomA = []; this.bloomB = []; this.size = { w: 0, h: 0 };
    this.rayCap = this.spriteCap = this.glassCap = 0;
    this.init();
    if (this.lastRays) this.setRays(this.lastRays, this.rayCount);
    if (this.lastSprites) this.setSprites(this.lastSprites, this.spriteCount);
    if (this.lastGlass) this.setGlass(this.lastGlass, this.glassVerts);
    this.onRestored?.();
  };

  private init(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance', desynchronized: false,
    });
    if (!gl) { this.gl = null; return; }
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    this.hdrScale = this.floatTargets ? 1 : 0.25;

    const mk = (name: string, vs: string, fs: string, uniforms: string[]) => {
      const p = link(gl, vs, fs, name);
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
      this.progs[name] = { p, u };
    };
    const common = ['uRes', 'uView', 'uGrid', 'uTime'];
    mk('bg', S.FULLSCREEN_VS, S.BACKGROUND_FS, common);
    mk('glass', S.GLASS_VS, S.GLASS_FS, common);
    mk('ray', S.RAY_VS, S.RAY_FS, ['uRes', 'uView', 'uDpr', 'uWidthMm', 'uGain']);
    mk('sprite', S.SPRITE_VS, S.SPRITE_FS, ['uRes', 'uView', 'uDpr', 'uGain']);
    mk('bright', S.FULLSCREEN_VS, S.BRIGHT_FS, ['uSrc', 'uTexel', 'uThreshold', 'uScale']);
    mk('down', S.FULLSCREEN_VS, S.DOWN_FS, ['uSrc', 'uTexel']);
    mk('blur', S.FULLSCREEN_VS, S.BLUR_FS, ['uSrc', 'uDir']);
    mk('comp', S.FULLSCREEN_VS, S.COMPOSITE_FS, ['uLight', 'uB0', 'uB1', 'uB2', 'uB3', 'uB4', 'uBloom', 'uExposure', 'uScale', 'uTime']);

    this.emptyVao = gl.createVertexArray();
    this.cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // ray VAO
    this.rayBuf = gl.createBuffer();
    this.rayVao = gl.createVertexArray();
    gl.bindVertexArray(this.rayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rayBuf);
    const rs = RAY_STRIDE * 4;
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, rs, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    // sprite VAO
    this.spriteBuf = gl.createBuffer();
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    const ss = SPRITE_STRIDE * 4;
    for (let i = 0; i < 2; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, ss, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    // glass VAO: pos2 centroid2 tint3 radius1 = 8 floats
    this.glassBuf = gl.createBuffer();
    this.glassVao = gl.createVertexArray();
    gl.bindVertexArray(this.glassVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glassBuf);
    const gs = 8 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, gs, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, gs, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, gs, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, gs, 28);
    gl.bindVertexArray(null);
  }

  private upload(buf: WebGLBuffer | null, data: Float32Array, floats: number, cap: number): number {
    const gl = this.gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (floats > cap) {
      const nc = Math.max(floats, Math.ceil(cap * 1.5), 1024);
      gl.bufferData(gl.ARRAY_BUFFER, nc * 4, gl.DYNAMIC_DRAW);
      cap = nc;
    }
    if (floats > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
    return cap;
  }

  setRays(data: Float32Array, count: number): void {
    this.lastRays = data; this.rayCount = count;
    if (!this.ok) return;
    this.rayCap = this.upload(this.rayBuf, data, count * RAY_STRIDE, this.rayCap);
  }
  setSprites(data: Float32Array, count: number): void {
    this.lastSprites = data; this.spriteCount = count;
    if (!this.ok) return;
    this.spriteCap = this.upload(this.spriteBuf, data, count * SPRITE_STRIDE, this.spriteCap);
  }
  /** Interleaved triangle list: x y cx cy r g b radius per vertex. */
  setGlass(data: Float32Array, vertexCount: number): void {
    this.lastGlass = data; this.glassVerts = vertexCount;
    if (!this.ok) return;
    this.glassCap = this.upload(this.glassBuf, data, vertexCount * 8, this.glassCap);
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.floatTargets) {
      // float RT unsupported after all: fall back
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      this.floatTargets = false; this.hdrScale = 0.25;
      return this.makeTarget(w, h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }
  private freeTarget(t: Target | null) {
    if (!t || !this.gl) return;
    this.gl.deleteFramebuffer(t.fb); this.gl.deleteTexture(t.tex);
  }

  private ensureTargets(w: number, h: number) {
    if (this.size.w === w && this.size.h === h && this.hdr) return;
    this.freeTarget(this.hdr);
    for (const t of this.bloomA) this.freeTarget(t);
    for (const t of this.bloomB) this.freeTarget(t);
    this.hdr = this.makeTarget(w, h);
    this.bloomA = []; this.bloomB = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloomA.push(this.makeTarget(bw, bh));
      this.bloomB.push(this.makeTarget(bw, bh));
    }
    this.size = { w, h };
  }

  render(f: FrameParams): void {
    const gl = this.gl;
    if (!gl || this.lost || gl.isContextLost()) return;
    const W = f.width, H = f.height;
    if (W < 2 || H < 2) return;
    this.ensureTargets(W, H);
    const zoomD = f.view.zoom * f.dpr;
    const P = this.progs;

    // ---- 1. HDR light --------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr!.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    const gain = 1.7 * this.hdrScale;
    if (this.rayCount > 0) {
      const r = P.ray; gl.useProgram(r.p);
      gl.uniform2f(r.u.uRes, W, H);
      gl.uniform3f(r.u.uView, f.view.cx, f.view.cy, zoomD);
      gl.uniform1f(r.u.uDpr, f.dpr);
      gl.uniform1f(r.u.uWidthMm, 0.45);
      gl.uniform1f(r.u.uGain, gain);
      gl.bindVertexArray(this.rayVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.rayCount);
    }
    if (this.spriteCount > 0) {
      const s = P.sprite; gl.useProgram(s.p);
      gl.uniform2f(s.u.uRes, W, H);
      gl.uniform3f(s.u.uView, f.view.cx, f.view.cy, zoomD);
      gl.uniform1f(s.u.uDpr, f.dpr);
      gl.uniform1f(s.u.uGain, gain);
      gl.bindVertexArray(this.spriteVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.spriteCount);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);

    // ---- 2. Bloom ----------------------------------------------------------------------
    if (f.bloom) {
      const b = P.bright; gl.useProgram(b.p);
      const L0 = this.bloomA[0];
      gl.bindFramebuffer(gl.FRAMEBUFFER, L0.fb); gl.viewport(0, 0, L0.w, L0.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.hdr!.tex);
      gl.uniform1i(b.u.uSrc, 0);
      gl.uniform2f(b.u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(b.u.uThreshold, 1.0);
      gl.uniform1f(b.u.uScale, 1 / this.hdrScale * f.exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const d = P.down;
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const src = this.bloomA[i - 1], dst = this.bloomA[i];
        gl.useProgram(d.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(d.u.uSrc, 0);
        gl.uniform2f(d.u.uTexel, 0.5 / src.w, 0.5 / src.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const bl = P.blur; gl.useProgram(bl.p); gl.uniform1i(bl.u.uSrc, 0);
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const A = this.bloomA[i], B = this.bloomB[i];
        for (let pass = 0; pass < 2; pass++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb); gl.viewport(0, 0, B.w, B.h);
          gl.bindTexture(gl.TEXTURE_2D, A.tex);
          gl.uniform2f(bl.u.uDir, 1 / A.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
          gl.bindTexture(gl.TEXTURE_2D, B.tex);
          gl.uniform2f(bl.u.uDir, 0, 1 / A.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
    }

    // ---- 3. Default framebuffer: background, glass, light ------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const bg = P.bg; gl.useProgram(bg.p);
    gl.uniform2f(bg.u.uRes, W, H);
    gl.uniform3f(bg.u.uView, f.view.cx, f.view.cy, zoomD);
    gl.uniform1f(bg.u.uGrid, f.showGrid ? 1 : 0);
    gl.uniform1f(bg.u.uTime, f.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.glassVerts > 0) {
      const g = P.glass; gl.useProgram(g.p);
      gl.uniform2f(g.u.uRes, W, H);
      gl.uniform3f(g.u.uView, f.view.cx, f.view.cy, zoomD);
      gl.uniform1f(g.u.uGrid, f.showGrid ? 1 : 0);
      gl.uniform1f(g.u.uTime, f.time);
      gl.bindVertexArray(this.glassVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.glassVerts);
      gl.bindVertexArray(this.emptyVao);
    }

    const c = P.comp; gl.useProgram(c.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); // screen
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.hdr!.tex); gl.uniform1i(c.u.uLight, 0);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA[i].tex);
      gl.uniform1i(c.u[`uB${i}`], 1 + i);
    }
    gl.uniform1f(c.u.uBloom, f.bloom ? 1.0 : 0.0);
    gl.uniform1f(c.u.uExposure, f.exposure);
    gl.uniform1f(c.u.uScale, 1 / this.hdrScale);
    gl.uniform1f(c.u.uTime, f.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    const gl = this.gl;
    if (!gl) return;
    this.freeTarget(this.hdr);
    for (const t of [...this.bloomA, ...this.bloomB]) this.freeTarget(t);
    for (const k in this.progs) gl.deleteProgram(this.progs[k].p);
    gl.deleteBuffer(this.rayBuf); gl.deleteBuffer(this.spriteBuf); gl.deleteBuffer(this.glassBuf); gl.deleteBuffer(this.cornerBuf);
    gl.deleteVertexArray(this.rayVao); gl.deleteVertexArray(this.spriteVao); gl.deleteVertexArray(this.glassVao); gl.deleteVertexArray(this.emptyVao);
    this.gl = null;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`[optics viewport] shader ${name} failed: ${log}`);
  }
  return s;
}
function link(gl: WebGL2RenderingContext, vs: string, fs: string, name: string): WebGLProgram {
  const p = gl.createProgram()!;
  const v = compile(gl, gl.VERTEX_SHADER, vs, name + '.vs');
  const f = compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs');
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`[optics viewport] program ${name} link failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}
