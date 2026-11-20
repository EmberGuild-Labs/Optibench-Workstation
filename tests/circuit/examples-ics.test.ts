/** Behaviour of the example projects 13–15 (op-amp receiver, servo scan mirror, regulated motor supply). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/project';
import { simulateDocument, validateDocument, type SimulationReport } from '../../scripts/obw-cli';

const load = (name: string) => parseDocument(readFileSync(join(__dirname, '..', '..', 'examples', name), 'utf8'));
const comp = (rep: SimulationReport, id: string) => rep.components.find((x) => x.id === id)!;
const det = (rep: SimulationReport, id: string) => rep.detectors.find((x) => x.id === id)!;
function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}

describe('examples 13–15', () => {
  for (const f of ['13-opamp-photodiode-amp.obw', '14-laser-show-servo.obw', '15-regulated-psu-motor.obw']) {
    it(`${f} parses and validates without warnings`, () => {
      const { doc, warnings } = load(f);
      expect(warnings).toEqual([]);
      const rep = validateDocument(doc);
      expect(rep.errors).toEqual([]);
      expect(rep.warnings).toEqual([]);
    });
  }

  it('13: the transimpedance amplifier reproduces the laser modulation; the comparator LED follows it', () => {
    const rep = simulateDocument(load('13-opamp-photodiode-amp.obw').doc, { seconds: 0.6, record: ['ld.opticalPower', 'u1.voltage', 'led.brightness', 'pd.photocurrent'] });
    expect(rep.nonConvergedTicks).toBe(0);
    const skip = 50; // start-up
    const p = rep.series['ld.opticalPower'].slice(skip), v = rep.series['u1.voltage'].slice(skip), i = rep.series['pd.photocurrent'].slice(skip);
    expect(correlation(p, v)).toBeGreaterThan(0.99);
    for (let k = 0; k < v.length; k += 25) expect(v[k]).toBeCloseTo(47000 * i[k], 1); // V = I·RF (one tick of link delay)
    expect(comp(rep, 'prx').tail!.max).toBeGreaterThan(5);
    expect(comp(rep, 'prx').tail!.min).toBeLessThan(2.5);
    expect(comp(rep, 'prx').freq).toBeCloseTo(5, 0);
    expect(comp(rep, 'led').edges.on.rises).toBeGreaterThanOrEqual(2);
    expect(correlation(v, rep.series['led.brightness'].slice(skip))).toBeGreaterThan(0.7);
    expect(det(rep, 'det').power.max).toBeLessThan(0.02 * comp(rep, 'ld').stats.opticalPower.max); // OD 2 filter
  });

  it('14: the servo sweeps the mirror; the target is hit once per pass and the counter counts', () => {
    const { doc } = load('14-laser-show-servo.obw');
    const before = JSON.stringify(doc.optics);
    const rep = simulateDocument(doc, { seconds: 4.2, record: ['sv.angleDeg', 'det:target', 'det:wall'] });
    expect(rep.nonConvergedTicks).toBe(0);
    expect(JSON.stringify(doc.optics)).toBe(before); // the document mirror is never turned
    const a = rep.series['sv.angleDeg'], t = rep.series['det:target'], w = rep.series['det:wall'];
    expect(Math.max(...a)).toBeGreaterThan(170);
    expect(Math.min(...a.slice(1500))).toBeLessThan(10);
    let on = 0;
    for (let k = 0; k < a.length; k++) {
      if (t[k] > 0.004) { on++; expect(Math.abs(a[k] - 90)).toBeLessThan(9); } // lit only around mid-sweep (mirror ≈ 45°)
      if (Math.abs(a[k] - 90) > 20) { expect(t[k]).toBeLessThan(1e-6); expect(w[k]).toBeGreaterThan(0.004); }
    }
    expect(on).toBeGreaterThan(100);
    expect(on).toBeLessThan(0.15 * a.length);
    expect(comp(rep, 'cnt').values!.count).toEqual([0, 1, 2, 3, 4]);
    expect(comp(rep, 'led').edges.on.rises).toBe(4);
    expect(rep.traces).toBeLessThan(rep.ticks * 0.6); // re-traced only when the mirror moved > 0.05°
  });

  it('15: clean 9 V / 5 V rails from the rectifier, PWM motor drive, reversal with the DIR switch', () => {
    const rep = simulateDocument(load('15-regulated-psu-motor.obw').doc, {
      seconds: 3, record: ['m1.speed', 'vm.value', 'u2.voltage'], actions: [{ t: 1.5, id: 'sw', action: 'toggle' }],
    });
    expect(rep.nonConvergedTicks).toBe(0);
    const speed = rep.series['m1.speed'], v9 = rep.series['vm.value'], v5 = rep.series['u2.voltage'];
    for (let k = 200; k < v9.length; k++) {
      expect(v9[k]).toBeGreaterThan(8.8);
      expect(v9[k]).toBeLessThan(10); // the braking motor briefly pumps energy back into the rail (C2)
      expect(v5[k]).toBeCloseTo(5, 1);
    }
    const raw = comp(rep, 'praw').tail!;
    expect(raw.mean).toBeGreaterThan(13.5);
    expect(raw.max - raw.min).toBeGreaterThan(0.05); // ripple before the regulator …
    expect(raw.max - raw.min).toBeLessThan(1.5);
    const fwd = speed[1450], rev = speed[2990];
    expect(fwd).toBeGreaterThan(350); // PWM at 75 %: below the 600 rad/s of full drive
    expect(fwd).toBeLessThan(600);
    expect(rev).toBeCloseTo(-fwd, -1.5);
    expect(comp(rep, 'f1').final.blown).toBe(false);
    expect(comp(rep, 'led').stats.brightness.max).toBeGreaterThan(0.25);
  });
});
