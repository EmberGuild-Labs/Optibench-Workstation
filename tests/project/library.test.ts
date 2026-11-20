import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../src/core/project';
import {
  extractGroup, freeDesignator, groupWires, instantiateGroup, parseLibraryFile, serializeLibraryFile, validateLibraryItem, type LibraryItem
} from '../../src/core/project/library';
import { circuitEngine } from '../../src/core/circuit';
import type { CircuitComponent, ObwDocument } from '../../src/core/types';

const pins = (c: CircuitComponent) => circuitEngine.getPinPositions(c);

function sample(): ObwDocument {
  const d = createEmptyDocument();
  d.optics.components.push(
    { id: 'src', type: 'source.laser', name: 'TX', position: { x: 10, y: 20 }, rotation: 0, props: { power: 0.01 } },
    { id: 'det', type: 'detector.photodiode', position: { x: 110, y: 20 }, rotation: 0, props: {} },
    { id: 'fib', type: 'fiber.cable', position: { x: 0, y: 0 }, rotation: 0, props: { endX: 50, endY: 60 } },
    { id: 'other', type: 'mirror.flat', position: { x: 500, y: 500 }, rotation: 0, props: {} }
  );
  d.circuit.components.push(
    { id: 'r1', type: 'passive.resistor', name: 'R1', position: { x: 2, y: 0 }, rotation: 0, props: { resistance: 330 } },
    { id: 'd1', type: 'semi.led', name: 'D1', position: { x: 8, y: 0 }, rotation: 0, props: {} },
    { id: 'far', type: 'passive.resistor', name: 'R2', position: { x: 2, y: 10 }, rotation: 0, props: {} }
  );
  d.circuit.wires.push(
    { id: 'w1', points: [{ x: 4, y: 0 }, { x: 6, y: 0 }] },                       // R1.B -> D1.A (inside)
    { id: 'w2', points: [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 4, y: 10 }] },   // D1.K -> R2.B (leaves the group)
    { id: 'w3', points: [{ x: 0, y: 0 }, { x: 0, y: -3 }] },                      // R1.A -> dangling
    { id: 'w4', points: [{ x: 5, y: 0 }, { x: 5, y: -4 }, { x: 9, y: -4 }] }      // T off w1, dangling end
  );
  d.links.push(
    { id: 'L1', kind: 'detector', circuitId: 'd1', opticsId: 'det' },
    { id: 'L2', kind: 'emitter', circuitId: 'far', opticsId: 'src' }
  );
  return d;
}

describe('library group extraction', () => {
  it('keeps wires between selected parts only', () => {
    const d = sample();
    const comps = d.circuit.components.filter((c) => c.id === 'r1' || c.id === 'd1');
    expect(groupWires(d.circuit.wires, comps, [], pins)).toEqual(['w1']);
    expect(groupWires(d.circuit.wires, comps, ['w3'], pins)).toEqual(['w1', 'w3']);
  });
  it('follows T-junction chains that end on selected pins', () => {
    const d = sample();
    d.circuit.wires.push({ id: 'w5', points: [{ x: 5, y: 0 }, { x: 5, y: 3 }] }); // dangling -> excluded
    d.circuit.components.push({ id: 'g', type: 'misc.ground', position: { x: 5, y: 3 }, rotation: 0, props: {} });
    const comps = d.circuit.components.filter((c) => ['r1', 'd1', 'g'].includes(c.id));
    expect(groupWires(d.circuit.wires, comps, [], pins)).toEqual(['w1', 'w5']);
  });
  it('extracts a relative group with internal links only', () => {
    const d = sample();
    const g = extractGroup(d, { optics: ['src', 'det', 'fib'], circuit: ['r1', 'd1'] }, pins);
    expect(g.optics.map((c) => c.id)).toEqual(['src', 'det', 'fib']);
    expect(g.circuit.wires.map((w) => w.id)).toEqual(['w1']);
    expect(g.links.map((l) => l.id)).toEqual(['L1']);
    // optics centred on bbox (x 0..110, y 0..60) -> (55, 30)
    expect(g.optics[0].position).toEqual({ x: -45, y: -10 });
    expect(g.optics[2].props).toMatchObject({ endX: -5, endY: 30 });
    // circuit centre: comps x 2..8, wire 4..6 -> 5, y 0
    expect(g.circuit.components[0].position).toEqual({ x: -3, y: 0 });
    expect(g.circuit.wires[0].points).toEqual([{ x: -1, y: 0 }, { x: 1, y: 0 }]);
    // the source document is not modified
    expect(d.optics.components[0].position).toEqual({ x: 10, y: 20 });
  });
});

