'use strict';

// Regression (issue #10): a locally uploaded avatar used to live only in localStorage (Chromium
// profile state), which the one-time %APPDATA%\Achievement Watcher 3.0 migration deliberately never
// imports — so it silently vanished on upgrade. avatarStore.js persists it as a plain file under
// `cfg/` instead, which the existing `{ rel: 'cfg', mode: 'copy' }` migration-plan entry already
// covers with no changes needed there. This test stubs Electron's ipcRenderer (unavailable outside
// the Electron runtime) and asserts the store round-trips through exactly that path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const { MIGRATION_PLAN } = require('../app/util/migrateUserData.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar-store-'));
const userDataPath = path.join(tmp, 'Achievement Watcher 3.0');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { ipcRenderer: { sendSync: () => userDataPath } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const avatarStore = require('../app/util/avatarStore.js');
Module._load = originalLoad;

test('avatarStore persists the avatar under cfg/, which the migration plan already copies', () => {
  assert.equal(avatarStore.getAvatar(), null, 'no avatar set yet');

  const dataUri = 'data:image/png;charset=utf-8;base64,AAAA';
  avatarStore.setAvatar(dataUri);

  const file = path.join(userDataPath, 'cfg', 'avatar.txt');
  assert.equal(fs.existsSync(file), true, 'avatar.txt must be written under cfg/');
  assert.equal(avatarStore.getAvatar(), dataUri);

  // The migration plan copies the whole `cfg` folder — confirm avatar.txt rides along by construction
  // rather than needing its own entry.
  const cfgEntry = MIGRATION_PLAN.find((p) => p.rel === 'cfg');
  assert.ok(cfgEntry, 'migration plan must have a cfg entry');
  assert.equal(cfgEntry.mode, 'copy');
  assert.equal(path.dirname(file), path.join(userDataPath, 'cfg'));

  avatarStore.clearAvatar();
  assert.equal(avatarStore.getAvatar(), null);
  assert.equal(fs.existsSync(file), false);
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
