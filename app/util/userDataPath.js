'use strict';

const path = require('path');

// 3.x uses a separate data folder so the legacy uninstaller cannot remove it.
// Electron sets the path; tests and standalone scripts use the same folder under %APPDATA%.
const APP_DATA_DIR_NAME = 'Achievement Watcher 3.0';
const LEGACY_DATA_DIR_NAME = 'Achievement Watcher';

let cached = null;

function userDataDir() {
  if (cached) return cached;

  // Watchdog / main-process spawns receive the authoritative path explicitly.
  if (process.env.AW_USER_DATA) {
    cached = process.env.AW_USER_DATA;
    return cached;
  }

  try {
    const { app } = process.type === 'browser' ? require('electron') : require('@electron/remote');
    if (app && typeof app.getPath === 'function') {
      const p = app.getPath('userData');
      if (p) {
        cached = p;
        return cached;
      }
    }
  } catch {
    /* not running inside Electron (unit tests / plain node) */
  }

  cached = path.join(process.env['APPDATA'] || '', APP_DATA_DIR_NAME);
  return cached;
}

function legacyUserDataDir() {
  return path.join(process.env['APPDATA'] || '', LEGACY_DATA_DIR_NAME);
}

function resetCache() {
  cached = null;
}

module.exports = {
  APP_DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  userDataDir,
  legacyUserDataDir,
  resetCache,
};
