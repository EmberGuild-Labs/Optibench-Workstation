/** Mirrors, beam splitters, lenses, prisms and blocks. */
import type { ParamDef } from '../../types';
import { SK, type Prim } from '../geometry';
import { METALS, getMaterial, type Material } from '../materials';
import {
  COATING_PARAM, DEG, SIZE, bool, coatingCode, define, face, matParams, num, polygon, rect, resolveMat, seg, sel, wl,
  type Built, type Props, type SurfSpec, type TypeDef,
} from './common';

// ---------------------------------------------------------------------------
// Mirrors
// ---------------------------------------------------------------------------

const MIRROR_PARAMS: ParamDef[] = [
  sel('coating', 'Mirror coating', 'silver', [['silver', 'Protected silver'], ['aluminium', 'Aluminium'], ['gold', 'Gold'], ['ideal', 'Ideal (fixed reflectivity)']],
    'Optical', 'Metal coatings use measured complex refractive indices (Johnson & Christy, Rakic) in the full Fresnel equations, so reflectance and the s/p phase shift depend on wavelength, angle and polarization. Gold absorbs blue/green light; aluminium reflects ~91 %; silver ~97 %.'),
  num('reflectivity', 'Reflectivity (ideal)', 1, '', 0, 1, 0.001, 'Optical', 'Power reflectivity used when the coating is Ideal. The remainder is absorbed.'),
];

function mirrorSurf(prim: Prim, P: Props, flip: boolean, doubleSided: boolean): SurfSpec {
  const coating = P.str('coating');
  const metal = METALS[coating];
  if (metal) return { prim, kind: SK.METAL, role: 'mirror', flip, metal: metal.nk, backAbsorb: !doubleSided };
  const R = Math.min(1, Math.max(0, P.num('reflectivity')));
  return { prim, kind: SK.THIN, role: 'mirror', flip, rt: (_w, o) => { o[0] = R; o[1] = 0; }, backAbsorb: !doubleSided };
}

const DOUBLE = (def: boolean) => bool('doubleSided', 'Reflective on both sides', def, 'Optical', 'If off, only the front face (facing local -x) reflects and the back absorbs light like a real first-surface mirror substrate.');

