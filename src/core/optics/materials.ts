/**
 * Optical materials library.
 *
 * Dispersion data are published Sellmeier / Cauchy fits (wavelength in um inside the formulas):
 *   Schott glasses (N-BK7, N-BAK4, F2, SF10, N-SF11, N-SF6) - Schott catalogue Sellmeier coefficients
 *   Fused silica - Malitson 1965;  CaF2 - Malitson 1963;  Sapphire (o-ray) - Malitson 1962
 *   MgF2 (o-ray) - Dodge 1984;  Diamond - Peter 1923;  Water - Daimon & Masumura 2007 (20 C)
 *   PMMA / polycarbonate / polystyrene - Sultanova et al. 2009;  Ethanol - Rheims et al. 1997
 *   BBO (o-ray) - Eimerl et al. 1987;  TGG - single-term fit to n(633 nm)=1.976, n(1064 nm)=1.954
 *   Air - Edlen equation in the Birch & Downs (1994) revision, with temperature correction.
 *
 * Catalogue indices of solids/liquids are measured relative to air; `n()` returns the ABSOLUTE
 * index (catalogue x n_air(20 C)) plus a linear thermo-optic correction, `nCatalog()` returns
 * the raw catalogue value.
 *
 * Absorption: Beer-Lambert coefficient alpha(lambda) in 1/mm (water: Pope & Fry 1997 + Hale & Querry NIR).
 * Verdet constants (rad/(T m)): diamagnetic materials use the Becquerel relation
 *   V = gamma * (e / 2 m_e c) * lambda * |dn/dlambda|   with a magneto-optic anomaly factor gamma
 *   calibrated to handbook values; paramagnetic TGG uses
 *   V = -134 * (632.8^2 - 258.2^2)/(lambda^2 - 258.2^2)   (-134 rad/(T m) at 632.8 nm, ~-40 at 1064 nm).
 */

export interface Material {
  id: string;
  label: string;
  /** Absolute refractive index at vacuum wavelength `nm` and temperature `tC` (deg C, default 20). */
  n(nm: number, tC?: number): number;
  /** Raw catalogue value (relative to air for solids/liquids). */
  nCatalog(nm: number): number;
  /** Absorption coefficient in 1/mm (Beer-Lambert, power). */
  alpha(nm: number): number;
  /** Verdet constant in rad/(T m). */
  verdet(nm: number): number;
  hasAlpha: boolean;
}

const clampWl = (nm: number) => (nm < 200 ? 200 : nm > 5000 ? 5000 : nm);

/** Refractive index of standard air (dry, 101 325 Pa) at temperature tC. Edlen / Birch & Downs 1994. */
export function nAir(nm: number, tC = 20, pressurePa = 101325): number {
  const um = clampWl(nm) / 1000;
  const s2 = 1 / (um * um);
  const ns = (8342.54 + 2406147 / (130 - s2) + 15998 / (38.9 - s2)) * 1e-8; // (n-1) at 15 C
  const p = pressurePa;
  return 1 + (ns * p * (1 + p * (0.601 - 0.00972 * tC) * 1e-8)) / (96095.43 * (1 + 0.003661 * tC));
}

type Disp = (um: number) => number;

/** Standard Sellmeier: n^2 = 1 + sum B_i l^2/(l^2 - C_i)  (C_i in um^2). */
function sellmeier(B: number[], C: number[]): Disp {
  return (um) => {
    const l2 = um * um;
    let s = 1;
    for (let i = 0; i < B.length; i++) s += (B[i] * l2) / (l2 - C[i]);
    return Math.sqrt(s);
  };
}
const sq = (a: number[]) => a.map((x) => x * x);

const BECQUEREL = 293.34; // e/(2 m_e c) in rad/(T m)

interface Spec {
  id: string; label: string; disp: Disp;
  relAir?: boolean; dndT?: number; gamma?: number;
  verdet?: (nm: number) => number;
  alpha?: (nm: number) => number;
}

function tableInterp(xs: number[], ys: number[], logY = false): (x: number) => number {
  return (x) => {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 1;
    while (xs[i] < x) i++;
    const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    if (logY) return Math.exp(Math.log(ys[i - 1]) * (1 - f) + Math.log(ys[i]) * f);
    return ys[i - 1] * (1 - f) + ys[i] * f;
  };
}

// Pure water absorption, 1/m. 380-720 nm Pope & Fry 1997; beyond: Hale & Querry 1973 / Kou 1993.
const waterAlphaM = tableInterp(
  [200, 300, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600, 620, 640, 660, 680, 700, 720, 750, 800, 850, 900, 950, 1000, 1100, 1200, 1400, 2000],
  [8, 0.14, 0.01137, 0.00663, 0.00454, 0.00635, 0.00979, 0.0127, 0.0204, 0.0409, 0.0474, 0.0619, 0.0896, 0.2224, 0.2755, 0.3108, 0.410, 0.465, 0.624, 1.231, 2.6, 2.0, 4.3, 6.8, 39, 36, 17, 104, 1200, 6900],
  true,
);

