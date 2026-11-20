import { ChevronDown, ChevronUp } from 'lucide-react';
import { useApp, type DockTab } from '../../store/app';
import { Instruments } from './Instruments';
import { Oscilloscope } from './Oscilloscope';
import { Console } from './Console';
import { SweepPanel } from './Sweep';
import { MeasurementsPanel } from './Measurements';
import { Splitter } from '../Splitter';
import { useSweep } from '../../store/sweep';

const TABS: { id: DockTab; label: string }[] = [
  { id: 'instruments', label: 'Instruments' },
  { id: 'scope', label: 'Oscilloscope' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'measure', label: 'Measurements' },
  { id: 'console', label: 'Console' }
];

export function BottomDock(): React.JSX.Element {
  const open = useApp((s) => s.ui.dockOpen);
  const tab = useApp((s) => s.ui.dockTab);
  const height = useApp((s) => s.ui.dockHeight);
  const errors = useApp((s) => s.logs.reduce((n, l) => n + (l.level === 'error' ? 1 : 0), 0));
  const setUi = useApp((s) => s.setUi);
  const measureCount = useApp((s) => s.measurements.length);
  const sweepRunning = useSweep((s) => s.status === 'running');
  const sweepPct = useSweep((s) => (s.total ? Math.round((s.points.length / s.total) * 100) : 0));

  return (
    <section className={`dock${open ? ' open' : ''}`} style={open ? { height } : undefined} aria-label="Bottom dock">
      {open && (
        <Splitter
          direction="vertical"
          sign={-1}
          getValue={() => useApp.getState().ui.dockHeight}
          onChange={(v) => setUi({ dockHeight: Math.round(Math.max(120, Math.min(window.innerHeight * 0.7, v))) })}
        />
      )}
      <div className="dock-tabs tabs" role="tablist">
        {TABS.map((t) => {
          return (
            <button key={t.id} type="button" role="tab" aria-selected={open && tab === t.id}
              className={`tab${open && tab === t.id ? ' active' : ''}`}
              onClick={() => setUi(open && tab === t.id ? { dockOpen: false } : { dockOpen: true, dockTab: t.id })}>
              {t.label}
              {t.id === 'console' && errors > 0 && <span className="badge err">{errors}</span>}
              {t.id === 'sweep' && sweepRunning && <span className="badge">{sweepPct}%</span>}
              {t.id === 'measure' && measureCount > 0 && <span className="badge">{measureCount}</span>}
            </button>
          );
        })}
        <div className="flex1" />
        <button type="button" className="tb-btn small" aria-label={open ? 'Collapse dock' : 'Expand dock'} title="Toggle dock (Ctrl+J)"
          onClick={() => setUi({ dockOpen: !open })}>
          {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronUp size={14} strokeWidth={1.5} />}
        </button>
      </div>
      {open && (
        <div className="dock-body">
          {tab === 'instruments' && <Instruments />}
          {tab === 'scope' && <Oscilloscope />}
          {tab === 'sweep' && <SweepPanel />}
          {tab === 'measure' && <MeasurementsPanel />}
          {tab === 'console' && <Console />}
        </div>
      )}
    </section>
  );
}
