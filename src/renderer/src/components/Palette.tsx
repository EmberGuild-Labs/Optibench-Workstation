import { useMemo, useState } from 'react';
import type { ComponentDef } from '@core/types';
import { PALETTE_DND_MIME, type PaletteDragPayload } from '../viewports/contracts';
import { circuitEngine, opticsEngine } from '../engines';
import { useApp, type Domain } from '../store/app';
import { CategoryGlyph, TypeGlyph } from './Glyphs';
import { LibrarySection } from './LibrarySection';

interface Group { domain: Domain; category: string; items: ComponentDef[] }

function groupRegistry(domain: Domain, defs: ComponentDef[]): Group[] {
  const map = new Map<string, ComponentDef[]>();
  for (const d of defs) {
    const k = d.category || 'Other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(d);
  }
  return [...map.entries()].map(([category, items]) => ({ domain, category, items }));
}

function matches(d: ComponentDef, q: string): boolean {
  if (!q) return true;
  const hay = `${d.label} ${d.type} ${d.category} ${d.description}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function Palette(): React.JSX.Element {
  const tab = useApp((s) => s.tab);
  const tool = useApp((s) => s.tool);
  const placeType = useApp((s) => s.placeType);
  const placeDomain = useApp((s) => s.placeDomain);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [domainFilter, setDomainFilter] = useState<'auto' | Domain>('auto');

  const groups = useMemo(() => {
    let optics: Group[] = [], circuit: Group[] = [];
    try { optics = groupRegistry('optics', opticsEngine.registry); } catch { /* engine missing */ }
    try { circuit = groupRegistry('circuit', circuitEngine.registry as ComponentDef[]); } catch { /* engine missing */ }
    return { optics, circuit };
  }, []);

  const domains: Domain[] = domainFilter !== 'auto' ? [domainFilter] : tab === 'split' ? ['optics', 'circuit'] : [tab];
  const q = query.trim().toLowerCase();

  return (
    <aside className="panel palette" aria-label="Component palette">
      <div className="panel-head">
        <span className="panel-title">Components</span>
      </div>
      <div className="palette-filters">
        <label className="field-label">
          <span>F<u>i</u>nd:</span>
          <input
            type="search" className="field" value={query} spellCheck={false} accessKey="i"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur(); } }}
            aria-label="Search components"
          />
        </label>
        <label className="field-label">
          <span>Show:</span>
          <select className="field sel" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value as 'auto' | Domain)} aria-label="Domain">
            <option value="auto">Current workspace</option>
            <option value="optics">Optics</option>
            <option value="circuit">Circuit</option>
          </select>
        </label>
      </div>
      <div className="panel-scroll tree" role="tree">
        <LibrarySection domains={domains} query={q} />
        {domains.map((dom) => {
          const list = groups[dom].map((g) => ({ ...g, items: g.items.filter((d) => matches(d, q)) })).filter((g) => g.items.length);
          return (
            <div key={dom} className="palette-domain">
              {domains.length > 1 && <div className="palette-domain-label">{dom === 'optics' ? 'Optics' : 'Circuit'}</div>}
              {list.length === 0 && <div className="empty-hint">{groups[dom].length ? 'No matches' : 'Engine not loaded'}</div>}
              {list.map((g) => {
                const key = `${dom}:${g.category}`;
                const isCollapsed = !q && collapsed[key];
                return (
                  <section key={key} className="palette-group">
                    <button
                      type="button"
                      className="palette-group-head"
                      aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                    >
                      <span className="tree-box" aria-hidden="true">{isCollapsed ? '+' : '−'}</span>
                      <span className="cat-glyph"><CategoryGlyph category={g.category} domain={dom} /></span>
                      <span>{g.category}</span>
                      <span className="count">{g.items.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="palette-items">
                        {g.items.map((d) => {
                          const active = tool === 'place' && placeType === d.type && placeDomain === dom;
                          return (
                            <button
                              key={d.type}
                              type="button"
                              className={`palette-item${active ? ' active' : ''}`}
                              draggable
                              title={d.description}
                              onDragStart={(e) => {
                                const payload: PaletteDragPayload = { domain: dom, type: d.type };
                                e.dataTransfer.setData(PALETTE_DND_MIME, JSON.stringify(payload));
                                e.dataTransfer.setData('text/plain', d.type);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onClick={() => {
                                const s = useApp.getState();
                                if (active) s.setTool('select');
                                else s.startPlace(dom, d.type);
                              }}
                            >
                              <span className={`item-glyph ${dom}`}><TypeGlyph type={d.type} /></span>
                              <span className="item-label">{d.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
