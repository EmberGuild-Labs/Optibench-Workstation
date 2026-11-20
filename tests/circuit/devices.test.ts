import { describe, expect, it } from 'vitest';
import { Bench, comp, run } from './helpers';

function supply(b: Bench, v = 5, id = 'V'): void {
  b.add('source.battery', id, { voltage: v, internalResistance: 0.01, capacity: 1e5 });
  b.ground(`${id}:-`);
}

describe('diodes', () => {
  it('silicon diode forward drop is 0.6–0.7 V', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.add('semi.diode', 'D');
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'D:A');
    b.ground('D:K');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'D').voltage).toBeGreaterThan(0.6);
    expect(comp(s, 'D').voltage).toBeLessThan(0.7);
    expect(comp(s, 'D').current).toBeCloseTo((5 - comp(s, 'D').voltage) / 1000, 5);
  });

  it('reverse-biased diode blocks', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.add('semi.diode', 'D');
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'D:K');
    b.ground('D:A');
    const s = run(b.sim(), 1e-3);
    expect(Math.abs(comp(s, 'D').current)).toBeLessThan(1e-7);
    expect(comp(s, 'D').voltage).toBeCloseTo(-5, 2);
  });

  it('diode directly across a stiff supply still converges', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('semi.diode', 'D', { rs: 0.05 });
    b.connect('V:+', 'D:A');
    b.ground('D:K');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'D').current).toBeGreaterThan(10);
  });

  it('zener regulates at Vz', () => {
    const b = new Bench();
    supply(b, 12);
    b.add('passive.resistor', 'R', { resistance: 470 });
    b.add('semi.zener', 'Z', { vz: 5.1 });
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'Z:K');
    b.ground('Z:A');
    const s = run(b.sim(), 1e-3);
    expect(-comp(s, 'Z').voltage).toBeGreaterThan(5.0);
    expect(-comp(s, 'Z').voltage).toBeLessThan(5.35);
    expect(comp(s, 'Z').regulating).toBe(true);
  });

  it('LED current is limited by its series resistor; brightness / optical power / wavelength reported', () => {
    for (const [color, vfMin, vfMax, wl] of [['red', 1.7, 2.0, 630], ['blue', 2.8, 3.2, 470], ['ir', 1.1, 1.4, 940]] as const) {
      const b = new Bench();
      supply(b, 5);
      b.add('passive.resistor', 'R', { resistance: 220 });
      b.add('semi.led', 'L', { color });
      b.connect('V:+', 'R:A');
      b.connect('R:B', 'L:A');
      b.ground('L:K');
      const s = run(b.sim(), 1e-3);
      const led = comp(s, 'L');
      expect(s.converged).toBe(true);
      expect(led.voltage).toBeGreaterThan(vfMin);
      expect(led.voltage).toBeLessThan(vfMax);
      expect(led.current).toBeCloseTo((5 - led.voltage) / 220.01, 5);
      expect(led.brightness).toBeCloseTo(Math.min(1, led.current / 0.02), 6);
      expect(led.wavelength).toBe(wl);
      expect(led.opticalPower).toBeGreaterThan(0.05 * led.power);
      expect(led.opticalPower).toBeLessThan(led.power);
    }
  });

  it('reversed LED stays dark', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('passive.resistor', 'R', { resistance: 220 });
    b.add('semi.led', 'L');
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'L:K');
    b.ground('L:A');
    const s = run(b.sim(), 1e-3);
    expect(comp(s, 'L').brightness).toBe(0);
    expect(comp(s, 'L').opticalPower).toBe(0);
  });
});

