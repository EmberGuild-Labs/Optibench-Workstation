// Optics: wheel anchoring, rotate handle, nudge, marquee, shift-select, clipboard, R, measure, palette DnD.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const A = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); ${e}; return true; })()`);
  const out = {};
  await A(`s.loadDocument(__obw.project.createEmptyDocument(), null)`);
  await api.sleep(200);
  const r = await api.rect('.pane.optics');
  const toS = (p, v) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  // --- palette drag & drop via CDP drag interception
  const item = await api.eval(`(() => { const b = [...document.querySelectorAll('.palette-item')].find(b => b.textContent.includes('Laser')); const q = b.getBoundingClientRect(); return {x: q.x + q.width/2, y: q.y + q.height/2}; })()`);
  await api.send('Input.setInterceptDrags', { enabled: true });
  let dragData = null;
  api.on((m) => { if (m.method === 'Input.dragIntercepted') dragData = m.params.data; });
  await api.move(item.x, item.y);
  await api.mouse('mousePressed', item.x, item.y, { down: true });
  for (let i = 1; i <= 5; i++) await api.mouse('mouseMoved', item.x + i * 20, item.y, { down: true });
  await api.sleep(200);
  const tx = r.x + 150, ty = r.y + 120;
  if (dragData) {
    await api.send('Input.dispatchDragEvent', { type: 'dragEnter', x: tx, y: ty, data: dragData });
    await api.send('Input.dispatchDragEvent', { type: 'dragOver', x: tx, y: ty, data: dragData });
    await api.send('Input.dispatchDragEvent', { type: 'drop', x: tx, y: ty, data: dragData });
  }
  await api.mouse('mouseReleased', tx, ty, {});
  await api.send('Input.setInterceptDrags', { enabled: false });
  await api.sleep(150);
  const v0 = await st('s.views.optics');
  const dropped = await st('s.doc.optics.components.at(-1)');
  out.dnd = { got: !!dragData, pos: dropped?.position, expect: { x: (tx - r.x - r.w / 2) / v0.zoom + v0.cx, y: (ty - r.y - r.h / 2) / v0.zoom + v0.cy } };

  // --- wheel anchoring: point under cursor stays put
  const px = r.x + 600, py = r.y + 400;
  const wBefore = { x: (px - r.x - r.w / 2) / v0.zoom + v0.cx, y: (py - r.y - r.h / 2) / v0.zoom + v0.cy };
  for (let i = 0; i < 3; i++) { await api.wheel(px, py, -120); await api.sleep(30); }
  await api.sleep(800);
  const v1 = await st('s.views.optics');
  const wAfter = { x: (px - r.x - r.w / 2) / v1.zoom + v1.cx, y: (py - r.y - r.h / 2) / v1.zoom + v1.cy };
  out.wheel = { zoom0: v0.zoom, zoom1: v1.zoom, drift: [wAfter.x - wBefore.x, wAfter.y - wBefore.y] };
  // pan with middle drag
  await api.drag(r.cx, r.cy, r.cx + 100, r.cy + 50, { button: 'middle' });
  const v2 = await st('s.views.optics');
  out.pan = { dcx: (v2.cx - v1.cx) * v2.zoom, dcy: (v2.cy - v1.cy) * v2.zoom };
  await A(`s.setView('optics', {cx:0, cy:0, zoom:2})`);
  await api.sleep(100);
  const v = await st('s.views.optics');

  // --- rotate handle: select laser, find knob via runtime
  const c = dropped;
  const p = toS(c.position, v);
  await api.click(p.x, p.y);
  await api.sleep(100);
  const knob = await api.eval(`(() => { const rt = document.querySelector('.pane.optics [tabindex]')?.__opticsRuntime ?? [...document.querySelectorAll('.pane.optics *')].find(e => e.__opticsRuntime)?.__opticsRuntime; return !!rt; })()`);
  out.rtFound = knob;
  out.sel = await st('s.selection.optics');
  // scan for the handle by hovering around the component
  let found = null;
  for (let dy = -80; dy <= 80 && !found; dy += 4) for (let dx = -80; dx <= 80 && !found; dx += 4) {
    // too many moves; instead check cursor style along a coarse grid
  }
  await api.shot(S + '/o2.png');
  out.errs = errs;
  return out;
};
