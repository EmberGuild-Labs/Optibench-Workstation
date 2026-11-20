# Circuit components

Generated from the live registry by `node scripts/obw.mjs list-components circuit --md`.

Positions are integer grid units, `rotation` is 0..3 quarter turns clockwise ((x,y) → (−y,x) per turn), `mirrored` flips x before rotating. Pins are listed at rotation 0 as offsets from the component origin; `footprint` is ox,oy,w,h. Use `node scripts/obw.mjs pins <type> <rotation>` for rotated offsets.

## Sources

### `source.battery` — Battery

Electrochemical cell/battery: EMF behind an internal resistance. The stored charge (mAh) drains with the delivered current; the EMF sags as it empties and collapses near 0 %.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `voltage` | 9 | V | 0.1 … 400 | Nominal EMF |
| `internalResistance` | 0.5 | Ω | 0.001 … 100 | Internal resistance |
| `capacity` | 500 | mAh | 0.0001 … 100000 | Total charge when full. Use a tiny value to watch it drain quickly. |
| `initialCharge` | 100 | % | 0 … 100 | Initial charge |

### `source.psu` — Bench Power Supply

Regulated lab supply: constant voltage (CV) until the load current reaches the limit, then constant current (CC) with the voltage folding back. Cannot sink current.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2 · interactive

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `voltage` | 5 | V | 0 … 60 | Set voltage |
| `currentLimit` | 1 | A | 0.001 … 30 | Current limit |
| `outputResistance` | 0.01 | Ω | 0.001 … 10 | Output resistance |
| `on` | true |  | true / false | Output enabled |

### `source.ac` — AC Source

Sinusoidal voltage source v(t) = offset + A·sin(2πft + φ) with optional series resistance.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `amplitude` | 10 | V | 0 … 1000 | Amplitude (peak) |
| `frequency` | 50 | Hz | 0.01 … 1000000 | Frequency |
| `phase` | 0 | ° | -360 … 360 | Phase |
| `offset` | 0 | V | -1000 … 1000 | DC offset |
| `seriesResistance` | 0.1 | Ω | 0 … 10000 | Series resistance |

### `source.function_gen` — Function Generator

Signal generator with sine, square, triangle and sawtooth outputs, DC offset, duty cycle and a 50 Ω output.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `waveform` | "sine" |  | `sine`, `square`, `triangle`, `sawtooth` | Waveform |
| `frequency` | 1000 | Hz | 0.01 … 1000000 | Frequency |
| `amplitude` | 2.5 | V | 0 … 50 | Amplitude (peak) |
| `offset` | 2.5 | V | -50 … 50 | DC offset |
| `duty` | 50 | % | 1 … 99 | Square: high-time fraction. Triangle: rise-time fraction. |
| `phase` | 0 | ° | -360 … 360 | Phase |
| `outputResistance` | 50 | Ω | 0 … 10000 | Output resistance |

### `source.current` — Current Source

Ideal DC current source. Current leaves the + pin, flows through the external circuit and returns at the − pin.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `current` | 0.01 | A | -10 … 10 | Current |

### `misc.ground` — Ground

Reference node (0 V). All ground symbols are connected together.

Pins: `GND@(0,0)` · footprint -1,0,2,1

## Oscillators & ICs

### `osc.crystal` — Crystal Oscillator

Clock oscillator module with a square-wave output. Ideal mode outputs 0…amplitude without needing a supply; otherwise it runs from the VCC/GND pins and swings rail-to-rail. Keep the frequency below ≈ 1/(10·timestep).