describe('transistors', () => {
  function bjtSwitch(baseHigh: boolean) {
    const b = new Bench();
    supply(b, 5);
    b.add('passive.resistor', 'RC', { resistance: 1000 });
    b.add('passive.resistor', 'RB', { resistance: 10000 });
    b.add('semi.npn', 'Q');
    b.connect('V:+', 'RC:A');
    b.connect('RC:B', 'Q:C');
    b.connect('RB:B', 'Q:B');
    if (baseHigh) b.connect('V:+', 'RB:A');
    else b.ground('RB:A');
    b.ground('Q:E');
    return run(b.sim(), 1e-3);
  }
  it('NPN switch saturates when driven and cuts off otherwise', () => {
    const on = bjtSwitch(true);
    expect(on.converged).toBe(true);
    const q = comp(on, 'Q');
    expect(q.vce).toBeLessThan(0.2);
    expect(q.vce).toBeGreaterThan(0);
    expect(q.vbe).toBeGreaterThan(0.6);
    expect(q.vbe).toBeLessThan(0.8);
    expect(q.ic).toBeCloseTo((5 - q.vce) / 1000, 4);
    expect(q.region).toBe('saturation');
    const off = bjtSwitch(false);
    expect(comp(off, 'Q').vce).toBeCloseTo(5, 2);
    expect(comp(off, 'Q').region).toBe('cutoff');
  });

  it('NPN in the active region has Ic ≈ β·Ib', () => {
    const b = new Bench();
    supply(b, 10);
    b.add('passive.resistor', 'RC', { resistance: 100 });
    b.add('passive.resistor', 'RB', { resistance: 1e6 });
    b.add('semi.npn', 'Q', { beta: 100, vaf: 0 });
    b.connect('V:+', 'RC:A', 'RB:A');
    b.connect('RC:B', 'Q:C');
    b.connect('RB:B', 'Q:B');
    b.ground('Q:E');
    const s = run(b.sim(), 1e-3);
    const q = comp(s, 'Q');
    expect(q.region).toBe('active');
    expect(q.ic / q.ib).toBeCloseTo(100, 0);
  });

  it('PNP high-side switch', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('semi.pnp', 'Q');
    b.add('passive.resistor', 'RB', { resistance: 10000 });
    b.add('passive.resistor', 'RL', { resistance: 1000 });
    b.connect('V:+', 'Q:E');
    b.connect('Q:B', 'RB:A');
    b.ground('RB:B');
    b.connect('Q:C', 'RL:A');
    b.ground('RL:B');
    const s = run(b.sim(), 1e-3);
    expect(s.converged).toBe(true);
    expect(comp(s, 'RL').voltage).toBeGreaterThan(4.8);
  });

  it('N-MOSFET low-side switch and square-law saturation current', () => {
    const mk = (vg: number, rd: number) => {
      const b = new Bench();
      supply(b, 10);
      b.add('source.battery', 'VG', { voltage: vg, internalResistance: 0.01 });
      b.ground('VG:-');
      b.add('passive.resistor', 'RD', { resistance: rd });
      b.add('semi.nmos', 'M', { vth: 2, k: 0.5, lambda: 0 });
      b.connect('V:+', 'RD:A');
      b.connect('RD:B', 'M:D');
      b.connect('VG:+', 'M:G');
      b.ground('M:S');
      return run(b.sim(), 1e-3);
    };
    const on = mk(10, 100);
    expect(on.converged).toBe(true);
    expect(comp(on, 'M').vds).toBeLessThan(0.1);
    expect(comp(on, 'M').region).toBe('triode');
    const sat = mk(3, 10); // Id = K/2 (1)^2 = 0.25 A
    expect(comp(sat, 'M').id).toBeCloseTo(0.25, 3);
    expect(comp(sat, 'M').region).toBe('saturation');
    const off = mk(1, 100);
    expect(comp(off, 'M').vds).toBeCloseTo(10, 2);
  });

  it('P-MOSFET high-side switch', () => {
    const b = new Bench();
    supply(b, 10);
    b.add('semi.pmos', 'M');
    b.add('passive.resistor', 'RL', { resistance: 100 });
    b.connect('V:+', 'M:S');
    b.ground('M:G');
    b.connect('M:D', 'RL:A');
    b.ground('RL:B');
    const s = run(b.sim(), 1e-3);
    expect(comp(s, 'RL').voltage).toBeGreaterThan(9.8);
  });
});

