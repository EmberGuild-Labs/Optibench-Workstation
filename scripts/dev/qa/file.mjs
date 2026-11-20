// File: serialize/parse round trip, save via IPC, dirty flag/title, recent files.
export default async (api, a) => {
  const errs = await api.collect();
  const out = {};
  const path = a[0];
  await api.eval(`(async () => {
    const s = __obw.useApp.getState(); const O = __obw.engines.opticsEngine, C = __obw.engines.circuitEngine;
    const doc = __obw.project.createEmptyDocument();
    doc.meta.title = 'QA Round Trip';
    for (const d of O.registry) { const c = O.createComponent(d.type, {x: Math.random() * 200 - 100, y: Math.random() * 200 - 100}); c.rotation = 0.3; doc.optics.components.push(c); }
    let i = 0;
    for (const d of C.registry) { const c = C.createComponent(d.type, {x: (i % 8) * 10, y: Math.floor(i / 8) * 10}); i++; doc.circuit.components.push(c); }
    doc.circuit.wires.push({ id: 'wq', points: [{x: 0, y: 0}, {x: 5, y: 0}, {x: 5, y: 7}], color: '#e5484d', label: 'VCC' });
    const ld = doc.circuit.components.find(c => c.type === 'opto.laser_diode'), src = doc.optics.components.find(c => c.type === 'source.laser');
    doc.links.push({ id: 'l1', kind: 'emitter', circuitId: ld.id, opticsId: src.id });
    doc.links.push({ id: 'l2', kind: 'actuator', circuitId: doc.circuit.components.find(c => c.type === 'opto.coil').id, opticsId: doc.optics.components.find(c => c.type === 'magneto.faraday').id, targetProp: 'bField', gain: 0.01, offset: 0 });
    s.loadDocument(doc, null);
    s.setView('optics', {cx: 12, cy: -3, zoom: 1.7}); s.setTab('split');
  })()`);
  out.title0 = await api.eval(`document.querySelector('.caption-title').textContent`);
  // edit -> dirty
  await api.eval(`__obw.useApp.getState().rotateSelection(1)`);
  await api.eval(`(() => { const s = __obw.useApp.getState(); s.setSelection('optics', [s.doc.optics.components[0].id]); s.rotateSelection(1); })()`);
  out.dirty = await api.eval(`__obw.useApp.getState().dirty`);
  out.title1 = await api.eval(`document.querySelector('.caption-title').textContent`);
  out.roundTrip = await api.eval(`(() => {
    const d = __obw.documentForSave(); const txt = __obw.project.serializeDocument(d); const { doc, warnings } = __obw.project.parseDocument(txt);
    const strip = (x) => JSON.stringify({ ...x, meta: { ...x.meta, modified: '' } });
    return { same: strip(doc) === strip(d), warnings, bytes: txt.length, opt: doc.optics.components.length, cir: doc.circuit.components.length, links: doc.links.length, view: doc.view };
  })()`);
  // save via IPC (bypasses native dialog), then mark saved like the app does
  out.save = await api.eval(`(async () => { const d = __obw.documentForSave(); await window.optibench.writeFile(${JSON.stringify(path)}, __obw.project.serializeDocument(d)); __obw.useApp.getState().markSaved(${JSON.stringify(path)}, d); return true; })()`);
  await api.sleep(200);
  out.dirtyAfterSave = await api.eval(`__obw.useApp.getState().dirty`);
  out.title2 = await api.eval(`document.querySelector('.caption-title').textContent`);
  out.recent = await api.eval(`window.optibench.getRecent()`);
  // undo after save -> dirty again
  await api.key('z', { modifiers: 'ctrl' });
  out.dirtyAfterUndo = await api.eval(`__obw.useApp.getState().dirty`);
  out.errs = errs;
  return out;
};
