/**
 * Minimal mock CircuitEngineAPI for developing / testing the viewport without the real
 * engine (src/core/circuit). Pin transform: mirror x first, then rotate clockwise.
 */
import type { CircuitComponent, CircuitComponentDef, CircuitEngineAPI, CircuitScene, CircuitSimulator, CircuitState, PinDef, Vec2 } from '@core/types';

const two = (len = 4): PinDef[] => [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'B', offset: { x: len, y: 0 } }];

function def(type: string, label: string, pins: PinDef[] | CircuitComponentDef['pins'], size: CircuitComponentDef['size'], params: CircuitComponentDef['params'] = [], interactive = false): CircuitComponentDef {
  return { type, label, category: type.split('.')[0], description: label, params, pins, size, interactive };
}

export const mockRegistry: CircuitComponentDef[] = [
  def('passive.resistor', 'Resistor', two(), { w: 4, h: 1, ox: 0, oy: -0.5 }, [{ key: 'resistance', label: 'R', kind: 'number', unit: 'Ω', default: 1000 }]),
  def('passive.capacitor', 'Capacitor', two(), { w: 4, h: 1.4, ox: 0, oy: -0.7 }, [{ key: 'capacitance', label: 'C', kind: 'number', unit: 'F', default: 1e-6 }]),
  def('passive.potentiometer', 'Potentiometer', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'W', offset: { x: 2, y: -2 } }, { name: 'B', offset: { x: 4, y: 0 } }], { w: 4, h: 2.5, ox: 0, oy: -2 }, [{ key: 'resistance', label: 'R', kind: 'number', unit: 'Ω', default: 10000 }, { key: 'position', label: 'Pos', kind: 'number', default: 0.5 }], true),
  def('semi.led', 'LED', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'K', offset: { x: 3, y: 0 } }], { w: 3, h: 1.6, ox: 0, oy: -0.8 }, [{ key: 'color', label: 'Colour', kind: 'color', default: '#ff3030' }]),
  def('source.battery', 'Battery', [{ name: '+', offset: { x: 0, y: 0 } }, { name: '-', offset: { x: 0, y: 3 } }], { w: 1.4, h: 3, ox: -0.7, oy: 0 }, [{ key: 'voltage', label: 'V', kind: 'number', unit: 'V', default: 9 }]),
  def('misc.ground', 'Ground', [{ name: 'G', offset: { x: 0, y: 0 } }], { w: 1, h: 1, ox: -0.5, oy: 0 }),
  def('semi.npn', 'NPN', [{ name: 'B', offset: { x: 0, y: 0 } }, { name: 'C', offset: { x: 2, y: -2 } }, { name: 'E', offset: { x: 2, y: 2 } }], { w: 2, h: 4, ox: 0, oy: -2 }),
  def('switch.spst', 'Switch', two(3), { w: 3, h: 1, ox: 0, oy: -0.8 }, [{ key: 'closed', label: 'Closed', kind: 'boolean', default: false }], true),
  def('ic.555', '555 Timer', [
    { name: 'GND', offset: { x: -1, y: 0 } }, { name: 'TRIG', offset: { x: -1, y: 1 } }, { name: 'OUT', offset: { x: -1, y: 2 } }, { name: 'RESET', offset: { x: -1, y: 3 } },
    { name: 'CTRL', offset: { x: 4, y: 3 } }, { name: 'THR', offset: { x: 4, y: 2 } }, { name: 'DIS', offset: { x: 4, y: 1 } }, { name: 'VCC', offset: { x: 4, y: 0 } }
  ], { w: 5, h: 4, ox: -1, oy: -0.5 }),
  def('digital.and', 'AND', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'B', offset: { x: 0, y: 2 } }, { name: 'Y', offset: { x: 4, y: 1 } }], { w: 4, h: 3, ox: 0, oy: -0.5 }),
  def('meter.probe', 'Probe', [{ name: 'P', offset: { x: 0, y: 0 } }], { w: 2, h: 1, ox: 0, oy: -0.5 }, [{ key: 'channel', label: 'Ch', kind: 'number', default: 1, min: 1, max: 4 }])
];


