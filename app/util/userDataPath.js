'use strict';

const path = require('path');

// Achievement Watcher 3.x keeps its data OUT of the legacy `%APPDATA%\Achievement Watcher` folder
// used by the original 1.6.8 app, whose uninstaller deletes that directory (issue #6). This is the
// single source of truth for the 3.x user-data root. The Electron main process sets the real path
// via app.setPath('userData'); the renderer reads it back through @electron/remote; standalone
// contexts (unit tests, scripts) fall back to the same 3.0 directory name under %APPDATA%.
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
