/** Thin planar elements: gratings, polarization optics, apertures, filters, absorbers, detectors. */
import type { ParamDef } from '../../types';
import { SK } from '../geometry';
import { DEG, SIZE, bool, define, face, num, polygon, rect, seg, sel, wl, type SurfSpec, type TypeDef } from './common';

const ABSORB = (_l: number, o: Float64Array) => { o[0] = 0; o[1] = 0; };

// ---------------------------------------------------------------------------
// Diffraction gratings
// ---------------------------------------------------------------------------

const GRATING_PARAMS: ParamDef[] = [
  SIZE(30),
  num('linesPerMm', 'Groove density', 600, 'lines/mm', 10, 3600, 10, 'Optical', 'Number of grooves per millimetre. The grating period is d = 1/density; orders obey d(sin theta_m - sin theta_i) = m lambda.'),
  num('eff0', 'Efficiency order 0', 0.3, '', 0, 1, 0.01, 'Optical', 'Relative power in the undiffracted (zero) order.'),
  num('eff1', 'Efficiency orders +-1', 0.25, '', 0, 1, 0.01, 'Optical', 'Relative power in each first order.'),
  num('eff2', 'Efficiency orders +-2', 0.1, '', 0, 1, 0.01, 'Optical', 'Relative power in each second order.'),
];

const gratingSurf = (P: { pos(k: string): number; num(k: string): number }, reflect: boolean): SurfSpec => ({
  prim: face(P.pos('size')), kind: SK.GRATING, role: reflect ? 'mirror' : 'surface',
  p1: 1e6 / Math.max(1, P.num('linesPerMm')), p2: Math.max(0, P.num('eff0')), p3: Math.max(0, P.num('eff1')), p4: Math.max(0, P.num('eff2')), end: reflect ? 1 : 0,
});

const GRATINGS: TypeDef[] = [
  define('grating.transmission', 'Transmission Grating', 'Diffraction',
    'Periodic structure that splits light into diffraction orders m = -2..+2 on the far side. Each order leaves at the angle given exactly by the grating equation sin(theta_m) = sin(theta_i) + m lambda / d, so long wavelengths are deflected more - the opposite ordering to a prism. Orders that would need |sin| > 1 are evanescent and their power is redistributed to the propagating orders.',
    GRATING_PARAMS, ({ P }) => ({ surfaces: [gratingSurf(P, false)] })),
  define('grating.reflection', 'Reflection Grating', 'Diffraction',
    'Ruled or holographic reflective grating: the diffraction orders m = -2..+2 appear on the same side as the incident light. Order 0 is the ordinary specular reflection; the others follow the grating equation and form spectra, as used in spectrometers and monochromators.',
    GRATING_PARAMS, ({ P }) => ({ surfaces: [gratingSurf(P, true)] })),
];

// ---------------------------------------------------------------------------
// Polarization optics. Jones matrices are expressed in the (p, s) basis of the ray, with
// p = in the bench plane and s = perpendicular to it; angles are measured from p towards s as
// seen for light travelling along local +x. For light travelling the other way the element is
// seen mirror-reversed (angle -> 180 deg - angle).
// ---------------------------------------------------------------------------

function retarder(fastDeg: number, turns: number, designNm: number, order: number) {
  return (l: number, forward: boolean, M: Float64Array) => {
    const th = (forward ? fastDeg : 180 - fastDeg) * DEG;
    const c = Math.cos(th), s = Math.sin(th);
    // true zero/multi-order plate: retardance scales as 1/lambda (birefringence dispersion neglected)
    const g = (2 * Math.PI * (order + turns) * designNm) / l;
    const er = Math.cos(g), ei = Math.sin(g);
    M[0] = c * c + er * s * s; M[1] = ei * s * s;
    M[2] = (1 - er) * s * c; M[3] = -ei * s * c;
    M[4] = M[2]; M[5] = M[3];
    M[6] = s * s + er * c * c; M[7] = ei * c * c;
  };
}

