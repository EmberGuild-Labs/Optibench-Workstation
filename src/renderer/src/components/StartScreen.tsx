import { useEffect, useState } from 'react';
import { APP_VERSION } from '@core/types';
import type { ExampleEntry, RecentEntry } from '../../../preload/ipc';
import * as cmd from '../commands';
import { useApp } from '../store/app';
import { AppLogo } from './Glyphs';
import { DialogFrame } from './Dialog';

function baseName(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).replace(/\.obw$/i, '');
}

/** Classic list box: single selection, Enter / double-click opens. */
function ListBox<T>({ items, render, title, empty, onOpen, label, onSelect }: {
  items: T[]; render(t: T): React.ReactNode; title(t: T): string; empty: string; onOpen(t: T): void; label: string; onSelect?(t: T): void;
}): React.JSX.Element {
  const [sel, setSelRaw] = useState(0);
  const setSel = (i: number): void => { setSelRaw(i); if (items[i]) onSelect?.(items[i]); };
  const cur = Math.min(sel, items.length - 1);
  return (
    <div
      className="listbox field"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={items.length ? `${label}-${cur}` : undefined}
      onKeyDown={(e) => {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(items.length - 1, cur + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, cur - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); onOpen(items[cur]); }
      }}
    >
      {items.length === 0 && <div className="listbox-empty">{empty}</div>}
      {items.map((it, i) => (
        <div
          key={i}
          id={`${label}-${i}`}
          role="option"
          aria-selected={i === cur}
          className={`listbox-item${i === cur ? ' selected' : ''}`}
          title={title(it)}
          onMouseDown={() => setSel(i)}
          onDoubleClick={() => onOpen(it)}
        >
          {render(it)}
        </div>
      ))}
    </div>
  );
}

export function StartScreen(): React.JSX.Element {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [examples, setExamples] = useState<ExampleEntry[]>([]);
  const [selRecent, setSelRecent] = useState<RecentEntry | null>(null);

  const refresh = (): void => {
    const a = window.optibench;
    if (!a) return;
    void a.getRecent().then(setRecent).catch(() => undefined);
    void a.listExamples().then(setExamples).catch(() => undefined);
  };
  useEffect(refresh, []);

  const openRecent = (r: RecentEntry): void => { if (r.exists) void cmd.openPath(r.path); };

  return (
    <div className="start">
      <DialogFrame
        title="Welcome to Optibench Workstation"
        className="start-dialog"
        onHelp={() => useApp.getState().setUi({ modal: 'shortcuts' })}
        footer={
          <>
            <span className="dim start-ver">Version {APP_VERSION}</span>
            <span className="flex1" />
            <button type="button" className="btn" onClick={() => useApp.getState().setUi({ modal: 'about' })}><u>A</u>bout…</button>
            <button type="button" className="btn" onClick={() => void cmd.quitApp()}>E<u>x</u>it</button>
          </>
        }
      >
        <div className="start-banner">
          <AppLogo size={48} />
          <div>
            <div className="start-wordmark">Optibench <b>Workstation</b></div>
            <div className="dim">Optical bench &amp; circuit co-simulation</div>
          </div>
        </div>
        <div className="start-body">
          <div className="start-actions">
            <button type="button" className="btn default wide-btn" onClick={() => void cmd.newProject()}><u>N</u>ew Project</button>
            <button type="button" className="btn wide-btn" onClick={() => void cmd.openProject()}><u>O</u>pen…</button>
            <p className="dim">Ctrl+N creates an empty bench. Ctrl+O opens an existing <b>.obw</b> project. Press Ctrl+/ for keyboard shortcuts.</p>
          </div>
          <div className="start-lists">
            <fieldset className="group-box static">
              <legend><span>Recent files</span></legend>
              <ListBox<RecentEntry>
                label="recent"
                items={recent}
                empty="(no recent projects)"
                title={(r) => r.path}
                onOpen={openRecent}
                onSelect={(r) => setSelRecent(r)}
                render={(r) => (
                  <span className={r.exists ? '' : 'missing'}>
                    {baseName(r.path)} <span className="lb-path">{r.exists ? r.path : '(file not found)'}</span>
                  </span>
                )}
              />
              <div className="row-right">
                <button type="button" className="btn" disabled={!recent.length} onClick={() => openRecent(selRecent ?? recent[0])}>Open</button>
                <button type="button" className="btn" disabled={!recent.length}
                  onClick={() => { const r = selRecent ?? recent[0]; if (r) void window.optibench.removeRecent(r.path).then(refresh); }}>Remove</button>
              </div>
            </fieldset>
            <fieldset className="group-box static">
              <legend><span>Example projects</span></legend>
              <ListBox<ExampleEntry>
                label="examples"
                items={examples}
                empty="(no example projects found)"
                title={(ex) => ex.description || ex.file}
                onOpen={(ex) => void cmd.openPath(ex.path, true)}
                render={(ex) => <span>{ex.title} <span className="lb-path">{ex.description}</span></span>}
              />
            </fieldset>
          </div>
        </div>
      </DialogFrame>
    </div>
  );
}
