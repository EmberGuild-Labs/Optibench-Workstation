// Feature QA: measure tool (click-click distance with snapping, Shift+click angle, list/delete) and
// beam hover picking on a ~50k-segment trace.
// node scripts/dev/cdp.mjs run scripts/dev/qa/feat-measure.mjs
export default async (api) => {
  const errs = await api.collect();
  const out = {};
  await api.eval(`(async () => { const l = await window.optibench.listExamples(); const ex = l.find(e => e.file === '02-lens-focusing.obw'); const f = await window.optibench.openPath(ex.path); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
  await api.sleep(800);
  await api.eval(`__obw.commands.frameAll()`);
  await api.sleep(400);
  const toScreen = (p) => api.eval(`(() => { const s = __obw.useApp.getState(); const v = s.views.optics; const r = document.querySelector('.pane.optics').getBoundingClientRect(); const p = ${JSON.stringify(p)}; return { x: (p.x - v.cx) * v.zoom + r.left + r.width / 2, y: (p.y - v.cy) * v.zoom + r.top + r.height / 2 }; })()`);
  const comps = await api.eval(`__obw.useApp.getState().doc.optics.components.map(c => ({ id: c.id, type: c.type, p: c.position }))`);
  out.components = comps.map((c) => c.type);
  await api.key('m');
  await api.sleep(100);
  // distance: click near (not exactly on) two component centres -> snapped to the centres
  const a = await toScreen(comps[0].p), b = await toScreen(comps[1].p);
  await api.click(a.x + 3, a.y + 2);
  await api.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 30);
  await api.move(b.x - 2, b.y + 3);
  await api.sleep(100);
  await api.click(b.x - 2, b.y + 3);
  await api.sleep(150);
  // angle: Shift+click three points
  const c = await toScreen({ x: comps[1].p.x, y: comps[1].p.y - 40 });
  await api.click(a.x, a.y - 60, { modifiers: 'shift' });
  await api.click(b.x, b.y);
  await api.move(c.x, c.y);
  await api.sleep(100);
  await api.click(c.x, c.y);
  await api.sleep(250);
  out.measurements = await api.eval(`__obw.useApp.getState().measurements.map(m => ({ kind: m.kind, pts: m.points.map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]) }))`);
  out.expectedDist = Math.hypot(comps[1].p.x - comps[0].p.x, comps[1].p.y - comps[0].p.y).toFixed(3);
  out.dockTab = await api.eval(`__obw.useApp.getState().ui.dockTab`);
  out.rows = await api.eval(`[...document.querySelectorAll('.listview tbody tr')].map(r => r.innerText.replace(/\\t/g, ' | '))`);
  await api.shot(process.env.S + '/feat-measure.png');
  // delete the first one from the list with the Delete key
  const row = await api.rect('.listview tbody tr');
  await api.click(row.cx, row.cy);
  await api.key('Delete');
  await api.sleep(150);
  out.afterDelete = await api.eval(`__obw.useApp.getState().measurements.length`);
  out.componentsKept = await api.eval(`__obw.useApp.getState().doc.optics.components.length`);
  await api.key('v');

  // ---- beam pick performance on a large trace (raise rays per source until ~50k segments)
  await api.eval(`(() => { const s = __obw.useApp.getState(); const d = s.doc; s.setOpticsScene({ ...d.optics, settings: { ...d.optics.settings, raysPerSource: 4000 }, components: d.optics.components.map(c => c.type.startsWith('source.') ? { ...c, props: { ...c.props, rays: 4000 } } : c) }, true, 'More rays'); })()`);
  await api.sleep(2500);
  out.bigTrace = await api.eval(`(() => { const tr = __obw.useSim.getState().trace; return tr.segments.length; })()`);
  out.pick = await api.eval(`(() => {
    const rt = document.querySelector('[data-testid=optics-viewport]').__opticsRuntime;
    const tr = __obw.useSim.getState().trace;
    const t0 = performance.now(); rt.picker.pick(tr, { x: 0, y: 0 }, 0.5); const build = performance.now() - t0;
    const t1 = performance.now(); let hits = 0;
    for (let i = 0; i < 2000; i++) { const s = tr.segments[(i * 7919) % tr.segments.length]; if (rt.picker.pick(tr, { x: (s.a.x + s.b.x) / 2 + 0.05, y: (s.a.y + s.b.y) / 2 }, 0.5)) hits++; }
    return { buildMs: +build.toFixed(1), perQueryMs: +((performance.now() - t1) / 2000).toFixed(4), hits };
  })()`);
  // hover over a beam in the big trace
  // an on-screen beam point (midpoint of a long segment inside the visible area, away from components)
  const mid = await api.eval(`(() => { const tr = __obw.useSim.getState().trace; const v = __obw.useApp.getState().views.optics; const r = document.querySelector('.pane.optics').getBoundingClientRect();
    const hw = r.width / 2 / v.zoom * 0.8, hh = r.height / 2 / v.zoom * 0.8; const comps = __obw.useApp.getState().doc.optics.components;
    const ok = (m) => Math.abs(m.x - v.cx) < hw && Math.abs(m.y - v.cy) < hh && comps.every(c => Math.hypot(c.position.x - m.x, c.position.y - m.y) > 30);
    const c = tr.segments.filter(s => s.depth >= 1 && s.power > 0).map(s => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 })).filter(ok); return c[Math.floor(c.length / 2)]; })()`);
  const pm = await toScreen(mid);
  await api.move(pm.x - 2, pm.y);
  await api.move(pm.x, pm.y);
  await api.sleep(700);
  out.bigHover = await api.eval(`(() => { const t = document.querySelector('.pane.optics .obw-tooltip'); return t && !t.hidden ? t.innerText.split('\\n').slice(0, 3).join(' / ') : null; })()`);
  out.frameMs = await api.eval(`document.querySelector('[data-testid=optics-viewport]').dataset.frameMs`);
  await api.shot(process.env.S + '/feat-hover-50k.png');
  out.errors = errs;
  out.logs = await api.eval(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message)`);
  return out;
};
