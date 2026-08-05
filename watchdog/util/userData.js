'use strict';

const path = require('path');

// Mirrors app/util/userDataPath.js for the standalone Watchdog process. The Electron main process
// passes its (3.0) user-data root through AW_USER_DATA when spawning the monitor; standalone runs
// (dev, tests) fall back to the same 3.0 directory so the monitor never touches the legacy 1.6.8
// folder again (issue #6).
const APP_DATA_DIR_NAME = 'Achievement Watcher 3.0';

let cached = null;

function userDataDir() {
  if (cached) return cached;
  if (process.env.AW_USER_DATA) {
    cached = process.env.AW_USER_DATA;
  } else {
    cached = path.join(process.env['APPDATA'] || '', APP_DATA_DIR_NAME);
  }
  return cached;
}

function resetCache() {
  cached = null;
}

module.exports = { APP_DATA_DIR_NAME, userDataDir, resetCache };
