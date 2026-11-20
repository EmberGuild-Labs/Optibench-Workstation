/** Light sources. All emit from the local origin towards local +x. */
import type { ParamDef } from '../../types';
import { planck } from '../color';
import { DEG, bool, define, num, polygon, rect, seg, sel, wl, type Props, type SourceSpec, type TypeDef } from './common';

const G = 'Source';

// ---- spectra ----------------------------------------------------------------

/** `bw`: width (nm) of the sub-band each sample represents (wave-mode coherence); 0 / missing = line. */
export interface Spectrum { wl: number[]; w: number[]; bw?: number }

function normalise(wls: number[], w: number[], bw = 0): Spectrum {
  let s = 0;
  for (const v of w) s += v;
  if (!(s > 0)) return { wl: [wls[Math.floor(wls.length / 2)] ?? 550], w: [1], bw };
  return { wl: wls, w: w.map((v) => v / s), bw };
}
const bwList = (sp: Spectrum): number[] => sp.wl.map(() => sp.bw ?? 0);

/** Sample a spectral power density over the visible band 380-780 nm at S bin centres. */
export function bandSpectrum(S: number, fn: (nm: number) => number, lo = 380, hi = 780): Spectrum {
  const n = Math.max(1, Math.round(S));
  const wls: number[] = [], w: number[] = [];
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  for (let k = 0; k < n; k++) {
    const l = lo + ((k + 0.5) * (hi - lo)) / n;
    wls.push(l); w.push(Math.max(0, fn(l)));
  }
  return normalise(wls, w, (hi - lo) / n);
}

/** Gaussian line of given FWHM sampled at S points over +-1.3 FWHM. */
export function gaussSpectrum(center: number, fwhm: number, S: number): Spectrum {
  const n = Math.max(1, Math.round(S));
  if (fwhm < 0.02 || n === 1) return { wl: [center], w: [1] };
  const sigma = fwhm / 2.35482;
  const wls: number[] = [], w: number[] = [];
  for (let k = 0; k < n; k++) {
    const l = center + ((k + 0.5) / n - 0.5) * 2.6 * fwhm;
    wls.push(l); w.push(Math.exp(-0.5 * ((l - center) / sigma) ** 2));
  }
  return normalise(wls, w, (2.6 * fwhm) / n);
}

/** Phosphor-converted white LED: narrow InGaN blue pump (450 nm) + broad YAG:Ce phosphor emission. */
export function whiteLedSpd(nm: number): number {
  const g = (c: number, f: number) => Math.exp(-0.5 * ((nm - c) / (f / 2.35482)) ** 2);
  return 1.0 * g(450, 22) + 0.62 * g(555, 110) + 0.18 * g(610, 90);
}

export function spectrumByName(name: string, S: number, wavelength: number, kelvin: number, lo = 380, hi = 780): Spectrum {
  switch (name) {
    case 'blackbody': return bandSpectrum(S, (l) => planck(l, kelvin), lo, hi);
    case 'white_led': return bandSpectrum(S, whiteLedSpd, lo, hi);
    case 'flat': return bandSpectrum(S, () => 1, lo, hi);
    default: return { wl: [wavelength], w: [1] };
  }
}

// ---- polarisation -----------------------------------------------------------

export function polState(mode: string, angleDeg: number): [number, number, number, number] {
  if (mode === 'linear') {
    const c = Math.cos(angleDeg * DEG), s = Math.sin(angleDeg * DEG);
    return [c * c, s * s, c * s, 0];
  }
  if (mode === 'circular_l') return [0.5, 0.5, 0, 0.5];
  if (mode === 'circular_r') return [0.5, 0.5, 0, -0.5];
  return [0.5, 0.5, 0, 0];
}

const polParams = (def: string): ParamDef[] => [
  sel('polarization', 'Polarization', def, [['unpolarized', 'Unpolarized'], ['linear', 'Linear'], ['circular_l', 'Circular (left)'], ['circular_r', 'Circular (right)']],
    'Polarization', 'Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly.'),
  num('polAngle', 'Polarization angle', 0, 'deg', -180, 180, 1, 'Polarization', 'Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench).'),
];

