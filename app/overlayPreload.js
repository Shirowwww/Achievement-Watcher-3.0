'use strict';

// Minimal sandbox-safe preload for the overlay window: requires only electron (the old preload pulled
// app modules that failed in this context). Game data arrives via show-overlay from the main process.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('customApi', {
  // Header × button. The overlay is a frameless always-on-top window, so it has no system
  // title bar to close it with. (The old minimize/maximize/close bridge was dead code: the
  // main process never registered handlers for those channels.)
  closeOverlay: () => ipcRenderer.send('overlay-close'),
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
  onControllerConfig: (callback) => ipcRenderer.on('overlay-controller-config', (event, data) => callback(data)),
  onControllerMode: (callback) => ipcRenderer.on('overlay-controller-mode', (event, data) => callback(data)),
  onOverlayVisibility: (callback) => ipcRenderer.on('overlay-visibility', (event, data) => callback(data)),
  onRefreshAchievementsTable: (callback) => ipcRenderer.on('refresh-achievements-table', (event, data) => callback(data)),
});
