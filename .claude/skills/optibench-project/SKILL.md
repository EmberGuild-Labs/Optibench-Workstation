---
name: optibench-project
description: Create, arrange, modify, validate and debug Optibench Workstation projects (.obw files) - optical bench layouts (lasers, white light, prisms, lenses, mirrors, splitters, polarizers, waveplates, Faraday rotators, fibres, detectors), electronic circuits (555 timers, LEDs, transistors, counters, 7-segment and LED-matrix displays, transformers, rectifiers) and optics<->circuit co-simulation combos (laser diode emitters, photodiode receivers, coil-driven actuators). Use whenever the user asks to build, lay out, tidy, fix or explain an Optibench / .obw project, an optical bench arrangement or a circuit for this app, or asks why a design does not work.
---

# Optibench Workstation projects

An `.obw` file is UTF-8 JSON (`format: "optibench-workstation"`, `version: 1`) holding a 2D optics
scene, a circuit schematic and the `links` that couple them. Spec: `docs/FORMAT.md`. Engines are
pure TypeScript in `src/core` (`optics/`, `circuit/`, `cosim.ts`, `project/`).

All work goes through the project CLI (it bundles the real engines, so its answers are authoritative):

```
node scripts/obw.mjs list-components [optics|circuit]     # types, props (default, unit, range), pins
node scripts/obw.mjs pins ic.555 1 [--mirror]             # pin offsets at a rotation
node scripts/obw.mjs new examples/my.obw "Title"
node scripts/obw.mjs validate my.obw [--nets]             # MUST end "OK: 0 errors, 0 warning(s)"
node scripts/obw.mjs simulate my.obw --seconds 1 [--dt 0.001] [--verbose]
node scripts/obw.mjs trace my.obw [--wl 550] [--per 3]    # where the rays actually go
node scripts/obw.mjs frame my.obw                         # recompute view framing, rewrite file
```

## Workflow

1. **Look up components** - `list-components` (or `reference/*.md`, generated from the live
   registries). Never guess a type id or prop key; unknown props are silently ignored by the engine.
2. **Draft the document** - start from `new` or the skeleton below. For anything with more than a
   handful of parts, write a small throw-away generator script (TS/JS, in a scratch directory) that
   computes positions and pin coordinates and emits JSON, rather than hand-typing wire vertices.
   Copying a structure from `examples/` (05/06 for 555 + digital, 07 for rectifiers, 08 for links)
   is usually the fastest start.
3. **Arrange** using the layout rules below (neat spacing matters: users see this on screen).
4. **Validate** - fix every ERROR and WARN. `info` lines (floating optional pins like 555 CTRL or
   7-seg dp) are acceptable.
5. **Simulate** - check the physics: detector powers, spectra, LED blink rate, 7-seg digits, probe
   ranges, convergence. For optics use `trace` to see each ray's path (start/end points, direction,
   power, whether it is inside glass) and adjust angles/positions until the beam lands where intended.
6. **Iterate** until the numbers are physically sensible, then `frame` and save. Set a meaningful
   `meta.title` and a one-paragraph `meta.description` explaining what the project demonstrates.

## Coordinate conventions (most common source of bugs)

| | optics | circuit |
|---|---|---|
| position | mm, floats | integer grid units |
| axes | +x right, **+y DOWN** | +x right, **+y DOWN** |
| `rotation` | **radians**, positive = clockwise on screen | quarter turns `0..3` clockwise; `(x,y) -> (-y,x)` per turn; `mirrored` flips x first |
| angle-like props (`polAngle`, `angle`, `fastAxis`, `endRotation`, `halfAngle`, `apexAngle`, `inputAxis`) | **degrees** | - |
| view `zoom` | px per mm (typ. 1-4) | px per grid unit (typ. 10-30) |

Optics orientation by type (rotation 0):
- **Sources** emit along local +x. Beam direction (screen degrees) = rotation. Light conventionally travels +x.
- **Thin elements** (`mirror.flat`, `splitter.plate`, `polarizer.*`, `waveplate.*`, `filter.*`,
  `grating.*`, `aperture.*`, `lens.ideal`, detectors) lie along local **y**; their normal is local +x,
  so rotation 0 stands perpendicular to a +x beam.
