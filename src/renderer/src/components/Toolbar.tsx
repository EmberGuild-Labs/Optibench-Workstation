import { useEffect, useState, type ReactNode } from 'react';
import {
  MousePointer2, Hand, Spline, Crosshair, Ruler, Play, Pause, StepForward, RotateCcw,
  ZoomIn, ZoomOut, Maximize, Grid3x3, Sparkles, Waves, Zap, Palette as PaletteIcon, Compass,
  PanelLeft, PanelRight, PanelBottom, Undo2, Redo2
} from 'lucide-react';
import * as cmd from '../commands';
import { toggleGrid } from '../menus';
import { useApp, type Tool } from '../store/app';

/** Typed time-scale field ("1 ns/s", "realtime", "1/1e9" …) with a preset drop-down. */
function TimeScaleField(): React.JSX.Element {
  const scale = useApp((s) => s.timeScale);
  const [text, setText] = useState(cmd.formatTimeScale(scale));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(cmd.formatTimeScale(scale)); setBad(false); }, [scale]);
  const commit = (): void => {
    if (text.trim() === cmd.formatTimeScale(scale)) return;
    if (cmd.setTimeScaleText(text)) setBad(false);
    else setBad(true);
  };
  const preset = cmd.TIME_SCALE_PRESETS.find((p) => Math.abs(p.value - scale) <= p.value * 1e-6);
  return (
    <label className="tb-select tb-timescale" title={'Time scale: simulated time per real second.\nType e.g. "1 ns/s", "100 ps/s", "1 µs/s", "1/1e9" or "realtime" and press Enter.\nAt slow scales the light is drawn as travelling pulses.'}>
      <span>Time scale</span>
      <input
        className={`field tb-ts-input mono${bad ? ' invalid' : ''}`}
        value={text}
        spellCheck={false}
        aria-label="Time scale"
        aria-invalid={bad}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setText(cmd.formatTimeScale(scale)); setBad(false); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <select className="tb-ts-presets" aria-label="Time scale presets" value={preset ? String(preset.value) : ''}
        onChange={(e) => { const v = Number(e.target.value); if (v > 0) cmd.setSimSpeed(v); }}>
        {!preset && <option value="">Custom</option>}
        {cmd.TIME_SCALE_PRESETS.map((p) => <option key={p.label} value={String(p.value)}>{p.label}</option>)}
      </select>
    </label>
  );
}

/** Classic two-button toggle "2D | 3D" for the optics bench. */
function DimToggle(): React.JSX.Element {
  const dim = useApp((s) => s.opticsDim);
  return (
    <div className="seg tb-dim" role="group" aria-label="Optics view dimension">
      <button type="button" className={dim === '2d' ? 'on' : ''} aria-pressed={dim === '2d'} title="2D optics bench (Ctrl+3 toggles)" onClick={() => cmd.setOpticsDim('2d')}>2D</button>
      <button type="button" className={dim === '3d' ? 'on' : ''} aria-pressed={dim === '3d'} title="3D optics bench (Ctrl+3 toggles). A 2D project is converted once (undoable)." onClick={() => cmd.setOpticsDim('3d')}>3D</button>
    </div>
  );
}

