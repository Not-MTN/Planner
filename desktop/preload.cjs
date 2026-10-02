/**
 * The small bridge between the desktop window and the main process.
 *
 * Everything here is deliberate and tiny: the page gets a name it can detect
 * (`window.plannerDesktop`), a way to open a link in the real browser, and the
 * version of the app it is running inside. Nothing about the user's planner is
 * exposed, and nothing here can read or write files.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plannerDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke('planner:app-version'),
  openExternal: (url) => ipcRenderer.invoke('planner:open-external', url),
});