describe('library instantiation', () => {
  it('assigns fresh ids, remaps links, renumbers designators and positions', () => {
    const d = sample();
    const g = extractGroup(d, { optics: ['src', 'det'], circuit: ['r1', 'd1'] }, pins);
    const inst = instantiateGroup(g, d, { optics: { x: 1000, y: 0 }, circuit: { x: 40.4, y: 20.6 } });
    const used = new Set([...d.optics.components.map((c) => c.id), ...d.circuit.components.map((c) => c.id), ...d.circuit.wires.map((w) => w.id), ...d.links.map((l) => l.id)]);
    const fresh = [...inst.optics.map((c) => c.id), ...inst.circuit.map((c) => c.id), ...inst.wires.map((w) => w.id), ...inst.links.map((l) => l.id)];
    expect(new Set(fresh).size).toBe(fresh.length);
    for (const id of fresh) expect(used.has(id)).toBe(false);
    expect(inst.links).toHaveLength(1);
    expect(inst.links[0].opticsId).toBe(inst.idMap.get('det'));
    expect(inst.links[0].circuitId).toBe(inst.idMap.get('d1'));
    expect(inst.circuit.map((c) => c.name)).toEqual(['R3', 'D2']); // R1, R2, D1 taken
    expect(inst.circuit[0].position).toEqual({ x: 37, y: 21 });
    expect(inst.wires[0].points).toEqual([{ x: 39, y: 21 }, { x: 41, y: 21 }]);
    expect(inst.optics[0].position.x).toBeCloseTo(1000 - 50);
    // into the same doc again -> different ids again
    const d2 = { ...d, optics: { ...d.optics, components: [...d.optics.components, ...inst.optics] } };
    const inst2 = instantiateGroup(g, d2, { optics: { x: 0, y: 0 }, circuit: { x: 0, y: 0 } });
    expect(inst2.optics.some((c) => inst.optics.some((o) => o.id === c.id))).toBe(false);
    // the library item itself is untouched
    expect(g.optics[0].id).toBe('src');
  });
  it('freeDesignator', () => {
    expect(freeDesignator('R1', new Set(['R1', 'R2']))).toBe('R3');
    expect(freeDesignator('R7', new Set(['R1']))).toBe('R7');
    expect(freeDesignator('GND', new Set(['GND']))).toBe('GND');
  });
});

describe('library file format', () => {
  it('round-trips and validates', () => {
    const d = sample();
    const item: LibraryItem = { id: 'x', name: 'Link', category: 'Test', description: 'd', created: '2026-01-01', builtin: true, ...extractGroup(d, { optics: ['src', 'det'], circuit: ['r1', 'd1'] }, pins) };
    const text = serializeLibraryFile([item]);
    expect(text).not.toContain('builtin');
    const back = parseLibraryFile(text);
    expect(back[0].name).toBe('Link');
    expect(back[0].circuit.wires).toHaveLength(1);
    expect(back[0].links).toHaveLength(1);
    expect(() => parseLibraryFile('nope')).toThrow(/JSON/);
    expect(() => parseLibraryFile('{"format":"other","items":[{}]}')).toThrow(/library/);
    expect(() => validateLibraryItem({ name: 'empty' })).toThrow(/no components/);
    // dangling links are dropped
    const v = validateLibraryItem({ name: 'n', optics: [{ id: 'a', type: 't', position: { x: 0, y: 0 } }], links: [{ id: 'l', kind: 'emitter', opticsId: 'a', circuitId: 'zz' }] });
    expect(v.links).toEqual([]);
  });
});