Pins: `VCC@(0,-2)` `GND@(0,2)` `OUT@(2,0)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `frequency` | 1000 | Hz | 0.1 … 1000000 | Frequency |
| `duty` | 50 | % | 1 … 99 | Duty cycle |
| `ideal` | true |  | true / false | When on, the output is 0…amplitude relative to the GND pin (or circuit ground if GND is unconnected). |
| `amplitude` | 5 | V | 0.1 … 30 | Amplitude (ideal mode) |
| `rout` | 50 | Ω | 1 … 10000 | Output resistance |

### `ic.555` — 555 Timer

Behavioural NE555: 5k-5k-5k divider, threshold (2/3 Vcc) and trigger (1/3 Vcc) comparators, SR latch, open-collector discharge transistor and a totem-pole output. Works in astable, monostable and Schmitt configurations.

Pins: `GND@(-3,-3)` `TRIG@(-3,-1)` `OUT@(-3,1)` `RESET@(-3,3)` `CTRL@(3,3)` `THR@(3,1)` `DIS@(3,-1)` `VCC@(3,-3)` · footprint -3,-4,6,8

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `variant` | "bipolar" |  | `bipolar`, `cmos` | Bipolar: output high ≈ Vcc − 1.4 V, 3 mA quiescent. CMOS: rail-to-rail, µA quiescent. |
| `rout` | 10 | Ω | 1 … 1000 | Output resistance |
| `rdis` | 10 | Ω | 1 … 1000 | Discharge on-resistance |

## Passive

### `passive.resistor` — Resistor

Ohmic resistor, V = I·R. Flags overheating when the dissipated power exceeds its rating.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `resistance` | 1000 | Ω | 0.1 … 100000000 | Resistance |
| `powerRating` | 0.25 | W | 0.01 … 1000 | Power rating |

### `passive.potentiometer` — Potentiometer

Three-terminal variable resistor. The wiper W divides the track A–B: R(A–W) = position·R, R(W–B) = (1 − position)·R.

Pins: `A@(-2,0)` `B@(2,0)` `W@(0,-2)` · footprint -2,-2,4,3 · interactive

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `resistance` | 10000 | Ω | 1 … 100000000 | Track resistance |
| `position` | 0.5 |  | 0 … 1 | 0 = wiper at A, 1 = wiper at B. |
| `taper` | "linear" |  | `linear`, `log` | Taper |

### `passive.capacitor` — Capacitor

Capacitor, i = C·dv/dt, with optional equivalent series resistance. The electrolytic option is polarized (pin A positive) and flags reverse bias or over-voltage.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `capacitance` | 0.000001 | F | 1e-12 … 1 | Capacitance |
| `esr` | 0 | Ω | 0 … 100 | ESR |
| `polarized` | false |  | true / false | Electrolytic (polarized) |
| `maxVoltage` | 50 | V | 1 … 5000 | Voltage rating |
| `initialVoltage` | 0 | V | -1000 … 1000 | Initial voltage |

### `passive.inductor` — Inductor

Inductor, v = L·di/dt, with DC winding resistance (DCR).

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `inductance` | 0.001 | H | 1e-7 … 100 | Inductance |
| `dcr` | 0.1 | Ω | 0 … 10000 | DC resistance |

### `passive.transformer` — Transformer

Two magnetically coupled windings: primary inductance Lp, turns ratio Np:Ns, coupling coefficient k and winding resistances. Ls = Lp/ratio², M = k·√(Lp·Ls). Dots at P1 and S1.

Pins: `P1@(-2,-2)` `P2@(-2,2)` `S1@(2,-2)` `S2@(2,2)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `lp` | 1 | H | 1e-7 … 100 | Primary inductance |
| `ratio` | 10 |  | 0.01 … 1000 | 10 means a 10:1 step-down. |
| `k` | 0.99 |  | 0 … 0.9999 | Coupling coefficient |
| `rp` | 1 | Ω | 0 … 10000 | Primary resistance |
| `rs` | 0.1 | Ω | 0 … 10000 | Secondary resistance |

## Semiconductors

### `semi.diode` — Diode

Silicon PN diode (Shockley equation with emission coefficient and series resistance; defaults ≈ 1N4148). Conducts from anode A to cathode K above ≈ 0.6–0.7 V.

