/**
 * DEV ONLY standalone preview of the optics viewport with the mock engine.
 * Run:  npx vite --config src/renderer/src/viewports/optics/dev/vite.config.ts
 * Query: ?stress=50000 adds N random extra segments (perf test).
 */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OpticsScene, ViewState, TraceResult, RaySegment } from '@core/types';
import { OpticsViewport, captureOpticsPNG } from '../index';
import { PALETTE_DND_MIME } from '../../contracts';
import { mockEngine as mock, demoScene as mockScene } from './mockEngine';
import { opticsEngine } from '@core/optics';
import type { OpticsEngineAPI } from '@core/types';

const real = new URLSearchParams(location.search).get('engine') === 'real';
const mockEngine: OpticsEngineAPI = real ? opticsEngine : mock;
function demoScene(): OpticsScene {
  if (!real) return mockScene();
  const mk = (type: string, x: number, y: number, rot = 0, extra: Record<string, number | string | boolean> = {}) => {
    const c = opticsEngine.createComponent(type, { x, y });
    return { ...c, rotation: rot, props: { ...c.props, ...extra } };
  };
  return {
    settings: opticsEngine.defaultSettings(),
    components: [
      mk('source.white', -200, 20, -0.45), mk('prism.equilateral', -80, -38, 0.13), mk('detector.screen', 45, 62, 0.7),
      mk('source.laser', -190, 130), mk('lens.biconvex', -90, 130), mk('mirror.flat', 0, 130, Math.PI / 4),
      mk('block.slab', 0, 190, 0.3), mk('absorber.block', 0, 255), mk('fiber.cable', -60, -130),
      mk('detector.power', 200, -170), mk('splitter.pbs', 100, 130), mk('aperture.iris', -140, 130),
    ],
  };
}

const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);

function addStress(t: TraceResult): TraceResult {
  if (!stress) return t;
  const extra: RaySegment[] = [];
  let x = -250, y = 260;
  for (let i = 0; i < stress; i++) {
    const nx = x + (Math.random() - 0.5) * 30, ny = y + (Math.random() - 0.5) * 30;
    extra.push({ a: { x, y }, b: { x: nx, y: ny }, wavelength: 400 + Math.random() * 300, power: 1e-5, sourceId: 'stress', depth: i % 5 });
    x = Math.max(-300, Math.min(300, nx)); y = Math.max(230, Math.min(420, ny));
  }
  return { ...t, segments: [...t.segments, ...extra] };
}

function App() {
  const [scene, setScene] = useState<OpticsScene>(demoScene);
  const [selection, setSelection] = useState<string[]>([]);
  const [view, setView] = useState<ViewState>({ cx: 0, cy: 0, zoom: 1.9 });
  const [tool, setTool] = useState<'select' | 'pan' | 'measure' | 'place'>('select');
  const [display, setDisplay] = useState({ showGrid: true, bloom: true, rayOpacity: 0.7, showNormals: false, showPolarization: false });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const trace = useMemo(() => addStress(mockEngine.trace(scene)), [scene]);
  const btn = (on: boolean): React.CSSProperties => ({ background: on ? '#0b3a48' : '#121822', color: '#cfe', border: '1px solid #234', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', font: '12px system-ui' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#05080d', color: '#cde', font: '12px system-ui' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['select', 'pan', 'measure'] as const).map((t) => <button key={t} style={btn(tool === t)} onClick={() => setTool(t)}>{t}</button>)}
        {(['showGrid', 'bloom', 'showNormals', 'showPolarization'] as const).map((k) => (
          <button key={k} style={btn(display[k])} onClick={() => setDisplay({ ...display, [k]: !display[k] })}>{k}</button>
        ))}
        <label>exposure <input type="range" min={0} max={1} step={0.01} value={display.rayOpacity} onChange={(e) => setDisplay({ ...display, rayOpacity: Number(e.target.value) })} /></label>
        <button style={btn(false)} onClick={async () => { const b = await captureOpticsPNG(); window.open(URL.createObjectURL(b)); }}>capture</button>
        <span style={{ opacity: 0.6 }}>palette:</span>
        {mockEngine.registry.map((d) => (
          <span key={d.type} draggable onDragStart={(e) => e.dataTransfer.setData(PALETTE_DND_MIME, JSON.stringify({ domain: 'optics', type: d.type }))}
            style={{ ...btn(false), cursor: 'grab' }}>{d.label}</span>
        ))}
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)} mm` : '—'} · zoom {view.zoom.toFixed(2)} · {trace.segments.length} segs
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <OpticsViewport
          engine={mockEngine} scene={scene} trace={trace} selection={selection} view={view}
          linkedIds={new Set(scene.components.filter((c) => c.type === 'detector.power').map((c) => c.id))}
          display={display} tool={tool}
          onSceneChange={(next, o) => { setScene(next); if (o.commit) setLog((l) => [o.label ?? 'edit', ...l].slice(0, 6)); }}
          onSelectionChange={setSelection} onViewChange={setView} onCursor={setCursor}
          onContextMenu={(id, p) => setLog((l) => [`context ${id ?? 'empty'} @ ${p.x},${p.y}`, ...l].slice(0, 6))}
        />
      </div>
      <div style={{ padding: '3px 8px', opacity: 0.6 }}>{log.join('  ·  ')}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
