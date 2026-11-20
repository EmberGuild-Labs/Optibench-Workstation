/**
 * Main application store: document, history, selection, tools, views, panels.
 * High-frequency simulation output lives in `sim.ts` so it doesn't re-render the shell.
 */
import { create } from 'zustand';
import type {
  CircuitComponent, CircuitScene, ObwDocument, OpticalComponent, OpticsScene, OptoLink, ViewState, Vec2, Wire
} from '@core/types';
import { createEmptyDocument, displayNameFromPath } from '@core/project';
import { convert2Dto3D } from '@core/optics3d';
import { makeIdFactory, nextDesignator } from '../lib/ids';
import { normalizeCircuit, transformCircuit } from '../circuitEdit';
import type { LibraryItem } from '@core/project/library';
import type { MeasureAnnotation } from '../viewports/contracts';

export type Domain = 'optics' | 'circuit';
export type WorkspaceTab = 'optics' | 'circuit' | 'split';
export type Tool = 'select' | 'pan' | 'wire' | 'probe' | 'measure' | 'place';
export type DockTab = 'instruments' | 'scope' | 'sweep' | 'measure' | 'console';
export type ModalId = 'about' | 'shortcuts' | 'sweep' | 'library' | null;
export type SimStatus = 'stopped' | 'running' | 'paused';

export interface Snapshot { optics: OpticsScene; circuit: CircuitScene; links: OptoLink[]; meta: ObwDocument['meta'] }
interface HistoryEntry { snap: Snapshot; label: string }

export interface LogEntry { id: number; time: number; level: 'info' | 'warn' | 'error'; source: string; message: string }

export interface OpticsDisplay { showGrid: boolean; bloom: boolean; rayOpacity: number; showNormals: boolean; showPolarization: boolean; beamInfo: boolean; gaussianEnvelope: boolean }
export type OpticsDim = '2d' | '3d';
export interface CircuitDisplay { showGrid: boolean; animateCurrent: boolean; colorByVoltage: boolean }

const HISTORY_LIMIT = 200;

export interface AppState {
  doc: ObwDocument | null;
  filePath: string | null;
  dirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Snapshot taken at the start of a live-preview gesture (commit:false edits). */
  previewBase: Snapshot | null;
  /** Monotonic counter bumped on every document mutation. */
  revision: number;

  selection: { optics: string[]; circuit: string[] };
  activeDomain: Domain;
  tool: Tool;
  placeType: string | null;
  placeDomain: Domain | null;
  /** Library group being placed (click / drop in a viewport inserts it). */
  placeLibrary: LibraryItem | null;
  spacePan: boolean;
  tab: WorkspaceTab;
  views: { optics: ViewState; circuit: ViewState };
  opticsDisplay: OpticsDisplay;
  circuitDisplay: CircuitDisplay;
  sim: { status: SimStatus };
  /** Optics viewport currently shown (2D bench or 3D). Starts at the document's meta.dimension. */
  opticsDim: OpticsDim;
  /**
   * Simulated seconds per wall-clock second (1 = realtime, 1e-9 = "1 ns/s"). Session state loaded from
   * circuit.settings.simSpeed and written back on save; changing it is not an undo step.
   */
  timeScale: number;
  cursor: { domain: Domain; p: Vec2 } | null;

  ui: {
    leftOpen: boolean; rightOpen: boolean; dockOpen: boolean; dockTab: DockTab;
    leftWidth: number; rightWidth: number; dockHeight: number; splitRatio: number;
    modal: ModalId;
  };
  logs: LogEntry[];
  /** Persistent measure-tool annotations (optics bench, session only). */
  measurements: MeasureAnnotation[];
  measureSel: string | null;

