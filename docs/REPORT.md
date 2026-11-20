# Optibench Workstation v0.1.0-alpha: overnight report (2026-11-20)

## TL;DR
- **The installer is ready:** `release\0.1.0-alpha\Optibench-Workstation-Setup-0.1.0-alpha.exe` (about 120 MB, Windows x64).
  - It's unsigned, so Windows SmartScreen will warn you. Click **More info → Run anyway**.
  - It installs per user, lets you choose the folder, and creates a desktop shortcut and a Start-menu shortcut.
  - It registers the `.obw` file type. Opening a file through the command line was tested; double-clicking one in Explorer after installing was not.
- **Checks:** typecheck is clean, **423 of 423 automated tests pass**, and the production build and the packaged app both launch.
- **Examples:** all 17 example projects open and run in both 2D and 3D with no console errors.
- **Not committed:** the repo is `git init`-ed but nothing has been committed.

## What's in it

### Optics engine (Fable 5.2): real physics, not approximations
- **Materials:** 20 real materials with published dispersion formulas (BK7, F2, SF11, fused silica, sapphire, diamond, TGG and more).
- **Surfaces:**
  - full Fresnel s/p reflection and transmission, including total internal reflection with its phase shift
  - Brewster's angle and thin-film anti-reflection coatings
  - silver, aluminium and gold mirrors with wavelength-dependent reflectance
- **Lenses** are real thick lenses, so spherical and chromatic aberration show up naturally.
- **Polarization:** exact, including unpolarized light. Polarizers, waveplates and the polarizing beam splitter (PBS) follow Malus's law.
- **Magnets and light:** in reality a magnetic field doesn't bend a beam. It *rotates its polarization* (the Faraday effect), and that's what's simulated: a Faraday rotator and an optical isolator, which a circuit coil can drive.
  - For beams that genuinely curve, there's a **gravitational lens** and **gradient-index glass**.
- **Wave optics mode** (Inspector → Optics Settings → "Wave optics"):
  - interference and diffraction: single, double and N-slit; Michelson and Mach–Zehnder interferometers
  - coherence length and the Fresnel–Arago laws
  - Young's fringe spacing is within 1% of theory
- **Lasers:**
  - continuous, pulsed (pulse width and repetition rate) or modulated
  - Gaussian-beam physics (waist, M², Rayleigh range), shown as a View overlay
  - a laser-cavity part with a simplified steady-state model
- **Parts (60+ in total):**
  - Light sources: lasers, LEDs, blackbody/white light
  - Mirrors: flat, spherical, parabolic, dichroic, galvo, corner cube
  - Lenses: biconvex and the other standard shapes, ball, ideal, Fresnel, Galilean beam expander
  - Prisms: equilateral, right-angle, Dove, Pellin–Broca, Amici
  - Diffraction gratings, fibre-optic cable, filters, apertures, chopper wheel
  - Modulators and displays: acousto-optic modulator (AOM), LCD panel
  - Other optical elements: CPC solar concentrator, frequency-doubling (SHG) crystal, ground-glass diffuser
  - Detectors: power meter, screen, spectrometer, camera, polarimeter, wavemeter, photodiode
- **Wavelength range slider:** a two-thumb control lets broadband sources emit only the band you pick, and lets the spectrometer zoom to it.

### Circuit engine (Fable 5.2): a transient simulator in the SPICE style
- **How it solves:** nonlinear solving plus capacitor/inductor models, and it automatically takes smaller time steps when it needs to.
- **Sources:** battery (drains), bench PSU (switches to constant current at its limit), AC source, function generator, clock, crystal oscillator.
- **Timer:** 555.
- **Passives:** R, pot, C, L, transformer, thermistor, fuse.
- **Semiconductors:** diode, Zener, LED, BJT, MOSFET.
- **Analog ICs:** op-amps (LM358, TL072, 741, rail-to-rail), comparator, 78xx regulators.
- **Digital:** logic gates, counter, BCD decoder, 74HC595, 74HC138.
- **Drivers and motion:** H-bridge, DC motor, servo.
- **Switches:** switches and a relay.
- **Displays:** 7-segment and 8×8 LED matrix.
- **Meters:** meters and oscilloscope probes.
- **Light-linked parts:** photodiode, light-dependent resistor (LDR), solar cell, laser diode, electromagnet coil.
- **Speed:** about 10 ms per frame for a 64-part circuit, so it runs in real time.

### Optics and circuit together
- **Links** between the two editors:
  - **Emitter:** a circuit laser diode or LED drives an optical source.
  - **Detector:** an optical detector feeds a circuit photodiode.
  - **Actuator:** a coil drives the Faraday field, or a **servo/motor/galvo physically rotates a mirror**.
- Choppers and modulated or pulsed lasers follow simulated time.

