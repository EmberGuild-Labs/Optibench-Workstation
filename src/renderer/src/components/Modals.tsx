import { useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION, FORMAT_VERSION } from '@core/types';
import type { AppInfo } from '../../../preload/ipc';
import { useApp } from '../store/app';
import { SHORTCUT_GROUPS } from '../shortcuts';
import { AppLogo } from './Glyphs';
import { ModalDialog } from './Dialog';
import { SweepDialog } from './sweep/SweepDialog';
import { LibraryDialog } from './LibraryDialog';
import { useLibrary } from '../library/store';

function OkButton({ onClick }: { onClick(): void }): React.JSX.Element {
  return <button type="button" className="btn default" onClick={onClick}><u>O</u>K</button>;
}

function About({ onClose }: { onClose(): void }): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => { void window.optibench?.appInfo().then(setInfo).catch(() => undefined); }, []);
  return (
    <ModalDialog title={`About ${APP_NAME}`} onClose={onClose} footer={<OkButton onClick={onClose} />}>
      <div className="about">
        <AppLogo size={48} />
        <div className="about-text">
          <div className="about-name">{APP_NAME}</div>
          <div>Version {info?.version ?? APP_VERSION}</div>
          <p>Optical bench and electronic circuit co-simulation. 2D ray tracing with dispersion,
            polarization and magneto-optics, coupled to a transient circuit solver through opto-links.</p>
          <fieldset className="group-box static">
            <legend><span>System information</span></legend>
            <table className="about-table">
              <tbody>
                <tr><td>Project format:</td><td>.obw version {FORMAT_VERSION}</td></tr>
                {info && <tr><td>Electron:</td><td>{info.electron}</td></tr>}
                {info && <tr><td>Chromium:</td><td>{info.chrome}</td></tr>}
                {info && <tr><td>Node:</td><td>{info.node}</td></tr>}
                {info && <tr><td>Platform:</td><td>{info.platform}</td></tr>}
              </tbody>
            </table>
          </fieldset>
          <p className="dim">Beta software. © Optibench.</p>
        </div>
      </div>
    </ModalDialog>
  );
}

function Shortcuts({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <ModalDialog title="Keyboard Shortcuts" onClose={onClose} wide footer={<OkButton onClick={onClose} />}>
      <div className="shortcut-grid">
        {SHORTCUT_GROUPS.map((g) => (
          <fieldset key={g.title} className="group-box static">
            <legend><span>{g.title}</span></legend>
            <table className="shortcut-table">
              <tbody>
                {g.items.map(([k, d]) => (
                  <tr key={k}><td>{d}</td><td className="keys">{k}</td></tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        ))}
      </div>
    </ModalDialog>
  );
}

export function Modals(): React.JSX.Element | null {
  const modal = useApp((s) => s.ui.modal);
  const close = (): void => useApp.getState().setUi({ modal: null });
  if (modal === 'about') return <About onClose={close} />;
  if (modal === 'shortcuts') return <Shortcuts onClose={close} />;
  if (modal === 'sweep') return <SweepDialog onClose={close} />;
  if (modal === 'library') return <LibraryDialog onClose={() => useLibrary.getState().openDialog(null)} />;
  return null;
}
