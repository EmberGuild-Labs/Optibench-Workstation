import { Bench } from './helpers';

/** ~55-component mixed circuit: 555 clock → counter → decoder → 7-seg, BJT LED drivers, RC filters, rectifier, MOSFET lamp driver. */
export function bigCircuit(): Bench {
  const b = new Bench();
  b.add('source.battery', 'V', { voltage: 5, internalResistance: 0.05, capacity: 1e5 });
  b.ground('V:-');
  // 555 astable ≈ 1 kHz
  b.add('ic.555', 'U');
  b.add('passive.resistor', 'RA', { resistance: 1000 });
  b.add('passive.resistor', 'RB', { resistance: 6800 });
  b.add('passive.capacitor', 'CT', { capacitance: 100e-9 });
  b.connect('V:+', 'U:VCC', 'RA:A');
  b.connect('RA:B', 'U:DIS', 'RB:A');
  b.connect('RB:B', 'U:THR', 'U:TRIG', 'CT:A');
  b.ground('CT:B', 'U:GND');
  // counter + decoder + display
  b.add('digital.counter', 'CNT', { modulus: 10 });
  b.add('digital.bcd7seg', 'DEC');
  b.add('display.7seg', 'DS');
  b.connect('U:OUT', 'CNT:CLK');
  b.ground('CNT:RST', 'DS:COM');
  ['A', 'B', 'C', 'D'].forEach((p, i) => b.connect(`CNT:Q${i}`, `DEC:${p}`));
  for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    b.add('passive.resistor', `R${seg}`, { resistance: 330 });
    b.connect(`DEC:${seg}`, `R${seg}:A`);
    b.connect(`R${seg}:B`, `DS:${seg}`);
  }
  // four BJT LED drivers on the counter bits
  for (let i = 0; i < 4; i++) {
    b.add('passive.resistor', `RBB${i}`, { resistance: 10000 });
    b.add('semi.npn', `Q${i}`);
    b.add('semi.led', `L${i}`, { color: ['red', 'green', 'blue', 'yellow'][i] });
    b.add('passive.resistor', `RL${i}`, { resistance: 150 });
    b.connect(`CNT:Q${i}`, `RBB${i}:A`);
    b.connect(`RBB${i}:B`, `Q${i}:B`);
    b.ground(`Q${i}:E`);
    b.connect('V:+', `RL${i}:A`);
    b.connect(`RL${i}:B`, `L${i}:A`);
    b.connect(`L${i}:K`, `Q${i}:C`);
  }
  // RC ladder on the 555 output
  let prev = 'U:OUT';
  for (let i = 0; i < 4; i++) {
    b.add('passive.resistor', `RF${i}`, { resistance: 2200 });
    b.add('passive.capacitor', `CF${i}`, { capacitance: 47e-9 });
    b.connect(prev, `RF${i}:A`);
    b.connect(`RF${i}:B`, `CF${i}:A`);
    b.ground(`CF${i}:B`);
    prev = `CF${i}:A`;
  }
  b.add('meter.probe', 'TP');
  b.connect(prev, 'TP:IN');
  // AC source + bridge rectifier + smoothing + load
  b.add('source.ac', 'AC', { amplitude: 9, frequency: 50 });
  for (let i = 0; i < 4; i++) b.add('semi.diode', `D${i}`);
  b.add('passive.capacitor', 'CS', { capacitance: 100e-6, esr: 0.1 });
  b.add('passive.resistor', 'RLOAD', { resistance: 470 });
  b.connect('AC:+', 'D0:A', 'D1:K');
  b.connect('AC:-', 'D2:A', 'D3:K');
  b.connect('D0:K', 'D2:K', 'CS:A', 'RLOAD:A');
  b.connect('D1:A', 'D3:A', 'CS:B', 'RLOAD:B');
  b.ground('CS:B');
  // MOSFET lamp driver gated by Q3
  b.add('semi.nmos', 'M');
  b.add('misc.lamp', 'LA', { ratedVoltage: 5, ratedPower: 0.5 });
  b.add('passive.inductor', 'LX', { inductance: 1e-3, dcr: 0.5 });
  b.connect('CNT:Q3', 'M:G');
  b.connect('V:+', 'LA:A');
  b.connect('LA:B', 'LX:A');
  b.connect('LX:B', 'M:D');
  b.ground('M:S');
  b.add('meter.voltmeter', 'VM');
  b.connect('VM:+', 'RLOAD:A');
  b.ground('VM:-');
  return b;
}

/** bigCircuit() plus two single-supply op-amp stages (×2 amplifier, follower) and a transistor-switched DC motor: > 60 parts. */
export function bigCircuitAnalog(): Bench {
  const b = bigCircuit();
  // non-inverting amplifier (×2) on the filtered 555 signal
  b.add('ic.opamp', 'OA1', { model: 'rrio' });
  b.add('passive.resistor', 'RI', { resistance: 10000 });
  b.add('passive.resistor', 'RFB', { resistance: 10000 });
  b.connect('CF3:A', 'OA1:IN+');
  b.connect('OA1:OUT', 'RFB:A');
  b.connect('RFB:B', 'OA1:IN-', 'RI:A');
  b.ground('RI:B');
  // follower buffering a divider of the rectifier output into a load
  b.add('ic.opamp', 'OA2', { model: 'lm358' });
  b.add('passive.resistor', 'RD1', { resistance: 30000 });
  b.add('passive.resistor', 'RD2', { resistance: 10000 });
  b.add('passive.resistor', 'RO', { resistance: 2200 });
  b.connect('RLOAD:A', 'RD1:A');
  b.connect('RD1:B', 'RD2:A', 'OA2:IN+');
  b.ground('RD2:B');
  b.connect('OA2:OUT', 'OA2:IN-', 'RO:A');
  b.ground('RO:B');
  for (const u of ['OA1', 'OA2']) {
    b.connect('V:+', `${u}:V+`);
    b.ground(`${u}:V-`);
  }
  // DC motor switched by counter bit Q2 through an NPN, with flyback diode
  b.add('misc.motor', 'MOT', { resistance: 20 });
  b.add('semi.npn', 'QM');
  b.add('passive.resistor', 'RBM', { resistance: 1000 });
  b.add('semi.diode', 'DF');
  b.connect('CNT:Q2', 'RBM:A');
  b.connect('RBM:B', 'QM:B');
  b.ground('QM:E');
  b.connect('V:+', 'MOT:+', 'DF:K');
  b.connect('MOT:-', 'QM:C', 'DF:A');
  return b;
}
