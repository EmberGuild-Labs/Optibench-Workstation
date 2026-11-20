import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { CircuitComponent } from '@core/types';
import { circuitDef } from '../../engines';
import { formatSI } from '../../lib/units';
import { useApp } from '../../store/app';
import { useSim } from '../../store/sim';
import { useCanvas } from './canvas';

const NO_COMPONENTS: CircuitComponent[] = [];
const CH_COLORS = ['#f7d64a', '#38c6f4', '#f472b6', '#4ade80', '#a78bfa', '#fb923c', '#e5e7eb', '#f87171'];
const TIME_DIVS = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5];
const VOLT_DIVS = [1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const DIVX = 10, DIVY = 8;

type Sample = { t: number; v: number };

/** Accepts history as [{t,v}] or [[t,v]] (or a typed {t:number[], v:number[]}). */
export function normalizeHistory(h: unknown): Sample[] {
  if (!h) return [];
  if (Array.isArray(h)) {
    const out: Sample[] = [];
    for (const s of h) {
      if (Array.isArray(s)) { if (typeof s[0] === 'number' && typeof s[1] === 'number') out.push({ t: s[0], v: s[1] }); }
      else if (s && typeof s === 'object') {
        const o = s as { t?: unknown; v?: unknown };
        if (typeof o.t === 'number' && typeof o.v === 'number') out.push({ t: o.t, v: o.v });
      }
    }
    return out;
  }
  if (typeof h === 'object') {
    const o = h as { t?: ArrayLike<number>; v?: ArrayLike<number> };
    if (o.t && o.v) {
      const n = Math.min(o.t.length, o.v.length);
      const out: Sample[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = { t: o.t[i], v: o.v[i] };
      return out;
    }
  }
  return [];
}

export function Oscilloscope(): React.JSX.Element {
  const components = useApp((s) => s.doc?.circuit.components ?? NO_COMPONENTS);
  const probes = useMemo(() => components.filter((c) => c.type === 'meter.probe'), [components]);
  const circuit = useSim((s) => s.circuit);
  const [tdiv, setTdiv] = useState(1e-3);
  const [vdiv, setVdiv] = useState(1);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [offsets, setOffsets] = useState<Record<string, number>>({});

  const series = useMemo(() => probes.map((p, i) => ({
    id: p.id,
    name: p.name || circuitDef(p.type)?.label || p.id,
    color: (typeof p.props.color === 'string' && /^#/.test(p.props.color) ? p.props.color : CH_COLORS[i % CH_COLORS.length]),
    data: normalizeHistory(circuit?.components[p.id]?.history),
    now: circuit?.components[p.id]?.voltage
  })), [probes, circuit]);

  const tEnd = circuit?.time ?? Math.max(0, ...series.map((s) => s.data[s.data.length - 1]?.t ?? 0));
  const span = tdiv * DIVX;
  const t0 = Math.max(0, tEnd - span);

  const ref = useCanvas((g, w, h) => {
    // background graticule
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, h);
    const dx = w / DIVX, dy = h / DIVY;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(120,140,170,0.13)';
    g.beginPath();
    for (let i = 1; i < DIVX; i++) { const x = Math.round(i * dx) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    for (let j = 1; j < DIVY; j++) { const y = Math.round(j * dy) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    // sub ticks on centre axes
    g.strokeStyle = 'rgba(120,140,170,0.3)';
    g.beginPath();
    const cy = Math.round(h / 2) + 0.5, cx = Math.round(w / 2) + 0.5;
    g.moveTo(0, cy); g.lineTo(w, cy); g.moveTo(cx, 0); g.lineTo(cx, h);
    for (let i = 0; i < DIVX * 5; i++) { const x = Math.round((i * dx) / 5) + 0.5; g.moveTo(x, cy - 3); g.lineTo(x, cy + 3); }
    for (let j = 0; j < DIVY * 5; j++) { const y = Math.round((j * dy) / 5) + 0.5; g.moveTo(cx - 3, y); g.lineTo(cx + 3, y); }
    g.stroke();

    const yOf = (v: number, off: number): number => h / 2 - ((v + off) / vdiv) * dy;
    for (const s of series) {
      if (hidden[s.id] || s.data.length < 2) continue;
      const off = offsets[s.id] ?? 0;
      g.beginPath();
      let started = false;
      // binary search first visible sample
      let lo = 0, hi = s.data.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (s.data[m].t < t0) lo = m + 1; else hi = m; }
      const start = Math.max(0, lo - 1);
      const step = Math.max(1, Math.floor((s.data.length - start) / (w * 2)));
      for (let i = start; i < s.data.length; i += step) {
        const p = s.data[i];
        const x = ((p.t - t0) / span) * w;
        const y = Math.max(-2, Math.min(h + 2, yOf(p.v, off)));
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.strokeStyle = s.color;
      g.lineWidth = 1.5;
      g.shadowColor = s.color;
      g.shadowBlur = 6;
      g.stroke();
      g.shadowBlur = 0;
      // ground marker (pinned to the edge, pointing off-screen, when the zero level is out of view)
      const gy = yOf(0, off);
      g.fillStyle = s.color;
      g.beginPath();
      if (gy < 0) { g.moveTo(0, 8); g.lineTo(4, 0); g.lineTo(8, 8); }
      else if (gy > h) { g.moveTo(0, h - 8); g.lineTo(4, h); g.lineTo(8, h - 8); }
      else { g.moveTo(0, gy - 4); g.lineTo(6, gy); g.lineTo(0, gy + 4); }
      g.fill();
    }
  }, [series, tdiv, vdiv, hidden, offsets, t0, span]);

  const autoscale = (): void => {
    let max = 0;
    for (const s of series) {
      if (hidden[s.id]) continue;
      for (const p of s.data) if (p.t >= t0) max = Math.max(max, Math.abs(p.v + (offsets[s.id] ?? 0)));
    }
    const need = max / (DIVY / 2) * 1.1;
    setVdiv(VOLT_DIVS.find((v) => v >= need) ?? VOLT_DIVS[VOLT_DIVS.length - 1]);
  };

  // Fit the vertical scale once, as soon as a new set of probes has data: with a fixed 1 V/div a
  // 5 V logic signal sat entirely above the screen and the scope looked dead until "Auto" was pressed.
  const probeKey = probes.map((p) => p.id).join('|');
  const autoDone = useRef('');
  useEffect(() => {
    if (!probeKey || autoDone.current === probeKey) return;
    if (!series.some((s) => s.data.length >= 2)) return;
    autoDone.current = probeKey;
    autoscale();
  });

  return (
    <div className="scope">
      <div className="scope-screen">
        <canvas ref={ref} className="chart scope-canvas" aria-label="Oscilloscope" />
        {!probes.length && <div className="scope-overlay"><span>Place a <b>Probe</b> (meter.probe) on a net to plot its voltage. Press <kbd>F5</kbd> to run.</span></div>}
        {probes.length > 0 && !circuit && <div className="scope-overlay"><span>Simulation stopped — press <kbd>F5</kbd> to run.</span></div>}
        <div className="scope-info mono">
          <span>{formatSI(tdiv, 's', 3)}/div</span>
          <span>{formatSI(vdiv, 'V', 3)}/div</span>
          <span>t = {formatSI(tEnd, 's', 4)}</span>
        </div>
      </div>
      <div className="scope-side">
        <div className="scope-ctrls">
          <label>Time/div
            <select className="sel" value={tdiv} onChange={(e) => setTdiv(Number(e.target.value))}>
              {TIME_DIVS.map((t) => <option key={t} value={t}>{formatSI(t, 's', 3)}</option>)}
            </select>
          </label>
          <label>Volts/div
            <select className="sel" value={vdiv} onChange={(e) => setVdiv(Number(e.target.value))}>
              {VOLT_DIVS.map((v) => <option key={v} value={v}>{formatSI(v, 'V', 3)}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={autoscale} title="Fit vertical scale"><Maximize2 size={14} strokeWidth={1.5} /> Auto</button>
        </div>
        <div className="scope-channels">
          {series.map((s, i) => (
            <div key={s.id} className={`scope-ch${hidden[s.id] ? ' off' : ''}`}>
              <button type="button" className="ch-toggle" style={{ ['--ch' as string]: s.color }} aria-pressed={!hidden[s.id]}
                onClick={() => setHidden((hh) => ({ ...hh, [s.id]: !hh[s.id] }))}>CH{i + 1}</button>
              <span className="ch-name" title={s.id}>{s.name}</span>
              <span className="ch-val mono">{typeof s.now === 'number' ? formatSI(s.now, 'V', 4) : s.data.length ? formatSI(s.data[s.data.length - 1].v, 'V', 4) : '—'}</span>
              <input type="range" className="ch-offset" min={-4} max={4} step={0.25} value={(offsets[s.id] ?? 0) / vdiv}
                aria-label={`CH${i + 1} offset`} title="Vertical offset (div)"
                onChange={(e) => setOffsets((o) => ({ ...o, [s.id]: Number(e.target.value) * vdiv }))} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
