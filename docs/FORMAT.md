# The `.obw` project format (version 1)

Optibench Workstation saves projects as **`.obw`** files: UTF-8 JSON (a leading BOM is tolerated),
pretty-printed with a stable key order by `serializeDocument` (`src/core/project/index.ts`). The
TypeScript contract is `ObwDocument` in `src/core/types.ts`; this page describes it for humans and tools.

Validate and inspect files with the project CLI:

```
node scripts/obw.mjs validate project.obw       # parse + semantic checks
node scripts/obw.mjs simulate project.obw       # headless co-simulation report
```

## Top level

| key | type | notes |
|---|---|---|
| `format` | `"optibench-workstation"` | required magic string; anything else is rejected |
| `version` | integer | format version, currently `1` (see *Versioning*) |
| `meta` | object | title, description, author, dates, app version, dimension |
| `optics` | object | `components[]` + `settings` |
| `circuit` | object | `components[]`, `wires[]`, `settings` |
| `links` | array | optics <-> circuit couplings (`OptoLink`) |
| `view` | object, optional | camera of each tab + active tab |

Unknown top-level keys are ignored (and dropped on the next save).

## Units and conventions

| quantity | unit |
|---|---|
| optics positions | millimetres, floats; **+x right, +y down** (screen convention) |
| optics `rotation` | **radians**, positive = clockwise on screen |
| angle-like optics props (`polAngle`, `angle`, `fastAxis`, `endRotation`, `apexAngle`, …) | **degrees** (see each ParamDef `unit`) |
| wavelength | nm |
| optical power | W |
| magnetic field | T |
| circuit positions | integer grid units, +y down; pins sit on integer points |
| circuit `rotation` | quarter turns clockwise, `0..3`; `(x,y) -> (−y,x)` per turn; `mirrored` flips x before rotating |
| time | s |

Every prop is stored in the unit shown in the registry ParamDef (`node scripts/obw.mjs list-components`).

## `meta`

```json
{ "title": "Prism Rainbow", "description": "…", "author": "…",
  "created": "2026-11-19T00:00:00.000Z", "modified": "2026-11-19T00:00:00.000Z",
  "appVersion": "0.1.0-alpha", "dimension": "2d" }
```

