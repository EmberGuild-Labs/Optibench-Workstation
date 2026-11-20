/** Component registry: every optical component type with its parameters and builder. */
import type { ComponentDef, OpticalComponent, OpticsSettings, ParamValue, Vec2 } from '../types';
import type { TypeDef } from './components/common';
import { ELEMENT_TYPES } from './components/elements';
import { EXTRA_TYPES } from './components/extra';
import { SOURCE_TYPES } from './components/sources';
import { SPECIAL_TYPES } from './components/special';
import { THIN_TYPES } from './components/thin';

export const TYPE_DEFS: TypeDef[] = [...SOURCE_TYPES, ...ELEMENT_TYPES, ...THIN_TYPES, ...SPECIAL_TYPES, ...EXTRA_TYPES];

export const REGISTRY: ComponentDef[] = TYPE_DEFS.map((t) => t.def);

const BY_TYPE = new Map<string, TypeDef>();
const DEFAULTS = new Map<string, Record<string, ParamValue>>();
for (const t of TYPE_DEFS) {
  BY_TYPE.set(t.def.type, t);
  const d: Record<string, ParamValue> = {};
  for (const p of t.def.params) d[p.key] = p.default;
  DEFAULTS.set(t.def.type, d);
}

export const getTypeDef = (type: string): TypeDef | undefined => BY_TYPE.get(type);
export const getDefaults = (type: string): Record<string, ParamValue> => DEFAULTS.get(type) ?? {};

export function defaultSettings(): OpticsSettings {
  return { maxBounces: 64, minIntensity: 1e-4, ambientMedium: 'air', raysPerSource: 32, temperatureC: 20, spectralSamples: 24, waveMode: false };
}

let idCounter = 0;
function randomId(): string {
  idCounter = (idCounter + 1) % 1296;
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0') + idCounter.toString(36);
}

export function createComponent(type: string, position: Vec2): OpticalComponent {
  const props: Record<string, ParamValue> = { ...getDefaults(type) };
  if (type === 'fiber.cable') { props.endX = position.x + 150; props.endY = position.y; }
  return { id: `${type.split('.')[0]}_${randomId()}`, type, position: { x: position.x, y: position.y }, rotation: 0, props };
}
