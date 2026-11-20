// Dev helper: capture a URL to PNG with Electron.
// Usage: electron scripts/dev/capture.js <url> <out.png> [w] [h] [waitMs]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const log = (m) => fs.appendFileSync(path.join(__dirname, 'cap.log'), m + '\n');
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('capture.js')) + 1);
const [url, out, w = '1400', h = '860', wait = '3500'] = args;
log('start ' + JSON.stringify(args));
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: +w, height: +h, show: true, x: 0, y: 0 });
    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, +wait));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    log('saved ' + out);
  } catch (e) {
    log('error ' + (e && e.stack));
  }
  app.quit();
});
