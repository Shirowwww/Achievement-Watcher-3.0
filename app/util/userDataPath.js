'use strict';

const path = require('path');

// AW Next keeps its own data folder, distinct from both predecessors, so neither of their
// uninstallers can remove it. Electron sets the path; tests and standalone scripts resolve the
// same folder under %APPDATA%.
//
// The chain is  Achievement Watcher (1.6.8)  ->  Achievement Watcher 3.0  ->  Achievement Watcher Next
// and migrateUserData.js imports forward along it, one hop at a time, without ever deleting a source.
const APP_DATA_DIR_NAME = 'Achievement Watcher Next';
const AW3_DATA_DIR_NAME = 'Achievement Watcher 3.0';
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

function aw3UserDataDir() {
  return path.join(process.env['APPDATA'] || '', AW3_DATA_DIR_NAME);
}

function resetCache() {
  cached = null;
}

module.exports = {
  APP_DATA_DIR_NAME,
  AW3_DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  userDataDir,
  aw3UserDataDir,
  legacyUserDataDir,
  resetCache,
};