`title` (string, default "Untitled Project"), `description` and `author` (optional strings),
`created` / `modified` (ISO 8601), `appVersion` (writer's version), `dimension` (`"2d"`; see *3D reservation*).

## `optics`

```json
{ "components": [ { "id": "prism", "type": "prism.equilateral", "name": "F2 prism",
                    "position": { "x": 0, "y": 8 }, "rotation": 0.424115,
                    "props": { "size": 50, "material": "f2" }, "locked": false } ],
  "settings": { "maxBounces": 64, "minIntensity": 0.0001, "ambientMedium": "air",
                "raysPerSource": 32, "temperatureC": 20, "spectralSamples": 24 } }
```

- `id` - unique across the **whole document** (optics and circuit share one namespace).
- `type` - optics registry id (`source.laser`, `lens.biconvex`, `detector.spectrometer`, …).
- `props` - values for the type's ParamDefs; missing props take the registry default; numbers,
  strings and booleans only. Unknown keys are kept but ignored by the engine.
- `locked` - optional, UI only.
- Orientation: sources emit along local +x; thin elements lie along local y; detectors are
  sensitive on their local −x face. `fiber.cable` stores its second end in props `endX`, `endY`
  (world mm) and `endRotation` (deg).
- `settings` - tracer limits: `maxBounces` (1..10000), `minIntensity` (fraction of source power at
  which rays are dropped), `ambientMedium` (material id), `raysPerSource`, `temperatureC`,
  `spectralSamples` (wavelength samples for broadband sources).

## `circuit`

```json
{ "components": [ { "id": "u", "type": "ic.555", "name": "U1", "position": { "x": 12, "y": 10 },
                    "rotation": 0, "mirrored": true, "props": { "variant": "cmos" } } ],
  "wires": [ { "id": "w1", "points": [ { "x": 15, "y": 11 }, { "x": 20, "y": 11 } ],
               "color": "#ff5a3c", "label": "OUT" } ],
  "settings": { "timestep": 0.00001, "simSpeed": 1, "gmin": 1e-12 } }
```

- Components: `id`, `type` (circuit registry id), `name` (reference designator), integer
  `position`, `rotation` 0..3, optional `mirrored`, `props`.
- Pins come from the registry (`node scripts/obw.mjs pins <type> <rotation>`).
- Wires are polylines of integer points (orthogonal segments preferred), optional `color`, `label`.
- **Connectivity:** points shared by pins / wire vertices connect; consecutive wire points connect;
  a wire vertex lying on another wire's segment connects (T-junction); a pin connects to a wire
  **only at a wire vertex**; wires that merely cross mid-segment do not connect; all `misc.ground`
  pins form the ground net `GND`.
- Digital parts have an implied supply (`vdd`, default 5 V) referenced to ground.
- `settings`: `timestep` (s, nominal internal step), `simSpeed` (UI real-time factor), `gmin` (S).

## `links`

```json
[ { "id": "emit", "kind": "emitter",  "circuitId": "ld",   "opticsId": "tx" },
  { "id": "det",  "kind": "detector", "circuitId": "rxpd", "opticsId": "pd" },
  { "id": "act",  "kind": "actuator", "circuitId": "coil", "opticsId": "faraday",
    "targetProp": "bField", "gain": 0.75, "offset": 0 } ]
```

- `emitter`: circuit `opto.laser_diode` / `semi.led` state `opticalPower` (W) becomes the power of
  the optics source (`sourceScale = opticalPower / props.power`).
- `detector`: the optics detector's reading (W) is injected as `opticalPower` into
  `opto.photodiode`, `opto.ldr` or `opto.solar_cell`.
- `actuator`: `propOverrides[opticsId][targetProp] = gain × q + offset`, where `q` is the component
  current (A) for `opto.coil`, `passive.inductor`, `switch.relay` and its voltage (V) otherwise.
  `targetProp` defaults to `bField`, `gain` to 1, `offset` to 0.
- Links whose ids do not exist or whose `kind` is invalid are dropped on load (with a warning).

## `view`

```json
{ "optics": { "cx": 60, "cy": 50, "zoom": 1.6 }, "circuit": { "cx": 20, "cy": 10, "zoom": 22 },
  "activeTab": "split" }
```

`cx`, `cy` = world coordinates at the viewport centre (mm for optics, grid units for the circuit);
`zoom` = CSS px per mm (optics) or per grid unit (circuit); `activeTab` ∈ `optics | circuit | split`.
`node scripts/obw.mjs frame file.obw` recomputes both cameras to fit the content.

## Loading rules

`parseDocument` throws only for unrecoverable input: invalid JSON, wrong `format`, or a `version`
newer than the build supports. Everything else is repaired with a warning: missing ids are
assigned, duplicate ids renamed (`id_2`), non-integer circuit positions rounded, rotations
normalised to 0..3, invalid props/points dropped, settings clamped to their ranges, missing
sections replaced by empty defaults. A file that loads with warnings has been changed - the
example projects load with none (`tests/examples.test.ts`).

## Versioning and migration policy

- `version` is an integer that increases only for **breaking** schema changes (renamed or
  re-interpreted fields). Additive changes (new optional fields, new component types, new props
  with defaults) keep the version and must be ignorable by older readers.
- Readers migrate older files step by step through `MIGRATIONS[n]` (n -> n+1) in
  `src/core/project/index.ts`; every step must be pure, lossless where possible and append a
  human-readable warning. Version 0 (pre-release drafts without `links`) migrates to 1.
- Files from a **newer** version are refused with a clear "please update the app" message rather
  than half-loaded; writers always save the current `FORMAT_VERSION`.
- Renaming a prop of a component type (for example `detector.spectrometer`
  `rangeMin`/`rangeMax` -> `wavelengthMin`/`wavelengthMax`) is a breaking change for that type: add a
  migration step that rewrites the old keys, or keep reading the old key as an alias.
- Component type ids listed in `docs/ARCHITECTURE.md` are stable; unknown types are preserved in
  the file and drawn with a generic look.

## 3D reservation

`meta.dimension` is `"2d"` in v0.1. The value `"3d"` is reserved: a v0.1 reader loads such a file,
warns and shows it in 2D. Future 3D documents will add optional fields (e.g. `position.z`, a full
orientation instead of the scalar `rotation`, 3D `view` cameras) under a new format version; 2D
files stay valid and are interpreted as lying in the z = 0 plane with the optical bench normal
along +z.