Pins: `A@(-2,0)` `K@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `is` | 2.5e-9 | A | 1e-16 … 0.001 | Saturation current Is |
| `n` | 1.75 |  | 0.5 … 5 | Emission coefficient n |
| `rs` | 0.5 | Ω | 0.001 … 100 | Series resistance |
| `bv` | 100 | V | 0 … 5000 | 0 disables breakdown. |

### `semi.zener` — Zener Diode

Zener diode: normal forward conduction, sharp reverse breakdown at Vz (specified at the test current Izt). Use reverse-biased as a voltage reference/clamp.

Pins: `A@(-2,0)` `K@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vz` | 5.1 | V | 1 … 200 | Zener voltage Vz |
| `izt` | 0.005 | A | 0.00001 … 1 | Test current Izt |
| `is` | 1e-14 | A | 1e-16 … 0.000001 | Saturation current Is |
| `n` | 1 |  | 0.5 … 5 | Emission coefficient n |
| `rs` | 1 | Ω | 0.001 … 100 | Series resistance |

### `semi.led` — LED

Light-emitting diode. The colour sets the forward voltage and wavelength. Brightness follows current relative to the rated current; emitted optical power = efficiency × electrical power. Can be linked to an optical source.

Pins: `A@(-2,0)` `K@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `color` | "red" |  | `red`, `orange`, `yellow`, `green`, `blue`, `white`, `ir`, `uv` | Colour |
| `ratedCurrent` | 0.02 | A | 0.0005 … 5 | Current for full brightness. |
| `efficiency` | 0 |  | 0 … 1 | 0 = use the typical value for the colour. |
| `rs` | 3 | Ω | 0.01 … 100 | Series resistance |

### `semi.npn` — NPN Transistor

NPN bipolar junction transistor (Ebers–Moll transport model with Early effect). Collector current ≈ β × base current in the active region; saturates with Vce ≈ 0.1–0.2 V.

Pins: `B@(-2,0)` `C@(2,-2)` `E@(2,2)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `beta` | 200 |  | 5 … 2000 | Forward current gain Ic/Ib in the active region. |
| `is` | 1e-14 | A | 1e-18 … 1e-9 | Saturation current Is |
| `vaf` | 100 | V | 0 … 1000 | Output-resistance (Early) voltage. 0 disables the Early effect. |
| `betaR` | 4 |  | 0.1 … 100 | Reverse gain βr |

### `semi.pnp` — PNP Transistor

PNP bipolar junction transistor (Ebers–Moll transport model with Early effect). Conducts when the base is pulled ≈ 0.7 V below the emitter.

Pins: `B@(-2,0)` `C@(2,-2)` `E@(2,2)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `beta` | 200 |  | 5 … 2000 | Forward current gain Ic/Ib in the active region. |
| `is` | 1e-14 | A | 1e-18 … 1e-9 | Saturation current Is |
| `vaf` | 100 | V | 0 … 1000 | Output-resistance (Early) voltage. 0 disables the Early effect. |
| `betaR` | 4 |  | 0.1 … 100 | Reverse gain βr |

### `semi.nmos` — N-MOSFET

N-channel enhancement MOSFET (Shichman–Hodges square-law model). Conducts drain→source when Vgs exceeds the threshold. Body tied to source.

Pins: `G@(-2,0)` `D@(2,-2)` `S@(2,2)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vth` | 2 | V | 0.1 … 10 | Magnitude of the gate threshold (enhancement mode). |
| `k` | 0.5 | A/V² | 0.00001 … 100 | Id(sat) = K/2 · (Vgs − Vth)² · (1 + λ·Vds) |
| `lambda` | 0.01 | 1/V | 0 … 0.5 | Channel-length modulation λ |
| `bodyDiode` | true |  | true / false | Intrinsic source-drain diode of a discrete power MOSFET. |

### `semi.pmos` — P-MOSFET

P-channel enhancement MOSFET (Shichman–Hodges square-law model). Conducts source→drain when the gate is pulled below the source by more than the threshold.

