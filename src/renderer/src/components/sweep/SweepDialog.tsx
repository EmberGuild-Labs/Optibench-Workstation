/** Simulation ▸ Parameter Sweep… — classic dialog to configure and start a headless sweep. */
import { useMemo, useState } from 'react';
import type { ComponentDef, ObwDocument } from '@core/types';
import { ModalDialog } from '../Dialog';
import { useApp } from '../../store/app';
import { useSweep, paramInfo } from '../../store/sweep';
import { circuitDef, circuitEngine, opticsDef } from '../../engines';
import {
  CIRCUIT_OUTPUTS, OPTICS_OUTPUTS, OUTPUT_INFO, PSEUDO_PARAMS, readSweepValue, sweepValues,
  type SweepDomain, type SweepOutput, type SweepOutputKind, type SweepScale, type SweepSpec, type SweepTarget
} from '../../lib/sweep';
import { formatSI } from '../../lib/units';

interface Opt { id: string; label: string; type: string }

function comps(doc: ObwDocument, domain: SweepDomain): Opt[] {
  if (domain === 'optics') return doc.optics.components.map((c) => ({ id: c.id, type: c.type, label: `${c.name || opticsDef(c.type)?.label || c.type}` }));
  return doc.circuit.components.filter((c) => c.type !== 'misc.ground').map((c) => ({ id: c.id, type: c.type, label: `${c.name || c.id} — ${circuitDef(c.type)?.label ?? c.type}` }));
}

function numericParams(domain: SweepDomain, type: string): { key: string; label: string; unit?: string; log?: boolean }[] {
  type P = { key: string; label: string; unit?: string; log?: boolean };
  const def: ComponentDef | undefined = domain === 'optics' ? opticsDef(type) : circuitDef(type);
  const out: P[] = (def?.params ?? []).filter((p) => p.kind === 'number' || p.kind === 'wavelength').map((p) => ({ key: p.key, label: p.label, unit: p.unit, log: p.log }));
  if (domain === 'optics') out.unshift(...Object.entries(PSEUDO_PARAMS).map(([k, v]) => ({ key: k, label: v.label, unit: v.unit })));
  return out;
}

/** Components that can produce a given output kind. */
function outputCandidates(doc: ObwDocument, kind: SweepOutputKind): Opt[] {
  const info = OUTPUT_INFO[kind];
  const all = comps(doc, info.domain);
  switch (kind) {
    case 'detectorPower': return all.filter((c) => c.type.startsWith('detector.'));
    case 'spectrumPeak': { const s = all.filter((c) => /spectro|wavemeter/.test(c.type)); return s.length ? s : all.filter((c) => c.type.startsWith('detector.')); }
    case 'screenCentroid': { const s = all.filter((c) => /screen|camera|profil/.test(c.type)); return s.length ? s : all.filter((c) => c.type.startsWith('detector.')); }
    case 'ledBrightness': return all.filter((c) => /led|lamp|laser_diode|display/.test(c.type));
    case 'probeMean': return all.filter((c) => c.type === 'meter.probe' || c.type === 'meter.voltmeter');
    default: return all;
  }
}

function pinsOf(doc: ObwDocument, id: string): string[] {
  const c = doc.circuit.components.find((x) => x.id === id);
  if (!c) return [];
  try { return circuitEngine.getPinPositions(c).map((p) => p.name); } catch { return []; }
}

function defaultRange(doc: ObwDocument, t: SweepTarget, logHint?: boolean): { start: number; stop: number; scale: SweepScale } {
  const v = readSweepValue(doc, t);
  if (t.param === '@rotation') { const c = v ?? 0; return { start: Number((c - 10).toFixed(2)), stop: Number((c + 10).toFixed(2)), scale: 'linear' }; }
  if (t.param === '@x' || t.param === '@y') { const c = v ?? 0; return { start: c - 20, stop: c + 20, scale: 'linear' }; }
  if (v === null || v === 0) return { start: 0, stop: 1, scale: 'linear' };
  if (logHint && v > 0) return { start: Number((v / 10).toPrecision(3)), stop: Number((v * 10).toPrecision(3)), scale: 'log' };
  return { start: Number((v * 0.5).toPrecision(4)), stop: Number((v * 1.5).toPrecision(4)), scale: 'linear' };
}

