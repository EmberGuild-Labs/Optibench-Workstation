# QA notes — v0.1.0-alpha integration pass (2026-11-19)

Issues seen in areas owned by other agents, plus design decisions taken during QA.
Automation: `scripts/dev/qa/*.mjs` (run with `node scripts/dev/cdp.mjs run <script>` against
`sh scripts/dev/relaunch.sh`).

## Open items for other owners

No reproducible defects were found in `src/core/optics/**`, `src/core/circuit/**` or
`src/core/cosim.ts` during this pass: all 10 examples load, trace, and converge with no console
errors. The 30 s co-sim run (example 08) held heap steady at 6–27 MB (GC sawtooth) and ran at
about 120 fps (p99 frame 8.5 ms).

- Observation, not a bug (src/core/optics): the spectrometer's `DetectorReading.power` is the
  total power hitting the aperture, not the power inside `spectrumRange`. In example 01, a
  496–640 nm range still reports 394 mW. This matches the registry help text ("plus the total
  power"). If in-band power is wanted, the engine should report it separately.

## Decisions taken (renderer / project)

- **Pin taps.** The engine connects a pin only at a wire vertex. Wire normalization
  (`viewports/circuit/wires.ts`) now inserts a vertex wherever a pin lies on a segment, so
  drawing or moving a wire over a pin connects it in both the viewport and the engine.
  Raw files that have not been normalized are not rewritten on load, so the engine and the
  viewport both still show such a pin as open until the next edit. The shipped examples are
  unaffected (`tests/project/examples.test.ts`).
- **No-op commits** (a click without a drag, a blur without an edit, Esc during a drag) no
  longer add an undo step. They also leave the dirty flag as it was before the gesture.
- `.obw` `pose3d` and `meta.dimension` are preserved. The "3D not supported" load warning was
  removed because the 3D viewport is now in progress.

## Known cosmetic items (not fixed)

- The router sometimes adds a small hook when a wire ends on a T-point next to a pin's exit
  direction (circuit2 QA: `14,6 15,6 15,9 14,9 14,10`). Connectivity is correct.
- Each keyboard step on the band slider is its own undo step (Windows trackbar behaviour).

## Feature pass: measurement overlays, parameter sweep, component library (2026-11-19)

Automation: `scripts/dev/qa/feat-hover.mjs`, `feat-sweep.mjs`, `feat-measure.mjs`, `feat-library.mjs`
(launch with a scratch `--user-data-dir` so the real library is not touched). Unit tests:
`tests/ui/sweep.test.ts`, `tests/ui/beamIndex.test.ts`, `tests/project/library.test.ts`.

- Hover picking on a 225k-segment trace (example 02 at 4000 rays/source): index build ≈ 200 ms (done in
  idle time), ≈ 2.5 ms per query. The cost is dominated by ray density (thousands of rays per mm² in
  the beam), not by the index; 50k random segments query in < 0.5 ms.
- Example 01 sweep (prism 14.3°→34.3°, 31 points): 0.14 s. Example 05 sweep (R2 100 Ω→100 kΩ log,
  25 points × 2 s settle): ≈ 4 s in the worker while the UI kept ~120 fps.
- Observation for src/core/optics: the spectrometer peak moves in 5 nm steps (80 bins over 380–780 nm),
  so "spectrum peak" sweeps look stepped; sub-bin interpolation is applied but the white-light
  spectrum is broad.
- Measurements are session-only (not stored in the .obw file) because `ObwDocument` has no
  annotation field yet.

## Final integration pass: 3D, slow motion, new parts and instruments (2026-11-20)

Automation (run against `sh scripts/dev/relaunch.sh`): `scripts/dev/qa/int-examples.mjs` (all 17
examples × 2D / 3D, 2.5 s each, then undo of the 3D conversion), `int-gizmo.mjs` (X / Z arrows, yaw /
pitch rings via CDP, undo / redo, back to 2D), `int-slowmo.mjs <example> <tag> [ms]` (types "1 ns/s"
into the toolbar, F5, pauses mid-flight in 2D and 3D), `int-servo.mjs`, `int-symbols.mjs`,
`int-instruments.mjs`, `int-misc.mjs` (Ctrl+3, split 3D, place in 3D, Step at 1 ns/s, Realtime / Pause,
presets, Gaussian envelope, wave-mode checkbox). Unit tests: `tests/ui/timeView.test.ts`,
`tests/ui/pose3d.test.ts`, `tests/ui/instruments.test.ts`,
`src/renderer/src/viewports/circuit/__tests__/symbols.test.ts`.

Result: every example loads, traces and runs in 2D and 3D with a clean console and a converged solver;
the conversion is one undo step ("Convert to 3D").

Decisions:
- **2D / 3D.** `useApp().opticsDim` is view state; switching to 3D runs `convert2Dto3D` once (sets
  `meta.dimension = '3d'`, one undo step). Switching back never flattens: the 2D bench shows the z = 0
  projection and the inspector marks off-plane parts with a "3D" badge and a note.
- **Time scale** is session state (`useApp().timeScale`), loaded from and saved to
  `circuit.settings.simSpeed` (not an undo step). The project parser now accepts simSpeed down to
  1e-15 (was 1e-9) so "10 ps/s" survives a save.
- **Pulse view** (`lib/timeView.ts`): engages when the bench time of flight (max segment t0) or a pulse
  period takes ≥ 0.1 s of wall time. Pulsed lasers repeat every 1/repRate (several pulses in flight;
  2D clips segments on the CPU, 3D instances one ribbon per pulse copy); visual width =
  max(FWHM, 4 % of the bench time of flight) ≤ period / 2. CW sources show the front from Play / Reset
  until it has crossed the bench. One shared clock per view: with several pulsed lasers the slowest
  train sets the period. Detector readouts stay steady-state (average power) during slow motion.
- **Co-simulation at slow motion**: below 1 µs/s the driver reports a pulsed laser's envelope as its
  average to the CoSimulator (`COSIM_TEMPORAL` in `sim/driver.ts`) so the trace is not blanked between
  pulses; pulses shorter than a quarter tick still use the bridge's counting path (they flash).
- **Actuator-driven optics** are drawn from `CoSimTick.scene` (`useSim().drivenScene`); edits made in the
  live view restore the document rotation of driven parts (`undriveScene`), so the document is never
  changed by the servo / galvo.

Fixed during the pass (renderer):
- The 3D viewport's selected-label class `sel` collided with the app's `.sel` select style (the label
  stretched across the viewport) → renamed `o3d-sel`.
- Typing a time scale left focus in the field, so F5 / F6 did nothing → Enter commits and blurs.
- Library placement in the 3D bench used the 2D view transform → it now intersects the beam plane.

Observations for engine owners (not changed):
- `src/core/optics3d`: the 3D tracer has no wave optics. Example 11 in 3D: the double-slit screen reads
  0 W (2D: 284 µW) and the camera shows a single spot instead of fringes.
- Rays escaping the bench run to ±10 m; their large `t1` is why the pulse logic uses the last
  interaction time (max t0) as the bench time of flight.