function make(spec: Spec): Material {
  const { disp, relAir, dndT = 0, gamma = 0 } = spec;
  const nCatalog = (nm: number) => disp(clampWl(nm) / 1000);
  const n = (nm: number, tC = 20) => {
    let v = nCatalog(nm);
    if (relAir) v *= nAir(nm, 20);
    return v + dndT * (tC - 20);
  };
  const verdet = spec.verdet ?? (gamma
    ? (nm: number) => {
        const h = 0.5;
        const dn = (nCatalog(nm + h) - nCatalog(nm - h)) / (2 * h); // per nm
        return -gamma * BECQUEREL * nm * dn;
      }
    : () => 0);
  return {
    id: spec.id, label: spec.label, n, nCatalog,
    alpha: spec.alpha ?? (() => 0), hasAlpha: !!spec.alpha, verdet,
  };
}

const SPECS: Spec[] = [
  { id: 'vacuum', label: 'Vacuum', disp: () => 1 },
  { id: 'air', label: 'Air', disp: (um) => nAir(um * 1000, 20) },
  {
    id: 'water', label: 'Water', relAir: true, dndT: -9.0e-5, gamma: 0.71,
    disp: sellmeier([5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1],
      [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1]),
    alpha: (nm) => waterAlphaM(nm) * 1e-3,
  },
  {
    id: 'ethanol', label: 'Ethanol', relAir: true, dndT: -4.0e-4, gamma: 0.7,
    disp: (um) => 1.35265 + 0.00306 / (um * um) + 0.00002 / (um * um * um * um),
  },
  {
    id: 'bk7', label: 'N-BK7 (borosilicate crown)', relAir: true, dndT: 1.6e-6, gamma: 0.66,
    disp: sellmeier([1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]),
  },
  {
    id: 'bak4', label: 'N-BAK4 (barium crown)', relAir: true, dndT: 2.5e-6, gamma: 0.68,
    disp: sellmeier([1.28834642, 0.132817724, 0.945395373], [0.00779980626, 0.0315631177, 105.965875]),
  },
  {
    id: 'f2', label: 'F2 (flint)', relAir: true, dndT: 2.7e-6, gamma: 0.78,
    disp: sellmeier([1.34533359, 0.209073176, 0.937357162], [0.00997743871, 0.0470450767, 111.886764]),
  },
  {
    id: 'sf10', label: 'SF10 (dense flint)', relAir: true, dndT: 6.0e-6, gamma: 0.8,
    disp: sellmeier([1.62153902, 0.256287842, 1.64447552], [0.0122241457, 0.0595736775, 147.468793]),
  },
  {
    id: 'sf11', label: 'N-SF11 (dense flint)', relAir: true, dndT: -0.4e-6, gamma: 0.8,
    disp: sellmeier([1.73759695, 0.313747346, 1.89878101], [0.013188707, 0.0623068142, 155.23629]),
  },
  {
    id: 'sf6', label: 'N-SF6 (dense flint)', relAir: true, dndT: -0.6e-6, gamma: 0.82,
    disp: sellmeier([1.77931763, 0.338149866, 2.08734474], [0.0133714182, 0.0617533621, 174.01759]),
  },
  {
    id: 'fused_silica', label: 'Fused silica', relAir: true, dndT: 8.6e-6, gamma: 0.66,
    disp: sellmeier([0.6961663, 0.4079426, 0.8974794], sq([0.0684043, 0.1162414, 9.896161])),
  },
  {
    id: 'caf2', label: 'Calcium fluoride (CaF2)', relAir: true, dndT: -1.06e-5, gamma: 0.7,
    disp: sellmeier([0.5675888, 0.4710914, 3.8484723], sq([0.050263605, 0.1003909, 34.649040])),
  },
  {
    id: 'mgf2', label: 'Magnesium fluoride (MgF2, o-ray)', relAir: true, dndT: 2.3e-6, gamma: 0.7,
    disp: sellmeier([0.48755108, 0.39875031, 2.3120353], sq([0.04338408, 0.09461442, 23.793604])),
  },
  {
    id: 'sapphire', label: 'Sapphire (o-ray)', relAir: true, dndT: 1.3e-5, gamma: 0.7,
    disp: sellmeier([1.4313493, 0.65054713, 5.3414021], sq([0.0726631, 0.1193242, 18.028251])),
  },
  {
    id: 'diamond', label: 'Diamond', relAir: true, dndT: 1.0e-5, gamma: 0.7,
    disp: sellmeier([0.3306, 4.3356], sq([0.175, 0.106])),
  },
  {
    id: 'pmma', label: 'Acrylic (PMMA)', relAir: true, dndT: -1.2e-4, gamma: 0.7,
    disp: sellmeier([1.1819], [0.011313]),
  },
  {
    id: 'polycarbonate', label: 'Polycarbonate', relAir: true, dndT: -1.07e-4, gamma: 0.75,
    disp: sellmeier([1.4182], [0.021304]),
  },
  {
    id: 'polystyrene', label: 'Polystyrene', relAir: true, dndT: -1.2e-4, gamma: 0.75,
    disp: sellmeier([1.4435], [0.020216]),
  },
  {
    id: 'tgg', label: 'TGG (terbium gallium garnet)', relAir: true, dndT: 2.0e-5,
    disp: sellmeier([2.7729], [0.018174]),
    verdet: (nm) => (-134 * (632.8 * 632.8 - 258.2 * 258.2)) / (Math.max(nm, 300) ** 2 - 258.2 * 258.2),
    alpha: () => 1.5e-4,
  },
  {
    id: 'bbo', label: 'BBO (beta barium borate, o-ray)', relAir: true, dndT: -1.66e-5, gamma: 0.7,
    disp: (um) => Math.sqrt(2.7359 + 0.01878 / (um * um - 0.01822) - 0.01354 * um * um),
  },
];

