/**
 * The small bridge between the desktop window and the main process.
 *
 * Everything here is deliberate and tiny: the page gets a name it can detect
 * (`window.plannerDesktop`), a way to open a link in the real browser, the
 * running version, and narrow Windows-update actions. Update downloads and
 * installer launches are validated in the main process; no planner files or
 * arbitrary file paths are exposed to the page.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plannerDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke('planner:app-version'),
  openExternal: (url) => ipcRenderer.invoke('planner:open-external', url),
  getUpdateManifest: () => ipcRenderer.invoke('planner:update-manifest'),
  downloadUpdate: (offer) => ipcRenderer.invoke('planner:update-download', offer),
  installUpdate: (offer) => ipcRenderer.invoke('planner:update-install', offer),
  onUpdateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('planner:update-progress', handler);
    return () => ipcRenderer.removeListener('planner:update-progress', handler);
  },
});
