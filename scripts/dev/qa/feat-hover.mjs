// Feature QA: hover a light beam / component / detector on the optics bench, then a wire / pin on a running circuit.
// node scripts/dev/cdp.mjs run scripts/dev/qa/feat-hover.mjs
export default async (api) => {
  const errs = await api.collect();
  const open = async (file) => {
    await api.eval(`(async () => { const l = await window.optibench.listExamples(); const ex = l.find(e => e.file === ${JSON.stringify(file)}); const f = await window.optibench.openPath(ex.path); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
    await api.sleep(900);
  };
  const toScreen = (domain, p) => api.eval(`(() => { const s = __obw.useApp.getState(); const v = s.views[${JSON.stringify(domain)}]; const el = document.querySelector('.pane.${domain}'); const r = el.getBoundingClientRect(); const p = ${JSON.stringify(p)}; return { x: (p.x - v.cx) * v.zoom + r.left + r.width / 2, y: (p.y - v.cy) * v.zoom + r.top + r.height / 2 }; })()`);
  const tipText = (sel) => api.eval(`(() => { const t = document.querySelector(${JSON.stringify(sel)} + ' .obw-tooltip'); return t && !t.hidden ? t.innerText : null; })()`);
  const out = {};

  await open('01-prism-rainbow.obw');
  await api.eval(`__obw.commands.frameAll()`);
  await api.sleep(500);
  // pick a long, bright beam segment between the prism and the fold mirror
  const seg = await api.eval(`(() => { const tr = __obw.useSim.getState().trace; const segs = tr.segments.filter(s => s.depth >= 2 && s.power > 0).map(s => ({ s, L: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) })).sort((a, b) => b.L - a.L); const s = segs[Math.floor(segs.length / 3)].s; return { mid: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, n: tr.segments.length, wl: s.wavelength }; })()`);
  const p = await toScreen('optics', seg.mid);
  await api.move(p.x - 3, p.y);
  await api.move(p.x, p.y);
  await api.sleep(700);
  out.beam = await tipText('.pane.optics');
  out.segments = seg.n;
  await api.shot('docs/screenshots/feat-hover.png');

  // component (detector) hover -> live reading
  const spec = await api.eval(`(() => { const c = __obw.useApp.getState().doc.optics.components.find(c => c.id === 'spec'); return c.position; })()`);
  const ps = await toScreen('optics', spec);
  await api.move(ps.x + 2, ps.y + 1);
  await api.move(ps.x, ps.y);
  await api.sleep(700);
  out.detector = await tipText('.pane.optics');
  await api.shot(process.env.S + '/feat-hover-detector.png');
  const prism = await toScreen('optics', { x: 0, y: 8 });
  await api.move(prism.x, prism.y);
  await api.sleep(150);
  out.prism = await tipText('.pane.optics');

  // beam info overlay
  await api.eval(`__obw.useApp.getState().setOpticsDisplay({ beamInfo: true })`);
  await api.move(10, 10);
  await api.sleep(400);
  await api.shot(process.env.S + '/feat-beaminfo.png');
  await api.eval(`__obw.useApp.getState().setOpticsDisplay({ beamInfo: false })`);

  // circuit: wire + pin while running
  await open('05-blinking-led-555.obw');
  await api.eval(`__obw.commands.frameAll()`);
  await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
  await api.sleep(1500);
  const wire = await api.eval(`(() => { const w = __obw.useApp.getState().doc.circuit.wires.find(w => w.points.length >= 2 && (Math.abs(w.points[0].x - w.points[1].x) + Math.abs(w.points[0].y - w.points[1].y)) >= 2); const a = w.points[0], b = w.points[1]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })()`);
  const pw = await toScreen('circuit', wire);
  await api.move(pw.x + 1, pw.y);
  await api.move(pw.x, pw.y);
  await api.sleep(700);
  out.wire = await tipText('.pane.circuit');
  await api.shot(process.env.S + '/feat-hover-wire.png');
  const pin = await api.eval(`(() => { const c = __obw.useApp.getState().doc.circuit.components.find(c => c.id === 'led'); return __obw.engines.circuitEngine.getPinPositions(c)[0].p; })()`);
  const pp = await toScreen('circuit', pin);
  await api.move(pp.x, pp.y);
  await api.sleep(200);
  out.pin = await tipText('.pane.circuit');
  await api.shot(process.env.S + '/feat-hover-pin.png');
  await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
  await api.move(5, 5);
  out.errors = errs;
  out.logs = await api.eval(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message)`);
  return out;
};
