/** Application commands shared by menus, toolbar and keyboard shortcuts. */
import { parseDocument, serializeDocument, ProjectParseError, createEmptyDocument, displayNameFromPath } from '@core/project';
import type { ViewState } from '@core/types';
import { documentForSave, documentTitle, useApp, type Domain } from './store/app';
import { simDriver } from './sim/driver';
import { circuitDef, circuitEngine, opticsEngine } from './engines';
import { captureOpticsPNG } from './viewports/optics';
import { captureOptics3DPNG, type Optics3DViewportHandle } from './viewports/optics3d';
import { TIME_SCALE_PRESETS, formatTimeScale, parseTimeScale } from './lib/timeView';

const api = (): typeof window.optibench | undefined => (typeof window !== 'undefined' ? window.optibench : undefined);

// ---------------------------------------------------------------------------
// Viewport pane registry (for framing and PNG export)
// ---------------------------------------------------------------------------

const panes: Partial<Record<Domain, HTMLElement>> = {};
export function registerPane(domain: Domain, el: HTMLElement | null): void {
  if (el) panes[domain] = el;
  else delete panes[domain];
}
function paneSize(domain: Domain): { w: number; h: number } {
  const el = panes[domain];
  return el ? { w: el.clientWidth || 800, h: el.clientHeight || 600 } : { w: 800, h: 600 };
}

/** Handle of the mounted 3D optics viewport (camera presets, framing). */
let viewport3D: Optics3DViewportHandle | null = null;
export function register3D(h: Optics3DViewportHandle | null): void {
  viewport3D = h;
}
const in3D = (d: Domain): boolean => d === 'optics' && useApp.getState().opticsDim === '3d' && !!viewport3D;

/** Client (CSS px) position -> world coordinates of a domain's viewport (mm / grid units). */
export function clientToWorld(domain: Domain, clientX: number, clientY: number): { x: number; y: number } {
  if (domain === 'optics' && useApp.getState().opticsDim === '3d') {
    // 3D bench: intersect the pointer ray with the z = 0 beam plane (world Y = -2D y)
    const rt = (window as unknown as { __optics3d?: { planePoint?(e: { clientX: number; clientY: number }): { x: number; y: number } | null } }).__optics3d;
    const w = rt?.planePoint?.({ clientX, clientY });
    if (w) return { x: w.x, y: -w.y };
  }
  const el = panes[domain];
  const v = useApp.getState().views[domain];
  if (!el) return { x: v.cx, y: v.cy };
  const r = el.getBoundingClientRect();
  return { x: (clientX - r.left - r.width / 2) / v.zoom + v.cx, y: (clientY - r.top - r.height / 2) / v.zoom + v.cy };
}

/** Domain that keyboard / toolbar actions apply to. */
export function focusDomain(): Domain {
  const s = useApp.getState();
  return s.tab === 'split' ? s.activeDomain : s.tab;
}

// ---------------------------------------------------------------------------
// File commands
// ---------------------------------------------------------------------------

/** Resolve unsaved changes. Returns true if the caller may proceed (discarded or saved). */
export async function confirmDiscard(): Promise<boolean> {
  const s = useApp.getState();
  if (!s.doc || !s.dirty) return true;
  const a = api();
  if (!a) return window.confirm('Discard unsaved changes?');
  const choice = await a.confirmUnsaved(documentTitle(s));
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveDocument(false);
  return true;
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  useApp.getState().loadDocument(createEmptyDocument(), null);
}

export function loadText(text: string, path: string | null, asTemplate = false): boolean {
  const app = useApp.getState();
  try {
    const { doc, warnings } = parseDocument(text);
    app.loadDocument(doc, asTemplate ? null : path);
    const name = displayNameFromPath(path) ?? doc.meta.title;
    for (const w of warnings) app.log('warn', 'project', `${name}: ${w}`);
    if (warnings.length) app.setUi({ dockOpen: true, dockTab: 'console' });
    return true;
  } catch (e) {
    const msg = e instanceof ProjectParseError ? e.message : `Unexpected error: ${(e as Error).message}`;
    app.log('error', 'project', `Could not open ${path ?? 'file'}: ${msg}`);
    app.setUi({ dockOpen: true, dockTab: 'console' });
    window.alert(`Could not open project.\n\n${msg}`);
    return false;
  }
}

export async function openProject(): Promise<void> {
  const a = api();
  if (!a || !(await confirmDiscard())) return;
  const f = await a.openDialog();
  if (f) loadText(f.text, f.path);
}

export async function openPath(path: string, asTemplate = false): Promise<void> {
  const a = api();
  if (!a || !(await confirmDiscard())) return;
  try {
    const f = await a.openPath(path);
    if (f) loadText(f.text, f.path, asTemplate);
  } catch (e) {
    useApp.getState().log('error', 'project', (e as Error).message);
  }
}