function defaultOutputs(doc: ObwDocument): SweepOutput[] {
  const out: SweepOutput[] = [];
  const spec = doc.optics.components.find((c) => c.type === 'detector.spectrometer');
  if (spec) out.push({ kind: 'spectrumPeak', id: spec.id });
  const det = doc.optics.components.find((c) => c.type.startsWith('detector.') && c.id !== spec?.id);
  if (det) out.push({ kind: 'detectorPower', id: det.id });
  const led = doc.circuit.components.find((c) => /semi\.led|misc\.lamp/.test(c.type));
  if (led) out.push({ kind: 'ledBrightness', id: led.id });
  const probe = doc.circuit.components.find((c) => c.type === 'meter.probe');
  if (probe && out.length < 3) out.push({ kind: 'probeMean', id: probe.id });
  return out.slice(0, 3);
}

function initialSpec(doc: ObwDocument, prev: SweepSpec | null): SweepSpec {
  const ok = (s: SweepSpec): boolean => {
    const list = s.target.domain === 'optics' ? doc.optics.components : doc.circuit.components;
    return list.some((c) => c.id === s.target.id) && s.outputs.every((o) => (OUTPUT_INFO[o.kind].domain === 'optics' ? doc.optics.components : doc.circuit.components).some((c) => c.id === o.id));
  };
  if (prev && ok(prev)) return prev;
  const domain: SweepDomain = doc.optics.components.length ? 'optics' : 'circuit';
  const sel = useApp.getState().selection[domain][0];
  const list = comps(doc, domain);
  // prefer the selection, then something "tunable" (prism / mirror / resistor)
  const pick = list.find((c) => c.id === sel) ?? list.find((c) => /prism|grating|mirror|resistor|potentiometer/.test(c.type)) ?? list[0];
  const params = pick ? numericParams(domain, pick.type) : [];
  const param = params.find((p) => domain === 'circuit' || p.key === '@rotation') ?? params[0];
  const target: SweepTarget = { domain, id: pick?.id ?? '', param: param?.key ?? '' };
  const r = pick && param ? defaultRange(doc, target, param.log) : { start: 0, stop: 1, scale: 'linear' as const };
  const anyCircuit = doc.circuit.components.length > 0;
  return { target, ...r, steps: 21, outputs: defaultOutputs(doc), settle: anyCircuit ? 1 : 0, samples: 100 };
}

