/**
 * The small bridge between the desktop window and the main process.
 *
 * Everything here is deliberate and tiny: the page gets a name it can detect
 * (`window.plannerDesktop`), a way to open a link in the real browser, the
 * running version, narrow Windows-update actions, and the two pieces of the
 * background mode — whether Planner keeps running when the window closes, and
 * the reminder schedule it should fire while no window is open. Update
 * downloads, installer launches and every value crossing IPC are validated in
 * the main process; no planner files or arbitrary file paths are exposed to
 * the page.
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
  /** `{ background, backgroundExplained }` — the installation's own settings. */
  getPreferences: () => ipcRenderer.invoke('planner:preferences-get'),
  setPreferences: (patch) => ipcRenderer.invoke('planner:preferences-set', patch),
  onPreferences: (listener) => {
    const handler = (_event, preferences) => listener(preferences);
    ipcRenderer.on('planner:preferences-changed', handler);
    return () => ipcRenderer.removeListener('planner:preferences-changed', handler);
  },
  /**
   * Hand the main process the reminders the page worked out, so they can fire
   * with no window open. Titles and bodies never leave the machine: this is an
   * IPC call, not a request.
   */
  setReminders: (schedule) => ipcRenderer.invoke('planner:reminders-set', schedule),
  onUpdateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('planner:update-progress', handler);
    return () => ipcRenderer.removeListener('planner:update-progress', handler);
  },
});
