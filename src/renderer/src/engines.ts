/** Single import point for the two physics engines used by the shell. */
import { opticsEngine } from '@core/optics';
import { circuitEngine } from '@core/circuit';
import type { CircuitComponentDef, ComponentDef } from '@core/types';

export { opticsEngine, circuitEngine };

const opticsDefs = new Map<string, ComponentDef>();
const circuitDefs = new Map<string, CircuitComponentDef>();

export function opticsDef(type: string): ComponentDef | undefined {
  if (opticsDefs.size === 0) for (const d of opticsEngine.registry) opticsDefs.set(d.type, d);
  return opticsDefs.get(type);
}

export function circuitDef(type: string): CircuitComponentDef | undefined {
  if (circuitDefs.size === 0) for (const d of circuitEngine.registry) circuitDefs.set(d.type, d);
  return circuitDefs.get(type);
}

export function wavelengthRGB(nm: number): [number, number, number] {
  return opticsEngine.wavelengthToRGB(nm);
}
