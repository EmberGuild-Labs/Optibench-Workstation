// Integration matrix: open every example (as template), run it in 2D and in 3D for a few seconds,
// collect console errors, warnings, solver state and trace stats. Screenshots to $S/int-ex-*.png.
// usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-examples.mjs [filter]
export default async (api, args) => {
  const errs = await api.collect();
  const filter = args?.[0];
  const list = (await api.eval(`window.optibench.listExamples()`)).filter((e) => !filter || e.file.includes(filter));
  const out = [];
  const state = `(() => { const s = __obw.useApp.getState(); const sim = __obw.useSim.getState();
    return { dim: s.opticsDim, meta: s.doc.meta.dimension, tab: s.tab, status: s.sim.status, n: [s.doc.optics.components.length, s.doc.circuit.components.length, s.doc.links.length],
      conv: sim.circuit ? sim.circuit.converged : null, err: sim.circuit?.error ?? null, t: sim.time,
      tr2: sim.trace ? sim.trace.stats.segments : null, tr3: sim.trace3d ? sim.trace3d.stats.segments : null,
      ms3: sim.trace3d ? +sim.trace3d.stats.ms.toFixed(1) : null,
      det2: sim.trace ? Object.keys(sim.trace.detectors).length : 0, det3: sim.trace3d ? Object.keys(sim.trace3d.detectors).length : 0,
      logs: s.logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message) }; })()`;
  for (const ex of list) {
    const before = errs.length;
    await api.eval(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
    await api.sleep(700);
    // ---- 2D
    await api.eval(`__obw.commands.setOpticsDim('2d')`);
    await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
    await api.sleep(2500);
    const r2 = await api.eval(state);
    await api.shot(process.env.S + '/int-ex-' + ex.file.replace('.obw', '') + '-2d.png');
    await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
    await api.sleep(300);
    // ---- 3D (converts the document once)
    await api.eval(`__obw.commands.setOpticsDim('3d')`);
    await api.sleep(1200);
    await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
    await api.sleep(2500);
    const r3 = await api.eval(state);
    await api.shot(process.env.S + '/int-ex-' + ex.file.replace('.obw', '') + '-3d.png');
    await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
    // undo the conversion: back to the 2D document
    const undo = await api.eval(`(() => { const s = __obw.useApp.getState(); const l = s.past[s.past.length - 1]?.label; s.undo(); return { label: l, meta: __obw.useApp.getState().doc.meta.dimension, pose: __obw.useApp.getState().doc.optics.components.some(c => c.pose3d) }; })()`);
    await api.eval(`__obw.commands.setOpticsDim('2d')`);
    out.push({ file: ex.file, d2: r2, d3: r3, undo, console: errs.slice(before) });
  }
  return out;
};
