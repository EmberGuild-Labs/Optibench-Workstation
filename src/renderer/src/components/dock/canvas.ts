import { useEffect, useRef } from 'react';

/** Canvas that redraws on resize and whenever `deps` change. draw receives CSS-pixel size; context is DPR-scaled. */
export function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const size = useRef({ w: 0, h: 0 });

  const paint = (): void => {
    const c = ref.current;
    if (!c) return;
    const { w, h } = size.current;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    drawRef.current(g, w, h);
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      size.current = { w: r.width, h: r.height };
      paint();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(paint, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

export function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
