// Misc integration checks: Ctrl+3 toggle, split view in 3D, click-to-place from the palette in 3D,
// Step at a slow time scale, Realtime button, Gaussian beam envelope overlay + laser inspector info,
// wave optics checkbox. usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-misc.mjs
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const list = await ev(`window.optibench.listExamples()`);
  const open = async (prefix) => {
    const ex = list.find((e) => e.file.startsWith(prefix));
    await ev(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); __obw.commands.setOpticsDim('2d'); })()`);
    await api.sleep(900);
  };
  const out = {};
  await open('02-');
  // Ctrl+3 (focus the viewport first so the key is not typed into a field)
  const vp = await api.rect('[data-testid=optics-viewport]');
  await api.click(vp.x + 20, vp.y + vp.h - 20);
  await api.key('3', { modifiers: 'ctrl' });
  await api.sleep(1200);
  out.ctrl3 = await ev(`__obw.useApp.getState().opticsDim`);
  await api.key('3', { modifiers: 'ctrl' });
  await api.sleep(500);
  out.ctrl3back = await ev(`__obw.useApp.getState().opticsDim`);

  // Gaussian envelope + laser inspector
  await ev(`(() => { const s = __obw.useApp.getState(); s.setOpticsDisplay({ gaussianEnvelope: true }); const l = s.doc.optics.components.find(c => c.type === 'source.laser'); s.setSelection('optics', [l.id]); })()`);
  await api.sleep(500);
  out.gaussInspector = await ev(`(() => { const box = [...document.querySelectorAll('fieldset.group-box')].find(f => f.querySelector('legend')?.textContent.includes('Gaussian')); return box ? box.innerText.replace(/\\s+/g, ' ') : null; })()`);
  await api.shot(process.env.S + '/int-gaussian.png');
  await ev(`__obw.useApp.getState().setOpticsDisplay({ gaussianEnvelope: false })`);

  // wave optics checkbox (document settings)
  await ev(`__obw.useApp.getState().clearSelection()`);
  await api.sleep(300);
  const wave = await ev(`(() => { const t = document.querySelector('button.toggle[aria-label="Wave optics mode"]'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, on: t.getAttribute('aria-checked') }; })()`);
  if (wave) { await api.click(wave.x, wave.y); await api.sleep(400); }
  out.wave = { before: wave?.on, after: await ev(`!!__obw.useApp.getState().doc.optics.settings.waveMode`), undo: await ev(`__obw.useApp.getState().past.at(-1)?.label`) };
  await ev(`__obw.useApp.getState().undo()`);

  // split view in 3D + click-to-place
  await ev(`__obw.useApp.getState().setTab('split'); __obw.commands.setOpticsDim('3d')`);
  await api.sleep(1500);
  out.split = await ev(`({ has3d: !!document.querySelector('.pane.optics [data-testid=optics3d-viewport]'), hasCircuit: !!document.querySelector('.pane.circuit canvas') })`);
  await api.shot(process.env.S + '/int-split-3d.png');
  await ev(`__obw.useApp.getState().setTab('optics')`);
  await api.sleep(800);
  await ev(`window.__optics3d.setCameraPreset('top', false)`);
  await api.sleep(300);
  const n0 = await ev(`__obw.useApp.getState().doc.optics.components.length`);
  await ev(`__obw.useApp.getState().startPlace('optics', 'lens.biconvex')`);
  const r3 = await api.rect('[data-testid=optics3d-viewport]');
  await api.click(r3.cx + 40, r3.cy + 120);
  await api.sleep(500);
  out.place3d = await ev(`(() => { const s = __obw.useApp.getState(); const c = s.doc.optics.components.at(-1); return { added: s.doc.optics.components.length - ${n0}, type: c.type, pose: c.pose3d ?? null, label: s.past.at(-1)?.label }; })()`);

  // Step at 1 ns/s and Realtime
  await ev(`__obw.commands.setSimSpeed(1e-9)`);
  await ev(`__obw.commands.stepSim()`);
  await api.sleep(100);
  await ev(`__obw.commands.stepSim()`);
  await api.sleep(100);
  out.step = await ev(`({ t: __obw.useSim.getState().time, status: __obw.useApp.getState().sim.status, sb: document.querySelector('.sb-time')?.textContent })`);
  const rt = await ev(`(() => { const b = [...document.querySelectorAll('.time-controls button')].find(x => x.textContent === 'Realtime'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await api.click(rt.x, rt.y);
  await api.sleep(1000);
  out.realtime = await ev(`({ scale: __obw.useApp.getState().timeScale, status: __obw.useApp.getState().sim.status, t: __obw.useSim.getState().time })`);
  const pz = await ev(`(() => { const b = [...document.querySelectorAll('.time-controls button')].find(x => x.textContent === 'Pause'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await api.click(pz.x, pz.y);
  await api.sleep(300);
  const tA = await ev(`__obw.useSim.getState().time`);
  await api.sleep(500);
  out.pause = { status: await ev(`__obw.useApp.getState().sim.status`), frozen: tA === (await ev(`__obw.useSim.getState().time`)) };
  // presets dropdown + [ / ]
  await ev(`(() => { const sel = document.querySelector('.tb-ts-presets'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, '1e-10'); sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await api.sleep(200);
  out.preset = await ev(`({ scale: __obw.useApp.getState().timeScale, field: document.querySelector('.tb-ts-input').value })`);
  await ev(`__obw.commands.resetSim(); __obw.useApp.getState().setTimeScale(1); __obw.commands.setOpticsDim('2d')`);
  out.errs = errs;
  return out;
};
