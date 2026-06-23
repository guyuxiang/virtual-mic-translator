/**
 * System tray — the app lives here most of the time.
 *
 * Shows translation status, lets the user start/stop translating without
 * opening the window, show the window, or quit.
 */

import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';

export interface TrayState {
  translating: boolean;
  from?: string;
  to?: string;
}

let tray: Tray | null = null;
let state: TrayState = { translating: false };

// A tiny 16x16 dot icon, tinted by status. nativeImage from a data URL keeps
// us asset-free for the MVP. Green = translating, grey = idle.
function dotIcon(color: string): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return nativeImage.createFromDataURL(dataUrl);
}

function buildMenu(win: BrowserWindow): Menu {
  const statusLabel = state.translating
    ? `● Translating  ${state.from ?? ''} → ${state.to ?? ''}`.trim()
    : '○ Idle';

  return Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: state.translating ? 'Stop translating' : 'Start translating',
      click: () => win.webContents.send('tray-action', state.translating ? 'stop' : 'start'),
    },
    {
      label: 'Show window',
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as unknown as { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      },
    },
  ]);
}

export function createTray(win: BrowserWindow): Tray {
  tray = new Tray(dotIcon('#b6b4a9'));
  tray.setToolTip('Virtual Mic Translator');
  tray.setContextMenu(buildMenu(win));
  tray.on('double-click', () => {
    win.show();
    win.focus();
  });
  return tray;
}

export function updateTray(win: BrowserWindow, next: TrayState): void {
  state = next;
  if (!tray) return;
  tray.setImage(dotIcon(next.translating ? '#d97757' : '#b6b4a9'));
  tray.setToolTip(
    next.translating
      ? `Translating ${next.from ?? ''} → ${next.to ?? ''}`.trim()
      : 'Virtual Mic Translator — idle'
  );
  tray.setContextMenu(buildMenu(win));
}
