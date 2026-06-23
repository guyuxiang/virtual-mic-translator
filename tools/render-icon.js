// Render assets/icon.svg → assets/icon.png (1024×1024, transparent) via Chromium.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../assets/icon.svg'), 'utf-8');
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`;

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../assets/icon.png'), img.toPNG());
  app.quit();
});
