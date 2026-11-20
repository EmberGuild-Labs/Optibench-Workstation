/** Classic dialog window: navy caption with ?/X buttons, face body, bevelled frame. */
import { useEffect, useRef, type ReactNode } from 'react';

export function DialogFrame({ title, children, onClose, onHelp, className = '', footer }: {
  title: string; children: ReactNode; onClose?(): void; onHelp?(): void; className?: string; footer?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`dialog ${className}`} role="dialog" aria-label={title}>
      <div className="caption">
        <span className="caption-title">{title}</span>
        <div className="caption-buttons">
          {onHelp && (
            <button type="button" className="cap-btn" aria-label="Help" title="Help" onClick={onHelp}>
              <svg width="6" height="9" viewBox="0 0 6 9" aria-hidden="true"><path d="M1 0h4v1h1v3H5v1H4v1H2V4h1V3h1V1H2v1H0V1h1ZM2 7h2v2H2Z" fill="#000" /></svg>
            </button>
          )}
          {onClose && (
            <button type="button" className="cap-btn close" aria-label="Close" title="Close" onClick={onClose}>
              <svg width="8" height="7" viewBox="0 0 8 7" aria-hidden="true"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5Z" fill="#000" /></svg>
            </button>
          )}
        </div>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </div>
  );
}

/** Modal wrapper: backdrop, focus trap entry, Esc closes. */
export function ModalDialog({ title, children, onClose, wide, footer }: {
  title: string; children: ReactNode; onClose(): void; wide?: boolean; footer?: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector('.btn.default') as HTMLElement | null)?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
        <DialogFrame title={title} onClose={onClose} className={wide ? 'wide' : ''} footer={footer}>{children}</DialogFrame>
      </div>
    </div>
  );
}
