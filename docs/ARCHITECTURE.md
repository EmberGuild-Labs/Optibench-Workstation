# Optibench Workstation — Architecture (v0.1.0-alpha)

Electron + Vite (electron-vite) + React 19 + TypeScript + zustand. Windows NSIS installer via
electron-builder now; macOS (dmg, `.icns`) is configured but not built yet.

```
src/
  core/                    pure TS, no DOM / Node APIs — runs in renderer, worker, CLI
    types.ts               SHARED CONTRACTS (do not change without coordinating)
    optics/index.ts        exports `opticsEngine: OpticsEngineAPI`
    circuit/index.ts       exports `circuitEngine: CircuitEngineAPI`
    cosim.ts               exports `CoSimulator` (circuit <-> optics bridge)
    project/index.ts       .obw document create / serialize / parse / validate / migrate
  main/index.ts            Electron main process (window, menus, dialogs, file association)
  preload/index.ts         contextBridge API -> window.optibench
  renderer/src/
    viewports/contracts.ts props for OpticsViewport / CircuitViewport
    viewports/optics/      WebGL2 optics viewport
    viewports/circuit/     circuit schematic viewport + smart cables
    ...                    shell, store, panels, inspector
tests/                     vitest
build/                     icons, installer art (electron-builder buildResources)
.claude/skills/optibench-project/  Claude skill for authoring .obw projects
```

File format: **`.obw`** (Optibench Workstation), UTF-8 JSON, `format: "optibench-workstation"`,
`version: 1`. See `ObwDocument` in `src/core/types.ts`.

## Canonical component type ids

Engines MUST implement at least these ids (they may add more). The UI draws custom visuals keyed
on these ids and falls back to a generic look for unknown ids.

### Optics (`src/core/optics`)
- Sources: `source.laser`, `source.led`, `source.white`, `source.point`, `source.beam`
- Mirrors: `mirror.flat`, `mirror.spherical`, `mirror.parabolic`, `mirror.dichroic`
- Splitters: `splitter.plate`, `splitter.pbs`
- Lenses: `lens.biconvex`, `lens.biconcave`, `lens.planoconvex`, `lens.planoconcave`, `lens.ball`, `lens.ideal`, `lens.custom`
- Prisms / blocks: `prism.equilateral`, `prism.right_angle`, `prism.dove`, `prism.custom`, `block.slab`, `block.semicircle`, `medium.grin`
- Diffraction: `grating.transmission`, `grating.reflection`
- Polarization: `polarizer.linear`, `waveplate.half`, `waveplate.quarter`
- Magneto-optics & exotic: `magneto.faraday`, `magneto.isolator`, `field.gravity`
- Fiber: `fiber.cable` (second end stored in props `endX`,`endY`, world mm; exposed as handle `end`)
- Apertures / filters: `aperture.slit`, `aperture.iris`, `aperture.shutter`, `absorber.block`, `filter.bandpass`, `filter.longpass`, `filter.shortpass`, `filter.nd`
- Nonlinear: `nonlinear.shg`
- Detectors: `detector.power`, `detector.screen`, `detector.spectrometer`, `detector.photodiode`

### Circuit (`src/core/circuit`)
- Sources: `source.battery`, `source.psu`, `source.ac`, `source.function_gen`, `source.current`, `misc.ground`
- Oscillators / ICs: `osc.crystal`, `ic.555`
- Passive: `passive.resistor`, `passive.potentiometer`, `passive.capacitor`, `passive.inductor`, `passive.transformer`
- Semiconductors: `semi.diode`, `semi.zener`, `semi.led`, `semi.npn`, `semi.pnp`, `semi.nmos`, `semi.pmos`
- Switches: `switch.spst`, `switch.spdt`, `switch.push`, `switch.relay`
- Displays: `display.7seg`, `display.matrix`
- Meters: `meter.voltmeter`, `meter.ammeter`, `meter.probe`
- Digital: `digital.and`, `digital.or`, `digital.not`, `digital.nand`, `digital.xor`, `digital.counter`, `digital.bcd7seg`
- Misc: `misc.lamp`, `misc.buzzer`
- Opto-electronic (link to optics): `opto.photodiode`, `opto.ldr`, `opto.solar_cell`, `opto.laser_diode`, `opto.coil`
- Analog / interface ICs: `ic.opamp` (macro-model; presets generic / LM358 / TL072 / LM741 / rail-to-rail CMOS), `ic.comparator` (LM393, open collector), `ic.regulator` (78xx), `ic.hbridge` (L293-style), `ic.shift595`, `ic.decoder138`
- Electromechanical: `misc.motor` (DC motor; state `speed`, `rpm`, `angle`, `angleDeg`), `misc.servo` (PWM or DC control; state `angleDeg`)
- More passives / sources: `passive.thermistor` (NTC), `passive.fuse` (I²t), `source.clock` (digital clock, implied supply)
- Pin layouts and state keys of every type: header of `src/core/circuit/registry.ts`.

## Co-simulation (OptoLink)
- `emitter`: circuit `opto.laser_diode` / `semi.led` emitted optical power (state key `opticalPower`, W)
  -> optics source power (`sourceScale = opticalPower / source.props.power`).
