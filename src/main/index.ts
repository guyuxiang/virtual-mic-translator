/**
 * Electron Main Process.
 *
 *  - Single always-on-top window, minimizes to tray instead of quitting
 *  - System tray with status + start/stop
 *  - Virtual audio device detection (platform-specific)
 *  - IPC handlers for the renderer
 */

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { detectVirtualDevice } from './devices';
import { createTray, updateTray, TrayState } from './tray';

export interface DriverInstallResult {
  ok: boolean;
  reason?: 'unsupported' | 'missing-bundle' | 'launch-failed' | 'install-failed';
  message?: string;
  rebootRecommended?: boolean;
}

// Bundled driver directory (packaged: resources/drivers, dev: repo).
function driverDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drivers')
    : path.join(__dirname, '../../drivers/windows');
}
const single = (p: string) => `'${p.replace(/'/g, "''")}'`; // PowerShell single-quote escape

// Runtime fallback: install the bundled VB-Cable driver with elevation (UAC).
// Prefers setup-audio.ps1 (records + restores the default speaker so system
// audio keeps working); falls back to the raw installer if it's missing.
function installVirtualDriver(): Promise<DriverInstallResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'unsupported', message: 'Only supported on Windows.' });
      return;
    }
    const dir = driverDir();
    const helper = path.join(dir, 'setup-audio.ps1');
    const installer = path.join(dir, 'VBCABLE_Setup_x64.exe');

    let inner: string;
    if (fs.existsSync(helper)) {
      inner = `powershell -NoProfile -ExecutionPolicy Bypass -File ${single(helper)} ${single(dir)}`;
    } else if (fs.existsSync(installer)) {
      inner = `${single(installer)} -i -h`;
    } else {
      resolve({ ok: false, reason: 'missing-bundle', message: 'Bundled installer not found.' });
      return;
    }

    // Re-launch the inner command elevated (one UAC prompt) and wait.
    const ps = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ${inner.replace(/'/g, "''")}' -Verb RunAs -Wait`;
    execFile('powershell', ['-NoProfile', '-Command', ps], (err) => {
      if (err) {
        resolve({ ok: false, reason: 'launch-failed', message: String(err.message) });
      } else {
        resolve({ ok: true, rebootRecommended: true });
      }
    });
  });
}

let mainWindow: BrowserWindow | null = null;

// Audio capture/playback needs a "user gesture" exemption in some Electron
// builds, and getUserMedia in the renderer needs mic permission auto-granted.
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 520,
    minHeight: 560,
    title: 'Virtual Mic Translator',
    icon: path.join(__dirname, '../../assets/icon.png'),
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  // Forward renderer console to the main process stdout (useful for debugging
  // and headless verification).
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });

  // Screenshot hook for visual verification. Never runs in prod.
  if (process.env.VMT_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      const pw = process.env.VMT_TEST_LOGIN;
      const delay = pw ? 6000 : 2500;
      if (pw) {
        setTimeout(() => {
          mainWindow?.webContents.executeJavaScript(
            `(() => { const p=document.getElementById('login-password'); p.value=${JSON.stringify(pw)}; document.getElementById('login-btn').click(); })()`
          );
        }, 1500);
      }
      setTimeout(async () => {
        const img = await mainWindow!.webContents.capturePage();
        fs.writeFileSync(process.env.VMT_SCREENSHOT as string, img.toPNG());
        (app as unknown as { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }, delay);
    });
  }

  // Headless verification hook: auto-click Start, then quit. Never runs in prod.
  if (process.env.VMT_TEST_AUTOSTART) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        mainWindow?.webContents.executeJavaScript(
          `document.getElementById('action-btn').click(); 'clicked'`
        );
      }, 1500);
      setTimeout(() => {
        (app as unknown as { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }, 12000);
    });
  }

  // Auto-grant microphone permission (this app's whole purpose is the mic).
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  // Closing the window quits the app (no minimize-to-tray).
}

function registerIpcHandlers(): void {
  ipcMain.handle('detect-virtual-device', () => detectVirtualDevice());

  // Whether a bundled driver installer is available for one-click install.
  ipcMain.handle('can-install-driver', () =>
    process.platform === 'win32' && fs.existsSync(path.join(driverDir(), 'VBCABLE_Setup_x64.exe'))
  );

  ipcMain.handle('install-virtual-driver', () => installVirtualDriver());

  ipcMain.handle('open-external', async (_e, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('set-always-on-top', (_e, onTop: boolean) => {
    mainWindow?.setAlwaysOnTop(onTop);
  });

  ipcMain.on('update-status', (_e, status: TrayState) => {
    if (mainWindow) updateTray(mainWindow, status);
  });
}

app.whenReady().then(() => {
  createWindow();
  if (mainWindow) createTray(mainWindow);
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) createTray(mainWindow);
    } else {
      mainWindow?.show();
    }
  });
});

// Quit the app when the window is closed (no tray persistence).
app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
});

// Surface uncaught main-process errors instead of dying silently.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err);
  if (mainWindow) {
    dialog.showErrorBox('Unexpected error', String(err?.stack || err));
  }
});
