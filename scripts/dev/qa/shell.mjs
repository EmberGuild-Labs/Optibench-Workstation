// Shell: start screen, splitters (no drift past clamps), tabs, dock tabs, caption max/restore, About/Shortcuts.
export default async (api) => {
  const errs = await api.collect();
  const S = process.env.S;
  const st = (e) => api.eval(`(() => { const s = __obw.useApp.getState(); return ${e}; })()`);
  const out = {};
  // start screen
  out.startButtons = await api.eval(`[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)`);
  const about = await api.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('About')); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(about.x, about.y); await api.sleep(150);
  out.aboutOpen = await api.eval(`document.querySelector('.dialog .caption')?.textContent`);
  await api.shot(S + '/about.png');
  const ok = await api.eval(`(() => { const b = [...document.querySelectorAll('.dialog button')].find(b => /OK|Close/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, t: b.textContent}; })()`);
  if (ok) { await api.click(ok.x, ok.y); await api.sleep(100); }
  out.aboutClosed = !(await api.eval(`!!document.querySelector('.dialog')`));
  const nb = await api.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Project'); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(nb.x, nb.y); await api.sleep(300);
  out.hasDoc = await st('!!s.doc');
  // split tab via tab strip
  const tab = await api.eval(`(() => { const b = [...document.querySelectorAll('.ws-tabstrip .tab')].find(b => b.textContent.includes('Split')); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await api.click(tab.x, tab.y); await api.sleep(200);
  out.tab = await st('s.tab');
  // split divider: drag right 200 (past clamp at 0.85?), then back to the original x — ratio must return to start
  const d = await api.rect('.split-divider');
  const r0 = await st('s.ui.splitRatio');
  await api.move(d.cx, d.cy);
  await api.mouse('mousePressed', d.cx, d.cy, { down: true });
  for (let i = 1; i <= 10; i++) await api.mouse('mouseMoved', d.cx + 60 * i, d.cy, { down: true });
  const rMax = await st('s.ui.splitRatio');
  for (let i = 9; i >= 0; i--) await api.mouse('mouseMoved', d.cx + 60 * i, d.cy, { down: true });
  await api.mouse('mouseReleased', d.cx, d.cy, {});
  out.split = { r0, rMax, rBack: await st('s.ui.splitRatio') };
  const d2 = await api.rect('.split-divider');
  out.split.dividerX = [d.cx, d2.cx];
  // left panel splitter: drag left 300 (clamped at 190) then back
  const ls = await api.eval(`(() => { const e = document.querySelector('.side.left + .splitter'); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  const w0 = await st('s.ui.leftWidth');
  await api.move(ls.x, ls.y); await api.mouse('mousePressed', ls.x, ls.y, { down: true });
  for (let i = 1; i <= 6; i++) await api.mouse('mouseMoved', ls.x - 50 * i, ls.y, { down: true });
  for (let i = 5; i >= 0; i--) await api.mouse('mouseMoved', ls.x - 50 * i, ls.y, { down: true });
  await api.mouse('mouseReleased', ls.x, ls.y, {});
  out.left = { w0, w1: await st('s.ui.leftWidth') };
  // dock splitter
  const ds = await api.eval(`(() => { const e = document.querySelector('.dock .splitter'); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  const h0 = await st('s.ui.dockHeight');
  await api.drag(ds.x, ds.y, ds.x, ds.y + 300, { steps: 6 });
  const h1 = await st('s.ui.dockHeight');
  await api.drag(ds.x, ds.y + 112, ds.x, ds.y - 50, { steps: 6 });
  out.dock = { h0, h1, h2: await st('s.ui.dockHeight') };
  // dock tabs
  for (const t of ['Oscilloscope', 'Console', 'Instruments']) {
    const b = await api.eval(`(() => { const b = [...document.querySelectorAll('.dock-tabs .tab')].find(b => b.textContent.startsWith('${t}')); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    await api.click(b.x, b.y); await api.sleep(80);
    out['dock_' + t] = await st('s.ui.dockTab + (s.ui.dockOpen ? "" : " (closed)")');
  }
  // maximize/restore caption button
  const capMax = await api.eval(`(() => { const b = document.querySelectorAll('.cap-btn')[1]; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  const m0 = await api.eval(`window.optibench.isMaximized()`);
  await api.click(capMax.x, capMax.y); await api.sleep(700);
  const m1 = await api.eval(`window.optibench.isMaximized()`);
  const capMax2 = await api.eval(`(() => { const b = document.querySelectorAll('.cap-btn')[1]; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, label: b.getAttribute('aria-label')}; })()`);
  await api.click(capMax2.x, capMax2.y); await api.sleep(700);
  out.max = { m0, m1, label: capMax2.label, m2: await api.eval(`window.optibench.isMaximized()`) };
  // shortcuts modal via Ctrl+/
  await api.key('/', { modifiers: 'ctrl' }); await api.sleep(150);
  out.shortcuts = await api.eval(`document.querySelector('.dialog .caption')?.textContent`);
  await api.shot(S + '/shortcuts.png');
  await api.key('Escape'); await api.sleep(100);
  out.shortcutsClosed = !(await api.eval(`!!document.querySelector('.dialog')`));
  // palette search
  const find = await api.rect('.palette input[type=search]');
  await api.click(find.cx, find.cy); await api.type('prism');
  await api.sleep(100);
  out.search = await api.eval(`[...document.querySelectorAll('.palette-item')].map(b => b.textContent.trim())`);
  await api.key('Escape');
  out.searchCleared = await api.eval(`document.querySelectorAll('.palette-item').length`);
  // status bar text
  out.status = await api.eval(`document.querySelector('.statusbar')?.innerText.split(String.fromCharCode(10)).join(' | ')`);
  out.errs = errs;
  return out;
};
