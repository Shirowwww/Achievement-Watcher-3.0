'use strict';

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const { fetchIcon } = require('../parser/steam');
const { pathToFileURL } = require('url');
const achievementsJS = require(path.join(__dirname, '../parser/achievements.js'));
achievementsJS.initDebug({ isDev: app.isDev || false, userDataPath: app.getPath('userData') });
const settingsJS = require(path.join(__dirname, '../settings.js'));
settingsJS.setUserDataPath(app.getPath('userData'));
const { getSteamUsersList } = require(path.join(__dirname, '../parser/steam.js'));

function getStartupLoginItemOptions(openAtLogin) {
  const args = [];
  if (process.defaultApp) args.push(app.getAppPath());
  args.push('--hidden');
  return {
    openAtLogin: openAtLogin === true,
    path: process.execPath,
    args,
  };
}

function getStartupLoginItemQueryOptions() {
  const options = getStartupLoginItemOptions(true);
  return {
    path: options.path,
    args: options.args,
  };
}

function setStartWithWindows(enabled) {
  app.setLoginItemSettings(getStartupLoginItemOptions(enabled));
  return true;
}

function getStartWithWindows() {
  const state = app.getLoginItemSettings(getStartupLoginItemQueryOptions());
  return state.openAtLogin === true;
}

ipcMain.handle('startup:get-start-with-windows', async () => {
  return getStartWithWindows();
});

ipcMain.handle('startup:set-start-with-windows', async (_event, enabled) => {
  return setStartWithWindows(enabled === true);
});

// RAR extraction for the CrakFiles community-fix apply. node-unrar-js is WASM+Embind and uses
// `new Function`, which the renderer's strict CSP forbids — so the renderer delegates the extraction to
// here (main process, no CSP). Writes the archive's contents into destDir; the renderer then installs
// them into the game folder. Returns { ok } or { error } (never throws across the IPC boundary).
const crackFixJS = require(path.join(__dirname, '../parser/crackFix.js'));
ipcMain.handle('crackfix-extract-rar', async (_event, { archivePath, destDir } = {}) => {
  try {
    await crackFixJS.extractRarToDir(archivePath, destDir);
    return { ok: true };
  } catch (err) {
    return { error: (err && (err.message || String(err))) || 'unknown error' };
  }
});

// Handler for renderer process
ipcMain.handle('get-app-name', () => {
  return app.getName();
});
ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

ipcMain.on('get-app-name-sync', (event) => {
  event.returnValue = app.getName();
});

ipcMain.on('get-user-data-path-sync', (event) => {
  const t = app.getPath('userData');
  event.returnValue = t;
});

ipcMain.on('get-steam-user-list', async (event) => {
  await getSteamUsersList()
    .then((p) => (event.returnValue = p))
    .catch((err) => (event.returnValue = null));
});

ipcMain.on('fetch-icon', async (event, url, appid) => {
  try {
    const p = await fetchIcon(url, appid);
    event.returnValue = p ? pathToFileURL(p).href : null;
  } catch {
    event.returnValue = null;
  }
});
ipcMain.handle('fetch-icon', async (event, url, appid) => {
  const p = await fetchIcon(url, appid);
  return p ? pathToFileURL(p).href : null;
});

async function doCloseNotificationWindow(win) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(false);
  if (win.isVisible()) {
    win.hide();
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!win.isDestroyed()) win.close();
}

ipcMain.on('close-notification-window', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  // Custom-duration freeze-hold (set in createNotificationWindow): if the preset asks to close while the
  // notification is still in its hold window, defer the close so it stays on screen for the chosen time.
  const remaining = (win.awFrozenUntil || 0) - Date.now();
  if (remaining > 0) {
    win.awFrozenUntil = 0; // defer only once
    setTimeout(() => doCloseNotificationWindow(win), remaining);
    return;
  }
  doCloseNotificationWindow(win);
});

module.exports.window = () => {
  ipcMain.handle('win-close', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.close();
  });

  ipcMain.handle('win-minimize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.minimize();
  });

  ipcMain.handle('win-maximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.handle('win-isMinimizable', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win.minimizable;
  });

  ipcMain.handle('win-isMaximizable', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win.maximizable;
  });

  ipcMain.handle('win-isFrameless', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win.isFrameless;
  });

  //Sync

  ipcMain.on('win-isDev', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = win.isDev;
  });
};

module.exports.setStartWithWindows = setStartWithWindows;
