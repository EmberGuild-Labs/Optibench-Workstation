// QA for the 3D gizmo: run with  CDP_PORT=9343 node scripts/dev/cdp.mjs run <this>
const S = process.env.O3D;
export default async (api) => {
  const errs = await api.collect();
  const ev = (s) => api.eval(s);
  await ev(`location.href = 'http://localhost:5203/preview.html?ex=01&sel=prism'`);
  await api.sleep(3500);
  const scr = (x, y, z) => ev(`(() => { const rt = window.__optics3d; const T = rt.camera.position.constructor; return rt.toScreen(new T(${x},${y},${z})); })()`);
  const comp = (id) => ev(`window.__harness.scene().components.find(c => c.id === '${id}')`);
  const unit = () => ev(`window.__optics3d.gizmo.unit`);
  const out = {};
  // --- top view orientation
  const top = await api.rect('.o3d-bar button');
  await api.click(top.cx, top.cy); await api.sleep(900);
  await api.shot(S + '/top.png');
  out.topScreens = { source: await scr(-200, 0, 0), prism: await scr(0, -8, 0), fold: await scr(81, -87, 0), screen: await scr(320, -87, 0) };
  // --- iso view, X arrow drag
  const iso = await api.eval(`[...document.querySelectorAll('.o3d-bar button')].find(b => b.textContent === 'Iso').getBoundingClientRect().toJSON()`);
  await api.click(iso.x + 5, iso.y + 5); await api.sleep(900);
  await api.shot(S + '/iso-sel.png');
  const testAxis = async (axis, px) => {
    const c0 = await comp('prism');
    const P = { x: c0.position.x, y: -c0.position.y, z: c0.pose3d?.z ?? 0 };
    const u = await unit();
    const d = { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 };
    const g = { x: P.x + d.x * u * 0.75, y: P.y + d.y * u * 0.75, z: P.z + d.z * u * 0.75 };
    const s0 = await scr(g.x, g.y, g.z);
    const s1 = await scr(g.x + d.x * u, g.y + d.y * u, g.z + d.z * u);
    const L = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    const e = { x: s0.x + (s1.x - s0.x) / L * px, y: s0.y + (s1.y - s0.y) / L * px };
    await api.drag(s0.x, s0.y, e.x, e.y, { steps: 15, modifiers: 'ctrl' }); // ctrl = no snap -> exact follow
    await api.sleep(300);
    const c1 = await comp('prism');
    const P1 = { x: c1.position.x, y: -c1.position.y, z: c1.pose3d?.z ?? 0 };
    const moved = { x: P1.x - P.x, y: P1.y - P.y, z: P1.z - P.z };
    // the grabbed point must still be under the cursor
    const g1 = await scr(g.x + moved.x, g.y + moved.y, g.z + moved.z);
    return { axis, moved, cursorErrPx: Math.hypot(g1.x - e.x, g1.y - e.y), offAxis: Object.entries(moved).filter(([k]) => k !== axis).map(([, v]) => Math.abs(v)).reduce((a, b) => Math.max(a, b), 0) };
  };
  out.x = await testAxis('x', 120);
  out.y = await testAxis('y', 80);
  out.z = await testAxis('z', 60);
  // snapping (default 1 mm)
  const c2 = await comp('prism');
  out.afterSnapTest = c2.position;
  out.log = await ev('window.__harness.log.slice(0, 5)');
  out.errors = errs;
  console.log(JSON.stringify(out, null, 1));
};
