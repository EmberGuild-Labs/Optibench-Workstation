/**
 * Beam steering, modulation and special elements: galvo mirror, acousto-optic modulator,
 * corner cube, chopper wheel, LCD panel, compound parabolic concentrator, Fresnel lens,
 * Pellin-Broca and Amici prisms, Galilean beam expander, ground-glass diffuser.
 */
import type { ParamValue } from '../../types';
import { SK, toWorld, type Prim, type Xf } from '../geometry';
import { METALS, getMaterial } from '../materials';
import {
  COATING_PARAM, DEG, SIZE, bool, coatingCode, define, face, matParams, num, polygon, rect, resolveMat, seg, sel, str, wl,
  type Built, type Props, type SurfSpec, type TypeDef,
} from './common';

const ABSORB = (_l: number, o: Float64Array) => { o[0] = 0; o[1] = 0; };

const COATING = sel('coating', 'Mirror coating', 'silver', [['silver', 'Protected silver'], ['aluminium', 'Aluminium'], ['gold', 'Gold'], ['ideal', 'Ideal (fixed reflectivity)']],
  'Optical', 'Metal coatings use measured complex refractive indices in the full Fresnel equations. Ideal uses the fixed reflectivity below.');
const REFLECTIVITY = num('reflectivity', 'Reflectivity (ideal)', 1, '', 0, 1, 0.001, 'Optical', 'Power reflectivity used when the coating is Ideal.');

function mirror(prim: Prim, P: Props, extra: Partial<SurfSpec> = {}): SurfSpec {
  const metal = METALS[P.str('coating')];
  if (metal) return { prim, kind: SK.METAL, role: 'mirror', metal: metal.nk, ...extra };
  const R = Math.min(1, Math.max(0, P.num('reflectivity')));
  return { prim, kind: SK.THIN, role: 'mirror', rt: (_w, o) => { o[0] = R; o[1] = 0; }, ...extra };
}

function circle(r: number, n = 20, cx = 0, cy = 0): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n));
  return pts;
}

/** Compose a sub-frame (local position + rotation) with the component transform. */
function subXf(xf: Xf, x: number, y: number, rot: number): Xf {
  const p = toWorld(xf, x, y);
  const c = Math.cos(rot), s = Math.sin(rot);
  return { px: p.x, py: p.y, cs: xf.cs * c - xf.sn * s, sn: xf.sn * c + xf.cs * s };
}

// ---------------------------------------------------------------------------
// Chopper timing (shared by the builder and the exported helper)
// ---------------------------------------------------------------------------

function chopperGate(frequency: number, slots: number, duty: number, phaseDeg: number, t: number | undefined, running = true): number {
  const d = Math.min(1, Math.max(0, duty));
  // stopped wheel: the wheel angle alone decides whether a slot or a blade is in the beam
  if (!running || !(frequency > 0)) return chopCycle(0, slots, phaseDeg) < d ? 1 : 0;
  if (t === undefined) return d;
  return chopCycle(frequency * t, slots, phaseDeg) < d ? 1 : 0;
}
function chopCycle(turns: number, slots: number, phaseDeg: number): number {
  const x = turns + (phaseDeg / 360) * Math.max(1, Math.round(slots));
  return x - Math.floor(x);
}

