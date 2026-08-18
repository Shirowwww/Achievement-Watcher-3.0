'use strict';

// End-to-end regression test for the "Big Walk" duplicate-tile bug: a Unity-shaped install (Goldberg
// config nested under "<Game>_Data/Plugins/x86_64/") must resolve to exactly ONE discovered game, with
// its exe attached - not a numeric-appid entry with no exe plus a separate "local-*" clone that found
// the exe independently because the real install folder was never marked as claimed.

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcRenderer: {
        sendSync: () => false,
        invoke: async () => null,
      },
    };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../../app/parser/achievements.js');
const libraryDirs = require('../../app/parser/libraryDirs.js');
const steam = require('../../app/parser/steam.js');

function writeBytes(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

test('a Unity-style nested Goldberg install (steam_appid.txt under _Data/Plugins/x86_64) resolves to one game, not a numeric entry plus a local-* clone', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nested-dedup-user-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nested-dedup-root-'));
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nested-dedup-env-'));
  const gameDir = path.join(root, 'Big Walk');
  const engineDir = path.join(gameDir, 'Big Walk_Data', 'Plugins', 'x86_64');
  const steamSettings = path.join(engineDir, 'steam_settings');

  const oldEnv = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PUBLIC: process.env.PUBLIC,
    PROGRAMDATA: process.env.PROGRAMDATA,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.APPDATA = path.join(envRoot, 'AppData');
  process.env.LOCALAPPDATA = path.join(envRoot, 'LocalAppData');
  process.env.PUBLIC = path.join(envRoot, 'Public');
  process.env.PROGRAMDATA = path.join(envRoot, 'ProgramData');
  process.env.USERPROFILE = envRoot;

  writeBytes(path.join(gameDir, 'Big Walk.exe'), 1024);
  fs.mkdirSync(steamSettings, { recursive: true });
  writeBytes(path.join(engineDir, 'steam_api64.dll'), 1024);
  fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '1478500');
  fs.writeFileSync(path.join(steamSettings, 'achievements.json'), JSON.stringify([{ name: 'ACH_1', displayName: 'First' }]));

  achievements.initDebug({ isDev: false, userDataPath: userData });
  await libraryDirs.save([root]);
  // Isolate the scan to the sandbox: the automatic smart-find (libraryDirs.find) would merge the
  // developer machine's real game libraries into this discovery run.
  const originalFind = libraryDirs.find;
  libraryDirs.find = async () => [];

  // Defensive: nothing in this scenario should need name-based resolution (the appid resolves directly
  // from the nested steam_appid.txt), but stub it out anyway so a regression can never reach the network.
  const originalFindAppidByName = steam.findAppidByName;
  steam.findAppidByName = async () => null;

  t.after(() => {
    steam.findAppidByName = originalFindAppidByName;
    libraryDirs.find = originalFind;
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(envRoot, { recursive: true, force: true });
  });

  const found = await achievements.detectInstalledAppids({
    achievement_source: { steamEmu: true },
    steam: { main: null },
  });

  const matches = found.filter((appid) => String(appid) === '1478500');
  assert.strictEqual(matches.length, 1, `expected exactly one 1478500 entry, got: ${found.join(', ')}`);

  const locals = found.filter((appid) => String(appid).startsWith('local-'));
  assert.strictEqual(locals.length, 0, `the nested install must not also surface as an unrelated local-* clone (got: ${locals.join(', ')})`);
});