Pins: `G@(-2,0)` `D@(2,-2)` `S@(2,2)` · footprint -2,-2,4,4

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vth` | 2 | V | 0.1 … 10 | Magnitude of the gate threshold (enhancement mode). |
| `k` | 0.5 | A/V² | 0.00001 … 100 | Id(sat) = K/2 · (Vgs − Vth)² · (1 + λ·Vds) |
| `lambda` | 0.01 | 1/V | 0 … 0.5 | Channel-length modulation λ |
| `bodyDiode` | true |  | true / false | Intrinsic source-drain diode of a discrete power MOSFET. |

## Switches

### `switch.spst` — Switch (SPST)

Single-pole single-throw toggle switch. Click to open/close while simulating.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2 · interactive

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `closed` | false |  | true / false | Closed |
| `ron` | 0.01 | Ω | 0.0001 … 100 | On resistance |
| `roff` | 1000000000 | Ω | 1000 … 1000000000000 | Off resistance |

### `switch.spdt` — Switch (SPDT)

Single-pole double-throw changeover switch: COM connects to A or to B.

Pins: `COM@(-2,0)` `A@(2,-1)` `B@(2,1)` · footprint -2,-2,4,4 · interactive

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `position` | "A" |  | `A`, `B` | Position |
| `ron` | 0.01 | Ω | 0.0001 … 100 | On resistance |
| `roff` | 1000000000 | Ω | 1000 … 1000000000000 | Off resistance |

### `switch.push` — Push Button

Momentary push button: conducts only while pressed (or opens while pressed if normally-closed).

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2 · interactive

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `normallyClosed` | false |  | true / false | Normally closed |
| `ron` | 0.01 | Ω | 0.0001 … 100 | On resistance |
| `roff` | 1000000000 | Ω | 1000 … 1000000000000 | Off resistance |

### `switch.relay` — Relay (SPDT)

Electromechanical relay: an inductive coil (C1–C2) pulls the changeover contact from NC to NO above the pull-in current and releases below the drop-out current (hysteresis).

Pins: `C1@(-2,-2)` `C2@(-2,2)` `NO@(2,-2)` `COM@(2,0)` `NC@(2,2)` · footprint -2,-3,4,6

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `coilResistance` | 70 | Ω | 1 … 100000 | Coil resistance |
| `coilInductance` | 0.05 | H | 1e-7 … 100 | Coil inductance |
| `pullIn` | 0.045 | A | 0.0001 … 10 | Pull-in current |
| `dropOut` | 0.012 | A | 0.00001 … 10 | Drop-out current |
| `ron` | 0.01 | Ω | 0.0001 … 100 | On resistance |
| `roff` | 1000000000 | Ω | 1000 … 1000000000000 | Off resistance |

## Displays

### `display.7seg` — 7-Segment Display

Seven-segment LED digit with decimal point: eight LEDs sharing a common cathode or common anode pin. Each segment needs its own series resistor.

Pins: `a@(-3,-4)` `b@(-3,-3)` `c@(-3,-2)` `d@(-3,-1)` `e@(-3,0)` `f@(-3,1)` `g@(-3,2)` `dp@(-3,3)` `COM@(3,0)` · footprint -3,-5,6,9

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `common` | "cathode" |  | `cathode`, `anode` | Common pin |
| `color` | "red" |  | `red`, `orange`, `yellow`, `green`, `blue`, `white`, `ir`, `uv` | Colour |
| `ratedCurrent` | 0.01 | A | 0.0005 … 0.1 | Rated segment current |

### `display.matrix` — LED Matrix 8×8

8×8 LED dot matrix. Each LED sits between a row pin and a column pin (row = anode by default). Drive rows high and columns low through resistors; multiplex for patterns.

Pins: `R1@(-5,-4)` `R2@(-5,-3)` `R3@(-5,-2)` `R4@(-5,-1)` `R5@(-5,0)` `R6@(-5,1)` `R7@(-5,2)` `R8@(-5,3)` `C1@(-4,5)` `C2@(-3,5)` `C3@(-2,5)` `C4@(-1,5)` `C5@(0,5)` `C6@(1,5)` `C7@(2,5)` `C8@(3,5)` · footprint -5,-5,10,10

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `polarity` | "row-anode" |  | `row-anode`, `col-anode` | Polarity |
| `color` | "red" |  | `red`, `orange`, `yellow`, `green`, `blue`, `white`, `ir`, `uv` | Colour |
| `ratedCurrent` | 0.01 | A | 0.0005 … 0.1 | Rated LED current |

## Meters

### `meter.voltmeter` — Voltmeter

Measures the voltage between its pins. Very high input resistance (10 MΩ by default) — connect in parallel.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `resistance` | 10000000 | Ω | 1000 … 1000000000000 | Input resistance |

### `meter.ammeter` — Ammeter

Measures the current flowing from + to − through it. Very low shunt resistance — connect in series.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `resistance` | 0.001 | Ω | 0.00001 … 10 | Shunt resistance |

### `meter.probe` — Scope Probe

Oscilloscope probe: records the node voltage (relative to ground) into a rolling 2000-sample buffer for the scope panel.

Pins: `IN@(0,0)` · footprint 0,-1,2,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `window` | 0.05 | s | 0.0001 … 60 | Length of history kept (2000 samples span this window). |
| `color` | "#ffd21a" |  |  | Trace colour |

## Digital

### `digital.and` — AND Gate

2-input AND gate: Y is high only when A and B are high. Implied supply (see Logic params).

Pins: `A@(-2,-1)` `B@(-2,1)` `Y@(2,0)` · footprint -2,-1.5,4,3

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.or` — OR Gate

