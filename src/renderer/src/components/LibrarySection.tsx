/** "My Library" section at the top of the component palette (built-in + user library groups). */
import { useEffect, useRef, useState } from 'react';
import { itemDomains, type LibraryItem } from '@core/project/library';
import { useApp, type Domain } from '../store/app';
import { LIBRARY_DND_MIME, deleteLibraryItem, exportLibraryItems, importLibraryFiles, insertLibraryItem, useLibrary } from '../library/store';

function LibGlyph({ item }: { item: LibraryItem }): React.JSX.Element {
  const d = itemDomains(item);
  // classic "component group" icon: three small boxes, tinted per domain
  const fill = d.length > 1 ? '#808000' : d[0] === 'optics' ? '#000080' : '#008000';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="6" height="5" fill="#fff" stroke="#000" />
      <rect x="8.5" y="8.5" width="6" height="5" fill="#fff" stroke="#000" />
      <path d="M4.5 7.5v4h4" fill="none" stroke="#000" />
      <rect x="3" y="4" width="3" height="2" fill={fill} />
      <rect x="10" y="10" width="3" height="2" fill={fill} />
    </svg>
  );
}

function matches(it: LibraryItem, q: string): boolean {
  if (!q) return true;
  const hay = `${it.name} ${it.category} ${it.description}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

interface Ctx { item: LibraryItem; x: number; y: number }

function ItemMenu({ ctx, onClose }: { ctx: Ctx; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const it = ctx.item;
  const entries: { label: string; run(): void; disabled?: boolean }[] = [
    { label: 'Place', run: () => useApp.getState().startPlaceLibrary(it) },
    { label: 'Insert at View Centre', run: () => insertLibraryItem(it, null, null) },
    { label: 'Properties…', run: () => useLibrary.getState().openDialog({ mode: 'rename', item: it }), disabled: it.builtin },
    { label: 'Export…', run: () => void exportLibraryItems([it]) },
    { label: 'Delete', run: () => void deleteLibraryItem(it), disabled: it.builtin }
  ];
  return (
    <div className="menu-pop ctx" role="menu" tabIndex={-1} ref={ref} style={{ left: Math.min(ctx.x, window.innerWidth - 200), top: Math.min(ctx.y, window.innerHeight - 140) }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      {entries.map((m) => (
        <div key={m.label} role="menuitem" aria-disabled={m.disabled} className={`menu-item${m.disabled ? ' disabled' : ''}`}
          onClick={() => { if (m.disabled) return; onClose(); m.run(); }}>
          <span className="menu-check" />
          <span className="menu-label">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

export function LibrarySection({ domains, query }: { domains: Domain[]; query: string }): React.JSX.Element | null {
  const user = useLibrary((s) => s.user);
  const placing = useApp((s) => s.placeLibrary);
  const [collapsed, setCollapsed] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const all = useLibrary.getState().all();
  void user; // re-render when the user library changes
  const list = all.filter((it) => itemDomains(it).some((d) => domains.includes(d)) && matches(it, query));
  const cats = [...new Set(list.map((i) => i.category))].sort();
  if (query && !list.length) return null;
  const open = !collapsed || !!query;
  return (
    <section className="palette-group palette-lib" aria-label="My Library">
      <button type="button" className="palette-group-head" aria-expanded={open} onClick={() => setCollapsed(!collapsed)}>
        <span className="tree-box" aria-hidden="true">{open ? '−' : '+'}</span>
        <span className="cat-glyph"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h5l1 1h7v9h-13z" fill="#ffe680" stroke="#806000" /><path d="M1.5 6.5h13" stroke="#806000" /></svg></span>
        <span>My Library</span>
        <span className="count">{list.length}</span>
      </button>
      {open && (
        <div className="palette-items">
          {cats.map((cat) => (
            <div key={cat}>
              <div className="lib-cat">{cat}</div>
              {list.filter((i) => i.category === cat).map((it) => {
                const active = placing?.id === it.id;
                return (
                  <button key={it.id} type="button" className={`palette-item${active ? ' active' : ''}`} draggable
                    title={`${it.description || it.name}\n${it.optics.length} optics, ${it.circuit.components.length} circuit components${it.links.length ? `, ${it.links.length} links` : ''}${it.builtin ? ' (built-in)' : ''}`}
                    data-lib-id={it.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LIBRARY_DND_MIME, it.id);
                      e.dataTransfer.setData('text/plain', it.name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => useApp.getState().startPlaceLibrary(active ? null : it)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ item: it, x: e.clientX, y: e.clientY }); }}>
                    <span className="item-glyph"><LibGlyph item={it} /></span>
                    <span className="item-label">{it.name}</span>
                    {it.builtin && <span className="lib-tag">built-in</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!list.length && <div className="empty-hint">No library items for this workspace.</div>}
          <div className="lib-tools">
            <button type="button" className="btn" onClick={() => void importLibraryFiles()} title="Import .obwlib files">Import…</button>
            <button type="button" className="btn" disabled={!user.length} onClick={() => void exportLibraryItems(user)} title="Export all your library items to one .obwlib file">Export All…</button>
          </div>
        </div>
      )}
      {ctx && <ItemMenu ctx={ctx} onClose={() => setCtx(null)} />}
    </section>
  );
}
