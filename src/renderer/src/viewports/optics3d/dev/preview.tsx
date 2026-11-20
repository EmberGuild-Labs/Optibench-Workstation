/**
 * DEV ONLY standalone preview of the 3D optics viewport.
 * Run:   npx vite --config src/renderer/src/viewports/optics3d/dev/vite.config.ts
 * Open:  http://localhost:5203/preview.html?ex=01&engine=auto|mock|real&cam=iso|top|front|side
 * Examples are the 2D .obw files from /examples converted on the fly (pose3d defaults to 0).
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ObwDocument, OpticsScene } from '@core/types';
import type { Optics3DEngineAPI } from '@core/types3d';
import { opticsEngine } from '@core/optics';
import { PALETTE_DND_MIME } from '../../contracts';
import { Optics3DViewport, type CameraPreset, type TimeView } from '../index';
import { createMockEngine3D } from './mockEngine3d';

const q = new URLSearchParams(location.search);
const raw = import.meta.glob('../../../../../../examples/*.obw', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples = Object.entries(raw).map(([k, v]) => ({ name: k.split('/').pop()!.replace('.obw', ''), doc: JSON.parse(v) as ObwDocument }))
  .filter((e) => e.doc.optics.components.length > 0);
const realMods = import.meta.glob('../../../../../core/optics3d/index.ts');

const mock = createMockEngine3D(opticsEngine);

async function loadEngine(): Promise<{ engine: Optics3DEngineAPI; kind: string }> {
  const want = q.get('engine') ?? 'auto';
  const loader = Object.values(realMods)[0];
  if (want !== 'mock' && loader) {
    try {
      const m = (await loader()) as { optics3dEngine?: Optics3DEngineAPI };
      if (m.optics3dEngine) return { engine: m.optics3dEngine, kind: 'real' };
    } catch (err) { console.warn('[harness] real optics3d engine failed to load, using mock', err); }
  }
  return { engine: mock, kind: 'mock' };
}

declare global { interface Window { __harness?: { scene(): OpticsScene; sel(): string[]; select(ids: string[]): void; log: string[]; setTime(v: TimeView): void; setScene(s: OpticsScene): void } } }

function App({ engine, kind }: { engine: Optics3DEngineAPI; kind: string }) {
  const initial = examples.find((e) => e.name.startsWith(q.get('ex') ?? '01')) ?? examples[0];
  const [exName, setExName] = useState(initial.name);
  const [scene, setScene] = useState<OpticsScene>(initial.doc.optics);
  const [selection, setSelection] = useState<string[]>(q.get('sel') ? q.get('sel')!.split(',') : []);
  const [display, setDisplay] = useState({ showGrid: true, bloom: true, rayOpacity: 0.7, showNormals: false, showPolarization: false });
  const [tool, setTool] = useState<'select' | 'pan' | 'measure' | 'place'>('select');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [time, setTime] = useState<TimeView>({ mode: 'steady', t: 0 });
  const [playing, setPlaying] = useState(false);
  const logRef = useRef<string[]>([]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selRef = useRef(selection);
  selRef.current = selection;
  const trace3d = useMemo(() => { try { return engine.trace3D(scene); } catch (e) { console.error(e); return null; } }, [scene, engine]);
  const maxT = useMemo(() => Math.max(0, ...(trace3d?.segments ?? []).map((s) => s.t0 ?? 0)), [trace3d]);

  useEffect(() => {
    window.__harness = { scene: () => sceneRef.current, sel: () => selRef.current, select: setSelection, log: logRef.current, setTime, setScene };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => {
      const period = 4000; // ms of wall time for one full flight
      setTime({ mode: 'pulse', t: (((now - t0) % period) / period) * maxT * 1.1 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxT]);

  const btn = (on = false): React.CSSProperties => ({ font: '11px Tahoma, sans-serif', background: on ? '#e6e3dc' : '#d4d0c8', border: 0, padding: '2px 8px', boxShadow: on ? 'inset 1px 1px #808080, inset -1px -1px #fff' : 'inset -1px -1px #404040, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #e6e3dc' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', font: '11px Tahoma, sans-serif' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={exName} onChange={(e) => { const ex = examples.find((x) => x.name === e.target.value)!; setExName(ex.name); setScene(ex.doc.optics); setSelection([]); }}>
          {examples.map((e) => <option key={e.name}>{e.name}</option>)}
        </select>
        {(['select', 'pan', 'place'] as const).map((t) => <button key={t} style={btn(tool === t)} onClick={() => setTool(t)}>{t}</button>)}
        {(['showGrid', 'bloom'] as const).map((k) => <button key={k} style={btn(display[k])} onClick={() => setDisplay({ ...display, [k]: !display[k] })}>{k}</button>)}
        <label>exposure <input type="range" min={0} max={1} step={0.01} value={display.rayOpacity} onChange={(e) => setDisplay({ ...display, rayOpacity: Number(e.target.value) })} /></label>
        <button style={btn(playing)} onClick={() => { setPlaying(!playing); if (playing) setTime({ mode: 'steady', t: 0 }); }}>{playing ? 'stop pulse' : 'play pulse'}</button>
        <span>palette:</span>
        {['lens.biconvex', 'mirror.flat', 'prism.equilateral', 'detector.screen'].map((t) => (
          <span key={t} draggable onDragStart={(e) => e.dataTransfer.setData(PALETTE_DND_MIME, JSON.stringify({ domain: 'optics', type: t }))} style={{ ...btn(), cursor: 'grab' }}>{t}</span>
        ))}
        <span style={{ marginLeft: 'auto' }}>engine: {kind} · {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)} mm` : '—'} · {trace3d?.segments.length ?? 0} segs · sel {selection.join(',') || '—'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, margin: '0 4px', boxShadow: 'inset 1px 1px #808080, inset -1px -1px #fff, inset 2px 2px #404040, inset -2px -2px #e6e3dc', padding: 2 }}>
        <Optics3DViewport
          engine3d={engine} trace3d={trace3d} opticsEngine={opticsEngine}
          scene={scene} selection={selection} view={{ cx: 60, cy: 40, zoom: 1.6 }}
          linkedIds={new Set()} display={display} tool={tool} placeType="lens.biconvex"
          timeView={time} initialCamera={(q.get('cam') as CameraPreset) ?? 'iso'}
          onSceneChange={(next, o) => { setScene(next); if (o.commit) { logRef.current.unshift(o.label ?? 'edit'); setLog([...logRef.current].slice(0, 6)); } }}
          onSelectionChange={setSelection} onViewChange={() => {}} onCursor={setCursor}
          onContextMenu={(id, p) => { logRef.current.unshift(`context ${id ?? 'empty'} @ ${p.x},${p.y}`); setLog([...logRef.current].slice(0, 6)); }}
        />
      </div>
      <div style={{ padding: '3px 8px' }}>{log.join('  ·  ') || 'no edits yet'}</div>
    </div>
  );
}

declare global { interface Window { __o3dRoot?: ReturnType<typeof createRoot> } }
loadEngine().then(({ engine, kind }) => {
  window.__o3dRoot ??= createRoot(document.getElementById('root')!);
  window.__o3dRoot.render(<StrictMode><App engine={engine} kind={kind} /></StrictMode>);
});
