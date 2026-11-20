export default async (api) => {
  const errs = await api.collect();
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    d.optics.components = [E.createComponent('source.laser', {x: -50, y: 0}), E.createComponent('lens.biconvex', {x: 20, y: 0})];
    s.loadDocument(d, null); s.setTab('optics'); })()`);
  await api.sleep(200);
  const menu = async (mi, label) => {
    const m = await api.eval(`(() => { const b = document.querySelectorAll('.menubar-btn')[${mi}]; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    await api.click(m.x, m.y); await api.sleep(60);
    const p = await api.eval(`(() => { const e = [...document.querySelectorAll('.menu-pop .menu-item')].find(e => e.querySelector('.menu-label').textContent.startsWith(${JSON.stringify(label)})); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x + 30, y: r.y + r.height/2, dis: e.classList.contains('disabled')}; })()`);
    if (!p || p.dis) { await api.key('Escape'); return p ? 'disabled' : 'missing'; }
    await api.click(p.x, p.y); await api.sleep(100);
    return 'ok';
  };
  const r = {};
  const sel = async () => { const id = await st('s.doc.optics.components[1].id'); await api.eval(`__obw.useApp.getState().setSelection('optics', ['${id}'])`); };
  await sel();
  r.copy = await menu(1, 'Copy'); r.paste = await menu(1, 'Paste'); r.n1 = await st('s.doc.optics.components.length');
  await sel(); r.dup = await menu(1, 'Duplicate'); r.n2 = await st('s.doc.optics.components.length');
  await sel(); r.rot = await menu(1, 'Rotate Clockwise'); r.rot1 = await st('s.doc.optics.components[1].rotation');
  r.rotccw = await menu(1, 'Rotate Counter'); r.rot2 = await st('s.doc.optics.components[1].rotation');
  r.del = await menu(1, 'Delete'); r.n3 = await st('s.doc.optics.components.length');
  r.undo = await menu(1, 'Undo'); r.n4 = await st('s.doc.optics.components.length');
  r.redo = await menu(1, 'Redo'); r.n5 = await st('s.doc.optics.components.length');
  r.frameAll = await menu(2, 'Frame All'); r.view = await st('s.views.optics');
  r.reset = await menu(3, 'Run'); await api.sleep(300); r.resetItem = await menu(3, 'Reset'); r.status = await st('s.sim.status');
  r.errs = errs;
  return r;
};