const MIRRORS: TypeDef[] = [
  define('mirror.flat', 'Flat Mirror', 'Mirrors',
    'Plane first-surface mirror. Angle of reflection equals angle of incidence. With a metal coating the reflectance is computed from the complex Fresnel equations, which also changes the polarization state of obliquely reflected light.',
    [SIZE(40), ...MIRROR_PARAMS, DOUBLE(true)],
    ({ P }) => ({ surfaces: [mirrorSurf(face(P.pos('size')), P, true, P.bool('doubleSided'))] })),

  define('mirror.spherical', 'Spherical Mirror', 'Mirrors',
    'Mirror whose surface is part of a circle of the given radius of curvature; focal length f = R/2 for paraxial rays. Positive radius = concave (focusing), negative = convex (diverging). Rays far from the axis focus closer to the mirror - spherical aberration emerges from the exact geometry.',
    [
      num('radius', 'Radius of curvature', 200, 'mm', -5000, 5000, 1, 'Geometry', 'Positive: concave towards the incoming light (front faces local -x). Negative: convex. Focal length = R/2.'),
      SIZE(50, 'Aperture (chord height) of the mirror.'), ...MIRROR_PARAMS, DOUBLE(false),
    ],
    ({ P }) => {
      let R = P.num('radius');
      const h = P.pos('size') / 2;
      if (Math.abs(R) < h * 1.0001) R = (R < 0 ? -1 : 1) * h * 1.0001;
      const phi = Math.asin(h / Math.abs(R));
      const prim: Prim = R > 0
        ? { k: 'arc', cx: -R, cy: 0, r: R, a0: -phi, a1: phi }
        : { k: 'arc', cx: -R, cy: 0, r: -R, a0: Math.PI + phi, a1: Math.PI - phi };
      return { surfaces: [mirrorSurf(prim, P, R > 0, P.bool('doubleSided'))] };
    }),

  define('mirror.parabolic', 'Parabolic Mirror', 'Mirrors',
    'Mirror with a parabolic profile. All rays parallel to the axis converge exactly at the focus regardless of their height - no spherical aberration - which is why telescopes and satellite dishes use parabolas. Intersections are computed analytically. Negative focal length gives a convex parabola.',
    [
      num('focalLength', 'Focal length', 100, 'mm', -5000, 5000, 1, 'Geometry', 'Distance from the vertex to the focus (focus lies at local x = -f).'),
      SIZE(60, 'Aperture height of the mirror.'), ...MIRROR_PARAMS, DOUBLE(false),
    ],
    ({ P }) => {
      let f = P.num('focalLength');
      if (Math.abs(f) < 0.5) f = f < 0 ? -0.5 : 0.5;
      return { surfaces: [mirrorSurf({ k: 'par', f, h: P.pos('size') / 2 }, P, true, P.bool('doubleSided'))] };
    }),

  define('mirror.dichroic', 'Dichroic Mirror', 'Mirrors',
    'Interference-coated plate that reflects one part of the spectrum and transmits the rest without absorption. The transition at the cut-off wavelength follows a smooth logistic edge of the given 10-90 % width. Longpass: transmits wavelengths above the cut-off and reflects those below; shortpass is the opposite.',
    [
      SIZE(40),
      sel('mode', 'Type', 'longpass', [['longpass', 'Longpass (transmit long, reflect short)'], ['shortpass', 'Shortpass (transmit short, reflect long)']], 'Optical', 'Which side of the cut-off is transmitted.'),
      wl('cutoff', 'Cut-off wavelength', 550, 'Optical', '50 % transmission point.'),
      num('edgeWidth', 'Edge width (10-90 %)', 15, 'nm', 0.5, 200, 0.5, 'Optical', 'Spectral width of the transition from reflecting to transmitting.'),
      num('efficiency', 'Peak efficiency', 0.98, '', 0, 1, 0.005, 'Optical', 'Maximum reflectance / transmittance in the respective bands.'),
    ],
    ({ P }) => {
      const cut = P.num('cutoff'), w = P.pos('edgeWidth', 0.1) / 4.394, eff = Math.min(1, Math.max(0, P.num('efficiency')));
      const sgn = P.str('mode') === 'shortpass' ? -1 : 1;
      return {
        surfaces: [{
          prim: face(P.pos('size')), kind: SK.THIN, role: 'mirror',
          rt: (l, o) => {
            const t = 1 / (1 + Math.exp((-sgn * (l - cut)) / w));
            o[1] = (1 - eff) + (2 * eff - 1) * t; // transmittance between (1-eff) and eff
            o[0] = 1 - o[1];
          },
        }],
      };
    }),
];

// ---------------------------------------------------------------------------
// Beam splitters
// ---------------------------------------------------------------------------

const SPLITTERS: TypeDef[] = [
  define('splitter.plate', 'Plate Beam Splitter', 'Splitters',
    'Idealised thin, non-polarizing partially reflecting plate. A fraction R of the power is reflected, T = 1 - R - loss is transmitted. Use it for interferometer layouts, beam sampling and power division. (For a physical glass plate with ghost reflections use a Glass Slab.)',
    [
      SIZE(40),
      num('reflectance', 'Reflectance R', 0.5, '', 0, 1, 0.01, 'Optical', 'Fraction of incident power that is reflected (R:T = 50:50 for 0.5).'),
      num('loss', 'Absorption loss', 0, '', 0, 1, 0.005, 'Optical', 'Fraction of power absorbed in the coating.'),
    ],
    ({ P }) => {
      const R = Math.min(1, Math.max(0, P.num('reflectance')));
      const T = Math.max(0, 1 - R - Math.max(0, P.num('loss')));
      return { surfaces: [{ prim: face(P.pos('size')), kind: SK.THIN, role: 'surface', rt: (_l, o) => { o[0] = R; o[1] = T; } }] };
    }),

  define('splitter.pbs', 'Polarizing Beam Splitter Cube', 'Splitters',
    'Glass cube with a dielectric coating on its internal diagonal. p-polarized light (electric field in the plane of the bench) is transmitted straight through; s-polarized light (field perpendicular to the bench) is reflected by 90 degrees. The outer faces refract like real glass (optionally anti-reflection coated).',
    [
      num('size', 'Cube side', 25.4, 'mm', 2, 200, 0.1, 'Geometry', 'Edge length of the cube.'),
      ...matParams('bk7'),
      num('tp', 'p transmission Tp', 0.97, '', 0, 1, 0.005, 'Polarization', 'Transmittance of the diagonal for p-polarized light; the remainder is reflected.'),
      num('rs', 's reflection Rs', 0.999, '', 0, 1, 0.0005, 'Polarization', 'Reflectance of the diagonal for s-polarized light; the remainder leaks through (extinction ratio Tp : Ts).'),
      { ...COATING_PARAM, default: 'ideal' },
    ],
    ({ P }) => {
      const s = P.pos('size') / 2;
      return {
        outline: polygon(rect(-s, -s, s, s)),
        body: { material: resolveMat(P), coating: coatingCode(P.str('coating')) },
        surfaces: [{ prim: seg(-s, s, s, -s), kind: SK.PBS, role: 'surface', p1: Math.min(1, Math.max(0, P.num('tp'))), p2: Math.min(1, Math.max(0, P.num('rs'))) }],
        material: P.str('material'),
      };
    }),
];