2-input OR gate: Y is high when A or B is high. Implied supply.

Pins: `A@(-2,-1)` `B@(-2,1)` `Y@(2,0)` · footprint -2,-1.5,4,3

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.not` — NOT Gate (Inverter)

Inverter: Y is the complement of A. Implied supply.

Pins: `A@(-2,0)` `Y@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.nand` — NAND Gate

2-input NAND gate: Y is low only when A and B are high. Implied supply.

Pins: `A@(-2,-1)` `B@(-2,1)` `Y@(2,0)` · footprint -2,-1.5,4,3

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.xor` — XOR Gate

2-input XOR gate: Y is high when exactly one input is high. Implied supply.

Pins: `A@(-2,-1)` `B@(-2,1)` `Y@(2,0)` · footprint -2,-1.5,4,3

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.counter` — 4-bit Counter

4-bit synchronous binary counter: increments on each rising CLK edge, asynchronous active-high reset. Set modulus to 10 for a decade (BCD) counter.

Pins: `CLK@(-3,-1)` `RST@(-3,1)` `Q0@(3,-3)` `Q1@(3,-1)` `Q2@(3,1)` `Q3@(3,3)` · footprint -3,-4,6,8

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `modulus` | 16 |  | 2 … 16 | Counter wraps to 0 after modulus − 1. |
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

### `digital.bcd7seg` — BCD → 7-Segment Decoder

BCD to seven-segment decoder/driver (CD4511-style): inputs A (LSB)…D, outputs a…g. Values above 9 blank the display. Active-high outputs drive a common-cathode display through resistors; enable active-low for common-anode.

Pins: `A@(-3,-3)` `B@(-3,-1)` `C@(-3,1)` `D@(-3,3)` `a@(3,-3)` `b@(3,-2)` `c@(3,-1)` `d@(3,0)` `e@(3,1)` `f@(3,2)` `g@(3,3)` · footprint -3,-4,6,8

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `activeLow` | false |  | true / false | For common-anode displays (7447-style). |
| `vdd` | 5 | V | 1.8 … 18 | Logic-high output level. The supply is implied: outputs are referenced to the circuit ground net. |
| `rout` | 40 | Ω | 1 … 10000 | Series resistance of the output driver. |
| `delay` | 0 | s | 0 … 0.01 | Extra propagation delay. 0 = one simulation step. |

## Misc

### `misc.lamp` — Incandescent Lamp

Tungsten filament lamp: the resistance rises ≈ 14× from cold to operating temperature (inrush current), with a thermal time constant. Burns out if grossly over-driven.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `ratedVoltage` | 6 | V | 0.5 … 400 | Rated voltage |
| `ratedPower` | 0.6 | W | 0.01 … 1000 | Rated power |
| `tau` | 0.04 | s | 0.002 … 2 | Thermal time constant |

### `misc.buzzer` — Buzzer

Active buzzer with a built-in oscillator: sounds at its tone frequency whenever the + pin is driven above the minimum voltage.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `ratedVoltage` | 5 | V | 1 … 48 | Rated voltage |
| `ratedCurrent` | 0.025 | A | 0.001 … 1 | Rated current |
| `minVoltage` | 1.5 | V | 0.1 … 48 | Minimum operating voltage |
| `frequency` | 2300 | Hz | 50 … 10000 | Tone frequency |

## Opto-electronic

### `opto.photodiode` — Photodiode

PN photodiode: photocurrent I = responsivity × optical power (plus dark current) flows from cathode to anode inside the device, in parallel with the diode junction. Link it to an optical detector, or set the manual illumination.

Pins: `A@(-2,0)` `K@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `responsivity` | 0.5 | A/W | 0.01 … 1.2 | Responsivity |
| `darkCurrent` | 2e-9 | A | 1e-13 … 0.00001 | Dark current |
| `illumination` | 0 | W | 0 … 1 | Used until a linked optical detector supplies the incident power. |
| `is` | 1e-10 | A | 1e-15 … 0.000001 | Saturation current Is |
| `n` | 1.3 |  | 0.5 … 5 | Emission coefficient n |
| `rs` | 5 | Ω | 0.01 … 1000 | Series resistance |

