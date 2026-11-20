/** Symbol registry keyed by canonical circuit type id (docs/ARCHITECTURE.md). */
import type { SymbolFn, SymCtx } from './draw';
import { capacitor, crystal, inductor, potentiometer, resistor, transformer } from './passive';
import { acSource, battery, currentSource, functionGen, ground, ic555, psu } from './sources';
import { bjt, diode, laserDiode, ldr, led, mosfet, photodiode, solarCell, zener } from './semis';
import { pushButton, relay, spdt, spst } from './switches';
import { ledMatrix, sevenSeg } from './displays';
import { bcdDecoder, counter, gate, genericIC } from './digital';
import { buzzer, coil, lamp, meter, probe } from './misc';
import { clockSource, comparator, decoder138, fuse, hbridge, motor, opamp, regulator, servo, shift595, thermistor } from './extra';

export const SYMBOLS: Record<string, SymbolFn> = {
  'source.battery': battery,
  'source.psu': psu,
  'source.ac': acSource,
  'source.function_gen': functionGen,
  'source.current': currentSource,
  'misc.ground': ground,
  'osc.crystal': crystal,
  'ic.555': ic555,
  'passive.resistor': resistor,
  'passive.potentiometer': potentiometer,
  'passive.capacitor': capacitor,
  'passive.inductor': inductor,
  'passive.transformer': transformer,
  'semi.diode': diode,
  'semi.zener': zener,
  'semi.led': led,
  'semi.npn': (s) => bjt(s, false),
  'semi.pnp': (s) => bjt(s, true),
  'semi.nmos': (s) => mosfet(s, false),
  'semi.pmos': (s) => mosfet(s, true),
  'switch.spst': spst,
  'switch.spdt': spdt,
  'switch.push': pushButton,
  'switch.relay': relay,
  'display.7seg': sevenSeg,
  'display.matrix': ledMatrix,
  'meter.voltmeter': (s) => meter(s, 'V'),
  'meter.ammeter': (s) => meter(s, 'A'),
  'meter.probe': probe,
  'digital.and': (s) => gate(s, 'and'),
  'digital.or': (s) => gate(s, 'or'),
  'digital.not': (s) => gate(s, 'not'),
  'digital.nand': (s) => gate(s, 'nand'),
  'digital.nor': (s) => gate(s, 'nor'),
  'digital.xor': (s) => gate(s, 'xor'),
  'digital.xnor': (s) => gate(s, 'xnor'),
  'digital.buffer': (s) => gate(s, 'buf'),
  'digital.counter': counter,
  'digital.bcd7seg': bcdDecoder,
  'misc.lamp': lamp,
  'misc.buzzer': buzzer,
  'opto.photodiode': photodiode,
  'opto.ldr': ldr,
  'opto.solar_cell': solarCell,
  'opto.laser_diode': laserDiode,
  'opto.coil': coil,
  'source.clock': clockSource,
  'ic.opamp': opamp,
  'ic.comparator': comparator,
  'ic.regulator': regulator,
  'ic.shift595': shift595,
  'ic.decoder138': decoder138,
  'ic.hbridge': hbridge,
  'misc.motor': motor,
  'misc.servo': servo,
  'passive.thermistor': thermistor,
  'passive.fuse': fuse
};

/** Types that have no designator/value label drawn next to them. */
export const NO_LABEL = new Set(['misc.ground']);

export function drawSymbol(s: SymCtx): void {
  const fn = SYMBOLS[s.c.type];
  if (fn && s.pins.length) {
    fn(s);
    return;
  }
  const title = s.def?.label ?? s.c.type.split('.').pop() ?? '?';
  genericIC(s, title.length > 10 ? title.slice(0, 10) : title);
}

export type { SymCtx, SymbolFn } from './draw';
