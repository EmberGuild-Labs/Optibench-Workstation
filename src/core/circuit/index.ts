/**
 * Optibench Workstation — circuit engine entry point.
 *
 * `circuitEngine` implements CircuitEngineAPI (see ../types.ts). Extra named exports are helpers
 * for the UI / project code (designator prefixes, LED colour table, netlist extraction…).
 */
import type { CircuitEngineAPI, CircuitScene, CircuitSimulator } from '../types';
import { createComponent, getPinPositions, registry } from './registry';
import { DEFAULT_SETTINGS, Simulator, SimulatorOptions } from './simulator';

export { registry, registryMap, createComponent, getPinPositions, getPinDefs, designatorPrefix, defaultProps, transformOffset, LED_COLORS } from './registry';
export { buildNetlist, GROUND_NET } from './netlist';
export type { Netlist } from './netlist';
export { Simulator, DEFAULT_SETTINGS } from './simulator';
export type { SimulatorOptions } from './simulator';
export { fmtSI, PROBE_SAMPLES } from './devices';

/** Like circuitEngine.createSimulator but with options (e.g. `{ wallBudgetMs: Infinity }` for offline runs). */
export function createSimulatorWithOptions(scene: CircuitScene, opts: SimulatorOptions): CircuitSimulator {
  return new Simulator(scene, opts);
}

export const circuitEngine: CircuitEngineAPI = {
  registry,
  defaultSettings: () => ({ ...DEFAULT_SETTINGS }),
  createComponent,
  getPinPositions,
  createSimulator: (scene: CircuitScene): CircuitSimulator => new Simulator(scene),
};

export default circuitEngine;
