/** "Save to Library…" and "Rename Library Item…" dialog (name / category / description). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalDialog } from './Dialog';
import { librarySelectionCount, renameLibraryItem, saveSelectionToLibrary, useLibrary } from '../library/store';
import { useApp } from '../store/app';

export function LibraryDialog({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const dlg = useLibrary((s) => s.dialog);
  const items = useLibrary((s) => s.user);
  const doc = useApp((s) => s.doc);
  const sel = useApp((s) => s.selection);
  const rename = dlg?.mode === 'rename' ? dlg.item : undefined;
  const counts = useMemo(() => librarySelectionCount(), [doc, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const wires = useMemo(() => {
    if (!doc) return 0;
    const c = new Set(sel.circuit);
    return doc.circuit.wires.filter((w) => c.has(w.id)).length;
  }, [doc, sel]);
  const cats = useMemo(() => [...new Set(['Optics', 'Circuit', 'Opto', 'General', ...items.map((i) => i.category)])].sort(), [items]);
  const [name, setName] = useState(rename?.name ?? '');
  const [category, setCategory] = useState(rename?.category ?? (counts.optics && counts.circuit ? 'Opto' : counts.circuit ? 'Circuit' : 'Optics'));
  const [description, setDescription] = useState(rename?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); nameRef.current?.select(); }, []);
  if (!dlg) return null;
  const empty = !rename && counts.optics + counts.circuit === 0;

  const ok = async (): Promise<void> => {
    if (!name.trim()) { setErr('Enter a name.'); return; }
    if (empty) { setErr('Select the components to save first.'); return; }
    setBusy(true);
    if (rename) await renameLibraryItem(rename.id, { name, category, description });
    else await saveSelectionToLibrary({ name, category, description });
    setBusy(false);
    onClose();
  };

  return (
    <ModalDialog title={rename ? 'Library Item Properties' : 'Save to Library'} onClose={onClose}
      footer={<>
        <button type="button" className="btn default" disabled={busy} onClick={() => void ok()}><u>O</u>K</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </>}>
      <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void ok(); } }}>
        {!rename && (
          <div className="dlg-note" style={{ marginTop: 0, marginBottom: 8 }}>
            {empty ? 'Nothing is selected.' : `Saves ${counts.optics ? `${counts.optics} optics component${counts.optics === 1 ? '' : 's'}` : ''}${counts.optics && counts.circuit ? ' and ' : ''}${counts.circuit ? `${counts.circuit} circuit component${counts.circuit === 1 ? '' : 's'}` : ''}, the wires between them${wires ? ` (${wires} selected)` : ''} and their opto-links.`}
          </div>
        )}
        <div className="form-grid">
          <label htmlFor="lib-name"><u>N</u>ame:</label>
          <input id="lib-name" ref={nameRef} accessKey="n" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          <label htmlFor="lib-cat"><u>C</u>ategory:</label>
          <>
            <input id="lib-cat" accessKey="c" className="field" list="lib-cats" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} spellCheck={false} />
            <datalist id="lib-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </>
          <label htmlFor="lib-desc" style={{ alignSelf: 'start', paddingTop: 3 }}><u>D</u>escription:</label>
          <textarea id="lib-desc" accessKey="d" className="field" rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {err && <div className="dlg-note" style={{ color: 'var(--danger)' }} role="alert">{err}</div>}
      </div>
    </ModalDialog>
  );
}
