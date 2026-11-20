# Recipes (verified with `node scripts/obw.mjs simulate`)

Numbers below come from the example projects in `examples/`; copy the structure and re-validate.
Pin coordinates assume the component positions given; use `pins <type> <rot>` when you move things.

## Optics

### White light rainbow (examples/01)
- `source.white` (blackbody 5778 K, `beamWidth` 2, `rays` 5) at (−200, 0), rotation 0.
- `prism.equilateral` size 50, F2, at (0, 8), rotation **24.3°** (minimum deviation, beam exits at ≈ 48.5°,
  violet 51.3° … red 47.5°).
- Fold mirror back to horizontal: `mirror.flat` at (81, 87), rotation −65.75° (= direction of b̂ − â for 48.5° -> 0°).
- `splitter.plate` 50/50 at 45° sends half up to a `detector.spectrometer` (rotation −90, size 30), half to a `detector.screen`.
- Result: spectrometer has power in every band; screen shows red and blue ~9 mm apart 140 mm after the splitter.

### Keplerian beam expander + focusing (examples/02)
- Lens spacing = f1 + f2 (25 + 100 mm) gives a ×4 collimated beam. First plano-convex rotation 0,
  second rotation 180° (curved side towards the collimated output).
- Thick-lens back focal length is a few mm shorter than f: put the power meter at ≈ 0.96 f and
  confirm with `simulate` (the meter reading peaks) or `trace` (rays cross the axis).
- Spherical aberration: `source.beam` 40 mm wide through `lens.biconvex` f = 50, diameter 50 - marginal
  rays focus ~10 mm early; screen RMS width ≈ 3 mm at the paraxial focus vs ≈ 1 mm at ≈ 44 mm.

### Fibre coupling (examples/03)
- Lens f = 25 mm at x = −120, fibre end A at x = −97 (scan ±3 mm: coupling 76 % -> 90 %).
- `coreDiameter` 0.2 mm, `na` 0.22; beam NA = (beam radius)/f must be < na. End B anywhere (`endX`, `endY`, `endRotation`).

### Polarization (examples/09)
- Malus: p laser -> `polarizer.linear` angle θ -> meter reads P·0.95·cos²θ.
- Crossed 0°/90° pair passes ~0; a 45° polarizer between them passes P·0.95³/4.
- `waveplate.half` fastAxis 22.5° rotates p to 45° -> `splitter.pbs` splits 50/50 (s reflected up).
- `waveplate.quarter` fastAxis 45° makes linear light circular: any analyser then passes 50 %.

## Circuits

### LED with series resistor
R = (V_drive − Vf) / I. Vf at 20 mA: red 1.9, orange 2.0, yellow 2.1, green 2.9, blue 3.0, white 3.1, ir 1.25, uv 3.4 V.
`brightness` = I / ratedCurrent (clamped 0..1); `overdriven` when I > 2 × rated.

### 555 astable (examples/05, 06)
- f = 1.44 / ((RA + 2 RB) C); t_high = 0.693 (RA + RB) C, t_low = 0.693 RB C.
- Wiring: VCC -> RA -> DIS; DIS -> RB -> THR; THR = TRIG; C from THR to GND; RESET to VCC; CTRL may float.
- Layout used in the examples (555 **mirrored** at (12,10)): VCC(9,7) DIS(9,9) THR(9,11) CTRL(9,13) |
  GND(15,7) TRIG(15,9) OUT(15,11) RESET(15,13). RA/RB/C1 stacked vertically at x = 5, PSU at x = 1,
  VCC rail at y = 3, TRIG routed under the chip to the THR node.
- RA 10 k, RB 33 k, C 10 µF -> 1.9 Hz. RA 10 k, RB 68 k, C 2.2 µF -> 4.5 Hz.
- Bipolar output high ≈ VCC − 1.4 V; use `variant: "cmos"` for rail-to-rail when driving logic.

### Counter -> BCD decoder -> 7-segment (examples/06, 08)
- `digital.counter` (`modulus` 10) CLK from a clock, RST tied to ground, Q0..Q3 -> `digital.bcd7seg` A..D
  (place the decoder 10 units right of the counter at the same y: the pins line up for straight wires).
- Decoder outputs a..g are 1 unit apart; fan them out to 7 resistors at 2-unit pitch with a staircase
  (outer segments turn first), then fan back in to the `display.7seg` (common cathode, COM -> ground).
  270 Ω gives ~10 mA per segment at 5 V.
- `simulate` prints `digits shown: 1 2 3 …` for each display.

### Bridge rectifier PSU (examples/07)
- `source.ac` 325 V peak 50 Hz -> `passive.transformer` ratio 20 (lp 10 H) -> 4 × `semi.diode` -> 1000 µF -> load.
- Diodes rotation 3 (anode bottom, cathode top) in two columns: D1 over D3 at x = 16, D2 over D4 at x = 22;
  AC nodes = the wire joining each column's middle, DC+ rail on top, DC− rail at the bottom (grounded).
- Result: ≈ 14 V DC, ≈ 0.34 V p-p ripple at 30 mA + 11 mA load. Use `--dt 0.0005` to resolve 50 Hz.

### Laser-diode driver (examples/08)
- `source.function_gen` square 0–5 V (`amplitude` 2.5, `offset` 2.5, `outputResistance` 1) -> 100 Ω -> `opto.laser_diode` -> ground.
- ≈ 28 mA, threshold 20 mA, slope 0.8 W/A -> ≈ 6.7 mW optical. Emitter link to a `source.laser` (same wavelength).

### Photodiode transimpedance receiver + switch (examples/08)
- +5 V -> `opto.photodiode` K; A -> 1.5 kΩ to ground (RX node, V = Iph·R ≈ 4 V at 3 mA).
- RX node -> 10 kΩ -> NPN base; emitter to ground; collector -> LED -> 150 Ω -> +5 V.
- The RX node can clock a `digital.counter` directly (Schmitt thresholds 2 V / 3 V at vdd 5 V).

### Coil-driven Faraday modulator (examples/04)
- `source.function_gen` (sine 2 Hz, 0–4 V, `outputResistance` 2) -> `meter.ammeter` -> `opto.coil` (8 Ω) -> ground: 0–0.4 A.
- Actuator link `{ kind: "actuator", circuitId: "coil", opticsId: "faraday", targetProp: "bField", gain: 0.75, offset: 0 }`
  -> 0–0.3 T -> 0…−45° rotation in 20 mm TGG.
- Optics: p laser -> polarizer 0° -> Faraday -> analyser **−45°** -> meter: 50 % … 95 % transmission.

### LED matrix (examples/10)
- `display.matrix` row-anode: LED(r, c) conducts from row r to column c; `segments[r*8+c]`.
- Drive rows from logic outputs (set the driver's `rout` ≈ 5 Ω), return every column through its own resistor (330 Ω) to ground.
- A static row/column drive can only light rectangles (rows_on × cols_on); anything else needs scanning.
