/** Global keyboard shortcuts. Viewports that consume a key should call e.preventDefault(). */
import * as cmd from './commands';
import { toggleGrid } from './menus';
import { useApp } from './store/app';

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'color'].includes(type);
  }
  return false;
}

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'File', items: [['Ctrl+N', 'New project'], ['Ctrl+O', 'Open project'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as'], ['Ctrl+Shift+E', 'Export viewport PNG'], ['Ctrl+W', 'Close project']] },
  { title: 'Edit', items: [['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+X / C / V', 'Cut / copy / paste'], ['Ctrl+D', 'Duplicate'], ['Del / Backspace', 'Delete selection'], ['Ctrl+A', 'Select all'], ['R / Shift+R', 'Rotate (15° optics, 90° circuit)'], ['Esc', 'Cancel tool / deselect']] },
  { title: 'Tools', items: [['V', 'Select'], ['H', 'Pan'], ['Space (hold)', 'Temporary pan'], ['W', 'Wire (circuit)'], ['P', 'Probe (circuit)'], ['M', 'Measure (optics): click-click distance, Shift+click angle']] },
  { title: 'View', items: [['1 / 2 / 3', 'Optics / Circuit / Split'], ['Ctrl+3', 'Toggle 2D / 3D optics bench'], ['F', 'Frame selection'], ['Shift+F', 'Frame all'], ['Ctrl+= / Ctrl+-', 'Zoom in / out'], ['Ctrl+0', 'Reset zoom'], ['G', 'Toggle grid'], ['Ctrl+B / I / J', 'Palette / inspector / dock'], ['F11', 'Full screen']] },
  { title: 'Simulation', items: [['F5', 'Run / pause'], ['F6', 'Step'], ['Shift+F5', 'Reset'], ['[ / ]', 'Slower / faster time scale']] },
  { title: 'Help', items: [['Ctrl+/', 'Keyboard shortcuts']] }
];

export function installShortcuts(): () => void {
  const onDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    const s = useApp.getState();
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    const text = isTextTarget(e.target);
    const run = (fn: () => void): void => { e.preventDefault(); fn(); };

    // Shortcuts that work everywhere (also in text fields)
    if (ctrl && !e.altKey) {
      switch (lower) {
        case 'n': return run(() => void cmd.newProject());
        case 'o': return run(() => void cmd.openProject());
        case 's': return run(() => void cmd.saveDocument(e.shiftKey));
        case 'w': if (s.doc) return run(() => void cmd.closeProject()); return;
        case '/': return run(() => s.setUi({ modal: 'shortcuts' }));
      }
      if (e.shiftKey && lower === 'e') return run(() => void cmd.exportPng());
      if (e.shiftKey && lower === 'i') return run(() => void window.optibench?.windowControl('toggleDevTools'));
    }
    if (k === 'F11') return run(() => void window.optibench?.windowControl('toggleFullscreen'));
    if (s.ui.modal) {
      if (k === 'Escape') run(() => s.setUi({ modal: null }));
      return;
    }
    if (text || !s.doc) return;

    if (ctrl && !e.altKey) {
      switch (lower) {
        case 'z': return run(() => (e.shiftKey ? s.redo() : s.undo()));
        case 'y': return run(() => s.redo());
        case 'c': return run(() => s.copy());
        case 'x': return run(() => s.cut());
        case 'v': return run(() => s.paste());
        case 'd': return run(() => s.duplicate());
        case 'a': return run(() => s.selectAll());
        case 'b': return run(() => s.setUi({ leftOpen: !s.ui.leftOpen }));
        case 'i': return run(() => s.setUi({ rightOpen: !s.ui.rightOpen }));
        case 'j': return run(() => s.setUi({ dockOpen: !s.ui.dockOpen }));
        case '=': case '+': return run(() => cmd.zoomBy(1.25));
        case '-': return run(() => cmd.zoomBy(0.8));
        case '0': return run(cmd.zoomReset);
        case '3': return run(cmd.toggleOpticsDim);
      }
      return;
    }
    if (e.altKey) return;

    switch (k) {
      case 'F5': return run(e.shiftKey ? cmd.resetSim : cmd.togglePlay);
      case 'F6': return run(cmd.stepSim);
      case 'Delete': case 'Backspace': return run(() => s.deleteSelection());
      case 'Escape':
        return run(() => {
          if (s.placeLibrary) s.startPlaceLibrary(null);
          else if (s.tool !== 'select') s.setTool('select');
          else s.clearSelection();
        });
      case ' ':
        e.preventDefault();
        if (!e.repeat) s.setSpacePan(true);
        return;
      case '[': return run(() => cmd.changeSimSpeed(-1));
      case ']': return run(() => cmd.changeSimSpeed(1));
    }
    switch (lower) {
      case '1': return run(() => s.setTab('optics'));
      case '2': return run(() => s.setTab('circuit'));
      case '3': return run(() => s.setTab('split'));
      case 'f': return run(e.shiftKey ? cmd.frameAll : cmd.frameSelection);
      case 'r': return run(() => s.rotateSelection(e.shiftKey ? -1 : 1));
      case 'v': return run(() => s.setTool('select'));
      case 'h': return run(() => s.setTool('pan'));
      case 'w': return run(() => { if (cmd.focusDomain() === 'optics' && s.tab !== 'split') s.setTab('circuit'); s.setTool('wire'); });
      case 'p': return run(() => { if (cmd.focusDomain() === 'optics' && s.tab !== 'split') s.setTab('circuit'); s.setTool('probe'); });
      case 'm': return run(() => { if (cmd.focusDomain() === 'circuit' && s.tab !== 'split') s.setTab('optics'); s.setTool('measure'); });
      case 'g': return run(toggleGrid);
    }
  };
  const onUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') useApp.getState().setSpacePan(false);
  };
  const onBlur = (): void => useApp.getState().setSpacePan(false);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
  };
}
