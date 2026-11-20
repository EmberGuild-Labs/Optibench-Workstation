// Inspector controls: spin, trackbar drag (incl. release outside), type+Enter, Escape, select, toggle, wavelength.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    const l = E.createComponent('source.laser', {x: -100, y: 0}); d.optics.components = [l]; s.loadDocument(d, null); s.setSelection('optics', [l.id]); })()`);
  await api.sleep(400);
  const L = () => st(`(() => { const c = s.doc.optics.components[0]; return { p: c.props, rot: c.rotation, x: c.position.x, past: s.past.length, pb: !!s.previewBase }; })()`);
  const rowEl = (label, sel) => api.eval(`(() => { const row = [...document.querySelectorAll('.inspector .insp-row')].find(r => r.querySelector('.insp-label')?.textContent.trim().startsWith(${JSON.stringify(label)})); if (!row) return null; const e = row.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block: 'center'}); const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2}; })()`);
  out.labels = await api.eval(`[...document.querySelectorAll('.inspector .insp-label')].map(l => l.textContent.trim())`);
  out.l0 = await L();
  // spin up on Power
  let b = await rowEl('Power', '.spin-btns button[aria-label=Increase]');
  await api.click(b.cx, b.cy);
  out.spinUp = await L();
  // type into Power and Enter
  let f = await rowEl('Power', 'input.num-input');
  await api.click(f.cx, f.cy); await api.key('a', { modifiers: 'ctrl' }); await api.type('20m'); await api.key('Enter');
  out.typeEnter = await L();
  // type then Escape -> no change
  await api.click(f.cx, f.cy); await api.key('a', { modifiers: 'ctrl' }); await api.type('99'); await api.key('Escape');
  out.escape = await L();
  // focused + spin buttons then blur
  await api.click(f.cx, f.cy);
  b = await rowEl('Power', '.spin-btns button[aria-label=Increase]');
  await api.click(b.cx, b.cy); await api.click(b.cx, b.cy);
  await api.click(1300, 860); // blur somewhere neutral (status bar)
  out.focusedSpin = await L();
  // trackbar drag on Power, released far outside the slider
  const tr = await rowEl('Power', 'input.slider');
  await api.drag(tr.x + 10, tr.cy, tr.x + tr.w * 0.6, tr.cy + 200, { steps: 10 });
  out.sliderDrag = await L();
  // wavelength slider drag
  const wl = await rowEl('Wavelength', 'input.slider');
  await api.drag(wl.x + wl.w * 0.8, wl.cy, wl.x + wl.w * 0.3, wl.cy, { steps: 6 });
  out.wl = await L();
  // select: polarization
  const sel = await rowEl('Polarization', 'select');
  out.selFound = !!sel;
  if (sel) {
    await api.eval(`(() => { const row = [...document.querySelectorAll('.inspector .insp-row')].find(r => r.querySelector('.insp-label')?.textContent.trim().startsWith('Polarization')); const e = row.querySelector('select'); e.focus(); })()`);
    await api.key('ArrowDown');
    out.select = await L();
  }
  // rotation field
  const rf = await rowEl('Rotation', 'input');
  await api.click(rf.cx, rf.cy); await api.key('a', { modifiers: 'ctrl' }); await api.type('30'); await api.click(1300, 860);
  out.rot = await L();
  // name text: Escape restores
  out.undoLabels = await st('s.past.map(e => e.label)');
  await api.shot(S + '/insp.png');
  out.errs = errs;
  return out;
};
