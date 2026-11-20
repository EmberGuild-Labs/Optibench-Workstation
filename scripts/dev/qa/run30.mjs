// Run the loaded document for N seconds; sample heap, fps, console errors.
export default async (api, a) => {
  const secs = +(a[0] ?? 30);
  const errs = await api.collect();
  await api.send('Performance.enable');
  const heap = async () => { const m = await api.send('Performance.getMetrics'); const g = (n) => m.result.metrics.find((x) => x.name === n)?.value; return { heapMB: +(g('JSHeapUsedSize') / 1e6).toFixed(1), nodes: g('Nodes'), listeners: g('JSEventListeners') }; };
  await api.eval(`__obw.useApp.getState().setTab('split')`);
  await api.eval(`__obw.useApp.getState().setUi({dockTab: 'scope'})`);
  const samples = [await heap()];
  await api.eval(`__obw.useApp.getState().setSimStatus('running')`);
  await api.eval(`(() => { window.__fr = []; let last = performance.now(); const f = (t) => { window.__fr.push(t - last); last = t; if (!window.__frStop) requestAnimationFrame(f); }; window.__frStop = false; requestAnimationFrame(f); })()`);
  for (let i = 0; i < secs / 5; i++) { await api.sleep(5000); samples.push(await heap()); }
  const fr = await api.eval(`(() => { window.__frStop = true; const f = window.__fr.slice(5).sort((a, b) => a - b); return { n: f.length, p50: f[Math.floor(f.length / 2)], p95: f[Math.floor(f.length * 0.95)], p99: f[Math.floor(f.length * 0.99)], max: f.at(-1) }; })()`);
  const st = await api.eval(`(() => { const c = __obw.useSim.getState().circuit; return { t: c?.time, conv: c?.converged, status: __obw.useApp.getState().sim.status, logs: __obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.message).slice(-5) }; })()`);
  await api.eval(`__obw.useApp.getState().setSimStatus('stopped')`);
  await api.shot(process.env.S + '/run30.png');
  return { samples, fr, st, errs };
};
