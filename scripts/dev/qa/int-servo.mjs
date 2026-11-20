// Example 14: the servo turns the mirror (actuator link 'rotation'); the live view draws the driven
// copy (useSim.drivenScene) without touching the document. Samples the mirror angle over time.
// usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-servo.mjs
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const list = await ev(`window.optibench.listExamples()`);
  const ex = list.find((e) => e.file.startsWith('14-'));
  await ev(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); __obw.commands.setOpticsDim('2d'); })()`);
  await api.sleep(700);
  const link = await ev(`__obw.useApp.getState().doc.links.find(l => l.targetProp === 'rotation')`);
  const docRot = await ev(`__obw.useApp.getState().doc.optics.components.find(c => c.id === ${JSON.stringify(link.opticsId)}).rotation`);
  await ev(`__obw.useApp.getState().setSimStatus('running')`);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await api.sleep(400);
    samples.push(await ev(`(() => { const sim = __obw.useSim.getState(); const d = sim.drivenScene; const c = d?.components.find(c => c.id === ${JSON.stringify(link.opticsId)}); const st = sim.circuit?.components[${JSON.stringify(link.circuitId)}]; return { t: +sim.time.toFixed(2), drivenDeg: c ? +(c.rotation * 180 / Math.PI).toFixed(2) : null, servoDeg: st ? +Number(st.angleDeg).toFixed(2) : null, docRot: __obw.useApp.getState().doc.optics.components.find(c => c.id === ${JSON.stringify(link.opticsId)}).rotation }; })()`));
    if (i === 3) await api.shot('docs/screenshots/int-servo.png');
    if (i === 5) await api.shot(process.env.S + '/int-servo-b.png');
  }
  // 3D view of the sweep
  await ev(`__obw.commands.setOpticsDim('3d')`);
  await api.sleep(1500);
  const s3 = await ev(`(() => { const sim = __obw.useSim.getState(); return { tr3: sim.trace3d?.stats.segments, driven: !!sim.drivenScene }; })()`);
  await api.shot(process.env.S + '/int-servo-3d.png');
  await ev(`__obw.useApp.getState().setSimStatus('stopped'); __obw.commands.setOpticsDim('2d')`);
  const dirty = await ev(`__obw.useApp.getState().dirty`);
  const logs = await ev(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.message)`);
  return { link, docRot, samples, s3, dirtyAfterRun: dirty, logs, errs };
};
