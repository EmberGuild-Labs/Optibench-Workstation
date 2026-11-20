import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { Palette } from './components/Palette';
import { Inspector } from './components/inspector/Inspector';
import { Workspace } from './components/Workspace';
import { BottomDock } from './components/dock/BottomDock';
import { StatusBar } from './components/StatusBar';
import { StartScreen } from './components/StartScreen';
import { Modals } from './components/Modals';
import { Splitter } from './components/Splitter';
import { documentTitle, useApp } from './store/app';
import { simDriver } from './sim/driver';
import { installShortcuts } from './shortcuts';
import { confirmDiscard, loadText } from './commands';
import { useLibrary } from './library/store';

// Called once per renderer lifetime (StrictMode runs effects twice in dev).
let readyPromise: Promise<{ path: string; text: string } | null> | null = null;
let initialHandled = false;

function useAppEffects(): void {
  // keyboard + simulation driver
  useEffect(() => installShortcuts(), []);
  useEffect(() => { void useLibrary.getState().load(); }, []);
  useEffect(() => {
    simDriver.start();
    return () => simDriver.stop();
  }, []);

  // file association / single-instance / close guard
  useEffect(() => {
    const a = window.optibench;
    if (!a) return;
    readyPromise ??= a.rendererReady();
    void readyPromise.then((f) => {
      if (f && !initialHandled) { initialHandled = true; loadText(f.text, f.path); }
    });
    const offOpen = a.onFileOpened((f) => {
      void confirmDiscard().then((ok) => { if (ok) loadText(f.text, f.path); });
    });
    const offClose = a.onCloseRequested(() => {
      void confirmDiscard().then((ok) => { if (ok) void a.closeConfirmed(); });
    });
    return () => { offOpen(); offClose(); };
  }, []);

  // window title + dirty state
  useEffect(() => {
    const sync = (): void => {
      const s = useApp.getState();
      void window.optibench?.setTitle(s.doc ? documentTitle(s) : '', s.dirty && !!s.doc);
      void window.optibench?.setRepresentedFile(s.filePath);
    };
    sync();
    let prev = { doc: !!useApp.getState().doc, dirty: useApp.getState().dirty, path: useApp.getState().filePath, title: useApp.getState().doc?.meta.title };
    return useApp.subscribe((s) => {
      const next = { doc: !!s.doc, dirty: s.dirty, path: s.filePath, title: s.doc?.meta.title };
      if (next.doc !== prev.doc || next.dirty !== prev.dirty || next.path !== prev.path || next.title !== prev.title) {
        prev = next;
        sync();
      }
    });
  }, []);

  // surface uncaught errors in the console panel
  useEffect(() => {
    const onErr = (e: ErrorEvent): void => useApp.getState().log('error', 'app', e.message);
    const onRej = (e: PromiseRejectionEvent): void => useApp.getState().log('error', 'app', String((e.reason as Error)?.message ?? e.reason));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);

  // prevent the browser from navigating when a file is dropped outside a viewport
  useEffect(() => {
    const prevent = (e: DragEvent): void => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);
}

export function App(): React.JSX.Element {
  useAppEffects();
  const hasDoc = useApp((s) => !!s.doc);
  const ui = useApp((s) => s.ui);
  const setUi = useApp((s) => s.setUi);

  return (
    <div className="app">
      <TitleBar />
      {hasDoc ? (
        <>
          <Toolbar />
          <div className="main">
            {ui.leftOpen && (
              <>
                <div className="side left" style={{ width: ui.leftWidth }}><Palette /></div>
                <Splitter direction="horizontal" getValue={() => useApp.getState().ui.leftWidth} onChange={(v) => setUi({ leftWidth: Math.round(Math.max(190, Math.min(420, v))) })} />
              </>
            )}
            <div className="center">
              <Workspace />
              <BottomDock />
            </div>
            {ui.rightOpen && (
              <>
                <Splitter direction="horizontal" sign={-1} getValue={() => useApp.getState().ui.rightWidth} onChange={(v) => setUi({ rightWidth: Math.round(Math.max(250, Math.min(520, v))) })} />
                <div className="side right" style={{ width: ui.rightWidth }}><Inspector /></div>
              </>
            )}
          </div>
          <StatusBar />
        </>
      ) : (
        <StartScreen />
      )}
      <Modals />
    </div>
  );
}