### `opto.ldr` — Photoresistor (LDR)

Light-dependent resistor: R = R_ref·(P/P_ref)^−γ, limited between the dark and minimum resistance, with a slow (CdS-like) response time.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `rDark` | 1000000 | Ω | 1000 … 1000000000 | Dark resistance |
| `rRef` | 5000 | Ω | 1 … 10000000 | Resistance at P_ref |
| `pRef` | 0.0001 | W | 1e-9 … 1 | Reference power P_ref |
| `gamma` | 0.7 |  | 0.1 … 2 | Gamma γ |
| `rMin` | 100 | Ω | 1 … 100000 | Minimum resistance |
| `tau` | 0.03 | s | 0.0001 … 5 | Response time |
| `illumination` | 0 | W | 0 … 1 | Used until a linked optical detector supplies the incident power. |

### `opto.solar_cell` — Solar Cell

Photovoltaic cell/panel (single-diode model): photocurrent ∝ incident optical power, in parallel with the junction diode and shunt resistance, behind a series resistance. Produces the classic I–V curve with a maximum power point.

Pins: `+@(-2,0)` `-@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `voc` | 2.4 | V | 0.3 … 100 | Open-circuit voltage (at P_ref) |
| `isc` | 0.05 | A | 0.00001 … 20 | Short-circuit current (at P_ref) |
| `pRef` | 0.1 | W | 0.000001 … 1000 | Reference optical power P_ref |
| `cells` | 4 |  | 1 … 200 | Cells in series |
| `rs` | 0.5 | Ω | 0.001 … 100 | Series resistance |
| `rsh` | 5000 | Ω | 1 … 10000000 | Shunt resistance |
| `illumination` | 0.1 | W | 0 … 1000 | Used until a linked optical detector supplies the incident power. |

### `opto.laser_diode` — Laser Diode

Semiconductor laser: a diode that emits coherent light above its threshold current, P = slope efficiency × (I − Ith). Link it to an optical laser source to drive the beam from the circuit.

Pins: `A@(-2,0)` `K@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `threshold` | 0.02 | A | 0.0001 … 5 | Threshold current Ith |
| `slope` | 0.8 | W/A | 0.01 … 2 | Slope efficiency |
| `wavelength` | 650 | nm | 350 … 1700 | Wavelength |
| `vf` | 2.2 | V | 0.8 … 6 | Forward voltage (at 2·Ith) |
| `rs` | 4 | Ω | 0.01 … 100 | Series resistance |
| `maxCurrent` | 0.08 | A | 0.001 … 20 | Above this the state flags over-drive. |

### `opto.coil` — Electromagnet Coil

Solenoid electromagnet: an inductor with winding resistance. Reports the axial field B = µ0·µr·N·I / length, which can drive a Faraday rotator or isolator on the optical bench.

Pins: `A@(-2,0)` `B@(2,0)` · footprint -2,-1,4,2

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `inductance` | 0.01 | H | 1e-7 … 100 | Inductance |
| `resistance` | 8 | Ω | 0.01 … 10000 | Winding resistance |
| `turns` | 500 |  | 1 … 100000 | Turns N |
| `length` | 0.05 | m | 0.001 … 1 | Coil length |
| `mur` | 1 |  | 1 … 10000 | Core relative permeability |