- **Fold mirror** turning direction `a` into `b`: rotation = direction of the vector (b̂ − â).
  +x -> up (−y): **45°**; +x -> down: **−45°**; up -> +x: **45°** (periscope = two mirrors at 45°).
- **Detectors** (`detector.power|spectrometer|photodiode`) are sensitive on their local **−x** face:
  rotation = travel direction of the incoming beam (beam going up -> rotation −90°). `detector.screen` is two-sided.
- **Lenses**: optical axis = local x. `lens.planoconvex` has its curved face on the −x side at
  rotation 0 (correct for focusing light arriving from the left); rotate 180° when the collimated
  side is on the right (e.g. 2nd lens of a beam expander).
- **`prism.equilateral`**: apex up (−y), base down. Beam along +x hitting the left face:
  minimum deviation at rotation = asin(n·sin 30°) − 30° (F2: **24.3°**, deviation ≈ 48.5° downward;
  SF11 ≈ 33°). The beam must hit the faces away from the base corner (offset the prism ~+8 mm in y for a 50 mm prism).
- **`splitter.pbs`**: diagonal "/" at rotation 0 - p transmits along +x, s reflects to −y (up).
  `splitter.plate` at 45° reflects a +x beam upward.
- **Polarization angles** are measured from p (in the bench plane) towards s: `polAngle: 0` = p.
- **`magneto.faraday`**: rod along local x, `bField` in T along +x. TGG Verdet is negative: positive
  B rotates polarization towards **negative** angles; 0.293 T x 20 mm = 45° at 632.8 nm.
- **`fiber.cable`**: `position` is end A (accepts light travelling +x at rotation 0); `endX/endY`
  are the WORLD mm coordinates of end B, `endRotation` (deg) its emission direction.

Circuit pins: two-terminal parts have pins at (−2,0)/(2,0); rotation 1 puts pin 1 on top, rotation 3
puts pin 1 at the bottom. Ground is `misc.ground`, single pin `GND` at (0,0), symbol hangs below.
Always confirm with `pins <type> <rotation>`.

## Layout guidelines

Optics:
- Main beam axis along **y = 0**, light left -> right, source near x = −200…−300.
- 80–200 mm between elements; keep every element centred on the beam (trace to confirm).
- Fold with mirrors to keep the bench compact; stack independent experiments as rows 100–150 mm apart.
- Size detectors to catch the beam (spectrometer `size` ≥ beam/fan width), name every component.

Circuit:
- Signal flows **left -> right**; supply rail on top, ground at the bottom; sources at the far left.
- Space parts so footprints never overlap (validator warns); 2–4 grid units of clearance; parallel
  rows of pins need a resistor fan-out at 2-unit pitch (see 06/08 decoder -> display staircase).
- Wires orthogonal. **Every wire needs a vertex exactly on each pin it connects to.** A pin lying in
  the middle of a segment is NOT connected (validator ERROR). A wire vertex lying on another wire's
  segment DOES connect (T-junction); wires that merely cross do not.
- Use as many ground symbols as convenient (all `misc.ground` pins are one net).
- `ic.555` mirrored (`"mirrored": true`) puts VCC/DIS/THR/CTRL on the left and GND/TRIG/OUT/RESET on the right (output flows right).

## Links (co-simulation)

| kind | circuit side | optics side | effect |
|---|---|---|---|
| `emitter` | `opto.laser_diode`, `semi.led` | any `source.*` | source power := circuit `opticalPower` (W). Set the source `props.power` explicitly - it is only the nominal scale |
| `detector` | `opto.photodiode`, `opto.ldr`, `opto.solar_cell` | any `detector.*` | detected W -> `opticalPower` input (photocurrent = responsivity x W) |
| `actuator` | any (current for `opto.coil`, `passive.inductor`, `switch.relay`; voltage otherwise) | numeric prop `targetProp` | prop := `gain` x quantity + `offset` |

Component ids share ONE namespace across optics and circuit - duplicates are renamed on load and break links.
Recipes (laser-diode driver, transimpedance receiver, coil-driven Faraday modulator, 555 astable,
counter -> decoder -> 7-seg, bridge rectifier, beam expander, fibre coupling): `reference/recipes.md`.

## Common pitfalls

