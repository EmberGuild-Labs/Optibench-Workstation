/**
 * Every example project in examples/ must parse cleanly, validate without errors or warnings, and
 * behave physically sensibly under a short headless co-simulation (scripts/obw.ts).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/core/project';
import type { ObwDocument } from '../src/core/types';
import { decode7seg, simulateDocument, validateDocument, type SimulationReport } from '../scripts/obw-cli';

const DIR = join(__dirname, '..', 'examples');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.obw')).sort();

function load(name: string): ObwDocument {
  return parseDocument(readFileSync(join(DIR, name), 'utf8')).doc;
}
const comp = (rep: SimulationReport, id: string) => {
  const c = rep.components.find((x) => x.id === id);
  if (!c) throw new Error(`no component ${id}`);
  return c;
};
const det = (rep: SimulationReport, id: string) => {
  const d = rep.detectors.find((x) => x.id === id);
  if (!d) throw new Error(`no detector ${id}`);
  return d;
};
function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}

describe('example projects', () => {
  it('has the ten documented examples', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
    for (const p of ['01-', '02-', '03-', '04-', '05-', '06-', '07-', '08-', '09-', '10-']) expect(FILES.some((f) => f.startsWith(p))).toBe(true);
  });

  for (const f of FILES) {
    it(`${f} parses and validates cleanly`, () => {
      const { doc, warnings } = parseDocument(readFileSync(join(DIR, f), 'utf8'));
      expect(warnings).toEqual([]);
      expect(doc.meta.title).not.toBe('Untitled Project');
      expect(doc.meta.description?.length ?? 0).toBeGreaterThan(40);
      const rep = validateDocument(doc);
      expect(rep.errors).toEqual([]);
      expect(rep.warnings).toEqual([]);
    });
  }
});

describe('example behaviour (headless co-simulation)', () => {
  it('01 prism: the spectrometer sees violet, blue and red; the screen separates red from blue', () => {
    const rep = simulateDocument(load('01-prism-rainbow.obw'), { seconds: 0.002 });
    const s = det(rep, 'spec').spectrum!;
    expect(s.bands['violet <450']).toBeGreaterThan(0.01);
    expect(s.bands['blue 450-495']).toBeGreaterThan(0.01);
    expect(s.bands['red >620']).toBeGreaterThan(0.01);
    const hits = rep.lastTrace!.detectors.screen.hits!;
    const meanY = (lo: number, hi: number) => {
      const h = hits.filter((x) => x.wavelength >= lo && x.wavelength <= hi && x.power > 1e-3);
      return h.reduce((a, x) => a + x.p.y, 0) / h.length;
    };
    // after the fold mirror the fan is spread vertically on the screen; red and violet land > 5 mm apart
    expect(Math.abs(meanY(380, 450) - meanY(620, 780))).toBeGreaterThan(5);
  });

  it('02 lenses: the expanded beam is focused onto the meter; the strong lens shows spherical aberration', () => {
    const rep = simulateDocument(load('02-lens-focusing.obw'), { seconds: 0.002 });
    expect(det(rep, 'pm').power.final).toBeGreaterThan(0.0045); // > 90 % of 5 mW
    expect(det(rep, 'scr').screen!.rmsMm).toBeGreaterThan(1);   // blurred at the paraxial focus
  });

  it('03 fibre: most of the laser power reaches the far meter through the fibre', () => {
    const rep = simulateDocument(load('03-fiber-link.obw'), { seconds: 0.002 });
    const p = det(rep, 'pm').power.final;
    expect(p).toBeGreaterThan(0.0035);
    expect(p).toBeLessThan(0.005);
  });

  it('04 Faraday: transmitted power follows the coil current', () => {
    const rep = simulateDocument(load('04-faraday-isolator.obw'), { seconds: 0.6, record: ['coil.current', 'det:pm'] });
    const pm = det(rep, 'pm').power;
    expect(pm.min).toBeLessThan(0.0026);   // ~50 % at zero current
    expect(pm.max).toBeGreaterThan(0.004); // ~90 % at peak field
    expect(correlation(rep.series['coil.current'], rep.series['det:pm'])).toBeGreaterThan(0.9);
  });

  it('05 555: the LED blinks at ~1.9 Hz', () => {
    const rep = simulateDocument(load('05-blinking-led-555.obw'), { seconds: 1.6 });
    expect(rep.nonConvergedTicks).toBe(0);
    const led = comp(rep, 'led');
    expect(led.edges.on.rises).toBeGreaterThanOrEqual(2);
    expect(led.stats.brightness.max).toBeGreaterThan(0.5);
    expect(led.stats.brightness.min).toBeLessThan(0.01);
    const f = comp(rep, 'u').edges.on.freq;
    expect(f).toBeGreaterThan(1.5);
    expect(f).toBeLessThan(2.4);
  });

  it('06 counter: the 7-segment display shows successive digits', () => {
    const rep = simulateDocument(load('06-counter-7seg.obw'), { seconds: 1.2 });
    const digits = comp(rep, 'disp').digits!.filter((d) => /\d/.test(d));
    expect(new Set(digits).size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < digits.length; i++) expect(Number(digits[i])).toBe((Number(digits[i - 1]) + 1) % 10);
  });

  it('07 PSU: ~14 V DC with small ripple, power LED on', () => {
    const rep = simulateDocument(load('07-transformer-psu.obw'), { seconds: 0.2, dt: 5e-4 });
    const out = comp(rep, 'pout').tail!;
    expect(out.mean).toBeGreaterThan(12);
    expect(out.mean).toBeLessThan(16);
    expect(out.max - out.min).toBeLessThan(1);
    expect(comp(rep, 'led').stats.brightness.max).toBeGreaterThan(0.3);
    expect(comp(rep, 'psec').freq).toBeGreaterThan(40);
  });

  it('08 optical link: photodiode current follows the laser drive and the counter counts pulses', () => {
    const rep = simulateDocument(load('08-optical-link.obw'), { seconds: 1.6, record: ['ld.opticalPower', 'rxpd.photocurrent', 'led.brightness'] });
    expect(rep.nonConvergedTicks).toBe(0);
    expect(correlation(rep.series['ld.opticalPower'], rep.series['rxpd.photocurrent'])).toBeGreaterThan(0.95);
    expect(correlation(rep.series['ld.opticalPower'], rep.series['led.brightness'])).toBeGreaterThan(0.9);
    expect(comp(rep, 'rxpd').stats.photocurrent.max).toBeGreaterThan(1e-3);
    expect(comp(rep, 'cnt').values!.count.length).toBeGreaterThanOrEqual(3);
    expect(det(rep, 'pd').power.max).toBeGreaterThan(0.8 * comp(rep, 'ld').stats.opticalPower.max);
  });

  it('09 polarization: Malus, three-polarizer paradox and PBS split', () => {
    const doc = load('09-polarization-lab.obw');
    const rep = simulateDocument(doc, { seconds: 0.002 });
    const P0 = 0.005, T = 0.95;
    expect(det(rep, 'pm1').power.final).toBeCloseTo(P0 * T * Math.cos((60 * Math.PI) / 180) ** 2, 4);
    expect(det(rep, 'pm2').power.final).toBeCloseTo(P0 * T ** 3 * 0.25, 4);
    const r = det(rep, 'pmr').power.final, t = det(rep, 'pmt').power.final;
    expect(r / P0).toBeGreaterThan(0.45);
    expect(t / P0).toBeGreaterThan(0.2); // ~half of the transmitted p light passes the analyser after the QWP
    // remove the middle polarizer: crossed pair blocks the beam
    doc.optics.components = doc.optics.components.filter((c) => c.id !== 'p22');
    expect(det(simulateDocument(doc, { seconds: 0.002 }), 'pm2').power.final).toBeLessThan(1e-5);
  });

  it('10 LED matrix: odd rows light up as binary bars, even rows stay dark', () => {
    const rep = simulateDocument(load('10-led-matrix.obw'), { seconds: 2.2 });
    const m = comp(rep, 'mat').matrixMean!;
    const row = (r: number) => m.slice(r * 8, r * 8 + 8).reduce((a, v) => a + v, 0) / 8;
    for (const r of [0, 2, 4]) expect(row(r)).toBeGreaterThan(0.05);
    for (const r of [1, 3, 5, 7]) expect(row(r)).toBeLessThan(1e-3);
    expect(comp(rep, 'cnt').values!.count.length).toBeGreaterThanOrEqual(4);
  });
});

describe('obw helpers', () => {
  it('decodes 7-segment patterns', () => {
    expect(decode7seg([1, 1, 1, 1, 1, 1, 0, 0])).toBe('0');
    expect(decode7seg([0, 1, 1, 0, 0, 0, 0, 0])).toBe('1');
    expect(decode7seg([0, 0, 0, 0, 0, 0, 0, 0])).toBe('');
  });
});
