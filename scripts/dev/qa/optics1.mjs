// Optics viewport: place, drag accuracy across zoom/pan/DPR, undo steps.
export default async (api, args) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  if (args[0]) await api.dpr(+args[0]);
  await api.sleep(300);
  await api.eval(`__obw.useApp.getState().loadDocument(__obw.project.createEmptyDocument(), null)`);
  await api.sleep(300);
  const r = await api.rect('.pane.optics');
  out.pane = r;
  // place laser via palette click + click in viewport
  await api.eval(`__obw.useApp.getState().startPlace('optics','source.laser')`);
  await api.click(r.x + 200, r.cy);
  await api.sleep(100);
  out.afterPlace = await st(`({n: s.doc.optics.components.length, c: s.doc.optics.components[0], sel: s.selection.optics, past: s.past.length, view: s.views.optics, tool: s.tool})`);
  const view = out.afterPlace.view;
  const expectX = (200 - r.w / 2) / view.zoom + view.cx, expectY = (r.cy - r.y - r.h / 2) / view.zoom + view.cy;
  out.placeErr = { dx: out.afterPlace.c.position.x - expectX, dy: out.afterPlace.c.position.y - expectY };
  await api.eval(`__obw.useApp.getState().setTool('select')`);
  // drag-test at several views
  const tests = [];
  for (const v of [null, { cx: 37, cy: -21, zoom: 3.7 }, { cx: -10, cy: 5, zoom: 0.8 }]) {
    if (v) await api.eval(`__obw.useApp.getState().setView('optics', ${JSON.stringify(v)})`);
    await api.sleep(100);
    const s0 = await st(`({c: s.doc.optics.components[0], view: s.views.optics, past: s.past.length})`);
    const z = s0.view.zoom;
    const sx = r.x + r.w / 2 + (s0.c.position.x - s0.view.cx) * z, sy = r.y + r.h / 2 + (s0.c.position.y - s0.view.cy) * z;
    const DX = 120, DY = 70;
    // track positions during drag
    await api.move(sx, sy);
    await api.mouse('mousePressed', sx, sy, { down: true });
    const trail = [];
    for (let i = 1; i <= 10; i++) {
      await api.mouse('mouseMoved', sx + DX * i / 10, sy + DY * i / 10, { down: true });
      const p = await st(`s.doc.optics.components[0].position`);
      trail.push([+(p.x - s0.c.position.x - DX * i / 10 / z).toFixed(2), +(p.y - s0.c.position.y - DY * i / 10 / z).toFixed(2)]);
    }
    await api.mouse('mouseReleased', sx + DX, sy + DY, {});
    const s1 = await st(`({c: s.doc.optics.components[0], past: s.past.length, label: s.past.at(-1)?.label, pb: !!s.previewBase})`);
    tests.push({ zoom: z, errEnd: [+(s1.c.position.x - s0.c.position.x - DX / z).toFixed(2), +(s1.c.position.y - s0.c.position.y - DY / z).toFixed(2)], trail, undoSteps: s1.past - s0.past, label: s1.label, previewBase: s1.pb });
  }
  out.tests = tests;
  await api.shot(S + '/o1.png');
  if (args[0]) await api.dpr(0);
  out.errs = errs;
  return out;
};
