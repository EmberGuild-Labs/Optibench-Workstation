import { useId, type ReactNode } from 'react';
import { Lock, Trash2, Copy as DupIcon, RotateCw } from 'lucide-react';
import type { CircuitComponent, ComponentDef, OpticalComponent, OptoLink, ParamDef, ParamValue } from '@core/types';
import { circuitDef, opticsDef, opticsEngine, wavelengthRGB } from '../../engines';
import { useApp, type Domain } from '../../store/app';
import { DEG2RAD, RAD2DEG, formatSI } from '../../lib/units';
import { useSim } from '../../store/sim';
import { NumberInput, ParamField, Row, Section, SpectrumRangeField, TextInput, Toggle } from './fields';
import { LinksSection } from './Links';
import { placeCircuitComponent } from '../../circuitEdit';
import { TypeGlyph } from '../Glyphs';
import { POSE_FIELDS, hasOffPlanePose, poseValues, withPose } from '../../lib/pose3d';
import { gaussianBeamProfile, laserCavityOutput } from '@core/optics';
import { GAUSSIAN_TYPES } from '../../viewports/optics/gaussian';

const NO_LINKS: OptoLink[] = [];

function groupParams(params: ParamDef[]): [string, ParamDef[]][] {
  const m = new Map<string, ParamDef[]>();
  for (const p of params) {
    const g = p.group || 'Parameters';
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(p);
  }
  return [...m.entries()];
}

