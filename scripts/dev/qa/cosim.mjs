// Co-sim: create links via the inspector Links UI, run, check coupling.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => {
    const s = __obw.useApp.getState(); const O = __obw.engines.opticsEngine, C = __obw.engines.circuitEngine;
    const doc = __obw.project.createEmptyDocument();
    const o = (t, x, y, id, props = {}) => { const c = O.createComponent(t, {x, y}); c.id = id; Object.assign(c.props, props); return c; };
    const c = (t, x, y, id, name, props = {}, rotation = 0) => { const k = C.createComponent(t, {x, y}); k.id = id; k.name = name; k.rotation = rotation; Object.assign(k.props, props); return k; };
    doc.optics.components = [o('source.laser', -100, 0, 'OL'), o('detector.photodiode', 60, 0, 'OD'), o('magneto.faraday', -20, 0, 'OF')];
    doc.circuit.components = [
      c('source.battery', -8, 0, 'B1', 'BT1', {voltage: 5}), c('passive.resistor', 0, -6, 'R1', 'R1', {resistance: 47}), c('opto.laser_diode', 8, 0, 'LD', 'LD1'),
      c('source.battery', -8, 14, 'B2', 'BT2', {voltage: 5}), c('opto.photodiode', 0, 8, 'PD', 'PD1'), c('passive.resistor', 8, 14, 'R2', 'R2', {resistance: 10000}),
      c('source.battery', -8, 24, 'B3', 'BT3', {voltage: 1}), c('opto.coil', 8, 24, 'CO', 'L1'),
    ];
    const pin = (id, n) => C.getPinPositions(doc.circuit.components.find(k => k.id === id)).find(p => p.name === n).p;
    const W = (id, ...pts) => ({ id, points: pts });
    const P = (x, y) => ({x, y});
    doc.circuit.wires = [
      W('w1', pin('B1','+'), P(-10,-6), pin('R1','A')), W('w2', pin('R1','B'), P(6,-6), pin('LD','A')), W('w3', pin('LD','K'), P(10,3), P(-6,3), pin('B1','-')),
      // photodiode reverse biased: B2+ -> R2 -> PD K ; PD A -> B2-
      W('w4', pin('B2','+'), P(-10,18), P(12,18), P(12,14), pin('R2','B')), W('w5', pin('R2','A'), P(6,8), pin('PD','B' in {} ? 'B' : 'K')), W('w6', pin('PD','A'), P(-6,8), pin('B2','-')),
      W('w7', pin('B3','+'), P(-10,28), P(10,28), pin('CO','B')), W('w8', pin('CO','A'), P(-6,24), pin('B3','-')),
    ];
    s.loadDocument(doc, null);
    s.setTab('split');
  })()`);
  await api.sleep(400);
  // emitter link via inspector: select laser diode, click "Add emitter link"
  const clickBtn = async (re) => {
    const p = await api.eval(`(() => { const b = [...document.querySelectorAll('.inspector button')].find(b => ${re}.test(b.textContent)); if (!b) return null; b.scrollIntoView({block:'center'}); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, dis: b.disabled}; })()`);
    if (p) await api.click(p.x, p.y);
    await api.sleep(150);
    return p;
  };
  await api.eval(`__obw.useApp.getState().setSelection('circuit', ['LD'])`);
  await api.sleep(200);
  out.btn1 = await clickBtn('/Add emitter link/');
  await api.eval(`__obw.useApp.getState().setSelection('circuit', ['PD'])`);
  await api.sleep(200);
  out.btn2 = await clickBtn('/Add detector link/');
  await api.eval(`__obw.useApp.getState().setSelection('circuit', ['CO'])`);
  await api.sleep(200);
  out.btn3 = await clickBtn('/Add actuator link/');
  out.links = await st('s.doc.links');
  await api.shot(S + '/cs1.png');
  await api.key('F5');
  await api.sleep(1500);
  const snap = () => api.eval(`(() => { const c = __obw.useSim.getState().circuit, t = __obw.useSim.getState().trace; return { conv: c?.converged, ldOpt: c?.components.LD?.opticalPower, ldI: c?.components.LD?.current, pdI: c?.components.PD?.current, coI: c?.components.CO?.current, det: t?.detectors?.OD?.power, srcSeg: t?.segments.filter(s => s.sourceId === 'OL').reduce((a, s) => Math.max(a, s.power), 0), src: __obw.useSim.getState().traceSource }; })()`);
  out.run = await snap();
  // change R1 to raise current
  await api.eval(`(() => { const s = __obw.useApp.getState(); s.setCircuitScene({...s.doc.circuit, components: s.doc.circuit.components.map(c => c.id === 'R1' ? {...c, props: {...c.props, resistance: 30}} : c)}, true, 'R'); })()`);
  await api.sleep(800);
  out.run2 = await snap();
  await api.shot(S + '/cs2.png');
  await api.key('F5');
  out.errs = errs;
  out.logs = await st('s.logs.filter(l => l.level !== "info").map(l => l.message)');
  return out;
};
