/** Menu model for the custom title-bar menus. Shortcuts are display strings; see shortcuts.ts for bindings. */
import * as cmd from './commands';
import { hasClipboard, useApp, type AppState } from './store/app';
import { importLibraryFiles, librarySelectionCount, useLibrary } from './library/store';

export interface MenuItem {
  kind?: 'item';
  label: string;
  shortcut?: string;
  action?: () => void;
  enabled?: boolean;
  checked?: boolean;
  submenu?: () => MenuEntry[];
}
export type MenuEntry = MenuItem | { kind: 'separator' };
export interface MenuDef { id: string; label: string; mnemonic: string; items: () => MenuEntry[] }

const sep: MenuEntry = { kind: 'separator' };
const mod = (): string => (window.optibench?.platform === 'darwin' ? '⌘' : 'Ctrl');
const st = (): AppState => useApp.getState();

export function recentMenu(recent: { path: string; exists: boolean }[]): MenuEntry[] {
  if (!recent.length) return [{ label: 'No recent projects', enabled: false }];
  return [
    ...recent.map((r, i): MenuEntry => ({
      label: `&${i < 9 ? i + 1 : 0}  ${r.path}`,
      enabled: r.exists,
      action: () => void cmd.openPath(r.path)
    })),
    sep,
    { label: '&Clear Recent', action: () => void window.optibench?.clearRecent() }
  ];
}

