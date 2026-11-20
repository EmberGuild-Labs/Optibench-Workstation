const S = process.env.O3D, D = process.env.DOCS;
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const out = {};
  const btn = async (t) => { const r = await ev(`[...document.querySelectorAll('.o3d-bar button')].find(b => b.textContent === '${t}').getBoundingClientRect().toJSON()`); await api.click(r.x + r.width / 2, r.y + r.height / 2); await api.sleep(900); };
  // palette drop at a known screen point; expect the new part at the beam-plane point under it
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=08'`); await api.sleep(3500);
  const target = await ev(`(() => { const rt = window.__optics3d; const T = rt.camera.position.constructor; return rt.toScreen(new T(150, -120, 0)); })()`);
  await ev(`(() => { const c = document.querySelector('.o3d-root canvas'); const dt = new DataTransfer(); dt.setData('application/x-optibench-component', JSON.stringify({ domain: 'optics', type: 'lens.biconvex' }));
    for (const t of ['dragover', 'drop']) c.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, clientX: ${target.x}, clientY: ${target.y}, dataTransfer: dt })); })()`);
  await api.sleep(500);
  const comps = await ev(`window.__harness.scene().components`);
  const added = comps[comps.length - 1];
  out.drop = { type: added.type, position: added.position, pose3d: added.pose3d, sel: await ev(`window.__harness.sel()`), log: await ev(`window.__harness.log[0]`) };
  // sweep all examples for errors and capture
  const names = await ev(`[...document.querySelectorAll('select option')].map(o => o.value)`);
  out.examples = {};
  for (const n of names) {
    await ev(`location.href = 'http://localhost:5203/preview.html?ex=${n.slice(0, 2)}'`); await api.sleep(3000);
    out.examples[n] = await ev(`({ comps: window.__harness.scene().components.length, beams: window.__optics3d.beams.count })`);
    await api.shot(S + `/ex-${n}.png`);
  }
  // final doc screenshots
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=01'`); await api.sleep(3500);
  await api.shot(D + '/3d-iso-prism-rainbow.png');
  await btn('Top'); await api.shot(D + '/3d-top-matches-2d.png');
  await ev(`window.__harness.select(['prism'])`); await btn('Iso'); await api.sleep(300);
  await api.shot(D + '/3d-gizmo-selected.png');
  const maxT = await ev(`window.__optics3d.beams.maxT`);
  await ev(`window.__harness.select([])`);
  await ev(`window.__harness.setTime({ mode: 'pulse', t: ${maxT} * 0.7 })`); await api.sleep(500);
  await api.shot(D + '/3d-pulse-slowmo.png');
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=08'`); await api.sleep(3500);
  await api.shot(D + '/3d-optical-link.png');
  out.errors = errs.filter((e) => !e.includes('Electron Security'));
  console.log(JSON.stringify(out, null, 1));
};
