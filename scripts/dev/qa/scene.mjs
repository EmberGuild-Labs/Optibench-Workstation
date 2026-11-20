// Build a white light + prism scene with 10+ components; measure drag performance.
export default async (api, args) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  await api.eval(`(() => {
    const s = __obw.useApp.getState(); const E = __obw.engines.opticsEngine;
    const doc = __obw.project.createEmptyDocument();
    const mk = (t, x, y, rot = 0, props = {}) => { const c = E.createComponent(t, {x, y}); c.rotation = rot; Object.assign(c.props, props); return c; };
    doc.optics.components = [
      mk('source.white', -180, 0),
      mk('aperture.slit', -140, 0),
      mk('lens.planoconvex', -110, 0),
      mk('prism.equilateral', -20, 8),
      mk('lens.biconvex', 80, 40, 0.35),
      mk('detector.screen', 170, 60, -0.3),
      mk('source.laser', -180, -80),
      mk('mirror.flat', -60, -80, Math.PI/4),
      mk('splitter.plate', -60, -130, Math.PI/4),
      mk('detector.power', 60, -80),
      mk('detector.spectrometer', 170, 0),
      mk('lens.biconcave', 0, -80),
    ];
    doc.optics.components.forEach((c, i) => { if (!c.id) c.id = 'q' + i; });
    s.loadDocument(doc, null);
    s.setView('optics', {cx: 0, cy: -20, zoom: 2.4});
  })()`);
  await api.sleep(1500);
  await api.shot(S + '/scene.png');
  const trace = await api.eval(`(() => { const t = __obw.useSim.getState(); return { segs: t.trace?.segments.length, ms: t.trace?.stats.ms, wall: t.traceWallMs, src: t.traceSource }; })()`);
  // drag the prism around and measure frame timing
  const r = await api.rect('.pane.optics');
  const v = await st('s.views.optics');
  const p = await st(`s.doc.optics.components[3].position`);
  const sx = r.x + r.w / 2 + (p.x - v.cx) * v.zoom, sy = r.y + r.h / 2 + (p.y - v.cy) * v.zoom;
  await api.eval(`(() => { window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000 && !window.__stopFrames) requestAnimationFrame(f); }; window.__stopFrames = false; requestAnimationFrame(f); })()`);
  await api.move(sx, sy);
  await api.mouse('mousePressed', sx, sy, { down: true });
  const t0 = Date.now();
  for (let i = 1; i <= 60; i++) { await api.mouse('mouseMoved', sx + 40 * Math.sin(i / 8), sy + 25 * Math.sin(i / 5), { down: true }); await api.sleep(16); }
  const traceLagSamples = [];
  await api.mouse('mouseReleased', sx, sy, {});
  const dt = Date.now() - t0;
  const fr = await api.eval(`(() => { window.__stopFrames = true; const f = window.__frames.slice(2); f.sort((a,b)=>a-b); return { n: f.length, p50: f[Math.floor(f.length*0.5)], p95: f[Math.floor(f.length*0.95)], max: f.at(-1) }; })()`);
  const tr2 = await api.eval(`(() => { const t = __obw.useSim.getState(); return { segs: t.trace?.segments.length, ms: t.trace?.stats.ms, wall: t.traceWallMs, src: t.traceSource }; })()`);
  return { trace, dragMs: dt, frames: fr, tr2, past: await st('s.past.length'), errs };
};