function TB({ icon, label, active, disabled, onClick, accent }: {
  icon: ReactNode; label: string; active?: boolean; disabled?: boolean; onClick(): void; accent?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}${accent ? ' accent' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

const Sep = (): React.JSX.Element => <div className="tb-sep" />;

export function Toolbar(): React.JSX.Element {
  const tool = useApp((s) => s.tool);
  const tab = useApp((s) => s.tab);
  const activeDomain = useApp((s) => s.activeDomain);
  const status = useApp((s) => s.sim.status);
  const timeScale = useApp((s) => s.timeScale);
  const od = useApp((s) => s.opticsDisplay);
  const cd = useApp((s) => s.circuitDisplay);
  const ui = useApp((s) => s.ui);
  const canUndo = useApp((s) => s.past.length > 0 || !!s.previewBase);
  const canRedo = useApp((s) => s.future.length > 0);
  const placeType = useApp((s) => s.placeType);
  const zoom = useApp((s) => s.views[s.tab === 'split' ? s.activeDomain : s.tab].zoom);
  const app = useApp.getState;
  const domain = tab === 'split' ? activeDomain : tab;
  const showCircuitTools = tab !== 'optics';
  const showOpticsTools = tab !== 'circuit';
  const setTool = (t: Tool): void => app().setTool(t);
  const running = status === 'running';

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="tb-group">
        <TB icon={<Undo2 size={16} strokeWidth={1.5} />} label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => app().undo()} />
        <TB icon={<Redo2 size={16} strokeWidth={1.5} />} label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => app().redo()} />
      </div>
      <Sep />
      <div className="tb-group">
        <TB icon={<MousePointer2 size={16} strokeWidth={1.5} />} label="Select (V)" active={tool === 'select'} onClick={() => setTool('select')} />
        <TB icon={<Hand size={16} strokeWidth={1.5} />} label="Pan (H, hold Space)" active={tool === 'pan'} onClick={() => setTool('pan')} />
        {showCircuitTools && <TB icon={<Spline size={16} strokeWidth={1.5} />} label="Wire (W) — circuit" active={tool === 'wire'} onClick={() => setTool('wire')} />}
        {showCircuitTools && <TB icon={<Crosshair size={16} strokeWidth={1.5} />} label="Probe (P) — circuit" active={tool === 'probe'} onClick={() => setTool('probe')} />}
        {showOpticsTools && <TB icon={<Ruler size={16} strokeWidth={1.5} />} label="Measure (M) — optics" active={tool === 'measure'} onClick={() => setTool('measure')} />}
        {tool === 'place' && placeType && (
          <span className="tb-chip" title="Click in the viewport to place. Esc, V or right-click to go back to the Select pointer.">
            Placing <b>{placeType}</b> <span className="tb-chip-hint">(Esc / right-click: done)</span>
          </span>
        )}
      </div>
      {showOpticsTools && (
        <>
          <Sep />
          <div className="tb-group"><DimToggle /></div>
        </>
      )}
      <Sep />
      <div className="tb-group sim-controls">
        <TB
          icon={running ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
          label={running ? 'Pause (F5)' : 'Run circuit simulation (F5)'}
          active={running}
          accent
          onClick={cmd.togglePlay}
        />
        <TB icon={<StepForward size={16} strokeWidth={1.5} />} label="Step (F6)" onClick={cmd.stepSim} />
        <TB icon={<RotateCcw size={16} strokeWidth={1.5} />} label="Reset (Shift+F5)" disabled={status === 'stopped'} onClick={cmd.resetSim} />
        <span className={`sim-state ${status}`}>{status === 'running' ? 'RUNNING' : status === 'paused' ? 'PAUSED' : 'EDIT'}</span>
      </div>
      <Sep />
      <div className="tb-group time-controls" role="group" aria-label="Time control">
        <button type="button" className={`btn tb-text${running && Math.abs(timeScale - 1) < 1e-9 ? ' on' : ''}`} title="Run in real time (time scale 1 s/s)" onClick={cmd.realtime}>Realtime</button>
        <button type="button" className={`btn tb-text${status === 'paused' ? ' on' : ''}`} title="Pause: freeze circuit and light (F5 resumes)" disabled={status !== 'running'} onClick={cmd.pauseSim}>Pause</button>
        <TimeScaleField />
      </div>
      <Sep />
      <div className="tb-group">
        <TB icon={<ZoomOut size={16} strokeWidth={1.5} />} label="Zoom out (Ctrl+-)" onClick={() => cmd.zoomBy(0.8)} />
        <button type="button" className="tb-zoom mono" title="Reset zoom (Ctrl+0)" onClick={cmd.zoomReset}>
          {domain === 'optics' ? `${(zoom * 50).toFixed(0)}%` : `${((zoom / 20) * 100).toFixed(0)}%`}
        </button>
        <TB icon={<ZoomIn size={16} strokeWidth={1.5} />} label="Zoom in (Ctrl+=)" onClick={() => cmd.zoomBy(1.25)} />
        <TB icon={<Maximize size={16} strokeWidth={1.5} />} label="Frame all (Shift+F)" onClick={cmd.frameAll} />
      </div>
      <Sep />
      <div className="tb-group">
        <TB icon={<Grid3x3 size={16} strokeWidth={1.5} />} label="Grid (G)" active={od.showGrid && cd.showGrid} onClick={toggleGrid} />
        {showOpticsTools && <TB icon={<Sparkles size={16} strokeWidth={1.5} />} label="Bloom" active={od.bloom} onClick={() => app().setOpticsDisplay({ bloom: !od.bloom })} />}
        {showOpticsTools && <TB icon={<Compass size={16} strokeWidth={1.5} />} label="Surface normals" active={od.showNormals} onClick={() => app().setOpticsDisplay({ showNormals: !od.showNormals })} />}
        {showOpticsTools && <TB icon={<Waves size={16} strokeWidth={1.5} />} label="Polarization" active={od.showPolarization} onClick={() => app().setOpticsDisplay({ showPolarization: !od.showPolarization })} />}
        {showOpticsTools && (
          <label className="tb-range" title="Ray exposure">
            <input
              type="range" min={0.05} max={1} step={0.01} value={od.rayOpacity}
              aria-label="Ray exposure"
              onChange={(e) => app().setOpticsDisplay({ rayOpacity: Number(e.target.value) })}
            />
          </label>
        )}
        {showCircuitTools && <TB icon={<Zap size={16} strokeWidth={1.5} />} label="Animate current" active={cd.animateCurrent} onClick={() => app().setCircuitDisplay({ animateCurrent: !cd.animateCurrent })} />}
        {showCircuitTools && <TB icon={<PaletteIcon size={16} strokeWidth={1.5} />} label="Colour wires by voltage" active={cd.colorByVoltage} onClick={() => app().setCircuitDisplay({ colorByVoltage: !cd.colorByVoltage })} />}
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <TB icon={<PanelLeft size={16} strokeWidth={1.5} />} label="Component palette (Ctrl+B)" active={ui.leftOpen} onClick={() => app().setUi({ leftOpen: !ui.leftOpen })} />
        <TB icon={<PanelBottom size={16} strokeWidth={1.5} />} label="Bottom dock (Ctrl+J)" active={ui.dockOpen} onClick={() => app().setUi({ dockOpen: !ui.dockOpen })} />
        <TB icon={<PanelRight size={16} strokeWidth={1.5} />} label="Inspector (Ctrl+I)" active={ui.rightOpen} onClick={() => app().setUi({ rightOpen: !ui.rightOpen })} />
      </div>
    </div>
  );
}