const BAND: ParamDef[] = [
  num('wavelengthMin', 'Band start', 380, 'nm', 200, 2000, 1, G, 'Short-wavelength limit of the emitted band. The spectral samples cover only [start, end] (swapped if start > end) and the configured Power is the power INSIDE this band; the spectral shape within the band is unchanged. Ignored for the monochromatic spectrum.'),
  num('wavelengthMax', 'Band end', 780, 'nm', 200, 2000, 1, G, 'Long-wavelength limit of the emitted band. See Band start.'),
];

const POWER = (def: number) => num('power', 'Power', def, 'W', 1e-6, 100, 0.001, G, 'Total emitted optical power. Can be driven from the circuit (laser diode / LED link).', true);
const RAYS = (def: number) => num('rays', 'Ray count', def, '', 0, 2000, 1, G, 'Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples.');

function rayCount(P: Props, fallback: number): number {
  const r = Math.round(P.num('rays'));
  return Math.max(1, Math.min(4000, r > 0 ? r : fallback));
}

/** Beam of width W whose rays fan out linearly (as from a virtual point behind the aperture). */
function beamRays(N: number, width: number, halfDiv: number, gaussian: boolean): SourceSpec['spatial'] {
  const out: SourceSpec['spatial'] = [];
  if (N === 1) return [{ x: 0, y: 0, ang: 0, w: 1, opl: 0, wd: width / 2, wdv: halfDiv }];
  // gaussian: sample +-1.6 w (w = 1/e^2 radius = width/2), weights exp(-2 y^2 / w^2)
  const span = gaussian ? 1.6 * width : width;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N - 0.5; // -0.5..0.5
    const y = u * span;
    const rel = (2 * y) / Math.max(width, 1e-9); // y / (width/2)
    const w = gaussian ? Math.exp(-2 * rel * rel) : 1;
    // opl: launch points lie on the (curved) wavefront of the diverging beam
    out.push({ x: 0, y, ang: rel * halfDiv, w, opl: (y * Math.sin(rel * halfDiv)) / 2, wd: span / N, wdv: (2 * (span / N) * halfDiv) / Math.max(width, 1e-9) });
    sum += w;
  }
  for (const r of out) r.w /= sum;
  return out;
}

// ---- laser realism: temporal envelope, Gaussian beam, cavity ---------------------------------

type PropReader = Pick<Props, 'num' | 'str' | 'pos'>;

const TEMPORAL: ParamDef[] = [
  sel('mode', 'Operating mode', 'cw', [['cw', 'Continuous wave'], ['pulsed', 'Pulsed (mode-locked / Q-switched)'], ['modulated', 'Sinusoidally modulated']],
    'Temporal', 'Time structure of the output. Power is always the AVERAGE power; a pulsed laser concentrates it into Gaussian pulses (peak power = average / (rep rate x pulse width x 1.064)). A static trace shows the average; the temporal envelope and the per-segment travel times t0 / t1 drive slow-motion playback.'),
  num('pulseWidth', 'Pulse width (FWHM)', 1e-10, 's', 1e-15, 1, 1e-15, 'Temporal', 'Full width at half maximum of the Gaussian pulses (100 ps of light is 30 mm long in air).', true),
  num('repRate', 'Repetition rate', 1e8, 'Hz', 0.1, 1e11, 1, 'Temporal', 'Pulses per second (pulsed mode).', true),
  num('modulationFreq', 'Modulation frequency', 1000, 'Hz', 0, 1e11, 1, 'Temporal', 'Frequency of the sinusoidal power modulation (modulated mode).'),
  num('modulationDepth', 'Modulation depth', 1, '', 0, 1, 0.01, 'Temporal', 'P(t) = P x (1 + depth x sin(2 pi f t)); 1 = full modulation.'),
];

const BEAM_MODEL: ParamDef[] = [
  sel('beamModel', 'Beam model', 'manual', [['manual', 'Manual (diameter + divergence)'], ['gaussian', 'Gaussian (waist diameter + M^2)']],
    'Beam', 'Manual: beam diameter and divergence are independent inputs; waist size and position follow from them. Gaussian: the beam diameter is the waist (2 w0) at the laser exit and the divergence is DERIVED as theta = M^2 lambda / (pi w0); the Divergence field is then ignored.'),
  num('m2', 'Beam quality M^2', 1, '', 1, 100, 0.01, 'Beam', 'Beam quality factor: 1 = diffraction-limited TEM00; real lasers 1.05-1.3, diode bars 20+. Rayleigh range z_R = pi w0^2 / (M^2 lambda).'),
];

