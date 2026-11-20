// Feature QA: parameter sweep dialog + dock chart on example 01 (optics) and example 05 (circuit).
// node scripts/dev/cdp.mjs run scripts/dev/qa/feat-sweep.mjs
export default async (api) => {
  const errs = await api.collect();
  const out = {};
  const open = async (file) => {
    await api.eval(`(async () => { const l = await window.optibench.listExamples(); const ex = l.find(e => e.file === ${JSON.stringify(file)}); const f = await window.optibench.openPath(ex.path); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); })()`);
    await api.sleep(800);
  };
  const clickText = async (sel, text) => {
    const r = await api.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!r) throw new Error('not found: ' + text);
    await api.click(r.x, r.y);
  };
  const waitDone = async (ms = 60000) => {
    const t0 = Date.now();
    let frames = 0;
    await api.eval(`window.__qaFrames = 0; (function f() { window.__qaFrames++; if (__obw.sweep.useSweep.getState().status === 'running') requestAnimationFrame(f); })()`);
    while (Date.now() - t0 < ms) {
      const st = await api.eval(`__obw.sweep.useSweep.getState().status`);
      if (st !== 'running') break;
      await api.sleep(150);
    }
    frames = await api.eval(`window.__qaFrames`);
    return { ms: Date.now() - t0, frames };
  };

  // ---- optics: prism rotation vs spectrometer peak (example 01), configured through the dialog
  await open('01-prism-rainbow.obw');
  await api.eval(`__obw.useApp.getState().setUi({ dockOpen: true, dockHeight: 300 })`);
  // open via the Simulation menu
  await clickText('.menubar-btn', 'Simulation');
  await api.sleep(150);
  await clickText('.menu-item', 'Parameter Sweep');
  await api.sleep(400);
  out.dialog = await api.eval(`(() => { const d = document.querySelector('.dialog'); return d ? { title: d.querySelector('.caption-title').textContent, comp: document.getElementById('sw-comp').value, param: document.getElementById('sw-param').value, start: document.getElementById('sw-start').value, outputs: [...d.querySelectorAll('.out-row')].length } : null; })()`);
  await api.shot(process.env.S + '/feat-sweep-dialog.png');
  // 31 steps
  const steps = await api.rect('#sw-steps');
  await api.click(steps.cx, steps.cy, { clickCount: 3 });
  await api.eval(`(() => { const i = document.getElementById('sw-steps'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '31'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await clickText('.dialog-footer .btn', 'Run Sweep');
  out.opticsRun = await waitDone();
  const st1 = await api.eval(`(() => { const s = __obw.sweep.useSweep.getState(); return { status: s.status, n: s.points.length, label: s.run.paramLabel, outs: s.run.outputLabels, first: s.points[0], last: s.points[s.points.length - 1] }; })()`);
  out.optics = st1;
  // click a point on the chart (2/3 across), then Apply Value
  const ch = await api.rect('.sweep-chart canvas');
  await api.move(ch.x + ch.w * 0.66, ch.cy);
  await api.click(ch.x + ch.w * 0.66, ch.cy);
  await api.sleep(250);
  await api.move(ch.x + ch.w * 0.4, ch.cy);
  await api.sleep(250);
  await api.shot('docs/screenshots/feat-sweep.png');
  const before = await api.eval(`__obw.useApp.getState().doc.optics.components.find(c => c.id === 'prism').rotation`);
  await clickText('.sweep-side .btn', 'Apply Value');
  await api.sleep(200);
  const after = await api.eval(`(() => { const s = __obw.useApp.getState(); return { rot: s.doc.optics.components.find(c => c.id === 'prism').rotation, undo: s.past[s.past.length - 1]?.label, sel: __obw.sweep.useSweep.getState().selected }; })()`);
  out.apply = { before, after };
  await api.eval(`__obw.useApp.getState().undo()`);
  out.undone = await api.eval(`__obw.useApp.getState().doc.optics.components.find(c => c.id === 'prism').rotation`);
  // export IPC refuses unsupported kinds without opening a dialog
  out.exportGuard = await api.eval(`window.optibench.exportTextDialog('x', 'evil', 'exe').then(() => 'accepted', (e) => 'rejected: ' + e.message)`);
  out.csv = await api.eval(`(() => { const s = __obw.sweep.useSweep.getState(); return s.points.length; })()`);

  // ---- circuit: R2 vs LED brightness and probe mean (example 05), started from the store, with cancel test
  await open('05-blinking-led-555.obw');
  await api.eval(`__obw.useApp.getState().setUi({ dockOpen: true, dockHeight: 300, dockTab: 'sweep' })`);
  await api.eval(`__obw.sweep.useSweep.getState().start({ target: { domain: 'circuit', id: 'r2', param: 'resistance' }, start: 100, stop: 100000, steps: 40, scale: 'log', outputs: [{ kind: 'ledBrightness', id: 'led' }, { kind: 'componentCurrent', id: 'led' }, { kind: 'probeMean', id: 'pout' }], settle: 2, samples: 100 })`);
  await api.sleep(400);
  out.cancelTest = await api.eval(`(() => { const s = __obw.sweep.useSweep.getState(); s.cancel(); return { status: __obw.sweep.useSweep.getState().status, n: __obw.sweep.useSweep.getState().points.length }; })()`);
  await api.eval(`__obw.sweep.useSweep.getState().start({ target: { domain: 'circuit', id: 'r2', param: 'resistance' }, start: 100, stop: 100000, steps: 25, scale: 'log', outputs: [{ kind: 'ledBrightness', id: 'led' }, { kind: 'componentCurrent', id: 'led' }, { kind: 'probeMean', id: 'pout' }], settle: 2, samples: 100 })`);
  await api.sleep(300);
  await api.shot(process.env.S + '/feat-sweep-progress.png');
  out.circuitRun = await waitDone(120000);
  out.circuit = await api.eval(`(() => { const s = __obw.sweep.useSweep.getState(); return { status: s.status, n: s.points.length, b: s.points.map(p => p.outputs[0] === null ? null : +p.outputs[0].toFixed(3)), ms: Math.round(s.ms) }; })()`);
  const ch2 = await api.rect('.sweep-chart canvas');
  await api.move(ch2.x + ch2.w * 0.3, ch2.cy);
  await api.sleep(250);
  await api.shot(process.env.S + '/feat-sweep-circuit.png');
  out.docUntouched = await api.eval(`__obw.useApp.getState().doc.circuit.components.find(c => c.id === 'r2').props.resistance`);
  out.dirty = await api.eval(`__obw.useApp.getState().dirty`);
  out.errors = errs;
  out.logs = await api.eval(`__obw.useApp.getState().logs.filter(l => l.level !== 'info').map(l => l.level + ': ' + l.message)`);
  return out;
};
