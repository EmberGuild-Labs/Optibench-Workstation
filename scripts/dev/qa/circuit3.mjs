// Circuit editing: drag move (undo steps, connectivity), R, menu rotate, inspector rotate/mirror/position, segment drag, marquee, delete, paste.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => {
    const s = __obw.useApp.getState(); const C = __obw.engines.circuitEngine;
    const doc = __obw.project.createEmptyDocument();
    const c = (t, x, y, id, name, props = {}) => { const k = C.createComponent(t, {x, y}); k.id = id; k.name = name; Object.assign(k.props, props); return k; };
    doc.circuit.components = [c('source.battery', -8, 0, 'B1', 'BT1'), c('passive.resistor', 0, -6, 'R1', 'R1'), c('semi.led', 8, 0, 'D1', 'LED1')];
    const pin = (id, n) => C.getPinPositions(doc.circuit.components.find(k => k.id === id)).find(p => p.name === n).p;
    const P = (x, y) => ({x, y});
    doc.circuit.wires = [{id: 'w1', points: [pin('B1','+'), P(-10,-6), pin('R1','A')]}, {id: 'w2', points: [pin('R1','B'), P(6,-6), pin('D1','A')]}, {id: 'w3', points: [pin('D1','K'), P(10,3), P(-6,3), pin('B1','-')]}];
    s.loadDocument(doc, null); s.setTab('circuit');
  })()`);
  await api.sleep(300);
  const nets = () => api.eval(`(() => { const d = __obw.useApp.getState().doc; const nl = __obw.engines.circuitEngine.createSimulator(d.circuit).step(1e-4).pinNets; const g = {}; for (const [k, v] of Object.entries(nl)) (g[v] ??= []).push(k); return Object.values(g).map(a => a.sort().join('+')).sort().join(' | '); })()`);
  out.nets0 = await nets();
  const r = await api.rect('.pane.circuit');
  const v = await st('s.views.circuit');
  const toS = (p) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  // drag resistor body by (+3, -2) grid
  const rp = toS({ x: 0, y: -6 });
  const p0 = await st('s.past.length');
  await api.drag(rp.x, rp.y, rp.x + 3 * v.zoom, rp.y - 2 * v.zoom, { steps: 15 });
  out.drag = await st(`({pos: s.doc.circuit.components.find(c => c.id === 'R1').position, steps: s.past.length - ${p0}, label: s.past.at(-1).label, pb: !!s.previewBase})`);
  out.netsAfterDrag = (await nets()) === out.nets0;
  // R key (viewport)
  await api.key('r');
  out.netsAfterR = (await nets()) === out.nets0;
  // menu rotate (store path)
  await api.eval(`__obw.useApp.getState().rotateSelection(1)`);
  out.netsAfterMenuRotate = (await nets()) === out.nets0;
  // inspector rotation / mirror / position on the LED
  await api.eval(`__obw.useApp.getState().setSelection('circuit', ['D1'])`);
  await api.sleep(150);
  const segBtn = await api.eval(`(() => { const b = [...document.querySelectorAll('.inspector .seg button')].find(b => b.textContent.trim() === '180°'); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(segBtn.x, segBtn.y);
  out.netsAfterInspRotate = (await nets()) === out.nets0;
  const mir = await api.eval(`(() => { const row = [...document.querySelectorAll('.inspector .insp-row')].find(r => r.textContent.startsWith('Mirrored')); const b = row.querySelector('button'); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(mir.x, mir.y);
  out.netsAfterMirror = (await nets()) === out.nets0;
  const px = await api.eval(`(() => { const row = [...document.querySelectorAll('.inspector .insp-row')].find(r => r.textContent.startsWith('Position')); const b = row.querySelector('input'); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(px.x, px.y); await api.key('a', { modifiers: 'ctrl' }); await api.type('14'); await api.key('Enter');
  out.netsAfterPos = (await nets()) === out.nets0;
  out.d1 = await st(`s.doc.circuit.components.find(c => c.id === 'D1')`);
  // segment drag on w3 bottom segment
  const wires = await st('s.doc.circuit.wires');
  out.wires = wires.map((w) => w.id + ':' + w.points.map((p) => p.x + ',' + p.y).join(' '));
  await api.shot(S + '/c5.png');
  // marquee select all then delete then undo
  await api.drag(r.x + 5, r.y + 5, r.x + r.w - 5, r.y + r.h - 5, { steps: 6 });
  out.marquee = await st('s.selection.circuit.length');
  await api.key('Delete');
  out.afterDel = await st('[s.doc.circuit.components.length, s.doc.circuit.wires.length]');
  await api.key('z', { modifiers: 'ctrl' });
  out.afterUndo = await st('[s.doc.circuit.components.length, s.doc.circuit.wires.length]');
  out.netsAfterUndo = (await nets()) === out.nets0;
  // copy/paste whole circuit
  await api.key('a', { modifiers: 'ctrl' });
  await api.key('c', { modifiers: 'ctrl' });
  await api.key('v', { modifiers: 'ctrl' });
  out.afterPaste = await st('[s.doc.circuit.components.length, s.doc.circuit.wires.length, s.selection.circuit.length]');
  await api.shot(S + '/c6.png');
  out.errs = errs;
  return out;
};