const TABLE = new Map<string, Material>();
for (const s of SPECS) TABLE.set(s.id, make(s));

const ALIASES: Record<string, string> = {
  nbk7: 'bk7', nbak4: 'bak4', nsf11: 'sf11', nsf6: 'sf6', nsf10: 'sf10', silica: 'fused_silica',
  fusedsilica: 'fused_silica', sio2: 'fused_silica', quartz: 'fused_silica', acrylic: 'pmma', pc: 'polycarbonate',
  h2o: 'water', glass: 'bk7', crown: 'bk7', flint: 'f2', al2o3: 'sapphire', ps: 'polystyrene',
};

/** Material list for UI select options. `custom` is resolved per component from index + Abbe number. */
export const MATERIALS: { id: string; label: string }[] = [
  ...SPECS.map((s) => ({ id: s.id, label: s.label })),
  { id: 'custom', label: 'Custom (index + Abbe number)' },
];

/** Cauchy two-term material from n_d (587.56 nm) and Abbe number V_d. */
export function customMaterial(nd: number, abbe: number): Material {
  const V = Math.max(abbe, 1);
  const B = (nd - 1) / V / (1 / (0.48613 * 0.48613) - 1 / (0.65627 * 0.65627));
  const A = nd - B / (0.58756 * 0.58756);
  return make({ id: 'custom', label: 'Custom', gamma: 0.7, disp: (um) => A + B / (um * um) });
}

/** Lookup by id (case/format tolerant: 'N-BK7', 'bk7', 'Fused Silica' ...). Unknown ids fall back to N-BK7. */
export function getMaterial(id: string): Material {
  const direct = TABLE.get(id);
  if (direct) return direct;
  const key = String(id).toLowerCase().replace(/[\s\-_]/g, '');
  const viaAlias = ALIASES[key];
  if (viaAlias) return TABLE.get(viaAlias)!;
  for (const m of TABLE.values()) if (m.id.replace(/_/g, '') === key) return m;
  return TABLE.get('bk7')!;
}

/** Convenience: absolute refractive index of a material id. */
export function refractiveIndex(id: string, nm: number, tC = 20): number {
  return getMaterial(id).n(nm, tC);
}

// ---------------------------------------------------------------------------
// Metals: complex refractive index n + ik (Johnson & Christy 1972 for Ag, Au; Rakic 1995 for Al)
// ---------------------------------------------------------------------------

export interface Metal { id: string; label: string; nk(nm: number, out: Float64Array): void }

function metal(id: string, label: string, wl: number[], n: number[], k: number[]): Metal {
  const fn = tableInterp(wl, n);
  const fk = tableInterp(wl, k);
  return { id, label, nk: (nm, out) => { out[0] = fn(nm); out[1] = fk(nm); } };
}

export const METALS: Record<string, Metal> = {
  silver: metal('silver', 'Silver',
    [354, 400, 451, 496, 549, 582, 660, 704, 756, 821, 984],
    [0.21, 0.05, 0.04, 0.05, 0.06, 0.05, 0.05, 0.04, 0.03, 0.04, 0.04],
    [1.42, 2.07, 2.657, 3.093, 3.586, 3.858, 4.483, 4.838, 5.242, 5.727, 6.992]),
  aluminium: metal('aluminium', 'Aluminium',
    [400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 1000],
    [0.49, 0.62, 0.77, 0.96, 1.20, 1.47, 1.83, 2.40, 2.80, 2.61, 2.06, 1.35],
    [4.86, 5.47, 6.08, 6.69, 7.26, 7.79, 8.31, 8.62, 8.45, 8.22, 8.30, 9.58]),
  gold: metal('gold', 'Gold',
    [400, 413, 430, 451, 471, 496, 521, 549, 582, 617, 660, 704, 756, 821, 984],
    [1.48, 1.47, 1.46, 1.38, 1.24, 1.04, 0.62, 0.43, 0.29, 0.21, 0.14, 0.13, 0.14, 0.16, 0.22],
    [1.883, 1.953, 1.958, 1.914, 1.796, 1.833, 2.081, 2.455, 2.863, 3.272, 3.697, 4.103, 4.542, 5.083, 6.35]),
};