// ---------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------

const flat = (R: number) => !Number.isFinite(R) || R === 0 || Math.abs(R) > 1e7;
const sag = (R: number, y: number) => (flat(R) ? 0 : R - Math.sign(R) * Math.sqrt(Math.max(0, R * R - y * y)));

/**
 * Outline of a real thick lens in local coordinates. Optical axis = local x, light conventionally
 * travels towards +x. R1 / R2 follow the usual sign convention (positive = centre of curvature on
 * the +x side); 0 or infinity = flat. The centre thickness is increased if necessary so that the
 * edge thickness stays positive.
 */
export function lensOutline(R1: number, R2: number, tc: number, D: number): { prims: Prim[]; tc: number; R1: number; R2: number } {
  const h = Math.max(0.05, D / 2);
  const fix = (R: number) => (flat(R) ? 0 : Math.abs(R) < h * 1.0005 ? Math.sign(R) * h * 1.0005 : R);
  R1 = fix(R1); R2 = fix(R2);
  tc = Math.max(tc, sag(R1, h) - sag(R2, h) + 0.05, 0.05);
  const xf = -tc / 2 + sag(R1, h), xb = tc / 2 + sag(R2, h);
  const prims: Prim[] = [];
  // front surface, y from -h to +h
  if (flat(R1)) prims.push(seg(-tc / 2, -h, -tc / 2, h));
  else {
    const phi = Math.asin(h / Math.abs(R1)), cx = -tc / 2 + R1;
    prims.push(R1 > 0 ? { k: 'arc', cx, cy: 0, r: R1, a0: Math.PI + phi, a1: Math.PI - phi } : { k: 'arc', cx, cy: 0, r: -R1, a0: -phi, a1: phi });
  }
  prims.push(seg(xf, h, xb, h));
  // back surface, y from +h to -h
  if (flat(R2)) prims.push(seg(tc / 2, h, tc / 2, -h));
  else {
    const phi = Math.asin(h / Math.abs(R2)), cx = tc / 2 + R2;
    prims.push(R2 < 0 ? { k: 'arc', cx, cy: 0, r: -R2, a0: phi, a1: -phi } : { k: 'arc', cx, cy: 0, r: R2, a0: Math.PI - phi, a1: Math.PI + phi });
  }
  prims.push(seg(xb, -h, xf, -h));
  return { prims, tc, R1, R2 };
}

/** Effective focal length of a thick lens in air (lensmaker's equation), for index n. */
export function lensmakerFocal(n: number, R1: number, R2: number, tc: number): number {
  const c1 = flat(R1) ? 0 : 1 / R1, c2 = flat(R2) ? 0 : 1 / R2;
  const phi = (n - 1) * (c1 - c2 + ((n - 1) * tc * c1 * c2) / n);
  return 1 / phi;
}

const DESIGN_NM = 587.56;

/** Radius of a symmetric bi-convex / bi-concave lens (R1 = R, R2 = -R) with focal length f and centre thickness tc. */
function symmetricRadius(n: number, f: number, tc: number): number {
  const d = 1 - tc / (n * f);
  if (tc < 1e-9 || d <= 0) return 2 * (n - 1) * f;
  return ((n - 1) * tc) / (n * (1 - Math.sqrt(d)));
}

