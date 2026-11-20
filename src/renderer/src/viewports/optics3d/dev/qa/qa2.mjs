const S = process.env.O3D;
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=01&sel=prism&cam=top'`);
  await api.sleep(3500);
  const scr = (v) => ev(`(() => { const rt = window.__optics3d; const T = rt.camera.position.constructor; return rt.toScreen(new T(${v.x},${v.y},${v.z})); })()`);
  const comp = (id) => ev(`window.__harness.scene().components.find(c => c.id === '${id}')`);
  const unit = () => ev(`window.__optics3d.gizmo.unit`);
  const btn = async (t) => { const r = await ev(`[...document.querySelectorAll('.o3d-bar button')].find(b => b.textContent === '${t}').getBoundingClientRect().toJSON()`); await api.click(r.x + r.width / 2, r.y + r.height / 2); await api.sleep(800); };
  const W = (c) => ({ x: c.position.x, y: -c.position.y, z: c.pose3d?.z ?? 0 });
  const out = {};
  // yaw ring in top view: drag 90° CCW (screen) around the pivot, Shift = 15° snap
  let c0 = await comp('prism'); let P = W(c0); let u = await unit(); const R = 1.32 * u;
  const pts = [];
  for (let i = 0; i <= 18; i++) { const a = -Math.PI / 4 + (i / 18) * Math.PI / 2; pts.push(await scr({ x: P.x + R * Math.cos(a), y: P.y + R * Math.sin(a), z: P.z })); }
  await api.move(pts[0].x, pts[0].y);
  await api.mouse('mousePressed', pts[0].x, pts[0].y, { down: true });
  for (const p of pts.slice(1)) await api.mouse('mouseMoved', p.x, p.y, { down: true, modifiers: 'shift' });
  await api.sleep(250);
  await api.shot(S + '/yaw-drag.png');
  out.readoutYaw = await ev(`document.querySelector('.o3d-readout').textContent`);
  await api.mouse('mouseReleased', pts[18].x, pts[18].y, { down: false, modifiers: 'shift' });
  await api.sleep(200);
  let c1 = await comp('prism');
  out.yaw = { rot0deg: c0.rotation * 180 / Math.PI, rot1deg: c1.rotation * 180 / Math.PI, pose: c1.pose3d };
  // Esc cancel: start X drag, press Escape mid-drag
  await btn('Iso');
  c0 = await comp('prism'); P = W(c0); u = await unit();
  const a0 = await scr({ x: P.x + 0.75 * u, y: P.y, z: P.z }); const a1 = await scr({ x: P.x + 1.75 * u, y: P.y, z: P.z });
  await api.move(a0.x, a0.y); await api.mouse('mousePressed', a0.x, a0.y, { down: true });
  for (let i = 1; i <= 8; i++) await api.mouse('mouseMoved', a0.x + (a1.x - a0.x) * i / 8, a0.y + (a1.y - a0.y) * i / 8, { down: true });
  const mid = await comp('prism');
  await api.key('Escape'); await api.sleep(100);
  await api.mouse('mouseReleased', a1.x, a1.y, { down: false }); await api.sleep(200);
  const after = await comp('prism');
  out.esc = { midX: mid.position.x, afterX: after.position.x, startX: c0.position.x };
  // Z arrow
  const z0 = await scr({ x: P.x, y: P.y, z: P.z + 0.75 * u }); const z1 = await scr({ x: P.x, y: P.y, z: P.z + 1.75 * u });
  const L = Math.hypot(z1.x - z0.x, z1.y - z0.y); const zt = { x: z0.x + (z1.x - z0.x) / L * 50, y: z0.y + (z1.y - z0.y) / L * 50 };
  await api.drag(z0.x, z0.y, zt.x, zt.y, { steps: 10 }); await api.sleep(200);
  const cz = await comp('prism');
  const g1 = await scr({ x: P.x, y: P.y, z: P.z + 0.75 * u + (cz.pose3d.z - P.z) });
  out.z = { z: cz.pose3d.z, posUnchanged: cz.position.x === c0.position.x && cz.position.y === c0.position.y, cursorErrPx: Math.hypot(g1.x - zt.x, g1.y - zt.y) };
  // pitch ring (front view: pitch axis = Rz(yaw)·ŷ is ~ along view dir -> plane mode)
  await btn('Front');
  c0 = await comp('prism'); P = W(c0); u = await unit();
  const yaw = -c0.rotation; const pa = { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 };
  // ring points: in plane ⟂ pitch axis spanned by roll-ish e1 = (cos yaw, sin yaw, 0) and Z
  const e1 = { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 };
  const ringPt = (a) => ({ x: P.x + 1.32 * u * (e1.x * Math.cos(a)), y: P.y + 1.32 * u * (e1.y * Math.cos(a)), z: P.z + 1.32 * u * Math.sin(a) });
  const pp = []; for (let i = 0; i <= 12; i++) pp.push(await scr(ringPt(0.35 + i / 12 * 0.6)));
  await api.move(pp[0].x, pp[0].y); await api.mouse('mousePressed', pp[0].x, pp[0].y, { down: true });
  for (const p of pp.slice(1)) await api.mouse('mouseMoved', p.x, p.y, { down: true });
  await api.sleep(200);
  await api.shot(S + '/pitch-drag.png');
  out.readoutPitch = await ev(`document.querySelector('.o3d-readout').textContent`);
  await api.mouse('mouseReleased', pp[12].x, pp[12].y, { down: false }); await api.sleep(200);
  const cp = await comp('prism');
  out.pitch = { before: c0.pose3d, after: cp.pose3d, rotUnchanged: cp.rotation === c0.rotation, pitchAxis: pa };
  await btn('Iso');
  await api.shot(S + '/after-edits.png');
  out.log = await ev('window.__harness.log.slice(0, 8)');
  out.errors = errs.filter((e) => !e.includes('Electron Security Warning'));
  console.log(JSON.stringify(out, null, 1));
};
