import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OpticsScene, CircuitScene, ViewState, Vec2 } from '@core/types';
import { OpticsViewport } from '../viewports/optics';
import { Optics3DViewport, type Optics3DViewportHandle } from '../viewports/optics3d';
import { CircuitViewport } from '../viewports/circuit';
import { optics3dEngine } from '@core/optics3d';
import { benchTimeOfFlight, computeTimeView } from '../lib/timeView';
import { undriveScene } from '../lib/pose3d';
import type { EditOptions } from '../viewports/contracts';
import { circuitEngine, opticsEngine, circuitDef, opticsDef } from '../engines';
import { hasClipboard, useApp, type Domain, type WorkspaceTab } from '../store/app';
import { Mnemonic } from './TitleBar';
import { useSim } from '../store/sim';
import { simDriver } from '../sim/driver';
import { clientToWorld, registerPane, register3D } from '../commands';
import { LIBRARY_DND_MIME, insertLibraryItem, librarySelectionCount, useLibrary } from '../library/store';
import type { MeasureAnnotation } from '../viewports/contracts';
import { Splitter } from './Splitter';

// ---------------------------------------------------------------------------
// Error boundary so a viewport crash doesn't take down the shell
// ---------------------------------------------------------------------------

class ViewportBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  componentDidCatch(error: Error): void {
    useApp.getState().log('error', this.props.name, `Viewport crashed: ${error.message}`);
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="viewport-error">
          <b>{this.props.name} viewport failed</b>
          <span className="mono dim">{this.state.error.message}</span>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface Ctx { domain: Domain; id: string | null; x: number; y: number }

function ContextMenu({ ctx, onClose }: { ctx: Ctx; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const s = useApp.getState;
  const has = !!ctx.id;
  const libCount = librarySelectionCount();
  const items: { label: string; key?: string; run(): void; disabled?: boolean; sep?: boolean }[] = [
    { label: 'Cut', key: 'Ctrl+X', run: () => s().cut(), disabled: !has },
    { label: 'Copy', key: 'Ctrl+C', run: () => s().copy(), disabled: !has },
    { label: 'Paste', key: 'Ctrl+V', run: () => s().paste(), disabled: !hasClipboard() },
    { label: 'Duplicate', key: 'Ctrl+D', run: () => s().duplicate(), disabled: !has },
    { label: 'Rotate', key: 'R', run: () => s().rotateSelection(1), disabled: !has },
    { label: 'Delete', key: 'Del', run: () => s().deleteSelection(), disabled: !has },
    { label: 'Save to Library…', run: () => useLibrary.getState().openDialog({ mode: 'save' }), disabled: libCount.optics + libCount.circuit === 0, sep: true }
  ];
  const x = Math.min(ctx.x, window.innerWidth - 200), y = Math.min(ctx.y, window.innerHeight - 220);
  return (
    <div className="menu-pop ctx" role="menu" tabIndex={-1} ref={ref} style={{ left: x, top: y }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      {items.map((it) => [
        it.sep ? <div key={`${it.label}-sep`} className="menu-sep" role="separator" /> : null,
        <div key={it.label} role="menuitem" aria-disabled={it.disabled} className={`menu-item${it.disabled ? ' disabled' : ''}`}
          onClick={() => { if (it.disabled) return; onClose(); it.run(); }}>
          <span className="menu-check" />
          <span className="menu-label">{it.label}</span>
          {it.key && <span className="menu-shortcut">{it.key}</span>}
        </div>
      ])}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

const EMPTY_LINKS: never[] = [];

function useLinkedIds(domain: Domain): Set<string> {
  const links = useApp((s) => s.doc?.links ?? EMPTY_LINKS);
  return useMemo(() => new Set(links.map((l) => (domain === 'optics' ? l.opticsId : l.circuitId))), [links, domain]);
}

function Pane({ domain, children }: { domain: Domain; children: ReactNode }): React.JSX.Element {
  const active = useApp((s) => s.tab === 'split' && s.activeDomain === domain);
  const placing = useApp((s) => s.placeLibrary);
  const ref = useCallback((el: HTMLDivElement | null) => registerPane(domain, el), [domain]);
  const canPlace = !!placing && (domain === 'optics' ? placing.optics.length > 0 : placing.circuit.components.length > 0);
  return (
    <div
      className={`pane ${domain}${active ? ' active' : ''}${canPlace ? ' placing' : ''}`}
      ref={ref}
      onPointerDownCapture={(e) => {
        const s = useApp.getState();
        s.setActiveDomain(domain);
        // library placement: a left click inserts the whole group at the cursor (viewport never sees it)
        const item = s.placeLibrary;
        if (item && e.button === 0 && canPlace) {
          e.stopPropagation(); e.preventDefault();
          insertLibraryItem(item, domain, clientToWorld(domain, e.clientX, e.clientY));
          if (!e.shiftKey) s.startPlaceLibrary(null);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.length) useApp.getState().setActiveDomain(domain);
        if (Array.from(e.dataTransfer.types).includes(LIBRARY_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      }}
      onDropCapture={(e) => {
        const id = e.dataTransfer.getData(LIBRARY_DND_MIME);
        if (!id) return;
        e.preventDefault(); e.stopPropagation();
        const item = useLibrary.getState().find(id);
        if (item) insertLibraryItem(item, domain, clientToWorld(domain, e.clientX, e.clientY));
      }}
    >
      {children}
      {canPlace && <span className="place-hint">Click to place “{placing!.name}” (Shift+click: place several) — Esc cancels</span>}
    </div>
  );
}

/** Slow-motion time view shared by the 2D and 3D optics viewports (see lib/timeView.ts). */
function useTimeView(dim: '2d' | '3d', components: OpticsScene['components'] | undefined) {
  const status = useApp((s) => s.sim.status);
  const timeScale = useApp((s) => s.timeScale);
  const trace = useSim((s) => (dim === '3d' ? s.trace3d : s.trace));
  const maxT = useMemo(() => benchTimeOfFlight(trace?.segments ?? []), [trace]);
  // only follow the simulated clock (a re-render per frame) when a pulse view can be shown
  const pulsed = useMemo(() => (components ?? []).some((c) => c.type.startsWith('source.') && c.props?.mode === 'pulsed'), [components]);
  const possible = !!components && status !== 'stopped' && maxT > 0 && (pulsed || maxT / timeScale >= 0.1);
  const time = useSim((s) => (!possible ? 0 : pulsed ? s.time : Math.min(s.time, maxT * 1.05)));
  return useMemo(() => {
    if (!components) return undefined;
    const v = computeTimeView({ components, simTime: time, timeScale, status, maxT });
    if (v.mode === 'steady') return undefined;
    return v;
  }, [components, time, timeScale, status, maxT]);
}

function OpticsPane({ onContext }: { onContext(c: Ctx): void }): React.JSX.Element | null {
  const docScene = useApp((s) => s.doc?.optics);
  const status = useApp((s) => s.sim.status);
  const drivenScene = useSim((s) => s.drivenScene);
  const dim = useApp((s) => s.opticsDim);
  // live view: actuator-driven rotations (servo / galvo) are drawn from the co-simulation's copy
  const scene = status !== 'stopped' && drivenScene ? drivenScene : docScene;
  const selection = useApp((s) => s.selection.optics);
  const view = useApp((s) => s.views.optics);
  const display = useApp((s) => s.opticsDisplay);
  const storeTool = useApp((s) => (s.spacePan ? 'pan' : s.tool));
  const placeType = useApp((s) => (s.placeDomain === 'optics' ? s.placeType : null));
  const trace = useSim((s) => s.trace);
  const linkedIds = useLinkedIds('optics');
  const measurements = useApp((s) => s.measurements);
  const measureSel = useApp((s) => s.measureSel);
  const onMeasure = useCallback((m: Omit<MeasureAnnotation, 'id'>) => {
    const s = useApp.getState();
    s.addMeasurement(m);
    if (!s.ui.dockOpen || s.ui.dockTab !== 'measure') s.setUi({ dockOpen: true, dockTab: 'measure' });
  }, []);

  const tool: 'select' | 'pan' | 'measure' | 'place' =
    storeTool === 'pan' || storeTool === 'measure' ? storeTool : storeTool === 'place' && placeType ? 'place' : 'select';

  const onSceneChange = useCallback((next: OpticsScene, opts: EditOptions) => {
    const s = useApp.getState();
    const doc = s.doc?.optics;
    if (!doc) return;
    const sim = useSim.getState();
    const driven = s.sim.status !== 'stopped' ? sim.drivenScene : null;
    s.setOpticsScene(undriveScene(next, driven, doc), opts.commit, opts.label);
  }, []);
  const onSelectionChange = useCallback((ids: string[]) => useApp.getState().setSelection('optics', ids), []);
  const onViewChange = useCallback((v: ViewState) => useApp.getState().setView('optics', v), []);
  const onCursor = useCallback((p: Vec2 | null) => useApp.getState().setCursor('optics', p), []);
  const onContextMenu = useCallback((id: string | null, p: Vec2) => onContext({ domain: 'optics', id, x: p.x, y: p.y }), [onContext]);
  const timeView = useTimeView(dim, scene?.components);
  const trace3d = useSim((s) => s.trace3d);
  const handle = useRef<Optics3DViewportHandle | null>(null);
  const setHandle = useCallback((h: Optics3DViewportHandle | null) => { handle.current = h; register3D(h); }, []);
  useEffect(() => () => register3D(null), []);

  if (!scene) return null;
  if (dim === '3d') {
    // the 3D shader takes a finite window: a CW front lights [0, t]
    const tv3 = timeView ? { mode: timeView.mode, t: timeView.t, period: timeView.period, pulseWidth: Number.isFinite(timeView.pulseWidth) ? timeView.pulseWidth : Math.max(timeView.t, 1e-15) } : undefined;
    return (
      <Optics3DViewport
        engine3d={optics3dEngine}
        opticsEngine={opticsEngine}
        scene={scene}
        trace3d={trace3d}
        selection={selection}
        view={view}
        linkedIds={linkedIds}
        display={display}
        tool={tool}
        placeType={placeType ?? undefined}
        onSceneChange={onSceneChange}
        onSelectionChange={onSelectionChange}
        onViewChange={onViewChange}
        onCursor={onCursor}
        onContextMenu={onContextMenu}
        timeView={tv3}
        captureRef={setHandle}
      />
    );
  }
  return (
    <OpticsViewport
      engine={opticsEngine}
      scene={scene}
      trace={trace}
      selection={selection}
      view={view}
      linkedIds={linkedIds}
      display={display}
      tool={tool}
      placeType={placeType ?? undefined}
      onSceneChange={onSceneChange}
      onSelectionChange={onSelectionChange}
      onViewChange={onViewChange}
      onCursor={onCursor}
      onContextMenu={onContextMenu}
      measurements={measurements}
      selectedMeasurement={measureSel}
      onMeasure={onMeasure}
      timeView={timeView}
    />
  );
}

function CircuitPane({ onContext }: { onContext(c: Ctx): void }): React.JSX.Element | null {
  const scene = useApp((s) => s.doc?.circuit);
  const selection = useApp((s) => s.selection.circuit);
  const view = useApp((s) => s.views.circuit);
  const display = useApp((s) => s.circuitDisplay);
  const storeTool = useApp((s) => (s.spacePan ? 'pan' : s.tool));
  const placeType = useApp((s) => (s.placeDomain === 'circuit' ? s.placeType : null));
  const status = useApp((s) => s.sim.status);
  const state = useSim((s) => s.circuit);
  const linkedIds = useLinkedIds('circuit');

  const tool: 'select' | 'pan' | 'wire' | 'place' | 'probe' =
    storeTool === 'pan' || storeTool === 'wire' || storeTool === 'probe' ? storeTool : storeTool === 'place' && placeType ? 'place' : 'select';

  const onSceneChange = useCallback((next: CircuitScene, opts: EditOptions) => useApp.getState().setCircuitScene(next, opts.commit, opts.label), []);
  const onSelectionChange = useCallback((ids: string[]) => useApp.getState().setSelection('circuit', ids), []);
  const onViewChange = useCallback((v: ViewState) => useApp.getState().setView('circuit', v), []);
  const onCursor = useCallback((p: Vec2 | null) => useApp.getState().setCursor('circuit', p), []);
  const onInteract = useCallback((id: string, action: 'toggle' | 'press' | 'release' | { set: number }) => simDriver.interact(id, action), []);
  const onContextMenu = useCallback((id: string | null, p: Vec2) => onContext({ domain: 'circuit', id, x: p.x, y: p.y }), [onContext]);

  if (!scene) return null;
  return (
    <CircuitViewport
      engine={circuitEngine}
      scene={scene}
      state={status === 'stopped' ? null : state}
      running={status === 'running'}
      selection={selection}
      view={view}
      linkedIds={linkedIds}
      display={display}
      tool={tool}
      placeType={placeType ?? undefined}
      onSceneChange={onSceneChange}
      onSelectionChange={onSelectionChange}
      onViewChange={onViewChange}
      onInteract={onInteract}
      onCursor={onCursor}
      onContextMenu={onContextMenu}
    />
  );
}

function LinkHeader(): React.JSX.Element {
  const doc = useApp((s) => s.doc);
  const [open, setOpen] = useState(false);
  const links = doc?.links ?? [];
  const name = (domain: Domain, id: string): string => {
    if (!doc) return id;
    if (domain === 'optics') { const c = doc.optics.components.find((x) => x.id === id); return c?.name || opticsDef(c?.type ?? '')?.label || id; }
    const c = doc.circuit.components.find((x) => x.id === id); return c?.name || circuitDef(c?.type ?? '')?.label || id;
  };
  return (
    <div className="link-header">
      <button type="button" className={`link-summary${links.length ? ' has' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{links.length === 0 ? 'No opto-links' : `${links.length} opto-link${links.length === 1 ? '' : 's'} active`}</span>
      </button>
      <div className={`link-chips${open ? ' open' : ''}`}>
        {links.map((l) => (
          <button key={l.id} type="button" className="link-chip" title={`${l.kind}: ${l.circuitId} ↔ ${l.opticsId}`}
            onClick={() => {
              const s = useApp.getState();
              s.setSelection('optics', [l.opticsId]);
              s.setSelection('circuit', [l.circuitId]);
            }}>
            <span className={`link-kind ${l.kind}`}>{l.kind[0].toUpperCase()}</span>
            <span>{name('circuit', l.circuitId)}</span>
            <span className="dim">{l.kind === 'detector' ? '⟵' : '⟶'}</span>
            <span>{name('optics', l.opticsId)}{l.targetProp ? <span className="dim">.{l.targetProp}</span> : null}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const WS_TABS: { id: WorkspaceTab; label: string; key: string }[] = [
  { id: 'optics', label: '&Optics Bench', key: '1' },
  { id: 'circuit', label: '&Circuit', key: '2' },
  { id: 'split', label: 'S&plit', key: '3' }
];

export function Workspace(): React.JSX.Element {
  const tab = useApp((s) => s.tab);
  const ratio = useApp((s) => s.ui.splitRatio);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onContext = useCallback((c: Ctx) => {
    const s = useApp.getState();
    s.setActiveDomain(c.domain);
    if (c.id && !s.selection[c.domain].includes(c.id)) s.setSelection(c.domain, [c.id]);
    setCtx(c);
  }, []);
  const closeCtx = useCallback(() => setCtx(null), []);

  const showOptics = tab !== 'circuit';
  const showCircuit = tab !== 'optics';
  return (
    <main className="workspace">
      <div className="ws-tabstrip">
        <div className="tabs" role="tablist" aria-label="Workspace">
          {WS_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' active' : ''}`} title={`${t.label} (${t.key})`}
              onClick={() => useApp.getState().setTab(t.id)}>
              <span><Mnemonic label={t.label} /></span>
            </button>
          ))}
        </div>
        {tab === 'split' && <LinkHeader />}
      </div>
      <div className={`workspace-body ${tab}`} ref={bodyRef}>
        {showOptics && (
          <div className="pane-slot" style={tab === 'split' ? { flexBasis: `${ratio * 100}%` } : undefined}>
            <Pane domain="optics">
              <ViewportBoundary name="optics"><OpticsPane onContext={onContext} /></ViewportBoundary>
              {tab === 'split' && <span className="pane-label">Optics Bench</span>}
            </Pane>
          </div>
        )}
        {tab === 'split' && (
          <Splitter
            direction="horizontal"
            className="split-divider"
            getValue={() => useApp.getState().ui.splitRatio * (bodyRef.current?.clientWidth ?? 1000)}
            onChange={(v) => {
              const w = bodyRef.current?.clientWidth ?? 1000;
              useApp.getState().setUi({ splitRatio: Math.max(0.15, Math.min(0.85, v / w)) });
            }}
          />
        )}
        {showCircuit && (
          <div className="pane-slot" style={tab === 'split' ? { flexBasis: `${(1 - ratio) * 100}%` } : undefined}>
            <Pane domain="circuit">
              <ViewportBoundary name="circuit"><CircuitPane onContext={onContext} /></ViewportBoundary>
              {tab === 'split' && <span className="pane-label">Circuit</span>}
            </Pane>
          </div>
        )}
      </div>
      {ctx && <ContextMenu ctx={ctx} onClose={closeCtx} />}
    </main>
  );
}
