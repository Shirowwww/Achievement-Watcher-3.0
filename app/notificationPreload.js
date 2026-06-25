'use strict';

// Minimal preload for the overlay-notification window.
// Intentionally requires ONLY electron (sandbox-safe): unlike overlayPreload.js, which pulls in
// app modules (e.g. ./parser/achievements) that fail to load in this window's preload context and
// take the whole bridge down with them. Presets only need this tiny notification API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Receive the achievement payload pushed by the main process after the preset loads.
  onNotification: (callback) => ipcRenderer.on('show-notification', (event, data) => callback(data)),
  // Presets call this to dismiss themselves once their out-animation finishes (handled in ipc.js).
  closeNotificationWindow: () => ipcRenderer.send('close-notification-window'),
  // Optional hook some presets call when their first frame is painted (used later for screenshots).
  notificationRenderReady: () => ipcRenderer.send('notification-render-ready'),
});
