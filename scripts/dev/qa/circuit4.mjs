// Probe tool + oscilloscope; 7-segment display lit through a resistor.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => {
    const s = __obw.useApp.getState(); const C = __obw.engines.circuitEngine;
    const doc = __obw.project.createEmptyDocument();
    const c = (t, x, y, id, name, props = {}, rotation = 0) => { const k = C.createComponent(t, {x, y}); k.id = id; k.name = name; k.rotation = rotation; Object.assign(k.props, props); return k; };
    doc.circuit.components = [
      c('source.function_gen', -10, 0, 'FG', 'FG1', {frequency: 200}), c('passive.resistor', 0, -6, 'R1', 'R1'), c('misc.ground', 4, 6, 'G', 'GND1'),
      c('source.battery', -10, 16, 'B1', 'BT1', {voltage: 5}), c('passive.resistor', 0, 12, 'R2', 'R2', {resistance: 220}), c('display.7seg', 12, 14, 'SEG', 'DS1'),
    ];
    const pin = (id, n) => C.getPinPositions(doc.circuit.components.find(k => k.id === id)).find(p => p.name === n).p;
    const P = (x, y) => ({x, y});
    doc.circuit.wires = [
      {id: 'w1', points: [pin('FG','+'), P(-12,-6), pin('R1','A')]}, {id: 'w2', points: [pin('R1','B'), P(4,-6), pin('G', C.getPinPositions(doc.circuit.components[2])[0].name)]},
      {id: 'w3', points: [pin('FG','-'), P(-8, 6), pin('G', C.getPinPositions(doc.circuit.components[2])[0].name)]},
      {id: 'w4', points: [pin('B1','+'), P(-12,12), pin('R2','A')]}, {id: 'w5', points: [pin('R2','B'), P(6,12), P(6,10), P(9,10), pin('SEG','a')]},
      {id: 'w6', points: [pin('SEG','COM'), P(18,14), P(18,20), P(-8,20), pin('B1','-')]},
    ];
    s.loadDocument(doc, null); s.setTab('circuit');
  })()`);
  await api.sleep(300);
  const r = await api.rect('.pane.circuit');
  const v = await st('s.views.circuit');
  const toS = (p) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  // probe tool: click on wire w1 middle (-6,-6)
  await api.key('p');
  out.tool = await st('s.tool');
  const q = toS({ x: -6, y: -6 });
  await api.click(q.x, q.y);
  out.probe = await st(`s.doc.circuit.components.filter(c => c.type === 'meter.probe').map(c => c.name)`);
  await api.key('Escape');
  await api.key('F5');
  await api.sleep(1500);
  await api.eval(`__obw.useApp.getState().setUi({dockOpen: true, dockTab: 'scope'})`);
  await api.sleep(500);
  out.scope = await api.eval(`(() => { const c = __obw.useSim.getState().circuit; const p = Object.entries(c.components).find(([k, v]) => v.history); const h = p?.[1].history; return { hasHistory: !!h, n: Array.isArray(h) ? h.length : h?.t?.length, v: p?.[1].voltage }; })()`);
  out.seg = await api.eval(`__obw.useSim.getState().circuit.components.SEG`);
  await api.shot(S + '/c7.png');
  await api.key('F5');
  out.errs = errs;
  return out;
};
