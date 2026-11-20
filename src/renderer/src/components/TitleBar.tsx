import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from 'react';
import { buildMenus, type MenuEntry, type MenuItem } from '../menus';
import { documentTitle, useApp } from '../store/app';
import { AppLogo } from './Glyphs';

const isItem = (e: MenuEntry): e is MenuItem => e.kind !== 'separator';
const enabled = (e: MenuEntry): boolean => isItem(e) && e.enabled !== false;

/** Renders "&File" as File with the F underlined. */
export function Mnemonic({ label }: { label: string }): React.JSX.Element {
  const i = label.indexOf('&');
  if (i < 0 || i === label.length - 1) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <u>{label[i + 1]}</u>
      {label.slice(i + 2)}
    </>
  );
}
const mnemonicOf = (label: string): string | null => {
  const i = label.indexOf('&');
  return i >= 0 && i < label.length - 1 ? label[i + 1].toLowerCase() : null;
};

function MenuList({ items, onClose, depth, autoFocus, onLeft, onRight }: {
  items: MenuEntry[]; onClose(): void; depth: number; autoFocus: boolean; onLeft?(): void; onRight?(): void;
}): React.JSX.Element {
  const [active, setActive] = useState(() => (autoFocus ? items.findIndex(enabled) : -1));
  const [sub, setSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const move = (dir: 1 | -1): void => {
    if (!items.length) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (enabled(items[i])) { setActive(i); return; }
    }
  };
  const activate = (i: number): void => {
    const it = items[i];
    if (!it || !isItem(it) || it.enabled === false) return;
    if (it.submenu) { setActive(i); setSub(i); return; }
    onClose();
    it.action?.();
  };
  const onKey = (e: RKE): void => {
    const handled = (): void => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowDown': handled(); move(1); return;
      case 'ArrowUp': handled(); move(-1); return;
      case 'Enter': case ' ': handled(); activate(active); return;
      case 'Escape': handled(); if (depth > 0) onLeft?.(); else onClose(); return;
      case 'ArrowRight': {
        handled();
        const it = items[active];
        if (it && isItem(it) && it.submenu) setSub(active);
        else onRight?.();
        return;
      }
      case 'ArrowLeft': handled(); onLeft?.(); return;
      case 'Tab': handled(); onClose(); return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const i = items.findIndex((it) => isItem(it) && it.enabled !== false && mnemonicOf(it.label) === k);
      if (i >= 0) { handled(); activate(i); }
    }
  };

  return (
    <div className={`menu-pop${depth ? ' sub' : ''}`} role="menu" tabIndex={-1} ref={ref} onKeyDown={onKey}>
      {items.map((it, i) => {
        if (!isItem(it)) return <div key={`s${i}`} className="menu-sep" role="separator" />;
        const dis = it.enabled === false;
        return (
          <div
            key={`${it.label}${i}`}
            role="menuitem"
            aria-disabled={dis}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            aria-checked={it.checked}
            className={`menu-item${i === active ? ' active' : ''}${dis ? ' disabled' : ''}`}
            onMouseEnter={() => { setActive(i); setSub(it.submenu ? i : null); }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => activate(i)}
          >
            <span className="menu-check">{it.checked ? <CheckGlyph /> : null}</span>
            <span className="menu-label"><Mnemonic label={it.label} /></span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            {it.submenu && <span className="menu-chev"><ArrowGlyph /></span>}
            {it.submenu && sub === i && (
              <MenuList
                items={it.submenu()}
                onClose={onClose}
                depth={depth + 1}
                autoFocus
                onLeft={() => { setSub(null); ref.current?.focus(); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const CheckGlyph = (): React.JSX.Element => (
  <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><path d="M0 2h1v1h1v1h1V3h1V2h1V1h1V0h1v3H6v1H5v1H4v1H3v1H2V6H1V5H0Z" fill="currentColor" /></svg>
);
const ArrowGlyph = (): React.JSX.Element => (
  <svg width="4" height="7" viewBox="0 0 4 7" aria-hidden="true"><path d="M0 0l4 3.5L0 7Z" fill="currentColor" /></svg>
);

/** Classic caption-button glyphs (pixel style). */
function CaptionGlyph({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }): React.JSX.Element {
  switch (kind) {
    case 'min': return <svg width="8" height="7" viewBox="0 0 8 7"><rect x="1" y="5" width="6" height="2" fill="#000" /></svg>;
    case 'max': return <svg width="9" height="9" viewBox="0 0 9 9"><path d="M0 0h9v9H0ZM1 2v6h7V2Z" fill="#000" fillRule="evenodd" /></svg>;
    case 'restore': return (
      <svg width="9" height="9" viewBox="0 0 9 9"><path d="M2 0h7v6H7V5h1V2H3v1H2Z M0 3h7v6H0Z M1 5v3h5V5Z" fill="#000" fillRule="evenodd" /></svg>
    );
    default: return <svg width="8" height="7" viewBox="0 0 8 7"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5Z" fill="#000" /></svg>;
  }
}

export function TitleBar(): React.JSX.Element {
  const doc = useApp((s) => s.doc);
  const dirty = useApp((s) => s.dirty);
  const filePath = useApp((s) => s.filePath);
  const [open, setOpen] = useState<number | null>(null);
  const [kbd, setKbd] = useState(false);
  const [recent, setRecent] = useState<{ path: string; exists: boolean }[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const platform = window.optibench?.platform ?? 'win32';

  const menus = useMemo(() => buildMenus(recent), [recent]);
  const title = documentTitle({ doc, filePath });

  const openMenu = useCallback((i: number | null, viaKeyboard = false) => {
    setOpen(i);
    setKbd(viaKeyboard);
    if (i !== null) void window.optibench?.getRecent().then(setRecent).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent): void => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    const f = (): void => setFocused(true);
    const b = (): void => { setFocused(false); setOpen(null); };
    window.addEventListener('focus', f);
    window.addEventListener('blur', b);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', b); };
  }, []);

  // Alt+<mnemonic> opens a menu; a plain Alt tap opens the first menu
  useEffect(() => {
    let altAlone = false;
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') { altAlone = true; return; }
      altAlone = false;
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const i = menus.findIndex((m) => m.mnemonic === e.key.toLowerCase());
        if (i >= 0) { e.preventDefault(); openMenu(i, true); }
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && altAlone) {
        e.preventDefault();
        if (open === null) openMenu(0, true);
        else setOpen(null);
      }
      altAlone = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [menus, open, openMenu]);

  useEffect(() => {
    const a = window.optibench;
    if (!a) return;
    void a.isMaximized().then(setMaximized);
    return a.onMaximizeChanged(setMaximized);
  }, []);

  const n = menus.length;
  const caption = doc ? `Optibench Workstation - ${title}${dirty ? ' *' : ''}` : 'Optibench Workstation';
  const ctl = (a: 'minimize' | 'maximize' | 'close'): void => void window.optibench?.windowControl(a);
  return (
    <header className={`chrome-top platform-${platform}`} ref={barRef}>
      <div className={`caption${focused ? '' : ' inactive'}`} onDoubleClick={() => ctl('maximize')}>
        {platform !== 'darwin' && <span className="caption-icon"><AppLogo size={16} /></span>}
        <span className="caption-title" title={filePath ?? undefined}>{caption}</span>
        {platform !== 'darwin' && (
          <div className="caption-buttons" onDoubleClick={(e) => e.stopPropagation()}>
            <button type="button" className="cap-btn" aria-label="Minimize" title="Minimize" onClick={() => ctl('minimize')}><CaptionGlyph kind="min" /></button>
            <button type="button" className="cap-btn" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => ctl('maximize')}>
              <CaptionGlyph kind={maximized ? 'restore' : 'max'} />
            </button>
            <button type="button" className="cap-btn close" aria-label="Close" title="Close" onClick={() => ctl('close')}><CaptionGlyph kind="close" /></button>
          </div>
        )}
      </div>
      <nav className="menubar" role="menubar" aria-label="Main menu">
        {menus.map((m, i) => (
          <Fragment key={m.id}>
            <div className="menubar-slot">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open === i}
                className={`menubar-btn${open === i ? ' open' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); openMenu(open === i ? null : i); }}
                onMouseEnter={() => { if (open !== null && open !== i) openMenu(i); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openMenu(i, true); }
                }}
              >
                <Mnemonic label={m.label} />
              </button>
              {open === i && (
                <MenuList
                  items={m.items()}
                  depth={0}
                  autoFocus={kbd}
                  onClose={() => setOpen(null)}
                  onLeft={() => openMenu((i - 1 + n) % n, true)}
                  onRight={() => openMenu((i + 1) % n, true)}
                  key={m.id}
                />
              )}
            </div>
          </Fragment>
        ))}
      </nav>
    </header>
  );
}
