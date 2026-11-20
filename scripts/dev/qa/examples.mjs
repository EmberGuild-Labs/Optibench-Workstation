// Open every example (as template, no dialogs), run 2 s, collect warnings/errors and solver state.
export default async (api) => {
  const errs = await api.collect();
  const list = await api.eval(`window.optibench.listExamples()`);
  const out = [];
  for (const ex of list) {
    await api.eval(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
    await api.sleep(600);
    await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
    await api.sleep(2000);
    const r = await api.eval(`(() => { const s = __obw.useApp.getState(); const sim = __obw.useSim.getState(); return { tab: s.tab, n: [s.doc.optics.components.length, s.doc.circuit.components.length, s.doc.links.length], conv: sim.circuit?.converged, t: sim.circuit?.time?.toFixed(2), err: sim.circuit?.error, traceMs: sim.trace?.stats.ms?.toFixed(1), wall: sim.traceWallMs.toFixed(1), src: sim.traceSource, logs: s.logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message) }; })()`);
    await api.shot(process.env.S + '/ex-' + ex.file.replace('.obw', '') + '.png');
    await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
    out.push({ file: ex.file, ...r });
  }
  return { out, errs };
};
