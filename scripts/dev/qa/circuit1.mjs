// Circuit: build battery + resistor + LED through the UI, wire pins, run, check LED.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const A = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); ${e}; return true; })()`);
  const out = {};
  await A(`s.loadDocument(__obw.project.createEmptyDocument(), null)`);
  await A(`s.setTab('circuit')`);
  await api.sleep(300);
  const r = await api.rect('.pane.circuit');
  const v = await st('s.views.circuit');
  const toS = (p) => ({ x: r.x + r.w / 2 + (p.x - v.cx) * v.zoom, y: r.y + r.h / 2 + (p.y - v.cy) * v.zoom });
  const place = async (type, x, y) => { await A(`s.startPlace('circuit','${type}')`); const q = toS({ x, y }); await api.click(q.x, q.y); await A(`s.setTool('select')`); return st('s.doc.circuit.components.at(-1)'); };
  const pins = (id) => api.eval(`__obw.engines.circuitEngine.getPinPositions(__obw.useApp.getState().doc.circuit.components.find(c => c.id === '${id}'))`);
  const bat = await place('source.battery', -8, 0);
  const res = await place('passive.resistor', 0, -6);
  const led = await place('semi.led', 8, 0);
  out.comps = [bat, res, led].map((c) => `${c.type}@${c.position.x},${c.position.y} ${c.id}`);
  const pb = await pins(bat.id), pr = await pins(res.id), pl = await pins(led.id);
  out.pins = { pb, pr, pl };
  const wire = async (a, b) => {
    const s = toS(a), t = toS(b);
    await api.click(s.x, s.y);
    await api.sleep(30);
    await api.move((s.x + t.x) / 2, (s.y + t.y) / 2);
    await api.click(t.x, t.y);
    await api.sleep(50);
  };
  const bPlus = pb.find((p) => p.name === '+') ?? pb[0], bMinus = pb.find((p) => p.name === '-') ?? pb[1];
  await wire(bPlus.p, pr[0].p);
  await wire(pr[1].p, pl[0].p);
  await wire(pl[1].p, bMinus.p);
  out.wires = await st('s.doc.circuit.wires.map(w => w.points.map(p => p.x + "," + p.y).join(" "))');
  out.past = await st('s.past.map(e => e.label)');
  const nl = await api.eval(`(() => { const d = __obw.useApp.getState().doc; return 0; })()`);
  await api.shot(S + '/c1.png');
  // run
  await api.key('F5');
  await api.sleep(1500);
  out.state = await api.eval(`(() => { const c = __obw.useSim.getState().circuit; if (!c) return null; return { t: c.time, conv: c.converged, err: c.error, led: c.components['${led.id}'], nets: c.pinNets }; })()`);
  out.status = await st('s.sim.status');
  await api.shot(S + '/c2.png');
  await api.key('F5');
  out.errs = errs;
  return out;
};
