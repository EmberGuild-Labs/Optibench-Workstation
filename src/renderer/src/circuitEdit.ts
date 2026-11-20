/**
 * Circuit scene edits used outside the schematic viewport (menus, inspector, clipboard).
 * They go through the same transform + wire normalization as viewport gestures so wires stay
 * attached to moved / rotated / mirrored pins and junctions stay explicit for the engine.
 */
import type { CircuitScene, Vec2 } from '@core/types';
import { circuitEngine } from './engines';
import { defMap, normalizeScene, transformSelection } from './viewports/circuit/model';

let defs: ReturnType<typeof defMap> | null = null;
const getDefs = (): ReturnType<typeof defMap> => (defs ??= defMap(circuitEngine));

/** Wire cleanup (T-junction vertices, collinear / end-to-end merges). */
export function normalizeCircuit(scene: CircuitScene): CircuitScene {
  return normalizeScene(scene, circuitEngine, getDefs());
}

/**
 * Move / rotate (quarter turns clockwise) / mirror components and wires; attached wires are
 * rubber-banded. With `pivot` omitted the selection centre is used.
 */
export function transformCircuit(
  scene: CircuitScene, ids: Iterable<string>, opts: { delta?: Vec2; rot?: number; mirror?: boolean; pivot?: Vec2 }
): CircuitScene {
  const set = new Set(ids);
  const comps = new Set(scene.components.filter((c) => set.has(c.id)).map((c) => c.id));
  const wires = new Set(scene.wires.filter((w) => set.has(w.id)).map((w) => w.id));
  if (!comps.size && !wires.size) return scene;
  const next = transformSelection(scene, circuitEngine, getDefs(), undefined, comps, wires, opts.delta ?? { x: 0, y: 0 }, opts.rot ?? 0, !!opts.mirror, opts.pivot);
  return normalizeCircuit(next);
}

/** Set one component's placement (absolute position / rotation / mirror) keeping its wires attached. */
export function placeCircuitComponent(
  scene: CircuitScene, id: string, patch: { position?: Vec2; rotation?: 0 | 1 | 2 | 3; mirrored?: boolean }
): CircuitScene {
  const c = scene.components.find((x) => x.id === id);
  if (!c) return scene;
  const rot = patch.rotation === undefined ? 0 : (((patch.rotation - (c.rotation ?? 0)) % 4) + 4) % 4;
  const mirror = patch.mirrored !== undefined && !!patch.mirrored !== !!c.mirrored;
  const delta = patch.position ? { x: Math.round(patch.position.x) - c.position.x, y: Math.round(patch.position.y) - c.position.y } : { x: 0, y: 0 };
  if (!rot && !mirror && !delta.x && !delta.y) return scene;
  return transformCircuit(scene, [id], { delta, rot, mirror, pivot: c.position });
}