export async function saveDocument(saveAs: boolean): Promise<boolean> {
  const a = api();
  const s = useApp.getState();
  const doc = documentForSave();
  if (!a || !doc) return false;
  let path = s.filePath;
  if (!path || saveAs) {
    path = await a.saveDialog(displayNameFromPath(s.filePath) ?? doc.meta.title);
    if (!path) return false;
  }
  try {
    await a.writeFile(path, serializeDocument(doc));
    useApp.getState().markSaved(path, doc);
    useApp.getState().log('info', 'project', `Saved ${path}`);
    return true;
  } catch (e) {
    useApp.getState().log('error', 'project', `Save failed: ${(e as Error).message}`);
    window.alert(`Save failed.\n\n${(e as Error).message}`);
    return false;
  }
}

export async function closeProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  useApp.getState().closeDocument();
}

export async function quitApp(): Promise<void> {
  await api()?.windowControl('close');
}

// ---------------------------------------------------------------------------
// PNG export: composite every canvas / svg inside the active pane
// ---------------------------------------------------------------------------

export async function exportPng(): Promise<void> {
  const a = api();
  const domain = focusDomain();
  const el = panes[domain];
  if (!a || !el) return;
  if (domain === 'optics') {
    try {
      const blob = useApp.getState().opticsDim === '3d' ? await captureOptics3DPNG() : await captureOpticsPNG();
      const s = useApp.getState();
      const p = await a.exportPng(new Uint8Array(await blob.arrayBuffer()), `${documentTitle(s)} - optics.png`);
      if (p) s.log('info', 'export', `Exported ${p}`);
      return;
    } catch { /* fall back to compositing canvases */ }
  }
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * dpr);
  out.height = Math.round(rect.height * dpr);
  const g = out.getContext('2d')!;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || '#07090d';
  g.fillRect(0, 0, out.width, out.height);
  const nodes = el.querySelectorAll<HTMLCanvasElement | SVGSVGElement>('canvas, svg');
  for (const n of Array.from(nodes)) {
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const x = (r.left - rect.left) * dpr, y = (r.top - rect.top) * dpr;
    try {
      if (n instanceof HTMLCanvasElement) {
        g.drawImage(n, x, y, r.width * dpr, r.height * dpr);
      } else if (n.closest('[data-export-ignore]') === null && r.width > 64) {
        const xml = new XMLSerializer().serializeToString(n);
        const img = new Image();
        const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
        await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); img.src = url; });
        g.drawImage(img, x, y, r.width * dpr, r.height * dpr);
        URL.revokeObjectURL(url);
      }
    } catch { /* tainted or unsupported — skip */ }
  }
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const s = useApp.getState();
  const p = await a.exportPng(bytes, `${documentTitle(s)} - ${domain}.png`);
  if (p) s.log('info', 'export', `Exported ${p}`);
}

// ---------------------------------------------------------------------------
// View commands
// ---------------------------------------------------------------------------

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function boundsOf(domain: Domain, ids: string[] | null): Box | null {
  const doc = useApp.getState().doc;
  if (!doc) return null;
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
  };
  const want = ids ? new Set(ids) : null;
  if (domain === 'optics') {
    for (const c of doc.optics.components) {
      if (want && !want.has(c.id)) continue;
      try {
        const g = opticsEngine.getGeometry(c);
        add(g.bounds.min.x, g.bounds.min.y); add(g.bounds.max.x, g.bounds.max.y);
      } catch {
        add(c.position.x - 10, c.position.y - 10); add(c.position.x + 10, c.position.y + 10);
      }
    }
  } else {
    for (const c of doc.circuit.components) {
      if (want && !want.has(c.id)) continue;
      add(c.position.x, c.position.y);
      try {
        for (const p of circuitEngine.getPinPositions(c)) add(p.p.x, p.p.y);
      } catch { /* ignore */ }
      const d = circuitDef(c.type);
      if (d) {
        add(c.position.x + d.size.ox, c.position.y + d.size.oy);
        add(c.position.x + d.size.ox + d.size.w, c.position.y + d.size.oy + d.size.h);
      }
    }
    for (const w of doc.circuit.wires) {
      if (want && !want.has(w.id)) continue;
      for (const p of w.points) add(p.x, p.y);
    }
  }
  return Number.isFinite(b.minX) ? b : null;
}

// keep in sync with the viewports' own wheel-zoom limits (optics runtime.ts, circuit index.tsx)
const ZOOM_LIMITS: Record<Domain, [number, number]> = { optics: [0.02, 400], circuit: [3, 240] };

