import type { CircuitComponent, CircuitScene, CircuitSimulator, CircuitState, ParamValue, Vec2, Wire } from '../../src/core/types';
import { circuitEngine, createSimulatorWithOptions, registryMap, defaultProps } from '../../src/core/circuit';

/** Small schematic builder for tests: components are placed far apart and joined by direct 2-point wires. */
export class Bench {
  components: CircuitComponent[] = [];
  wires: Wire[] = [];
  settings = circuitEngine.defaultSettings();
  private k = 0;

  add(type: string, id: string, props: Record<string, ParamValue> = {}, at?: Vec2, rotation: 0 | 1 | 2 | 3 = 0): string {
    const def = registryMap.get(type);
    if (!def) throw new Error(`unknown type ${type}`);
    const k = this.k++;
    this.components.push({
      id, type, name: id, rotation,
      position: at ?? { x: 40 * k, y: (k * k * 17) % 101 },
      props: { ...defaultProps(def), ...props },
    });
    return id;
  }

  pin(key: string): Vec2 {
    const [id, name] = key.split(':');
    const c = this.components.find((x) => x.id === id);
    if (!c) throw new Error(`no component ${id}`);
    const p = circuitEngine.getPinPositions(c).find((x) => x.name === name);
    if (!p) throw new Error(`no pin ${key}`);
    return p.p;
  }

  /**
   * Connect pins: connect('R1:A', 'V1:+', 'C1:A') chains them. Every wire takes its own detour
   * (pin -> unique far-away lane -> pin) so that test wires can never touch each other by accident;
   * a guard double-checks this in both directions.
   */
  connect(...keys: string[]): void {
    for (let i = 1; i < keys.length; i++) {
      const a = this.pin(keys[i - 1]);
      const b = this.pin(keys[i]);
      const lane = 1000.123 + 13 * this.wires.length;
      const pts: Vec2[] = [a, { x: a.x + 0.37, y: lane }, { x: b.x + 0.61, y: lane }, b];
      const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;
      const on = (p: Vec2, s0: Vec2, s1: Vec2): boolean => {
        const cross = (s1.x - s0.x) * (p.y - s0.y) - (s1.y - s0.y) * (p.x - s0.x);
        return Math.abs(cross) < 1e-5 && p.x >= Math.min(s0.x, s1.x) - 1e-6 && p.x <= Math.max(s0.x, s1.x) + 1e-6 &&
          p.y >= Math.min(s0.y, s1.y) - 1e-6 && p.y <= Math.max(s0.y, s1.y) + 1e-6;
      };
      for (const w of this.wires) {
        for (let k = 0; k < w.points.length; k++) {
          const p = w.points[k];
          for (let m = 1; m < pts.length; m++) {
            if (on(p, pts[m - 1], pts[m]) && !same(p, a) && !same(p, b)) throw new Error(`test wire ${keys[i - 1]}–${keys[i]} accidentally touches ${w.id}`);
          }
          if (k > 0) {
            for (const q of pts) {
              if (on(q, w.points[k - 1], p) && !same(q, w.points[k - 1]) && !same(q, p)) throw new Error(`test wire ${keys[i - 1]}–${keys[i]} accidentally touches ${w.id}`);
            }
          }
        }
      }
      this.wires.push({ id: `w${this.wires.length}`, points: pts });
    }
  }

  ground(...keys: string[]): void {
    for (const k of keys) {
      const id = `GND${this.components.length}`;
      this.add('misc.ground', id);
      this.connect(k, `${id}:GND`);
    }
  }

  scene(): CircuitScene {
    return { components: this.components, wires: this.wires, settings: this.settings };
  }

  sim(): CircuitSimulator {
    return createSimulatorWithOptions(this.scene(), { wallBudgetMs: Infinity });
  }
}

/** Advance until simulated time reaches T; optional per-chunk callback. */
export function run(sim: CircuitSimulator, T: number, chunk = 1e-3, each?: (s: CircuitState) => void): CircuitState {
  let s = sim.getState();
  let guard = 0;
  while (s.time < T - 1e-9 && guard++ < 1e6) {
    s = sim.step(Math.min(chunk, T - s.time));
    each?.(s);
  }
  return s;
}

export const comp = (s: CircuitState, id: string): Record<string, any> => s.components[id] as Record<string, any>;
