/**
 * Optibench Workstation — circuit component registry.
 *
 * PIN LAYOUT TABLE (rotation 0, grid units, +x right, +y DOWN).
 * `size` = full footprint bounding box INCLUDING pin stubs ({ox,oy} = top-left corner relative
 * to the component origin, {w,h} = extent). Pins always lie on the border of that box.
 * Rotation = quarter turns clockwise about the origin: (x,y) -> (-y,x) per turn.
 * Mirroring flips x BEFORE rotating.
 *
 * | type                    | pins (name @ x,y)                                                      | size ox,oy,w,h   |
 * |-------------------------|------------------------------------------------------------------------|------------------|
 * | source.battery          | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | source.psu              | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | source.ac               | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | source.function_gen     | + @-2,0   - @2,0   (+ = signal out, - = common)                        | -2,-1,4,2        |
 * | source.current          | + @-2,0   - @2,0   (current leaves the + pin into the circuit)         | -2,-1,4,2        |
 * | misc.ground             | GND @0,0  (symbol hangs below the pin)                                 | -1,0,2,1         |
 * | osc.crystal             | VCC @0,-2   GND @0,2   OUT @2,0                                        | -2,-2,4,4        |
 * | ic.555                  | left x=-3: GND@-3  TRIG@-1  OUT@1  RESET@3 (y)                         | -3,-4,6,8        |
 * |                         | right x=3: VCC@-3  DIS@-1   THR@1  CTRL@3 (y)   (DIP-8 order)          |                  |
 * | passive.resistor        | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | passive.potentiometer   | A @-2,0   B @2,0   W @0,-2 (wiper)                                     | -2,-2,4,3        |
 * | passive.capacitor       | A @-2,0   B @2,0   (A = positive plate when polarized)                 | -2,-1,4,2        |
 * | passive.inductor        | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | passive.transformer     | P1 @-2,-2  P2 @-2,2  S1 @2,-2  S2 @2,2  (dots at P1 and S1)            | -2,-2,4,4        |
 * | semi.diode / semi.zener | A @-2,0   K @2,0                                                       | -2,-1,4,2        |
 * | semi.led                | A @-2,0   K @2,0                                                       | -2,-1,4,2        |
 * | semi.npn / semi.pnp     | B @-2,0   C @2,-2   E @2,2                                             | -2,-2,4,4        |
 * | semi.nmos / semi.pmos   | G @-2,0   D @2,-2   S @2,2                                             | -2,-2,4,4        |
 * | switch.spst             | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | switch.push             | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | switch.spdt             | COM @-2,0   A @2,-1   B @2,1                                           | -2,-2,4,4        |
 * | switch.relay            | C1 @-2,-2  C2 @-2,2 (coil)   NO @2,-2  COM @2,0  NC @2,2               | -2,-3,4,6        |
 * | display.7seg            | left x=-3: a@-4 b@-3 c@-2 d@-1 e@0 f@1 g@2 dp@3 (y)   COM @3,0         | -3,-5,6,9        |
 * | display.matrix          | rows R1..R8 @-5,(-4..3)    columns C1..C8 @(-4..3),5                   | -5,-5,10,10      |
 * | meter.voltmeter         | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | meter.ammeter           | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | meter.probe             | IN @0,0  (body to the right of the pin)                                | 0,-1,2,2         |
 * | digital.and/or/nand/xor | A @-2,-1   B @-2,1   Y @2,0                                            | -2,-1.5,4,3      |
 * | digital.not             | A @-2,0   Y @2,0                                                       | -2,-1,4,2        |
 * | digital.counter         | CLK @-3,-1  RST @-3,1    Q0 @3,-3  Q1 @3,-1  Q2 @3,1  Q3 @3,3          | -3,-4,6,8        |
 * | digital.bcd7seg         | A @-3,-3 B @-3,-1 C @-3,1 D @-3,3 (A = LSB)   a..g @3,(-3..3)          | -3,-4,6,8        |
 * | misc.lamp               | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | misc.buzzer             | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | opto.photodiode         | A @-2,0   K @2,0                                                       | -2,-1,4,2        |
 * | opto.ldr                | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | opto.solar_cell         | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | opto.laser_diode        | A @-2,0   K @2,0                                                       | -2,-1,4,2        |
 * | opto.coil               | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | source.clock            | OUT @2,0  (body to the left of the pin; implied supply)                | -2,-1,4,2        |
 * | ic.opamp                | IN- @-3,-1   IN+ @-3,1   OUT @3,0   V+ @0,-2   V- @0,2                  | -3,-2,6,4        |
 * | ic.comparator           | IN- @-3,-1   IN+ @-3,1   OUT @3,0   V+ @0,-2   V- @0,2  (open collector)| -3,-2,6,4        |
 * | ic.regulator            | IN @-3,0   OUT @3,0   GND @0,2                                         | -3,-2,6,4        |
 * | ic.shift595             | left x=-3: SER@-4 SRCLK@-2 RCLK@0 OE@2 SRCLR@4 (y)                     | -3,-5,6,10       |
 * |                         | right x=3: Q0..Q7 @(-4..3)  Q7S@4 (y)      (OE, SRCLR active-low)      |                  |
 * | ic.decoder138           | left x=-3: A@-4 B@-3 C@-2 G1@0 G2A@1 G2B@2 (y)                         | -3,-5,6,9        |
 * |                         | right x=3: Y0..Y7 @(-4..3) (y)   (outputs and G2A, G2B active-low)     |                  |
 * | ic.hbridge              | left x=-3: EN@-2 IN1@0 IN2@2 (y)  right x=3: OUT1@-1 OUT2@1  VS @0,-3  | -3,-3,6,6        |
 * | misc.motor              | + @-2,0   - @2,0                                                       | -2,-1,4,2        |
 * | misc.servo              | SIG @-2,0   V+ @0,-2   GND @0,2  (horn on the right)                   | -2,-2,4,4        |
 * | passive.thermistor      | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 * | passive.fuse            | A @-2,0   B @2,0                                                       | -2,-1,4,2        |
 *
 * PIN ORDER in the registry: ic.opamp / ic.comparator [IN+, IN-, OUT, V+, V-]; ic.regulator [IN, GND, OUT];
 * ic.shift595 [SER, SRCLK, RCLK, OE, SRCLR, Q0..Q7, Q7S]; ic.decoder138 [A, B, C, G1, G2A, G2B, Y0..Y7];
 * ic.hbridge [EN, IN1, IN2, OUT1, OUT2, VS]; misc.servo [V+, GND, SIG].
 *
 * DIGITAL PARTS use an IMPLIED supply (prop `vdd`, default 5 V) referenced to the circuit ground
 * net; they have no VCC/GND pins. Inputs are high-impedance with Schmitt-style thresholds
 * (low < 0.4·vdd, high > 0.6·vdd), outputs are voltage sources (0 / vdd) behind `rout`.
 *
 * STATE CONVENTIONS: `voltage` = V(first pin) − V(second pin); `current` flows first→second pin
 * through the part; `power` = dissipated W. For sources `current`/`power` are the DELIVERED
 * current / power (positive when sourcing).
 *
 * STATE KEYS (CircuitState.components[id]) — every component has current, voltage, power; plus:
 *   source.battery      charge (0..1), chargePercent, emf, text ("87 %")
 *   source.psu          on, mode ('CV' | 'CC' | 'OFF'), text
 *   source.ac / function_gen   frequency (+ waveform)
 *   osc.crystal         on (output level), running, frequency
 *   ic.555              on (output high), discharging, supply
 *   passive.resistor    overheating (power > rating)
 *   passive.potentiometer  position (0..1), wiperVoltage, wiperCurrent
 *   passive.capacitor   charge, energy, reverseBiased, overVoltage
 *   passive.inductor    energy            opto.coil: + bField (T), text
 *   passive.transformer secondaryVoltage, secondaryCurrent (voltage/current = primary)
 *   semi.diode / zener  on (+ regulating for the zener)
 *   semi.led            brightness (0..1), opticalPower (W), wavelength (nm), color, on, overdriven
 *   semi.npn / pnp      ic, ib, ie, vbe, vce (polarity-normalised), region, on   (current = ic, voltage = V(C)−V(E))
 *   semi.nmos / pmos    id, vgs, vds (polarity-normalised), region, on           (current = id, voltage = V(D)−V(S))
 *   switch.*            on (spst/push: closed; spdt: COM–A closed; relay: energised), push: pressed,
 *                       spdt: position ('A' | 'B'), relay: contactCurrent
 *   display.7seg        segments[8] (a..g, dp; 0..1), color, wavelength, on
 *   display.matrix      segments[64] row-major (row·8 + column), color, wavelength, on
 *   meter.voltmeter / ammeter  value, text ("3.30 V", "12.5 mA")
 *   meter.probe         value, text, min, max, history { t: number[], v: number[] } (oldest → newest, ≤ 2000 samples)
 *   digital.*           on (first output), outputs: boolean[], inputs: boolean[]; counter: count, text; bcd7seg: value, text
 *   misc.lamp           brightness, temperature (K), resistance, blown, overdriven, on
 *   misc.buzzer         active, frequency, volume (0..1), on
 *   opto.photodiode     photocurrent (A), opticalPower (incident W), on
 *   opto.ldr            resistance, opticalPower, text
 *   opto.solar_cell     photocurrent, opticalPower, on   (current/power = delivered)
 *   opto.laser_diode    opticalPower (W), brightness, wavelength, lasing, on, overdriven
 *   source.clock        on (output level), running, frequency
 *   ic.opamp            voltage = V(OUT) to ground, current = delivered output current; vdiff, vplus, vminus, supply,
 *                       saturated, clipping ('high' | 'low' | 'none'), slewing, limiting (current limit), on (OUT above mid-supply)
 *   ic.comparator       voltage = V(OUT), current = sink current; on (output released/high), sinking, vdiff, supply, overdriven
 *   ic.regulator        voltage = V(OUT)-V(GND), current = output current; inputVoltage, inputCurrent, nominal,
 *                       mode ('REG' | 'DROPOUT' | 'LIMIT' | 'OFF'), regulating, on, overheating, text
 *   ic.shift595         outputs[9] (Q0..Q7, Q7S), inputs[5], value (latched byte), shift (shift register), enabled, text
 *   ic.decoder138       outputs[8] (true = HIGH = not selected), inputs[6], value (selected output or -1), enabled, text
 *   ic.hbridge          voltage = V(OUT1)-V(OUT2), current = out of OUT1; on (enabled), direction ('forward' | 'reverse' |
 *                       'brake' | 'coast'), supply, inputs [EN, IN1, IN2], overdriven, text
 *   misc.motor          speed (rad/s), rpm, angle (rad, unwrapped), angleDeg, torque (N·m), backEmf, mechanicalPower, stalled, on, text
 *   misc.servo          angleDeg (0..range), angle (rad), target (deg), fraction (0..1 of the range), pulseWidth (s), powered, moving, on, text
 *   passive.thermistor  resistance, temperature (°C), text
 *   passive.fuse        blown, on (intact), heat (0..1, blows at 1), text
 *
 * INTERACTION: switch.spst / spdt / push, source.psu accept 'toggle' | 'press' | 'release' | {set};
 * passive.potentiometer accepts {set: 0..1}. EXTERNALS: setExternal(id, 'opticalPower', W) for
 * opto.photodiode / opto.ldr / opto.solar_cell (overrides their manual `illumination` prop).
 * passive.fuse: 'toggle' / 'press' fits a new fuse ({set: 0} blows it); source.clock: 'toggle' starts/stops;
 * passive.thermistor: {set: °C}. More EXTERNALS: setExternal(id, 'temperature', °C) for passive.thermistor,
 * setExternal(id, 'loadTorque', N·m) for misc.motor (added to its `loadTorque` prop).
 *
 * ANALOG ICs: ic.opamp / ic.comparator supply pins left unconnected are powered implicitly (op-amp: ideal
 * ±15 V rails; comparator: V+ present, V- = circuit ground). ic.hbridge and source.clock use circuit ground.
 */