const LENS_COMMON = (mat: string): ParamDef[] => [
  num('diameter', 'Diameter', 25.4, 'mm', 1, 300, 0.1, 'Geometry', 'Clear diameter of the lens.'),
  ...matParams(mat),
  COATING_PARAM,
];
const FOCAL = (def: number, min: number, max: number) =>
  num('focalLength', 'Focal length (design)', def, 'mm', min, max, 1, 'Geometry', 'Paraxial effective focal length at 587.6 nm. The surface radii are derived from it with the thick-lens lensmaker equation; the lens is then traced as real spherical glass surfaces, so spherical and chromatic aberration appear naturally.');
const EDGE = num('edgeThickness', 'Edge thickness', 2, 'mm', 0.1, 50, 0.1, 'Geometry', 'Thickness of the lens at its rim; the centre thickness follows from the curvature.');
const CENTER = num('centerThickness', 'Centre thickness', 2.5, 'mm', 0.1, 100, 0.1, 'Geometry', 'Thickness of the lens on the optical axis.');

function lensBuilt(P: Props, mat: Material, R1: number, R2: number, tc: number): Built {
  const o = lensOutline(R1, R2, tc, P.pos('diameter', 0.1));
  return { outline: o.prims, body: { material: mat, coating: coatingCode(P.str('coating')) }, material: P.str('material') };
}

const LENSES: TypeDef[] = [
  define('lens.biconvex', 'Bi-Convex Lens', 'Lenses',
    'Converging lens with two equal convex spherical surfaces - a real thick lens made of dispersive glass. Marginal rays focus closer than paraxial rays (spherical aberration) and blue focuses closer than red (chromatic aberration). Best for 1:1 imaging.',
    [FOCAL(100, 5, 5000), ...LENS_COMMON('bk7'), EDGE],
    ({ P }) => {
      const mat = resolveMat(P), n = mat.nCatalog(DESIGN_NM), f = Math.max(1, Math.abs(P.num('focalLength')));
      const h = P.pos('diameter', 0.1) / 2, te = P.pos('edgeThickness', 0.05);
      let R = 2 * (n - 1) * f, tc = te;
      for (let i = 0; i < 12; i++) {
        const Rc = Math.max(R, h * 1.0005);
        tc = te + 2 * sag(Rc, h);
        R = symmetricRadius(n, f, tc);
      }
      return lensBuilt(P, mat, R, -R, tc);
    }),

  define('lens.biconcave', 'Bi-Concave Lens', 'Lenses',
    'Diverging lens with two equal concave spherical surfaces. Parallel rays leave as if they came from a virtual focus in front of the lens. Used for beam expansion and to correct converging lenses.',
    [FOCAL(-100, -5000, -5), ...LENS_COMMON('bk7'), CENTER],
    ({ P }) => {
      const mat = resolveMat(P), n = mat.nCatalog(DESIGN_NM), f = -Math.max(1, Math.abs(P.num('focalLength')));
      const tc = P.pos('centerThickness', 0.05);
      const R = symmetricRadius(n, f, tc); // negative
      return lensBuilt(P, mat, R, -R, tc);
    }),

  define('lens.planoconvex', 'Plano-Convex Lens', 'Lenses',
    'Converging lens with one spherical and one flat surface. For focusing a collimated beam the curved side should face the collimated light - turning it around roughly quadruples the spherical aberration, which you can verify by rotating the lens by 180 degrees.',
    [FOCAL(100, 5, 5000), ...LENS_COMMON('bk7'), EDGE],
    ({ P }) => {
      const mat = resolveMat(P), n = mat.nCatalog(DESIGN_NM), f = Math.max(1, Math.abs(P.num('focalLength')));
      const h = P.pos('diameter', 0.1) / 2;
      const R = Math.max((n - 1) * f, h * 1.0005);
      return lensBuilt(P, mat, R, 0, P.pos('edgeThickness', 0.05) + sag(R, h));
    }),

  define('lens.planoconcave', 'Plano-Concave Lens', 'Lenses',
    'Diverging lens with one concave spherical and one flat surface. Commonly used as the negative element of a Galilean beam expander.',
    [FOCAL(-100, -5000, -5), ...LENS_COMMON('bk7'), CENTER],
    ({ P }) => {
      const mat = resolveMat(P), n = mat.nCatalog(DESIGN_NM), f = -Math.max(1, Math.abs(P.num('focalLength')));
      return lensBuilt(P, mat, (n - 1) * f, 0, P.pos('centerThickness', 0.05));
    }),

  define('lens.ball', 'Ball Lens', 'Lenses',
    'Glass sphere. Effective focal length f = nD / (4(n-1)), measured from the centre, with very strong spherical aberration. Used for fibre coupling; with water as the material it models a raindrop - the internal reflection produces the rainbow angle of about 42 degrees.',
    [num('diameter', 'Diameter', 10, 'mm', 0.5, 200, 0.1, 'Geometry', 'Diameter of the sphere.'), ...matParams('bk7'), COATING_PARAM],
    ({ P }) => ({
      outline: [{ k: 'arc', cx: 0, cy: 0, r: P.pos('diameter', 0.1) / 2, a0: 0, a1: 2 * Math.PI }],
      body: { material: resolveMat(P), coating: coatingCode(P.str('coating')) }, material: P.str('material'),
    })),

  define('lens.ideal', 'Ideal Thin Lens', 'Lenses',
    'Mathematically perfect paraxial thin lens: a ray at height h is bent so that tan(theta_out) = tan(theta_in) - h/f. It images stigmatically with no spherical or chromatic aberration and no reflection losses - the textbook lens, useful as a reference against the real glass lenses.',
    [
      num('focalLength', 'Focal length', 100, 'mm', -5000, 5000, 1, 'Geometry', 'Positive = converging, negative = diverging.'),
      SIZE(40, 'Clear aperture of the lens.'),
    ],
    ({ P }) => {
      let f = P.num('focalLength');
      if (Math.abs(f) < 0.1) f = 0.1;
      return { surfaces: [{ prim: face(P.pos('size')), kind: SK.IDEAL, role: 'surface', p1: f }] };
    }),

  define('lens.custom', 'Custom Lens', 'Lenses',
    'Thick lens defined directly by its two radii of curvature, centre thickness, diameter and material - meniscus, asymmetric and thick lenses are all possible. Sign convention: a radius is positive when its centre of curvature lies on the +x (exit) side; 0 means flat. Focal length follows the lensmaker equation 1/f = (n-1)[1/R1 - 1/R2 + (n-1)d/(n R1 R2)].',
    [
      num('r1', 'Front radius R1', 60, 'mm', -5000, 5000, 0.5, 'Geometry', 'Radius of the surface facing -x. Positive = convex, negative = concave, 0 = flat.'),
      num('r2', 'Back radius R2', -200, 'mm', -5000, 5000, 0.5, 'Geometry', 'Radius of the surface facing +x. Negative = convex, positive = concave, 0 = flat.'),
      num('thickness', 'Centre thickness', 5, 'mm', 0.1, 200, 0.1, 'Geometry', 'Thickness on the optical axis (automatically increased if the edges would cross).'),
      ...LENS_COMMON('bk7'),
    ],
    ({ P }) => lensBuilt(P, resolveMat(P), P.num('r1'), P.num('r2'), P.pos('thickness', 0.05))),
];

