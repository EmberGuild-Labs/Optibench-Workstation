// Placement mode: after placing a part, Esc / V / right-click return to the Select pointer
// (circuit, optics 2D and optics 3D). Right-click when not placing still opens the context menu.
export default async (api) => {
  const errs = await api.collect();
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const sleep = api.sleep;
  const bigCanvas = () => api.eval(`(() => { const c = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 200).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; })()`);
  const menuOpen = () => api.eval(`document.querySelectorAll('.menu-label').length > 0`);
  const out = {};

  const tryCase = async (name, domain, type, how, prep) => {
    if (prep) await prep();
    await st(`(s.startPlace('${domain}', '${type}'), 0)`); await sleep(250);
    const c = await bigCanvas();
    const n0 = await st(`s.doc.${domain}.components.length`);
    await api.click(c.x + 30, c.y + 20); await sleep(300);
    const placed = (await st(`s.doc.${domain}.components.length`)) - n0;
    const toolAfterPlace = await st('s.tool');
    if (how === 'esc') await api.key('Escape');
    else if (how === 'v') await api.key('v');
    else await api.click(c.x - 60, c.y - 40, { button: 'right' });
    await sleep(250);
    const r = { placed, toolAfterPlace, tool: await st('s.tool'), placeType: await st('s.placeType'), menu: await menuOpen() };
    if (r.menu) { await api.key('Escape'); await sleep(100); }
    r.ok = placed === 1 && toolAfterPlace === 'place' && r.tool === 'select' && r.placeType === null && !r.menu;
    out[name] = r;
  };

  // launched with examples/08-optical-link.obw (has both domains)
  await sleep(300);
  const circ = async () => { await st(`(s.setTab('circuit'), 0)`); await sleep(250); };
  const opt2 = async () => { await st(`(s.setTab('optics'), 0)`); if (await st('s.opticsDim') === '3d') await api.key('3', { modifiers: 'ctrl' }); await sleep(300); };
  const opt3 = async () => { await st(`(s.setTab('optics'), 0)`); if (await st('s.opticsDim') !== '3d') await api.key('3', { modifiers: 'ctrl' }); await sleep(800); };

  for (const how of ['esc', 'v', 'right']) {
    await tryCase(`circuit-${how}`, 'circuit', 'passive.resistor', how, circ);
    await tryCase(`optics2d-${how}`, 'optics', 'lens.biconvex', how, opt2);
    await tryCase(`optics3d-${how}`, 'optics', 'mirror.flat', how, opt3);
  }
  // Right-click with the Select tool still opens the context menu (no regression)
  await opt2();
  const c = await bigCanvas();
  await api.click(c.x - 120, c.y - 80, { button: 'right' }); await sleep(250);
  out.ctxMenuStillWorks = await menuOpen();
  await api.key('Escape'); await sleep(100);
  await circ();
  const c2 = await bigCanvas();
  await api.click(c2.x - 120, c2.y - 80, { button: 'right' }); await sleep(250);
  out.ctxMenuStillWorksCircuit = await menuOpen();
  await api.key('Escape');
  // Shift+drag on empty space pans the 2D views; selection unchanged, no marquee, no undo step
  const panCheck = async (name, prep, viewKey) => {
    await prep();
    await st(`(s.clearSelection(), 0)`); await sleep(100);
    // find an empty spot: the top-left area of the canvas
    const r = await api.eval(`(() => { const c = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 200).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { x: c.x + 40, y: c.y + 40 }; })()`);
    const v0 = await st(`JSON.stringify(s.views.${viewKey})`);
    const u0 = await st('s.past.length');
    await api.drag(r.x, r.y, r.x + 150, r.y + 90, { steps: 12, modifiers: 'shift' }); await sleep(250);
    const v1 = await st(`JSON.stringify(s.views.${viewKey})`);
    const a = JSON.parse(v0), b = JSON.parse(v1);
    out[name] = { before: a, after: b, sel: await st('s.selection.optics.length + s.selection.circuit.length'), undoSame: (await st('s.past.length')) === u0 };
    out[name].ok = out[name].undoSame && (a.cx !== b.cx || a.cy !== b.cy) && a.zoom === b.zoom && out[name].sel === 0;
  };
  await panCheck('pan-optics2d', opt2, 'optics');
  await panCheck('pan-circuit', circ, 'circuit');
  // the hint chip
  await st(`(s.startPlace('optics', 'lens.biconvex'), 0)`); await sleep(150);
  out.chip = await api.eval(`document.querySelector('.tb-chip')?.textContent`);
  await api.shot((process.env.S || '.') + '/place-exit-chip.png');
  await api.key('Escape');
  out.allOk = Object.values(out).every((v) => typeof v !== 'object' || v.ok);
  out.errors = errs;
  return out;
};