export function buildMenus(recent: { path: string; exists: boolean }[]): MenuDef[] {
  const M = mod();
  return [
    {
      id: 'file', label: '&File', mnemonic: 'f',
      items: () => {
        const s = st();
        const has = !!s.doc;
        return [
          { label: '&New Project', shortcut: `${M}+N`, action: () => void cmd.newProject() },
          { label: '&Open…', shortcut: `${M}+O`, action: () => void cmd.openProject() },
          { label: 'Open &Recent', submenu: () => recentMenu(recent) },
          sep,
          { label: '&Save', shortcut: `${M}+S`, enabled: has, action: () => void cmd.saveDocument(false) },
          { label: 'Save &As…', shortcut: `${M}+Shift+S`, enabled: has, action: () => void cmd.saveDocument(true) },
          sep,
          { label: '&Export Viewport as PNG…', shortcut: `${M}+Shift+E`, enabled: has, action: () => void cmd.exportPng() },
          sep,
          { label: '&Close Project', shortcut: `${M}+W`, enabled: has, action: () => void cmd.closeProject() },
          { label: 'E&xit', shortcut: 'Alt+F4', action: () => void cmd.quitApp() }
        ];
      }
    },
    {
      id: 'edit', label: '&Edit', mnemonic: 'e',
      items: () => {
        const s = st();
        const has = !!s.doc;
        const d = cmd.focusDomain();
        const sel = s.selection[d].length > 0;
        const undo = s.past[s.past.length - 1];
        const redo = s.future[s.future.length - 1];
        return [
          { label: undo ? `&Undo ${undo.label}` : '&Undo', shortcut: `${M}+Z`, enabled: has && (!!undo || !!s.previewBase), action: () => st().undo() },
          { label: redo ? `&Redo ${redo.label}` : '&Redo', shortcut: `${M}+Y`, enabled: has && !!redo, action: () => st().redo() },
          sep,
          { label: 'Cu&t', shortcut: `${M}+X`, enabled: sel, action: () => st().cut() },
          { label: '&Copy', shortcut: `${M}+C`, enabled: sel, action: () => st().copy() },
          { label: '&Paste', shortcut: `${M}+V`, enabled: has && hasClipboard(), action: () => st().paste() },
          { label: '&Duplicate', shortcut: `${M}+D`, enabled: sel, action: () => st().duplicate() },
          { label: 'De&lete', shortcut: 'Del', enabled: sel, action: () => st().deleteSelection() },
          sep,
          { label: 'Select &All', shortcut: `${M}+A`, enabled: has, action: () => st().selectAll() },
          { label: 'D&eselect', shortcut: 'Esc', enabled: sel, action: () => st().clearSelection() },
          sep,
          { label: 'Save to &Library…', enabled: has && (() => { const n = librarySelectionCount(); return n.optics + n.circuit > 0; })(), action: () => useLibrary.getState().openDialog({ mode: 'save' }) },
          { label: '&Import Library Items…', action: () => void importLibraryFiles() },
          sep,
          { label: 'R&otate Clockwise', shortcut: 'R', enabled: sel, action: () => st().rotateSelection(1) },
          { label: 'Rotate Counter-clock&wise', shortcut: 'Shift+R', enabled: sel, action: () => st().rotateSelection(-1) }
        ];
      }
    },
    {
      id: 'view', label: '&View', mnemonic: 'v',
      items: () => {
        const s = st();
        const od = s.opticsDisplay, cd = s.circuitDisplay;
        return [
          { label: '&Optics Bench', shortcut: '1', checked: s.tab === 'optics', action: () => st().setTab('optics') },
          { label: '&Circuit', shortcut: '2', checked: s.tab === 'circuit', action: () => st().setTab('circuit') },
          { label: 'S&plit View', shortcut: '3', checked: s.tab === 'split', action: () => st().setTab('split') },
          sep,
          { label: '&2D Optics Bench', checked: s.opticsDim === '2d', enabled: !!s.doc, action: () => cmd.setOpticsDim('2d') },
          { label: '3&D Optics Bench', shortcut: `${M}+3`, checked: s.opticsDim === '3d', enabled: !!s.doc, action: () => cmd.setOpticsDim('3d') },
          sep,
          { label: '&Frame Selection', shortcut: 'F', action: cmd.frameSelection },
          { label: 'Frame A&ll', shortcut: 'Shift+F', action: cmd.frameAll },
          { label: 'Zoom &In', shortcut: `${M}+=`, action: () => cmd.zoomBy(1.25) },
          { label: 'Zoom O&ut', shortcut: `${M}+-`, action: () => cmd.zoomBy(0.8) },
          { label: '&Reset Zoom', shortcut: `${M}+0`, action: cmd.zoomReset },
          sep,
          { label: 'Component P&alette', shortcut: `${M}+B`, checked: s.ui.leftOpen, action: () => st().setUi({ leftOpen: !st().ui.leftOpen }) },
          { label: 'I&nspector', shortcut: `${M}+I`, checked: s.ui.rightOpen, action: () => st().setUi({ rightOpen: !st().ui.rightOpen }) },
          { label: '&Bottom Dock', shortcut: `${M}+J`, checked: s.ui.dockOpen, action: () => st().setUi({ dockOpen: !st().ui.dockOpen }) },
          sep,
          { label: '&Grid', shortcut: 'G', checked: od.showGrid && cd.showGrid, action: toggleGrid },
          { label: 'Bloo&m', checked: od.bloom, action: () => st().setOpticsDisplay({ bloom: !od.bloom }) },
          { label: 'Surface Nor&mals', checked: od.showNormals, action: () => st().setOpticsDisplay({ showNormals: !od.showNormals }) },
          { label: 'Polari&zation', checked: od.showPolarization, action: () => st().setOpticsDisplay({ showPolarization: !od.showPolarization }) },
          { label: 'Beam &Info Overlay', checked: od.beamInfo, action: () => st().setOpticsDisplay({ beamInfo: !od.beamInfo }) },
          { label: 'Gaussian Beam &Envelope', checked: od.gaussianEnvelope, action: () => st().setOpticsDisplay({ gaussianEnvelope: !od.gaussianEnvelope }) },
          { label: 'Animate Curren&t', checked: cd.animateCurrent, action: () => st().setCircuitDisplay({ animateCurrent: !cd.animateCurrent }) },
          { label: 'Colour Wires by &Voltage', checked: cd.colorByVoltage, action: () => st().setCircuitDisplay({ colorByVoltage: !cd.colorByVoltage }) },
          sep,
          { label: 'Toggle Full Scr&een', shortcut: 'F11', action: () => void window.optibench?.windowControl('toggleFullscreen') },
          { label: '&Developer Tools', shortcut: `${M}+Shift+I`, action: () => void window.optibench?.windowControl('toggleDevTools') }
        ];
      }
    },
    {
      id: 'sim', label: '&Simulation', mnemonic: 's',
      items: () => {
        const s = st();
        const has = !!s.doc;
        const running = s.sim.status === 'running';
        return [
          { label: running ? '&Pause' : '&Run', shortcut: 'F5', enabled: has, action: cmd.togglePlay },
          { label: '&Step', shortcut: 'F6', enabled: has, action: cmd.stepSim },
          { label: 'R&eset', shortcut: 'Shift+F5', enabled: has && s.sim.status !== 'stopped', action: cmd.resetSim },
          sep,
          { label: 'Real&time', enabled: has, checked: Math.abs(s.timeScale - 1) < 1e-9, action: cmd.realtime },
          { label: 'Time Scale', enabled: has, submenu: () => cmd.TIME_SCALE_PRESETS.map((p): MenuEntry => ({ label: p.label, checked: Math.abs(st().timeScale - p.value) <= p.value * 1e-6, action: () => cmd.setSimSpeed(p.value) })) },
          { label: '&Faster', shortcut: ']', enabled: has, action: () => cmd.changeSimSpeed(1) },
          { label: 'S&lower', shortcut: '[', enabled: has, action: () => cmd.changeSimSpeed(-1) },
          sep,
          { label: 'Parameter S&weep…', enabled: has, action: () => st().setUi({ modal: 'sweep' }) },
          { label: 'Show Sweep Res&ults', action: () => st().setUi({ dockOpen: true, dockTab: 'sweep' }) },
          sep,
          { label: 'Simulation Se&ttings', enabled: has, action: () => { st().clearSelection(); st().setUi({ rightOpen: true }); } },
          { label: 'Show &Console', action: () => st().setUi({ dockOpen: true, dockTab: 'console' }) }
        ];
      }
    },
    {
      id: 'help', label: '&Help', mnemonic: 'h',
      items: () => [
        { label: '&Keyboard Shortcuts', shortcut: `${M}+/`, action: () => st().setUi({ modal: 'shortcuts' }) },
        { label: 'Show Start &Screen', action: () => void cmd.closeProject() },
        sep,
        { label: '&About Optibench Workstation', action: () => st().setUi({ modal: 'about' }) }
      ]
    }
  ];
}

export function toggleGrid(): void {
  const s = st();
  const on = !(s.opticsDisplay.showGrid && s.circuitDisplay.showGrid);
  s.setOpticsDisplay({ showGrid: on });
  s.setCircuitDisplay({ showGrid: on });
}
