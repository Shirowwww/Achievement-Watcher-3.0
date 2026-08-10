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
  // Header × button. The overlay is a frameless always-on-top window, so it has no system
  // title bar to close it with. (The old minimize/maximize/close bridge was dead code: the
  // main process never registered handlers for those channels.)
  closeOverlay: () => ipcRenderer.send('overlay-close'),
  // Gamepad window control from the in-game overlay (move / resize).
  moveWindowBy: (dx, dy) => ipcRenderer.send('overlay-move-by', { dx: Number(dx) || 0, dy: Number(dy) || 0 }),
  resizeWindowBy: (dw, dh) => ipcRenderer.send('overlay-resize-by', { dw: Number(dw) || 0, dh: Number(dh) || 0 }),
});

ipcRenderer.on('set-window-scale', (event, scale) => {
  webFrame.setZoomFactor(scale);
});

contextBridge.exposeInMainWorld('api', {
  // Resolve an achievement icon to a local file path (same IPC as the main window).
  fetchIcon: (icon, appid) => ipcRenderer.invoke('fetch-icon', icon, appid),

  // Active app theme (built-in, user CSS, or Custom) resolved into overlay CSS.
  getThemePayload: () => ipcRenderer.invoke('get-theme-payload'),

  // Push channels used by overlay.html: initial data, locale, and refresh requests.
  onOverlay: (callback) => ipcRenderer.on('show-overlay', (event, data) => callback(data)),
  onOverlayLanguage: (callback) => ipcRenderer.on('overlay-language', (event, data) => callback(data)),
  onOverlayTheme: (callback) => ipcRenderer.on('overlay-theme', (event, data) => callback(data)),
  onRefreshAchievementsTable: (callback) => ipcRenderer.on('refresh-achievements-table', (event, data) => callback(data)),
});
