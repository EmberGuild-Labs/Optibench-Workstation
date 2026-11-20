import { describe, expect, it } from 'vitest';
import { getMaterial, nAir, opticsEngine, spectrumToRGB, wavelengthToRGB, silicaAttenuationDbPerKm, METALS, fresnelComplex } from '../../src/core/optics';

const D = 587.56;

describe('materials', () => {
  it('reproduces catalogue n_d values', () => {
    const expected: Record<string, number> = {
      bk7: 1.5168, fused_silica: 1.4585, sf11: 1.78472, f2: 1.62004, sf6: 1.80518, sf10: 1.72825, bak4: 1.56883,
      caf2: 1.43384, sapphire: 1.7682, diamond: 2.4175, pmma: 1.4906, polycarbonate: 1.5849, water: 1.3334, mgf2: 1.3777,
    };
    for (const [id, nd] of Object.entries(expected)) {
      expect(getMaterial(id).nCatalog(D), id).toBeCloseTo(nd, 3);
    }
    expect(getMaterial('bk7').nCatalog(D)).toBeCloseTo(1.5168, 4);
    expect(getMaterial('fused_silica').nCatalog(D)).toBeCloseTo(1.4585, 4);
  });

  it('has normal dispersion (blue index higher than red) and correct Abbe number for BK7', () => {
    const m = getMaterial('bk7');
    const V = (m.nCatalog(587.56) - 1) / (m.nCatalog(486.13) - m.nCatalog(656.27));
    expect(V).toBeCloseTo(64.17, 1);
    for (const mat of opticsEngine.materials) {
      if (mat.id === 'vacuum' || mat.id === 'custom') continue;
      expect(getMaterial(mat.id).n(450), mat.id).toBeGreaterThan(getMaterial(mat.id).n(650));
    }
  });

  it('air index and absolute indices', () => {
    expect(nAir(587.56, 15)).toBeCloseTo(1.000277, 5);
    expect(getMaterial('vacuum').n(500)).toBe(1);
    expect(getMaterial('bk7').n(D) / getMaterial('air').n(D)).toBeCloseTo(1.5168, 4);
  });

  it('resolves aliases', () => {
    expect(getMaterial('N-BK7').id).toBe('bk7');
    expect(getMaterial('Fused Silica').id).toBe('fused_silica');
    expect(getMaterial('acrylic').id).toBe('pmma');
  });

  it('Verdet constants', () => {
    expect(getMaterial('tgg').verdet(632.8)).toBeCloseTo(-134, 6);
    expect(getMaterial('tgg').verdet(1064)).toBeGreaterThan(-46);
    expect(getMaterial('tgg').verdet(1064)).toBeLessThan(-36);
    expect(getMaterial('water').verdet(589)).toBeGreaterThan(3.2);
    expect(getMaterial('water').verdet(589)).toBeLessThan(4.4);
    expect(getMaterial('fused_silica').verdet(632.8)).toBeGreaterThan(3.0);
    expect(getMaterial('fused_silica').verdet(632.8)).toBeLessThan(4.4);
    expect(getMaterial('sf6').verdet(632.8)).toBeGreaterThan(14);
    expect(getMaterial('sf6').verdet(632.8)).toBeLessThan(28);
  });

  it('water absorbs red far more than blue', () => {
    const w = getMaterial('water');
    expect(w.alpha(700) / w.alpha(450)).toBeGreaterThan(30);
    expect(w.alpha(420) * 1000).toBeCloseTo(0.00454, 4); // 1/m
  });

  it('metal reflectances are realistic', () => {
    const out = new Float64Array(4), nk = new Float64Array(2);
    const R = (id: string, wl: number) => { METALS[id].nk(wl, nk); fresnelComplex(1, nk[0], nk[1], 1, out); return out[0] ** 2 + out[1] ** 2; };
    expect(R('silver', 550)).toBeGreaterThan(0.95);
    expect(R('aluminium', 550)).toBeGreaterThan(0.88);
    expect(R('aluminium', 550)).toBeLessThan(0.94);
    expect(R('gold', 450)).toBeLessThan(0.45);
    expect(R('gold', 700)).toBeGreaterThan(0.95);
  });

  it('silica fibre attenuation', () => {
    expect(silicaAttenuationDbPerKm(1550)).toBeGreaterThan(0.14);
    expect(silicaAttenuationDbPerKm(1550)).toBeLessThan(0.25);
    expect(silicaAttenuationDbPerKm(633)).toBeGreaterThan(4);
    expect(silicaAttenuationDbPerKm(633)).toBeLessThan(9);
  });
});

describe('colour', () => {
  it('maps wavelengths to plausible colours in [0,1]', () => {
    for (let l = 200; l <= 1200; l += 7) {
      const c = wavelengthToRGB(l);
      for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    const [r5, g5, b5] = wavelengthToRGB(532);
    expect(g5).toBeGreaterThan(r5); expect(g5).toBeGreaterThan(b5);
    const [r6, g6, b6] = wavelengthToRGB(650);
    expect(r6).toBeGreaterThan(5 * g6); expect(r6).toBeGreaterThan(5 * b6);
    const [r4, g4, b4] = wavelengthToRGB(460);
    expect(b4).toBeGreaterThan(r4); expect(b4).toBeGreaterThan(g4);
  });

  it('UV and IR give dim but non-black display hints', () => {
    const uv = wavelengthToRGB(350), ir = wavelengthToRGB(1064);
    expect(uv[2]).toBeGreaterThan(0.05); expect(uv[2]).toBeLessThan(0.35); expect(uv[2]).toBeGreaterThan(uv[1]);
    expect(ir[0]).toBeGreaterThan(0.05); expect(ir[0]).toBeLessThan(0.35); expect(ir[1]).toBeLessThan(1e-6);
  });

  it('an equal-energy spectrum sums to roughly white', () => {
    let R = 0, G = 0, B = 0;
    const wl: number[] = [], pw: number[] = [];
    for (let l = 382; l < 780; l += 4) { const c = wavelengthToRGB(l); R += c[0]; G += c[1]; B += c[2]; wl.push(l); pw.push(1); }
    const m = (R + G + B) / 3;
    for (const v of [R, G, B]) { expect(v / m).toBeGreaterThan(0.75); expect(v / m).toBeLessThan(1.25); }
    const s = spectrumToRGB(wl, pw).rgb;
    expect(Math.min(...s)).toBeGreaterThan(0.7);
  });
});
