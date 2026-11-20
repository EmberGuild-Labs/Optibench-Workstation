export default async (api) => {
  const m = await api.eval(`(() => { const b = document.querySelectorAll('.menubar-btn')[0]; const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  const r = [];
  await api.click(m.x, m.y); await api.sleep(100);
  r.push(['after click', await api.eval(`!!document.querySelector('.menu-pop')`), await api.eval(`document.activeElement?.className`)]);
  await api.key('Escape'); await api.sleep(100);
  r.push(['after esc', await api.eval(`!!document.querySelector('.menu-pop')`), await api.eval(`document.activeElement?.className`)]);
  await api.click(m.x, m.y); await api.sleep(100);
  r.push(['after click2', await api.eval(`!!document.querySelector('.menu-pop')`)]);
  await api.click(m.x, m.y); await api.sleep(100);
  r.push(['after click3', await api.eval(`!!document.querySelector('.menu-pop')`)]);
  return r;
};