function updateOptics(id: string, patch: Partial<OpticalComponent>, commit: boolean, label: string): void {
  const s = useApp.getState();
  if (!s.doc) return;
  const optics = s.doc.optics;
  s.setOpticsScene({ ...optics, components: optics.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, commit, label);
}

/** Placement edits keep attached wires connected (same rubber-banding as dragging in the viewport). */
function placeCircuit(id: string, patch: { position?: { x: number; y: number }; rotation?: 0 | 1 | 2 | 3; mirrored?: boolean }, label: string): void {
  const s = useApp.getState();
  if (!s.doc) return;
  const next = placeCircuitComponent(s.doc.circuit, id, patch);
  if (next !== s.doc.circuit) s.setCircuitScene(next, true, label);
}

function updateCircuit(id: string, patch: Partial<CircuitComponent>, commit: boolean, label: string): void {
  const s = useApp.getState();
  if (!s.doc) return;
  const circuit = s.doc.circuit;
  s.setCircuitScene({ ...circuit, components: circuit.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, commit, label);
}

function Header({ def, type, domain, name, id, onRename, locked, onLock, badge }: {
  def?: ComponentDef; type: string; domain: Domain; name?: string; id: string; onRename(n: string): void;
  locked?: boolean; onLock?(): void; badge?: ReactNode;
}): React.JSX.Element {
  const s = useApp.getState;
  return (
    <div className="insp-header">
      <div className="insp-title-row">
        <span className={`insp-glyph ${domain}`}><TypeGlyph type={type} /></span>
        <div className="insp-title-text">
          <TextInput value={name ?? ''} placeholder={def?.label ?? type} onCommit={onRename} />
          <div className="insp-subtitle"><span>{def?.label ?? 'Unknown component'}{badge}</span><span className="mono dim">{id}</span></div>
        </div>
      </div>
      <div className="insp-actions">
        <button type="button" className="mini-btn" title="Rotate (R)" onClick={() => s().rotateSelection(1)}><RotateCw size={14} strokeWidth={1.5} /></button>
        <button type="button" className="mini-btn" title="Duplicate (Ctrl+D)" onClick={() => s().duplicate()}><DupIcon size={14} strokeWidth={1.5} /></button>
        {onLock && <button type="button" className={`mini-btn${locked ? ' on' : ''}`} title={locked ? 'Unlock' : 'Lock'} onClick={onLock}><Lock size={14} strokeWidth={1.5} /></button>}
        <button type="button" className="mini-btn danger" title="Delete (Del)" onClick={() => s().deleteSelection()}><Trash2 size={14} strokeWidth={1.5} /></button>
      </div>
      {def?.description && <p className="insp-desc">{def.description}</p>}
      {!def && <p className="insp-desc warn">Type “{type}” is not in the engine registry. It is kept in the file but cannot be simulated.</p>}
    </div>
  );
}

const BAND_KEYS = ['wavelengthMin', 'wavelengthMax'] as const;

function ParamSections({ def, props, onChange, onChangeMany, overrides }: {
  def?: ComponentDef; props: Record<string, ParamValue>; onChange(key: string, v: ParamValue, commit: boolean, label: string): void;
  /** Several props in one edit (one undo step), e.g. a wavelength band. */
  onChangeMany?(patch: Record<string, ParamValue>, commit: boolean, label: string): void;
  overrides?: Set<string>;
}): React.JSX.Element | null {
  if (!def || !def.params.length) return null;
  // a wavelengthMin / wavelengthMax pair is edited as ONE spectral band control
  const pMin = def.params.find((p) => p.key === BAND_KEYS[0]);
  const pMax = def.params.find((p) => p.key === BAND_KEYS[1]);
  const band = pMin && pMax && onChangeMany ? { pMin, pMax } : null;
  return (
    <>
      {groupParams(def.params).map(([g, ps]) => (
        <Section key={g} title={g}>
          {ps.map((p) => {
            if (band && p.key === BAND_KEYS[1]) return null;
            if (band && p.key === BAND_KEYS[0]) {
              const lo = Number(props[BAND_KEYS[0]] ?? band.pMin.default), hi = Number(props[BAND_KEYS[1]] ?? band.pMax.default);
              return (
                <BandRow key="band" label={/detector/.test(def.type) ? 'Spectral range' : 'Spectral band'}
                  help={`${band.pMin.help ?? ''} ${band.pMax.help ?? ''}`.trim() || undefined}
                  lo={lo} hi={hi}
                  min={Math.min(band.pMin.min ?? 200, band.pMax.min ?? 200)} max={Math.max(band.pMin.max ?? 2000, band.pMax.max ?? 2000)}
                  overridden={overrides?.has(BAND_KEYS[0]) || overrides?.has(BAND_KEYS[1])}
                  onChange={([a, b], commit) => onChangeMany!({ [BAND_KEYS[0]]: a, [BAND_KEYS[1]]: b }, commit, 'Change Spectral Band')} />
              );
            }
            return (
              <ParamField
                key={p.key}
                param={p}
                value={props[p.key]}
                rgb={wavelengthRGB}
                overridden={overrides?.has(p.key)}
                onChange={(v, commit) => onChange(p.key, v, commit, `Change ${p.label}`)}
              />
            );
          })}
        </Section>
      ))}
    </>
  );
}

function BandRow({ label, help, lo, hi, min, max, overridden, onChange }: {
  label: string; help?: string; lo: number; hi: number; min: number; max: number; overridden?: boolean;
  onChange(v: [number, number], commit: boolean): void;
}): React.JSX.Element {
  const id = useId();
  return (
    <Row label={label} help={help} htmlFor={id} wide>
      {overridden && <span className="override-badge" title="Driven by an opto-link at runtime">LINKED</span>}
      <SpectrumRangeField id={id} lo={lo} hi={hi} min={min} max={max} rgb={wavelengthRGB} onChange={onChange} />
    </Row>
  );
}

function fmtLen(mm: number): string {
  if (!Number.isFinite(mm)) return '∞';
  if (mm === 0) return '0 mm';
  const a = Math.abs(mm);
  if (a >= 1000) return `${(mm / 1000).toPrecision(4)} m`;
  if (a >= 1) return `${mm.toPrecision(4)} mm`;
  return `${(mm * 1000).toPrecision(4)} µm`;
}

/** Read-only Gaussian beam parameters of a laser (optics engine gaussianBeamProfile). */
function GaussianInfo({ c }: { c: OpticalComponent }): React.JSX.Element | null {
  if (!GAUSSIAN_TYPES.has(c.type)) return null;
  let gb: { waistPos: number; w0: number; zR: number; theta: number } | null = null;
  let cav: { power: number; threshold: number; slope: number } | null = null;
  try { gb = gaussianBeamProfile(c); } catch { gb = null; }
  if (c.type === 'source.laser_cavity') { try { cav = laserCavityOutput(c); } catch { cav = null; } }
  if (!gb) return null;
  const rows: [string, string, string][] = [
    ['Waist radius w0', fmtLen(gb.w0), '1/e² intensity radius at the beam waist'],
    ['Waist position', fmtLen(gb.waistPos), 'Along the beam axis from the exit aperture (negative = virtual waist inside the laser)'],
    ['Rayleigh range z_R', fmtLen(gb.zR), 'Distance over which the beam area doubles: z_R = π w0² / (M² λ)'],
    ['Divergence θ', `${(gb.theta * 1e3).toPrecision(4)} mrad`, 'Far-field half-angle θ = M² λ / (π w0)']
  ];
  if (cav) {
    rows.push(['Output power', formatSI(cav.power, 'W'), 'Steady-state cavity output'], ['Threshold', formatSI(cav.threshold, 'W'), 'Pump threshold'], ['Slope efficiency', `${(cav.slope * 100).toPrecision(3)} %`, 'dP_out / dP_pump above threshold']);
  }
  return (
    <Section title="Gaussian Beam (derived)">
      <div className="insp-derived">
        {rows.map(([k, v, h]) => [<span key={`${k}k`} className="k" title={h}>{k}</span>, <span key={`${k}v`} className="v">{v}</span>])}
      </div>
    </Section>
  );
}

/** 3D pose (z / pitch / roll) of an optical component; shown while the 3D bench is active. */
function PoseSection({ c }: { c: OpticalComponent }): React.JSX.Element {
  const p = poseValues(c);
  return (
    <Section title="3D Pose">
      {POSE_FIELDS.map((f) => (
        <Row key={f.key} label={f.label} help={f.help}>
          <NumberInput value={Number(p[f.key].toFixed(6))} unit={f.unit} siDisplay={false} step={f.key === 'z' ? 1 : 0.5}
            onCommit={(v) => {
              const s = useApp.getState();
              if (!s.doc) return;
              const optics = s.doc.optics;
              s.setOpticsScene({ ...optics, components: optics.components.map((x) => (x.id === c.id ? withPose(x, f.key, v) : x)) }, true, f.key === 'z' ? 'Move Z' : `Change ${f.label}`);
            }} />
        </Row>
      ))}
      <Row label="Yaw" help="Rotation about the vertical axis (the 2D rotation, counter-clockwise from above)">
        <span className="mono dim small">{(-c.rotation * RAD2DEG).toFixed(3)} °</span>
      </Row>
    </Section>
  );
}

function OpticsInspector({ c }: { c: OpticalComponent }): React.JSX.Element {
  const def = opticsDef(c.type);
  const dim = useApp((s) => s.opticsDim);
  const offPlane = hasOffPlanePose(c);
  const links = useApp((s) => s.doc?.links ?? NO_LINKS);
  const overrides = new Set(links.filter((l) => l.opticsId === c.id && l.kind === 'actuator' && l.targetProp).map((l) => l.targetProp!));
  const pid = useId();
  return (
    <>
      <Header
        def={def} type={c.type} domain="optics" name={c.name} id={c.id}
        onRename={(n) => updateOptics(c.id, { name: n || undefined }, true, 'Rename')}
        locked={c.locked}
        onLock={() => updateOptics(c.id, { locked: !c.locked || undefined }, true, c.locked ? 'Unlock' : 'Lock')}
        badge={offPlane ? <span className="insp-badge-3d" title="This component has a 3D pose (height / tilt); the 2D bench shows its z = 0 projection">3D</span> : undefined}
      />
      <Section title="Transform">
        {dim === '2d' && offPlane && (
          <div className="insp-note">3D pose: z {fmtLen(poseValues(c).z)}, pitch {poseValues(c).pitch.toFixed(2)}°, roll {poseValues(c).roll.toFixed(2)}°. The 2D bench shows the z = 0 projection; switch to 3D (Ctrl+3) to edit it.</div>
        )}
        <Row label="Position" htmlFor={pid}>
          <div className="xy">
            <span className="axis">X</span>
            <NumberInput id={pid} value={c.position.x} unit="mm" siDisplay={false} onCommit={(x) => updateOptics(c.id, { position: { ...c.position, x } }, true, 'Move')} />
            <span className="axis">Y</span>
            <NumberInput value={c.position.y} unit="mm" siDisplay={false} onCommit={(y) => updateOptics(c.id, { position: { ...c.position, y } }, true, 'Move')} />
          </div>
        </Row>
        <Row label="Rotation" help="Clockwise on screen">
          <NumberInput value={Number((c.rotation * RAD2DEG).toFixed(4))} unit="°" siDisplay={false} step={1}
            onCommit={(d) => updateOptics(c.id, { rotation: d * DEG2RAD }, true, 'Rotate')} />
        </Row>
      </Section>
      {dim === '3d' && <PoseSection c={c} />}
      <ParamSections
        def={def}
        props={c.props}
        overrides={overrides}
        onChange={(k, v, commit, label) => updateOptics(c.id, { props: { ...c.props, [k]: v } }, commit, label)}
        onChangeMany={(patch, commit, label) => updateOptics(c.id, { props: { ...c.props, ...patch } }, commit, label)}
      />
      <GaussianInfo c={c} />
      <LinksSection domain="optics" id={c.id} />
    </>
  );
}

const ROTATIONS = [0, 1, 2, 3] as const;

function CircuitInspector({ c }: { c: CircuitComponent }): React.JSX.Element {
  const def = circuitDef(c.type);
  const pid = useId();
  const isOpto = /^opto\./.test(c.type) || c.type === 'semi.led' || /^passive\.inductor/.test(c.type);
  return (
    <>
      <Header def={def} type={c.type} domain="circuit" name={c.name} id={c.id} onRename={(n) => updateCircuit(c.id, { name: n || undefined }, true, 'Rename')} />
      <Section title="Placement">
        <Row label="Position" htmlFor={pid}>
          <div className="xy">
            <span className="axis">X</span>
            <NumberInput id={pid} value={c.position.x} integer siDisplay={false} onCommit={(x) => placeCircuit(c.id, { position: { ...c.position, x } }, 'Move')} />
            <span className="axis">Y</span>
            <NumberInput value={c.position.y} integer siDisplay={false} onCommit={(y) => placeCircuit(c.id, { position: { ...c.position, y } }, 'Move')} />
          </div>
        </Row>
        <Row label="Rotation">
          <div className="seg">
            {ROTATIONS.map((r) => (
              <button key={r} type="button" className={c.rotation === r ? 'on' : ''} onClick={() => placeCircuit(c.id, { rotation: r }, 'Rotate')}>
                {r * 90}°
              </button>
            ))}
          </div>
        </Row>
        <Row label="Mirrored">
          <Toggle value={!!c.mirrored} onChange={(m) => placeCircuit(c.id, { mirrored: m }, 'Mirror')} />
        </Row>
      </Section>
      <ParamSections def={def} props={c.props}
        onChange={(k, v, commit, label) => updateCircuit(c.id, { props: { ...c.props, [k]: v } }, commit, label)}
        onChangeMany={(patch, commit, label) => updateCircuit(c.id, { props: { ...c.props, ...patch } }, commit, label)} />
      <LiveReadout id={c.id} />
      {isOpto && <LinksSection domain="circuit" id={c.id} />}
    </>
  );
}

function LiveReadout({ id }: { id: string }): React.JSX.Element | null {
  const st = useSim((s) => s.circuit?.components[id]);
  if (!st) return null;
  const rows: [string, string][] = [];
  if (typeof st.voltage === 'number') rows.push(['Voltage', formatSI(st.voltage, 'V')]);
  if (typeof st.current === 'number') rows.push(['Current', formatSI(st.current, 'A')]);
  if (typeof st.power === 'number') rows.push(['Power', formatSI(st.power, 'W')]);
  if (typeof st.brightness === 'number') rows.push(['Brightness', `${(st.brightness * 100).toFixed(0)} %`]);
  if (typeof st.on === 'boolean') rows.push(['State', st.on ? 'ON' : 'OFF']);
  if (typeof st.opticalPower === 'number') rows.push(['Optical power', formatSI(st.opticalPower, 'W')]);
  if (typeof st.text === 'string') rows.push(['Readout', st.text]);
  if (!rows.length) return null;
  return (
    <Section title="Live">
      <div className="live-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="live-cell"><span className="dim">{k}</span><span className="mono">{v}</span></div>
        ))}
      </div>
    </Section>
  );
}

