'use strict';

// Minimal preload for the in-game overlay list window (app/view/overlay.html).
// Intentionally requires ONLY electron (sandbox-safe), like notificationPreload.js:
// the previous preload pulled app modules (e.g. ./parser/achievements) that fail to
// load in this window's sandboxed preload context, which took the whole bridge down
// — overlay.html never got `window.api`, its script crashed on the first call, and
// the list could not render achievements. Game data is already fetched by the main
// process (createOverlayWindow -> achievementsJS.getSavedAchievementsForAppid) and
// pushed over `show-overlay`, so the renderer only needs icon lookup + those pushes.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('customApi', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
});

ipcRenderer.on('set-window-scale', (event, scale) => {
  webFrame.setZoomFactor(scale);
});

contextBridge.exposeInMainWorld('api', {
  // Resolve an achievement icon to a local file path (same IPC as the main window).
  fetchIcon: (icon, appid) => ipcRenderer.invoke('fetch-icon', icon, appid),

  // Push channels used by overlay.html: initial data, locale, and refresh requests.
  onOverlay: (callback) => ipcRenderer.on('show-overlay', (event, data) => callback(data)),
  onOverlayLanguage: (callback) => ipcRenderer.on('overlay-language', (event, data) => callback(data)),
  onRefreshAchievementsTable: (callback) => ipcRenderer.on('refresh-achievements-table', (event, data) => callback(data)),
});