function fitView(domain: Domain, b: Box): ViewState {
  const { w, h } = paneSize(domain);
  const pad = domain === 'optics' ? 20 : 2;
  const bw = Math.max(b.maxX - b.minX + pad * 2, domain === 'optics' ? 20 : 4);
  const bh = Math.max(b.maxY - b.minY + pad * 2, domain === 'optics' ? 20 : 4);
  const [lo, hi] = ZOOM_LIMITS[domain];
  const zoom = Math.min(hi, Math.max(lo, Math.min(w / bw, h / bh)));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom };
}

/** F: frame selection (or everything when nothing is selected). */
export function frameSelection(): void {
  const s = useApp.getState();
  const d = focusDomain();
  if (in3D(d)) { viewport3D!.frameSelection(); return; }
  const sel = s.selection[d];
  const b = boundsOf(d, sel.length ? sel : null);
  if (b) s.setView(d, fitView(d, b));
}

export function frameAll(): void {
  const s = useApp.getState();
  const d = focusDomain();
  if (in3D(d)) {
    const sel = s.selection.optics;
    // frame everything: frame with an empty selection, then restore it
    if (sel.length) { s.setSelection('optics', []); viewport3D!.frameSelection(); setTimeout(() => useApp.getState().setSelection('optics', sel), 0); }
    else viewport3D!.frameSelection();
    return;
  }
  const b = boundsOf(d, null);
  if (b) s.setView(d, fitView(d, b));
  else s.setView(d, { cx: 0, cy: 0, zoom: d === 'optics' ? 2 : 20 });
}

export function zoomBy(factor: number): void {
  const s = useApp.getState();
  const d = focusDomain();
  const v = s.views[d];
  const [lo, hi] = ZOOM_LIMITS[d];
  s.setView(d, { ...v, zoom: Math.min(hi, Math.max(lo, v.zoom * factor)) });
}

export function zoomReset(): void {
  const s = useApp.getState();
  const d = focusDomain();
  s.setView(d, { ...s.views[d], zoom: d === 'optics' ? 2 : 20 });
}

// ---------------------------------------------------------------------------
// Simulation commands
// ---------------------------------------------------------------------------

export function togglePlay(): void {
  const s = useApp.getState();
  if (!s.doc) return;
  s.setSimStatus(s.sim.status === 'running' ? 'paused' : 'running');
}
export function stepSim(): void { simDriver.step(); }
export function resetSim(): void { simDriver.reset(); }

/** Time-scale ladder for [ / ] (simulated seconds per wall second). */
export const SIM_SPEEDS = [1e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 0.25, 0.5, 1, 2, 5, 10];
export { TIME_SCALE_PRESETS, formatTimeScale, parseTimeScale };

/** Set the time scale (session state, written to circuit.settings.simSpeed on save). */
export function setSimSpeed(v: number): void {
  const s = useApp.getState();
  if (!s.doc || !(v > 0)) return;
  s.setTimeScale(v);
}

/** Apply a typed time scale ("1 ns/s", "realtime", "1/1e9" …). Returns false when it cannot be parsed. */
export function setTimeScaleText(text: string): boolean {
  const v = parseTimeScale(text);
  if (v === null) {
    useApp.getState().log('warn', 'sim', `Time scale "${text}" not understood (try "1 ns/s", "100 ps/s", "1/1e9" or "realtime")`);
    return false;
  }
  setSimSpeed(v);
  return true;
}

/** [Realtime]: time scale 1 and run. */
export function realtime(): void {
  const s = useApp.getState();
  if (!s.doc) return;
  s.setTimeScale(1);
  if (s.sim.status !== 'running') s.setSimStatus('running');
}

/** [Pause]: freeze everything (light pulses included). */
export function pauseSim(): void {
  const s = useApp.getState();
  if (s.doc && s.sim.status === 'running') s.setSimStatus('paused');
}

export function changeSimSpeed(dir: 1 | -1): void {
  const s = useApp.getState();
  if (!s.doc) return;
  const cur = s.timeScale;
  let i = SIM_SPEEDS.findIndex((x) => x >= cur * 0.999);
  if (i < 0) i = SIM_SPEEDS.length - 1;
  else if (dir < 0 && SIM_SPEEDS[i] > cur * 1.001) i += 1; // between two rungs: step to the lower one
  const n = SIM_SPEEDS[Math.min(SIM_SPEEDS.length - 1, Math.max(0, i + dir))];
  setSimSpeed(n);
}

// ---------------------------------------------------------------------------
// 2D / 3D optics view
// ---------------------------------------------------------------------------

export function setOpticsDim(d: '2d' | '3d'): void {
  const s = useApp.getState();
  if (!s.doc) return;
  if (s.tab === 'circuit') s.setTab('optics');
  s.setOpticsDim(d);
}

export function toggleOpticsDim(): void {
  setOpticsDim(useApp.getState().opticsDim === '3d' ? '2d' : '3d');
}