function WireInspector({ id }: { id: string }): React.JSX.Element | null {
  const w = useApp((s) => s.doc?.circuit.wires.find((x) => x.id === id));
  if (!w) return null;
  const update = (patch: Partial<typeof w>): void => {
    const s = useApp.getState();
    if (!s.doc) return;
    const circuit = s.doc.circuit;
    s.setCircuitScene({ ...circuit, wires: circuit.wires.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, true, 'Edit Wire');
  };
  return (
    <>
      <div className="insp-header">
        <div className="insp-title-row">
          <span className="insp-glyph circuit"><TypeGlyph type="wire" /></span>
          <div className="insp-title-text"><b>Wire</b><div className="insp-subtitle"><span>{w.points.length} points</span><span className="mono dim">{w.id}</span></div></div>
        </div>
        <div className="insp-actions">
          <button type="button" className="mini-btn danger" title="Delete (Del)" onClick={() => useApp.getState().deleteSelection()}><Trash2 size={14} strokeWidth={1.5} /></button>
        </div>
      </div>
      <Section title="Cable">
        <Row label="Net label"><TextInput value={w.label ?? ''} placeholder="(none)" onCommit={(t) => update({ label: t || undefined })} /></Row>
        <Row label="Colour">
          <div className="swatches">
            {['#e5484d', '#f5a524', '#f7d64a', '#46c46b', '#3aa0ff', '#a274f7', '#e5e7eb', '#1f2330'].map((col) => (
              <button key={col} type="button" className={`swatch${w.color === col ? ' on' : ''}`} style={{ background: col }} aria-label={col} onClick={() => update({ color: w.color === col ? undefined : col })} />
            ))}
          </div>
        </Row>
      </Section>
    </>
  );
}

function MultiInspector({ domain, count }: { domain: Domain; count: number }): React.JSX.Element {
  const s = useApp.getState;
  return (
    <div className="insp-multi">
      <div className="multi-count mono">{count}</div>
      <div>{domain === 'optics' ? 'optical components' : 'circuit items'} selected</div>
      <div className="insp-actions center">
        <button type="button" className="btn" onClick={() => s().rotateSelection(1)}><RotateCw size={14} strokeWidth={1.5} /> Rotate</button>
        <button type="button" className="btn" onClick={() => s().duplicate()}><DupIcon size={14} strokeWidth={1.5} /> Duplicate</button>
        <button type="button" className="btn danger" onClick={() => s().deleteSelection()}><Trash2 size={14} strokeWidth={1.5} /> Delete</button>
      </div>
    </div>
  );
}

function DocumentSettings(): React.JSX.Element | null {
  const doc = useApp((s) => s.doc);
  const timeScale = useApp((st) => st.timeScale);
  if (!doc) return null;
  const s = useApp.getState;
  const os = doc.optics.settings;
  const cs = doc.circuit.settings;
  const setOS = (patch: Partial<typeof os>, label = 'Optics Settings'): void =>
    s().setOpticsScene({ ...s().doc!.optics, settings: { ...s().doc!.optics.settings, ...patch } }, true, label);
  const setCS = (patch: Partial<typeof cs>, label = 'Circuit Settings'): void =>
    s().setCircuitScene({ ...s().doc!.circuit, settings: { ...s().doc!.circuit.settings, ...patch } }, true, label);
  let materials: { id: string; label: string }[] = [];
  try { materials = opticsEngine.materials; } catch { /* no engine */ }
  const num = (label: string, value: number, on: (v: number) => void, opts: { unit?: string; min?: number; max?: number; integer?: boolean; help?: string; si?: boolean } = {}): ReactNode => (
    <Row label={label} help={opts.help}>
      <NumberInput value={value} unit={opts.unit} min={opts.min} max={opts.max} integer={opts.integer} siDisplay={opts.si ?? true} onCommit={on} />
    </Row>
  );
  return (
    <>
      <div className="insp-header">
        <div className="insp-kicker">Project</div>
        <TextInput value={doc.meta.title} onCommit={(t) => s().setMeta({ title: t || 'Untitled Project' }, 'Rename Project')} />
      </div>
      <Section title="Project Info">
        <Row label="Author"><TextInput value={doc.meta.author ?? ''} placeholder="—" onCommit={(t) => s().setMeta({ author: t || undefined })} /></Row>
        <Row label="Description" wide><TextInput multiline value={doc.meta.description ?? ''} placeholder="What does this bench demonstrate?" onCommit={(t) => s().setMeta({ description: t || undefined })} /></Row>
        <Row label="Created"><span className="mono dim small">{new Date(doc.meta.created).toLocaleString()}</span></Row>
        <Row label="Contents"><span className="mono dim small">{doc.optics.components.length} optics · {doc.circuit.components.length} parts · {doc.links.length} links</span></Row>
      </Section>
      <Section title="Optics Settings">
        {num('Max bounces', os.maxBounces, (v) => setOS({ maxBounces: v }), { min: 1, max: 10000, integer: true, help: 'Maximum interactions per ray path', si: false })}
        {num('Rays / source', os.raysPerSource, (v) => setOS({ raysPerSource: v }), { min: 1, max: 100000, integer: true, help: 'Default ray budget per source (sources may override)', si: false })}
        {num('Min intensity', os.minIntensity, (v) => setOS({ minIntensity: v }), { min: 0, max: 1, help: 'Rays below this fraction of source power are dropped', si: false })}
        {num('Spectral samples', os.spectralSamples, (v) => setOS({ spectralSamples: v }), { min: 1, max: 1000, integer: true, help: 'Samples for broadband sources', si: false })}
        {num('Temperature', os.temperatureC, (v) => setOS({ temperatureC: v }), { unit: '°C', min: -273.15, max: 2000, si: false })}
        <Row label="Wave optics mode" help="Rays carry optical path length, phase and a Jones vector; detectors sum fields coherently (interference) and narrow apertures diffract. Slower.">
          <Toggle label="Wave optics mode" value={!!os.waveMode} onChange={(v) => setOS({ waveMode: v || undefined }, v ? 'Enable Wave Optics' : 'Disable Wave Optics')} />
        </Row>
        <Row label="Ambient medium">
          <select className="sel" value={os.ambientMedium} onChange={(e) => setOS({ ambientMedium: e.target.value })}>
            {!materials.some((m) => m.id === os.ambientMedium) && <option value={os.ambientMedium}>{os.ambientMedium}</option>}
            {materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Row>
      </Section>
      <Section title="Circuit Settings">
        {num('Timestep', cs.timestep, (v) => setCS({ timestep: v }), { unit: 's', min: 1e-12, max: 1, help: 'Maximum solver time step' })}
        {num('Time scale', timeScale, (v) => s().setTimeScale(v), { unit: 's/s', min: 1e-15, max: 1e3, help: 'Simulated seconds per real second (also on the toolbar; saved with the project)', si: false })}
        {num('Gmin', cs.gmin, (v) => setCS({ gmin: v }), { unit: 'S', min: 0, max: 1, help: 'Minimum conductance added for convergence' })}
      </Section>
      <LinksOverview />
      <p className="insp-hint">Select a component to edit its parameters. Drag from the palette or click an item and then click in the viewport to place it.</p>
    </>
  );
}

function LinksOverview(): React.JSX.Element | null {
  const doc = useApp((s) => s.doc);
  if (!doc) return null;
  const oName = (id: string): string => { const c = doc.optics.components.find((x) => x.id === id); return c?.name || opticsDef(c?.type ?? '')?.label || id; };
  const cName = (id: string): string => { const c = doc.circuit.components.find((x) => x.id === id); return c?.name || circuitDef(c?.type ?? '')?.label || id; };
  return (
    <Section title={`Opto-links (${doc.links.length})`} defaultOpen={doc.links.length > 0}>
      {doc.links.length === 0 && <div className="empty-hint">No links. Select an opto component (laser diode, photodiode, coil…) or an optical source/detector to connect the domains.</div>}
      {doc.links.map((l) => (
        <button key={l.id} type="button" className="link-row" onClick={() => useApp.getState().setSelection('circuit', [l.circuitId])}>
          <span className={`link-kind ${l.kind}`}>{l.kind}</span>
          <span className="link-ends">{cName(l.circuitId)} <span className="dim">{l.kind === 'detector' ? '←' : '→'}</span> {oName(l.opticsId)}{l.targetProp ? <span className="dim">.{l.targetProp}</span> : null}</span>
        </button>
      ))}
    </Section>
  );
}

export function Inspector(): React.JSX.Element {
  const domain = useApp((s) => (s.tab === 'split' ? s.activeDomain : s.tab));
  const sel = useApp((s) => s.selection[domain]);
  const comp = useApp((s) => {
    if (sel.length !== 1 || !s.doc) return null;
    return domain === 'optics'
      ? s.doc.optics.components.find((c) => c.id === sel[0]) ?? null
      : s.doc.circuit.components.find((c) => c.id === sel[0]) ?? null;
  });
  const isWire = useApp((s) => sel.length === 1 && !!s.doc?.circuit.wires.some((w) => w.id === sel[0]));

  let body: ReactNode;
  if (sel.length > 1) body = <MultiInspector domain={domain} count={sel.length} />;
  else if (comp && domain === 'optics') body = <OpticsInspector key={comp.id} c={comp as OpticalComponent} />;
  else if (comp && domain === 'circuit') body = <CircuitInspector key={comp.id} c={comp as CircuitComponent} />;
  else if (isWire) body = <WireInspector key={sel[0]} id={sel[0]} />;
  else body = <DocumentSettings />;

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="panel-head">
        <span className="panel-title">Inspector</span>
        <span className={`domain-pill ${domain}`}>{domain === 'optics' ? 'Optics' : 'Circuit'}</span>
      </div>
      <div className="panel-scroll">{body}</div>
    </aside>
  );
}