const WP_PARAMS = (fast: number): ParamDef[] => [
  SIZE(25),
  num('fastAxis', 'Fast axis angle', fast, 'deg', -180, 180, 0.5, 'Polarization', 'Orientation of the fast axis: 0 deg = in the bench plane (p), 90 deg = perpendicular (s).'),
  wl('designWavelength', 'Design wavelength', 632.8, 'Polarization', 'Wavelength at which the retardance has its nominal value. At other wavelengths the retardance scales as 1/lambda.'),
  num('order', 'Plate order', 0, '', 0, 30, 1, 'Polarization', '0 = true zero-order plate. Multi-order plates add whole waves of retardance and are far more wavelength sensitive.'),
];

const POLARIZATION: TypeDef[] = [
  define('polarizer.linear', 'Linear Polarizer', 'Polarization',
    'Transmits the electric-field component along its transmission axis and absorbs the orthogonal one. For linearly polarized input the transmitted power follows Malus\'s law, I = I0 cos^2(theta); unpolarized light is reduced to 50 %. The finite extinction ratio lets a small fraction of the blocked component through.',
    [
      SIZE(30),
      num('angle', 'Transmission axis', 0, 'deg', -180, 180, 0.5, 'Polarization', 'Orientation of the transmission axis: 0 deg = p (in the bench plane), 90 deg = s (perpendicular to the bench).'),
      num('transmission', 'Peak transmission', 0.95, '', 0, 1, 0.005, 'Polarization', 'Power transmission for light polarized along the axis.'),
      num('extinction', 'Extinction ratio', 10000, ':1', 1, 1e7, 1, 'Polarization', 'Ratio of transmission along the axis to transmission across it (10 000:1 is typical for film polarizers, 100 000:1 for Glan prisms).', true),
    ],
    ({ P }) => {
      const ang = P.num('angle');
      const t1 = Math.sqrt(Math.min(1, Math.max(0, P.num('transmission'))));
      const t2 = t1 / Math.sqrt(Math.max(1, P.num('extinction')));
      return {
        surfaces: [{
          prim: face(P.pos('size')), kind: SK.JONES, role: 'surface',
          jones: (_l, forward, M) => {
            const th = (forward ? ang : 180 - ang) * DEG;
            const c = Math.cos(th), s = Math.sin(th);
            M[0] = t1 * c * c + t2 * s * s; M[1] = 0;
            M[2] = (t1 - t2) * c * s; M[3] = 0;
            M[4] = M[2]; M[5] = 0;
            M[6] = t1 * s * s + t2 * c * c; M[7] = 0;
          },
        }],
      };
    }),

  define('waveplate.half', 'Half-Wave Plate', 'Polarization',
    'Birefringent plate that delays the slow-axis component by half a wavelength. Linear polarization is mirrored about the fast axis, i.e. rotated by twice the angle between the polarization and the axis (a plate at 22.5 deg rotates p-polarization to 45 deg; at 45 deg it converts p to s). Circular polarization changes handedness.',
    WP_PARAMS(22.5),
    ({ P }) => ({ surfaces: [{ prim: face(P.pos('size')), kind: SK.JONES, role: 'surface', jones: retarder(P.num('fastAxis'), 0.5, P.num('designWavelength'), Math.max(0, Math.round(P.num('order')))) }] })),

  define('waveplate.quarter', 'Quarter-Wave Plate', 'Polarization',
    'Birefringent plate with a quarter-wave (90 degree) phase delay between fast and slow axis. Linear polarization at 45 degrees to the axis becomes circular (the displayed degree of linear polarization drops to zero) and vice versa. Two passes act as a half-wave plate - the basis of optical isolators using a mirror.',
    WP_PARAMS(45),
    ({ P }) => ({ surfaces: [{ prim: face(P.pos('size')), kind: SK.JONES, role: 'surface', jones: retarder(P.num('fastAxis'), 0.25, P.num('designWavelength'), Math.max(0, Math.round(P.num('order')))) }] })),
];

// ---------------------------------------------------------------------------
// Apertures, shutter, absorber
// ---------------------------------------------------------------------------