import type { CircuitComponent, CircuitComponentDef, ParamDef, ParamValue, PinDef, Vec2 } from '../types';

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

type NumOpts = Partial<Pick<ParamDef, 'min' | 'max' | 'step' | 'log' | 'help' | 'group'>>;

function num(key: string, label: string, def: number, unit: string, o: NumOpts = {}): ParamDef {
  return { key, label, kind: 'number', unit, default: def, ...o };
}
function bool(key: string, label: string, def: boolean, o: Partial<ParamDef> = {}): ParamDef {
  return { key, label, kind: 'boolean', default: def, ...o };
}
function sel(key: string, label: string, def: string, options: [string, string][], o: Partial<ParamDef> = {}): ParamDef {
  return { key, label, kind: 'select', default: def, options: options.map(([value, l]) => ({ value, label: l })), ...o };
}
const pin = (name: string, x: number, y: number): PinDef => ({ name, offset: { x, y } });

const TWO = (a: string, b: string): PinDef[] => [pin(a, -2, 0), pin(b, 2, 0)];
const SZ2 = { w: 4, h: 2, ox: -2, oy: -1 };
const SZ4 = { w: 4, h: 4, ox: -2, oy: -2 };

const R_OPTS: NumOpts = { min: 0.1, max: 1e8, log: true };
const C_OPTS: NumOpts = { min: 1e-12, max: 1, log: true };
const L_OPTS: NumOpts = { min: 1e-7, max: 100, log: true };

/** LED colour table: forward voltage at 20 mA, dominant wavelength (nm), typical wall-plug efficiency. */
export const LED_COLORS: Record<string, { label: string; vf: number; wavelength: number; efficiency: number; css: string }> = {
  red: { label: 'Red (630 nm)', vf: 1.9, wavelength: 630, efficiency: 0.18, css: '#ff2a1f' },
  orange: { label: 'Orange (605 nm)', vf: 2.0, wavelength: 605, efficiency: 0.14, css: '#ff8a1a' },
  yellow: { label: 'Yellow (590 nm)', vf: 2.1, wavelength: 590, efficiency: 0.12, css: '#ffd21a' },
  green: { label: 'Green (525 nm)', vf: 2.9, wavelength: 525, efficiency: 0.15, css: '#1fe05a' },
  blue: { label: 'Blue (470 nm)', vf: 3.0, wavelength: 470, efficiency: 0.3, css: '#2a7bff' },
  white: { label: 'White (phosphor)', vf: 3.1, wavelength: 555, efficiency: 0.3, css: '#f4f6ff' },
  ir: { label: 'Infrared (940 nm)', vf: 1.25, wavelength: 940, efficiency: 0.3, css: '#7a1030' },
  uv: { label: 'Ultraviolet (395 nm)', vf: 3.4, wavelength: 395, efficiency: 0.2, css: '#8a3cff' },
};
const LED_COLOR_OPTIONS: [string, string][] = Object.entries(LED_COLORS).map(([k, v]) => [k, v.label]);

/** ic.opamp `model` options (the numbers live in devices-extra.ts: OPAMP_MODELS). */
const OPAMP_MODEL_OPTIONS: [string, string][] = [
  ['generic', 'Generic (parameters below)'], ['lm358', 'LM358 (single-supply bipolar)'], ['tl072', 'TL072 (JFET input)'],
  ['lm741', 'LM741 (classic bipolar)'], ['rrio', 'Rail-to-rail CMOS'],
];

const DIGITAL_PARAMS: ParamDef[] = [
  num('vdd', 'Supply voltage (implied)', 5, 'V', { min: 1.8, max: 18, step: 0.1, group: 'Logic', help: 'Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net.' }),
  num('rout', 'Output resistance', 40, 'Ω', { min: 1, max: 10000, log: true, group: 'Logic', help: 'Series resistance of the output driver.' }),
  num('delay', 'Propagation delay', 0, 's', { min: 0, max: 0.01, step: 1e-6, group: 'Logic', help: 'Extra propagation delay. 0 = one simulation step.' }),
];

function gate(type: string, label: string, description: string): CircuitComponentDef {
  return {
    type, label, category: 'Digital', description,
    params: DIGITAL_PARAMS,
    pins: [pin('A', -2, -1), pin('B', -2, 1), pin('Y', 2, 0)],
    size: { w: 4, h: 3, ox: -2, oy: -1.5 },
  };
}

const SWITCH_R: ParamDef[] = [
  num('ron', 'On resistance', 0.01, 'Ω', { min: 1e-4, max: 100, log: true, group: 'Electrical' }),
  num('roff', 'Off resistance', 1e9, 'Ω', { min: 1e3, max: 1e12, log: true, group: 'Electrical' }),
];

const BJT_PARAMS: ParamDef[] = [
  num('beta', 'Current gain β (hFE)', 200, '', { min: 5, max: 2000, log: true, group: 'Model', help: 'Forward current gain Ic/Ib in the active region.' }),
  num('is', 'Saturation current Is', 1e-14, 'A', { min: 1e-18, max: 1e-9, log: true, group: 'Model' }),
  num('vaf', 'Early voltage Vaf', 100, 'V', { min: 0, max: 1000, group: 'Model', help: 'Output-resistance (Early) voltage. 0 disables the Early effect.' }),
  num('betaR', 'Reverse gain βr', 4, '', { min: 0.1, max: 100, log: true, group: 'Model' }),
];
const MOS_PARAMS = (vth: number): ParamDef[] => [
  num('vth', 'Threshold voltage |Vth|', vth, 'V', { min: 0.1, max: 10, step: 0.05, group: 'Model', help: 'Magnitude of the gate threshold (enhancement mode).' }),
  num('k', 'Transconductance K', 0.5, 'A/V²', { min: 1e-5, max: 100, log: true, group: 'Model', help: 'Id(sat) = K/2 · (Vgs − Vth)² · (1 + λ·Vds)' }),
  num('lambda', 'Channel-length modulation λ', 0.01, '1/V', { min: 0, max: 0.5, step: 0.001, group: 'Model' }),
  bool('bodyDiode', 'Body diode', true, { group: 'Model', help: 'Intrinsic source-drain diode of a discrete power MOSFET.' }),
];

