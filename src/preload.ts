/**
 * Preload Script — secure bridge between Main and Renderer.
 *
 * Exposes a minimal, whitelisted API via contextBridge. The renderer never
 * touches Node/Electron directly. Audio APIs (getUserMedia, enumerateDevices,
 * setSinkId) live in the renderer's Chromium context and need no bridging.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface VirtualDeviceInfo {
  installed: boolean;
  deviceName: string;
  guide: string;
}

export type TrayAction = 'start' | 'stop';

export interface DriverInstallResult {
  ok: boolean;
  reason?: 'unsupported' | 'missing-bundle' | 'launch-failed' | 'install-failed';
  message?: string;
  rebootRecommended?: boolean;
}

const api = {
  platform: process.platform,

  // Virtual audio driver detection (runs in main process).
  detectVirtualDevice: (): Promise<VirtualDeviceInfo> =>
    ipcRenderer.invoke('detect-virtual-device'),

  // Whether a bundled driver installer is available (Windows + exe present).
  canInstallDriver: (): Promise<boolean> => ipcRenderer.invoke('can-install-driver'),

  // One-click install of the bundled virtual-audio driver (triggers UAC).
  installVirtualDriver: (): Promise<DriverInstallResult> =>
    ipcRenderer.invoke('install-virtual-driver'),

  // Open an external URL in the system browser.
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // Window helpers.
  setAlwaysOnTop: (onTop: boolean): Promise<void> =>
    ipcRenderer.invoke('set-always-on-top', onTop),

  // Push translation status to the tray (icon tooltip + menu state).
  updateStatus: (status: { translating: boolean; from?: string; to?: string }): void =>
    ipcRenderer.send('update-status', status),

  // Tray menu → renderer: "Start / Stop translating".
  onTrayAction: (cb: (action: TrayAction) => void): void => {
    ipcRenderer.on('tray-action', (_e, action: TrayAction) => cb(action));
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
