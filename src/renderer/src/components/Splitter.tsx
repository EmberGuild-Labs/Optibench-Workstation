import { useRef } from 'react';

/**
 * Thin drag handle. direction="horizontal" resizes widths (drag along x), "vertical" heights.
 * The owner reads its size with `getValue()` when a gesture starts and receives `onChange(start + delta)`
 * where delta is the TOTAL pointer travel since pointer-down (times `sign`). Because the value is
 * recomputed from the start each move, clamping in the owner never makes the handle drift away from
 * the cursor.
 */
export function Splitter({ direction, getValue, onChange, sign = 1, onEnd, className = '' }: {
  direction: 'horizontal' | 'vertical';
  getValue(): number;
  onChange(value: number): void;
  /** -1 when dragging toward +x/+y should shrink the value (right panel, bottom dock). */
  sign?: 1 | -1;
  onEnd?(): void;
  className?: string;
}): React.JSX.Element {
  const drag = useRef<{ id: number; start: number; value: number } | null>(null);
  const end = (el: HTMLElement, id: number): void => {
    if (!drag.current || drag.current.id !== id) return;
    drag.current = null;
    try { if (el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch { /* ignore */ }
    document.body.classList.remove('resizing-x', 'resizing-y');
    onEnd?.();
  };
  return (
    <div
      className={`splitter ${direction} ${className}`}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = (e.shiftKey ? 40 : 10) * sign;
        const dec = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        const inc = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === dec || e.key === inc) {
          e.preventDefault();
          onChange(getValue() + (e.key === inc ? step : -step));
          onEnd?.();
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        drag.current = { id: e.pointerId, start: direction === 'horizontal' ? e.clientX : e.clientY, value: getValue() };
        document.body.classList.add(direction === 'horizontal' ? 'resizing-x' : 'resizing-y');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const p = direction === 'horizontal' ? e.clientX : e.clientY;
        onChange(d.value + (p - d.start) * sign);
      }}
      onPointerUp={(e) => end(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => end(e.currentTarget, e.pointerId)}
      onLostPointerCapture={(e) => end(e.currentTarget, e.pointerId)}
    />
  );
}