### 3D mode
- **2D | 3D** buttons, or Ctrl+3. Any 2D design converts to 3D in one step that you can undo.
- Parts sit on posts and mounts on an optical table.
- The 3D physics matches 2D exactly in the beam plane, and the tests check this.
- **Controls:**
  - X/Y/Z move arrows and plane handles
  - yaw/pitch/roll rotation rings
  - snapping: 1 mm and 1° normally, Shift for 10 mm and 15°, Ctrl for free movement
  - camera: orbit, pan, zoom, plus Top/Front/Side/Iso/Frame view buttons
  - the Inspector has a "3D Pose" group
- **Detectors** show 2D images.

### Time control and slow motion
- Toolbar buttons: **Realtime**, **Pause**, and a typed **Time scale** box. Type things like `1 ns/s`, `100 ps/s`, `1 µs/s`.
- At slow scales you watch light **pulses travel, split, refract and bounce** in both 2D and 3D.
  - Example 16 is built for this.

### App and UI
- **Look:** the classic Windows 2000 style you asked for. Navy title bar, bevelled buttons, group boxes, classic trackbars, white sunken fields, Tahoma font.
- **Inspector:** shows each component's own settings, for example a laser's wavelength, power, beam diameter, divergence and polarization.
- **Measurement overlays:** hover a beam to see λ, power, polarization and time of flight. Hover a wire to see voltage and current. There's a measure tool for distances and angles.
- **Parameter sweep** (Simulation menu): sweep any parameter and plot any output, with CSV export.
- **Component library:** save groups of parts and reuse them. There are 4 built-in groups, and you can import and export `.obwlib` files.
- **Smart cables:** auto-routing that steers around parts, T-junctions, segment dragging, and wires that stay attached when you move parts.
- **Other basics:** undo/redo, copy/paste, the instrument dock (meters, spectrometer, oscilloscope, camera, polarimeter), PNG export, recent files and a start screen with examples.

### File format and the Claude skill
- **File format:** `.obw` is versioned JSON, specified in `docs/FORMAT.md`. 3D poses and settings are saved in the file.
- **Claude skill:** `.claude/skills/optibench-project/` teaches Claude to build, arrange, check and simulate projects. It works through the CLI: `npm run obw -- validate|simulate|trace|list-components|pins <file>`.

## How it was tested
- **Unit tests (423), covering:**
  - Optics: Snell, Fresnel, total internal reflection, Brewster, Sellmeier dispersion, minimum deviation through a prism, the lensmaker's equation, Malus, Faraday, gratings, energy conservation, fibre numerical aperture (NA), interference and diffraction
  - Circuits: RC/RL/LC behaviour, diodes, transformers, 555 frequency, transistors, op-amp gain and bandwidth, slew rate
  - The rest: co-simulation loops, 2D↔3D equivalence, project file round trips, wire/pin consistency, symbol pin alignment in all 8 orientations
- **Automated checks of the real app** (driving it through Chrome DevTools, scripts in `scripts/dev/qa/`):
  - every menu, button and inspector control
  - dragging with no jumps or drift at any zoom level or display scaling (100/125/150%), with one undo step per gesture
  - wiring, Play, and the LED lighting up
  - the 3D move and rotation controls, with correct pose values and working undo
  - slow motion
  - the servo-driven mirror
  - parameter sweeps and the library
  - a 30-second run with no memory growth, at about 120 fps
- **Packaged app:** launched straight from the built release, and an example opened by passing its path on the command line, like a file double-click would.

## Known limitations (also in docs/QA-NOTES.md)
- **3D has no wave optics yet:** in 3D the double-slit screen shows no fringes. Use 2D for interference.
- **Slow-motion readouts:** detector numbers show steady-state values, not the moment-by-moment ones.
- **Pulsed-laser timing:** all pulsed lasers in a scene share one clock, set by the slowest.
- **Measurements aren't saved:** measure-tool annotations last for the session only and aren't stored in `.obw` files yet.
- **Unsigned installer:** expect the SmartScreen warning. macOS is configured (dmg/zip, `.icns` pipeline) but not built, as agreed.
- **Cosmetic:**
  - the wire router sometimes adds a small hook near a pin
  - Split view doesn't always frame the circuit on load (press F, or Shift+F)

## Where things are
- Installer: `release/0.1.0-alpha/`
- Screenshots: `docs/screenshots/`. The best ones:
  - `int-3d-gizmo.png`
  - `int-slowmo-3d.png`
  - `int-double-slit.png`
  - `qa-circuit-running.png`
  - `feat-sweep.png`
  - `final-packaged-optical-link.png`
- Docs: `docs/ARCHITECTURE.md`, `docs/FORMAT.md`, `docs/THEME.md`, `docs/INSTALL.md`, `docs/QA-NOTES.md`
- Rebuild the installer: `npm run dist:win`
