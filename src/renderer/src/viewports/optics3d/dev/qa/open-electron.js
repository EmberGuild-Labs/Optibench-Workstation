const { app, BrowserWindow } = require('electron');
const url = process.argv[process.argv.length - 1];
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1400, height: 860, show: true, x: 20, y: 20, useContentSize: true });
  win.loadURL(url);
});