- Degrees in `rotation` (validator warns when |rotation| > 2π). Props named `*Angle`/`angle` are degrees.
- Wire passing over a pin without a vertex there; dangling wire ends; diagonal segments.
- Missing ground; floating inputs on digital parts; LED without a series resistor (check `overdriven`).
- Bipolar `ic.555` output high is ~1.4 V below VCC: at 5 V it barely reaches logic-high (0.6·vdd) -
  use `variant: "cmos"` when it clocks digital parts. Digital outputs have `rout` 40 Ω: lower it to
  drive many LEDs (matrix rows).
- Photodiode polarity: K to +V, A to the load resistor -> V(A) = Iph·R; keep Iph·R below the supply.
- Optics drive changes are re-traced at the co-sim tick rate (`--dt`); keep optical modulation
  well below 1/(10·dt) Hz (e.g. ≤ 50 Hz at dt = 1 ms).
- A beam that "disappears" is usually TIR inside a prism (wrong angle / hitting the base), a
  detector facing the wrong way, or an element offset from the beam - use `trace`.

## Compact JSON skeleton

A 5 V supply drives a laser diode through 100 Ω (≈ 28.6 mA, ≈ 6.9 mW); an emitter link makes it the bench laser that a photodiode head sees. Validates with 0 warnings.

```json
{
  "format": "optibench-workstation", "version": 1,
  "meta": { "title": "My Bench", "description": "What it shows.", "created": "2026-01-01T00:00:00.000Z",
            "modified": "2026-01-01T00:00:00.000Z", "appVersion": "0.1.0-alpha", "dimension": "2d" },
  "optics": {
    "components": [
      { "id": "laser", "type": "source.laser", "name": "Laser", "position": { "x": -200, "y": 0 }, "rotation": 0,
        "props": { "wavelength": 650, "power": 0.005 } },
      { "id": "pd", "type": "detector.photodiode", "name": "PD head", "position": { "x": 100, "y": 0 }, "rotation": 0, "props": {} }
    ],
    "settings": { "maxBounces": 64, "minIntensity": 0.0001, "ambientMedium": "air", "raysPerSource": 32, "temperatureC": 20, "spectralSamples": 24 }
  },
  "circuit": {
    "components": [
      { "id": "v1", "type": "source.psu", "name": "V1", "position": { "x": 2, "y": 10 }, "rotation": 1, "props": { "voltage": 5 } },
      { "id": "r1", "type": "passive.resistor", "name": "R1", "position": { "x": 6, "y": 6 }, "rotation": 0, "props": { "resistance": 100 } },
      { "id": "ld", "type": "opto.laser_diode", "name": "LD1", "position": { "x": 10, "y": 9 }, "rotation": 1, "props": {} },
      { "id": "g1", "type": "misc.ground", "name": "GND", "position": { "x": 2, "y": 14 }, "rotation": 0, "props": {} },
      { "id": "g2", "type": "misc.ground", "name": "GND", "position": { "x": 10, "y": 13 }, "rotation": 0, "props": {} }
    ],
    "wires": [
      { "id": "w1", "points": [ { "x": 2, "y": 8 }, { "x": 2, "y": 6 }, { "x": 4, "y": 6 } ] },
      { "id": "w2", "points": [ { "x": 8, "y": 6 }, { "x": 10, "y": 6 }, { "x": 10, "y": 7 } ] },
      { "id": "w3", "points": [ { "x": 2, "y": 12 }, { "x": 2, "y": 14 } ] },
      { "id": "w4", "points": [ { "x": 10, "y": 11 }, { "x": 10, "y": 13 } ] }
    ],
    "settings": { "timestep": 0.00001, "simSpeed": 1, "gmin": 1e-12 }
  },
  "links": [ { "id": "emit", "kind": "emitter", "circuitId": "ld", "opticsId": "laser" } ],
  "view": { "optics": { "cx": -50, "cy": 0, "zoom": 2 }, "circuit": { "cx": 6, "cy": 10, "zoom": 40 }, "activeTab": "split" }
}
```

## Reference

- `reference/optics-components.md`, `reference/circuit-components.md` - every type, prop, unit,
  range and pin (regenerate after engine changes: `node scripts/obw.mjs list-components optics --md`).
- `reference/recipes.md` - proven sub-circuits and bench arrangements with numbers.
- `examples/01…10-*.obw` - validated, simulated example projects (tests: `tests/examples.test.ts`).
- `docs/FORMAT.md` - file format, units, versioning.
