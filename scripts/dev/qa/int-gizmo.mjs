// 3D gizmo in the app: drag the X arrow, the Z arrow and the yaw / pitch rings of a selected component,
// verify the document pose and that undo restores it. Screenshots docs/screenshots/int-3d-toggle.png,
// int-3d-gizmo.png. usage: node scripts/dev/cdp.mjs run scripts/dev/qa/int-gizmo.mjs
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  const list = await ev(`window.optibench.listExamples()`);
  const ex = list.find((e) => e.file.startsWith('01-'));
  await ev(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); __obw.useApp.getState().clearLogs(); __obw.commands.loadText(f.text, f.path, true); __obw.commands.setOpticsDim('2d'); })()`);
  await api.sleep(700);
  const out = {};
  // toggle with the toolbar button "3D"
  const b3 = await ev(`(() => { const b = [...document.querySelectorAll('.tb-dim button')].find(x => x.textContent === '3D'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await api.click(b3.x, b3.y);
  await api.sleep(1500);
  out.toggle = await ev(`(() => { const s = __obw.useApp.getState(); return { dim: s.opticsDim, meta: s.doc.meta.dimension, undoLabel: s.past[s.past.length - 1]?.label, poses: s.doc.optics.components.every(c => c.pose3d && c.pose3d.z === 0), has3d: !!document.querySelector('[data-testid=optics3d-viewport]'), tr3: __obw.useSim.getState().trace3d?.stats.segments }; })()`);
  await api.shot('docs/screenshots/int-3d-toggle.png');

  const prism = await ev(`__obw.useApp.getState().doc.optics.components.find(c => c.type.startsWith('prism')).id`);
  await ev(`__obw.useApp.getState().setSelection('optics', [${JSON.stringify(prism)}])`);
  await api.sleep(300);
  const scr = (v) => ev(`(() => { const rt = window.__optics3d; const T = rt.camera.position.constructor; return rt.toScreen(new T(${v.x},${v.y},${v.z})); })()`);
  const comp = () => ev(`__obw.useApp.getState().doc.optics.components.find(c => c.id === ${JSON.stringify(prism)})`);
  const unit = () => ev(`window.__optics3d.gizmo.unit`);
  const W = (c) => ({ x: c.position.x, y: -c.position.y, z: c.pose3d?.z ?? 0 });
  const histLen = () => ev(`__obw.useApp.getState().past.length`);
  const cam = async (p) => { await ev(`window.__optics3d.setCameraPreset('${p}', false)`); await api.sleep(400); };

  // ---- X arrow (iso view)
  await cam('iso');
  let c0 = await comp(); let P = W(c0); let u = await unit();
  const h0 = await histLen();
  const a0 = await scr({ x: P.x + 0.75 * u, y: P.y, z: P.z }); const a1 = await scr({ x: P.x + 1.75 * u, y: P.y, z: P.z });
  await api.drag(a0.x, a0.y, a1.x, a1.y, { steps: 10 });
  await api.sleep(250);
  let c1 = await comp();
  out.xArrow = { dx: +(c1.position.x - c0.position.x).toFixed(3), dy: +(c1.position.y - c0.position.y).toFixed(3), z: c1.pose3d?.z, undoSteps: (await histLen()) - h0, label: await ev(`__obw.useApp.getState().past.at(-1)?.label`) };

  // ---- Z arrow
  c0 = await comp(); P = W(c0); u = await unit();
  const z0 = await scr({ x: P.x, y: P.y, z: P.z + 0.75 * u }); const z1 = await scr({ x: P.x, y: P.y, z: P.z + 1.75 * u });
  const L = Math.hypot(z1.x - z0.x, z1.y - z0.y);
  const zt = { x: z0.x + ((z1.x - z0.x) / L) * 60, y: z0.y + ((z1.y - z0.y) / L) * 60 };
  await api.drag(z0.x, z0.y, zt.x, zt.y, { steps: 10 });
  await api.sleep(250);
  c1 = await comp();
  out.zArrow = { z0: c0.pose3d?.z, z1: c1.pose3d?.z, xyUnchanged: c1.position.x === c0.position.x && c1.position.y === c0.position.y };

  // ---- yaw ring (top view), 90° screen sweep with Shift snapping
  await cam('top');
  c0 = await comp(); P = W(c0); u = await unit();
  const R = 1.32 * u;
  const pts = [];
  for (let i = 0; i <= 18; i++) { const a = -Math.PI / 4 + (i / 18) * (Math.PI / 2); pts.push(await scr({ x: P.x + R * Math.cos(a), y: P.y + R * Math.sin(a), z: P.z })); }
  await api.move(pts[0].x, pts[0].y);
  await api.mouse('mousePressed', pts[0].x, pts[0].y, { down: true });
  for (const p of pts.slice(1)) await api.mouse('mouseMoved', p.x, p.y, { down: true, modifiers: 'shift' });
  await api.sleep(200);
  out.yawReadout = await ev(`document.querySelector('.o3d-readout')?.textContent`);
  await api.mouse('mouseReleased', pts[18].x, pts[18].y, { down: false, modifiers: 'shift' });
  await api.sleep(250);
  c1 = await comp();
  out.yawRing = { rot0deg: +(c0.rotation * 180 / Math.PI).toFixed(3), rot1deg: +(c1.rotation * 180 / Math.PI).toFixed(3), pose: c1.pose3d };

  // ---- pitch ring (front view)
  await cam('front');
  c0 = await comp(); P = W(c0); u = await unit();
  const yaw = -c0.rotation;
  const e1 = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const ringPt = (a) => ({ x: P.x + 1.32 * u * e1.x * Math.cos(a), y: P.y + 1.32 * u * e1.y * Math.cos(a), z: P.z + 1.32 * u * Math.sin(a) });
  const pp = [];
  for (let i = 0; i <= 12; i++) pp.push(await scr(ringPt(0.35 + (i / 12) * 0.6)));
  await api.move(pp[0].x, pp[0].y);
  await api.mouse('mousePressed', pp[0].x, pp[0].y, { down: true });
  for (const p of pp.slice(1)) await api.mouse('mouseMoved', p.x, p.y, { down: true });
  await api.sleep(200);
  out.pitchReadout = await ev(`document.querySelector('.o3d-readout')?.textContent`);
  await api.mouse('mouseReleased', pp[12].x, pp[12].y, { down: false });
  await api.sleep(250);
  c1 = await comp();
  out.pitchRing = { before: c0.pose3d, after: c1.pose3d, rotUnchanged: c1.rotation === c0.rotation };

  // inspector shows the pose
  out.inspector = await ev(`(() => { const box = [...document.querySelectorAll('fieldset.group-box')].find(f => f.querySelector('legend')?.textContent.includes('3D Pose')); return box ? box.innerText.replace(/\\s+/g, ' ').slice(0, 200) : null; })()`);
  await cam('iso');
  await ev(`window.__optics3d.frameSelection()`);
  await api.sleep(900);
  await api.shot('docs/screenshots/int-3d-gizmo.png');

  // ---- undo everything back to the converted document, then the conversion itself
  const steps = [];
  for (let i = 0; i < 4; i++) {
    steps.push(await ev(`__obw.useApp.getState().past.at(-1)?.label`));
    await api.key('z', { modifiers: 'ctrl' });
    await api.sleep(150);
  }
  const cu = await comp();
  out.undo = { steps, pose: cu.pose3d, rot: cu.rotation, pos: cu.position, orig: c0 && undefined };
  out.original = await ev(`(async () => { const f = await window.optibench.openPath(${JSON.stringify(ex.path)}); const d = JSON.parse(f.text); return d.optics.components.find(c => c.id === ${JSON.stringify(prism)}); })()`);
  // switch to 2D keeps pose data
  for (let i = 0; i < 4; i++) await ev(`__obw.useApp.getState().redo()`);
  await api.sleep(100);
  await ev(`__obw.commands.setOpticsDim('2d')`);
  await api.sleep(400);
  out.back2d = await ev(`(() => { const s = __obw.useApp.getState(); const c = s.doc.optics.components.find(c => c.id === ${JSON.stringify(prism)}); return { dim: s.opticsDim, pose: c.pose3d, badge: !!document.querySelector('.insp-badge-3d'), note: document.querySelector('.insp-note')?.textContent?.slice(0, 80) ?? null }; })()`);
  out.errors = errs;
  return out;
};
