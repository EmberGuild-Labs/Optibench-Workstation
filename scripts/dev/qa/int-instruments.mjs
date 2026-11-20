// Instrument panels: examples 11 (double slit, wave mode), 12 (Michelson camera), 13 (photodiode amp),
// plus a generated bench with a polarimeter, a wavemeter and a solar concentrator.
// Screenshots: docs/screenshots/int-double-slit.png, int-instruments.png (+ $S/int-inst-*.png)
// usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-instruments.mjs
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const list = await ev(`window.optibench.listExamples()`);
  const open = async (prefix) => {
    const ex = list.find((e) => e.file.startsWith(prefix));
    await ev(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); __obw.commands.setOpticsDim('2d'); __obw.useApp.getState().setUi({ dockOpen: true, dockTab: 'instruments', dockHeight: 300 }); })()`);
    await api.sleep(1200);
  };
  const cards = () => ev(`[...document.querySelectorAll('.inst-card')].map(c => ({ name: c.querySelector('.inst-name')?.textContent, main: c.querySelector('.readout-main')?.textContent, sub: c.querySelector('.readout-sub')?.textContent, canvases: c.querySelectorAll('canvas').length, text: c.innerText.replace(/\\s+/g, ' ').slice(0, 160) }))`);
  const out = {};

  await open('11-');
  out.ex11 = await cards();
  await api.shot('docs/screenshots/int-double-slit.png');
  await ev(`__obw.commands.setOpticsDim('3d')`);
  await api.sleep(1800);
  out.ex11_3d = await cards();
  await api.shot(process.env.S + '/int-inst-11-3d.png');

  await open('12-');
  out.ex12 = await cards();
  await api.shot(process.env.S + '/int-inst-12.png');
  await ev(`__obw.commands.setOpticsDim('3d')`);
  await api.sleep(1800);
  out.ex12_3d = await cards();
  await api.shot(process.env.S + '/int-inst-12-3d.png');

  await open('13-');
  await ev(`__obw.useApp.getState().setSimStatus('running')`);
  await api.sleep(2000);
  out.ex13 = await cards();
  await api.shot(process.env.S + '/int-inst-13.png');
  await ev(`__obw.useApp.getState().setSimStatus('stopped')`);

  // generated bench: three lasers onto a polarimeter, a wavemeter and a solar concentrator
  await ev(`(() => {
    const s = __obw.useApp.getState(); __obw.commands.newProject && null;
    const E = __obw.engines.opticsEngine;
    const mk = (type, x, y, props = {}, id) => { const c = E.createComponent(type, { x, y }); c.id = id; c.props = { ...c.props, ...props }; return c; };
    const comps = [
      mk('source.laser', -150, -80, { polarization: 'elliptical' in {} ? 'linear' : 'linear', polAngle: 30, wavelength: 632.8 }, 'L1'),
      mk('waveplate.quarter', -60, -80, {}, 'QWP'),
      mk('detector.polarimeter', 60, -80, {}, 'POL'),
      mk('source.laser', -150, 0, { wavelength: 532, linewidth: 0.8 }, 'L2'),
      mk('detector.wavemeter', 60, 0, {}, 'WM'),
      mk('source.beam', -150, 90, { wavelength: 589 }, 'L3'),
      mk('solar.concentrator', 60, 90, {}, 'SC')
    ];
    comps[1].rotation = 0;
    const doc = __obw.project.createEmptyDocument();
    doc.meta.title = 'Instrument panels';
    doc.optics.components = comps;
    s.loadDocument(doc, null);
    s.setUi({ dockOpen: true, dockTab: 'instruments', dockHeight: 330 });
  })()`);
  await api.sleep(1500);
  await ev(`__obw.commands.frameAll()`);
  await api.sleep(600);
  out.generated = await cards();
  out.readings = await ev(`(() => { const d = __obw.useSim.getState().trace?.detectors ?? {}; return Object.fromEntries(Object.entries(d).map(([k, r]) => [k, { power: r.power, stokes: r.stokes, mean: r.meanWavelength, lw: r.linewidth, conc: r.concentration }])); })()`);
  await api.shot('docs/screenshots/int-instruments.png');
  out.errs = errs;
  return out;
};
