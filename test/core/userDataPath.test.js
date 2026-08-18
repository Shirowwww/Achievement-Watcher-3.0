'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appPaths = require('../../app/util/userDataPath.js');
const watchdogPaths = require('../../watchdog/util/userData.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-userdata-path-'));
const previousAppData = process.env.APPDATA;
const previousAw = process.env.AW_USER_DATA;

(async () => {
  try {
    process.env.APPDATA = tmp;
    delete process.env.AW_USER_DATA;

    // AW Next must live in its own directory - never either predecessor's folder (issue #6).
    // The app and the Watchdog have to agree on it, or the monitor writes somewhere the UI never reads.
    assert.equal(appPaths.userDataDir(), path.join(tmp, 'Achievement Watcher Next'));
    assert.equal(appPaths.aw3UserDataDir(), path.join(tmp, 'Achievement Watcher 3.0'));
    assert.equal(appPaths.legacyUserDataDir(), path.join(tmp, 'Achievement Watcher'));
    assert.equal(watchdogPaths.userDataDir(), path.join(tmp, 'Achievement Watcher Next'));

    // The Watchdog trusts the path the main process passes through AW_USER_DATA.
    process.env.AW_USER_DATA = path.join(tmp, 'Custom Dir');
    appPaths.resetCache();
    watchdogPaths.resetCache();
    assert.equal(appPaths.userDataDir(), path.join(tmp, 'Custom Dir'));
    assert.equal(watchdogPaths.userDataDir(), path.join(tmp, 'Custom Dir'));

    console.log('PASS: userDataPath helpers');
  } finally {
    if (previousAw === undefined) delete process.env.AW_USER_DATA;
    else process.env.AW_USER_DATA = previousAw;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
