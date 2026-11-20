import { describe, expect, it } from 'vitest';
import { circuitEngine, buildNetlist, designatorPrefix } from '../../src/core/circuit';
import type { CircuitComponent } from '../../src/core/types';

const mk = (type: string, id: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0, mirrored = false): CircuitComponent => ({
  ...circuitEngine.createComponent(type, { x, y }), id, rotation, mirrored,
});

describe('registry', () => {
  it('implements every canonical type with pins, size and params', () => {
    const ids = ['source.battery', 'source.psu', 'source.ac', 'source.function_gen', 'source.current', 'misc.ground', 'osc.crystal', 'ic.555',
      'passive.resistor', 'passive.potentiometer', 'passive.capacitor', 'passive.inductor', 'passive.transformer',
      'semi.diode', 'semi.zener', 'semi.led', 'semi.npn', 'semi.pnp', 'semi.nmos', 'semi.pmos',
      'switch.spst', 'switch.spdt', 'switch.push', 'switch.relay', 'display.7seg', 'display.matrix',
      'meter.voltmeter', 'meter.ammeter', 'meter.probe',
      'digital.and', 'digital.or', 'digital.not', 'digital.nand', 'digital.xor', 'digital.counter', 'digital.bcd7seg',
      'misc.lamp', 'misc.buzzer', 'opto.photodiode', 'opto.ldr', 'opto.solar_cell', 'opto.laser_diode', 'opto.coil'];
    const types = new Set(circuitEngine.registry.map((d) => d.type));
    for (const id of ids) expect(types.has(id), id).toBe(true);
    for (const def of circuitEngine.registry) {
      const c = circuitEngine.createComponent(def.type, { x: 3, y: 4 });
      expect(c.id.startsWith(designatorPrefix(def.type) + '_')).toBe(true);
      const pins = circuitEngine.getPinPositions(c);
      expect(pins.length).toBeGreaterThan(0);
      const names = new Set(pins.map((p) => p.name));
      expect(names.size).toBe(pins.length);
      for (const p of pins) {
        expect(Number.isInteger(p.p.x) && Number.isInteger(p.p.y)).toBe(true);
        // pins lie inside/on the footprint
        const lx = p.p.x - 3, ly = p.p.y - 4;
        expect(lx).toBeGreaterThanOrEqual(def.size.ox);
        expect(lx).toBeLessThanOrEqual(def.size.ox + def.size.w);
        expect(ly).toBeGreaterThanOrEqual(def.size.oy);
        expect(ly).toBeLessThanOrEqual(def.size.oy + def.size.h);
      }
      for (const prm of def.params) expect(c.props[prm.key]).toEqual(prm.default);
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

describe('pin positions', () => {
  it('rotates clockwise in quarter turns with +y down', () => {
    const pos = (rot: 0 | 1 | 2 | 3, mir = false) =>
      Object.fromEntries(circuitEngine.getPinPositions(mk('semi.npn', 'Q', 10, 20, rot, mir)).map((p) => [p.name, p.p]));
    expect(pos(0)).toEqual({ B: { x: 8, y: 20 }, C: { x: 12, y: 18 }, E: { x: 12, y: 22 } });
    // one quarter turn clockwise: (x,y) -> (-y,x)
    expect(pos(1)).toEqual({ B: { x: 10, y: 18 }, C: { x: 12, y: 22 }, E: { x: 8, y: 22 } });
    expect(pos(2)).toEqual({ B: { x: 12, y: 20 }, C: { x: 8, y: 22 }, E: { x: 8, y: 18 } });
    expect(pos(3)).toEqual({ B: { x: 10, y: 22 }, C: { x: 8, y: 18 }, E: { x: 12, y: 18 } });
    // mirror flips x before rotating
    expect(pos(0, true)).toEqual({ B: { x: 12, y: 20 }, C: { x: 8, y: 18 }, E: { x: 8, y: 22 } });
    expect(pos(1, true)).toEqual({ B: { x: 10, y: 22 }, C: { x: 12, y: 18 }, E: { x: 8, y: 18 } });
  });
});

describe('netlist extraction', () => {
  it('connects T-junctions, shared points and pins on wire vertices', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0); // pins (-2,0) (2,0)
    const r2 = mk('passive.resistor', 'R2', 10, 0); // pins (8,0) (12,0)
    const r3 = mk('passive.resistor', 'R3', 5, 7, 1); // vertical: A (5,5), B (5,9)
    const g = mk('misc.ground', 'G', 5, 9);
    const nl = buildNetlist({
      components: [r1, r2, r3, g],
      wires: [
        { id: 'w1', points: [{ x: 2, y: 0 }, { x: 8, y: 0 }] }, // R1.B -- R2.A
        { id: 'w2', points: [{ x: 5, y: 5 }, { x: 5, y: 0 }] }, // from R3.A up, ends ON w1 (T-junction)
      ],
    });
    expect(nl.pinNets['R1:B']).toBe(nl.pinNets['R2:A']);
    expect(nl.pinNets['R3:A']).toBe(nl.pinNets['R1:B']);
    expect(nl.pinNets['R3:B']).toBe('GND'); // pin shares a point with the ground pin
    expect(nl.pinNets['R1:A']).not.toBe(nl.pinNets['R1:B']);
    expect(nl.pinNets['R2:B']).not.toBe(nl.pinNets['R1:B']);
    expect(nl.pinNets['R1:B']).toBe('net:R1:B'); // lowest pin key names the net
    expect(nl.hasGround).toBe(true);
  });

  it('does not connect wires that merely cross, nor pins in the middle of a segment', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0);
    const r2 = mk('passive.resistor', 'R2', 0, 10);
    const nl = buildNetlist({
      components: [r1, r2],
      wires: [
        { id: 'h', points: [{ x: 2, y: 0 }, { x: 20, y: 0 }] },
        { id: 'v', points: [{ x: 10, y: -5 }, { x: 10, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 10 }] }, // crosses h at (10,0)
        { id: 'over', points: [{ x: -10, y: 0 }, { x: 0, y: 0 }] }, // passes over R1.A (-2,0) mid-segment
      ],
    });
    expect(nl.pinNets['R1:B']).not.toBe(nl.pinNets['R2:B']);
    expect(nl.pinNets['R1:A']).toBe('net:R1:A');
    expect(nl.netIds).toContain('wire:over');
  });

  it('multi-segment wires and corner-on-segment junctions', () => {
    const r1 = mk('passive.resistor', 'R1', 0, 0);
    const r2 = mk('passive.resistor', 'R2', 20, 10);
    const nl = buildNetlist({
      components: [r1, r2],
      wires: [
        { id: 'a', points: [{ x: 2, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }] },
        { id: 'b', points: [{ x: 18, y: 10 }, { x: 10, y: 10 }] }, // ends on the vertical part of a
      ],
    });
    expect(nl.pinNets['R2:A']).toBe(nl.pinNets['R1:B']);
  });
});
