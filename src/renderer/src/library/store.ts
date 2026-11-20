/**
 * Component library state (built-in + user items in userData/library.json) and the operations
 * behind "Save to Library…", palette placement, import / export of .obwlib files.
 */
import { create } from 'zustand';
import type { Vec2 } from '@core/types';
import {
  extractGroup, instantiateGroup, parseLibraryFile, serializeLibraryFile, validateLibraryItem, type LibraryItem
} from '@core/project/library';
import { circuitEngine } from '../engines';
import { normalizeCircuit } from '../circuitEdit';
import { useApp, type Domain } from '../store/app';
import { builtinLibrary } from './builtins';

export const LIBRARY_DND_MIME = 'application/x-optibench-library';

export interface LibraryDialog { mode: 'save' | 'rename'; item?: LibraryItem }

interface LibraryState {
  user: LibraryItem[];
  loaded: boolean;
  dialog: LibraryDialog | null;
  load(): Promise<void>;
  all(): LibraryItem[];
  find(id: string): LibraryItem | undefined;
  openDialog(d: LibraryDialog | null): void;
}

const api = (): typeof window.optibench | undefined => (typeof window !== 'undefined' ? window.optibench : undefined);
const log = (level: 'info' | 'warn' | 'error', msg: string): void => useApp.getState().log(level, 'library', msg);

export const useLibrary = create<LibraryState>()((set, get) => ({
  user: [],
  loaded: false,
  dialog: null,
  async load() {
    const a = api();
    if (!a?.getLibrary) { set({ loaded: true }); return; }
    try {
      const raw = await a.getLibrary();
      const user: LibraryItem[] = [];
      for (const r of raw) { try { user.push(validateLibraryItem(r)); } catch { /* skip */ } }
      set({ user, loaded: true });
    } catch (e) {
      log('error', `Could not read the library: ${(e as Error).message}`);
      set({ loaded: true });
    }
  },
  all() { return [...builtinLibrary(), ...get().user]; },
  find(id) { return get().all().find((x) => x.id === id); },
  openDialog(d) {
    set({ dialog: d });
    useApp.getState().setUi({ modal: d ? 'library' : null });
  }
}));

const newId = (): string => `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Components selected in either domain (what "Save to Library…" would capture). */
export function librarySelectionCount(): { optics: number; circuit: number } {
  const s = useApp.getState();
  if (!s.doc) return { optics: 0, circuit: 0 };
  const o = new Set(s.selection.optics), c = new Set(s.selection.circuit);
  return {
    optics: s.doc.optics.components.filter((x) => o.has(x.id)).length,
    circuit: s.doc.circuit.components.filter((x) => c.has(x.id)).length
  };
}

export async function saveSelectionToLibrary(meta: { name: string; category: string; description: string }): Promise<LibraryItem | null> {
  const s = useApp.getState();
  if (!s.doc) return null;
  const group = extractGroup(s.doc, s.selection, (c) => circuitEngine.getPinPositions(c));
  const item: LibraryItem = {
    id: newId(), name: meta.name.trim() || 'Untitled group', category: meta.category.trim() || 'General',
    description: meta.description, created: new Date().toISOString(), ...group
  };
  try {
    validateLibraryItem(item);
    await api()?.saveLibraryItem(item);
    await useLibrary.getState().load();
    log('info', `Saved "${item.name}" to the library (${item.optics.length + item.circuit.components.length} components, ${item.circuit.wires.length} wires, ${item.links.length} links)`);
    return item;
  } catch (e) {
    log('error', `Save to library failed: ${(e as Error).message}`);
    window.alert(`Could not save to the library.\n\n${(e as Error).message}`);
    return null;
  }
}

export async function renameLibraryItem(id: string, patch: { name: string; category: string; description: string }): Promise<void> {
  try {
    await api()?.renameLibraryItem(id, patch);
    await useLibrary.getState().load();
  } catch (e) { log('error', `Rename failed: ${(e as Error).message}`); }
}

export async function deleteLibraryItem(item: LibraryItem): Promise<void> {
  if (item.builtin) return;
  if (!window.confirm(`Delete "${item.name}" from the library?`)) return;
  try {
    await api()?.deleteLibraryItem(item.id);
    await useLibrary.getState().load();
    log('info', `Deleted "${item.name}" from the library`);
  } catch (e) { log('error', `Delete failed: ${(e as Error).message}`); }
}

export async function exportLibraryItems(items: LibraryItem[]): Promise<void> {
  const a = api();
  if (!a || !items.length) return;
  const name = items.length === 1 ? items[0].name : 'Optibench library';
  try {
    const p = await a.exportTextDialog(serializeLibraryFile(items), name, 'obwlib');
    if (p) log('info', `Exported ${items.length} library item${items.length === 1 ? '' : 's'} to ${p}`);
  } catch (e) { log('error', `Export failed: ${(e as Error).message}`); }
}

export async function importLibraryFiles(): Promise<void> {
  const a = api();
  if (!a) return;
  let files: { path: string; text: string }[] | null = null;
  try { files = await a.importLibraryDialog(); } catch (e) { log('error', `Import failed: ${(e as Error).message}`); return; }
  if (!files) return;
  let n = 0;
  const existing = new Set(useLibrary.getState().all().map((x) => x.id));
  for (const f of files) {
    try {
      for (const it of parseLibraryFile(f.text)) {
        const item = existing.has(it.id) ? { ...it, id: newId() } : it;
        existing.add(item.id);
        await a.saveLibraryItem(item);
        n++;
      }
    } catch (e) {
      log('error', `${f.path}: ${(e as Error).message}`);
      window.alert(`Could not import ${f.path}.\n\n${(e as Error).message}`);
    }
  }
  await useLibrary.getState().load();
  if (n) log('info', `Imported ${n} library item${n === 1 ? '' : 's'}`);
}

/**
 * Insert a library group (fresh ids, remapped wires / links) as ONE undo step. The part in
 * `domain` is centred on `at`; the other domain's part goes to the centre of that domain's view.
 */
export function insertLibraryItem(item: LibraryItem, domain: Domain | null, at: Vec2 | null): void {
  const s = useApp.getState();
  if (!s.doc) return;
  const anchor = {
    optics: domain === 'optics' && at ? at : { x: s.views.optics.cx, y: s.views.optics.cy },
    circuit: domain === 'circuit' && at ? at : { x: s.views.circuit.cx, y: s.views.circuit.cy }
  };
  const inst = instantiateGroup(item, s.doc, anchor);
  s.mutate((snap) => {
    const circuit = inst.circuit.length || inst.wires.length
      ? normalizeCircuit({ ...snap.circuit, components: [...snap.circuit.components, ...inst.circuit], wires: [...snap.circuit.wires, ...inst.wires] })
      : snap.circuit;
    return {
      ...snap,
      optics: inst.optics.length ? { ...snap.optics, components: [...snap.optics.components, ...inst.optics] } : snap.optics,
      circuit,
      links: inst.links.length ? [...snap.links, ...inst.links] : snap.links
    };
  }, `Insert ${item.name}`);
  const after = useApp.getState();
  const doc = after.doc!;
  const before = new Set(s.doc.circuit.wires.map((w) => w.id));
  const newWires = doc.circuit.wires.filter((w) => !before.has(w.id)).map((w) => w.id);
  after.setSelection('optics', inst.optics.map((c) => c.id));
  after.setSelection('circuit', [...inst.circuit.map((c) => c.id), ...newWires]);
  if (domain) after.setActiveDomain(domain);
  after.log('info', 'library', `Inserted "${item.name}"`);
}