const box = (w: number, h: number, ox: number, oy: number): CircuitComponentDef['size'] => ({ w, h, ox, oy });
const vtwo = (len = 3): PinDef[] => [{ name: '+', offset: { x: 0, y: 0 } }, { name: '-', offset: { x: 0, y: len } }];
const num = (key: string, unit: string, d: number): CircuitComponentDef['params'][number] => ({ key, label: key, kind: 'number', unit, default: d });

mockRegistry.push(
  def('passive.inductor', 'Inductor', two(), box(4, 1, 0, -0.5), [num('inductance', 'H', 1e-3)]),
  def('passive.transformer', 'Transformer', [{ name: 'P1', offset: { x: 0, y: 0 } }, { name: 'P2', offset: { x: 0, y: 4 } }, { name: 'S1', offset: { x: 3, y: 0 } }, { name: 'S2', offset: { x: 3, y: 4 } }], box(3, 4, 0, 0)),
  def('semi.diode', 'Diode', two(3), box(3, 1, 0, -0.5)),
  def('semi.zener', 'Zener', two(3), box(3, 1, 0, -0.5), [num('zenerVoltage', 'V', 5.1)]),
  def('semi.pnp', 'PNP', [{ name: 'B', offset: { x: 0, y: 0 } }, { name: 'C', offset: { x: 2, y: 2 } }, { name: 'E', offset: { x: 2, y: -2 } }], box(2, 4, 0, -2)),
  def('semi.nmos', 'NMOS', [{ name: 'G', offset: { x: 0, y: 0 } }, { name: 'D', offset: { x: 2, y: -2 } }, { name: 'S', offset: { x: 2, y: 2 } }], box(2, 4, 0, -2)),
  def('semi.pmos', 'PMOS', [{ name: 'G', offset: { x: 0, y: 0 } }, { name: 'S', offset: { x: 2, y: -2 } }, { name: 'D', offset: { x: 2, y: 2 } }], box(2, 4, 0, -2)),
  def('switch.spdt', 'SPDT', [{ name: 'COM', offset: { x: 0, y: 0 } }, { name: 'NC', offset: { x: 3, y: -1 } }, { name: 'NO', offset: { x: 3, y: 1 } }], box(3, 2, 0, -1), [], true),
  def('switch.push', 'Push', two(3), box(3, 1.4, 0, -1), [], true),
  def('switch.relay', 'Relay', [{ name: 'A1', offset: { x: 0, y: 0 } }, { name: 'A2', offset: { x: 0, y: 3 } }, { name: 'COM', offset: { x: 2, y: 3 } }, { name: 'NC', offset: { x: 4, y: 0 } }, { name: 'NO', offset: { x: 5, y: 0 } }], box(5, 3, 0, 0)),
  def('display.7seg', '7-Segment', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((n, i) => ({ name: n, offset: { x: i < 4 ? -1 : 4, y: (i % 4) + 0 } })), box(5, 4, -1, -0.5)),
  def('display.matrix', 'LED Matrix', [...Array(8).keys()].map((i) => ({ name: `R${i}`, offset: { x: -1, y: i } })).concat([...Array(8).keys()].map((i) => ({ name: `C${i}`, offset: { x: i, y: 8 } }))), box(9, 9, -1, -0.5)),
  def('meter.voltmeter', 'Voltmeter', vtwo(3), box(1.6, 3, -0.8, 0)),
  def('meter.ammeter', 'Ammeter', two(3), box(3, 1.6, 0, -0.8)),
  def('digital.or', 'OR', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'B', offset: { x: 0, y: 2 } }, { name: 'Y', offset: { x: 4, y: 1 } }], box(4, 3, 0, -0.5)),
  def('digital.nand', 'NAND', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'B', offset: { x: 0, y: 2 } }, { name: 'Y', offset: { x: 4, y: 1 } }], box(4, 3, 0, -0.5)),
  def('digital.xor', 'XOR', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'B', offset: { x: 0, y: 2 } }, { name: 'Y', offset: { x: 4, y: 1 } }], box(4, 3, 0, -0.5)),
  def('digital.not', 'NOT', [{ name: 'A', offset: { x: 0, y: 0 } }, { name: 'Y', offset: { x: 3, y: 0 } }], box(3, 1.4, 0, -0.7)),
  def('digital.counter', 'Counter', ['CLK', 'RST', 'EN', 'Q0', 'Q1', 'Q2', 'Q3', 'CO'].map((n, i) => ({ name: n, offset: { x: i < 3 ? -1 : 4, y: i < 3 ? i : i - 3 } })), box(5, 5, -1, -0.5)),
  def('digital.bcd7seg', 'BCD to 7-seg', ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => ({ name: n, offset: { x: i < 4 ? -1 : 4, y: i < 4 ? i : i - 4 } })), box(5, 7, -1, -0.5)),
  def('misc.lamp', 'Lamp', two(3), box(3, 1.4, 0, -0.7), [num('power', 'W', 1)]),
  def('misc.buzzer', 'Buzzer', two(3), box(3, 1.4, 0, -1)),
  def('opto.photodiode', 'Photodiode', two(3), box(3, 1.4, 0, -0.7)),
  def('opto.ldr', 'LDR', two(4), box(4, 1.6, 0, -0.8)),
  def('opto.solar_cell', 'Solar cell', vtwo(3), box(1.6, 3, -0.8, 0)),
  def('opto.laser_diode', 'Laser diode', two(3), box(3, 1.4, 0, -0.7), [{ key: 'wavelength', label: 'λ', kind: 'wavelength', default: 650 }]),
  def('opto.coil', 'Electromagnet', two(4), box(4, 1.6, 0, -0.8), [num('inductance', 'H', 0.01)]),
  def('source.psu', 'PSU', [{ name: '+', offset: { x: 4, y: 0 } }, { name: '-', offset: { x: 4, y: 2 } }], box(4, 3, 0, -0.5), [num('voltage', 'V', 12), num('currentLimit', 'A', 1)]),
  def('source.ac', 'AC', vtwo(3), box(1.6, 3, -0.8, 0), [num('amplitude', 'V', 10), num('frequency', 'Hz', 50)]),
  def('source.function_gen', 'Function generator', vtwo(3), box(1.6, 3, -0.8, 0), [num('frequency', 'Hz', 1000), { key: 'waveform', label: 'Wave', kind: 'select', default: 'square', options: [{ value: 'square', label: 'Square' }] }]),
  def('source.current', 'Current source', vtwo(3), box(1.6, 3, -0.8, 0), [num('current', 'A', 0.01)]),
  def('osc.crystal', 'Crystal', two(3), box(3, 1.2, 0, -0.6), [num('frequency', 'Hz', 16e6)]),
  def('custom.mystery', 'Mystery Box', [{ name: 'X', offset: { x: -1, y: 0 } }, { name: 'Y', offset: { x: 3, y: 0 } }], box(4, 2, -1, -1))
);

