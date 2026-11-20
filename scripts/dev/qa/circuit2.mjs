// Circuit: T-junction wire ending on a wire, waypoints, switch toggle while running, pot, probe/scope.
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
  const pins = async (c) => Object.fromEntries((await api.eval(`__obw.engines.circuitEngine.getPinPositions(__obw.useApp.getState().doc.circuit.components.find(c => c.id === '${c.id}'))`)).map((p) => [p.name, p.p]));
  const clickW = async (p) => { const q = toS(p); await api.move(q.x + 3, q.y + 3); await api.click(q.x, q.y); await api.sleep(30); };
  const bat = await place('source.battery', -12, 0);
  const sw = await place('switch.spst', -4, -6);
  const r1 = await place('passive.resistor', 6, -6);
  const led1 = await place('semi.led', 12, 0);
  const pot = await place('passive.potentiometer', 6, 6);
  const led2 = await place('semi.led', 12, 6);
  const B = await pins(bat), SW = await pins(sw), R1 = await pins(r1), L1 = await pins(led1), PT = await pins(pot), L2 = await pins(led2);
  out.pins = { B, SW, R1, L1, PT, L2 };
  const n = (o) => Object.values(o);
  // wire with waypoint: bat+ -> waypoint above -> switch pin 1
  await clickW(n(B)[0]); await clickW({ x: n(B)[0].x, y: -6 }); await clickW(n(SW)[0]);
  await clickW(n(SW)[1]); await clickW(n(R1)[0]);
  await clickW(n(R1)[1]); await clickW({ x: 10, y: -6 }); await clickW(L1.A ?? n(L1)[0]);
  // return: led1 K -> down to y=10 -> left to bat-
  await clickW(L1.K ?? n(L1)[1]); await clickW({ x: 16, y: 0 }); await clickW({ x: 16, y: 10 }); await clickW({ x: n(B)[1].x, y: 10 }); await clickW(n(B)[1]);
  // T-junction: from pot pin A, end on the middle of the wire between switch and R1 (y=-6)
  const pa = n(PT)[0];
  await clickW(pa); await clickW({ x: 0, y: pa.y }); await clickW({ x: 0, y: -6 });
  // pot other end -> led2 A ; led2 K -> T into return wire at y=10
  const pb = n(PT)[1];
  await clickW(pb); await clickW(L2.A ?? n(L2)[0]);
  await clickW(L2.K ?? n(L2)[1]); await clickW({ x: 14, y: (L2.K ?? n(L2)[1]).y }); await clickW({ x: 14, y: 10 });
  out.wires = await st('s.doc.circuit.wires.map(w => w.id + ": " + w.points.map(p => p.x + "," + p.y).join(" "))');
  out.labels = await st('s.past.map(e => e.label).join(" | ")');
  // engine netlist
  out.nets = await api.eval(`(() => { const d = __obw.useApp.getState().doc; const sim = __obw.engines.circuitEngine.createSimulator(d.circuit); return sim.step(1e-3).pinNets; })()`);
  await api.shot(S + '/c3.png');
  await api.key('F5');
  await api.sleep(1000);
  const led = () => api.eval(`(() => { const c = __obw.useSim.getState().circuit; return c && { l1: c.components['${led1.id}']?.brightness, l2: c.components['${led2.id}']?.brightness, sw: c.components['${sw.id}']?.on, conv: c.converged }; })()`);
  out.run1 = await led();
  // toggle switch by clicking its body
  const sp = toS(sw.position);
  await api.click(sp.x, sp.y);
  await api.sleep(600);
  out.afterToggle = await led();
  await api.click(sp.x, sp.y);
  await api.sleep(600);
  out.afterToggle2 = await led();
  // pot: wheel over it
  const pp = toS(pot.position);
  for (let i = 0; i < 6; i++) { await api.wheel(pp.x, pp.y, 100); await api.sleep(40); }
  await api.sleep(500);
  out.afterPot = await led();
  out.potState = await api.eval(`__obw.useSim.getState().circuit.components['${pot.id}']`);
  await api.shot(S + '/c4.png');
  out.docPotProps = await st(`s.doc.circuit.components.find(c => c.id === '${pot.id}').props`);
  out.status = await st('s.sim.status');
  out.errs = errs;
  return out;
};
