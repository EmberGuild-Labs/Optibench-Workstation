/** Dev-only harness: mounts CircuitViewport with the mock engine and a fake running state. */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CircuitScene, CircuitState, ViewState } from '@core/types';
import { CircuitViewport } from '../index';
import { mockEngine as mockEng, mockRegistry as mockReg } from './mockEngine';
import { circuitEngine } from '@core/circuit';
const REAL = !location.search.includes('mock');
// headless checks: hidden tabs never fire rAF, so fall back to timers with ?norf
if (location.search.includes('norf')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id: number): void => window.clearTimeout(id);
}
const mockEngine = REAL ? circuitEngine : mockEng;
const mockRegistry = REAL ? circuitEngine.registry : mockReg;
import { buildModel, defMap } from '../model';

function initialScene(): CircuitScene {
  const comps = mockRegistry.map((d, i) => {
    const c = mockEngine.createComponent(d.type, { x: (i % 6) * 9, y: Math.floor(i / 6) * 9 });
    return { ...c, name: `${d.type.split('.')[1].slice(0, 3).toUpperCase()}${i + 1}` };
  });
  const bat = { ...mockEngine.createComponent('source.battery', { x: -12, y: 0 }), rotation: 1 as const };
  const res = mockEngine.createComponent('passive.resistor', { x: -9, y: -3 });
  const led = { ...mockEngine.createComponent('semi.led', { x: -8, y: 6 }), rotation: 2 as const };
  return {
    components: [...comps, { ...bat, name: 'B1' }, { ...res, name: 'R1', props: { resistance: 4700 } }, { ...led, name: 'LED1' }],
    wires: REAL ? [
      { id: 'w1', points: [{ x: -12, y: -2 }, { x: -12, y: -3 }, { x: -11, y: -3 }] },
      { id: 'w2', points: [{ x: -7, y: -3 }, { x: -4, y: -3 }, { x: -4, y: 6 }, { x: -6, y: 6 }] },
      { id: 'w3', points: [{ x: -10, y: 6 }, { x: -12, y: 6 }, { x: -12, y: 2 }] }
    ] : [
      { id: 'w1', points: [{ x: -12, y: 0 }, { x: -12, y: -3 }, { x: -9, y: -3 }] },
      { id: 'w2', points: [{ x: -5, y: -3 }, { x: -4, y: -3 }, { x: -4, y: 6 }, { x: -6, y: 6 }] },
      { id: 'w3', points: [{ x: -9, y: 6 }, { x: -12, y: 6 }, { x: -12, y: 3 }] }
    ],
    settings: mockEngine.defaultSettings()
  };
}

function fakeState(scene: CircuitScene, t: number): CircuitState {
  const m = buildModel(scene, mockEngine, defMap(mockEngine));
  const pinNets: Record<string, string> = {};
  const nodeVoltages: Record<string, number> = {};
  for (let i = 0; i < m.graph.nodes.length; i++) {
    for (const pr of m.graph.nodes[i].pins) pinNets[`${pr.compId}:${pr.pin}`] = `n${m.graph.group[i]}`;
    nodeVoltages[`n${m.graph.group[i]}`] = 9 * Math.sin(m.graph.group[i] * 1.7 + t * 0.5);
  }
  const components: CircuitState['components'] = {};
  const b = 0.5 + 0.5 * Math.sin(t * 2);
  const digit = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f][Math.floor(t) % 10];
  for (const c of scene.components) {
    components[c.id] = {
      current: c.type === 'source.battery' ? -0.002 : 0.002, voltage: 5.02, brightness: b, on: Math.floor(t) % 2 === 0,
      text: '4.98 V',
      segments: c.type === 'display.matrix' ? [...Array(64).keys()].map((k) => ((k + Math.floor(t * 4)) % 9 === 0 ? 1 : 0))
        : [...Array(8).keys()].map((k) => (digit >> k) & 1)
    };
  }
  return { time: t, nodeVoltages, pinNets, components, converged: true };
}

function App() {
  const [scene, setScene] = useState<CircuitScene>(initialScene);
  const [selection, setSelection] = useState<string[]>([]);
  const [view, setView] = useState<ViewState>({ cx: 10, cy: 8, zoom: 22 });
  const [tool, setTool] = useState<'select' | 'pan' | 'wire' | 'place' | 'probe'>('select');
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    if (!running) return;
    let raf = 0; const t0 = performance.now();
    const loop = (): void => { setT((performance.now() - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  const sim = useMemo(() => (REAL && running ? mockEngine.createSimulator(scene) : null), [running, scene]);
  const state = useMemo(() => (running ? (sim ? sim.step(1 / 60) : fakeState(scene, t)) : null), [running, scene, t, sim]);
  (window as unknown as { __h: unknown }).__h = { scene, selection, view };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        {(['select', 'wire', 'pan', 'place', 'probe'] as const).map((k) => (
          <button key={k} onClick={() => setTool(k)} style={{ fontWeight: tool === k ? 700 : 400 }}>{k}</button>
        ))}
        <button onClick={() => setRunning((r) => !r)}>{running ? 'stop' : 'run'}</button>
        <span>sel: {selection.join(',')}</span>
        <span style={{ opacity: 0.6 }}>{log.slice(-3).join(' | ')}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, margin: '37px 0 0 133px', border: '2px inset #808080' }}>
        <CircuitViewport
          engine={mockEngine} scene={scene} state={state} running={running} selection={selection} view={view}
          linkedIds={new Set([scene.components[3]?.id ?? ''])}
          display={{ showGrid: true, animateCurrent: true, colorByVoltage: true }}
          tool={tool} placeType="passive.resistor"
          onSceneChange={(s, o) => { setScene(s); if (o.commit) setLog((l) => [...l, o.label ?? 'edit']); }}
          onSelectionChange={setSelection} onViewChange={setView}
          onInteract={(id, a) => { sim?.interact(id, a); setLog((l) => [...l, `interact ${id} ${JSON.stringify(a)}`]); }}
          onContextMenu={(id) => setLog((l) => [...l, `ctx ${id}`])}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
