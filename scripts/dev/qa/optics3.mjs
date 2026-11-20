// Optics: rotate handle, nudge, marquee, shift-select, clipboard, R, measure, fiber handle, undo counts.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const A = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); ${e}; return true; })()`);
  const out = {};
  await A(`s.loadDocument(__obw.project.createEmptyDocument(), null)`);
  await api.sleep(200);
  const r = await api.rect('.pane.optics');
  const v = await st('s.views.optics');
  const toS = (p) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  const add = async (type, x, y) => { await A(`s.startPlace('optics','${type}')`); const q = toS({ x, y }); await api.click(q.x, q.y); await A(`s.setTool('select')`); return st('s.doc.optics.components.at(-1)'); };
  const L = await add('source.laser', -150, 0);
  const lens = await add('lens.biconvex', -60, 0);
  const pr = await add('prism.equilateral', 20, 0);
  const scr = await add('detector.screen', 120, 0);
  out.count = await st('s.doc.optics.components.length');
  out.past = await st('s.past.length');
  // rotate handle on lens
  const lp = toS(lens.position);
  await api.click(lp.x, lp.y);
  const knob = await api.eval(`(() => { const rt = [...document.querySelectorAll('.pane.optics *')].find(e => e.__opticsRuntime).__opticsRuntime; const c = __obw.useApp.getState().doc.optics.components.find(c => c.id === '${lens.id}'); const g = rt.geoms.get(c.id); let R = 4; for (const p of g.paths) for (const q of p.points) R = Math.max(R, Math.hypot(q.x - c.position.x, q.y - c.position.y)); R += 26 / ${v.zoom}; return { x: c.position.x + Math.sin(c.rotation) * R, y: c.position.y - Math.cos(c.rotation) * R }; })()`);
  const ks = toS(knob);
  const past0 = await st('s.past.length');
  // drag knob 90deg clockwise around lens center
  const Rk = Math.hypot(ks.x - lp.x, ks.y - lp.y);
  await api.move(ks.x, ks.y);
  await api.mouse('mousePressed', ks.x, ks.y, { down: true });
  for (let i = 1; i <= 10; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / 10; await api.mouse('mouseMoved', lp.x + Math.cos(a) * Rk, lp.y + Math.sin(a) * Rk, { down: true }); }
  await api.mouse('mouseReleased', lp.x + Rk, lp.y, {});
  out.rotate = await st(`({rot: s.doc.optics.components.find(c => c.id === '${lens.id}').rotation, steps: s.past.length - ${past0}, label: s.past.at(-1).label, pos: s.doc.optics.components.find(c => c.id === '${lens.id}').position})`);
  // undo rotation
  await api.key('z', { modifiers: 'ctrl' });
  out.afterUndo = await st(`s.doc.optics.components.find(c => c.id === '${lens.id}').rotation`);
  // nudge with arrow keys (focus viewport by clicking lens)
  await api.click(lp.x, lp.y);
  const p1 = await st('s.past.length');
  await api.key('ArrowRight'); await api.key('ArrowRight'); await api.key('ArrowDown', { modifiers: 'shift' });
  out.nudge = await st(`({pos: s.doc.optics.components.find(c => c.id === '${lens.id}').position, steps: s.past.length - ${p1}})`);
  // R rotate
  await api.key('r');
  out.R = await st(`({rot: s.doc.optics.components.find(c => c.id === '${lens.id}').rotation})`);
  // shift-select
  await api.click(toS(pr.position).x, toS(pr.position).y, { modifiers: 'shift' });
  out.shiftSel = await st('s.selection.optics.length');
  // marquee all
  await api.drag(r.x + 10, r.y + 10, r.x + r.w - 10, r.y + r.h - 10);
  out.marquee = await st('s.selection.optics.length');
  // click empty clears
  await api.click(r.x + 20, r.y + r.h - 20);
  out.cleared = await st('s.selection.optics.length');
  // copy/paste/duplicate/delete via keys
  await api.click(toS(scr.position).x, toS(scr.position).y);
  await api.key('c', { modifiers: 'ctrl' });
  await api.key('v', { modifiers: 'ctrl' });
  out.paste = await st('({n: s.doc.optics.components.length, sel: s.selection.optics})');
  await api.key('d', { modifiers: 'ctrl' });
  out.dup = await st('({n: s.doc.optics.components.length})');
  await api.key('Delete');
  out.del = await st('({n: s.doc.optics.components.length})');
  await api.key('z', { modifiers: 'ctrl' });
  out.undoDel = await st('({n: s.doc.optics.components.length})');
  await api.key('y', { modifiers: 'ctrl' });
  out.redoDel = await st('({n: s.doc.optics.components.length})');
  // measure tool
  await A(`s.setTool('measure')`);
  await api.drag(r.x + 100, r.y + 100, r.x + 300, r.y + 100);
  out.measure = await api.eval(`(() => { const rt = [...document.querySelectorAll('.pane.optics *')].find(e => e.__opticsRuntime).__opticsRuntime; return rt.ui.measure; })()`);
  await api.shot(S + '/o3.png');
  await A(`s.setTool('select')`);
  out.trace = await api.eval(`(() => { const t = __obw.useSim.getState().trace; return t && { segs: t.segments.length, det: Object.fromEntries(Object.entries(t.detectors).map(([k, d]) => [k, d.power])) }; })()`);
  out.errs = errs;
  return out;
};