function temporalEnvelope(P: PropReader, t: number): number {
  const mode = P.str('mode');
  if (mode === 'pulsed') {
    const f = Math.max(1e-9, P.num('repRate')), T = 1 / f;
    const tau = Math.min(P.pos('pulseWidth', 1e-18), T);
    const peak = 1 / (f * tau * 1.0644670194312262); // sqrt(pi / (4 ln 2))
    const x = t - Math.round(t / T) * T;
    let v = 0;
    for (let k = -1; k <= 1; k++) { const d = (x - k * T) / tau; v += Math.exp(-4 * Math.LN2 * d * d); }
    return peak * v;
  }
  if (mode === 'modulated') {
    const m = Math.min(1, Math.max(0, P.num('modulationDepth')));
    return 1 + m * Math.sin(2 * Math.PI * P.num('modulationFreq') * t);
  }
  return 1;
}

interface GaussBeam { waistPos: number; w0: number; zR: number; theta: number }

function gaussianBeamFromProps(P: PropReader): GaussBeam {
  const lam = P.num('wavelength') * 1e-6; // mm
  const m2 = Math.max(1, P.num('m2') || 1);
  const wExit = P.pos('beamDiameter') / 2;
  if (P.str('beamModel') === 'gaussian') {
    const theta = (m2 * lam) / (Math.PI * wExit);
    return { waistPos: 0, w0: wExit, zR: wExit / theta, theta };
  }
  const theta = Math.max(0, (P.num('divergence') * 1e-3) / 2);
  if (!(theta > 0)) return { waistPos: 0, w0: wExit, zR: Infinity, theta: 0 };
  const w0 = (m2 * lam) / (Math.PI * theta);
  // the requested divergence is below the diffraction limit of this aperture: waist at the exit
  if (w0 >= wExit) return { waistPos: 0, w0: wExit, zR: wExit / theta, theta };
  const zR = w0 / theta;
  return { waistPos: -zR * Math.sqrt((wExit / w0) ** 2 - 1), w0, zR, theta };
}

function cavityOutput(P: PropReader): { power: number; threshold: number; slope: number } {
  const R = Math.min(0.9999, Math.max(0.01, P.num('couplerR')));
  const T = -Math.log(R);
  const delta = Math.max(0, P.num('intrinsicLoss')) + T;
  const threshold = P.pos('thresholdK', 1e-6) * delta;
  const slope = Math.min(1, Math.max(0, P.num('pumpEfficiency'))) * Math.min(1, P.num('pumpWavelength') / Math.max(1, P.num('wavelength'))) * (T / delta);
  return { power: Math.max(0, slope * (Math.max(0, P.num('pumpPower')) - threshold)), threshold, slope };
}

