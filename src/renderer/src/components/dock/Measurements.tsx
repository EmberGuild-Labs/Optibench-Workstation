/** Bottom dock "Measurements" tab: persistent measure-tool annotations (select, delete, clear). */
import { useApp } from '../../store/app';
import { measureText } from '../../viewports/optics/measureInfo';

export function MeasurementsPanel(): React.JSX.Element {
  const list = useApp((s) => s.measurements);
  const sel = useApp((s) => s.measureSel);
  const st = useApp.getState;
  const idx = list.findIndex((m) => m.id === sel);
  return (
    <div className="measure-panel">
      <div className="listview" tabIndex={0} aria-label="Measurements"
        onKeyDown={(e) => {
          if (!list.length) return;
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); if (sel) st().removeMeasurement(sel); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            const n = Math.max(0, Math.min(list.length - 1, (idx < 0 ? -1 : idx) + (e.key === 'ArrowDown' ? 1 : -1)));
            st().selectMeasurement(list[n].id);
          }
        }}>
        <table>
          <colgroup><col style={{ width: 36 }} /><col style={{ width: 80 }} /><col style={{ width: 120 }} /><col /></colgroup>
          <thead><tr><th>#</th><th>Type</th><th>Value</th><th>Points (mm)</th></tr></thead>
          <tbody>
            {list.map((m, i) => (
              <tr key={m.id} className={m.id === sel ? 'sel' : ''} onMouseDown={() => st().selectMeasurement(m.id)}>
                <td>{i + 1}</td>
                <td>{m.kind === 'distance' ? 'Distance' : 'Angle'}</td>
                <td>{measureText(m)}</td>
                <td>{m.points.map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join(' – ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="dock-empty">No measurements. Choose the Measure tool (M) on the optics bench.</div>}
      </div>
      <div className="measure-side">
        <button type="button" className="btn" onClick={() => { st().setTab(st().tab === 'circuit' ? 'optics' : st().tab); st().setTool('measure'); }}><u>M</u>easure Tool</button>
        <button type="button" className="btn" disabled={!sel} onClick={() => sel && st().removeMeasurement(sel)}><u>D</u>elete</button>
        <button type="button" className="btn" disabled={!list.length} onClick={() => st().clearMeasurements()}>C<u>l</u>ear All</button>
        <div className="side-hint">
          Click two points for a distance (or drag). Shift+click three points (arm, vertex, arm) for an angle.
          Points snap to component centres and surfaces; hold Ctrl to place freely. Esc cancels.
        </div>
      </div>
    </div>
  );
}
