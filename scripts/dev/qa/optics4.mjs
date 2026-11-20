// Fiber end handle drag, Escape cancels a drag (no undo entry), space-pan, locked component.
export default async (api) => {
  const errs = await api.collect();
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    const f = E.createComponent('fiber.cable', {x: -50, y: 0}); const l = E.createComponent('lens.biconvex', {x: 60, y: 30}); l.locked = true;
    d.optics.components = [f, l]; s.loadDocument(d, null); s.setSelection('optics', [f.id]); s.setView('optics', {cx: 0, cy: 0, zoom: 2}); })()`);
  await api.sleep(300);
  const r = await api.rect('.pane.optics');
  const v = await st('s.views.optics');
  const toS = (p) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  const f0 = await st('s.doc.optics.components[0]');
  out.f0 = { pos: f0.position, end: [f0.props.endX, f0.props.endY] };
  const geomHandles = await api.eval(`__obw.engines.opticsEngine.getGeometry(__obw.useApp.getState().doc.optics.components[0]).handles`);
  out.handles = geomHandles;
  const h = toS(geomHandles[0].p);
  await api.drag(h.x, h.y, h.x + 40, h.y + 60, { steps: 8 });
  const f1 = await st('s.doc.optics.components[0]');
  out.f1 = { pos: f1.position, end: [f1.props.endX, f1.props.endY], past: await st('s.past.length') };
  // drag body then Escape mid-drag
  const p = toS(f1.position);
  const past0 = await st('s.past.length');
  await api.move(p.x, p.y); await api.mouse('mousePressed', p.x, p.y, { down: true });
  for (let i = 1; i <= 5; i++) await api.mouse('mouseMoved', p.x + 10 * i, p.y, { down: true });
  await api.key('Escape');
  await api.mouse('mouseReleased', p.x + 50, p.y, {});
  out.esc = { pos: await st('s.doc.optics.components[0].position'), past: (await st('s.past.length')) - past0, pb: await st('!!s.previewBase'), sel: await st('s.selection.optics.length') };
  // locked lens: drag should not move it
  const lp = toS({ x: 60, y: 30 });
  await api.drag(lp.x, lp.y, lp.x + 50, lp.y, { steps: 5 });
  out.locked = { pos: await st('s.doc.optics.components[1].position'), past: (await st('s.past.length')) - past0 };
  // space pan
  await api.key('Space', { hold: true });
  await api.drag(r.cx, r.cy, r.cx + 80, r.cy + 40, { steps: 5 });
  await api.keyUp('Space');
  out.spacePan = await st('s.views.optics');
  out.errs = errs;
  return out;
};