describe('sources', () => {
  it('bench PSU regulates in CV and folds back to CC', () => {
    const mk = (r: number) => {
      const b = new Bench();
      b.add('source.psu', 'P', { voltage: 12, currentLimit: 0.5 });
      b.add('passive.resistor', 'R', { resistance: r });
      b.connect('P:+', 'R:A');
      b.connect('P:-', 'R:B');
      b.ground('P:-');
      return run(b.sim(), 1e-3);
    };
    const cv = mk(100);
    expect(cv.converged).toBe(true);
    expect(comp(cv, 'R').voltage).toBeCloseTo(12, 1);
    expect(comp(cv, 'P').mode).toBe('CV');
    const cc = mk(4);
    expect(cc.converged).toBe(true);
    expect(comp(cc, 'P').current).toBeCloseTo(0.5, 2);
    expect(comp(cc, 'R').voltage).toBeCloseTo(2, 1);
    expect(comp(cc, 'P').mode).toBe('CC');
  });

  it('function generator waveforms', () => {
    for (const waveform of ['sine', 'square', 'triangle', 'sawtooth']) {
      const b = new Bench();
      b.add('source.function_gen', 'F', { waveform, frequency: 100, amplitude: 2, offset: 1, outputResistance: 50 });
      b.add('passive.resistor', 'R', { resistance: 1e6 });
      b.connect('F:+', 'R:A');
      b.connect('F:-', 'R:B');
      b.ground('F:-');
      let min = Infinity, max = -Infinity, sum = 0, n = 0;
      run(b.sim(), 0.02, 1e-4, (s) => {
        const v = comp(s, 'R').voltage;
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        n++;
      });
      expect(max, waveform).toBeCloseTo(3, 1);
      expect(min, waveform).toBeCloseTo(-1, 1);
      expect(sum / n, waveform).toBeCloseTo(1, 1);
    }
  });

  it('current source drives a resistor', () => {
    const b = new Bench();
    b.add('source.current', 'I', { current: 0.002 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.connect('I:+', 'R:A');
    b.connect('I:-', 'R:B');
    b.ground('I:-');
    const s = run(b.sim(), 1e-3);
    expect(comp(s, 'R').voltage).toBeCloseTo(2, 4);
  });
});

describe('ICs and digital', () => {
  it('555 astable frequency ≈ 1.44 / ((R1 + 2·R2)·C) within 5 %', () => {
    const b = new Bench();
    supply(b, 9);
    b.add('ic.555', 'U');
    b.add('passive.resistor', 'R1', { resistance: 1000 });
    b.add('passive.resistor', 'R2', { resistance: 10000 });
    b.add('passive.capacitor', 'C', { capacitance: 100e-9 });
    b.add('passive.capacitor', 'CC', { capacitance: 10e-9 });
    b.connect('V:+', 'U:VCC');
    b.connect('V:+', 'U:RESET');
    b.connect('V:+', 'R1:A');
    b.connect('R1:B', 'U:DIS');
    b.connect('U:DIS', 'R2:A');
    b.connect('R2:B', 'U:THR');
    b.connect('U:THR', 'U:TRIG');
    b.connect('U:TRIG', 'C:A');
    b.ground('C:B', 'U:GND', 'CC:B');
    b.connect('U:CTRL', 'CC:A');
    const sim = b.sim();
    const rises: number[] = [];
    let prev = false;
    let highTime = 0, total = 0;
    const s = run(sim, 0.03, 2e-5, (st) => {
      const on = comp(st, 'U').on as boolean;
      if (on && !prev) rises.push(st.time);
      prev = on;
      if (st.time > 0.005) {
        total++;
        if (on) highTime++;
      }
    });
    expect(s.converged).toBe(true);
    expect(rises.length).toBeGreaterThan(10);
    const f = (rises.length - 2) / (rises[rises.length - 1] - rises[1]);
    const expected = 1.44 / ((1000 + 2 * 10000) * 100e-9);
    expect(Math.abs(f - expected) / expected).toBeLessThan(0.05);
    // duty = (R1+R2)/(R1+2R2) ≈ 52 %
    expect(highTime / total).toBeGreaterThan(0.48);
    expect(highTime / total).toBeLessThan(0.57);
    // output swings between ~0 and Vcc − 1.4 V
    expect(Math.abs(comp(s, 'U').voltage - (comp(s, 'U').on ? 7.6 : 0))).toBeLessThan(0.3);
  });

  it('555 astable at ~7 kHz stays accurate thanks to event localisation', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('ic.555', 'U', { variant: 'cmos' });
    b.add('passive.resistor', 'R1', { resistance: 1000 });
    b.add('passive.resistor', 'R2', { resistance: 10000 });
    b.add('passive.capacitor', 'C', { capacitance: 10e-9 });
    b.connect('V:+', 'U:VCC', 'R1:A');
    b.connect('R1:B', 'U:DIS', 'R2:A');
    b.connect('R2:B', 'U:THR', 'U:TRIG', 'C:A');
    b.ground('C:B', 'U:GND');
    const rises: number[] = [];
    let prev = false;
    run(b.sim(), 0.01, 2e-5, (st) => {
      const on = comp(st, 'U').on as boolean;
      if (on && !prev) rises.push(st.time);
      prev = on;
    });
    const f = (rises.length - 2) / (rises[rises.length - 1] - rises[1]);
    const expected = 1.44 / ((1000 + 2 * 10000) * 10e-9);
    expect(Math.abs(f - expected) / expected).toBeLessThan(0.06);
  });

  it('logic gates follow their truth tables', () => {
    const table: Record<string, number[]> = {
      'digital.and': [0, 0, 0, 1], 'digital.or': [0, 1, 1, 1], 'digital.nand': [1, 1, 1, 0], 'digital.xor': [0, 1, 1, 0],
    };
    for (const [type, out] of Object.entries(table)) {
      for (let i = 0; i < 4; i++) {
        const b = new Bench();
        supply(b, 5);
        b.add(type, 'G');
        b.add('passive.resistor', 'RL', { resistance: 10000 });
        if (i & 1) b.connect('V:+', 'G:A'); else b.ground('G:A');
        if (i & 2) b.connect('V:+', 'G:B'); else b.ground('G:B');
        b.connect('G:Y', 'RL:A');
        b.ground('RL:B');
        const s = run(b.sim(), 2e-4);
        expect(comp(s, 'RL').voltage > 2.5 ? 1 : 0, `${type} ${i}`).toBe(out[i]);
      }
    }
    const b = new Bench();
    b.add('digital.not', 'N');
    b.add('passive.resistor', 'RL', { resistance: 10000 });
    b.ground('N:A', 'RL:B');
    b.connect('N:Y', 'RL:A');
    const s = run(b.sim(), 2e-4);
    expect(comp(s, 'RL').voltage).toBeCloseTo(5 * 10000 / 10040, 2);
  });

  it('counter → BCD decoder → 7-segment display shows the count', () => {
    const b = new Bench();
    b.add('osc.crystal', 'X', { frequency: 100, ideal: true, amplitude: 5 });
    b.add('digital.counter', 'CNT');
    b.add('digital.bcd7seg', 'DEC');
    b.add('display.7seg', 'DS', { common: 'cathode', ratedCurrent: 0.01 });
    b.connect('X:OUT', 'CNT:CLK');
    b.ground('CNT:RST', 'DS:COM');
    const bits = ['A', 'B', 'C', 'D'];
    bits.forEach((p, i) => b.connect(`CNT:Q${i}`, `DEC:${p}`));
    for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      b.add('passive.resistor', `R${seg}`, { resistance: 330 });
      b.connect(`DEC:${seg}`, `R${seg}:A`);
      b.connect(`R${seg}:B`, `DS:${seg}`);
    }
    const sim = b.sim();
    const lit = (st: ReturnType<typeof sim.getState>): string =>
      (comp(st, 'DS').segments as number[]).slice(0, 7).map((x, i) => (x > 0.5 ? 'abcdefg'[i] : '')).join('');
    // rising clock edges at 10, 20, 30 ms …
    let s = run(sim, 0.005);
    expect(comp(s, 'CNT').count).toBe(0);
    expect(lit(s)).toBe('abcdef');
    s = run(sim, 0.035);
    expect(s.converged).toBe(true);
    expect(comp(s, 'CNT').count).toBe(3);
    expect(lit(s)).toBe('abcdg');
    const segs = comp(s, 'DS').segments as number[];
    expect(segs.length).toBe(8);
    expect(segs[0]).toBeCloseTo((5 - 1.85) / 373 / 0.01, 1);
    expect(segs[4]).toBeLessThan(0.01);
    s = run(sim, 0.075);
    expect(comp(s, 'CNT').count).toBe(7);
    expect(lit(s)).toBe('abc');
    s = run(sim, 0.165); // 16 edges -> wraps to 0
    expect(comp(s, 'CNT').count).toBe(0);
  });

  it('non-ideal crystal oscillator runs from its supply pins', () => {
    const b = new Bench();
    supply(b, 3.3);
    b.add('osc.crystal', 'X', { frequency: 1000, ideal: false });
    b.add('passive.resistor', 'RL', { resistance: 100000 });
    b.connect('V:+', 'X:VCC');
    b.ground('X:GND', 'RL:B');
    b.connect('X:OUT', 'RL:A');
    let max = 0, min = 9;
    run(b.sim(), 0.005, 5e-5, (s) => {
      if (s.time > 0.001) {
        max = Math.max(max, comp(s, 'RL').voltage);
        min = Math.min(min, comp(s, 'RL').voltage);
      }
    });
    expect(max).toBeCloseTo(3.3, 1);
    expect(min).toBeCloseTo(0, 1);
  });

  it('LED matrix lights only the addressed LED', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('display.matrix', 'M');
    b.add('passive.resistor', 'R', { resistance: 330 });
    b.connect('V:+', 'R:A');
    b.connect('R:B', 'M:R3');
    b.ground('M:C6');
    const s = run(b.sim(), 4e-4);
    expect(s.converged).toBe(true);
    const seg = comp(s, 'M').segments as number[];
    expect(seg.length).toBe(64);
    seg.forEach((x, i) => {
      if (i === 2 * 8 + 5) expect(x).toBeGreaterThan(0.8);
      else expect(x).toBeLessThan(0.01);
    });
  });
});