const readerOf = (c: { type: string; props?: Record<string, unknown> }, defaults: Record<string, unknown>): PropReader => {
  const raw = (k: string): unknown => { const v = c.props?.[k]; return v === undefined || v === null ? defaults[k] : v; };
  const numOf = (k: string): number => { const v = raw(k); const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
  return { num: numOf, str: (k) => String(raw(k) ?? ''), pos: (k, min = 1e-3) => Math.max(min, Math.abs(numOf(k))) };
};
const defaultsOf = (type: string): Record<string, unknown> => {
  const d: Record<string, unknown> = {};
  for (const t of SOURCE_TYPES) if (t.def.type === type) for (const p of t.def.params) d[p.key] = p.default;
  return d;
};

/**
 * Instantaneous output power of a source relative to its configured (average) power at time t (s).
 * cw: 1. pulsed: train of Gaussian pulses (FWHM pulseWidth) at repRate with unit time average.
 * modulated: 1 + depth sin(2 pi f t). Non-laser sources return 1.
 */
export function sourceTemporalEnvelope(component: { type: string; props?: Record<string, unknown> }, t: number): number {
  if (component.type !== 'source.laser') return 1;
  return temporalEnvelope(readerOf(component, defaultsOf(component.type)), t);
}

/**
 * Gaussian-beam parameters of a laser: waist position along the local +x axis (mm from the exit;
 * negative = virtual waist inside the laser), waist radius w0 (mm), Rayleigh range zR (mm) and
 * far-field half-angle theta (rad). theta = M^2 lambda / (pi w0), zR = w0 / theta.
 */
export function gaussianBeamProfile(component: { type: string; props?: Record<string, unknown> }): { waistPos: number; w0: number; zR: number; theta: number } {
  const type = component.type === 'source.laser_cavity' ? component.type : 'source.laser';
  return gaussianBeamFromProps(readerOf(component, { beamModel: 'manual', m2: 1, ...defaultsOf(type) }));
}

/** Steady-state output of a `source.laser_cavity`: output power (W), threshold pump power (W), slope efficiency. */
export function laserCavityOutput(component: { type: string; props?: Record<string, unknown> }): { power: number; threshold: number; slope: number } {
  return cavityOutput(readerOf(component, defaultsOf('source.laser_cavity')));
}

const housing = (len: number, h: number) => ({ prims: polygon(rect(-len, -h / 2, 0, h / 2)), closed: true, role: 'emitter' as const });

export const SOURCE_TYPES: TypeDef[] = [
  define('source.laser', 'Laser', 'Sources',
    'Monochromatic, collimated, linearly polarized beam with a Gaussian (TEM00) intensity profile. Rays are distributed across the 1/e^2 beam diameter with Gaussian power weights and fan out with the specified full-angle divergence. A non-zero linewidth is sampled as a Gaussian spectrum.',
    [
      wl('wavelength', 'Wavelength', 632.8, G, 'Vacuum wavelength. 632.8 nm = HeNe, 532 nm = doubled Nd:YAG, 1064 nm = Nd:YAG (infrared, shown dim red).'),
      POWER(0.005),
      num('beamDiameter', 'Beam diameter (1/e^2)', 1.0, 'mm', 0.01, 100, 0.01, G, 'Diameter at which the intensity falls to 1/e^2 (13.5 %) of the peak.'),
      num('divergence', 'Divergence (full angle)', 1.0, 'mrad', 0, 500, 0.1, G, 'Full-angle beam divergence. A diffraction-limited 633 nm beam of 1 mm diameter diverges by about 0.8 mrad.'),
      num('linewidth', 'Linewidth (FWHM)', 0, 'nm', 0, 50, 0.01, G, 'Spectral width. 0 = perfectly monochromatic. Laser diodes are typically 0.5-2 nm wide.'),
      RAYS(5),
      ...polParams('linear'),
      ...BEAM_MODEL,
      ...TEMPORAL,
    ],
    ({ P, settings, time }) => {
      const N = rayCount(P, settings.raysPerSource);
      const lw = Math.max(0, P.num('linewidth'));
      const sp = gaussSpectrum(P.num('wavelength'), lw, lw > 0.02 ? Math.min(5, settings.spectralSamples) : 1);
      const gb = gaussianBeamFromProps(P);
      // a static trace carries the average power; with a simulation time a modulated laser follows its envelope
      const env = time !== undefined && P.str('mode') === 'modulated' ? temporalEnvelope(P, time) : 1;
      return {
        source: {
          power: P.num('power') * env, spatial: beamRays(N, P.pos('beamDiameter'), gb.theta, true), wl: sp.wl, wlW: sp.w,
          pol: polState(P.str('polarization'), P.num('polAngle')), wlBw: bwList(sp), lineFwhm: lw,
        },
        decor: [housing(45, 16)],
      };
    }),

  define('source.laser_cavity', 'Laser Cavity', 'Sources',
    'Composite laser resonator: a high-reflector mirror, a pumped gain medium and a partially transmitting output coupler. The emitted power follows the steady-state rate equations of an ideal four-level laser: nothing below threshold, then P_out = slope x (P_pump - P_th). The round-trip loss is delta = L_int - ln(R_oc); the threshold P_th = k x delta grows with the loss, while the slope efficiency eta = eta_pump x (lambda_pump / lambda_laser) x (-ln R_oc) / delta grows with the output coupling - so there is an optimum coupler reflectivity for every pump power. Simplifications: spatially uniform gain, single mode, no thermal lensing or spatial hole burning. The beam leaves the output coupler (local origin) towards +x as a TEM00 Gaussian beam. Drive `pumpPower` from a circuit to watch the threshold.',
    [
      wl('wavelength', 'Laser wavelength', 1064, G, 'Emission wavelength of the gain medium (1064 nm = Nd:YAG).'),
      num('pumpPower', 'Pump power', 2, 'W', 0, 1000, 0.01, G, 'Optical pump power delivered to the gain medium. Drivable from the circuit (actuator link, target prop "pumpPower").'),
      wl('pumpWavelength', 'Pump wavelength', 808, G, 'Pump wavelength; the ratio pump / laser wavelength is the quantum-defect limit of the slope efficiency.'),
      num('couplerR', 'Output coupler reflectivity', 0.95, '', 0.01, 0.9999, 0.001, 'Optical', 'Power reflectivity R of the output coupler; 1 - R leaves the cavity.'),
      num('intrinsicLoss', 'Round-trip loss', 0.02, '', 0, 0.9, 0.001, 'Optical', 'Parasitic round-trip loss (scattering, absorption, imperfect HR mirror).'),
      num('thresholdK', 'Threshold constant', 4, 'W', 0.001, 1e4, 0.01, 'Optical', 'Pump power needed per unit round-trip loss: P_th = k x (L_int - ln R).', true),
      num('pumpEfficiency', 'Pump efficiency', 0.8, '', 0, 1, 0.01, 'Optical', 'Fraction of pump photons that end up in the lasing mode (absorption x mode overlap x quantum efficiency).'),
      num('cavityLength', 'Cavity length', 80, 'mm', 5, 2000, 1, 'Geometry', 'Mirror spacing (drawing; free spectral range c / 2L).'),
      num('beamDiameter', 'Beam diameter (1/e^2)', 1.0, 'mm', 0.01, 100, 0.01, G, 'Diameter of the TEM00 output beam at the coupler.'),
      num('divergence', 'Divergence (full angle)', 1.4, 'mrad', 0, 500, 0.1, G, 'Full-angle divergence of the output beam.'),
      num('linewidth', 'Linewidth (FWHM)', 0, 'nm', 0, 50, 0.01, G, 'Spectral width. 0 = single longitudinal mode.'),
      RAYS(5),
      ...polParams('linear'),
    ],
    ({ P, settings }) => {
      const N = rayCount(P, settings.raysPerSource);
      const lw = Math.max(0, P.num('linewidth'));
      const sp = gaussSpectrum(P.num('wavelength'), lw, lw > 0.02 ? Math.min(5, settings.spectralSamples) : 1);
      const L = P.pos('cavityLength', 1), out = cavityOutput(P);
      return {
        source: {
          power: out.power, spatial: beamRays(N, P.pos('beamDiameter'), (P.num('divergence') * 1e-3) / 2, true), wl: sp.wl, wlW: sp.w,
          pol: polState(P.str('polarization'), P.num('polAngle')), wlBw: bwList(sp), lineFwhm: lw,
        },
        decor: [
          { prims: [seg(-L, -9, -L, 9)], closed: false, role: 'mirror' },                           // high reflector
          { prims: polygon(rect(-L - 3, -9, -L, 9)), closed: true, role: 'decor' },
          { prims: polygon(rect(-0.72 * L, -5, -0.28 * L, 5)), closed: true, role: 'emitter' },     // gain medium
          { prims: polygon(rect(-0.68 * L, -9, -0.32 * L, -6.5)), closed: true, role: 'decor' },    // pump
          { prims: [seg(-0.5, -9, -0.5, 9)], closed: false, role: 'mirror' },                       // output coupler
          { prims: [seg(-L, 0, -0.5, 0)], closed: false, role: 'decor' },                           // intracavity beam
          { prims: [seg(-L - 3, -12, 2, -12), seg(2, -12, 2, -9)], closed: false, role: 'decor' },
          { prims: [seg(-L - 3, 12, 2, 12), seg(2, 12, 2, 9)], closed: false, role: 'decor' },
        ],
      };
    }),

  define('source.led', 'LED', 'Sources',
    'Light-emitting diode: a small extended emitter with a Gaussian spectrum (centre wavelength + FWHM) and a cos^m angular pattern. A half-intensity angle of 60 deg corresponds to an ideal Lambertian emitter (m = 1). Unpolarized.',
    [
      wl('wavelength', 'Centre wavelength', 525, G, 'Peak emission wavelength.'),
      num('fwhm', 'Spectral width (FWHM)', 30, 'nm', 0, 200, 1, G, 'Full width at half maximum of the emission spectrum (typically 20-40 nm).'),
      POWER(0.05),
      num('halfAngle', 'Half-intensity angle', 60, 'deg', 2, 85, 1, G, 'Angle from the axis at which the radiant intensity drops to 50 %. 60 deg = Lambertian; smaller values model a lensed LED.'),
      num('size', 'Emitter size', 1, 'mm', 0, 20, 0.1, 'Geometry', 'Width of the light-emitting chip.'),
      RAYS(40),
      ...polParams('unpolarized'),
    ],
    ({ P, settings }) => {
      const N = rayCount(P, settings.raysPerSource);
      const half = Math.min(85, Math.max(2, P.num('halfAngle'))) * DEG;
      const size0 = Math.max(0, P.num('size'));
      const m = -Math.LN2 / Math.log(Math.cos(half));
      const tmax = Math.min(89 * DEG, Math.acos(Math.pow(0.02, 1 / m)));
      const size = Math.max(0, P.num('size'));
      const spatial: SourceSpec['spatial'] = [];
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const ang = N === 1 ? 0 : ((i + 0.5) / N - 0.5) * 2 * tmax;
        const w = Math.pow(Math.cos(ang), m);
        // golden-ratio sequence decorrelates the position on the chip from the emission angle
        const y = ((((i + 0.5) * 0.6180339887) % 1) - 0.5) * size;
        spatial.push({ x: 0, y, ang, w, wd: size0 / N, wdv: (2 * tmax) / N }); sum += w;
      }
      for (const r of spatial) r.w /= sum;
      const sp = gaussSpectrum(P.num('wavelength'), P.num('fwhm'), Math.max(3, Math.min(9, Math.round(settings.spectralSamples / 3))));
      return {
        // an LED chip is spatially incoherent: every ray is its own coherence group in wave mode
        source: { power: P.num('power'), spatial, wl: sp.wl, wlW: sp.w, pol: polState(P.str('polarization'), P.num('polAngle')), coherent: false, wlBw: bwList(sp) },
        decor: [{ prims: polygon(rect(-6, -4, 0, 4)), closed: true, role: 'emitter' }],
      };
    }),

  define('source.white', 'White Light', 'Sources',
    'Broadband white beam. The spectrum is either a Planck blackbody of the given colour temperature (2700 K incandescent, 5778 K sunlight), a phosphor-converted white LED (blue pump + broad yellow phosphor) or an equal-energy spectrum, sampled across 380-780 nm. Every spatial ray carries all spectral samples, so prisms and gratings produce true spectra and lenses show chromatic aberration.',
    [
      sel('spectrum', 'Spectrum', 'blackbody', [['blackbody', 'Blackbody (thermal)'], ['white_led', 'White LED (phosphor)'], ['flat', 'Equal energy']], G, 'Shape of the emitted spectrum.'),
      num('temperature', 'Colour temperature', 5778, 'K', 1000, 20000, 10, G, 'Blackbody temperature (Planck law). Only used for the blackbody spectrum.'),
      ...BAND,
      POWER(1),
      num('beamWidth', 'Beam width', 4, 'mm', 0, 200, 0.1, 'Geometry', 'Width of the emitted beam.'),
      num('divergence', 'Divergence (full angle)', 0, 'deg', 0, 180, 0.1, G, 'Full-angle divergence of the beam; 0 = collimated.'),
      RAYS(7),
      ...polParams('unpolarized'),
    ],
    ({ P, settings }) => {
      const N = rayCount(P, settings.raysPerSource);
      const sp = spectrumByName(P.str('spectrum'), settings.spectralSamples, 550, P.num('temperature'), P.num('wavelengthMin'), P.num('wavelengthMax'));
      return {
        source: { power: P.num('power'), spatial: beamRays(N, Math.max(0, P.num('beamWidth')), (P.num('divergence') * DEG) / 2, false), wl: sp.wl, wlW: sp.w, pol: polState(P.str('polarization'), P.num('polAngle')), wlBw: bwList(sp) },
        decor: [housing(40, 22)],
      };
    }),

  define('source.point', 'Point Source', 'Sources',
    'Idealised point emitter radiating uniformly into the chosen angular range (360 deg = isotropic). Useful for imaging experiments with lenses and mirrors.',
    [
      sel('spectrum', 'Spectrum', 'mono', [['mono', 'Monochromatic'], ['blackbody', 'Blackbody'], ['white_led', 'White LED'], ['flat', 'Equal energy']], G, 'Emitted spectrum.'),
      wl('wavelength', 'Wavelength', 550, G, 'Wavelength for the monochromatic spectrum.'),
      num('temperature', 'Colour temperature', 5778, 'K', 1000, 20000, 10, G, 'Blackbody temperature.'),
      ...BAND,
      POWER(0.1),
      num('spread', 'Emission angle', 360, 'deg', 1, 360, 1, G, 'Total angular range of emission, centred on the component axis.'),
      RAYS(48),
      ...polParams('unpolarized'),
    ],
    ({ P, settings }) => {
      const N = rayCount(P, settings.raysPerSource);
      const spread = Math.min(360, Math.max(0.01, P.num('spread'))) * DEG;
      const spatial: SourceSpec['spatial'] = [];
      for (let i = 0; i < N; i++) spatial.push({ x: 0, y: 0, ang: ((i + 0.5) / N - 0.5) * spread, w: 1 / N, wd: 0, wdv: spread / N });
      const sp = spectrumByName(P.str('spectrum'), settings.spectralSamples, P.num('wavelength'), P.num('temperature'), P.num('wavelengthMin'), P.num('wavelengthMax'));
      const pts: number[] = [];
      for (let i = 0; i < 16; i++) pts.push(2 * Math.cos((i * Math.PI) / 8), 2 * Math.sin((i * Math.PI) / 8));
      return {
        source: { power: P.num('power'), spatial, wl: sp.wl, wlW: sp.w, pol: polState(P.str('polarization'), P.num('polAngle')), wlBw: bwList(sp) },
        decor: [{ pts, closed: true, role: 'emitter' }],
      };
    }),

  define('source.beam', 'Collimated Beam', 'Sources',
    'Wide collimated beam of parallel, uniformly spaced rays - the classic ray-box. Choose a monochromatic line for clean lens / mirror experiments or a broadband spectrum to reveal dispersion and chromatic aberration.',
    [
      sel('spectrum', 'Spectrum', 'blackbody', [['mono', 'Monochromatic'], ['blackbody', 'Blackbody'], ['white_led', 'White LED'], ['flat', 'Equal energy']], G, 'Emitted spectrum.'),
      wl('wavelength', 'Wavelength', 550, G, 'Wavelength for the monochromatic spectrum.'),
      num('temperature', 'Colour temperature', 6500, 'K', 1000, 20000, 10, G, 'Blackbody temperature.'),
      ...BAND,
      POWER(1),
      num('beamWidth', 'Beam width', 30, 'mm', 0.1, 500, 0.5, 'Geometry', 'Width of the beam.'),
      num('divergence', 'Divergence (full angle)', 0, 'deg', 0, 90, 0.1, G, 'Full-angle divergence; 0 = perfectly collimated.'),
      RAYS(9),
      ...polParams('unpolarized'),
    ],
    ({ P, settings }) => {
      const N = rayCount(P, settings.raysPerSource);
      const sp = spectrumByName(P.str('spectrum'), settings.spectralSamples, P.num('wavelength'), P.num('temperature'), P.num('wavelengthMin'), P.num('wavelengthMax'));
      const W = P.pos('beamWidth');
      return {
        source: { power: P.num('power'), spatial: beamRays(N, W, (P.num('divergence') * DEG) / 2, false), wl: sp.wl, wlW: sp.w, pol: polState(P.str('polarization'), P.num('polAngle')), wlBw: bwList(sp) },
        decor: [housing(12, W + 4)],
      };
    }),
];
