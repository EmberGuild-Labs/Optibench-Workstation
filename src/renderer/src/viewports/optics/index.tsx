/**
 * Optics bench viewport (WebGL2 light + Canvas2D components/UI).
 *
 * Exports
 *  - OpticsViewport        controlled React component taking OpticsViewportProps
 *                          (+ optional `captureRef` receiving { capturePNG() }).
 *  - captureOpticsPNG()    PNG snapshot of the most recently mounted viewport (light + components + UI).
 *                          Also exposed as `window.__optibenchCaptureOptics()` while a viewport is mounted.
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { OpticsViewportProps } from '../contracts';
import { OpticsViewportRuntime } from './runtime';

export interface OpticsViewportHandle {
  /** Render a fresh frame and return it as a PNG blob (device-pixel resolution). */
  capturePNG(): Promise<Blob>;
}

declare global {
  interface Window { __optibenchCaptureOptics?: () => Promise<Blob> }
}

const mounted: OpticsViewportRuntime[] = [];

/** Snapshot the most recently mounted optics viewport as PNG. Rejects if none is mounted. */
export function captureOpticsPNG(): Promise<Blob> {
  const rt = mounted[mounted.length - 1];
  return rt ? rt.capturePNG() : Promise.reject(new Error('No optics viewport mounted'));
}

export type OpticsViewportComponentProps = OpticsViewportProps & { captureRef?: Ref<OpticsViewportHandle> };

export function OpticsViewport(props: OpticsViewportComponentProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<OpticsViewportRuntime | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const rt = new OpticsViewportRuntime(wrapRef.current!, glRef.current!, ovRef.current!, () => propsRef.current);
    rtRef.current = rt;
    mounted.push(rt);
    window.__optibenchCaptureOptics = captureOpticsPNG;
    return () => {
      const i = mounted.indexOf(rt);
      if (i >= 0) mounted.splice(i, 1);
      if (!mounted.length && window.__optibenchCaptureOptics === captureOpticsPNG) delete window.__optibenchCaptureOptics;
      rt.dispose();
      rtRef.current = null;
    };
  }, []);

  useImperativeHandle(props.captureRef, () => ({
    capturePNG: () => (rtRef.current ? rtRef.current.capturePNG() : Promise.reject(new Error('viewport not ready'))),
  }), []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="optics-viewport"
      data-testid="optics-viewport"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', outline: 'none', background: '#04070c', touchAction: 'none', userSelect: 'none' }}
    >
      <canvas ref={glRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <canvas ref={ovRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
    </div>
  );
}

export default OpticsViewport;