  // --- document lifecycle
  loadDocument(doc: ObwDocument, path: string | null): void;
  closeDocument(): void;
  markSaved(path: string, doc: ObwDocument): void;
  // --- edits
  setOpticsScene(next: OpticsScene, commit: boolean, label?: string): void;
  setCircuitScene(next: CircuitScene, commit: boolean, label?: string): void;
  setLinks(next: OptoLink[], label?: string): void;
  setMeta(meta: Partial<ObwDocument['meta']>, label?: string): void;
  mutate(fn: (s: Snapshot) => Snapshot, label: string): void;
  undo(): void;
  redo(): void;
  // --- selection
  setSelection(domain: Domain, ids: string[]): void;
  selectAll(): void;
  clearSelection(): void;
  setActiveDomain(d: Domain): void;
  // --- clipboard
  copy(): void;
  cut(): void;
  paste(): void;
  duplicate(): void;
  deleteSelection(): void;
  rotateSelection(dir?: 1 | -1): void;
  // --- views/tools
  setTool(t: Tool): void;
  startPlace(domain: Domain, type: string): void;
  startPlaceLibrary(item: LibraryItem | null): void;
  addMeasurement(m: Omit<MeasureAnnotation, 'id'>): void;
  removeMeasurement(id: string): void;
  clearMeasurements(): void;
  selectMeasurement(id: string | null): void;
  setSpacePan(on: boolean): void;
  setTab(t: WorkspaceTab): void;
  setView(domain: Domain, v: ViewState): void;
  setOpticsDisplay(p: Partial<OpticsDisplay>): void;
  setCircuitDisplay(p: Partial<CircuitDisplay>): void;
  setSimStatus(s: SimStatus): void;
  /** Switch the optics viewport. Going to 3D converts a '2d' document first (one undo step). */
  setOpticsDim(d: OpticsDim): void;
  setTimeScale(v: number): void;
  setCursor(domain: Domain, p: Vec2 | null): void;
  setUi(p: Partial<AppState['ui']>): void;
  log(level: LogEntry['level'], source: string, message: string): void;
  clearLogs(): void;
}

let logId = 1;
let measureId = 1;

const snapOf = (d: ObwDocument): Snapshot => ({ optics: d.optics, circuit: d.circuit, links: d.links, meta: d.meta });

/** Drop links whose endpoints no longer exist. */
function pruneLinks(links: OptoLink[], optics: OpticsScene, circuit: CircuitScene): OptoLink[] {
  const o = new Set(optics.components.map((c) => c.id));
  const c = new Set(circuit.components.map((x) => x.id));
  const out = links.filter((l) => o.has(l.opticsId) && c.has(l.circuitId));
  return out.length === links.length ? links : out;
}

function pruneSelection(sel: AppState['selection'], snap: Snapshot): AppState['selection'] {
  const o = new Set(snap.optics.components.map((c) => c.id));
  const c = new Set([...snap.circuit.components.map((x) => x.id), ...snap.circuit.wires.map((w) => w.id)]);
  const os = sel.optics.filter((id) => o.has(id));
  const cs = sel.circuit.filter((id) => c.has(id));
  return {
    optics: os.length === sel.optics.length ? sel.optics : os,
    circuit: cs.length === sel.circuit.length ? sel.circuit : cs
  };
}

// Module-level clipboard (renderer-internal; not the OS clipboard).
let clipboard: { domain: Domain; optics?: OpticalComponent[]; circuit?: CircuitComponent[]; wires?: Wire[]; pasteCount: number } | null = null;

export function hasClipboard(): boolean {
  return clipboard !== null;
}

const clone = <T,>(v: T): T => structuredClone(v);

/** Dirty flag when the current live-preview gesture started (restored if the gesture is cancelled). */
let dirtyBeforePreview = false;

