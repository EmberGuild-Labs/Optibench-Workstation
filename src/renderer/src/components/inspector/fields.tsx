/** Generic inspector field widgets. All emit (value, commit) where commit=false is a live preview. */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ParamDef, ParamValue } from '@core/types';
import { clamp, formatSI, parseSI, trimNum } from '../../lib/units';
import { rgbCss, spectrumGradient, wavelengthToRGBFallback, type RGBFn } from '../../lib/spectrum';

export type Emit<T> = (v: T, commit: boolean) => void;

export function Help({ text }: { text?: string }): React.JSX.Element | null {
  if (!text) return null;
  return (
    <span className="help" tabIndex={0} aria-label={text} data-tip={text}>?</span>
  );
}

export function Section({ title, children, defaultOpen = true, right }: {
  title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className={`group-box${open ? '' : ' collapsed'}`}>
      <legend>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Expand'}>
          <span className="tree-box" aria-hidden="true">{open ? '−' : '+'}</span>
          <span>{title}</span>
        </button>
        {right}
      </legend>
      {open && <div className="group-body">{children}</div>}
    </fieldset>
  );
}

export function Row({ label, help, children, htmlFor, wide }: {
  label: string; help?: string; children: ReactNode; htmlFor?: string; wide?: boolean;
}): React.JSX.Element {
  return (
    <div className={`insp-row${wide ? ' wide' : ''}`}>
      <label className="insp-label" htmlFor={htmlFor} title={label}>
        <span>{label}</span>
        <Help text={help} />
      </label>
      <div className="insp-control">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Number input with SI parsing
// ---------------------------------------------------------------------------

export function NumberInput({ value, unit, onCommit, min, max, step, integer, id, digits = 5, siDisplay = true }: {
  value: number; unit?: string; onCommit(v: number): void; min?: number; max?: number; step?: number;
  integer?: boolean; id?: string; digits?: number; siDisplay?: boolean;
}): React.JSX.Element {
  const fmt = (v: number): string => (siDisplay ? formatSI(v, unit ?? '', digits) : `${trimNum(v, digits)}${unit ? ' ' + unit : ''}`);
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  // latest typed text (state lags within one event: Enter/Escape call blur() synchronously)
  const textRef = useRef(text);
  const setTyped = (t: string): void => { textRef.current = t; setText(t); };
  useEffect(() => { if (!focused) setTyped(fmt(value)); }, [value, unit, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (): void => {
    const raw = textRef.current;
    const v = parseSI(raw, siDisplay ? '' : unit ?? '') ?? parseSI(raw, unit ?? '');
    if (v === null) { setBad(true); return; }
    let n = v;
    if (integer) n = Math.round(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setBad(false);
    setTyped(fmt(n));
    if (n !== value) onCommit(n);
  };
  const nudge = (dir: 1 | -1, big: boolean): void => {
    const s = step ?? (integer ? 1 : Math.max(Math.abs(value) * 0.01, 1e-6));
    let n = value + dir * s * (big ? 10 : 1);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    n = integer ? Math.round(n) : Number(n.toPrecision(10));
    // keep the visible text in sync even while focused, or the next blur would commit the old text back
    setTyped(fmt(n));
    setBad(false);
    if (n !== value) onCommit(n);
  };
  return (
    <div className="spin">
    <input
      id={id}
      className={`field num-input${bad ? ' bad' : ''}`}
      value={text}
      spellCheck={false}
      inputMode="decimal"
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onChange={(e) => { setTyped(e.target.value); setBad(false); }}
      onKeyDown={(e) => {
        // Enter commits through blur (exactly once); Escape restores the value before blurring
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') { setTyped(fmt(value)); setBad(false); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1, e.shiftKey); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1, e.shiftKey); }
      }}
    />
    <span className="spin-btns">
      <button type="button" tabIndex={-1} aria-label="Increase" onMouseDown={(e) => e.preventDefault()} onClick={(e) => nudge(1, e.shiftKey)}>
        <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true"><path d="M3.5 0L7 4H0Z" fill="currentColor" /></svg>
      </button>
      <button type="button" tabIndex={-1} aria-label="Decrease" onMouseDown={(e) => e.preventDefault()} onClick={(e) => nudge(-1, e.shiftKey)}>
        <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true"><path d="M0 0h7L3.5 4Z" fill="currentColor" /></svg>
      </button>
    </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider (linear or logarithmic)
// ---------------------------------------------------------------------------

const STEPS = 1000;

export function Slider({ value, min, max, log, step, onChange, trackStyle, ariaLabel }: {
  value: number; min: number; max: number; log?: boolean; step?: number; onChange: Emit<number>;
  trackStyle?: React.CSSProperties; ariaLabel?: string;
}): React.JSX.Element {
  const useLog = !!log && min > 0 && max > min;
  const toT = (v: number): number => {
    if (max <= min) return 0;
    if (useLog) return (Math.log(clamp(v, min, max) / min) / Math.log(max / min)) * STEPS;
    return ((clamp(v, min, max) - min) / (max - min)) * STEPS;
  };
  const fromT = (t: number): number => {
    let v = useLog ? min * Math.pow(max / min, t / STEPS) : min + ((max - min) * t) / STEPS;
    if (useLog) v = Number(v.toPrecision(3));
    else if (step) v = Math.round(v / step) * step;
    return Number(clamp(v, min, max).toPrecision(10));
  };
  const last = useRef(value);
  const dragging = useRef(false);
  const moved = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  if (!dragging.current) last.current = value; // follow external changes (undo, typing)
  return (
    <input
      type="range"
      className="slider"
      min={0}
      max={STEPS}
      step={1}
      value={toT(value)}
      aria-label={ariaLabel}
      aria-valuetext={String(value)}
      style={trackStyle}
      onPointerDown={() => {
        dragging.current = true;
        moved.current = false;
        // the release can happen anywhere on screen: listen on the window so the gesture always commits once
        const end = (): void => {
          window.removeEventListener('pointerup', end, true);
          window.removeEventListener('pointercancel', end, true);
          if (!dragging.current) return;
          dragging.current = false;
          if (moved.current) onChangeRef.current(last.current, true);
        };
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
      }}
      onChange={(e) => {
        const v = fromT(Number(e.target.value));
        // the native 'change' fired on release repeats the final value after the gesture already committed
        if (!dragging.current && v === last.current) return;
        last.current = v;
        if (dragging.current) moved.current = true;
        onChange(v, !dragging.current);
      }}
    />
  );
}

function deriveRange(p: ParamDef, value: number): { min: number; max: number } {
  let min = p.min, max = p.max;
  if (min !== undefined && max !== undefined) return { min, max };
  const v = Math.abs(value) || 1;
  if (p.log) {
    min ??= v / 1000;
    max ??= v * 1000;
  } else {
    min ??= value >= 0 ? 0 : -v * 4;
    max ??= Math.max(min + 1, v * 4);
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Param field dispatcher
// ---------------------------------------------------------------------------

export function ParamField({ param, value, onChange, rgb, overridden }: {
  param: ParamDef; value: ParamValue | undefined; onChange: Emit<ParamValue>; rgb?: RGBFn; overridden?: boolean;
}): React.JSX.Element {
  const id = useId();
  const v = value ?? param.default;
  let control: ReactNode;
  switch (param.kind) {
    case 'number':
      control = <NumberParam id={id} param={param} value={Number(v)} onChange={onChange} />;
      break;
    case 'wavelength':
      control = <WavelengthField id={id} value={Number(v)} min={param.min} max={param.max} onChange={onChange} rgb={rgb} />;
      break;
    case 'boolean':
      control = <Toggle id={id} value={Boolean(v)} onChange={(b) => onChange(b, true)} />;
      break;
    case 'select':
      control = (
        <select id={id} className="field sel" value={String(v)} onChange={(e) => onChange(e.target.value, true)}>
          {(param.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'color':
      control = (
        <div className="color-field">
          <input id={id} type="color" value={String(v)} onChange={(e) => onChange(e.target.value, false)} onBlur={(e) => onChange(e.target.value, true)} />
          <span className="mono">{String(v)}</span>
        </div>
      );
      break;
    default:
      control = <TextInput id={id} value={String(v)} onCommit={(t) => onChange(t, true)} />;
  }
  return (
    <Row label={param.label} help={param.help} htmlFor={id} wide={param.kind === 'wavelength' || param.kind === 'number'}>
      {overridden && <span className="override-badge" title="Driven by an opto-link at runtime">LINKED</span>}
      {control}
    </Row>
  );
}

function NumberParam({ id, param, value, onChange }: { id: string; param: ParamDef; value: number; onChange: Emit<number> }): React.JSX.Element {
  // range is fixed per field instance so the slider track doesn't move while dragging
  const range = useMemo(() => deriveRange(param, value), [param.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const integer = param.step !== undefined && Number.isInteger(param.step) && param.step >= 1;
  return (
    <div className="num-slider">
      <Slider value={value} min={range.min} max={range.max} log={param.log} step={param.step} onChange={onChange} ariaLabel={param.label} />
      <NumberInput id={id} value={value} unit={param.unit} min={param.min} max={param.max} step={param.step} integer={integer} onCommit={(n) => onChange(n, true)} />
    </div>
  );
}

export function Toggle({ value, onChange, id, label }: { value: boolean; onChange(v: boolean): void; id?: string; label?: string }): React.JSX.Element {
  return (
    <button id={id} type="button" role="switch" aria-checked={value} aria-label={label} className={`toggle${value ? ' on' : ''}`} onClick={() => onChange(!value)}>
      <span className="knob" />
    </button>
  );
}

export function TextInput({ value, onCommit, id, placeholder, multiline }: {
  value: string; onCommit(v: string): void; id?: string; placeholder?: string; multiline?: boolean;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  const textRef = useRef(value);
  const setTyped = (t: string): void => { textRef.current = t; setText(t); };
  useEffect(() => setTyped(value), [value]);
  const commit = (): void => { if (textRef.current !== value) onCommit(textRef.current); };
  if (multiline) {
    return (
      <textarea id={id} className="field text-input" rows={3} value={text} placeholder={placeholder}
        onChange={(e) => setTyped(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') { setTyped(value); (e.target as HTMLTextAreaElement).blur(); } }} />
    );
  }
  return (
    <input id={id} className="field text-input" value={text} placeholder={placeholder} spellCheck={false}
      onChange={(e) => setTyped(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') { setTyped(value); (e.target as HTMLInputElement).blur(); }
      }} />
  );
}

// ---------------------------------------------------------------------------
// Wavelength picker
// ---------------------------------------------------------------------------

export function WavelengthField({ value, onChange, min = 200, max = 2000, rgb, id }: {
  value: number; onChange: Emit<number>; min?: number; max?: number; rgb?: RGBFn; id?: string;
}): React.JSX.Element {
  const fn = rgb ?? wavelengthToRGBFallback;
  const lo = Math.max(min, 350), hi = Math.min(max, 850);
  const sliderMin = Math.min(lo, value), sliderMax = Math.max(hi, value);
  const grad = useMemo(() => {
    // map visible gradient onto slider range, dark outside the visible band
    const stops: string[] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const nm = sliderMin + ((sliderMax - sliderMin) * i) / n;
      stops.push(`${rgbCss(fn(nm), 1, 0.1)} ${((i / n) * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }, [fn, sliderMin, sliderMax]);
  const swatch = rgbCss(fn(value), 1, 0.15);
  const band = value < 380 ? 'UV' : value > 780 ? 'IR' : '';
  return (
    <div className="wl-field">
      <div className="wl-top">
        <span className="wl-swatch" style={{ background: swatch }} title={band || `${value} nm`}>
          {band && <span>{band}</span>}
        </span>
        <NumberInput id={id} value={value} unit="nm" min={min} max={max} step={1} siDisplay={false} digits={6} onCommit={(n) => onChange(n, true)} />
      </div>
      <Slider value={value} min={sliderMin} max={sliderMax} step={1} onChange={onChange} ariaLabel="Wavelength" trackStyle={{ ['--track' as string]: grad }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wavelength band (range) picker: one strip, two thumbs, two spin fields
// ---------------------------------------------------------------------------

export const VISIBLE_BAND: [number, number] = [380, 780];

/** Strip colour: real spectral colour inside 380-780 nm, dim violet (UV) / deep red (IR) outside. */
function bandColor(fn: RGBFn, nm: number): string {
  if (nm < 380) { const k = Math.max(0.25, 1 - (380 - nm) / 200); return `rgb(${Math.round(70 * k)}, 0, ${Math.round(110 * k)})`; }
  if (nm > 780) { const k = Math.max(0.25, 1 - (nm - 780) / 600); return `rgb(${Math.round(110 * k)}, 0, 0)`; }
  // engine colour normalised to full saturation, with the classic eye-sensitivity roll-off at the ends
  const c = fn(nm).map((v) => Math.max(0, v)) as [number, number, number];
  const m = Math.max(c[0], c[1], c[2]);
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  if (!(m > 0)) return rgbCss([0, 0, 0], 1, 0.18);
  return rgbCss([(c[0] / m) * f, (c[1] / m) * f, (c[2] / m) * f], 1, 0.18);
}

/**
 * Spectral band selector for param pairs like `wavelengthMin` / `wavelengthMax`.
 * Dragging a thumb previews (commit=false) and commits once on release; thumbs never cross.
 * Keyboard: arrows +-1 nm (Shift +-10), PageUp/PageDown +-50, Home/End to the limits.
 */
export function SpectrumRangeField({ lo, hi, min = 200, max = 2000, onChange, rgb, minGap = 1, labels = ['Band start', 'Band end'], id }: {
  lo: number; hi: number; min?: number; max?: number; onChange: Emit<[number, number]>; rgb?: RGBFn; minGap?: number;
  labels?: [string, string]; id?: string;
}): React.JSX.Element {
  const fn = rgb ?? wavelengthToRGBFallback;
  // the strip scale is fixed per field instance so it never moves under a dragging thumb
  const [scale] = useState(() => {
    const a = Math.max(min, Math.min(300, Math.min(lo, hi) - 20));
    const b = Math.min(max, Math.max(1100, Math.max(lo, hi) + 20));
    return { a, b: b > a ? b : a + 1 };
  });
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ which: 0 | 1; pointerId: number; last: [number, number] } | null>(null);
  const [active, setActive] = useState<0 | 1 | null>(null);
  const L = Math.min(lo, hi), H = Math.max(lo, hi);
  const pct = (nm: number): number => ((clamp(nm, scale.a, scale.b) - scale.a) / (scale.b - scale.a)) * 100;
  const grad = useMemo(() => {
    const stops: string[] = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const nm = scale.a + ((scale.b - scale.a) * i) / n;
      stops.push(`${bandColor(fn, nm)} ${((i / n) * 100).toFixed(2)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }, [fn, scale.a, scale.b]);

  /** Clamp a candidate for one thumb so the band stays ordered with at least `minGap` nm. */
  const constrain = (which: 0 | 1, nm: number, other: number): number => {
    const v = Math.round(nm);
    return which === 0 ? clamp(v, min, Math.min(max, other - minGap)) : clamp(v, Math.max(min, other + minGap), max);
  };
  const set = (which: 0 | 1, nm: number, commit: boolean, base: [number, number] = [L, H]): [number, number] => {
    const v = constrain(which, nm, base[1 - which]);
    const next: [number, number] = which === 0 ? [v, base[1]] : [base[0], v];
    onChange(next, commit);
    return next;
  };
  const nmAt = (clientX: number): number => {
    const r = trackRef.current!.getBoundingClientRect();
    const t = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    return scale.a + t * (scale.b - scale.a);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const nm = nmAt(e.clientX);
    const t = (e.target as HTMLElement).dataset.thumb;
    // a thumb grabbed directly keeps its identity; a click on the strip moves the nearest thumb
    const which: 0 | 1 = t === '0' ? 0 : t === '1' ? 1 : Math.abs(nm - L) < Math.abs(nm - H) || nm < L ? 0 : 1;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const base: [number, number] = [L, H];
    const last = t === undefined ? set(which, nm, false, base) : base;
    drag.current = { which, pointerId: e.pointerId, last };
    setActive(which);
    (e.currentTarget.querySelector(`[data-thumb="${which}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const prev = d.last;
    const v = constrain(d.which, nmAt(e.clientX), prev[1 - d.which]);
    if (v === prev[d.which]) return;
    d.last = d.which === 0 ? [v, prev[1]] : [prev[0], v];
    onChange(d.last, false);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(null);
    try { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    onChange(d.last, true); // exactly one undo step per gesture
  };
  const onKey = (which: 0 | 1) => (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const cur = which === 0 ? L : H;
    const big = e.shiftKey ? 10 : 1;
    let nm: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': nm = cur - big; break;
      case 'ArrowRight': case 'ArrowUp': nm = cur + big; break;
      case 'PageDown': nm = cur - 50; break;
      case 'PageUp': nm = cur + 50; break;
      case 'Home': nm = min; break;
      case 'End': nm = max; break;
    }
    if (nm === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (constrain(which, nm, which === 0 ? H : L) !== cur) set(which, nm, true);
  };
  const thumb = (which: 0 | 1): React.JSX.Element => {
    const v = which === 0 ? L : H;
    return (
      <div
        id={which === 0 ? id : undefined}
        data-thumb={which}
        className={`band-thumb${active === which ? ' active' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={labels[which]}
        aria-valuemin={which === 0 ? min : L + minGap}
        aria-valuemax={which === 0 ? H - minGap : max}
        aria-valuenow={v}
        aria-valuetext={`${v} nm`}
        title={`${labels[which]}: ${v} nm`}
        style={{ left: `${pct(v)}%` }}
        onKeyDown={onKey(which)}
      />
    );
  };
  const visible = L === VISIBLE_BAND[0] && H === VISIBLE_BAND[1];
  return (
    <div className="band-field">
      <div
        className="band-strip"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="band-track" style={{ background: grad }}>
          <div className="band-dim" style={{ left: 0, width: `${pct(L)}%` }} />
          <div className="band-dim" style={{ left: `${pct(H)}%`, right: 0 }} />
          <div className="band-mark" style={{ left: `${pct(380)}%` }} />
          <div className="band-mark" style={{ left: `${pct(780)}%` }} />
        </div>
        {thumb(0)}
        {thumb(1)}
      </div>
      <div className="band-scale" aria-hidden="true">
        <span style={{ left: 0 }}>{Math.round(scale.a)}</span>
        <span style={{ left: `${pct(580)}%`, transform: 'translateX(-50%)' }}>| visible |</span>
        <span style={{ right: 0 }}>{Math.round(scale.b)} nm</span>
      </div>
      <div className="band-inputs">
        <NumberInput value={L} unit="nm" min={min} max={H - minGap} step={1} siDisplay={false} digits={6} onCommit={(n) => set(0, n, true)} />
        <span className="band-dash">-</span>
        <NumberInput value={H} unit="nm" min={L + minGap} max={max} step={1} siDisplay={false} digits={6} onCommit={(n) => set(1, n, true)} />
        <button type="button" className="btn band-preset" disabled={visible} title="Set the band to the visible spectrum (380-780 nm)"
          onClick={() => onChange([VISIBLE_BAND[0], VISIBLE_BAND[1]], true)}>Visible</button>
      </div>
    </div>
  );
}

export { spectrumGradient };
