// node cdp.mjs run zoomshot.mjs out.png x y w h scale
export default async (api, a) => {
  const [file, x, y, w, h, sc] = a;
  const r = await api.send('Page.captureScreenshot', { format: 'png', clip: { x: +x, y: +y, width: +w, height: +h, scale: +(sc || 3) } });
  (await import('node:fs')).writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  return file;
};
