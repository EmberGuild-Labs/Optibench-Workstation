// Click every safe menu item in every menu; report items + errors.
const SKIP = /Open…|Open Recent|Save|Export|Close Project|Exit|Full Scr|Developer|Show Start|New Project|Clear Recent/;
export default async (api) => {
  const errs = await api.collect();
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    d.optics.components = [E.createComponent('source.laser', {x: -50, y: 0}), E.createComponent('lens.biconvex', {x: 20, y: 0})];
    s.loadDocument(d, null); s.setSelection('optics', [d.optics.components[1].id]); })()`);
  await api.sleep(300);
  const report = [];
  const menus = await api.eval(`[...document.querySelectorAll('.menubar-btn')].map(b => { const r = b.getBoundingClientRect(); return {t: b.textContent, x: r.x + r.width/2, y: r.y + r.height/2}; })`);
  for (const m of menus) {
    // open menu to list items
    await api.click(m.x, m.y);
    await api.sleep(80);
    const items = await api.eval(`[...document.querySelectorAll('.menu-pop .menu-item')].map(e => ({ l: e.querySelector('.menu-label').textContent, d: e.classList.contains('disabled') }))`);
    await api.key('Escape');
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (SKIP.test(it.l) || it.d) { report.push(`${m.t} > ${it.l}${it.d ? ' (disabled)' : ' (skipped)'}`); continue; }
      await api.click(m.x, m.y);
      await api.sleep(60);
      const pos = await api.eval(`(() => { const e = [...document.querySelectorAll('.menu-pop .menu-item')][${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x + 30, y: r.y + r.height/2, l: e.textContent}; })()`);
      const before = await st(`JSON.stringify({tab: s.tab, ui: s.ui, od: s.opticsDisplay, cd: s.circuitDisplay, sim: s.sim, n: s.doc?.optics.components.length, sel: s.selection, past: s.past.length, view: s.views, speed: s.doc?.circuit.settings.simSpeed})`);
      if (!pos) { report.push(`${m.t} > ${it.l}: MENU DID NOT OPEN`); await api.key("Escape"); continue; }
      await api.click(pos.x, pos.y);
      await api.sleep(150);
      const after = await st(`JSON.stringify({tab: s.tab, ui: s.ui, od: s.opticsDisplay, cd: s.circuitDisplay, sim: s.sim, n: s.doc?.optics.components.length, sel: s.selection, past: s.past.length, view: s.views, speed: s.doc?.circuit.settings.simSpeed})`);
      const open = await api.eval(`!!document.querySelector('.menu-pop')`);
      const modal = await api.eval(`document.querySelector('.dialog .caption')?.textContent ?? null`);
      report.push(`${m.t} > ${it.l}: ${before === after ? 'NO STATE CHANGE' : 'changed'}${open ? ' MENU STILL OPEN' : ''}${modal ? ' modal=' + modal : ''}`);
      if (modal) { await api.key('Escape'); await api.sleep(100); const still = await api.eval(`!!document.querySelector('.dialog')`); if (still) report.push('  modal did not close on Escape'); }
      if (/Run|Pause/.test(it.l)) { await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`); }
    }
  }
  return { report, errs };
};