// ---------------------------------------------------------------------------
// Prisms and blocks
// ---------------------------------------------------------------------------

function solid(P: Props, pts: number[], extra: Partial<Built> = {}): Built {
  return {
    outline: polygon(pts),
    body: { material: resolveMat(P), coating: coatingCode(P.str('coating')), alphaExtra: 0 },
    material: P.str('material'), ...extra,
  };
}

function isoscelesPts(apexDeg: number, side: number): number[] {
  const a = (Math.min(175, Math.max(2, apexDeg)) * DEG) / 2;
  const w = side * Math.sin(a), h = side * Math.cos(a);
  return [0, (-2 * h) / 3, w, h / 3, -w, h / 3];
}

const PRISMS: TypeDef[] = [
  define('prism.equilateral', 'Equilateral Prism', 'Prisms & Blocks',
    'Dispersing prism with three 60 degree angles. Because the refractive index rises towards the blue, white light is fanned out into a spectrum. At minimum deviation the ray passes symmetrically and n = sin((A + D)/2) / sin(A/2).',
    [num('size', 'Side length', 40, 'mm', 2, 300, 0.5, 'Geometry', 'Length of each side.'), ...matParams('f2'), COATING_PARAM],
    ({ P }) => solid(P, isoscelesPts(60, P.pos('size')))),

  define('prism.right_angle', 'Right-Angle Prism', 'Prisms & Blocks',
    '45-45-90 degree prism. Light entering through a short face is totally internally reflected at the hypotenuse (the 45 degree incidence exceeds the ~41.8 degree critical angle of crown glass) and turned by 90 degrees; entering through the hypotenuse it acts as a retro-reflector (Porro prism).',
    [num('size', 'Leg length', 30, 'mm', 2, 300, 0.5, 'Geometry', 'Length of the two short faces.'), ...matParams('bk7'), COATING_PARAM],
    ({ P }) => { const a = P.pos('size'); return solid(P, [-a / 3, -a / 3, (2 * a) / 3, -a / 3, -a / 3, (2 * a) / 3]); }),

  define('prism.dove', 'Dove Prism', 'Prisms & Blocks',
    'Truncated right-angle prism with 45 degree end faces. A beam parallel to the long face is refracted down, totally reflected at the base and refracted out again travelling in its original direction, but the image is inverted. Rotating the prism rotates the image at twice the rate.',
    [
      num('length', 'Base length', 60, 'mm', 4, 400, 0.5, 'Geometry', 'Length of the long (base) face.'),
      num('height', 'Height', 15, 'mm', 1, 150, 0.5, 'Geometry', 'Height of the prism; the end faces are inclined at 45 degrees.'),
      ...matParams('bk7'), COATING_PARAM,
    ],
    ({ P }) => {
      const H = P.pos('height'), L = Math.max(P.pos('length'), 2 * H + 0.5);
      return solid(P, [-L / 2 + H, -H / 2, L / 2 - H, -H / 2, L / 2, H / 2, -L / 2, H / 2]);
    }),

  define('prism.custom', 'Custom Prism', 'Prisms & Blocks',
    'Isosceles prism with adjustable apex angle. Thin wedges (a few degrees) deviate a beam by approximately (n - 1) x A; large apex angles give strong dispersion until total internal reflection sets in.',
    [
      num('apexAngle', 'Apex angle', 30, 'deg', 2, 175, 0.5, 'Geometry', 'Angle between the two refracting faces.'),
      num('size', 'Side length', 40, 'mm', 2, 300, 0.5, 'Geometry', 'Length of the two equal sides.'),
      ...matParams('bk7'), COATING_PARAM,
    ],
    ({ P }) => solid(P, isoscelesPts(P.num('apexAngle'), P.pos('size')))),

  define('block.slab', 'Glass Slab', 'Prisms & Blocks',
    'Rectangular block of transparent material. A ray is displaced sideways but leaves parallel to its original direction; each face reflects a few percent (Fresnel). Choose water to build a water tank, or add absorption for tinted glass (Beer-Lambert law).',
    [
      num('width', 'Width', 60, 'mm', 0.5, 1000, 0.5, 'Geometry', 'Extent along the local x axis.'),
      num('height', 'Height', 30, 'mm', 0.5, 1000, 0.5, 'Geometry', 'Extent along the local y axis.'),
      ...matParams('bk7'), COATING_PARAM,
      num('absorption', 'Extra absorption', 0, '1/cm', 0, 20, 0.01, 'Optical', 'Additional Beer-Lambert absorption coefficient: transmitted power = exp(-alpha x path length).'),
    ],
    ({ P }) => {
      const w = P.pos('width') / 2, h = P.pos('height') / 2;
      const b = solid(P, rect(-w, -h, w, h));
      b.body!.alphaExtra = Math.max(0, P.num('absorption')) / 10;
      return b;
    }),

  define('block.semicircle', 'Semicircular Block', 'Prisms & Blocks',
    'Half-disc ("D") block, the classic tool for studying refraction: a ray aimed at the centre of the flat face crosses the curved face along a radius and is not bent there, so only the refraction at the flat face is observed. Sending light in through the curved side demonstrates the critical angle and total internal reflection.',
    [num('radius', 'Radius', 30, 'mm', 2, 300, 0.5, 'Geometry', 'Radius of the half disc. The centre of the flat face is the component origin.'), ...matParams('pmma'), COATING_PARAM],
    ({ P }) => {
      const R = P.pos('radius');
      return {
        outline: [{ k: 'arc', cx: 0, cy: 0, r: R, a0: Math.PI / 2, a1: -Math.PI / 2 }, seg(0, -R, 0, R)],
        body: { material: resolveMat(P), coating: coatingCode(P.str('coating')) }, material: P.str('material'),
      };
    }),
];

export const ELEMENT_TYPES: TypeDef[] = [...MIRRORS, ...SPLITTERS, ...LENSES, ...PRISMS];
export { getMaterial };