describe('switching and misc devices', () => {
  it('relay pulls in with hysteresis and switches its contacts', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('switch.push', 'S');
    b.add('switch.relay', 'K');
    b.add('semi.diode', 'D'); // flyback
    b.add('passive.resistor', 'RNO', { resistance: 1000 });
    b.add('passive.resistor', 'RNC', { resistance: 1000 });
    b.connect('V:+', 'S:A');
    b.connect('S:B', 'K:C1', 'D:K');
    b.ground('K:C2', 'D:A', 'RNO:B', 'RNC:B');
    b.connect('V:+', 'K:COM');
    b.connect('K:NO', 'RNO:A');
    b.connect('K:NC', 'RNC:A');
    const sim = b.sim();
    let s = run(sim, 1e-3);
    expect(comp(s, 'K').on).toBe(false);
    expect(comp(s, 'RNC').voltage).toBeGreaterThan(4.9);
    expect(comp(s, 'RNO').voltage).toBeLessThan(0.01);
    sim.interact('S', 'press');
    s = run(sim, 1.2e-3);
    expect(comp(s, 'K').on).toBe(false); // coil current still rising (L/R ≈ 0.7 ms)
    s = run(sim, 6e-3);
    expect(comp(s, 'K').on).toBe(true);
    expect(comp(s, 'K').current).toBeCloseTo(5 / 70, 2);
    expect(comp(s, 'RNO').voltage).toBeGreaterThan(4.9);
    expect(comp(s, 'RNC').voltage).toBeLessThan(0.01);
    sim.interact('S', 'release');
    s = run(sim, 0.02);
    expect(s.converged).toBe(true);
    expect(comp(s, 'K').on).toBe(false);
  });

  it('SPDT selects between two paths', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('switch.spdt', 'S');
    b.add('passive.resistor', 'RA', { resistance: 1000 });
    b.add('passive.resistor', 'RB', { resistance: 1000 });
    b.connect('V:+', 'S:COM');
    b.connect('S:A', 'RA:A');
    b.connect('S:B', 'RB:A');
    b.ground('RA:B', 'RB:B');
    const sim = b.sim();
    let s = run(sim, 2e-4);
    expect(comp(s, 'RA').voltage).toBeGreaterThan(4.9);
    expect(comp(s, 'RB').voltage).toBeLessThan(0.01);
    sim.interact('S', 'toggle');
    s = run(sim, 4e-4);
    expect(comp(s, 'RB').voltage).toBeGreaterThan(4.9);
    expect(comp(s, 'S').position).toBe('B');
  });

  it('incandescent lamp shows inrush current and warms up', () => {
    const b = new Bench();
    supply(b, 6);
    b.add('misc.lamp', 'LA', { ratedVoltage: 6, ratedPower: 0.6, tau: 0.02 });
    b.connect('V:+', 'LA:A');
    b.ground('LA:B');
    const sim = b.sim();
    let s = run(sim, 1e-4);
    const inrush = comp(s, 'LA').current;
    expect(inrush).toBeGreaterThan(0.5); // cold filament ≈ 14× lower resistance
    expect(comp(s, 'LA').brightness).toBeLessThan(0.05);
    s = run(sim, 0.3);
    expect(comp(s, 'LA').current).toBeCloseTo(0.1, 2);
    expect(comp(s, 'LA').brightness).toBeGreaterThan(0.9);
    expect(comp(s, 'LA').blown).toBe(false);
  });

  it('buzzer sounds when powered', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('misc.buzzer', 'BZ');
    b.add('switch.spst', 'S');
    b.connect('V:+', 'S:A');
    b.connect('S:B', 'BZ:+');
    b.ground('BZ:-');
    const sim = b.sim();
    expect(comp(run(sim, 2e-4), 'BZ').active).toBe(false);
    sim.interact('S', 'toggle');
    const s = run(sim, 4e-4);
    expect(comp(s, 'BZ').active).toBe(true);
    expect(comp(s, 'BZ').frequency).toBe(2300);
  });

  it('scope probe keeps a rolling (t, v) history', () => {
    const b = new Bench();
    b.add('source.ac', 'V', { amplitude: 3, frequency: 1000 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.add('meter.probe', 'TP', { window: 0.002 });
    b.connect('V:+', 'R:A', 'TP:IN');
    b.connect('V:-', 'R:B');
    b.ground('V:-');
    b.settings.timestep = 1e-6;
    const s = run(b.sim(), 0.005, 1e-4);
    const h = comp(s, 'TP').history as { t: number[]; v: number[] };
    expect(h.t.length).toBe(2000);
    expect(h.v.length).toBe(2000);
    expect(h.t[1999]).toBeCloseTo(0.005, 5);
    expect(h.t[1999] - h.t[0]).toBeCloseTo(0.002, 4);
    for (let i = 1; i < h.t.length; i++) expect(h.t[i]).toBeGreaterThan(h.t[i - 1]);
    expect(Math.max(...h.v)).toBeCloseTo(3, 1);
    expect(Math.min(...h.v)).toBeCloseTo(-3, 1);
    expect(comp(s, 'TP').text).toMatch(/V$/);
  });
});