const ROT = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]];

export function mockPinPositions(c: CircuitComponent): { name: string; p: Vec2 }[] {
  const d = mockRegistry.find((x) => x.type === c.type);
  if (!d) return [];
  const pins = typeof d.pins === 'function' ? d.pins(c.props) : d.pins;
  const [a, b, cc, dd] = ROT[c.rotation ?? 0];
  return pins.map((p) => {
    const x = c.mirrored ? -p.offset.x : p.offset.x, y = p.offset.y;
    return { name: p.name, p: { x: c.position.x + a * x + cc * y, y: c.position.y + b * x + dd * y } };
  });
}

let counter = 0;

const emptyState = (): CircuitState => ({ time: 0, nodeVoltages: {}, pinNets: {}, components: {}, converged: true });

export const mockEngine: CircuitEngineAPI = {
  registry: mockRegistry,
  defaultSettings: () => ({ timestep: 1e-5, simSpeed: 1, gmin: 1e-12 }),
  createComponent(type: string, position: Vec2): CircuitComponent {
    const d = mockRegistry.find((x) => x.type === type);
    const props: Record<string, number | string | boolean> = {};
    for (const p of d?.params ?? []) props[p.key] = p.default;
    return { id: `c${++counter}`, type, position: { x: Math.round(position.x), y: Math.round(position.y) }, rotation: 0, props };
  },
  getPinPositions: mockPinPositions,
  createSimulator(_scene: CircuitScene): CircuitSimulator {
    let st = emptyState();
    return {
      step: (dt) => { st = { ...st, time: st.time + dt }; return st; },
      interact: () => undefined,
      setExternal: () => undefined,
      updateProps: () => undefined,
      reset: () => { st = emptyState(); },
      getState: () => st
    };
  }
};
