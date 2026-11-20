import { useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { useSim } from '../store/sim';
import { trimNum } from '../lib/units';
import { formatSimTime, formatTimeScale } from '../lib/timeView';

function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0, raf = 0, last = performance.now();
    const loop = (now: number): void => {
      frames++;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export function StatusBar(): React.JSX.Element {
  const cursor = useApp((s) => s.cursor);
  const domain = useApp((s) => (s.tab === 'split' ? s.activeDomain : s.tab));
  const zoom = useApp((s) => s.views[domain].zoom);
  const status = useApp((s) => s.sim.status);
  const selCount = useApp((s) => s.selection[domain].length);
  const tool = useApp((s) => (s.spacePan ? 'pan' : s.tool));
  const dim = useApp((s) => s.opticsDim);
  const timeScale = useApp((s) => s.timeScale);
  const stats2 = useSim((s) => s.trace?.stats);
  const stats3 = useSim((s) => s.trace3d?.stats);
  const wall2 = useSim((s) => s.traceWallMs);
  const wall3 = useSim((s) => s.trace3dWallMs);
  const source2 = useSim((s) => s.traceSource);
  const show3 = dim === '3d' && domain === 'optics';
  const stats = show3 ? stats3 : stats2;
  const wall = show3 ? wall3 : wall2;
  const source = show3 ? (stats3 ? 'worker' : null) : source2;
  const time = useSim((s) => s.time);
  const converged = useSim((s) => s.circuit?.converged);
  const error = useSim((s) => s.circuit?.error);
  const fps = useFps();

  const cur = cursor
    ? cursor.domain === 'optics'
      ? `${trimNum(cursor.p.x, 5)}, ${trimNum(cursor.p.y, 5)} mm`
      : `${Math.round(cursor.p.x)}, ${Math.round(cursor.p.y)} grid`
    : '—';
  const conv = status === 'stopped' || converged === undefined ? 'idle' : error ? 'error' : converged ? 'ok' : 'warn';

  return (
    <footer className="statusbar" role="status">
      <span className={`sb-item sb-mode ${status}`}>{status === 'stopped' ? 'EDIT' : status.toUpperCase()}</span>
      <span className="sb-item" title="Active tool">{tool}</span>
      <span className="sb-item" title="Cursor position">{cur}</span>
      <span className="sb-item" title="Zoom">{domain === 'optics' ? `${trimNum(zoom, 3)} px/mm` : `${trimNum(zoom, 3)} px/grid`}</span>
      {selCount > 0 && <span className="sb-item">{selCount} selected</span>}
      <span className="sb-item sb-fill" />
      {domain === 'optics' && <span className="sb-item" title="Optics view">{dim === '3d' ? '3D' : '2D'}</span>}
      <span className="sb-item" title={show3 ? '3D trace: rays / segments / trace time' : 'Rays / segments / trace time'}>
        {show3 ? '3D: ' : ''}{stats ? `${stats.rays.toLocaleString()} rays · ${stats.segments.toLocaleString()} seg · ${trimNum(stats.ms, 3)} ms` : 'no trace'}
        {stats && source ? <span className="dim"> ({source}{source === 'worker' ? ` ${wall.toFixed(1)} ms` : ''})</span> : null}
      </span>
      <span className="sb-item" title="Time scale (simulated per real second)">{formatTimeScale(timeScale)}</span>
      <span className="sb-item sb-time" title="Simulated time since Play / Reset">{status === 'stopped' ? 't = —' : formatSimTime(time)}</span>
      <span className={`sb-item sb-conv ${conv}`} title={error ?? 'Circuit solver state'}>
        <span className="dot" />{conv === 'idle' ? 'solver idle' : conv === 'ok' ? 'converged' : conv === 'warn' ? 'not converged' : 'error'}
      </span>
      <span className="sb-item" title="UI frames per second">{fps} fps</span>
      <span className="size-grip" aria-hidden="true" />
    </footer>
  );
}
