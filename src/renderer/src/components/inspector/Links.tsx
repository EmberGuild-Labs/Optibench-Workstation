/** "Links" inspector section: create / edit / remove OptoLinks between circuit and optics components. */
import { useMemo, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import type { OptoLink, ObwDocument } from '@core/types';
import { circuitDef, opticsDef } from '../../engines';
import { makeIdFactory } from '../../lib/ids';
import { useApp, type Domain } from '../../store/app';
import { NumberInput, Row, Section } from './fields';

type Kind = OptoLink['kind'];
const KINDS: { id: Kind; label: string; help: string }[] = [
  { id: 'emitter', label: 'Emitter', help: 'Circuit emitter (laser diode / LED) optical power drives an optical source' },
  { id: 'detector', label: 'Detector', help: 'Optical detector power feeds a circuit photodiode / LDR / solar cell' },
  { id: 'actuator', label: 'Actuator', help: 'Circuit current (coils, inductors) or voltage drives an optical parameter: prop = gain × quantity + offset' }
];

const isCircuitEmitter = (t: string): boolean => t === 'opto.laser_diode' || t === 'semi.led';
const isCircuitDetector = (t: string): boolean => t === 'opto.photodiode' || t === 'opto.ldr' || t === 'opto.solar_cell';
const isOpticsSource = (t: string): boolean => t.startsWith('source.');
const isOpticsDetector = (t: string): boolean => t.startsWith('detector.');

function inferKind(domain: Domain, type: string): Kind {
  if (domain === 'circuit') return isCircuitEmitter(type) ? 'emitter' : isCircuitDetector(type) ? 'detector' : 'actuator';
  return isOpticsSource(type) ? 'emitter' : isOpticsDetector(type) ? 'detector' : 'actuator';
}

function candidates(doc: ObwDocument, domain: Domain, kind: Kind): { id: string; label: string; type: string }[] {
  if (domain === 'circuit') {
    // target lives in optics
    const list = doc.optics.components
      .filter((c) => (kind === 'emitter' ? isOpticsSource(c.type) : kind === 'detector' ? isOpticsDetector(c.type) : numericProps(c.type).length > 0))
      .map((c) => ({ id: c.id, type: c.type, label: c.name || opticsDef(c.type)?.label || c.type }));
    // actuators: magnetically driven parts (Faraday rotators, isolators: `bField`) are the natural default
    if (kind === 'actuator') list.sort((a, b) => Number(hasBField(b.type)) - Number(hasBField(a.type)));
    return list;
  }
  const list = doc.circuit.components
    .filter((c) => (kind === 'emitter' ? isCircuitEmitter(c.type) : kind === 'detector' ? isCircuitDetector(c.type) : c.type !== 'misc.ground'))
    .map((c) => ({ id: c.id, type: c.type, label: c.name || circuitDef(c.type)?.label || c.type }));
  if (kind === 'actuator') list.sort((a, b) => Number(b.type === 'opto.coil') - Number(a.type === 'opto.coil'));
  return list;
}

function numericProps(opticsType: string): { key: string; label: string; unit?: string }[] {
  const def = opticsDef(opticsType);
  return (def?.params ?? []).filter((p) => p.kind === 'number' || p.kind === 'wavelength').map((p) => ({ key: p.key, label: p.label, unit: p.unit }));
}

function hasBField(opticsType: string): boolean {
  return numericProps(opticsType).some((p) => p.key === 'bField');
}

function defaultTargetProp(opticsType: string): string {
  const props = numericProps(opticsType);
  return props.find((p) => p.key === 'bField')?.key ?? props[0]?.key ?? '';
}

export function LinksSection({ domain, id }: { domain: Domain; id: string }): React.JSX.Element | null {
  const doc = useApp((s) => s.doc);
  const self = useMemo(() => {
    if (!doc) return null;
    return domain === 'optics' ? doc.optics.components.find((c) => c.id === id) : doc.circuit.components.find((c) => c.id === id);
  }, [doc, domain, id]);
  const [kind, setKind] = useState<Kind>(() => inferKind(domain, self?.type ?? ''));
  const [target, setTarget] = useState('');
  const [targetProp, setTargetProp] = useState('');
  const [gain, setGain] = useState(1);
  const [offset, setOffset] = useState(0);
  if (!doc || !self) return null;

  const mine = doc.links.filter((l) => (domain === 'optics' ? l.opticsId === id : l.circuitId === id));
  const cands = candidates(doc, domain, kind);
  const tgt = cands.find((c) => c.id === target) ?? cands[0];
  const opticsType = domain === 'optics' ? self.type : tgt?.type ?? '';
  const props = kind === 'actuator' ? numericProps(opticsType) : [];
  const tProp = props.some((p) => p.key === targetProp) ? targetProp : defaultTargetProp(opticsType);

  const nameOf = (l: OptoLink): string => {
    if (domain === 'optics') {
      const c = doc.circuit.components.find((x) => x.id === l.circuitId);
      return c?.name || circuitDef(c?.type ?? '')?.label || l.circuitId;
    }
    const c = doc.optics.components.find((x) => x.id === l.opticsId);
    return c?.name || opticsDef(c?.type ?? '')?.label || l.opticsId;
  };

  const update = (lid: string, patch: Partial<OptoLink>): void => {
    const s = useApp.getState();
    if (!s.doc) return;
    s.setLinks(s.doc.links.map((l) => (l.id === lid ? { ...l, ...patch } : l)), 'Edit Link');
  };
  const remove = (lid: string): void => {
    const s = useApp.getState();
    if (!s.doc) return;
    s.setLinks(s.doc.links.filter((l) => l.id !== lid), 'Remove Link');
  };
  const add = (): void => {
    const s = useApp.getState();
    if (!s.doc || !tgt) return;
    const circuitId = domain === 'circuit' ? id : tgt.id;
    const opticsId = domain === 'optics' ? id : tgt.id;
    // identical link already present (same pair, kind and driven prop): nothing to add
    if (s.doc.links.some((l) => l.kind === kind && l.circuitId === circuitId && l.opticsId === opticsId && (kind !== 'actuator' || l.targetProp === tProp))) return;
    const mk = makeIdFactory(s.doc.links.map((l) => l.id));
    const link: OptoLink = {
      id: mk('link'),
      kind,
      circuitId,
      opticsId
    };
    if (kind === 'actuator') {
      if (!tProp) return;
      link.targetProp = tProp;
      link.gain = gain;
      link.offset = offset;
    }
    s.setLinks([...s.doc.links, link], 'Add Link');
    setTarget('');
  };

  return (
    <Section title={`Links${mine.length ? ` (${mine.length})` : ''}`} defaultOpen={mine.length > 0 || domain === 'circuit'}>
      {mine.map((l) => {
        const lprops = l.kind === 'actuator' ? numericProps(doc.optics.components.find((c) => c.id === l.opticsId)?.type ?? '') : [];
        return (
          <div key={l.id} className="link-card">
            <div className="link-card-head">
              <Link2 size={14} strokeWidth={1.5} />
              <span className={`link-kind ${l.kind}`}>{l.kind}</span>
              <span className="link-target" title={domain === 'optics' ? l.circuitId : l.opticsId}>{nameOf(l)}</span>
              <button type="button" className="icon-btn" aria-label="Remove link" title="Remove link" onClick={() => remove(l.id)}><X size={14} strokeWidth={1.5} /></button>
            </div>
            {l.kind === 'actuator' && (
              <div className="link-card-body">
                <Row label="Target">
                  <select className="sel" value={l.targetProp ?? ''} onChange={(e) => update(l.id, { targetProp: e.target.value })}>
                    {lprops.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ''}</option>)}
                    {!lprops.some((p) => p.key === l.targetProp) && <option value={l.targetProp ?? ''}>{l.targetProp}</option>}
                  </select>
                </Row>
                <Row label="Gain" help="prop = gain × quantity + offset"><NumberInput value={l.gain ?? 1} siDisplay={false} onCommit={(g) => update(l.id, { gain: g })} /></Row>
                <Row label="Offset"><NumberInput value={l.offset ?? 0} siDisplay={false} onCommit={(o) => update(l.id, { offset: o })} /></Row>
              </div>
            )}
          </div>
        );
      })}
      <div className="link-new">
        <Row label="Kind" help={KINDS.find((k) => k.id === kind)?.help}>
          <div className="seg">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className={kind === k.id ? 'on' : ''} title={k.help} onClick={() => { setKind(k.id); setTarget(''); }}>{k.label}</button>
            ))}
          </div>
        </Row>
        <Row label={domain === 'optics' ? 'Circuit part' : 'Optical part'}>
          <select className="sel" value={tgt?.id ?? ''} disabled={!cands.length} onChange={(e) => setTarget(e.target.value)}>
            {!cands.length && <option value="">No compatible components</option>}
            {cands.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.id}</option>)}
          </select>
        </Row>
        {kind === 'actuator' && (
          <>
            <Row label="Drives">
              <select className="sel" value={tProp} disabled={!props.length} onChange={(e) => setTargetProp(e.target.value)}>
                {!props.length && <option value="">No numeric parameters</option>}
                {props.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ''}</option>)}
              </select>
            </Row>
            <Row label="Gain" help="prop = gain × (current for coils/inductors, otherwise voltage) + offset"><NumberInput value={gain} siDisplay={false} onCommit={setGain} /></Row>
            <Row label="Offset"><NumberInput value={offset} siDisplay={false} onCommit={setOffset} /></Row>
          </>
        )}
        <button type="button" className="btn primary full" disabled={!tgt || (kind === 'actuator' && !tProp)} onClick={add}>
          <Plus size={14} strokeWidth={1.5} /> Add {kind} link
        </button>
      </div>
    </Section>
  );
}