- `detector`: optics detector reading `.power` (W) -> `circuit.setExternal(id, 'opticalPower', W)`.
- `actuator`: `propOverrides[opticsId][targetProp] = gain * quantity + offset`, quantity = component
  current (A) for `opto.coil` / inductors, otherwise voltage (V).
  Example: `opto.coil` current drives `magneto.faraday.bField` (T).
  Optional `link.source` picks the quantity: `current` | `voltage` | `angle` (state `angleDeg`, degrees) | `speed`
  (rad/s) | `brightness`. The special `targetProp` `rotation` turns the optical component itself: rotation in
  DEGREES = gain * quantity + offset, applied to a copy of the scene (`CoSimTick.scene` / `rotations`; the document
  is never mutated) and re-traced when it moved by more than 0.05 degrees. Example: `misc.servo` -> `mirror.flat`.
- Time: every trace gets `drive.time` = simulated time. Optional engine helpers `sourceTemporalEnvelope(c, t)` and
  `componentTimeTransmission(c, t)` (methods of the injected engine object or `CoSimOptions.temporal`) tell the bridge
  when a chopper / modulated laser changed (re-trace) and let it flash slow pulsed lasers tick by tick via `sourceScale`.

## Measurement overlays, parameter sweep, component library (renderer)

- **Hover info.** `lib/hoverTip.ts` is the classic yellow tooltip (380 ms initial delay, live refresh).
  Optics (`viewports/optics/measureInfo.ts`): beam tooltip (λ + swatch, power, polarization, interaction
  depth, source, medium, optional time of flight from `RaySegment.t0/t1`), component tooltip (key
  params), detector tooltip (live reading). Beams are picked with `lib/beamIndex.ts` (`SegmentGrid`, a
  uniform grid built once per trace, prebuilt in idle time after the trace has been stable 250 ms).
  Circuit (`viewports/circuit/hoverInfo.ts`): wire → net voltage + segment current, pin → net /
  voltage / current in, component → value + live V / I / P (wire tips only while a sim state exists).
- **Beam info overlay** (View ▸ Beam Info Overlay, `opticsDisplay.beamInfo`): power + λ labels on beams
  leaving each component (segments grouped by owning component and 8° direction bucket).
- **Measure tool** (M): click-click distance (or drag), Shift+click three points for an angle; snaps
  to component centres / surfaces (Ctrl = free). Annotations live in `useApp().measurements` (session
  only, cleared on load) and are listed in the dock's *Measurements* tab.
- **Parameter sweep** (Simulation ▸ Parameter Sweep…, dock *Sweep* tab): `lib/sweep.ts` is a pure
  runner with injected engines (`runSweep(doc, spec, deps, hooks)`); `workers/sweep.worker.ts` runs it
  off the main thread (main-thread fallback is time-sliced with `requestIdleCallback`). Each point is a
  copy of the document: optics trace, circuit transient of `settle` s, or a `CoSimulator` run when the
  document has links. Circuit outputs are averaged over the second half of the settle window.
  Params: any numeric registry `ParamDef` plus optics `@rotation` (deg) / `@x` / `@y`.
- **Component library** (`core/project/library.ts` pure format + `renderer/src/library/`): Edit ▸ Save to
  Library… captures the selected components of both domains, the wires between them (selected wires +
  wires whose ends land on selected pins / other group wires) and the links among them, relative to the
  group centre. Stored in `userData/library.json` via IPC (`getLibrary / saveLibraryItem /
  deleteLibraryItem / renameLibraryItem`, validated in main). Palette *My Library* places a group (click
  then click in a viewport, or drag) with fresh ids, remapped wires/links and renumbered designators as
  one undo step. Import / export `.obwlib` files. Four built-ins are generated from the registries
  (`library/builtins.ts`).
- **Text exports** go through `exportTextDialog(text, name, 'csv' | 'json' | 'obwlib')`: main shows the
  save dialog and writes only to the path the user picked.

## 3D bench, time control and slow motion (renderer)

- **2D | 3D** (toolbar, View menu, Ctrl+3): `useApp().opticsDim`. The optics pane mounts `Optics3DViewport`
  (`viewports/optics3d`) with the same scene / selection / tool / callbacks; `workers/optics3d.worker.ts`
  runs `optics3dEngine.trace3D` (debounced, latest-wins) into `useSim().trace3d`. Inspector: "3D Pose"
  group (Z mm, pitch °, roll °, `lib/pose3d.ts`). Instruments show `DetectorReading3D.image` heatmaps.
- **Time control**: [Realtime] [Pause] and a typed "Time scale" field + presets (`lib/timeView.ts`
  `parseTimeScale`: "1 ns/s", "100 ps/s", "1/1e9", "realtime" …). Simulated time = timeScale × wall
  time, kept by the driver (`useSim().time`, status bar "t = 1.234 ns"). Step advances 1/60 s of wall
  time at the current scale.
- **Pulse view**: `computeTimeView` → `timeView {mode, t, pulseWidth, period}` passed to both optics
  viewports; light is drawn only inside its time-of-flight window (RaySegment / Ray3Segment `t0`/`t1`).
- **Driver**: `CoSimulator` gets `temporal: { sourceTemporalEnvelope, componentTimeTransmission }`;
  actuator-rotated optics are drawn from `CoSimTick.scene` (`useSim().drivenScene`), never written back.
- View ▸ Gaussian Beam Envelope draws ±w(z) (`viewports/optics/gaussian.ts`, `gaussianBeamProfile`);
  the laser inspector lists w0, waist position, z_R and θ.
