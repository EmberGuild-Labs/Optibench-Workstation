/** Gradient-index medium, magneto-optics, gravitational lens, optical fibre and nonlinear crystal. */
import { SK, makeXf, toWorld, type Prim } from '../geometry';
import { customMaterial, getMaterial } from '../materials';
import {
  COATING_PARAM, DEG, bool, coatingCode, define, face, matParams, num, polygon, rect, resolveMat, seg, sel, wl,
  type Built, type SurfSpec, type TypeDef,
} from './common';

const ABSORB = (_l: number, o: Float64Array) => { o[0] = 0; o[1] = 0; };

function polarizerJones(angDeg: number, t1: number, t2: number) {
  return (_l: number, forward: boolean, M: Float64Array) => {
    const th = (forward ? angDeg : 180 - angDeg) * DEG;
    const c = Math.cos(th), s = Math.sin(th);
    M[0] = t1 * c * c + t2 * s * s; M[1] = 0; M[2] = (t1 - t2) * c * s; M[3] = 0;
    M[4] = M[2]; M[5] = 0; M[6] = t1 * s * s + t2 * c * c; M[7] = 0;
  };
}

function circlePts(r: number, n = 48): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n));
  return pts;
}

export const SPECIAL_TYPES: TypeDef[] = [
  // -------------------------------------------------------------------------
  define('medium.grin', 'GRIN Medium', 'Prisms & Blocks',
    'Slab whose refractive index varies across its height. Parabolic profile: n(y) = n0 - dn (y/h)^2 - rays oscillate sinusoidally about the axis and the slab acts as a lens with flat faces (GRIN rod lens, graded-index fibre). Linear profile: n(y) = n0 + dn (y/h) - rays bend continuously towards the denser side, as in a mirage or a sugar-solution tank. Ray paths are obtained by integrating the ray equation d/ds(n dr/ds) = grad n with a 4th-order Runge-Kutta scheme.',
    [
      num('length', 'Length', 80, 'mm', 1, 1000, 0.5, 'Geometry', 'Extent along the local x axis (propagation direction).'),
      num('height', 'Height', 20, 'mm', 1, 500, 0.5, 'Geometry', 'Extent along the local y axis (gradient direction); h = height/2.'),
      sel('profile', 'Index profile', 'parabolic', [['parabolic', 'Parabolic (lens-like)'], ['linear', 'Linear (mirage-like)']], 'Optical', 'Shape of the transverse index variation.'),
      num('n0', 'Axis index n0', 1.6, '', 1, 3, 0.001, 'Optical', 'Refractive index on the axis (at 587.6 nm).'),
      num('deltaN', 'Index change dn', 0.05, '', -0.5, 0.5, 0.001, 'Optical', 'Index difference between axis and edge. Parabolic pitch length = 2 pi h / sqrt(2 dn / n0).'),
      num('abbe', 'Abbe number', 50, '', 5, 120, 0.5, 'Optical', 'Dispersion of the base material.'),
      COATING_PARAM,
    ],
    ({ P }) => {
      const L = P.pos('length') / 2, h = P.pos('height') / 2;
      const n0 = customMaterial(Math.max(1, P.num('n0')), P.num('abbe'));
      return {
        outline: polygon(rect(-L, -h, L, h)),
        body: { material: n0, coating: coatingCode(P.str('coating')), grin: { n0, dn: P.num('deltaN'), halfHeight: h, profile: P.str('profile') } },
        material: 'custom',
      };
    }),

  // -------------------------------------------------------------------------
  define('magneto.faraday', 'Faraday Rotator', 'Magneto-Optics',
    'Magneto-optic rod in a longitudinal magnetic field. The plane of polarization is rotated by theta = V(lambda) B L, where V is the Verdet constant of the material (TGG: -134 rad/(T m) at 632.8 nm, falling roughly as 1/lambda^2). The effect is non-reciprocal: the rotation sense is fixed by the field, not by the propagation direction, so a reflected beam is rotated further instead of being restored. The rotation is accumulated along the actual ray path as V B.dl. Drive `bField` from a coil current to build a magneto-optic modulator.',
    [
      num('bField', 'Magnetic field B', 0.293, 'T', -5, 5, 0.001, 'Optical', 'Flux density along the rod axis (local +x). Negative values reverse the rotation. Drivable from the circuit (actuator link, target prop "bField").'),
      num('length', 'Rod length', 20, 'mm', 1, 300, 0.5, 'Geometry', 'Length of the magneto-optic rod.'),
      num('diameter', 'Rod diameter', 10, 'mm', 1, 100, 0.5, 'Geometry', 'Clear aperture of the rod.'),
      ...matParams('tgg'),
      { ...COATING_PARAM, default: 'ideal' },
    ],
    ({ P }) => {
      const L = P.pos('length') / 2, h = P.pos('diameter') / 2;
      return {
        outline: polygon(rect(-L, -h, L, h)),
        body: { material: resolveMat(P), coating: coatingCode(P.str('coating')), bLocal: P.num('bField') },
        decor: [
          { prims: polygon(rect(-L * 0.8, -h - 4, L * 0.8, -h - 0.5)), closed: true, role: 'decor' },
          { prims: polygon(rect(-L * 0.8, h + 0.5, L * 0.8, h + 4)), closed: true, role: 'decor' },
        ],
        material: P.str('material'),
      };
    }),

  // -------------------------------------------------------------------------
  define('magneto.isolator', 'Optical Isolator', 'Magneto-Optics',
    'Optical diode: input polarizer, 45 degree TGG Faraday rotator in a permanent magnet, output polarizer at 45 degrees. Forward light passes with low loss. Backward light is polarized at 45 degrees by the output polarizer, rotated a further 45 degrees in the same sense by the non-reciprocal Faraday effect and arrives crossed at the input polarizer, where it is absorbed. The magnet is sized for exactly 45 degrees at the design wavelength, so isolation degrades at other wavelengths, as in real devices.',
    [
      wl('designWavelength', 'Design wavelength', 632.8, 'Optical', 'Wavelength at which the Faraday rotation is exactly 45 degrees.'),
      num('inputAxis', 'Input polarizer axis', 0, 'deg', -180, 180, 0.5, 'Polarization', 'Transmission axis of the input polarizer (0 = p, in the bench plane). The output polarizer sits at +45 degrees to it.'),
      num('fieldScale', 'Field scale', 1, '', -2, 2, 0.01, 'Optical', 'Multiplier on the magnet strength (1 = nominal 45 degree rotation, -1 reverses the isolator). Drivable.'),
      num('length', 'Rod length', 16, 'mm', 2, 200, 0.5, 'Geometry', 'Length of the TGG rod.'),
      num('aperture', 'Clear aperture', 8, 'mm', 1, 100, 0.5, 'Geometry', 'Diameter of the clear aperture.'),
      num('extinction', 'Polarizer extinction', 100000, ':1', 10, 1e7, 1, 'Polarization', 'Extinction ratio of the two polarizers; limits the achievable isolation.', true),
    ],
    ({ P }) => {
      const L = P.pos('length') / 2, h = P.pos('aperture') / 2;
      const tgg = getMaterial('tgg');
      const b = (Math.PI / 4 / (tgg.verdet(P.num('designWavelength')) * 2 * L * 1e-3)) * P.num('fieldScale');
      const a = P.num('inputAxis'), t1 = Math.sqrt(0.98), t2 = t1 / Math.sqrt(Math.max(1, P.num('extinction')));
      const x = L + 2;
      return {
        outline: polygon(rect(-L, -h, L, h)),
        body: { material: tgg, coating: 2, bLocal: b },
        surfaces: [
          { prim: face(2 * h, -x), kind: SK.JONES, role: 'surface', jones: polarizerJones(a, t1, t2) },
          { prim: face(2 * h, x), kind: SK.JONES, role: 'surface', jones: polarizerJones(a + 45, t1, t2) },
          { prim: seg(-x, -h - 3, -x, -h), kind: SK.THIN, role: 'absorber', rt: ABSORB },
          { prim: seg(-x, h, -x, h + 3), kind: SK.THIN, role: 'absorber', rt: ABSORB },
          { prim: seg(x, -h - 3, x, -h), kind: SK.THIN, role: 'absorber', rt: ABSORB },
          { prim: seg(x, h, x, h + 3), kind: SK.THIN, role: 'absorber', rt: ABSORB },
        ],
        decor: [
          { prims: [seg(-x, -h - 3, x, -h - 3)], closed: false, role: 'decor' },
          { prims: [seg(-x, h + 3, x, h + 3)], closed: false, role: 'decor' },
          // arrow marking the pass direction
          { pts: [-L * 0.6, -h - 3, L * 0.6, -h - 3, L * 0.6 - 2, -h - 4.5, L * 0.6, -h - 3, L * 0.6 - 2, -h - 1.5], closed: false, role: 'decor' },
        ],
        material: 'tgg',
      };
    }),

  // -------------------------------------------------------------------------
  define('field.gravity', 'Gravitational Lens', 'Exotic',
    'A compact mass bends light: far from the mass the deflection is alpha = 4GM / (c^2 b) = 2 r_s / b for impact parameter b (twice the Newtonian value - Einstein 1915). Rays are integrated through the exact optical metric of a Schwarzschild black hole in isotropic coordinates, n(r) = (1 + r_s/4r)^3 / (1 - r_s/4r), so strong-field effects (photon sphere, capture by the horizon) also appear. ILLUSTRATIVE SCALING: `strength` is the Einstein radius in mm - the impact parameter at which parallel rays are focused onto the axis at the chosen focal distance - giving r_s = R_E^2 / (2 D); a real mass with a millimetre-scale Schwarzschild radius would weigh about as much as the Earth. Unlike a glass lens, a gravitational lens bends rays MORE the closer they pass, so it has no single focus and forms Einstein rings; it is also perfectly achromatic. The field is truncated at the field radius.',
    [
      num('strength', 'Einstein radius', 10, 'mm', 0, 200, 0.1, 'Optical', 'Impact parameter of the rays that cross the axis at the focal distance. Drivable.'),
      num('focalDistance', 'Focal distance', 200, 'mm', 10, 5000, 1, 'Optical', 'Distance behind the mass at which rays passing at the Einstein radius cross the axis.'),
      num('radius', 'Field radius', 90, 'mm', 5, 2000, 1, 'Geometry', 'Radius of the region in which the curved-space ray integration is performed. Outside it rays travel straight.'),
    ],
    ({ P }) => {
      const RE = Math.max(0, P.num('strength')), D = P.pos('focalDistance', 1), R = P.pos('radius', 1);
      const rs = Math.min((RE * RE) / (2 * D), R * 0.5);
      return {
        surfaces: [{ prim: { k: 'arc', cx: 0, cy: 0, r: R, a0: 0, a1: 2 * Math.PI }, kind: SK.FIELD, role: 'decor' }],
        decor: [
          { pts: circlePts(Math.max(rs, 0.3), 24), closed: true, role: 'absorber' },   // event horizon (Schwarzschild radius)
          { pts: circlePts(RE, 64), closed: true, role: 'decor' },                      // Einstein radius
        ],
        gravity: { rs, radius: R },
      };
    }),

  // -------------------------------------------------------------------------
  define('fiber.cable', 'Optical Fiber', 'Fiber',
    'Step-index multimode fibre patch cable. Light striking the core of one end face within the acceptance cone (sin(theta) <= NA / n_ambient, NA = sqrt(n_core^2 - n_clad^2)) is guided by total internal reflection and re-emitted from the other end; rays outside the cone leak into the cladding and are lost. Transmission includes the Fresnel loss at both faces and attenuation (dB/km) - for silica the Rayleigh-scattering 1/lambda^4 law, the infrared absorption edge and the OH peak at 1383 nm. The exit angle keeps its magnitude but position and sign are mode-scrambled, and standard fibre depolarizes the light over a few metres (polarization-maintaining fibre does not). Works in both directions. Drag the `end` handle to move the second end.',
    [
      num('endX', 'End B x', 150, 'mm', -1e5, 1e5, 0.5, 'Geometry', 'World x coordinate of the second fibre end.'),
      num('endY', 'End B y', 0, 'mm', -1e5, 1e5, 0.5, 'Geometry', 'World y coordinate of the second fibre end.'),
      num('endRotation', 'End B direction', 0, 'deg', -180, 180, 1, 'Geometry', 'World direction in which end B emits light (0 = +x, 90 = +y / down).'),
      num('length', 'Fibre length', 2, 'm', 0.01, 100000, 0.01, 'Optical', 'Physical length of the fibre (independent of the drawn path); determines attenuation and depolarization.', true),
      num('coreDiameter', 'Core diameter', 1, 'mm', 0.005, 20, 0.005, 'Geometry', 'Diameter of the light-guiding core. Real fibres: 0.009 mm single-mode, 0.05-0.2 mm multimode silica, 1 mm polymer.', true),
      num('na', 'Numerical aperture', 0.39, '', 0.05, 0.9, 0.01, 'Optical', 'NA = sin of the maximum acceptance half-angle in air. 0.22 and 0.39 are common for silica multimode fibre, 0.5 for polymer fibre.'),
      num('coreIndex', 'Core index', 1.4585, '', 1.2, 2.5, 0.0005, 'Optical', 'Refractive index of the core (fused silica 1.4585, PMMA 1.492); sets the Fresnel loss at the end faces.'),
      sel('attenuationModel', 'Attenuation model', 'silica', [['silica', 'Silica (wavelength dependent)'], ['constant', 'Constant (value below)']], 'Optical', 'Silica: Rayleigh 0.8/lambda^4 dB/km + IR edge + OH peak (0.17 dB/km at 1550 nm, ~5 dB/km at 633 nm, ~30 dB/km at 400 nm).'),
      num('attenuation', 'Attenuation', 150, 'dB/km', 0, 1e5, 0.1, 'Optical', 'Used with the constant model (PMMA polymer fibre: ~150 dB/km at 650 nm).', true),
      bool('pm', 'Polarization maintaining', false, 'Polarization', 'If off, the polarization is scrambled with a 1/e depolarization length of 2 m. If on, the polarization state is preserved.'),
    ],
    ({ c, P, xf }) => {
      const core = P.pos('coreDiameter', 1e-3), fer = Math.max(2.5, core * 1.8), cr = core / 2, fr = fer / 2;
      const B = { x: P.num('endX'), y: P.num('endY') };
      const xb = makeXf(B, P.num('endRotation') * DEG);
      const surfaces: SurfSpec[] = [
        // End A: outward normal = local -x (segment reversed so that the canonical normal points outward)
        { prim: seg(0, cr, 0, -cr), kind: SK.FIBER, role: 'surface', end: 0 },
        { prim: seg(0, -fr, 0, -cr), kind: SK.THIN, role: 'absorber', rt: ABSORB },
        { prim: seg(0, cr, 0, fr), kind: SK.THIN, role: 'absorber', rt: ABSORB },
        // End B: outward normal = its local +x
        { prim: seg(0, -cr, 0, cr), kind: SK.FIBER, role: 'surface', end: 1, xf: xb },
        { prim: seg(0, -fr, 0, -cr), kind: SK.THIN, role: 'absorber', rt: ABSORB, xf: xb },
        { prim: seg(0, cr, 0, fr), kind: SK.THIN, role: 'absorber', rt: ABSORB, xf: xb },
      ];
      // cable: cubic Bezier leaving each ferrule along its axis (world coordinates)
      const a0 = toWorld(xf, 10, 0), b0 = toWorld(xb, -10, 0);
      const k = Math.max(15, Math.hypot(b0.x - a0.x, b0.y - a0.y) / 3);
      const a1 = toWorld(xf, 10 + k, 0), b1 = toWorld(xb, -10 - k, 0);
      const cable: number[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, u = 1 - t;
        cable.push(
          u * u * u * a0.x + 3 * u * u * t * a1.x + 3 * u * t * t * b1.x + t * t * t * b0.x,
          u * u * u * a0.y + 3 * u * u * t * a1.y + 3 * u * t * t * b1.y + t * t * t * b0.y);
      }
      const ferA: Prim[] = [seg(0, -fr, 10, -fr), seg(10, -fr, 10, fr), seg(10, fr, 0, fr)];
      const ferB: Prim[] = [seg(0, -fr, -10, -fr), seg(-10, -fr, -10, fr), seg(-10, fr, 0, fr)];
      void c;
      return {
        surfaces,
        decor: [
          { prims: ferA, closed: false, role: 'decor' },
          { prims: ferB, closed: false, role: 'decor', xf: xb },
          { pts: cable, closed: false, role: 'decor', xf: { px: 0, py: 0, cs: 1, sn: 0 } },
        ],
        fiber: { nCore: Math.max(1.01, P.num('coreIndex')), na: Math.min(0.95, P.pos('na', 0.01)), lengthM: P.pos('length', 1e-3), model: P.str('attenuationModel'), attDb: Math.max(0, P.num('attenuation')), pm: P.bool('pm') },
        handles: [{ key: 'end', p: B }],
      };
    }),

  // -------------------------------------------------------------------------
  define('nonlinear.shg', 'SHG Crystal', 'Nonlinear',
    'Frequency-doubling crystal (second-harmonic generation): two photons of the fundamental combine into one photon of half the wavelength, e.g. infrared 1064 nm -> green 532 nm. The conversion efficiency grows with the beam power, eta = tanh^2(sqrt(kappa P)) (pump depletion included), and is limited to the phase-matching bandwidth by a sinc^2 acceptance curve. The second harmonic is generated collinearly, polarized perpendicular to the fundamental (type-I phase matching); the unconverted fundamental continues as well. kappa is idealised - real crystals need focused or pulsed beams to reach percent-level efficiencies.',
    [
      num('length', 'Crystal length', 10, 'mm', 0.5, 100, 0.5, 'Geometry', 'Extent along local x.'),
      num('height', 'Aperture', 8, 'mm', 0.5, 100, 0.5, 'Geometry', 'Extent along local y.'),
      wl('phaseMatchWavelength', 'Phase-matched wavelength', 1064, 'Optical', 'Fundamental wavelength for which the crystal is cut (phase matched).'),
      num('acceptanceBandwidth', 'Acceptance bandwidth', 30, 'nm', 0.1, 500, 0.1, 'Optical', 'FWHM of the sinc^2 phase-matching curve.'),
      num('efficiency', 'Conversion coefficient kappa', 50, '1/W', 0, 1e5, 0.1, 'Optical', 'Low-power conversion efficiency per watt of fundamental (eta ~ kappa P for small P).', true),
      ...matParams('bbo'),
      { ...COATING_PARAM, default: 'ideal' },
    ],
    ({ P }): Built => {
      const L = P.pos('length') / 2, h = P.pos('height') / 2;
      return {
        outline: polygon(rect(-L, -h, L, h)),
        body: { material: resolveMat(P), coating: coatingCode(P.str('coating')), shg: { kappa: Math.max(0, P.num('efficiency')), pm: P.num('phaseMatchWavelength'), bw: P.pos('acceptanceBandwidth', 0.01) } },
        material: P.str('material'),
      };
    }),
];
