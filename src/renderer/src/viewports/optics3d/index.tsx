/**
 * 3D optics viewport (three.js).
 *
 * Exports
 *  - Optics3DViewport          controlled React component taking Optics3DViewportProps
 *                              (+ optional `captureRef` receiving { capturePNG() }).
 *  - Optics3DViewportProps     = OpticsViewportProps − engine/trace + engine3d, trace3d, opticsEngine, timeView…
 *  - captureOptics3DPNG()      PNG of the most recently mounted 3D viewport
 *                              (also `window.__optibenchCaptureOptics3D()` while mounted).
 *  - pose helpers (docToWorldPos, worldPoseOf, applyWorldPose…) re-exported from ./pose.
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type CSSProperties } from 'react';
import { Optics3DRuntime } from './runtime';
import type { CameraPreset, Optics3DViewportProps } from './props';

export type { Optics3DViewportProps, TimeView, CameraPreset } from './props';
export * from './pose';

export interface Optics3DViewportHandle {
  capturePNG(): Promise<Blob>;
  setCamera(preset: CameraPreset): void;
  frameSelection(): void;
}

declare global {
  interface Window { __optibenchCaptureOptics3D?: () => Promise<Blob>; __optics3d?: Optics3DRuntime }
}

const mounted: Optics3DRuntime[] = [];

export function captureOptics3DPNG(): Promise<Blob> {
  const rt = mounted[mounted.length - 1];
  return rt ? rt.capturePNG() : Promise.reject(new Error('No 3D optics viewport mounted'));
}

const CSS = `
.o3d-root { position: relative; width: 100%; height: 100%; overflow: hidden; outline: none; background: #101214; touch-action: none; user-select: none; }
.o3d-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.o3d-bar { position: absolute; top: 6px; left: 6px; display: flex; gap: 2px; padding: 2px; background: #d4d0c8;
  box-shadow: inset -1px -1px #404040, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #e6e3dc;
  font: 11px Tahoma, "Microsoft Sans Serif", "Segoe UI", sans-serif; color: #000; z-index: 2; }
.o3d-bar button { font: inherit; color: #000; background: #d4d0c8; border: 0; padding: 2px 7px; min-width: 22px; height: 20px; cursor: default;
  box-shadow: none; }
.o3d-bar button:hover { box-shadow: inset -1px -1px #808080, inset 1px 1px #ffffff; }
.o3d-bar button:active, .o3d-bar button.on { box-shadow: inset 1px 1px #808080, inset -1px -1px #ffffff; }
.o3d-bar button.on { background: #e6e3dc; }
.o3d-bar button:active { padding: 3px 6px 1px 8px; }
.o3d-bar button:focus-visible { outline: 1px dotted #000; outline-offset: -4px; }
.o3d-bar .sep { width: 2px; margin: 1px 3px; box-shadow: inset 1px 0 #808080, inset -1px 0 #ffffff; }
.o3d-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1; }
.o3d-label { position: absolute; left: 0; top: 0; white-space: nowrap; font: 11px Tahoma, "Microsoft Sans Serif", sans-serif;
  color: #e3e6ea; background: rgba(16,18,20,0.78); border: 1px solid rgba(255,255,255,0.14); padding: 0 4px 1px; will-change: transform; }
.o3d-label.o3d-sel { color: #fff; background: #0a246a; border-color: #6f8fd0; }
.o3d-readout { position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; z-index: 3;
  font: 11px "Lucida Console", Consolas, monospace; color: #000; background: #ffffe1; border: 1px solid #000; padding: 1px 4px; }
.o3d-lost { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 4;
  font: 11px Tahoma, sans-serif; color: #e3e6ea; background: rgba(16,18,20,0.85); }
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.dataset.o3d = '';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

export type Optics3DViewportComponentProps = Optics3DViewportProps & { captureRef?: Ref<Optics3DViewportHandle> };

export function Optics3DViewport(props: Optics3DViewportComponentProps) {
  injectCSS();
  const [gen, setGen] = useState(0); // bumps on context restore -> fresh runtime
  return <Inner key={gen} {...props} onRestored={() => setGen((g) => g + 1)} />;
}

function Inner(props: Optics3DViewportComponentProps & { onRestored(): void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const rtRef = useRef<Optics3DRuntime | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [lost, setLost] = useState(false);
  const [labels, setLabels] = useState(props.showLabels ?? true);
  const [haze, setHaze] = useState(true);

  useEffect(() => {
    const rt = new Optics3DRuntime(wrapRef.current!, canvasRef.current!, { labels: labelsRef.current!, readout: readoutRef.current! }, () => propsRef.current, {
      onContextLost: setLost,
      onRestored: () => propsRef.current.onRestored(),
    });
    rtRef.current = rt;
    mounted.push(rt);
    window.__optibenchCaptureOptics3D = captureOptics3DPNG;
    window.__optics3d = rt;
    return () => {
      const i = mounted.indexOf(rt);
      if (i >= 0) mounted.splice(i, 1);
      if (!mounted.length) { delete window.__optibenchCaptureOptics3D; delete window.__optics3d; }
      rt.dispose();
      rtRef.current = null;
    };
  }, []);

  useLayoutEffect(() => { rtRef.current?.sync(); });
  useEffect(() => { const rt = rtRef.current; if (rt) { rt.showLabels = labels; rt.haze = haze; rt.requestRender(); } }, [labels, haze]);

  useImperativeHandle(props.captureRef, () => ({
    capturePNG: () => (rtRef.current ? rtRef.current.capturePNG() : Promise.reject(new Error('viewport not ready'))),
    setCamera: (p: CameraPreset) => rtRef.current?.setCameraPreset(p),
    frameSelection: () => rtRef.current?.frameSelection(),
  }), []);

  const cam = (p: CameraPreset) => () => rtRef.current?.setCameraPreset(p);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const style: CSSProperties = {};
  return (
    <div ref={wrapRef} tabIndex={0} className="o3d-root" data-testid="optics3d-viewport" style={style}>
      <canvas ref={canvasRef} />
      <div ref={labelsRef} className="o3d-labels" />
      <div className="o3d-bar" onPointerDown={stop} onDoubleClick={stop}>
        <button title="Top view, matches the 2D layout (T)" onClick={cam('top')}><u>T</u>op</button>
        <button title="Front view (from −Y)" onClick={cam('front')}>Front</button>
        <button title="Side view (from +X)" onClick={cam('side')}>Side</button>
        <button title="Isometric view" onClick={cam('iso')}>Iso</button>
        <button title="Frame selection (F)" onClick={() => rtRef.current?.frameSelection()}><u>F</u>rame</button>
        <span className="sep" />
        <button className={labels ? 'on' : ''} title="Show component labels" onClick={() => setLabels((v) => !v)}>Labels</button>
        <button className={haze ? 'on' : ''} title="Faint beam scattering haze" onClick={() => setHaze((v) => !v)}>Haze</button>
      </div>
      <div ref={readoutRef} className="o3d-readout" style={{ display: 'none' }} />
      {lost && <div className="o3d-lost">3D graphics context lost — restoring…</div>}
    </div>
  );
}

export default Optics3DViewport;
