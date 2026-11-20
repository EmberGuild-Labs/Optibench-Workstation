/** Bottom dock "Sweep" tab: run status, chart with cursor readout, CSV export and "Apply value". */
import { useMemo, useState } from 'react';
import { useApp } from '../../store/app';
import { applySweepPoint, exportSweepCsv, useSweep } from '../../store/sweep';
import { SERIES_COLORS, SweepChart, type ChartSeries } from '../sweep/SweepChart';
import { formatSI } from '../../lib/units';

function fmtV(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === '' ) return v.toPrecision(4);
  if (unit === 'nm' || unit === 'mm' || unit === '°') return `${v.toFixed(unit === '°' ? 2 : 3)} ${unit}`;
  return formatSI(v, unit, 4);
}

export function SweepPanel(): React.JSX.Element {
  const sw = useSweep();
  const hasDoc = useApp((s) => !!s.doc);
  const [hover, setHover] = useState<number | null>(null);
  const run = sw.run;
  const x = useMemo(() => sw.points.map((p) => p.value), [sw.points]);
  const series: ChartSeries[] = useMemo(() => (run ? run.outputLabels.map((label, k) => ({
    label, unit: run.outputUnits[k], color: SERIES_COLORS[k % SERIES_COLORS.length], data: sw.points.map((p) => p.outputs[k] ?? null)
  })) : []), [run, sw.points]);
  const running = sw.status === 'running';
  const pct = sw.total ? Math.round((sw.points.length / sw.total) * 100) : 0;
  const cur = hover ?? sw.selected;
  const curPt = cur !== null ? sw.points[cur] : undefined;

  return (
    <div className="sweep-panel">
      <div className="sweep-side">
        <div className="kv">
          <span>Parameter:</span><span title={run?.paramLabel}>{run?.paramLabel ?? '—'}</span>
          <span>Range:</span><span>{run ? `${fmtV(run.spec.start, run.paramUnit)} … ${fmtV(run.spec.stop, run.paramUnit)}` : '—'}</span>
          <span>Points:</span><span>{run ? `${sw.points.length} / ${sw.total} (${run.spec.scale})` : '—'}</span>
          <span>Status:</span><span>{sw.status === 'idle' ? 'Ready' : sw.status === 'running' ? 'Running…' : sw.status === 'done' ? `Done in ${(sw.ms / 1000).toFixed(2)} s` : sw.status === 'cancelled' ? 'Cancelled' : `Error: ${sw.error}`}</span>
        </div>
        <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} title={`${pct} %`}>
          <div className="chunks" style={{ width: `${pct}%` }} />
        </div>
        {running
          ? <button type="button" className="btn" onClick={() => sw.cancel()}>Cancel</button>
          : <button type="button" className="btn" disabled={!hasDoc} onClick={() => useApp.getState().setUi({ modal: 'sweep' })}>Set<u>u</u>p…</button>}
        <button type="button" className="btn" disabled={running || !run || !hasDoc} onClick={() => run && useSweep.getState().start(run.spec)}>{'Run '}<u>A</u>gain</button>
        <button type="button" className="btn" disabled={!sw.points.length} onClick={() => void exportSweepCsv()}><u>E</u>xport CSV…</button>
        <button type="button" className="btn" disabled={sw.selected === null || running} title="Set the swept parameter to the selected point's value" onClick={() => sw.selected !== null && applySweepPoint(sw.selected)}>A<u>p</u>ply Value</button>
      </div>
      <div className="sweep-main">
        <div className="sweep-chart">
          <SweepChart x={x} xLabel={run?.paramLabel ?? 'Parameter'} xUnit={run?.paramUnit ?? ''} logX={run?.spec.scale === 'log'}
            series={series} selected={sw.selected} onSelect={(i) => sw.select(i)} onHover={setHover} />
        </div>
        <div className="sweep-readout" aria-live="polite">
          {curPt && run ? (
            <>
              <span>{cur === sw.selected && hover === null ? '▶ ' : ''}#{curPt.index + 1}  x = {fmtV(curPt.value, run.paramUnit)}</span>
              {run.outputLabels.map((l, k) => (
                <span key={k} title={l}><span className="sw" style={{ background: SERIES_COLORS[k % SERIES_COLORS.length] }} />{fmtV(curPt.outputs[k], run.outputUnits[k])}</span>
              ))}
              {curPt.error && <span style={{ color: 'var(--danger)' }}>{curPt.error}</span>}
            </>
          ) : <span className="dim" style={{ fontFamily: 'var(--font-ui)' }}>Hover the chart for values; click a point to select it, then Apply Value.</span>}
        </div>
      </div>
    </div>
  );
}
