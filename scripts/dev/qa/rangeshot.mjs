// Range-slider screenshot: prism example, spectrometer band narrowed by dragging thumbs in the inspector.
export default async (api, a) => {
  const errs = await api.collect();
  const out = {};
  await api.eval(`(async () => { const l = await window.optibench.listExamples(); const ex = l.find(e => e.file.startsWith('01')); const f = await window.optibench.openPath(ex.path); __obw.commands.loadText(f.text, null, true); })()`);
  await api.sleep(500);
  await api.eval(`(() => { const s = __obw.useApp.getState(); const sp = s.doc.optics.components.find(c => c.type === 'detector.spectrometer'); s.setSelection('optics', [sp.id]); s.setSimStatus('running'); })()`);
  await api.sleep(600);
  const th = () => api.eval(`[...document.querySelectorAll('.band-thumb')].map(t => { const r = t.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, v: +t.getAttribute('aria-valuenow')}; })`);
  let t = await th();
  out.t0 = t;
  const past0 = await api.eval(`__obw.useApp.getState().past.length`);
  await api.drag(t[0].x, t[0].y, t[0].x + 25, t[0].y, { steps: 10, delay: 16 });
  t = await th();
  await api.drag(t[1].x, t[1].y, t[1].x - 30, t[1].y, { steps: 10, delay: 16 });
  t = await th();
  out.t1 = t;
  out.undoSteps = (await api.eval(`__obw.useApp.getState().past.length`)) - past0;
  await api.sleep(1200);
  out.det = await api.eval(`(() => { const t = __obw.useSim.getState().trace; return Object.values(t.detectors).filter(d => d.spectrum).map(d => ({ range: d.spectrumRange, n: d.spectrum.length, p: d.power })); })()`);
  out.axis = await api.eval(`[...document.querySelectorAll('.dock *')].filter(e => e.children.length === 0 && /^\d{3}$/.test(e.textContent.trim())).map(e => e.textContent).slice(0, 12)`);
  await api.shot(a[0] || (process.env.S + '/range.png'));
  out.errs = errs;
  return out;
};
