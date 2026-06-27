'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const saveRoots = require('../app/parser/saveRoots.js');
const userDir = require('../app/parser/userDir.js');

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('default Steam emulator roots include concrete save folders copied from the reference app', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-save-roots-'));
  const appdata = path.join(tmp, 'AppData');
  const localappdata = path.join(tmp, 'LocalAppData');
  const publicDir = path.join(tmp, 'Public');
  const programData = path.join(tmp, 'ProgramData');
  const uplayRoot = path.join(appdata, 'Goldberg UplayEmu Saves');
  const lsxRoot = path.join(localappdata, 'anadius', 'LSX emu', 'achievement_watcher');
  fs.mkdirSync(uplayRoot, { recursive: true });
  fs.mkdirSync(lsxRoot, { recursive: true });

  await withEnv(
    {
      APPDATA: appdata,
      LOCALAPPDATA: localappdata,
      PUBLIC: publicDir,
      PROGRAMDATA: programData,
    },
    async () => {
      const roots = saveRoots.defaultSteamEmuSaveRoots({ existingOnly: true });
      assert.ok(roots.includes(uplayRoot));
      assert.ok(roots.includes(lsxRoot));
    }
  );
});

test('userDir.check accepts real appid save roots and rejects SteamID64-only roots', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-userdir-check-'));
  const valid = path.join(tmp, 'valid');
  const invalid = path.join(tmp, 'invalid');
  fs.mkdirSync(path.join(valid, '123456'), { recursive: true });
  fs.mkdirSync(path.join(invalid, '76561198000000000'), { recursive: true });

  assert.equal(await userDir.check(valid), true);
  assert.equal(await userDir.check(invalid), false);
});
