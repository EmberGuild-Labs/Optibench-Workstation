// Inspector spectral band control: drag thumbs (one undo step), no crossing, keyboard, Visible preset.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    const w = E.createComponent('source.white', {x: -100, y: 0}); const p = E.createComponent('prism.equilateral', {x: 0, y: 8}); p.rotation = 0.0;
    const sp = E.createComponent('detector.spectrometer', {x: 120, y: 40}); sp.rotation = -0.5;
    d.optics.components = [w, p, sp]; s.loadDocument(d, null); s.setSelection('optics', [w.id]); })()`);
  await api.sleep(500);
  const strip = await api.rect('.band-strip');
  out.strip = strip;
  if (!strip) return { out, errs, html: await api.eval(`document.querySelector('.inspector').innerText.slice(0, 800)`) };
  const thumbs = await api.eval(`[...document.querySelectorAll('.band-thumb')].map(t => { const r = t.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, v: +t.getAttribute('aria-valuenow')}; })`);
  out.thumbs0 = thumbs;
  const props = () => st(`(() => { const c = s.doc.optics.components[0]; return [c.props.wavelengthMin, c.props.wavelengthMax, s.past.length, !!s.previewBase]; })()`);
  out.p0 = await props();
  // drag the low thumb right by 60 px
  await api.drag(thumbs[0].x, thumbs[0].y, thumbs[0].x + 60, thumbs[0].y, { steps: 8 });
  out.p1 = await props();
  // drag the low thumb past the high thumb -> must stop at hi-1
  const t2 = await api.eval(`[...document.querySelectorAll('.band-thumb')].map(t => { const r = t.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })`);
  await api.drag(t2[0].x, t2[0].y, t2[1].x + 80, t2[0].y, { steps: 8 });
  out.p2 = await props();
  // keyboard on high thumb
  await api.eval(`document.querySelectorAll('.band-thumb')[1].focus()`);
  await api.key('ArrowRight', { modifiers: 'shift' });
  await api.key('PageUp');
  out.p3 = await props();
  // Visible preset button
  const vb = await api.rect('.band-preset');
  await api.click(vb.cx, vb.cy);
  out.p4 = await props();
  // click on the strip far right moves the high thumb
  await api.click(strip.x + strip.w - 4, strip.cy);
  out.p5 = await props();
  // type into the min spin field
  const inp = await api.eval(`(() => { const r = document.querySelectorAll('.band-inputs input')[0].getBoundingClientRect(); return {x: r.x + 20, y: r.y + r.height/2}; })()`);
  await api.click(inp.x, inp.y);
  await api.key('a', { modifiers: 'ctrl' });
  await api.type('450');
  await api.key('Enter');
  out.p6 = await props();
  out.undoLabels = await st('s.past.slice(-6).map(e => e.label)');
  await api.sleep(600);
  out.spec = await api.eval(`(() => { const t = __obw.useSim.getState().trace; const d = Object.values(t.detectors).find(d => d.spectrum); return d && { range: d.spectrumRange, n: d.spectrum.length, sum: d.power }; })()`);
  const insp = await api.rect('.inspector');
  await api.shot(S + '/band.png');
  out.errs = errs;
  return out;
};
