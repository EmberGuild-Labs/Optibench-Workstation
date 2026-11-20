export default async (api, a) => {
  const S = process.env.S;
  await api.eval(`(() => { const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine; const d = __obw.project.createEmptyDocument();
    const w = E.createComponent('source.white', {x: -120, y: 0}); w.props.beamWidth = 1;
    const p = E.createComponent('prism.equilateral', {x: 0, y: 6}); p.rotation = ${a[0] ?? 0};
    const sc = E.createComponent('detector.screen', {x: 160, y: 80}); sc.rotation = -0.7; sc.props.size = 60;
    d.optics.components = [w, p, sc]; s.loadDocument(d, null); s.setView('optics', {cx: 30, cy: 30, zoom: 3}); })()`);
  await api.sleep(800);
  await api.shot(S + '/prism.png');
  return await api.eval(`(() => { const t = __obw.useSim.getState().trace; const wl = new Set(t.segments.map(s => Math.round(s.wavelength))); return { segs: t.segments.length, wls: [...wl].slice(0, 30) }; })()`);
};
