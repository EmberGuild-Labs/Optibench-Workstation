import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, OctagonAlert, Trash2 } from 'lucide-react';
import { useApp, type LogEntry } from '../../store/app';

const ICON = { info: Info, warn: AlertTriangle, error: OctagonAlert } as const;

export function Console(): React.JSX.Element {
  const logs = useApp((s) => s.logs);
  const [levels, setLevels] = useState<Record<LogEntry['level'], boolean>>({ info: true, warn: true, error: true });
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shown = logs.filter((l) => levels[l.level]);
  const counts = { info: 0, warn: 0, error: 0 };
  for (const l of logs) counts[l.level]++;

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <div className="console">
      <div className="console-bar">
        {(['error', 'warn', 'info'] as const).map((lv) => {
          const I = ICON[lv];
          return (
            <button key={lv} type="button" className={`chip ${lv}${levels[lv] ? ' on' : ''}`} aria-pressed={levels[lv]}
              onClick={() => setLevels((x) => ({ ...x, [lv]: !x[lv] }))}>
              <I size={14} strokeWidth={1.5} /> {counts[lv]}
            </button>
          );
        })}
        <div className="flex1" />
        <button type="button" className="btn ghost" onClick={() => useApp.getState().clearLogs()}><Trash2 size={14} strokeWidth={1.5} /> Clear</button>
      </div>
      <div className="console-list mono" ref={ref} role="log" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8; }}>
        {shown.length === 0 && <div className="dock-empty">No messages.</div>}
        {shown.map((l) => {
          const I = ICON[l.level];
          return (
            <div key={l.id} className={`log-line ${l.level}`}>
              <I size={14} strokeWidth={1.5} className="log-icon" />
              <span className="log-time">{new Date(l.time).toLocaleTimeString([], { hour12: false })}</span>
              <span className="log-src">{l.source}</span>
              <span className="log-msg">{l.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