describe('opto-electronic devices', () => {
  it('photodiode photocurrent follows setExternal(opticalPower)', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('opto.photodiode', 'PD', { responsivity: 0.5 });
    b.add('passive.resistor', 'R', { resistance: 1000 });
    b.connect('V:+', 'PD:K'); // reverse biased
    b.connect('PD:A', 'R:A');
    b.ground('R:B');
    const sim = b.sim();
    let s = run(sim, 2e-4);
    expect(comp(s, 'R').voltage).toBeLessThan(1e-4); // dark current only
    sim.setExternal('PD', 'opticalPower', 1e-3);
    s = run(sim, 4e-4);
    expect(s.converged).toBe(true);
    expect(comp(s, 'PD').current).toBeCloseTo(-0.5e-3, 6);
    expect(comp(s, 'PD').photocurrent).toBeCloseTo(0.5e-3, 6);
    expect(comp(s, 'R').voltage).toBeCloseTo(0.5, 3);
    sim.setExternal('PD', 'opticalPower', 2e-3);
    s = run(sim, 6e-4);
    expect(comp(s, 'R').voltage).toBeCloseTo(1.0, 3);
    // photovoltaic mode: open-circuit voltage appears across an unloaded photodiode
    const b2 = new Bench();
    b2.add('opto.photodiode', 'PD', { illumination: 1e-3 });
    b2.add('passive.resistor', 'R', { resistance: 1e7 });
    b2.connect('PD:A', 'R:A');
    b2.connect('PD:K', 'R:B');
    b2.ground('PD:K');
    const s2 = run(b2.sim(), 2e-4);
    expect(comp(s2, 'R').voltage).toBeGreaterThan(0.3);
    expect(comp(s2, 'R').voltage).toBeLessThan(0.7);
  });

  it('LDR resistance falls with light (with a response time)', () => {
    const b = new Bench();
    supply(b, 5);
    b.add('opto.ldr', 'LDR', { tau: 0.002 });
    b.add('passive.resistor', 'R', { resistance: 10000 });
    b.connect('V:+', 'LDR:A');
    b.connect('LDR:B', 'R:A');
    b.ground('R:B');
    const sim = b.sim();
    let s = run(sim, 1e-3);
    expect(comp(s, 'LDR').resistance).toBeCloseTo(1e6, -3);
    sim.setExternal('LDR', 'opticalPower', 1e-4);
    s = run(sim, 1.1e-3);
    expect(comp(s, 'LDR').resistance).toBeGreaterThan(6000); // still responding
    s = run(sim, 0.03);
    expect(comp(s, 'LDR').resistance).toBeCloseTo(5000, -1);
    expect(comp(s, 'R').voltage).toBeCloseTo(5 * 10000 / 15000, 1);
  });

  it('solar cell has a realistic I–V curve', () => {
    const mk = (r: number, light = 0.1) => {
      const b = new Bench();
      b.add('opto.solar_cell', 'SC', { voc: 2.4, isc: 0.05, pRef: 0.1, illumination: light });
      b.add('passive.resistor', 'R', { resistance: r });
      b.connect('SC:+', 'R:A');
      b.connect('SC:-', 'R:B');
      b.ground('SC:-');
      return run(b.sim(), 2e-4);
    };
    const sc = mk(0.01);
    expect(comp(sc, 'SC').current).toBeCloseTo(0.05, 3);
    const oc = mk(1e7);
    expect(comp(oc, 'R').voltage).toBeGreaterThan(2.2);
    expect(comp(oc, 'R').voltage).toBeLessThan(2.45);
    const mpp = mk(40);
    expect(comp(mpp, 'SC').power).toBeGreaterThan(0.6 * 2.4 * 0.05);
    expect(comp(mpp, 'SC').power).toBeLessThan(2.4 * 0.05);
    const dim = mk(0.01, 0.02);
    expect(comp(dim, 'SC').current).toBeCloseTo(0.01, 3);
    expect(comp(mk(100, 0), 'R').voltage).toBeLessThan(1e-3);
  });

  it('laser diode emits only above threshold: P = slope · (I − Ith)', () => {
    const mk = (r: number) => {
      const b = new Bench();
      supply(b, 5);
      b.add('passive.resistor', 'R', { resistance: r });
      b.add('opto.laser_diode', 'LD', { threshold: 0.02, slope: 0.8 });
      b.connect('V:+', 'R:A');
      b.connect('R:B', 'LD:A');
      b.ground('LD:K');
      return comp(run(b.sim(), 2e-4), 'LD');
    };
    const below = mk(330);
    expect(below.current).toBeLessThan(0.02);
    expect(below.current).toBeGreaterThan(0.005);
    expect(below.opticalPower).toBe(0);
    expect(below.lasing).toBe(false);
    const above = mk(56);
    expect(above.current).toBeGreaterThan(0.03);
    expect(above.opticalPower).toBeCloseTo(0.8 * (above.current - 0.02), 9);
    expect(above.wavelength).toBe(650);
  });

  it('electromagnet coil current rises with L/R and reports B', () => {
    const b = new Bench();
    supply(b, 8);
    b.add('opto.coil', 'EM', { inductance: 0.01, resistance: 7.99, turns: 500, length: 0.05, mur: 1 });
    b.connect('V:+', 'EM:A');
    b.ground('EM:B');
    const sim = b.sim();
    let s = run(sim, 0.00124); // ≈ τ = 1.25 ms
    expect(comp(s, 'EM').current).toBeGreaterThan(0.6);
    expect(comp(s, 'EM').current).toBeLessThan(0.66);
    s = run(sim, 0.02);
    expect(comp(s, 'EM').current).toBeCloseTo(1, 2);
    expect(comp(s, 'EM').bField).toBeCloseTo((4e-7 * Math.PI * 500 * 1) / 0.05, 4);
  });
});