function apertureSurfs(size: number, gap: number): SurfSpec[] {
  const h = size / 2, g = Math.min(gap, size) / 2;
  if (g >= h) return [];
  return [
    { prim: seg(0, -h, 0, -g), kind: SK.THIN, role: 'aperture', rt: ABSORB },
    { prim: seg(0, g, 0, h), kind: SK.THIN, role: 'aperture', rt: ABSORB },
  ];
}

/** Openings wider than this are treated geometrically even in wave mode (diffraction is negligible on a bench scale). */
export const WAVE_APERTURE_MAX_MM = 2;

/**
 * Opaque screen of height `size` with openings [centre y, width] (mm, local y).
 * Ray mode: absorbing strips between the openings. Wave mode (all openings <= 2 mm): one plane
 * that records the incident field and re-radiates Huygens-Fresnel fans from the openings.
 */
export function screenWithOpenings(size: number, openings: [number, number][], wave: boolean): SurfSpec[] {
  const h = size / 2;
  const iv = openings
    .map(([c, w]) => [Math.max(-h, c - w / 2), Math.min(h, c + w / 2)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  // merge overlapping openings
  const open: [number, number][] = [];
  for (const o of iv) {
    const last = open[open.length - 1];
    if (last && o[0] <= last[1]) last[1] = Math.max(last[1], o[1]); else open.push([o[0], o[1]]);
  }
  if (wave && open.length && open.every(([a, b]) => b - a <= WAVE_APERTURE_MAX_MM)) {
    return [{ prim: seg(0, -h, 0, h), kind: SK.WAVEAP, role: 'aperture', open: open.map(([a, b]) => [a + h, b + h] as [number, number]) }];
  }
  const out: SurfSpec[] = [];
  let y = -h;
  for (const [a, b] of open) {
    if (a - y > 1e-9) out.push({ prim: seg(0, y, 0, a), kind: SK.THIN, role: 'aperture', rt: ABSORB });
    y = b;
  }
  if (h - y > 1e-9) out.push({ prim: seg(0, y, 0, h), kind: SK.THIN, role: 'aperture', rt: ABSORB });
  return out;
}

const APERTURES: TypeDef[] = [
  define('aperture.slit', 'Slit', 'Apertures & Filters',
    'Opaque screen with a narrow opening. Geometrically it simply clips the beam. With diffraction enabled every transmitted ray is spread into the Fraunhofer single-slit pattern I ~ sinc^2(pi a sin(theta) / lambda): the narrower the slit, the wider the pattern (first minimum at sin(theta) = lambda / a).',
    [
      num('width', 'Slit width', 1, 'mm', 0.001, 100, 0.001, 'Geometry', 'Width of the opening.', true),
      SIZE(40, 'Total height of the opaque screen.'),
      bool('diffraction', 'Simulate diffraction', false, 'Optical', 'Spread transmitted rays into the single-slit Fraunhofer pattern (13 rays sampling the central lobe and the first two side lobes on each side). Only noticeable for slits narrower than ~0.1 mm.'),
    ],
    ({ P, settings }) => {
      const size = P.pos('size'), w = Math.min(P.pos('width', 1e-4), size);
      // wave mode: true Huygens-Fresnel diffraction (replaces the ray-mode Fraunhofer sampling)
      if (settings.waveMode && w <= WAVE_APERTURE_MAX_MM && w < size) return { surfaces: screenWithOpenings(size, [[0, w]], true) };
      const surfaces = apertureSurfs(size, w);
      if (P.bool('diffraction')) surfaces.push({ prim: seg(0, -w / 2, 0, w / 2), kind: SK.DIFFRACT, role: 'decor', p1: w, hidden: true });
      return { surfaces };
    }),

  define('aperture.double_slit', 'Double / Multiple Slit', 'Apertures & Filters',
    'Opaque screen with N equally spaced parallel slits (N = 2: Young\'s double slit). In ray mode it simply clips the beam. With wave optics enabled (scene setting waveMode) the incident field is sampled across every slit and each slit re-radiates Huygens-Fresnel secondary waves (a deterministic fan of rays with the obliquity factor (1 + cos chi)/2 and the exact phase); a screen behind then shows the interference pattern: fringe spacing lambda L / d under the single-slit envelope sinc^2(pi a sin(theta) / lambda), with N - 2 subsidiary maxima between the principal maxima for N slits. The illuminating beam must be wide enough to cover the slits.',
    [
      num('width', 'Slit width a', 0.05, 'mm', 0.001, 2, 0.001, 'Geometry', 'Width of each slit.', true),
      num('separation', 'Slit separation d', 0.25, 'mm', 0.002, 20, 0.001, 'Geometry', 'Centre-to-centre distance of neighbouring slits. Fringe spacing on a screen at distance L is lambda L / d.', true),
      num('slits', 'Number of slits N', 2, '', 1, 20, 1, 'Geometry', '1 = single slit, 2 = Young double slit, more = multiple-slit interference (sharper principal maxima).'),
      SIZE(40, 'Total height of the opaque screen.'),
    ],
    ({ P, settings }) => {
      const size = P.pos('size');
      const N = Math.max(1, Math.min(20, Math.round(P.num('slits'))));
      const d = P.pos('separation', 1e-3), w = Math.min(P.pos('width', 1e-4), N > 1 ? d * 0.98 : size);
      const open: [number, number][] = [];
      for (let i = 0; i < N; i++) open.push([(i - (N - 1) / 2) * d, w]);
      return { surfaces: screenWithOpenings(size, open, !!settings.waveMode) };
    }),

  define('aperture.iris', 'Iris Diaphragm', 'Apertures & Filters',
    'Adjustable circular aperture (in this 2D bench: an adjustable opening). Rays outside the opening are absorbed. Stopping down a lens with an iris removes the marginal rays and thereby reduces spherical aberration at the cost of brightness.',
    [
      num('diameter', 'Opening diameter', 8, 'mm', 0, 200, 0.1, 'Geometry', 'Diameter of the clear opening. Can be driven from a circuit.'),
      SIZE(40, 'Outer diameter of the iris housing.'),
    ],
    ({ P, settings }) => {
      const size = P.pos('size'), dia = Math.max(0, P.num('diameter'));
      if (settings.waveMode && dia > 0 && dia <= WAVE_APERTURE_MAX_MM && dia < size) return { surfaces: screenWithOpenings(size, [[0, dia]], true) };
      return { surfaces: apertureSurfs(size, dia) };
    }),

  define('aperture.shutter', 'Shutter / Modulator', 'Apertures & Filters',
    'Electrically controllable beam gate. In "attenuate" mode it transmits the fraction `open` of the incident power (like an acousto-optic or liquid-crystal modulator); in "blade" mode a mechanical blade covers the fraction (1 - open) of the aperture. Drive the `open` property from a circuit to chop or modulate a beam.',
    [
      num('open', 'Open fraction', 1, '', 0, 1, 0.01, 'Optical', '0 = closed, 1 = fully open. Drivable from the circuit (actuator link, target prop "open").'),
      sel('mode', 'Mode', 'attenuate', [['attenuate', 'Attenuate (transmission = open)'], ['blade', 'Mechanical blade']], 'Optical', 'How the open fraction acts on the beam.'),
      SIZE(30),
    ],
    ({ P }) => {
      const size = P.pos('size'), open = Math.min(1, Math.max(0, P.num('open')));
      const frame = [
        { prims: [seg(-2, -size / 2, 2, -size / 2)], closed: false, role: 'decor' as const },
        { prims: [seg(-2, size / 2, 2, size / 2)], closed: false, role: 'decor' as const },
      ];
      if (P.str('mode') === 'blade') {
        const cover = (1 - open) * size;
        return { surfaces: cover > 1e-9 ? [{ prim: seg(0, -size / 2, 0, -size / 2 + cover), kind: SK.THIN, role: 'aperture', rt: ABSORB }] : [], decor: frame };
      }
      return { surfaces: [{ prim: face(size), kind: SK.THIN, role: 'aperture', rt: (_l, o) => { o[0] = 0; o[1] = open; } }], decor: frame };
    }),

  define('absorber.block', 'Beam Dump', 'Apertures & Filters',
    'Perfectly black block that absorbs all light striking it. Use it to terminate unwanted beams and reflections safely.',
    [
      num('width', 'Width', 8, 'mm', 0.5, 500, 0.5, 'Geometry', 'Extent along local x.'),
      num('height', 'Height', 40, 'mm', 0.5, 1000, 0.5, 'Geometry', 'Extent along local y.'),
    ],
    ({ P }) => {
      const w = P.pos('width') / 2, h = P.pos('height') / 2;
      const prims = polygon(rect(-w, -h, w, h));
      return {
        surfaces: prims.map((prim) => ({ prim, kind: SK.THIN, role: 'absorber' as const, rt: ABSORB, hidden: true })),
        decor: [{ prims, closed: true, role: 'absorber' }],
      };
    }),
];

// ---------------------------------------------------------------------------
// Filters (absorptive: rejected light is absorbed)
// ---------------------------------------------------------------------------

const edge = (cut: number, width: number, peak: number, sgn: number) => {
  const w = Math.max(0.05, width) / 4.394; // 10-90 % width of a logistic edge
  return (l: number, o: Float64Array) => { o[0] = 0; o[1] = peak / (1 + Math.exp((-sgn * (l - cut)) / w)); };
};
const PEAK = (def: number) => num('peak', 'Peak transmission', def, '', 0, 1, 0.01, 'Optical', 'Transmission in the pass band.');
const EDGE_W = num('edgeWidth', 'Edge width (10-90 %)', 12, 'nm', 0.5, 200, 0.5, 'Optical', 'Spectral width over which the transmission rises from 10 % to 90 % of its peak.');

const FILTERS: TypeDef[] = [
  define('filter.bandpass', 'Bandpass Filter', 'Apertures & Filters',
    'Interference filter that transmits a narrow band around the centre wavelength. The pass band has the flat-topped Butterworth shape of a multi-cavity Fabry-Perot design, T = Tpeak / (1 + (2 (lambda - lambda0) / FWHM)^(2N)), where N is the number of cavities. Light outside the band is blocked.',
    [
      SIZE(30), wl('center', 'Centre wavelength', 550, 'Optical', 'Wavelength of maximum transmission.'),
      num('fwhm', 'Bandwidth (FWHM)', 20, 'nm', 0.5, 400, 0.5, 'Optical', 'Full width at half maximum of the pass band.'),
      PEAK(0.9),
      num('cavities', 'Cavities', 2, '', 1, 6, 1, 'Optical', 'Number of coupled cavities; more cavities give steeper edges and a flatter top.'),
    ],
    ({ P }) => {
      const c = P.num('center'), hw = P.pos('fwhm', 0.05) / 2, peak = Math.min(1, Math.max(0, P.num('peak')));
      const N = Math.max(1, Math.min(6, Math.round(P.num('cavities'))));
      return { surfaces: [{ prim: face(P.pos('size')), kind: SK.THIN, role: 'surface', rt: (l, o) => { o[0] = 0; o[1] = peak / (1 + Math.pow(Math.abs(l - c) / hw, 2 * N)); } }] };
    }),
  define('filter.longpass', 'Longpass Filter', 'Apertures & Filters',
    'Coloured-glass / edge filter that transmits wavelengths longer than the cut-off and absorbs shorter ones, with a smooth sigmoidal edge.',
    [SIZE(30), wl('cutoff', 'Cut-off wavelength', 550, 'Optical', '50 % transmission point.'), EDGE_W, PEAK(0.92)],
    ({ P }) => ({ surfaces: [{ prim: face(P.pos('size')), kind: SK.THIN, role: 'surface', rt: edge(P.num('cutoff'), P.num('edgeWidth'), Math.min(1, Math.max(0, P.num('peak'))), 1) }] })),
  define('filter.shortpass', 'Shortpass Filter', 'Apertures & Filters',
    'Edge filter that transmits wavelengths shorter than the cut-off and blocks longer ones (e.g. a heat-absorbing filter that removes infrared).',
    [SIZE(30), wl('cutoff', 'Cut-off wavelength', 550, 'Optical', '50 % transmission point.'), EDGE_W, PEAK(0.92)],
    ({ P }) => ({ surfaces: [{ prim: face(P.pos('size')), kind: SK.THIN, role: 'surface', rt: edge(P.num('cutoff'), P.num('edgeWidth'), Math.min(1, Math.max(0, P.num('peak'))), -1) }] })),
  define('filter.nd', 'Neutral Density Filter', 'Apertures & Filters',
    'Attenuates all wavelengths equally. The optical density OD gives the transmission T = 10^(-OD): OD 1 passes 10 %, OD 2 passes 1 %, OD 3 passes 0.1 %. Densities of stacked filters add.',
    [SIZE(30), num('opticalDensity', 'Optical density', 1, 'OD', 0, 8, 0.1, 'Optical', 'T = 10^(-OD).')],
    ({ P }) => { const T = Math.pow(10, -Math.max(0, P.num('opticalDensity'))); return { surfaces: [{ prim: face(P.pos('size')), kind: SK.THIN, role: 'surface', rt: (_l, o) => { o[0] = 0; o[1] = T; } }] }; }),
];

// ---------------------------------------------------------------------------
// Detectors. The sensitive face looks towards local -x.
// ---------------------------------------------------------------------------

const back = (size: number, depth: number) => ({ prims: [seg(0, -size / 2, depth, -size / 2), seg(depth, -size / 2, depth, size / 2), seg(depth, size / 2, 0, size / 2)], closed: false, role: 'decor' as const });

const DETECTORS: TypeDef[] = [
  define('detector.power', 'Power Meter', 'Detectors',
    'Thermal power-meter head: absorbs all light that reaches its sensitive face (facing local -x) and reports the total optical power in watts, independent of wavelength. Light striking the housing from behind is absorbed but not counted.',
    [SIZE(20, 'Height of the sensitive area.')],
    ({ P }) => ({
      surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
      decor: [back(P.pos('size'), 8)], detector: { kind: 'power', bins: 0, range: [380, 780] },
    })),
  define('detector.screen', 'Screen', 'Detectors',
    'Observation screen. Records where every ray lands, a binned 1D intensity profile along the screen and the wavelength of each hit, so spectra, images, focal spots and diffraction patterns can be displayed in colour. Both sides are sensitive.',
    [
      SIZE(60, 'Height of the screen.'),
      num('bins', 'Profile bins', 64, '', 4, 1024, 1, 'Optical', 'Number of bins of the intensity profile across the screen.'),
    ],
    ({ P, settings }) => ({
      surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 0 }],
      // wave mode needs a fine profile to resolve interference fringes
      detector: { kind: 'screen', bins: Math.max(settings.waveMode ? 512 : 4, Math.min(1024, Math.round(P.num('bins')))), range: [380, 780] },
    })),
  define('detector.camera', 'Line Camera', 'Detectors',
    'Linear image sensor (CCD / CMOS line camera) facing local -x. The sensor is `pixels` x `pitch` long; every pixel integrates the light falling on it. The reading contains the pixel signal as `profile` (0..1, clipped at saturation) and its colour as `profileRGB`; `power` is the total optical power on the sensor. Signal = power x exposure x gain / saturation energy, or scaled automatically to a 0.9 peak with auto-exposure. With wave optics enabled the pixels record interference fringes and diffraction patterns.',
    [
      num('pixels', 'Pixels', 512, '', 16, 1024, 1, 'Geometry', 'Number of pixels along the sensor.'),
      num('pitch', 'Pixel pitch', 20, 'um', 1, 500, 0.5, 'Geometry', 'Centre-to-centre pixel spacing; sensor length = pixels x pitch.'),
      bool('autoExposure', 'Auto exposure', true, 'Optical', 'Scale the signal so that the brightest pixel reads 0.9. If off, exposure time, gain and the saturation energy set the signal.'),
      num('exposure', 'Exposure time', 0.001, 's', 1e-6, 10, 1e-6, 'Optical', 'Integration time (used when auto exposure is off).', true),
      num('gain', 'Gain', 1, 'x', 0.1, 100, 0.1, 'Optical', 'Analogue gain (used when auto exposure is off).', true),
      num('saturation', 'Saturation energy', 1e-9, 'J', 1e-15, 1e-3, 1e-12, 'Optical', 'Optical energy per pixel that gives full-scale signal (1.0).', true),
    ],
    ({ P }) => {
      const n = Math.max(16, Math.min(1024, Math.round(P.num('pixels'))));
      const size = n * P.pos('pitch', 0.1) * 1e-3;
      return {
        surfaces: [{ prim: face(size), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
        decor: [back(size, 6)],
        detector: { kind: 'camera', bins: n, range: [380, 780], cam: { exposure: P.pos('exposure', 1e-9), gain: P.pos('gain', 1e-6), sat: P.pos('saturation', 1e-18), auto: P.bool('autoExposure') } },
      };
    }),
  define('detector.polarimeter', 'Polarimeter', 'Detectors',
    'Measures the complete polarization state of the light entering its aperture (facing local -x) and reports the Stokes parameters: s0 = total power (W); s1 (p versus s), s2 (+45 versus -45 degrees) and s3 (right versus left circular) normalised to s0; the degree of polarization dop = sqrt(s1^2 + s2^2 + s3^2); and the azimuth and ellipticity angle of the polarization ellipse (radians). Unpolarized light gives dop = 0, any pure state dop = 1.',
    [SIZE(15, 'Height of the entrance aperture.')],
    ({ P }) => ({
      surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
      decor: [back(P.pos('size'), 12)], detector: { kind: 'polarimeter', bins: 0, range: [380, 780] },
    })),
  define('detector.wavemeter', 'Wavemeter', 'Detectors',
    'Measures the power-weighted mean vacuum wavelength of the light entering its aperture (facing local -x) and an estimate of the spectral linewidth (FWHM, from the spread of the spectral samples combined with the source line width). Useful for checking lasers, filters and frequency-doubled beams.',
    [SIZE(10, 'Height of the entrance aperture.')],
    ({ P }) => ({
      surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
      decor: [back(P.pos('size'), 10)], detector: { kind: 'wavemeter', bins: 0, range: [380, 780] },
    })),
  define('detector.spectrometer', 'Spectrometer', 'Detectors',
    'Fibre-input style spectrometer: absorbs the light entering its aperture (facing local -x) and reports the spectral power distribution in equal-width wavelength bins between the adjustable range limits (default 380-780 nm), plus the total power.',
    [
      SIZE(15, 'Height of the entrance aperture.'),
      num('bins', 'Spectral bins', 80, '', 8, 1024, 1, 'Optical', 'Number of wavelength bins (80 bins over 380-780 nm = 5 nm resolution).'),
      num('wavelengthMin', 'Range start', 380, 'nm', 200, 2000, 1, 'Optical', 'Short-wavelength limit of the recorded spectrum (swapped with the end if larger). Light outside the range still counts towards the total power.'),
      num('wavelengthMax', 'Range end', 780, 'nm', 200, 2000, 1, 'Optical', 'Long-wavelength limit of the recorded spectrum.'),
    ],
    ({ P }) => {
      let a = P.num('wavelengthMin'), b = P.num('wavelengthMax');
      if (a > b) { const t = a; a = b; b = t; }
      if (b - a < 1) b = a + 1;
      return {
        surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
        decor: [back(P.pos('size'), 14)], detector: { kind: 'spectrometer', bins: Math.max(8, Math.min(1024, Math.round(P.num('bins')))), range: [a, b] },
      };
    }),
  define('detector.photodiode', 'Photodiode', 'Detectors',
    'Photodiode active area (facing local -x). Absorbs the incident light and reports its optical power; link it to a circuit photodiode, LDR or solar cell to convert that power into photocurrent (the responsivity in A/W is a property of the circuit component).',
    [SIZE(5, 'Height of the active area.')],
    ({ P }) => ({
      surfaces: [{ prim: face(P.pos('size')), kind: SK.DETECTOR, role: 'detector', flip: true, p1: 1 }],
      decor: [back(P.pos('size'), 4)], detector: { kind: 'photodiode', bins: 0, range: [380, 780] },
    })),
];

export const THIN_TYPES: TypeDef[] = [...GRATINGS, ...POLARIZATION, ...APERTURES, ...FILTERS, ...DETECTORS];