export function SweepDialog({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const doc = useApp((s) => s.doc);
  const prev = useSweep((s) => s.spec);
  const [spec, setSpec] = useState<SweepSpec | null>(() => (doc ? initialSpec(doc, prev) : null));
  const [startText, setStartText] = useState(() => String(spec?.start ?? 0));
  const [stopText, setStopText] = useState(() => String(spec?.stop ?? 1));
  const [stepsText, setStepsText] = useState(() => String(spec?.steps ?? 21));
  const [settleText, setSettleText] = useState(() => String(spec?.settle ?? 1));
  const [err, setErr] = useState<string | null>(null);

  const targetComps = useMemo(() => (doc && spec ? comps(doc, spec.target.domain) : []), [doc, spec?.target.domain]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc || !spec) return null;
  const tc = targetComps.find((c) => c.id === spec.target.id);
  const params = tc ? numericParams(spec.target.domain, tc.type) : [];
  const pinfo = paramInfo(spec.target, doc);
  const hasCircuitOut = spec.outputs.some((o) => OUTPUT_INFO[o.kind].domain === 'circuit');
  const needsSettle = hasCircuitOut || (doc.links.length > 0 && spec.target.domain === 'circuit');

  const setTarget = (t: SweepTarget): void => {
    const p = numericParams(t.domain, (t.domain === 'optics' ? doc.optics.components : doc.circuit.components).find((c) => c.id === t.id)?.type ?? '').find((x) => x.key === t.param);
    const r = defaultRange(doc, t, p?.log);
    setSpec({ ...spec, target: t, ...r });
    setStartText(String(r.start)); setStopText(String(r.stop));
  };
  const setDomain = (d: SweepDomain): void => {
    const list = comps(doc, d);
    const c = list[0];
    const p = c ? numericParams(d, c.type)[0] : undefined;
    setTarget({ domain: d, id: c?.id ?? '', param: p?.key ?? '' });
  };
  const setComp = (id: string): void => {
    const c = targetComps.find((x) => x.id === id);
    const ps = c ? numericParams(spec.target.domain, c.type) : [];
    const keep = ps.find((p) => p.key === spec.target.param);
    setTarget({ ...spec.target, id, param: keep?.key ?? ps[0]?.key ?? '' });
  };
  const setOut = (i: number, o: SweepOutput): void => setSpec({ ...spec, outputs: spec.outputs.map((x, k) => (k === i ? o : x)) });
  const addOut = (): void => {
    const kinds: SweepOutputKind[] = [...OPTICS_OUTPUTS, ...CIRCUIT_OUTPUTS];
    for (const k of kinds) {
      const c = outputCandidates(doc, k)[0];
      if (c && !spec.outputs.some((o) => o.kind === k && o.id === c.id)) { setSpec({ ...spec, outputs: [...spec.outputs, { kind: k, id: c.id }] }); return; }
    }
  };

  const run = (): void => {
    const start = Number(startText), stop = Number(stopText), steps = Math.round(Number(stepsText)), settle = Number(settleText);
    if (!spec.target.id || !spec.target.param) return setErr('Choose a component and a parameter to sweep.');
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return setErr('Start and stop must be numbers.');
    if (!(steps >= 2 && steps <= 2000)) return setErr('Steps must be between 2 and 2000.');
    if (spec.scale === 'log' && !(start > 0 && stop > 0)) return setErr('A logarithmic sweep needs start and stop greater than zero.');
    if (!spec.outputs.length) return setErr('Add at least one output.');
    if (spec.outputs.some((o) => !o.id)) return setErr('Every output needs a component.');
    if (needsSettle && !(settle > 0 && settle <= 600)) return setErr('Settle time must be between 0 and 600 s.');
    const final: SweepSpec = { ...spec, start, stop, steps, settle: needsSettle ? settle : 0 };
    useSweep.getState().start(final);
    onClose();
  };

  const values = sweepValues(Number(startText), Number(stopText), Math.round(Number(stepsText)) || 0, spec.scale);
  const footer = (
    <>
      <button type="button" className="btn default" onClick={run}><u>R</u>un Sweep</button>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
    </>
  );

  return (
    <ModalDialog title="Parameter Sweep" onClose={onClose} footer={footer} wide>
      <div className="sweep-dialog-body" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); run(); } }}>
        <fieldset className="group-box static">
          <legend><span>Swept parameter</span></legend>
          <div className="form-grid">
            <label>Domain:</label>
            <div className="seg" role="radiogroup">
              {(['optics', 'circuit'] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={spec.target.domain === d} className={spec.target.domain === d ? 'on' : ''}
                  disabled={!comps(doc, d).length} onClick={() => setDomain(d)}>{d === 'optics' ? 'Optics' : 'Circuit'}</button>
              ))}
            </div>
            <label htmlFor="sw-comp">Co<u>m</u>ponent:</label>
            <select id="sw-comp" className="sel" accessKey="m" value={spec.target.id} onChange={(e) => setComp(e.target.value)}>
              {targetComps.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <label htmlFor="sw-param"><u>P</u>arameter:</label>
            <select id="sw-param" className="sel" accessKey="p" value={spec.target.param} onChange={(e) => setTarget({ ...spec.target, param: e.target.value })}>
              {params.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ''}</option>)}
            </select>
            <label htmlFor="sw-start"><u>S</u>tart / stop:</label>
            <div className="form-row">
              <input id="sw-start" accessKey="s" className="field" value={startText} onChange={(e) => setStartText(e.target.value)} spellCheck={false} />
              <span>to</span>
              <input aria-label="Stop" className="field" value={stopText} onChange={(e) => setStopText(e.target.value)} spellCheck={false} />
              <span style={{ width: 24 }}>{pinfo.unit}</span>
            </div>
            <label htmlFor="sw-steps">S<u>t</u>eps:</label>
            <div className="form-row">
              <input id="sw-steps" accessKey="t" className="field" style={{ maxWidth: 70 }} value={stepsText} onChange={(e) => setStepsText(e.target.value)} spellCheck={false} />
              <div className="seg" role="radiogroup" aria-label="Scale">
                {(['linear', 'log'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={spec.scale === k} className={spec.scale === k ? 'on' : ''} onClick={() => setSpec({ ...spec, scale: k })}>{k === 'linear' ? 'Linear' : 'Logarithmic'}</button>
                ))}
              </div>
              <span className="dim">{values.length > 1 ? `${formatSI(values[0], '', 4)} … ${formatSI(values[values.length - 1], '', 4)}` : ''}</span>
            </div>
          </div>
        </fieldset>

        <fieldset className="group-box static">
          <legend><span>Outputs</span></legend>
          {spec.outputs.map((o, i) => {
            const cands = outputCandidates(doc, o.kind);
            const pins = o.kind === 'nodeVoltage' ? pinsOf(doc, o.id) : [];
            return (
              <div key={i} className="out-row">
                <select className="sel" aria-label="Output quantity" value={o.kind} onChange={(e) => {
                  const k = e.target.value as SweepOutputKind;
                  const c = outputCandidates(doc, k);
                  setOut(i, { kind: k, id: c.some((x) => x.id === o.id) ? o.id : c[0]?.id ?? '' });
                }}>
                  <optgroup label="Optics">
                    {OPTICS_OUTPUTS.map((k) => <option key={k} value={k} disabled={!outputCandidates(doc, k).length}>{OUTPUT_INFO[k].label}</option>)}
                  </optgroup>
                  <optgroup label="Circuit">
                    {CIRCUIT_OUTPUTS.map((k) => <option key={k} value={k} disabled={!outputCandidates(doc, k).length}>{OUTPUT_INFO[k].label}</option>)}
                  </optgroup>
                </select>
                <select className="sel" aria-label="Output component" value={o.id} onChange={(e) => setOut(i, { ...o, id: e.target.value, pin: undefined })}>
                  {cands.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                {o.kind === 'nodeVoltage' ? (
                  <select className="sel" aria-label="Pin" value={o.pin ?? pins[0] ?? ''} onChange={(e) => setOut(i, { ...o, pin: e.target.value })}>
                    {pins.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : <span className="dim">{OUTPUT_INFO[o.kind].unit || '0…1'}</span>}
                <button type="button" className="icon-btn" title="Remove output" aria-label="Remove output" onClick={() => setSpec({ ...spec, outputs: spec.outputs.filter((_, k) => k !== i) })}>
                  <svg viewBox="0 0 8 7" aria-hidden="true"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5Z" fill="#000" /></svg>
                </button>
              </div>
            );
          })}
          <div className="form-row">
            <button type="button" className="btn" onClick={addOut} disabled={spec.outputs.length >= 8}><u>A</u>dd Output</button>
            {!spec.outputs.length && <span className="dim">No outputs yet.</span>}
          </div>
        </fieldset>

        <fieldset className="group-box static">
          <legend><span>Simulation</span></legend>
          <div className="form-grid">
            <label htmlFor="sw-settle">Settle <u>t</u>ime:</label>
            <div className="form-row">
              <input id="sw-settle" className="field" style={{ maxWidth: 70 }} disabled={!needsSettle} value={needsSettle ? settleText : '—'} onChange={(e) => setSettleText(e.target.value)} spellCheck={false} />
              <span>s of simulated time per point</span>
            </div>
          </div>
          <div className="dlg-note">
            {needsSettle
              ? `Each point runs ${doc.links.length ? 'the co-simulation' : 'the circuit transient'} on a copy of the document; circuit outputs are averaged over the second half of the settle window.`
              : 'Each point traces the optics on a copy of the document. The open project is not changed.'}
          </div>
          {err && <div className="dlg-note" style={{ color: 'var(--danger)' }} role="alert">{err}</div>}
        </fieldset>
      </div>
    </ModalDialog>
  );
}
