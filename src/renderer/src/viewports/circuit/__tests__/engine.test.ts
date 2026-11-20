import { describe, expect, it } from 'vitest';
import { circuitEngine } from '../../../../../core/circuit';
import { apply, fitComponent, resolvePins } from '../geometry';
import { buildModel, defMap, transformSelection } from '../model';
import { valueLabel } from '../format';

describe('real circuit engine compatibility', () => {
  const defs = defMap(circuitEngine);

  it('fits every registry type exactly in all 8 orientations; body rect = size top-left', () => {
    for (const d of circuitEngine.registry) {
      for (const rotation of [0, 1, 2, 3] as const) for (const mirrored of [false, true]) {
        const c = { ...circuitEngine.createComponent(d.type, { x: 3, y: -2 }), rotation, mirrored };
        const f = fitComponent(c, d, circuitEngine);
        const world = circuitEngine.getPinPositions(c);
        expect(world.length).toBe(f.pins.length);
        for (const pd of f.pins) {
          const w = world.find((q) => q.name === pd.name)!.p;
          const q = apply(f.m, pd.offset);
          expect(Math.abs(q.x - w.x) + Math.abs(q.y - w.y), `${d.type} r${rotation} m${mirrored} ${pd.name}`).toBeLessThan(1e-9);
        }
        expect(f.rect).toEqual({ x0: d.size.ox, y0: d.size.oy, x1: d.size.ox + d.size.w, y1: d.size.oy + d.size.h });
      }
      expect(resolvePins(d, circuitEngine.createComponent(d.type, { x: 0, y: 0 }).props).length).toBeGreaterThan(0);
    }
  });

  it('labels and designators are produced', () => {
    const r = circuitEngine.createComponent('passive.resistor', { x: 0, y: 0 });
    expect(valueLabel(r, defs.get(r.type))).toMatch(/Ω$/);
  });

  it('wires follow a moved component (rubber band)', () => {
    const r = { ...circuitEngine.createComponent('passive.resistor', { x: 0, y: 0 }), id: 'r' };
    const pins = circuitEngine.getPinPositions(r);
    const b = pins.find((p) => p.name === 'B')!.p;
    const scene = { components: [r], wires: [{ id: 'w', points: [b, { x: b.x + 4, y: b.y }] }], settings: circuitEngine.defaultSettings() };
    const next = transformSelection(scene, circuitEngine, defs, undefined, new Set(['r']), new Set(), { x: 0, y: 3 }, 0, false);
    const nb = circuitEngine.getPinPositions(next.components[0]).find((p) => p.name === 'B')!.p;
    expect(next.wires[0].points[0]).toEqual(nb);
    expect(next.wires[0].points[next.wires[0].points.length - 1]).toEqual({ x: b.x + 4, y: b.y });
    const m = buildModel(next, circuitEngine, defs);
    expect(m.graph.connectedPins.has('r:B')).toBe(true);
  });
});
