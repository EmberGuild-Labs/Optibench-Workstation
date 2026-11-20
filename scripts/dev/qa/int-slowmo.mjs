// Slow motion: type "1 ns/s" into the toolbar time-scale field, run, and screenshot light pulses
// mid-flight in 2D and 3D. usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-slowmo.mjs <example-file> <tag> [waitMs]
export default async (api, args) => {
  const errs = await api.collect();
  const file = args?.[0] ?? '16-pulsed-laser-slowmo.obw';
  const tag = args?.[1] ?? '16';
  const wait = Number(args?.[2] ?? 1500);
  const list = await api.eval(`window.optibench.listExamples()`);
  const ex = list.find((e) => e.file === file);
  await api.eval(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); __obw.commands.setOpticsDim('2d'); })()`);
  await api.sleep(800);
  // type the scale like a user
  const r = await api.rect('.tb-ts-input');
  await api.click(r.cx, r.cy);
  await api.key('a', { modifiers: 'ctrl' });
  await api.type('1 ns/s');
  await api.key('Enter');
  await api.sleep(100);
  const scale = await api.eval(`__obw.useApp.getState().timeScale`);
  const info = await api.eval(`(() => { const t = __obw.useSim.getState().trace; let m0 = 0, m1 = 0; for (const s of t.segments) { if (s.t0 > m0) m0 = s.t0; if (s.t1 > m1) m1 = s.t1; } return { maxT0: m0, maxT1: m1, n: t.segments.length }; })()`);
  // 2D
  await api.key('F5');
  await api.sleep(wait);
  await api.key('F5'); // pause: freeze the pulses for the screenshot
  await api.sleep(150);
  const s2 = await api.eval(`(() => ({ t: __obw.useSim.getState().time, status: __obw.useApp.getState().sim.status, sb: document.querySelector('.sb-time')?.textContent, frame: document.querySelector('[data-testid=optics-viewport]')?.dataset.frameMs }))()`);
  await api.shot(`docs/screenshots/int-slowmo-2d${tag === '16' ? '' : '-' + tag}.png`);
  // resume, then 3D
  await api.eval(`__obw.commands.setOpticsDim('3d')`);
  await api.sleep(900);
  await api.eval(`window.__optics3d?.setCameraPreset('iso', false)`);
  await api.key('F5');
  await api.sleep(wait);
  await api.key('F5');
  await api.sleep(300);
  const s3 = await api.eval(`(() => ({ t: __obw.useSim.getState().time, status: __obw.useApp.getState().sim.status, sb: document.querySelector('.sb-time')?.textContent, tr3: __obw.useSim.getState().trace3d?.stats.segments }))()`);
  await api.shot(`docs/screenshots/int-slowmo-3d${tag === '16' ? '' : '-' + tag}.png`);
  await api.eval(`__obw.commands.resetSim(); __obw.commands.setOpticsDim('2d'); __obw.useApp.getState().setTimeScale(1)`);
  const logs = await api.eval(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.message)`);
  return { scale, info, s2, s3, logs, errs };
};