/** Structural equality of two undo snapshots (only used on discrete commits). */
function sameSnap(a: Snapshot, b: Snapshot): boolean {
  if (a.optics === b.optics && a.circuit === b.circuit && a.links === b.links) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useApp = create<AppState>()((set, get) => {
  /** Apply a new snapshot. commit=true pushes undo history (coalescing any preview gesture). */
  function apply(next: Snapshot, commit: boolean, label: string): void {
    const s = get();
    if (!s.doc) return;
    const links = pruneLinks(next.links, next.optics, next.circuit);
    const snap: Snapshot = links === next.links ? next : { ...next, links };
    const cur = snapOf(s.doc);
    const doc: ObwDocument = { ...s.doc, ...snap };
    const selection = pruneSelection(s.selection, snap);
    if (!commit) {
      if (!s.previewBase) dirtyBeforePreview = s.dirty;
      set({ doc, previewBase: s.previewBase ?? cur, dirty: true, revision: s.revision + 1, selection });
      return;
    }
    const base = s.previewBase ?? cur;
    // a commit that changes nothing (click without drag, blur without edit, gesture returned to
    // its start) must not add an undo step or dirty the document
    if (base === snap || sameSnap(base, snap)) {
      if (s.previewBase) set({ doc: { ...s.doc, ...base }, previewBase: null, dirty: dirtyBeforePreview, revision: s.revision + 1, selection });
      return;
    }
    const past = [...s.past, { snap: base, label }];
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
    set({ doc, past, future: [], previewBase: null, dirty: true, revision: s.revision + 1, selection });
  }

  const selectedOf = (d: Domain): string[] => get().selection[d];

  return {
    doc: null,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    previewBase: null,
    revision: 0,
    selection: { optics: [], circuit: [] },
    activeDomain: 'optics',
    tool: 'select',
    placeType: null,
    placeDomain: null,
    placeLibrary: null,
    spacePan: false,
    tab: 'optics',
    views: { optics: { cx: 0, cy: 0, zoom: 2 }, circuit: { cx: 0, cy: 0, zoom: 20 } },
    opticsDisplay: { showGrid: true, bloom: true, rayOpacity: 0.85, showNormals: false, showPolarization: false, beamInfo: false, gaussianEnvelope: false },
    circuitDisplay: { showGrid: true, animateCurrent: true, colorByVoltage: true },
    sim: { status: 'stopped' },
    opticsDim: '2d',
    timeScale: 1,
    cursor: null,
    ui: {
      leftOpen: true, rightOpen: true, dockOpen: true, dockTab: 'instruments',
      leftWidth: 248, rightWidth: 312, dockHeight: 232, splitRatio: 0.5, modal: null
    },
    logs: [],
    measurements: [],
    measureSel: null,

    loadDocument(doc, path) {
      const view = doc.view ?? {};
      const tab = view.activeTab ?? 'optics';
      set({
        doc, filePath: path, dirty: false, past: [], future: [], previewBase: null,
        revision: get().revision + 1,
        selection: { optics: [], circuit: [] },
        tool: 'select', placeType: null, placeDomain: null, placeLibrary: null,
        measurements: [], measureSel: null,
        tab, activeDomain: tab === 'circuit' ? 'circuit' : 'optics',
        views: {
          optics: view.optics ?? { cx: 0, cy: 0, zoom: 2 },
          circuit: view.circuit ?? { cx: 0, cy: 0, zoom: 20 }
        },
        sim: { status: 'stopped' },
        opticsDim: doc.meta.dimension === '3d' ? '3d' : '2d',
        timeScale: Number.isFinite(doc.circuit.settings.simSpeed) && doc.circuit.settings.simSpeed > 0 ? doc.circuit.settings.simSpeed : 1
      });
      get().log('info', 'project', path ? `Opened ${displayNameFromPath(path)}` : `New project "${doc.meta.title}"`);
    },
    closeDocument() {
      set({ doc: null, filePath: null, dirty: false, past: [], future: [], previewBase: null, selection: { optics: [], circuit: [] }, sim: { status: 'stopped' } });
    },
    markSaved(path, doc) {
      set({ filePath: path, dirty: false, doc });
    },

    setOpticsScene(next, commit, label = 'Edit Optics') {
      const d = get().doc;
      if (!d) return;
      apply({ ...snapOf(d), optics: next }, commit, label);
    },
    setCircuitScene(next, commit, label = 'Edit Circuit') {
      const d = get().doc;
      if (!d) return;
      apply({ ...snapOf(d), circuit: next }, commit, label);
    },
    setLinks(next, label = 'Edit Links') {
      const d = get().doc;
      if (!d) return;
      apply({ ...snapOf(d), links: next }, true, label);
    },
    setMeta(meta, label = 'Edit Project Info') {
      const d = get().doc;
      if (!d) return;
      apply({ ...snapOf(d), meta: { ...d.meta, ...meta } }, true, label);
    },
    mutate(fn, label) {
      const d = get().doc;
      if (!d) return;
      apply(fn(snapOf(d)), true, label);
    },
    undo() {
      const s = get();
      if (!s.doc) return;
      if (s.previewBase) {
        const doc = { ...s.doc, ...s.previewBase };
        set({ doc, previewBase: null, dirty: dirtyBeforePreview, revision: s.revision + 1, selection: pruneSelection(s.selection, s.previewBase) });
        return;
      }
      const entry = s.past[s.past.length - 1];
      if (!entry) return;
      const cur = snapOf(s.doc);
      const doc = { ...s.doc, ...entry.snap };
      set({
        doc, past: s.past.slice(0, -1), future: [...s.future, { snap: cur, label: entry.label }],
        dirty: true, revision: s.revision + 1, selection: pruneSelection(s.selection, entry.snap)
      });
    },
    redo() {
      const s = get();
      if (!s.doc) return;
      const entry = s.future[s.future.length - 1];
      if (!entry) return;
      const cur = snapOf(s.doc);
      const doc = { ...s.doc, ...entry.snap };
      set({
        doc, future: s.future.slice(0, -1), past: [...s.past, { snap: cur, label: entry.label }], previewBase: null,
        dirty: true, revision: s.revision + 1, selection: pruneSelection(s.selection, entry.snap)
      });
    },

    setSelection(domain, ids) {
      const sel = get().selection;
      if (sel[domain].length === ids.length && sel[domain].every((v, i) => v === ids[i])) {
        if (get().activeDomain !== domain && ids.length) set({ activeDomain: domain });
        return;
      }
      set({ selection: { ...sel, [domain]: ids }, ...(ids.length ? { activeDomain: domain } : {}) });
    },
    selectAll() {
      const { doc, activeDomain } = get();
      if (!doc) return;
      const ids = activeDomain === 'optics'
        ? doc.optics.components.map((c) => c.id)
        : [...doc.circuit.components.map((c) => c.id), ...doc.circuit.wires.map((w) => w.id)];
      set({ selection: { ...get().selection, [activeDomain]: ids } });
    },
    clearSelection() {
      set({ selection: { optics: [], circuit: [] } });
    },
    setActiveDomain(d) {
      if (get().activeDomain !== d) set({ activeDomain: d });
    },

    copy() {
      const { doc, activeDomain } = get();
      if (!doc) return;
      const ids = new Set(selectedOf(activeDomain));
      if (!ids.size) return;
      if (activeDomain === 'optics') {
        clipboard = { domain: 'optics', optics: clone(doc.optics.components.filter((c) => ids.has(c.id))), pasteCount: 0 };
      } else {
        clipboard = {
          domain: 'circuit',
          circuit: clone(doc.circuit.components.filter((c) => ids.has(c.id))),
          wires: clone(doc.circuit.wires.filter((w) => ids.has(w.id))),
          pasteCount: 0
        };
      }
    },
    cut() {
      get().copy();
      if (clipboard) get().deleteSelection();
    },
    paste() {
      const s = get();
      if (!s.doc || !clipboard) return;
      clipboard.pasteCount++;
      const k = clipboard.pasteCount;
      const doc = s.doc;
      if (clipboard.domain === 'optics' && clipboard.optics) {
        const mk = makeIdFactory(doc.optics.components.map((c) => c.id));
        const off = 10 * k;
        const items = clipboard.optics.map((c) => ({ ...clone(c), id: mk('o'), position: { x: c.position.x + off, y: c.position.y + off } }));
        apply({ ...snapOf(doc), optics: { ...doc.optics, components: [...doc.optics.components, ...items] } }, true, 'Paste');
        set({ selection: { ...get().selection, optics: items.map((c) => c.id) }, activeDomain: 'optics' });
      } else if (clipboard.domain === 'circuit') {
        const mk = makeIdFactory([...doc.circuit.components.map((c) => c.id), ...doc.circuit.wires.map((w) => w.id)]);
        const off = 2 * k;
        const names = doc.circuit.components.map((c) => c.name);
        const items = (clipboard.circuit ?? []).map((c) => {
          const name = nextDesignator(c.name, names);
          names.push(name);
          return { ...clone(c), id: mk('c'), name, position: { x: c.position.x + off, y: c.position.y + off } };
        });
        const wires = (clipboard.wires ?? []).map((w) => ({ ...clone(w), id: mk('w'), points: w.points.map((p) => ({ x: p.x + off, y: p.y + off })) }));
        const circuit = normalizeCircuit({ ...doc.circuit, components: [...doc.circuit.components, ...items], wires: [...doc.circuit.wires, ...wires] });
        apply({ ...snapOf(doc), circuit }, true, 'Paste');
        // normalization may split / merge pasted wires: select the new wires lying on the pasted polylines
        const before = new Set(doc.circuit.wires.map((w) => w.id));
        const onPasted = (p: Vec2): boolean => wires.some((w) => w.points.some((q, i) => {
          if (q.x === p.x && q.y === p.y) return true;
          const a = w.points[i - 1];
          return !!a && (a.x - p.x) * (q.y - p.y) === (a.y - p.y) * (q.x - p.x) &&
            p.x >= Math.min(a.x, q.x) && p.x <= Math.max(a.x, q.x) && p.y >= Math.min(a.y, q.y) && p.y <= Math.max(a.y, q.y);
        }));
        const wireIds = circuit.wires.filter((w) => !before.has(w.id) && w.points.every(onPasted)).map((w) => w.id);
        set({ selection: { ...get().selection, circuit: [...items.map((c) => c.id), ...wireIds] }, activeDomain: 'circuit' });
      }
    },
    duplicate() {
      const saved = clipboard;
      get().copy();
      if (clipboard !== saved) get().paste();
      clipboard = saved;
    },
    deleteSelection() {
      const { doc, activeDomain } = get();
      if (!doc) return;
      const ids = new Set(selectedOf(activeDomain));
      if (!ids.size) return;
      if (activeDomain === 'optics') {
        const optics = { ...doc.optics, components: doc.optics.components.filter((c) => !ids.has(c.id) || c.locked) };
        apply({ ...snapOf(doc), optics }, true, ids.size > 1 ? `Delete ${ids.size} Items` : 'Delete');
      } else {
        const circuit = normalizeCircuit({
          ...doc.circuit,
          components: doc.circuit.components.filter((c) => !ids.has(c.id)),
          wires: doc.circuit.wires.filter((w) => !ids.has(w.id))
        });
        apply({ ...snapOf(doc), circuit }, true, ids.size > 1 ? `Delete ${ids.size} Items` : 'Delete');
      }
    },
    rotateSelection(dir = 1) {
      const { doc, activeDomain } = get();
      if (!doc) return;
      const ids = new Set(selectedOf(activeDomain));
      if (!ids.size) return;
      if (activeDomain === 'optics') {
        const step = (Math.PI / 12) * dir; // 15°
        const optics = {
          ...doc.optics,
          components: doc.optics.components.map((c) => (ids.has(c.id) && !c.locked ? { ...c, rotation: normAngle(c.rotation + step) } : c))
        };
        apply({ ...snapOf(doc), optics }, true, 'Rotate');
      } else {
        // rotate around the selection centre; attached wires rubber-band to the moved pins
        const circuit = transformCircuit(doc.circuit, ids, { rot: dir === 1 ? 1 : 3 });
        apply({ ...snapOf(doc), circuit }, true, 'Rotate');
      }
    },

    setTool(t) {
      set({ tool: t, placeLibrary: null, ...(t !== 'place' ? { placeType: null, placeDomain: null } : {}) });
    },
    startPlace(domain, type) {
      const tab = get().tab;
      const nextTab: WorkspaceTab = tab === 'split' || tab === domain ? tab : domain;
      set({ tool: 'place', placeType: type, placeDomain: domain, placeLibrary: null, activeDomain: domain, tab: nextTab });
    },
    startPlaceLibrary(item) {
      if (!item) { set({ placeLibrary: null, tool: 'select', placeType: null, placeDomain: null }); return; }
      const hasO = item.optics.length > 0, hasC = item.circuit.components.length > 0;
      const tab = get().tab;
      const nextTab: WorkspaceTab = hasO && hasC ? tab : hasO ? (tab === 'circuit' ? 'optics' : tab) : (tab === 'optics' ? 'circuit' : tab);
      set({ placeLibrary: item, tool: 'select', placeType: null, placeDomain: null, tab: nextTab, ...(nextTab !== 'split' ? { activeDomain: nextTab } : {}) });
    },
    addMeasurement(m) {
      const id = `m${measureId++}`;
      set({ measurements: [...get().measurements, { ...m, id }], measureSel: id });
    },
    removeMeasurement(id) {
      const s = get();
      set({ measurements: s.measurements.filter((m) => m.id !== id), measureSel: s.measureSel === id ? null : s.measureSel });
    },
    clearMeasurements() {
      set({ measurements: [], measureSel: null });
    },
    selectMeasurement(id) {
      if (get().measureSel !== id) set({ measureSel: id });
    },
    setSpacePan(on) {
      if (get().spacePan !== on) set({ spacePan: on });
    },
    setTab(t) {
      set({ tab: t, ...(t !== 'split' ? { activeDomain: t } : {}) });
    },
    setView(domain, v) {
      const cur = get().views[domain];
      if (cur.cx === v.cx && cur.cy === v.cy && cur.zoom === v.zoom) return;
      set({ views: { ...get().views, [domain]: v } });
    },
    setOpticsDisplay(p) {
      set({ opticsDisplay: { ...get().opticsDisplay, ...p } });
    },
    setCircuitDisplay(p) {
      set({ circuitDisplay: { ...get().circuitDisplay, ...p } });
    },
    setSimStatus(st) {
      set({ sim: { status: st } });
    },
    setOpticsDim(d) {
      const s = get();
      if (!s.doc) return;
      if (d === '3d' && s.doc.meta.dimension !== '3d') {
        s.mutate((snap) => ({ ...snap, optics: convert2Dto3D(snap.optics), meta: { ...snap.meta, dimension: '3d' } }), 'Convert to 3D');
        get().log('info', 'optics', 'Converted the optics bench to 3D (z = 0 beam plane; undo restores the 2D document)');
      }
      if (get().opticsDim !== d) set({ opticsDim: d });
    },
    setTimeScale(v) {
      if (!(v > 0) || !Number.isFinite(v)) return;
      const c = Math.min(1e3, Math.max(1e-15, v));
      if (get().timeScale !== c) set({ timeScale: c });
    },
    setCursor(domain, p) {
      set({ cursor: p ? { domain, p } : null });
    },
    setUi(p) {
      set({ ui: { ...get().ui, ...p } });
    },
    log(level, source, message) {
      const logs = get().logs;
      const last = logs[logs.length - 1];
      if (last && last.message === message && last.source === source && last.level === level) return;
      const next = [...logs, { id: logId++, time: Date.now(), level, source, message }];
      if (next.length > 500) next.splice(0, next.length - 500);
      set({ logs: next });
    },
    clearLogs() {
      set({ logs: [] });
    }
  };
});

function normAngle(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r > Math.PI) r -= t;
  if (r <= -Math.PI) r += t;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

/** Document with the current view state baked in, ready to serialize. */
export function documentForSave(): ObwDocument | null {
  const s = useApp.getState();
  if (!s.doc) return null;
  return {
    ...s.doc,
    meta: { ...s.doc.meta, modified: new Date().toISOString() },
    circuit: s.doc.circuit.settings.simSpeed === s.timeScale ? s.doc.circuit : { ...s.doc.circuit, settings: { ...s.doc.circuit.settings, simSpeed: s.timeScale } },
    view: { optics: s.views.optics, circuit: s.views.circuit, activeTab: s.tab }
  };
}

export function newDocument(): void {
  useApp.getState().loadDocument(createEmptyDocument(), null);
}

export function documentTitle(s: Pick<AppState, 'doc' | 'filePath'>): string {
  return displayNameFromPath(s.filePath) ?? s.doc?.meta.title ?? 'Untitled';
}