const propNum = (c: { props?: Record<string, ParamValue> }, key: string, def: number): number => {
  const v = c.props?.[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : def;
};

/**
 * Power transmission (0..1) of a time-dependent component at time t (seconds).
 * `chopper.wheel`: 1 while a slot is in the beam, 0 while a blade is; with t undefined the static
 * time average (= duty). A stopped wheel (`running` = false) is open or closed according to `phase` alone. The chopping frequency counts slots per second; `phase` is the wheel angle
 * in degrees (360 / slots = one slot period). `aperture.shutter` returns its open fraction;
 * everything else returns 1.
 */
export function componentTimeTransmission(c: { type: string; props?: Record<string, ParamValue> }, t?: number): number {
  if (c.type === 'chopper.wheel') {
    const running = c.props?.running;
    return chopperGate(propNum(c, 'frequency', 100), propNum(c, 'slots', 10), propNum(c, 'duty', 0.5), propNum(c, 'phase', 0), t, !(running === false || running === 'false' || running === 0));
  }
  if (c.type === 'aperture.shutter') return Math.min(1, Math.max(0, propNum(c, 'open', 1)));
  return 1;
}

/** External Bragg angle (rad) of an acousto-optic cell: sin(theta_B) = lambda f / (2 v). */
export function aomBraggAngle(wavelengthNm: number, frequencyMHz: number, velocity: number): number {
  return Math.asin(Math.min(1, (wavelengthNm * 1e-9 * frequencyMHz * 1e6) / (2 * Math.max(1, velocity))));
}

// ---------------------------------------------------------------------------

export const EXTRA_TYPES: TypeDef[] = [
  define('mirror.galvo', 'Galvo Mirror', 'Mirrors',
    'Galvanometer scanner: a small flat mirror on a motor shaft at the component origin. The mechanical `angle` tilts the mirror about that axis, so the reflected beam turns by twice the angle. Drive `angle` from a circuit (actuator link) to scan a beam, e.g. with a sawtooth for a laser display or a sine for a Lissajous figure.',
    [
      num('angle', 'Mechanical angle', 0, 'deg', -45, 45, 0.01, 'Geometry', 'Rotation of the mirror about its axis, added to the component rotation. The beam is deflected by twice this angle. Drivable (target prop "angle").'),
      SIZE(12), COATING, REFLECTIVITY,
    ],
    ({ P }) => {
      const h = P.pos('size') / 2, a = Math.max(-90, Math.min(90, P.num('angle'))) * DEG;
      const c = Math.cos(a), s = Math.sin(a);
      return {
        surfaces: [mirror(seg(h * s, -h * c, -h * s, h * c), P)],
        decor: [
          { pts: circle(1.6, 14), closed: true, role: 'decor' },
          { prims: polygon(rect(2.5, -3, 9, 3)), closed: true, role: 'decor' },
        ],
      };
    }),

  define('modulator.aom', 'Acousto-Optic Modulator', 'Modulators',
    'Bragg cell: an RF-driven piezo transducer launches a sound wave across the crystal (along local y), forming a moving index grating of period Lambda = v / f. Light meeting the grating at the Bragg angle, sin(theta_B) = lambda f / (2 v) (external angle), is diffracted into the first order, which leaves at 2 theta_B from the undiffracted beam and is shifted in optical frequency by f. The first-order efficiency is drive x peak efficiency, reduced by sinc^2 of the Bragg mismatch over the interaction length, so the cell must be tilted to the Bragg angle; the remaining light stays in the zero order. Drive `drive` (0..1) from a circuit to modulate or switch a beam in well under a microsecond; changing the frequency steers the beam.',
    [
      num('drive', 'RF drive', 1, '', 0, 1, 0.01, 'Optical', 'Normalised RF power: 0 = off (all light in the zero order), 1 = peak first-order efficiency. Drivable (target prop "drive").'),
      num('frequency', 'Acoustic frequency', 80, 'MHz', 1, 2000, 0.1, 'Optical', 'RF / acoustic frequency. Deflection angle between orders: sin(theta) = lambda f / v.'),
      num('velocity', 'Acoustic velocity', 4200, 'm/s', 300, 12000, 10, 'Optical', 'Speed of sound in the crystal (TeO2 longitudinal 4200 m/s, fused silica 5960 m/s, TeO2 slow shear 620 m/s).'),
      num('efficiency', 'Peak efficiency', 0.85, '', 0, 1, 0.01, 'Optical', 'First-order diffraction efficiency at full drive and exact Bragg incidence.'),
      num('length', 'Interaction length', 15, 'mm', 0.5, 100, 0.5, 'Geometry', 'Length of the sound column along the beam; longer cells are more angle selective.'),
      num('index', 'Crystal index', 2.26, '', 1.3, 4.5, 0.01, 'Optical', 'Refractive index of the crystal (TeO2 2.26); enters the angular acceptance.'),
      SIZE(12, 'Clear aperture.'),
    ],
    ({ P }) => {
      const h = P.pos('size') / 2, L = P.pos('length', 0.1) / 2;
      const lambdaAc = (P.pos('velocity', 1) * 1e3) / (P.pos('frequency', 1e-3) * 1e6); // mm
      const eta = Math.min(1, Math.max(0, P.num('drive'))) * Math.min(1, Math.max(0, P.num('efficiency')));
      const stripes: Built['decor'] = [];
      for (let i = 1; i < 6; i++) stripes.push({ prims: [seg(-L, -h + (2 * h * i) / 6, L, -h + (2 * h * i) / 6)], closed: false, role: 'decor' });
      return {
        surfaces: [{ prim: face(2 * h), kind: SK.AOM, role: 'surface', p1: lambdaAc, p2: eta, p3: 2 * L, p4: Math.max(1, P.num("index")) }],
        decor: [
          { prims: polygon(rect(-L, -h, L, h)), closed: true, role: 'body' },
          { prims: polygon(rect(-L * 0.8, h, L * 0.8, h + 3)), closed: true, role: 'decor' }, // transducer
          { prims: polygon(rect(-L * 0.8, -h - 2, L * 0.8, -h)), closed: true, role: 'absorber' }, // acoustic absorber
          ...stripes,
        ],
      };
    }),

  define('retro.corner_cube', 'Corner Cube Retroreflector', 'Mirrors',
    'Retroreflector (2D: two mirrors at exactly 90 degrees, opening towards local -x). After two reflections every ray leaves antiparallel to its incoming direction regardless of the angle of incidence, displaced sideways through the apex - which is why corner cubes are used on the Moon, in surveying prisms and in the moving arm of interferometers (insensitive to tilt). Hollow: two front-surface mirrors. Solid: a glass right-angle prism used through its hypotenuse, reflecting by total internal reflection.',
    [
      SIZE(25, 'Width of the open aperture.'),
      sel('construction', 'Construction', 'hollow', [['hollow', 'Hollow (two mirrors)'], ['solid', 'Solid glass (total internal reflection)']], 'Optical', 'Hollow retroreflectors use coated mirrors; solid ones rely on TIR at the two short faces.'),
      COATING, REFLECTIVITY, ...matParams('bk7'), { ...COATING_PARAM, key: 'arCoating', label: 'Entrance face coating (solid)', default: 'ideal' },
    ],
    ({ P }) => {
      const h = P.pos('size') / 2;
      if (P.str('construction') === 'solid') {
        return {
          outline: polygon([0, -h, h, 0, 0, h]),
          body: { material: resolveMat(P), coating: coatingCode(P.str('arCoating')) }, material: P.str('material'),
        };
      }
      return {
        surfaces: [mirror(seg(0, -h, h, 0), P), mirror(seg(h, 0, 0, h), P)],
        decor: [{ prims: [seg(0, -h, h + 3, -h), seg(h + 3, -h, h + 3, h), seg(h + 3, h, 0, h)], closed: false, role: 'decor' }],
      };
    }),

  define('chopper.wheel', 'Optical Chopper', 'Modulators',
    'Rotating slotted wheel that periodically blocks the beam, turning a continuous beam into a square-wave modulated one for lock-in detection. `frequency` is the chopping frequency (slots passing the beam per second), `duty` the open fraction of each period. A static trace transmits the time average (= duty); when the simulation supplies a time the wheel is either open or closed. `phase` is the wheel angle (360 / slots = one period) and can be driven.',
    [
      num('frequency', 'Chopping frequency', 100, 'Hz', 0, 1e5, 1, 'Optical', 'Open/close cycles per second (wheel speed = frequency / slots revolutions per second).'),
      num('slots', 'Slots', 10, '', 1, 200, 1, 'Geometry', 'Number of slots in the wheel.'),
      num('duty', 'Duty cycle', 0.5, '', 0, 1, 0.01, 'Optical', 'Fraction of each period during which the beam passes.'),
      num('phase', 'Wheel angle', 0, 'deg', -360, 360, 0.1, 'Optical', 'Angular offset of the wheel. Drivable (target prop "phase").'),
      bool('running', 'Motor running', true, 'Optical', 'On: the wheel spins at the chopping frequency. Off: the wheel stands still and the wheel angle alone decides whether the beam passes - drive `phase` from a circuit to turn the wheel by hand or with a servo.'),
      SIZE(30, 'Height of the wheel section in the beam path.'),
    ],
    ({ P, time }) => {
      const size = P.pos('size');
      const T = chopperGate(Math.max(0, P.num('frequency')), P.num('slots'), P.num('duty'), P.num('phase'), time, P.bool('running'));
      return {
        surfaces: [{ prim: face(size), kind: SK.THIN, role: 'aperture', rt: (_l, o) => { o[0] = 0; o[1] = T; } }],
        decor: [
          { prims: [seg(-1.2, -size / 2, 1.2, -size / 2)], closed: false, role: 'decor' },
          { pts: circle(2.5, 14, 0, size / 2 + 4), closed: true, role: 'decor' },
          { prims: [seg(0, size / 2, 0, size / 2 + 1.5)], closed: false, role: 'decor' },
        ],
      };
    }),

  define('display.lcd_panel', 'LCD Panel', 'Modulators',
    'Row of twisted-nematic liquid-crystal pixels between two polarizers (entrance polarizer along p, analyser along s). Without voltage the liquid crystal rotates the polarization by 90 degrees and the pixel is bright (normally white). Pixels whose `pattern` character is 1 are addressed: above the threshold voltage the molecules tilt, the twist is lost and the pixel turns dark; in between the transmission follows a smooth electro-optic curve. Unaddressed pixels (0) stay bright. The transmitted light is linearly polarized; unpolarized light loses at least half its power in the entrance polarizer. Drive `voltage` from a circuit to switch the pattern on and off.',
    [
      str('pattern', 'Pixel pattern', '10110010', 'Optical', 'One character per pixel from local -y to +y: 1 = addressed (switched by the voltage), 0 = not addressed. Repeats if shorter than the pixel count.'),
      num('pixels', 'Pixels', 8, '', 1, 64, 1, 'Geometry', 'Number of pixels across the panel.'),
      num('voltage', 'Drive voltage', 5, 'V', 0, 20, 0.01, 'Optical', 'RMS voltage on the addressed pixels. Drivable (target prop "voltage").'),
      num('threshold', 'Threshold voltage', 1.5, 'V', 0.1, 10, 0.01, 'Optical', 'Voltage at which the liquid crystal starts to switch.'),
      num('saturationV', 'Saturation voltage', 3.5, 'V', 0.2, 20, 0.01, 'Optical', 'Voltage at which the pixel is fully switched.'),
      sel('mode', 'Polarizers', 'white', [['white', 'Crossed (normally white)'], ['black', 'Parallel (normally black)']], 'Optical', 'Crossed polarizers: bright without voltage. Parallel: dark without voltage.'),
      num('contrast', 'Contrast ratio', 500, ':1', 2, 1e5, 1, 'Optical', 'Ratio of bright to dark transmission.', true),
      num('transmission', 'Bright transmission', 0.85, '', 0, 1, 0.01, 'Optical', 'Transmission of a bright pixel for light polarized along the entrance polarizer.'),
      SIZE(32, 'Height of the panel.'),
    ],
    ({ P }) => {
      const size = P.pos('size'), N = Math.max(1, Math.min(64, Math.round(P.num('pixels'))));
      const pat = P.str('pattern').replace(/[^01]/g, '') || '0';
      const vt = P.pos('threshold', 0.01), vs = Math.max(vt + 0.01, P.pos('saturationV', 0.02));
      const x = Math.min(1, Math.max(0, (Math.abs(P.num('voltage')) - vt) / (vs - vt)));
      const sw = x * x * (3 - 2 * x); // switched fraction (smoothstep electro-optic curve)
      const white = P.str('mode') !== 'black';
      const t0 = Math.sqrt(Math.min(1, Math.max(0, P.num('transmission'))));
      const leak = 1 / Math.sqrt(Math.max(2, P.num('contrast')));
      const surfaces: SurfSpec[] = [];
      const decor: Built['decor'] = [{ prims: polygon(rect(-1.5, -size / 2, 1.5, size / 2)), closed: true, role: 'decor' }];
      for (let i = 0; i < N; i++) {
        const y0 = -size / 2 + (size * i) / N, y1 = -size / 2 + (size * (i + 1)) / N;
        const on = pat[i % pat.length] === '1';
        const twist = (Math.PI / 2) * (on ? 1 - sw : 1);
        // amplitude through polarizer -> twisted cell -> analyser
        const amp = t0 * Math.max(leak, Math.abs(white ? Math.sin(twist) : Math.cos(twist)));
        surfaces.push({
          prim: seg(0, y0, 0, y1), kind: SK.JONES, role: 'surface',
          jones: (_l, forward, M) => {
            M[0] = 0; M[1] = 0; M[2] = 0; M[3] = 0; M[4] = 0; M[5] = 0; M[6] = 0; M[7] = 0;
            if (!white) M[0] = amp;            // p in, p out
            else if (forward) M[4] = amp;      // p in, s out
            else M[2] = amp;                   // s in, p out (reverse direction)
          },
        });
        if (i > 0) decor.push({ prims: [seg(-1.5, y0, 1.5, y0)], closed: false, role: 'decor' });
      }
      return { surfaces, decor };
    }),

  define('solar.concentrator', 'Solar Concentrator (CPC)', 'Detectors',
    'Compound parabolic concentrator, the ideal non-imaging light collector: two parabolic mirror walls, each with its focus on the opposite edge of the exit aperture and its axis tilted by the acceptance half-angle theta. Every ray entering within +-theta of the axis reaches the absorber at the exit, every ray outside is turned back out of the entrance. The geometric concentration a_in / a_out = 1 / sin(theta) is the thermodynamic maximum for a 2D (trough) concentrator. The absorber is a detector: it reports the absorbed power and the flux `concentration` (geometric ratio x fraction of the entering light that reaches the absorber). Entrance faces local -x.',
    [
      num('entranceWidth', 'Entrance aperture', 60, 'mm', 2, 2000, 0.5, 'Geometry', 'Full width of the entrance aperture.'),
      num('acceptanceAngle', 'Acceptance half-angle', 30, 'deg', 3, 80, 0.5, 'Geometry', 'Rays within +- this angle of the axis are collected. Exit width = entrance x sin(angle); length = (a_in + a_out) / (2 tan(angle)).'),
      num('reflectivity', 'Wall reflectivity', 0.95, '', 0, 1, 0.005, 'Optical', 'Power reflectivity of the parabolic walls.'),
    ],
    ({ P, xf }) => {
      const a = P.pos('entranceWidth', 0.5) / 2;
      const th = Math.min(80, Math.max(3, P.num('acceptanceAngle'))) * DEG;
      const s = Math.sin(th), ap = a * s;
      const F = ap * (1 + s);
      const L = (a + ap) / Math.tan(th);
      const R = Math.min(1, Math.max(0, P.num('reflectivity')));
      const rt = (_w: number, o: Float64Array) => { o[0] = R; o[1] = 0; };
      const yA = 2 * ap * Math.cos(th), yB = (2 * F) / Math.tan(th);
      const up = subXf(xf, F * Math.cos(th), -ap + F * Math.sin(th), th);
      const dn = subXf(xf, F * Math.cos(th), ap - F * Math.sin(th), -th);
      return {
        surfaces: [
          { prim: { k: 'par', f: F, h: yB, y0: yA, y1: yB }, xf: up, kind: SK.THIN, role: 'mirror', rt },
          { prim: { k: 'par', f: F, h: yB, y0: -yB, y1: -yA }, xf: dn, kind: SK.THIN, role: 'mirror', rt },
          { prim: seg(0, -ap, 0, ap), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 },
          { prim: seg(-L, -a, -L, a), kind: SK.TALLY, role: 'decor', flip: true, hidden: true },
        ],
        decor: [{ prims: [seg(0, -ap, 4, -ap), seg(4, -ap, 4, ap), seg(4, ap, 0, ap)], closed: false, role: 'decor' }],
        detector: { kind: 'concentrator', bins: 0, range: [380, 780], cg: 1 / s, incoh: true },
      };
    }),

  define('lens.fresnel', 'Fresnel Lens', 'Lenses',
    'Flat lens whose curved surface is collapsed into concentric prismatic grooves, giving a short focal length at large aperture with very little material (lighthouses, overhead projectors, solar concentrators). Modelled as a thin lens that bends a ray at height h by h / f, with the chromatic focal shift of its material, f(lambda) = f_d (n_d - 1) / (n(lambda) - 1), and a transmission below one for the light lost at the groove flanks.',
    [
      num('focalLength', 'Focal length', 80, 'mm', -5000, 5000, 1, 'Geometry', 'Focal length at 587.6 nm. Positive = converging.'),
      SIZE(80, 'Clear aperture of the lens.'),
      num('grooves', 'Grooves (drawing)', 24, '', 4, 200, 1, 'Geometry', 'Number of groove zones drawn across the aperture.'),
      num('transmission', 'Transmission', 0.92, '', 0, 1, 0.01, 'Optical', 'Fraction of the light that is refracted into the focus; the rest is lost at the draft facets.'),
      ...matParams('pmma'),
    ],
    ({ P }) => {
      let f = P.num('focalLength');
      if (Math.abs(f) < 0.5) f = 0.5;
      const size = P.pos('size'), T = Math.min(1, Math.max(0, P.num('transmission')));
      const mat = resolveMat(P), nd = mat.nCatalog(587.56);
      const G = Math.max(4, Math.min(200, Math.round(P.num('grooves'))));
      const saw: number[] = [];
      for (let i = 0; i < G; i++) {
        const y0 = -size / 2 + (size * i) / G, y1 = -size / 2 + (size * (i + 1)) / G;
        const up = (y0 + y1) / 2 < 0 === f > 0;
        saw.push(up ? 0 : 1.4, y0, up ? 1.4 : 0, y1);
      }
      return {
        surfaces: [{ prim: face(size), kind: SK.IDEAL, role: 'surface', p1: f, rt: (l, o) => { o[0] = (f * (nd - 1)) / Math.max(1e-6, mat.nCatalog(l) - 1); o[1] = T; } }],
        decor: [
          { pts: saw, closed: false, role: 'decor' },
          { prims: [seg(-1, -size / 2, -1, size / 2)], closed: false, role: 'decor' },
        ],
        material: P.str('material'),
      };
    }),

  define('prism.pellin_broca', 'Pellin-Broca Prism', 'Prisms & Blocks',
    'Constant-deviation dispersing prism: a four-sided block with angles 90, 75, 135 and 60 degrees, equivalent to two 30-60-90 prisms and a 45 degree total-reflection prism. Light enters the long face, is totally reflected inside and leaves through the adjacent face; the wavelength that travels at minimum deviation is deviated by exactly 90 degrees. Rotating the prism selects which wavelength leaves at 90 degrees, so source and detector can stay fixed - the principle of constant-deviation spectrometers and of harmonic separators behind frequency-doubled lasers.',
    [num('size', 'Entrance face length', 30, 'mm', 4, 200, 0.5, 'Geometry', 'Length of the entrance face (the face next to the 90 degree corner).'), ...matParams('sf10'), COATING_PARAM],
    ({ P }) => {
      const b = P.pos('size'), d = 1.4 * b;
      const s75 = Math.sin(75 * DEG), c75 = Math.cos(75 * DEG);
      const c = (d - 0.5 * b / Math.cos(30 * DEG)) / (s75 - (0.5 * c75) / Math.cos(30 * DEG));
      const pts = [0, 0, 0, b, c * s75, b - c * c75, d, 0];
      const cx = (pts[0] + pts[2] + pts[4] + pts[6]) / 4, cy = (pts[1] + pts[3] + pts[5] + pts[7]) / 4;
      for (let i = 0; i < 8; i += 2) { pts[i] -= cx; pts[i + 1] -= cy; }
      return { outline: polygon(pts), body: { material: resolveMat(P), coating: coatingCode(P.str('coating')) }, material: P.str('material') };
    }),

  define('prism.amici', 'Amici Direct-Vision Prism', 'Prisms & Blocks',
    'Compound dispersing prism: a flint prism cemented between two crown prisms pointing the other way. The crown angle is calculated so that the deviations cancel exactly at the design wavelength - that colour passes straight through - while the higher dispersion of the flint still fans the other colours out around it. Used in direct-vision (hand-held) spectroscopes, where the spectrum appears in the line of sight.',
    [
      num('size', 'Height', 20, 'mm', 2, 200, 0.5, 'Geometry', 'Height of the prism train.'),
      num('apexAngle', 'Flint apex angle', 90, 'deg', 20, 110, 0.5, 'Geometry', 'Apex angle of the central flint prism; the crown prisms are derived from it.'),
      sel('crown', 'Crown glass', 'bk7', [['bk7', 'N-BK7'], ['bak4', 'N-BAK4'], ['fused_silica', 'Fused silica'], ['caf2', 'CaF2']], 'Optical', 'Low-dispersion outer prisms.'),
      sel('flint', 'Flint glass', 'sf10', [['f2', 'F2'], ['sf10', 'SF10'], ['sf11', 'N-SF11'], ['sf6', 'N-SF6']], 'Optical', 'High-dispersion central prism.'),
      wl('designWavelength', 'Undeviated wavelength', 587.6, 'Optical', 'Wavelength that passes without deviation.'),
      COATING_PARAM,
    ],
    ({ P }) => {
      const H = P.pos('size'), crown = getMaterial(P.str('crown')), flint = getMaterial(P.str('flint'));
      const w0 = P.num('designWavelength');
      const nc = crown.nCatalog(w0), nf = flint.nCatalog(w0);
      let hb = (Math.min(110, Math.max(20, P.num('apexAngle'))) * DEG) / 2;
      // keep the flint -> crown refraction below total reflection
      const lim = Math.asin(Math.min(1, (nc / nf) * 0.985));
      if (hb > lim) hb = lim;
      const thc = Math.asin((nf / nc) * Math.sin(hb));
      const psi = thc - hb;
      const g = Math.atan2(nc * Math.sin(psi), nc * Math.cos(psi) - 1); // tilt of the outer crown faces
      const tb = Math.tan(hb), tg = Math.tan(g);
      const Xb = H * (tb + Math.max(0, tg)) + 0.12 * H;
      const e = Math.min(0.01, H * 1e-3); // overlap that makes the cemented interfaces glass-to-glass
      const coating = coatingCode(P.str('coating'));
      const cr = (sgn: number) => [0, -H / 2, sgn * Xb, -H / 2, sgn * (Xb - H * tg), H / 2, sgn * H * tb, H / 2];
      return {
        outline: polygon([0, -H / 2 - e / Math.sin(hb), H * tb + e / Math.cos(hb), H / 2, -H * tb - e / Math.cos(hb), H / 2]),
        body: { material: flint, coating },
        extra: [{ outline: polygon(cr(1)), body: { material: crown, coating } }, { outline: polygon(cr(-1)), body: { material: crown, coating } }],
        material: P.str('flint'),
      };
    }),

  define('beam.expander', 'Beam Expander (Galilean)', 'Lenses',
    'Galilean telescope in one housing: a diverging entrance lens (f1 = -L / (M - 1)) and a converging exit lens (f2 = M L / (M - 1)) separated by L = f1 + f2, so a collimated beam leaves collimated but M times wider - and with M times smaller divergence. Unlike the Keplerian type there is no internal focus, which keeps high-power beams from ionising the air. Used backwards it reduces the beam. Both lenses are ideal thin lenses.',
    [
      num('magnification', 'Magnification M', 3, 'x', 1.1, 50, 0.1, 'Optical', 'Ratio of output to input beam diameter.'),
      num('length', 'Length', 60, 'mm', 5, 1000, 0.5, 'Geometry', 'Lens separation L.'),
      num('inputAperture', 'Input aperture', 8, 'mm', 1, 200, 0.5, 'Geometry', 'Clear diameter of the entrance lens (at the local origin).'),
      num('outputAperture', 'Output aperture', 30, 'mm', 1, 500, 0.5, 'Geometry', 'Clear diameter of the exit lens.'),
    ],
    ({ P }) => {
      const M = Math.max(1.1, P.num('magnification')), L = P.pos('length', 1);
      const h1 = P.pos('inputAperture') / 2, h2 = P.pos('outputAperture') / 2;
      return {
        surfaces: [
          { prim: seg(0, -h1, 0, h1), kind: SK.IDEAL, role: 'surface', p1: -L / (M - 1) },
          { prim: seg(L, -h2, L, h2), kind: SK.IDEAL, role: 'surface', p1: (M * L) / (M - 1) },
          { prim: seg(0, -h1, L, -h2), kind: SK.THIN, role: 'absorber', rt: ABSORB },
          { prim: seg(0, h1, L, h2), kind: SK.THIN, role: 'absorber', rt: ABSORB },
        ],
      };
    }),

  define('diffuser.ground_glass', 'Ground-Glass Diffuser', 'Apertures & Filters',
    'Plate with a randomly rough surface that scatters each incoming ray into a cone around its original direction (Gaussian angular distribution, 1/e^2 at the cone half-angle). The scatter pattern is pseudo-random but fixed by the seed, so results are reproducible; change the seed for a different piece of glass. With wave optics enabled every scattered ray gets a random phase, which produces laser speckle on a screen. Used to homogenise illumination and to destroy spatial coherence.',
    [
      num('angle', 'Scatter half-angle', 10, 'deg', 0.1, 60, 0.1, 'Optical', 'Cone half-angle (1/e^2) of the scattered light.'),
      num('rays', 'Scattered rays', 7, '', 1, 31, 1, 'Optical', 'Number of rays each incident ray is split into.'),
      num('seed', 'Seed', 1, '', 0, 9999, 1, 'Optical', 'Seed of the deterministic pseudo-random scatter pattern.'),
      num('transmission', 'Transmission', 0.9, '', 0, 1, 0.01, 'Optical', 'Total transmitted fraction (the rest is absorbed / back-scattered).'),
      SIZE(30),
    ],
    ({ P }) => ({
      surfaces: [{
        prim: face(P.pos('size')), kind: SK.DIFFUSE, role: 'surface',
        p1: Math.min(60, Math.max(0.1, P.num('angle'))) * DEG, p2: Math.max(1, Math.min(31, Math.round(P.num('rays')))), p3: P.num('seed'), p4: Math.min(1, Math.max(0, P.num('transmission'))),
      }],
      decor: [{ prims: [seg(1.2, -P.pos('size') / 2, 1.2, P.pos('size') / 2)], closed: false, role: 'decor' }],
    })),
];