// ---------------------------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------------------------

export const registry: CircuitComponentDef[] = [
  // ------------------------------------------------------------------ Sources
  {
    type: 'source.battery', label: 'Battery', category: 'Sources',
    description: 'Electrochemical cell/battery: EMF behind an internal resistance. The stored charge (mAh) drains with the delivered current; the EMF sags as it empties and collapses near 0 %.',
    params: [
      num('voltage', 'Nominal EMF', 9, 'V', { min: 0.1, max: 400, step: 0.1, group: 'Electrical' }),
      num('internalResistance', 'Internal resistance', 0.5, 'Ω', { min: 0.001, max: 100, log: true, group: 'Electrical' }),
      num('capacity', 'Capacity', 500, 'mAh', { min: 0.0001, max: 100000, log: true, group: 'Charge', help: 'Total charge when full. Use a tiny value to watch it drain quickly.' }),
      num('initialCharge', 'Initial charge', 100, '%', { min: 0, max: 100, step: 1, group: 'Charge' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'source.psu', label: 'Bench Power Supply', category: 'Sources',
    description: 'Regulated lab supply: constant voltage (CV) until the load current reaches the limit, then constant current (CC) with the voltage folding back. Cannot sink current.',
    params: [
      num('voltage', 'Set voltage', 5, 'V', { min: 0, max: 60, step: 0.1, group: 'Output' }),
      num('currentLimit', 'Current limit', 1, 'A', { min: 0.001, max: 30, log: true, group: 'Output' }),
      num('outputResistance', 'Output resistance', 0.01, 'Ω', { min: 0.001, max: 10, log: true, group: 'Output' }),
      bool('on', 'Output enabled', true, { group: 'Output' }),
    ],
    pins: TWO('+', '-'), size: SZ2, interactive: true,
  },
  {
    type: 'source.ac', label: 'AC Source', category: 'Sources',
    description: 'Sinusoidal voltage source v(t) = offset + A·sin(2πft + φ) with optional series resistance.',
    params: [
      num('amplitude', 'Amplitude (peak)', 10, 'V', { min: 0, max: 1000, step: 0.1, group: 'Waveform' }),
      num('frequency', 'Frequency', 50, 'Hz', { min: 0.01, max: 1e6, log: true, group: 'Waveform' }),
      num('phase', 'Phase', 0, '°', { min: -360, max: 360, step: 1, group: 'Waveform' }),
      num('offset', 'DC offset', 0, 'V', { min: -1000, max: 1000, step: 0.1, group: 'Waveform' }),
      num('seriesResistance', 'Series resistance', 0.1, 'Ω', { min: 0, max: 1e4, group: 'Electrical' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'source.function_gen', label: 'Function Generator', category: 'Sources',
    description: 'Signal generator with sine, square, triangle and sawtooth outputs, DC offset, duty cycle and a 50 Ω output.',
    params: [
      sel('waveform', 'Waveform', 'sine', [['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'], ['sawtooth', 'Sawtooth']], { group: 'Waveform' }),
      num('frequency', 'Frequency', 1000, 'Hz', { min: 0.01, max: 1e6, log: true, group: 'Waveform' }),
      num('amplitude', 'Amplitude (peak)', 2.5, 'V', { min: 0, max: 50, step: 0.05, group: 'Waveform' }),
      num('offset', 'DC offset', 2.5, 'V', { min: -50, max: 50, step: 0.05, group: 'Waveform' }),
      num('duty', 'Duty cycle', 50, '%', { min: 1, max: 99, step: 1, group: 'Waveform', help: 'Square: high-time fraction. Triangle: rise-time fraction.' }),
      num('phase', 'Phase', 0, '°', { min: -360, max: 360, step: 1, group: 'Waveform' }),
      num('outputResistance', 'Output resistance', 50, 'Ω', { min: 0, max: 1e4, group: 'Electrical' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'source.current', label: 'Current Source', category: 'Sources',
    description: 'Ideal DC current source. Current leaves the + pin, flows through the external circuit and returns at the − pin.',
    params: [num('current', 'Current', 0.01, 'A', { min: -10, max: 10, step: 0.001, group: 'Electrical' })],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'misc.ground', label: 'Ground', category: 'Sources',
    description: 'Reference node (0 V). All ground symbols are connected together.',
    params: [],
    pins: [pin('GND', 0, 0)], size: { w: 2, h: 1, ox: -1, oy: 0 },
  },
  {
    type: 'source.clock', label: 'Clock (digital)', category: 'Sources',
    description: 'Digital square-wave clock with an implied supply: the output switches between 0 V and the logic-high level relative to circuit ground. It starts low; the first rising edge comes after (1 − duty) of a period. Click it while simulating to stop / start it. Keep the frequency below ≈ 1/(10·timestep).',
    params: [
      num('frequency', 'Frequency', 1, 'Hz', { min: 0.001, max: 1e6, log: true, group: 'Clock' }),
      num('duty', 'Duty cycle', 50, '%', { min: 1, max: 99, step: 1, group: 'Clock' }),
      num('phase', 'Phase', 0, '°', { min: -360, max: 360, step: 1, group: 'Clock' }),
      bool('running', 'Running', true, { group: 'Clock' }),
      num('vdd', 'High level (implied supply)', 5, 'V', { min: 1.8, max: 18, step: 0.1, group: 'Logic' }),
      num('rout', 'Output resistance', 40, 'Ω', { min: 1, max: 10000, log: true, group: 'Logic' }),
    ],
    pins: [pin('OUT', 2, 0)], size: SZ2, interactive: true,
  },

  // ------------------------------------------------------------------ Oscillators / ICs
  {
    type: 'osc.crystal', label: 'Crystal Oscillator', category: 'Oscillators & ICs',
    description: 'Clock oscillator module with a square-wave output. Ideal mode outputs 0…amplitude without needing a supply; otherwise it runs from the VCC/GND pins and swings rail-to-rail. Keep the frequency below ≈ 1/(10·timestep).',
    params: [
      num('frequency', 'Frequency', 1000, 'Hz', { min: 0.1, max: 1e6, log: true, group: 'Clock' }),
      num('duty', 'Duty cycle', 50, '%', { min: 1, max: 99, step: 1, group: 'Clock' }),
      bool('ideal', 'Ideal (no supply needed)', true, { group: 'Clock', help: 'When on, the output is 0…amplitude relative to the GND pin (or circuit ground if GND is unconnected).' }),
      num('amplitude', 'Amplitude (ideal mode)', 5, 'V', { min: 0.1, max: 30, step: 0.1, group: 'Clock' }),
      num('rout', 'Output resistance', 50, 'Ω', { min: 1, max: 1e4, log: true, group: 'Clock' }),
    ],
    pins: [pin('VCC', 0, -2), pin('GND', 0, 2), pin('OUT', 2, 0)], size: SZ4,
  },
  {
    type: 'ic.555', label: '555 Timer', category: 'Oscillators & ICs',
    description: 'Behavioural NE555: 5k-5k-5k divider, threshold (2/3 Vcc) and trigger (1/3 Vcc) comparators, SR latch, open-collector discharge transistor and a totem-pole output. Works in astable, monostable and Schmitt configurations.',
    params: [
      sel('variant', 'Variant', 'bipolar', [['bipolar', 'Bipolar (NE555)'], ['cmos', 'CMOS (TLC555)']], { group: 'Model', help: 'Bipolar: output high ≈ Vcc − 1.4 V, 3 mA quiescent. CMOS: rail-to-rail, µA quiescent.' }),
      num('rout', 'Output resistance', 10, 'Ω', { min: 1, max: 1000, log: true, group: 'Model' }),
      num('rdis', 'Discharge on-resistance', 10, 'Ω', { min: 1, max: 1000, log: true, group: 'Model' }),
    ],
    pins: [
      pin('GND', -3, -3), pin('TRIG', -3, -1), pin('OUT', -3, 1), pin('RESET', -3, 3),
      pin('CTRL', 3, 3), pin('THR', 3, 1), pin('DIS', 3, -1), pin('VCC', 3, -3),
    ],
    size: { w: 6, h: 8, ox: -3, oy: -4 },
  },

  // ------------------------------------------------------------------ Analog & interface ICs
  {
    type: 'ic.opamp', label: 'Op-Amp', category: 'Oscillators & ICs',
    description: 'Operational amplifier macro-model: open-loop gain A0 with a single pole (gain-bandwidth product), slew-rate limit, output resistance, output swing limited by the supply rails (minus headroom, or rail-to-rail), short-circuit current limit, optional input offset and bias current. The output current is really drawn from the V+ / V- pins. Works as inverting / non-inverting amplifier, integrator, comparator, Schmitt trigger, transimpedance amplifier or relaxation oscillator. Supply pins left unconnected are powered from ideal ±15 V rails.',
    params: [
      sel('model', 'Model', 'generic', OPAMP_MODEL_OPTIONS, { group: 'Model', help: 'Generic uses the parameters below. The named parts use typical data-sheet values and ignore them: LM358 (1 MHz, 0.5 V/µs, output swings to V-), TL072 (3 MHz, 13 V/µs, JFET inputs), LM741 (1 MHz, 0.5 V/µs), rail-to-rail CMOS (1 MHz, 0.6 V/µs, swings to both rails).' }),
      num('gain', 'Open-loop gain A0', 100, 'dB', { min: 20, max: 160, step: 1, group: 'Generic model', help: 'DC differential gain. 100 dB = 100 000 V/V.' }),
      num('gbw', 'Gain-bandwidth product', 1e6, 'Hz', { min: 1e3, max: 1e9, log: true, group: 'Generic model', help: 'Closed-loop bandwidth ≈ GBW / noise gain.' }),
      num('slewRate', 'Slew rate', 1, 'V/µs', { min: 0.001, max: 5000, log: true, group: 'Generic model', help: 'Maximum rate of change of the output.' }),
      num('rout', 'Output resistance', 50, 'Ω', { min: 0.01, max: 10000, log: true, group: 'Generic model', help: 'Open-loop output resistance (feedback lowers it).' }),
      bool('railToRail', 'Rail-to-rail output', false, { group: 'Generic model', help: 'Output swings to within 10 mV of both supply rails (ignores the headroom values).' }),
      num('headroomHigh', 'Headroom to V+', 1, 'V', { min: 0, max: 5, step: 0.05, group: 'Generic model', help: 'The output cannot get closer than this to the positive rail.' }),
      num('headroomLow', 'Headroom to V-', 1, 'V', { min: 0, max: 5, step: 0.05, group: 'Generic model', help: 'The output cannot get closer than this to the negative rail.' }),
      num('currentLimit', 'Output current limit', 0.025, 'A', { min: 1e-4, max: 10, log: true, group: 'Generic model', help: 'Short-circuit output current (sourcing and sinking).' }),
      num('vos', 'Input offset voltage', 0, 'V', { min: -0.1, max: 0.1, step: 1e-4, group: 'Generic model', help: 'Added to V(IN+) − V(IN-).' }),
      num('ibias', 'Input bias current', 0, 'A', { min: -1e-5, max: 1e-5, step: 1e-9, group: 'Generic model', help: 'Flows into each input pin (negative = out of the pins, as in PNP-input parts).' }),
      num('iq', 'Supply current', 1e-3, 'A', { min: 0, max: 0.1, step: 1e-4, group: 'Generic model', help: 'Quiescent current from V+ to V-.' }),
      num('rin', 'Differential input resistance', 1e12, 'Ω', { min: 1e3, max: 1e15, log: true, group: 'Generic model' }),
    ],
    pins: [pin('IN+', -3, 1), pin('IN-', -3, -1), pin('OUT', 3, 0), pin('V+', 0, -2), pin('V-', 0, 2)],
    size: { w: 6, h: 4, ox: -3, oy: -2 },
  },
  {
    type: 'ic.comparator', label: 'Comparator (LM393)', category: 'Oscillators & ICs',
    description: 'Voltage comparator with an open-collector output (one half of an LM393): the output transistor pulls OUT down to V- while V(IN+) < V(IN-) and releases it otherwise, so OUT needs a pull-up resistor to the logic supply. Add positive feedback for hysteresis. Unconnected supply pins are powered implicitly (V- = circuit ground).',
    params: [
      num('ron', 'Output saturation resistance', 50, 'Ω', { min: 0.1, max: 1000, log: true, group: 'Model', help: 'On-resistance of the output transistor (≈ 0.25 V at 5 mA).' }),
      num('hysteresis', 'Built-in hysteresis', 0, 'V', { min: 0, max: 1, step: 0.001, group: 'Model', help: 'Total width of the internal hysteresis band (0 for a real LM393).' }),
      num('vos', 'Input offset voltage', 0, 'V', { min: -0.1, max: 0.1, step: 1e-4, group: 'Model' }),
      num('iq', 'Supply current', 4e-4, 'A', { min: 0, max: 0.05, step: 1e-4, group: 'Model' }),
    ],
    pins: [pin('IN+', -3, 1), pin('IN-', -3, -1), pin('OUT', 3, 0), pin('V+', 0, -2), pin('V-', 0, 2)],
    size: { w: 6, h: 4, ox: -3, oy: -2 },
  },
  {
    type: 'ic.regulator', label: 'Voltage Regulator (78xx)', category: 'Oscillators & ICs',
    description: 'Three-terminal positive linear regulator: holds OUT at the nominal voltage above GND as long as the input is at least the dropout voltage higher; below that the output follows the input minus the dropout. Output current is limited (short-circuit protection), it cannot sink current, and a few mA of quiescent current flow from IN to GND. Dissipates (Vin − Vout)·Iout as heat.',
    params: [
      sel('model', 'Type', '7805', [['7833', '7833 (3.3 V)'], ['7805', '7805 (5 V)'], ['7809', '7809 (9 V)'], ['7812', '7812 (12 V)'], ['custom', 'Custom voltage']], { group: 'Regulator' }),
      num('voltage', 'Output voltage (custom)', 5, 'V', { min: 0.5, max: 60, step: 0.1, group: 'Regulator', help: 'Only used when Type is "Custom voltage".' }),
      num('dropout', 'Dropout voltage', 2, 'V', { min: 0.05, max: 5, step: 0.05, group: 'Regulator', help: 'Minimum input-output difference for regulation (≈ 2 V for 78xx, 0.3 V for LDOs).' }),
      num('currentLimit', 'Current limit', 1, 'A', { min: 0.01, max: 10, log: true, group: 'Regulator' }),
      num('iq', 'Quiescent current', 0.005, 'A', { min: 0, max: 0.05, step: 0.0005, group: 'Regulator' }),
      num('rout', 'Output resistance', 0.02, 'Ω', { min: 0.001, max: 1, log: true, group: 'Regulator', help: 'Load regulation: the output drops by Iout × this value.' }),
      num('powerRating', 'Power rating', 15, 'W', { min: 0.1, max: 100, log: true, group: 'Regulator', help: 'Above this dissipation the state flags overheating.' }),
    ],
    pins: [pin('IN', -3, 0), pin('GND', 0, 2), pin('OUT', 3, 0)],
    size: { w: 6, h: 4, ox: -3, oy: -2 },
  },
  {
    type: 'ic.hbridge', label: 'H-Bridge Driver (L293)', category: 'Oscillators & ICs',
    description: 'One full bridge of an L293D-style motor driver: while EN is high, each output follows its logic input — high = VS minus the saturation drop, low = ground plus the drop. IN1 ≠ IN2 drives the load forward / in reverse, IN1 = IN2 brakes it (both ends at the same level); EN low releases the outputs (coast). Built-in clamp diodes return inductive kick-back to VS / ground. Logic levels are TTL-like (high > 2.3 V); power ground is the circuit ground. An unconnected EN counts as high.',
    params: [
      num('drop', 'Saturation drop per switch', 1.2, 'V', { min: 0, max: 3, step: 0.05, group: 'Driver', help: 'Bipolar L293 ≈ 1.2–1.4 V per side; use ≈ 0.1 V for a MOSFET bridge.' }),
      num('ron', 'Output resistance', 1, 'Ω', { min: 0.001, max: 100, log: true, group: 'Driver' }),
      bool('clampDiodes', 'Clamp diodes', true, { group: 'Driver', help: 'Freewheeling diodes from each output to VS and ground (L293D).' }),
      num('maxCurrent', 'Rated output current', 1, 'A', { min: 0.01, max: 50, log: true, group: 'Driver', help: 'Above this the state flags over-drive.' }),
    ],
    pins: [pin('EN', -3, -2), pin('IN1', -3, 0), pin('IN2', -3, 2), pin('OUT1', 3, -1), pin('OUT2', 3, 1), pin('VS', 0, -3)],
    size: { w: 6, h: 6, ox: -3, oy: -3 },
  },

  // ------------------------------------------------------------------ Passive
  {
    type: 'passive.resistor', label: 'Resistor', category: 'Passive',
    description: 'Ohmic resistor, V = I·R. Flags overheating when the dissipated power exceeds its rating.',
    params: [
      num('resistance', 'Resistance', 1000, 'Ω', { ...R_OPTS, group: 'Electrical' }),
      num('powerRating', 'Power rating', 0.25, 'W', { min: 0.01, max: 1000, log: true, group: 'Electrical' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'passive.potentiometer', label: 'Potentiometer', category: 'Passive',
    description: 'Three-terminal variable resistor. The wiper W divides the track A–B: R(A–W) = position·R, R(W–B) = (1 − position)·R.',
    params: [
      num('resistance', 'Track resistance', 10000, 'Ω', { ...R_OPTS, min: 1, group: 'Electrical' }),
      num('position', 'Wiper position', 0.5, '', { min: 0, max: 1, step: 0.01, group: 'Electrical', help: '0 = wiper at A, 1 = wiper at B.' }),
      sel('taper', 'Taper', 'linear', [['linear', 'Linear (B)'], ['log', 'Logarithmic (A)']], { group: 'Electrical' }),
    ],
    pins: [pin('A', -2, 0), pin('B', 2, 0), pin('W', 0, -2)], size: { w: 4, h: 3, ox: -2, oy: -2 }, interactive: true,
  },
  {
    type: 'passive.capacitor', label: 'Capacitor', category: 'Passive',
    description: 'Capacitor, i = C·dv/dt, with optional equivalent series resistance. The electrolytic option is polarized (pin A positive) and flags reverse bias or over-voltage.',
    params: [
      num('capacitance', 'Capacitance', 1e-6, 'F', { ...C_OPTS, group: 'Electrical' }),
      num('esr', 'ESR', 0, 'Ω', { min: 0, max: 100, step: 0.01, group: 'Electrical' }),
      bool('polarized', 'Electrolytic (polarized)', false, { group: 'Electrical' }),
      num('maxVoltage', 'Voltage rating', 50, 'V', { min: 1, max: 5000, log: true, group: 'Electrical' }),
      num('initialVoltage', 'Initial voltage', 0, 'V', { min: -1000, max: 1000, step: 0.1, group: 'Electrical' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'passive.inductor', label: 'Inductor', category: 'Passive',
    description: 'Inductor, v = L·di/dt, with DC winding resistance (DCR).',
    params: [
      num('inductance', 'Inductance', 1e-3, 'H', { ...L_OPTS, group: 'Electrical' }),
      num('dcr', 'DC resistance', 0.1, 'Ω', { min: 0, max: 1e4, step: 0.01, group: 'Electrical' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'passive.transformer', label: 'Transformer', category: 'Passive',
    description: 'Two magnetically coupled windings: primary inductance Lp, turns ratio Np:Ns, coupling coefficient k and winding resistances. Ls = Lp/ratio², M = k·√(Lp·Ls). Dots at P1 and S1.',
    params: [
      num('lp', 'Primary inductance', 1, 'H', { ...L_OPTS, group: 'Electrical' }),
      num('ratio', 'Turns ratio Np/Ns', 10, '', { min: 0.01, max: 1000, log: true, group: 'Electrical', help: '10 means a 10:1 step-down.' }),
      num('k', 'Coupling coefficient', 0.99, '', { min: 0, max: 0.9999, step: 0.001, group: 'Electrical' }),
      num('rp', 'Primary resistance', 1, 'Ω', { min: 0, max: 1e4, step: 0.01, group: 'Electrical' }),
      num('rs', 'Secondary resistance', 0.1, 'Ω', { min: 0, max: 1e4, step: 0.01, group: 'Electrical' }),
    ],
    pins: [pin('P1', -2, -2), pin('P2', -2, 2), pin('S1', 2, -2), pin('S2', 2, 2)], size: SZ4,
  },
  {
    type: 'passive.thermistor', label: 'Thermistor (NTC)', category: 'Passive',
    description: 'Negative-temperature-coefficient thermistor (beta model): R(T) = R25 · exp(B · (1/T − 1/298.15 K)), so the resistance falls as it gets warmer. Set the ambient temperature, or enable self-heating to let the dissipated power warm the bead (inrush limiters, flow sensors).',
    params: [
      num('r25', 'Resistance at 25 °C', 10000, 'Ω', { ...R_OPTS, group: 'Electrical' }),
      num('beta', 'Beta constant B', 3950, 'K', { min: 500, max: 8000, step: 10, group: 'Electrical' }),
      num('temperature', 'Ambient temperature', 25, '°C', { min: -55, max: 300, step: 0.5, group: 'Thermal' }),
      bool('selfHeating', 'Self-heating', false, { group: 'Thermal', help: 'Body temperature = ambient + power / dissipation constant, reached with the thermal time constant.' }),
      num('dissipation', 'Dissipation constant', 0.002, 'W/K', { min: 1e-5, max: 1, log: true, group: 'Thermal' }),
      num('tau', 'Thermal time constant', 5, 's', { min: 0.01, max: 300, log: true, group: 'Thermal' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'passive.fuse', label: 'Fuse', category: 'Passive',
    description: 'Fuse with an I²t characteristic: a small resistance that heats up with the square of the current and melts (opens permanently) once a sustained current exceeds ≈ 1.35× its rating — a large overload blows it after I²·t ≈ the melting integral, a small one after a long time. Click it while simulating to fit a new fuse.',
    params: [
      num('rating', 'Rated current', 0.5, 'A', { min: 0.001, max: 100, log: true, group: 'Electrical' }),
      num('i2t', 'Melting integral I²t', 0.05, 'A²s', { min: 1e-8, max: 1e4, log: true, group: 'Electrical', help: 'Small = fast-acting, large = slow-blow. Time to blow at a large overload I ≈ I²t / I².' }),
      num('resistance', 'Cold resistance', 0.05, 'Ω', { min: 1e-4, max: 100, log: true, group: 'Electrical' }),
      bool('blown', 'Blown', false, { group: 'State' }),
    ],
    pins: TWO('A', 'B'), size: SZ2, interactive: true,
  },

  // ------------------------------------------------------------------ Semiconductors
  {
    type: 'semi.diode', label: 'Diode', category: 'Semiconductors',
    description: 'Silicon PN diode (Shockley equation with emission coefficient and series resistance; defaults ≈ 1N4148). Conducts from anode A to cathode K above ≈ 0.6–0.7 V.',
    params: [
      num('is', 'Saturation current Is', 2.5e-9, 'A', { min: 1e-16, max: 1e-3, log: true, group: 'Model' }),
      num('n', 'Emission coefficient n', 1.75, '', { min: 0.5, max: 5, step: 0.01, group: 'Model' }),
      num('rs', 'Series resistance', 0.5, 'Ω', { min: 0.001, max: 100, log: true, group: 'Model' }),
      num('bv', 'Reverse breakdown', 100, 'V', { min: 0, max: 5000, group: 'Model', help: '0 disables breakdown.' }),
    ],
    pins: TWO('A', 'K'), size: SZ2,
  },
  {
    type: 'semi.zener', label: 'Zener Diode', category: 'Semiconductors',
    description: 'Zener diode: normal forward conduction, sharp reverse breakdown at Vz (specified at the test current Izt). Use reverse-biased as a voltage reference/clamp.',
    params: [
      num('vz', 'Zener voltage Vz', 5.1, 'V', { min: 1, max: 200, step: 0.1, group: 'Model' }),
      num('izt', 'Test current Izt', 0.005, 'A', { min: 1e-5, max: 1, log: true, group: 'Model' }),
      num('is', 'Saturation current Is', 1e-14, 'A', { min: 1e-16, max: 1e-6, log: true, group: 'Model' }),
      num('n', 'Emission coefficient n', 1, '', { min: 0.5, max: 5, step: 0.01, group: 'Model' }),
      num('rs', 'Series resistance', 1, 'Ω', { min: 0.001, max: 100, log: true, group: 'Model' }),
    ],
    pins: TWO('A', 'K'), size: SZ2,
  },
  {
    type: 'semi.led', label: 'LED', category: 'Semiconductors',
    description: 'Light-emitting diode. The colour sets the forward voltage and wavelength. Brightness follows current relative to the rated current; emitted optical power = efficiency × electrical power. Can be linked to an optical source.',
    params: [
      sel('color', 'Colour', 'red', LED_COLOR_OPTIONS, { group: 'Optical' }),
      num('ratedCurrent', 'Rated current', 0.02, 'A', { min: 0.0005, max: 5, log: true, group: 'Electrical', help: 'Current for full brightness.' }),
      num('efficiency', 'Wall-plug efficiency', 0, '', { min: 0, max: 1, step: 0.01, group: 'Optical', help: '0 = use the typical value for the colour.' }),
      num('rs', 'Series resistance', 3, 'Ω', { min: 0.01, max: 100, log: true, group: 'Electrical' }),
    ],
    pins: TWO('A', 'K'), size: SZ2,
  },
  {
    type: 'semi.npn', label: 'NPN Transistor', category: 'Semiconductors',
    description: 'NPN bipolar junction transistor (Ebers–Moll transport model with Early effect). Collector current ≈ β × base current in the active region; saturates with Vce ≈ 0.1–0.2 V.',
    params: BJT_PARAMS,
    pins: [pin('B', -2, 0), pin('C', 2, -2), pin('E', 2, 2)], size: SZ4,
  },
  {
    type: 'semi.pnp', label: 'PNP Transistor', category: 'Semiconductors',
    description: 'PNP bipolar junction transistor (Ebers–Moll transport model with Early effect). Conducts when the base is pulled ≈ 0.7 V below the emitter.',
    params: BJT_PARAMS,
    pins: [pin('B', -2, 0), pin('C', 2, -2), pin('E', 2, 2)], size: SZ4,
  },
  {
    type: 'semi.nmos', label: 'N-MOSFET', category: 'Semiconductors',
    description: 'N-channel enhancement MOSFET (Shichman–Hodges square-law model). Conducts drain→source when Vgs exceeds the threshold. Body tied to source.',
    params: MOS_PARAMS(2),
    pins: [pin('G', -2, 0), pin('D', 2, -2), pin('S', 2, 2)], size: SZ4,
  },
  {
    type: 'semi.pmos', label: 'P-MOSFET', category: 'Semiconductors',
    description: 'P-channel enhancement MOSFET (Shichman–Hodges square-law model). Conducts source→drain when the gate is pulled below the source by more than the threshold.',
    params: MOS_PARAMS(2),
    pins: [pin('G', -2, 0), pin('D', 2, -2), pin('S', 2, 2)], size: SZ4,
  },

  // ------------------------------------------------------------------ Switches
  {
    type: 'switch.spst', label: 'Switch (SPST)', category: 'Switches',
    description: 'Single-pole single-throw toggle switch. Click to open/close while simulating.',
    params: [bool('closed', 'Closed', false, { group: 'State' }), ...SWITCH_R],
    pins: TWO('A', 'B'), size: SZ2, interactive: true,
  },
  {
    type: 'switch.spdt', label: 'Switch (SPDT)', category: 'Switches',
    description: 'Single-pole double-throw changeover switch: COM connects to A or to B.',
    params: [sel('position', 'Position', 'A', [['A', 'COM–A'], ['B', 'COM–B']], { group: 'State' }), ...SWITCH_R],
    pins: [pin('COM', -2, 0), pin('A', 2, -1), pin('B', 2, 1)], size: SZ4, interactive: true,
  },
  {
    type: 'switch.push', label: 'Push Button', category: 'Switches',
    description: 'Momentary push button: conducts only while pressed (or opens while pressed if normally-closed).',
    params: [bool('normallyClosed', 'Normally closed', false, { group: 'State' }), ...SWITCH_R],
    pins: TWO('A', 'B'), size: SZ2, interactive: true,
  },
  {
    type: 'switch.relay', label: 'Relay (SPDT)', category: 'Switches',
    description: 'Electromechanical relay: an inductive coil (C1–C2) pulls the changeover contact from NC to NO above the pull-in current and releases below the drop-out current (hysteresis).',
    params: [
      num('coilResistance', 'Coil resistance', 70, 'Ω', { min: 1, max: 1e5, log: true, group: 'Coil' }),
      num('coilInductance', 'Coil inductance', 0.05, 'H', { ...L_OPTS, group: 'Coil' }),
      num('pullIn', 'Pull-in current', 0.045, 'A', { min: 1e-4, max: 10, log: true, group: 'Coil' }),
      num('dropOut', 'Drop-out current', 0.012, 'A', { min: 1e-5, max: 10, log: true, group: 'Coil' }),
      ...SWITCH_R.map((p) => ({ ...p, group: 'Contacts' })),
    ],
    pins: [pin('C1', -2, -2), pin('C2', -2, 2), pin('NO', 2, -2), pin('COM', 2, 0), pin('NC', 2, 2)],
    size: { w: 4, h: 6, ox: -2, oy: -3 },
  },

  // ------------------------------------------------------------------ Displays
  {
    type: 'display.7seg', label: '7-Segment Display', category: 'Displays',
    description: 'Seven-segment LED digit with decimal point: eight LEDs sharing a common cathode or common anode pin. Each segment needs its own series resistor.',
    params: [
      sel('common', 'Common pin', 'cathode', [['cathode', 'Common cathode'], ['anode', 'Common anode']], { group: 'Electrical' }),
      sel('color', 'Colour', 'red', LED_COLOR_OPTIONS, { group: 'Optical' }),
      num('ratedCurrent', 'Rated segment current', 0.01, 'A', { min: 0.0005, max: 0.1, log: true, group: 'Electrical' }),
    ],
    pins: [...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((n, i) => pin(n, -3, -4 + i)), pin('COM', 3, 0)],
    size: { w: 6, h: 9, ox: -3, oy: -5 },
  },
  {
    type: 'display.matrix', label: 'LED Matrix 8×8', category: 'Displays',
    description: '8×8 LED dot matrix. Each LED sits between a row pin and a column pin (row = anode by default). Drive rows high and columns low through resistors; multiplex for patterns.',
    params: [
      sel('polarity', 'Polarity', 'row-anode', [['row-anode', 'Rows = anodes'], ['col-anode', 'Columns = anodes']], { group: 'Electrical' }),
      sel('color', 'Colour', 'red', LED_COLOR_OPTIONS, { group: 'Optical' }),
      num('ratedCurrent', 'Rated LED current', 0.01, 'A', { min: 0.0005, max: 0.1, log: true, group: 'Electrical' }),
    ],
    pins: [
      ...Array.from({ length: 8 }, (_, i) => pin(`R${i + 1}`, -5, -4 + i)),
      ...Array.from({ length: 8 }, (_, i) => pin(`C${i + 1}`, -4 + i, 5)),
    ],
    size: { w: 10, h: 10, ox: -5, oy: -5 },
  },

  // ------------------------------------------------------------------ Meters
  {
    type: 'meter.voltmeter', label: 'Voltmeter', category: 'Meters',
    description: 'Measures the voltage between its pins. Very high input resistance (10 MΩ by default) — connect in parallel.',
    params: [num('resistance', 'Input resistance', 1e7, 'Ω', { min: 1e3, max: 1e12, log: true, group: 'Electrical' })],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'meter.ammeter', label: 'Ammeter', category: 'Meters',
    description: 'Measures the current flowing from + to − through it. Very low shunt resistance — connect in series.',
    params: [num('resistance', 'Shunt resistance', 0.001, 'Ω', { min: 1e-5, max: 10, log: true, group: 'Electrical' })],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'meter.probe', label: 'Scope Probe', category: 'Meters',
    description: 'Oscilloscope probe: records the node voltage (relative to ground) into a rolling 2000-sample buffer for the scope panel.',
    params: [
      num('window', 'Time window', 0.05, 's', { min: 1e-4, max: 60, log: true, group: 'Scope', help: 'Length of history kept (2000 samples span this window).' }),
      { key: 'color', label: 'Trace colour', kind: 'color', default: '#ffd21a', group: 'Scope' },
    ],
    pins: [pin('IN', 0, 0)], size: { w: 2, h: 2, ox: 0, oy: -1 },
  },

  // ------------------------------------------------------------------ Digital
  gate('digital.and', 'AND Gate', '2-input AND gate: Y is high only when A and B are high. Implied supply (see Logic params).'),
  gate('digital.or', 'OR Gate', '2-input OR gate: Y is high when A or B is high. Implied supply.'),
  {
    type: 'digital.not', label: 'NOT Gate (Inverter)', category: 'Digital',
    description: 'Inverter: Y is the complement of A. Implied supply.',
    params: DIGITAL_PARAMS,
    pins: TWO('A', 'Y'), size: SZ2,
  },
  gate('digital.nand', 'NAND Gate', '2-input NAND gate: Y is low only when A and B are high. Implied supply.'),
  gate('digital.xor', 'XOR Gate', '2-input XOR gate: Y is high when exactly one input is high. Implied supply.'),
  {
    type: 'digital.counter', label: '4-bit Counter', category: 'Digital',
    description: '4-bit synchronous binary counter: increments on each rising CLK edge, asynchronous active-high reset. Set modulus to 10 for a decade (BCD) counter.',
    params: [
      num('modulus', 'Modulus', 16, '', { min: 2, max: 16, step: 1, group: 'Logic', help: 'Counter wraps to 0 after modulus − 1.' }),
      ...DIGITAL_PARAMS,
    ],
    pins: [pin('CLK', -3, -1), pin('RST', -3, 1), pin('Q0', 3, -3), pin('Q1', 3, -1), pin('Q2', 3, 1), pin('Q3', 3, 3)],
    size: { w: 6, h: 8, ox: -3, oy: -4 },
  },
  {
    type: 'digital.bcd7seg', label: 'BCD → 7-Segment Decoder', category: 'Digital',
    description: 'BCD to seven-segment decoder/driver (CD4511-style): inputs A (LSB)…D, outputs a…g. Values above 9 blank the display. Active-high outputs drive a common-cathode display through resistors; enable active-low for common-anode.',
    params: [
      bool('activeLow', 'Active-low outputs', false, { group: 'Logic', help: 'For common-anode displays (7447-style).' }),
      ...DIGITAL_PARAMS,
    ],
    pins: [
      pin('A', -3, -3), pin('B', -3, -1), pin('C', -3, 1), pin('D', -3, 3),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => pin(n, 3, -3 + i)),
    ],
    size: { w: 6, h: 8, ox: -3, oy: -4 },
  },
  {
    type: 'ic.shift595', label: 'Shift Register (74HC595)', category: 'Digital',
    description: '8-bit serial-in / parallel-out shift register with output latch. Each rising edge of SRCLK shifts SER into bit Q0 (the old bits move towards Q7); a rising edge of RCLK copies the shift register to the outputs Q0…Q7. Q7S is the serial output for cascading. OE (active-low, unconnected = enabled) switches the outputs to high-impedance; SRCLR (active-low, unconnected = inactive) clears the shift register. Implied supply.',
    params: DIGITAL_PARAMS,
    pins: [
      pin('SER', -3, -4), pin('SRCLK', -3, -2), pin('RCLK', -3, 0), pin('OE', -3, 2), pin('SRCLR', -3, 4),
      ...Array.from({ length: 8 }, (_, i) => pin(`Q${i}`, 3, -4 + i)), pin('Q7S', 3, 4),
    ],
    size: { w: 6, h: 10, ox: -3, oy: -5 },
  },
  {
    type: 'ic.decoder138', label: '3-to-8 Decoder (74HC138)', category: 'Digital',
    description: '3-to-8 line decoder / demultiplexer: the binary address C·B·A (A = LSB) selects one of the outputs Y0…Y7, which goes LOW while all others stay high. Enabled when G1 is high (unconnected = high) and G2A, G2B are low (unconnected = low); otherwise all outputs are high. Ideal for scanning display rows / columns. Implied supply.',
    params: DIGITAL_PARAMS,
    pins: [
      pin('A', -3, -4), pin('B', -3, -3), pin('C', -3, -2), pin('G1', -3, 0), pin('G2A', -3, 1), pin('G2B', -3, 2),
      ...Array.from({ length: 8 }, (_, i) => pin(`Y${i}`, 3, -4 + i)),
    ],
    size: { w: 6, h: 9, ox: -3, oy: -5 },
  },

  // ------------------------------------------------------------------ Misc
  {
    type: 'misc.lamp', label: 'Incandescent Lamp', category: 'Misc',
    description: 'Tungsten filament lamp: the resistance rises ≈ 14× from cold to operating temperature (inrush current), with a thermal time constant. Burns out if grossly over-driven.',
    params: [
      num('ratedVoltage', 'Rated voltage', 6, 'V', { min: 0.5, max: 400, step: 0.1, group: 'Electrical' }),
      num('ratedPower', 'Rated power', 0.6, 'W', { min: 0.01, max: 1000, log: true, group: 'Electrical' }),
      num('tau', 'Thermal time constant', 0.04, 's', { min: 0.002, max: 2, log: true, group: 'Thermal' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'misc.buzzer', label: 'Buzzer', category: 'Misc',
    description: 'Active buzzer with a built-in oscillator: sounds at its tone frequency whenever the + pin is driven above the minimum voltage.',
    params: [
      num('ratedVoltage', 'Rated voltage', 5, 'V', { min: 1, max: 48, step: 0.1, group: 'Electrical' }),
      num('ratedCurrent', 'Rated current', 0.025, 'A', { min: 0.001, max: 1, log: true, group: 'Electrical' }),
      num('minVoltage', 'Minimum operating voltage', 1.5, 'V', { min: 0.1, max: 48, step: 0.1, group: 'Electrical' }),
      num('frequency', 'Tone frequency', 2300, 'Hz', { min: 50, max: 10000, log: true, group: 'Sound' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'misc.motor', label: 'DC Motor', category: 'Electromechanical',
    description: 'Permanent-magnet DC motor: armature resistance and inductance in series with the back-EMF Ke·ω; the torque Kt·i (Kt = Ke) accelerates the rotor inertia against viscous friction and a constant load torque. No-load speed ≈ V/Ke, stall current = V/R. Reversing the voltage reverses the rotation; spinning the shaft makes it a generator.',
    params: [
      num('resistance', 'Armature resistance', 8, 'Ω', { min: 0.01, max: 1000, log: true, group: 'Electrical' }),
      num('inductance', 'Armature inductance', 5e-3, 'H', { ...L_OPTS, group: 'Electrical' }),
      num('k', 'Motor constant Ke = Kt', 0.01, 'V·s/rad', { min: 1e-5, max: 10, log: true, group: 'Electrical', help: 'Back-EMF constant in V per rad/s, identical to the torque constant in N·m/A.' }),
      num('inertia', 'Rotor inertia J', 2e-6, 'kg·m²', { min: 1e-9, max: 1, log: true, group: 'Mechanical' }),
      num('friction', 'Viscous friction b', 1e-6, 'N·m·s/rad', { min: 0, max: 1, step: 1e-7, group: 'Mechanical' }),
      num('loadTorque', 'Load torque', 0, 'N·m', { min: 0, max: 100, step: 1e-4, group: 'Mechanical', help: 'Constant torque opposing the rotation (also holds the rotor at standstill until the motor torque exceeds it).' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'misc.servo', label: 'Servo Motor', category: 'Electromechanical',
    description: 'Hobby position servo. PWM mode: the pulse width on SIG, repeated every ≈ 20 ms, sets the horn angle (1 ms → 0°, 1.5 ms → centre, 2 ms → full range). DC mode: the angle follows the control voltage on SIG (0 V → 0°, control voltage → full range), like a galvo driver. The horn moves at a limited angular speed and only while the supply (V+ to GND) is present. Link it to an optical component (actuator link, target "rotation") to steer a mirror.',
    params: [
      sel('mode', 'Control', 'pwm', [['pwm', 'PWM pulses (1–2 ms @ 50 Hz)'], ['dc', 'DC control voltage']], { group: 'Control' }),
      num('range', 'Angle range', 180, '°', { min: 1, max: 360, step: 1, group: 'Control', help: 'Travel between the minimum and maximum command.' }),
      num('speed', 'Speed', 600, '°/s', { min: 1, max: 100000, log: true, group: 'Control', help: 'Maximum angular speed (0.1 s per 60° = 600 °/s).' }),
      num('initialAngle', 'Initial angle', 90, '°', { min: 0, max: 360, step: 1, group: 'Control' }),
      num('minPulse', 'Pulse width at 0°', 1e-3, 's', { min: 1e-4, max: 5e-3, step: 1e-5, group: 'PWM' }),
      num('maxPulse', 'Pulse width at full range', 2e-3, 's', { min: 2e-4, max: 1e-2, step: 1e-5, group: 'PWM' }),
      num('controlVoltage', 'Control voltage at full range', 5, 'V', { min: 0.1, max: 30, step: 0.1, group: 'DC control' }),
      num('minVoltage', 'Minimum supply voltage', 3, 'V', { min: 0, max: 24, step: 0.1, group: 'Electrical' }),
      num('idleCurrent', 'Idle current', 0.008, 'A', { min: 0, max: 1, step: 0.001, group: 'Electrical' }),
      num('runCurrent', 'Additional current while moving', 0.15, 'A', { min: 0, max: 5, step: 0.01, group: 'Electrical' }),
    ],
    pins: [pin('V+', 0, -2), pin('GND', 0, 2), pin('SIG', -2, 0)], size: SZ4,
  },

  // ------------------------------------------------------------------ Opto-electronic
  {
    type: 'opto.photodiode', label: 'Photodiode', category: 'Opto-electronic',
    description: 'PN photodiode: photocurrent I = responsivity × optical power (plus dark current) flows from cathode to anode inside the device, in parallel with the diode junction. Link it to an optical detector, or set the manual illumination.',
    params: [
      num('responsivity', 'Responsivity', 0.5, 'A/W', { min: 0.01, max: 1.2, step: 0.01, group: 'Optical' }),
      num('darkCurrent', 'Dark current', 2e-9, 'A', { min: 1e-13, max: 1e-5, log: true, group: 'Optical' }),
      num('illumination', 'Manual illumination', 0, 'W', { min: 0, max: 1, step: 1e-5, group: 'Optical', help: 'Used until a linked optical detector supplies the incident power.' }),
      num('is', 'Saturation current Is', 1e-10, 'A', { min: 1e-15, max: 1e-6, log: true, group: 'Model' }),
      num('n', 'Emission coefficient n', 1.3, '', { min: 0.5, max: 5, step: 0.01, group: 'Model' }),
      num('rs', 'Series resistance', 5, 'Ω', { min: 0.01, max: 1000, log: true, group: 'Model' }),
    ],
    pins: TWO('A', 'K'), size: SZ2,
  },
  {
    type: 'opto.ldr', label: 'Photoresistor (LDR)', category: 'Opto-electronic',
    description: 'Light-dependent resistor: R = R_ref·(P/P_ref)^−γ, limited between the dark and minimum resistance, with a slow (CdS-like) response time.',
    params: [
      num('rDark', 'Dark resistance', 1e6, 'Ω', { min: 1e3, max: 1e9, log: true, group: 'Optical' }),
      num('rRef', 'Resistance at P_ref', 5000, 'Ω', { min: 1, max: 1e7, log: true, group: 'Optical' }),
      num('pRef', 'Reference power P_ref', 1e-4, 'W', { min: 1e-9, max: 1, log: true, group: 'Optical' }),
      num('gamma', 'Gamma γ', 0.7, '', { min: 0.1, max: 2, step: 0.01, group: 'Optical' }),
      num('rMin', 'Minimum resistance', 100, 'Ω', { min: 1, max: 1e5, log: true, group: 'Optical' }),
      num('tau', 'Response time', 0.03, 's', { min: 1e-4, max: 5, log: true, group: 'Optical' }),
      num('illumination', 'Manual illumination', 0, 'W', { min: 0, max: 1, step: 1e-5, group: 'Optical', help: 'Used until a linked optical detector supplies the incident power.' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
  {
    type: 'opto.solar_cell', label: 'Solar Cell', category: 'Opto-electronic',
    description: 'Photovoltaic cell/panel (single-diode model): photocurrent ∝ incident optical power, in parallel with the junction diode and shunt resistance, behind a series resistance. Produces the classic I–V curve with a maximum power point.',
    params: [
      num('voc', 'Open-circuit voltage (at P_ref)', 2.4, 'V', { min: 0.3, max: 100, step: 0.1, group: 'Electrical' }),
      num('isc', 'Short-circuit current (at P_ref)', 0.05, 'A', { min: 1e-5, max: 20, log: true, group: 'Electrical' }),
      num('pRef', 'Reference optical power P_ref', 0.1, 'W', { min: 1e-6, max: 1000, log: true, group: 'Optical' }),
      num('cells', 'Cells in series', 4, '', { min: 1, max: 200, step: 1, group: 'Electrical' }),
      num('rs', 'Series resistance', 0.5, 'Ω', { min: 0.001, max: 100, log: true, group: 'Electrical' }),
      num('rsh', 'Shunt resistance', 5000, 'Ω', { min: 1, max: 1e7, log: true, group: 'Electrical' }),
      num('illumination', 'Manual illumination', 0.1, 'W', { min: 0, max: 1000, step: 0.001, group: 'Optical', help: 'Used until a linked optical detector supplies the incident power.' }),
    ],
    pins: TWO('+', '-'), size: SZ2,
  },
  {
    type: 'opto.laser_diode', label: 'Laser Diode', category: 'Opto-electronic',
    description: 'Semiconductor laser: a diode that emits coherent light above its threshold current, P = slope efficiency × (I − Ith). Link it to an optical laser source to drive the beam from the circuit.',
    params: [
      num('threshold', 'Threshold current Ith', 0.02, 'A', { min: 1e-4, max: 5, log: true, group: 'Optical' }),
      num('slope', 'Slope efficiency', 0.8, 'W/A', { min: 0.01, max: 2, step: 0.01, group: 'Optical' }),
      num('wavelength', 'Wavelength', 650, 'nm', { min: 350, max: 1700, step: 1, group: 'Optical' }),
      num('vf', 'Forward voltage (at 2·Ith)', 2.2, 'V', { min: 0.8, max: 6, step: 0.05, group: 'Electrical' }),
      num('rs', 'Series resistance', 4, 'Ω', { min: 0.01, max: 100, log: true, group: 'Electrical' }),
      num('maxCurrent', 'Maximum current', 0.08, 'A', { min: 1e-3, max: 20, log: true, group: 'Electrical', help: 'Above this the state flags over-drive.' }),
    ],
    pins: TWO('A', 'K'), size: SZ2,
  },
  {
    type: 'opto.coil', label: 'Electromagnet Coil', category: 'Opto-electronic',
    description: 'Solenoid electromagnet: an inductor with winding resistance. Reports the axial field B = µ0·µr·N·I / length, which can drive a Faraday rotator or isolator on the optical bench.',
    params: [
      num('inductance', 'Inductance', 0.01, 'H', { ...L_OPTS, group: 'Electrical' }),
      num('resistance', 'Winding resistance', 8, 'Ω', { min: 0.01, max: 1e4, log: true, group: 'Electrical' }),
      num('turns', 'Turns N', 500, '', { min: 1, max: 100000, log: true, group: 'Magnetic' }),
      num('length', 'Coil length', 0.05, 'm', { min: 0.001, max: 1, log: true, group: 'Magnetic' }),
      num('mur', 'Core relative permeability', 1, '', { min: 1, max: 10000, log: true, group: 'Magnetic' }),
    ],
    pins: TWO('A', 'B'), size: SZ2,
  },
];

export const registryMap: Map<string, CircuitComponentDef> = new Map(registry.map((d) => [d.type, d]));

// ---------------------------------------------------------------------------------------------
// component helpers
// ---------------------------------------------------------------------------------------------

const PREFIX: Record<string, string> = {
  'source.battery': 'BT', 'source.psu': 'PS', 'source.ac': 'V', 'source.function_gen': 'FG', 'source.current': 'I',
  'misc.ground': 'GND', 'osc.crystal': 'X', 'ic.555': 'U',
  'passive.resistor': 'R', 'passive.potentiometer': 'RV', 'passive.capacitor': 'C', 'passive.inductor': 'L', 'passive.transformer': 'T',
  'semi.diode': 'D', 'semi.zener': 'ZD', 'semi.led': 'LED', 'semi.npn': 'Q', 'semi.pnp': 'Q', 'semi.nmos': 'M', 'semi.pmos': 'M',
  'switch.spst': 'SW', 'switch.spdt': 'SW', 'switch.push': 'SW', 'switch.relay': 'K',
  'display.7seg': 'DS', 'display.matrix': 'DS',
  'meter.voltmeter': 'VM', 'meter.ammeter': 'AM', 'meter.probe': 'TP',
  'digital.and': 'U', 'digital.or': 'U', 'digital.not': 'U', 'digital.nand': 'U', 'digital.xor': 'U', 'digital.counter': 'U', 'digital.bcd7seg': 'U',
  'misc.lamp': 'LA', 'misc.buzzer': 'BZ',
  'opto.photodiode': 'PD', 'opto.ldr': 'LDR', 'opto.solar_cell': 'SC', 'opto.laser_diode': 'LD', 'opto.coil': 'EM',
  'source.clock': 'CLK', 'ic.opamp': 'U', 'ic.comparator': 'U', 'ic.regulator': 'U', 'ic.shift595': 'U', 'ic.decoder138': 'U', 'ic.hbridge': 'U',
  'misc.motor': 'MOT', 'misc.servo': 'SV', 'passive.thermistor': 'TH', 'passive.fuse': 'F',
};

/** Reference-designator prefix for a component type ('R' for resistors, 'C' for capacitors…). */
export function designatorPrefix(type: string): string {
  return PREFIX[type] ?? 'X';
}

export function defaultProps(def: CircuitComponentDef): Record<string, ParamValue> {
  const p: Record<string, ParamValue> = {};
  for (const d of def.params) p[d.key] = d.default;
  return p;
}

const designatorCounters: Record<string, number> = {};
let idCounter = 0;

function randomId(): string {
  idCounter = (idCounter + 1) % 1679616;
  const r = Math.floor(Math.random() * 1679616);
  return (r.toString(36).padStart(4, '0') + idCounter.toString(36)).slice(0, 6);
}

export function createComponent(type: string, position: Vec2): CircuitComponent {
  const def = registryMap.get(type);
  if (!def) throw new Error(`Unknown circuit component type: ${type}`);
  const prefix = designatorPrefix(type);
  designatorCounters[prefix] = (designatorCounters[prefix] ?? 0) + 1;
  return {
    id: `${prefix}_${randomId()}`,
    type,
    name: prefix === 'GND' ? 'GND' : `${prefix}${designatorCounters[prefix]}`,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    rotation: 0,
    props: defaultProps(def),
  };
}

export function getPinDefs(c: CircuitComponent): PinDef[] {
  const def = registryMap.get(c.type);
  if (!def) return [];
  return typeof def.pins === 'function' ? def.pins(c.props ?? {}) : def.pins;
}

/** Transform a local offset by mirroring (x flip first) and `rotation` quarter turns clockwise (+y down). */
export function transformOffset(o: Vec2, rotation: number, mirrored?: boolean): Vec2 {
  let x = mirrored ? -o.x : o.x;
  let y = o.y;
  const r = ((Math.round(rotation) % 4) + 4) % 4;
  for (let i = 0; i < r; i++) {
    const nx = -y;
    y = x;
    x = nx;
  }
  return { x: x + 0, y: y + 0 }; // "+ 0" normalises -0
}

export function getPinPositions(c: CircuitComponent): { name: string; p: Vec2 }[] {
  return getPinDefs(c).map((pd) => {
    const o = transformOffset(pd.offset, c.rotation ?? 0, c.mirrored);
    return { name: pd.name, p: { x: c.position.x + o.x, y: c.position.y + o.y } };
  });
}
