// Feature QA: save a selection (optics + circuit + wires + links) to the library, insert library groups.
// Launch with a scratch --user-data-dir so the real library is untouched.
// node scripts/dev/cdp.mjs run scripts/dev/qa/feat-library.mjs
export default async (api) => {
  const errs = await api.collect();
  const out = {};
  const open = async (file) => {
    await api.eval(`(async () => { const l = await window.optibench.listExamples(); const ex = l.find(e => e.file === ${JSON.stringify(file)}); const f = await window.optibench.openPath(ex.path); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
    await api.sleep(800);
  };
  const find = (sel, text) => api.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)})); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const clickText = async (sel, text, o) => {
    const r = await find(sel, text);
    if (!r) throw new Error('not found: ' + text);
    await api.click(r.x, r.y, o);
  };
  const setInput = (sel, v) => api.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  // clean slate for this QA profile
  await api.eval(`(async () => { for (const it of await window.optibench.getLibrary()) await window.optibench.deleteLibraryItem(it.id); await __obw.library.useLibrary.getState().load(); })()`);

  // ---- save: optical link example, select TX laser + photodiode head and the LD / PD sub-circuits
  await open('08-optical-link.obw');
  await api.eval(`(() => { const s = __obw.useApp.getState(); s.setTab('split'); s.setSelection('optics', ['tx', 'pd']); s.setSelection('circuit', ['fg', 'g1', 'r1', 'ld', 'g2', 'rxpd', 'rt', 'g4', 'v2']); })()`);
  await api.sleep(300);
  await clickText('.menubar-btn', 'Edit');
  await api.sleep(150);
  await clickText('.menu-item', 'Save to Library');
  await api.sleep(300);
  out.dialogNote = await api.eval(`document.querySelector('.dialog .dlg-note')?.textContent`);
  await setInput('#lib-name', 'QA optical link');
  await setInput('#lib-desc', 'Laser diode transmitter and photodiode receiver with links.');
  await api.shot(process.env.S + '/feat-library-save.png');
  await clickText('.dialog-footer .btn', 'OK');
  await api.sleep(600);
  const lib = await api.eval(`window.optibench.getLibrary()`);
  const saved = lib.find((i) => i.name === 'QA optical link');
  out.saved = saved && { optics: saved.optics.length, comps: saved.circuit.components.length, wires: saved.circuit.wires.length, links: saved.links.length, category: saved.category };

  // ---- insert into a NEW project: click the palette item, click in the optics pane -> one undo step
  await api.eval(`(() => { __obw.useApp.setState({ dirty: false }); return __obw.commands.newProject(); })()`);
  await api.sleep(500);
  await api.eval(`__obw.useApp.getState().setTab('split')`);
  await api.sleep(400);
  const past0 = await api.eval(`__obw.useApp.getState().past.length`);
  await clickText('.palette-lib .palette-item', 'QA optical link');
  await api.sleep(200);
  out.placing = await api.eval(`__obw.useApp.getState().placeLibrary?.name`);
  const pane = await api.rect('.pane.optics');
  await api.move(pane.cx, pane.cy);
  await api.sleep(200);
  await api.shot(process.env.S + '/feat-library-placing.png');
  await api.click(pane.cx, pane.cy);
  await api.sleep(500);
  out.inserted = await api.eval(`(() => { const s = __obw.useApp.getState(); const d = s.doc; const o = new Set(d.optics.components.map(c => c.id)), c = new Set(d.circuit.components.map(c => c.id)); return { undoSteps: s.past.length - ${past0}, label: s.past[s.past.length - 1]?.label, optics: d.optics.components.length, comps: d.circuit.components.length, wires: d.circuit.wires.length, links: d.links.length, linksResolve: d.links.every(l => o.has(l.opticsId) && c.has(l.circuitId)), freshIds: !d.optics.components.some(x => x.id === 'tx'), placingAfter: !!s.placeLibrary, selected: s.selection.optics.length + s.selection.circuit.length }; })()`);
  // insert again (Shift-free second placement via palette) -> ids must not collide
  await clickText('.palette-lib .palette-item', 'QA optical link');
  const cpane = await api.rect('.pane.circuit');
  await api.click(cpane.cx + 60, cpane.cy + 80);
  await api.sleep(500);
  out.second = await api.eval(`(() => { const d = __obw.useApp.getState().doc; const ids = [...d.optics.components.map(c => c.id), ...d.circuit.components.map(c => c.id), ...d.circuit.wires.map(w => w.id), ...d.links.map(l => l.id)]; return { unique: new Set(ids).size === ids.length, optics: d.optics.components.length, links: d.links.length, names: d.circuit.components.filter(c => c.type === 'opto.laser_diode').map(c => c.name) }; })()`);
  // the inserted circuit simulates (co-sim with links)
  await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
  await api.sleep(1200);
  out.sim = await api.eval(`(() => { const c = __obw.useSim.getState().circuit; return { conv: c?.converged, err: c?.error ?? null, t: c?.time?.toFixed(2) }; })()`);
  await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
  await api.eval(`__obw.useApp.getState().undo()`);
  out.afterUndo = await api.eval(`__obw.useApp.getState().doc.optics.components.length`);

  // ---- built-ins: TIA (optics head + op-amp circuit + link) and LED+resistor into a new project
  await api.eval(`(() => { __obw.useApp.setState({ dirty: false }); return __obw.commands.newProject(); })()`);
  await api.sleep(400);
  await api.eval(`__obw.useApp.getState().setTab('split')`);
  await api.sleep(300);
  await clickText('.palette-lib .palette-item', 'Transimpedance');
  await api.click(cpane.cx - 40, cpane.cy);
  await api.sleep(400);
  await api.eval(`__obw.useApp.getState().setTab('circuit')`);
  await api.sleep(300);
  await clickText('.palette-lib .palette-item', 'LED with');
  const cp2 = await api.rect('.pane.circuit');
  await api.click(cp2.cx + 250, cp2.cy + 150);
  await api.sleep(400);
  out.builtins = await api.eval(`(() => { const d = __obw.useApp.getState().doc; return { optics: d.optics.components.map(c => c.type), comps: d.circuit.components.map(c => c.type).join(','), wires: d.circuit.wires.length, links: d.links.length }; })()`);
  // shine a laser on the TIA head: add a source, link exists -> run and read VOUT
  await api.eval(`(() => { const s = __obw.useApp.getState(); const d = s.doc; const head = d.optics.components.find(c => c.type === 'detector.photodiode'); const las = __obw.engines.opticsEngine.createComponent('source.laser', { x: head.position.x - 80, y: head.position.y }); las.props.power = 0.001; s.setOpticsScene({ ...d.optics, components: [...d.optics.components, las] }, true, 'Add laser'); })()`);
  await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
  await api.sleep(1500);
  out.tia = await api.eval(`(() => { const st = __obw.useSim.getState().circuit; const d = __obw.useApp.getState().doc; const pr = d.circuit.components.find(c => c.name === 'VOUT'); const pd = __obw.useSim.getState().trace?.detectors; return { conv: st?.converged, err: st?.error ?? null, vout: st?.components?.[pr.id]?.voltage, detPower: pd && Object.values(pd).map(r => r.power) }; })()`);
  await api.eval(`__obw.commands.frameAll()`);
  await api.sleep(500);
  await api.shot('docs/screenshots/feat-library.png');
  await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);

  // rename + delete through IPC
  await api.eval(`window.optibench.renameLibraryItem(${JSON.stringify(saved?.id ?? '')}, { name: 'QA renamed', category: 'QA' })`);
  out.renamed = (await api.eval(`window.optibench.getLibrary()`)).map((i) => `${i.category}/${i.name}`);
  out.badSave = await api.eval(`window.optibench.saveLibraryItem({ name: 'x' }).then(() => 'accepted', e => 'rejected')`);
  await api.eval(`(async () => { for (const it of await window.optibench.getLibrary()) await window.optibench.deleteLibraryItem(it.id); await __obw.library.useLibrary.getState().load(); })()`);
  out.afterDelete = (await api.eval(`window.optibench.getLibrary()`)).length;
  out.errors = errs;
  out.logs = await api.eval(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message)`);
  return out;
};
