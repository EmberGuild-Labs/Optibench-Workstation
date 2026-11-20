const S = process.env.O3D;
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const out = {};
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=08'`); await api.sleep(4000);
  await api.shot(S + '/ex08-iso.png');
  out.ex08 = await ev(`({ n: window.__harness.scene().components.length, segs: window.__optics3d.beams.count })`);
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=01'`); await api.sleep(3500);
  await api.shot(S + '/ex01-iso.png');
  // pulse at ~45% of max flight time
  const maxT = await ev(`Math.max(...window.__optics3d.beams ? [window.__optics3d.beams.maxT] : [0])`);
  await ev(`window.__harness.setTime({ mode: 'pulse', t: ${maxT} * 0.45 })`); await api.sleep(600);
  await api.shot(S + '/ex01-pulse.png');
  await ev(`window.__harness.setTime({ mode: 'steady', t: 0 })`); await api.sleep(300);
  // click selection: click on fold mirror
  const p = await ev(`(() => { const rt = window.__optics3d; const T = rt.camera.position.constructor; return rt.toScreen(new T(81,-87,0)); })()`);
  await api.click(p.x, p.y); await api.sleep(300);
  out.selAfterClick = await ev(`window.__harness.sel()`);
  await api.click(p.x, 820); await api.sleep(300); // empty table near bottom
  out.selAfterEmpty = await ev(`window.__harness.sel()`);
  // keyboard nudge with selection
  await ev(`window.__harness.select(['fold'])`); await api.sleep(200);
  await ev(`document.querySelector('.o3d-root').focus()`);
  await api.key('ArrowUp'); await api.key('PageUp', { modifiers: 'shift' }); await api.sleep(200);
  out.fold = await ev(`window.__harness.scene().components.find(c => c.id === 'fold')`);
  // frame selection
  await api.key('f'); await api.sleep(800);
  await api.shot(S + '/frame.png');
  out.maxT = maxT;
  out.errors = errs.filter((e) => !e.includes('Electron Security Warning'));
  console.log(JSON.stringify(out, null, 1));
};
