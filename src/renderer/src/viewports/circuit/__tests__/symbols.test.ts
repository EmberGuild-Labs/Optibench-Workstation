import { describe, expect, it } from 'vitest';
import type { CircuitComponentState } from '@core/types';
import { circuitEngine } from '../../../../../core/circuit';
import { fitComponent } from '../geometry';
import { SYMBOLS, drawSymbol, type SymCtx } from '../symbols';

/** Types that intentionally use the generic IC box fallback. */
const GENERIC_OK = new Set<string>([]);

const NEW_TYPES = [
  'ic.opamp', 'ic.comparator', 'ic.regulator', 'ic.shift595', 'ic.decoder138', 'ic.hbridge',
  'misc.motor', 'misc.servo', 'passive.thermistor', 'passive.fuse', 'source.clock'
];

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];

/** Minimal 2D context stub: tracks the transform and records every path vertex in base coordinates. */
function stubCtx(): { g: CanvasRenderingContext2D; pts: { x: number; y: number }[]; calls: number } {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const pts: { x: number; y: number }[] = [];
  const rec = (x: number, y: number): void => {
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    pts.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  };
  const state = { calls: 0 };
  const grad = { addColorStop: () => undefined };
  const impl: Record<string, unknown> = {
    save: () => { stack.push(m); },
    restore: () => { m = stack.pop() ?? m; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = mul(m, [a, b, c, d, e, f]); },
    translate: (x: number, y: number) => { m = mul(m, [1, 0, 0, 1, x, y]); },
    rotate: (a: number) => { m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale: (x: number, y: number) => { m = mul(m, [x, 0, 0, y, 0, 0]); },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = [a, b, c, d, e, f]; },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    moveTo: rec, lineTo: rec,
    arcTo: (x1: number, y1: number, x2: number, y2: number) => { rec(x1, y1); rec(x2, y2); },
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => rec(x, y),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => rec(x, y),
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    setLineDash: () => undefined, getLineDash: () => []
  };
  const g = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      state.calls++;
      if (k in impl) return impl[k];
      if (k in _t) return _t[k];
      return () => undefined; // beginPath, stroke, fill, rect, arc, ellipse, closePath, fillRect, fillText…
    },
    set(t, k: string, v) { t[k] = v; return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { g, pts, get calls() { return state.calls; } };
}

function ctxFor(type: string, st: CircuitComponentState | undefined, rotation: 0 | 1 | 2 | 3, mirrored: boolean) {
  const def = circuitEngine.registry.find((d) => d.type === type)!;
  const c = { ...circuitEngine.createComponent(type, { x: 0, y: 0 }), rotation, mirrored };
  const f = fitComponent(c, def, circuitEngine);
  const stub = stubCtx();
  const texts: string[] = [];
  const s: SymCtx = {
    g: stub.g, c, def, pins: f.pins, rect: f.rect, st, running: !!st, lw: 0.08,
    col: { stroke: '#000', fill: '#fff', body: '#fff', text: '#000', dim: '#666', accent: '#0a246a', hot: '#c00' },
    time: 0.37, zoom: 20, dpr: 1, hover: false,
    text: (_x, _y, t) => { texts.push(t); },
    glow: () => undefined
  };
  return { s, stub, f, def, texts };
}

const RUNNING: CircuitComponentState = {
  angleDeg: 45, outputs: [true, false, true, true, false, false, true, false, true], blown: true, on: true,
  direction: 'forward', clipping: 'high', sinking: true, mode: 'DROPOUT', heat: 0.8, voltage: 1, current: 0.01
};

describe('circuit symbols for every registry type', () => {
  it('every registry type has a dedicated symbol', () => {
    const missing = circuitEngine.registry.map((d) => d.type).filter((t) => !SYMBOLS[t] && !GENERIC_OK.has(t));
    expect(missing).toEqual([]);
  });

  it('every symbol draws in all 8 orientations, stopped and running', () => {
    for (const d of circuitEngine.registry) {
      for (const rotation of [0, 1, 2, 3] as const) for (const mirrored of [false, true]) for (const st of [undefined, RUNNING, {}]) {
        const { s, stub } = ctxFor(d.type, st as CircuitComponentState | undefined, rotation, mirrored);
        expect(() => drawSymbol(s), `${d.type} r${rotation} m${mirrored}`).not.toThrow();
        expect(stub.calls).toBeGreaterThan(0);
      }
    }
  });

  it('new parts: pins lie on the footprint border and a drawn lead ends exactly on every pin', () => {
    for (const type of NEW_TYPES) {
      for (const st of [undefined, RUNNING]) {
        const { s, stub, f, def } = ctxFor(type, st, 0, false);
        const r = f.rect;
        expect(r).toEqual({ x0: def.size.ox, y0: def.size.oy, x1: def.size.ox + def.size.w, y1: def.size.oy + def.size.h });
        drawSymbol(s);
        for (const p of f.pins) {
          const onBorder = Math.abs(p.offset.x - r.x0) < 1e-9 || Math.abs(p.offset.x - r.x1) < 1e-9 || Math.abs(p.offset.y - r.y0) < 1e-9 || Math.abs(p.offset.y - r.y1) < 1e-9;
          expect(onBorder, `${type} ${p.name} on border`).toBe(true);
          const hit = stub.pts.some((q) => Math.abs(q.x - p.offset.x) < 1e-6 && Math.abs(q.y - p.offset.y) < 1e-6);
          expect(hit, `${type} lead reaches pin ${p.name}`).toBe(true);
        }
      }
    }
  });

  it('new parts show identifying text', () => {
    const want: Record<string, string> = {
      'ic.regulator': '7805', 'ic.shift595': '595', 'ic.decoder138': '138', 'ic.hbridge': 'H-BRIDGE',
      'misc.motor': 'M', 'misc.servo': 'SERVO', 'source.clock': 'CLK'
    };
    for (const [type, txt] of Object.entries(want)) {
      const { s, texts } = ctxFor(type, undefined, 0, false);
      drawSymbol(s);
      expect(texts, type).toContain(txt);
    }
    const dec = ctxFor('ic.decoder138', undefined, 0, false);
    drawSymbol(dec.s);
    expect(dec.texts).toContain('/G2A');
    expect(dec.texts).toContain('/Y0');
  });
});
