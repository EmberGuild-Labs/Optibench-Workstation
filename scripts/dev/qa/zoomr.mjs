export default async (api, a) => {
  const [x, y, w, h, sc, file] = a;
  const r = await api.send('Page.captureScreenshot', { format: 'png', clip: { x: +x, y: +y, width: +w, height: +h, scale: +sc } });
  (await import('node:fs')).writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  return file;
};
