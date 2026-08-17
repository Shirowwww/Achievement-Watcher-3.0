'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { ipcRenderer: { sendSync: () => false, invoke: async () => null } };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../../app/parser/achievements.js');
const steam = require('../../app/parser/steam.js');

const { dropSteamOwnedRecords } = achievements._internal;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-owned-user-'));
fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
achievements.initDebug({ isDev: false, userDataPath: userData });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-owned-'));
const makeDir = (...parts) => {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Steam's manifest names this folder; the dll in it is Valve's.
const gmod = makeDir('Steam', 'steamapps', 'common', 'GarrysMod');
fs.writeFileSync(path.join(gmod, 'steam_appid.txt'), '4000');
fs.writeFileSync(path.join(gmod, 'steam_api64.dll'), Buffer.from('MZ...SteamAPI_Init...'));
fs.writeFileSync(
  path.join(root, 'Steam', 'steamapps', 'appmanifest_4000.acf'),
  '"AppState"\n{\n\t"appid"\t\t"4000"\n\t"installdir"\t\t"GarrysMod"\n}\n'
);

// Same appid, cracked in place: the manifest still claims it, but the dll was replaced.
const inPlace = makeDir('Steam', 'steamapps', 'common', 'Cracked');
fs.writeFileSync(path.join(inPlace, 'steam_api64.dll'), Buffer.from('MZ...steam_settings/achievements.json...'));

const elsewhere = makeDir('Jeux', 'Some Repack');

const installs = new Map([
  ['4000', { name: "Garry's Mod", gameDir: gmod }],
  ['500', { name: 'Cracked In Place', gameDir: inPlace }],
  ['600', { name: 'Uninstalled', gameDir: path.join(root, 'Steam', 'steamapps', 'common', 'Gone') }],
  ['700', { name: 'Owned And Repacked', gameDir: gmod }],
]);

const originalScan = steam.scanLocalInstalls;
const stubInstalls = (value) => {
  steam.scanLocalInstalls = async () => {
    if (value instanceof Error) throw value;
    return value;
  };
};

test.after(() => {
  steam.scanLocalInstalls = originalScan;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

/*
  Skipping the install folder is not enough: an emulator save folder is a source of its own, so one
  left behind for a Steam game keeps listing it with no install folder attached — the "steam_api not
  found" Garry's Mod entry.
*/
test('a leftover emulator save cannot resurrect a game Steam installed', async () => {
  stubInstalls(installs);
  const records = [
    { appid: '4000', source: 'Goldberg', data: { type: 'file', path: 'C:/Users/x/AppData/Roaming/GSE Saves/4000' } },
    { appid: '500', source: 'GBE Fork', data: { type: 'file', gameDir: inPlace } },
    { appid: '600', source: 'Goldberg', data: { type: 'file', path: 'C:/Users/x/AppData/Roaming/GSE Saves/600' } },
    { appid: '700', source: 'GBE Fork', data: { type: 'file', gameDir: elsewhere } },
    { appid: '999', source: 'Goldberg', data: { type: 'file', path: 'C:/Users/x/AppData/Roaming/GSE Saves/999' } },
  ];

  const kept = await dropSteamOwnedRecords(records, false);
  assert.deepEqual(
    kept.map((r) => r.appid),
    ['500', '600', '700', '999'],
    'only the phantom save folder of an installed Steam game is dropped'
  );

  // With official Steam games shown, nothing is filtered — the game is meant to be in the library.
  assert.equal((await dropSteamOwnedRecords(records, true)).length, records.length);
});

test('an unreadable Steam install list never empties the library', async () => {
  const records = [{ appid: '4000', source: 'Goldberg', data: { type: 'file' } }];
  stubInstalls(new Error('registry unavailable'));
  assert.equal((await dropSteamOwnedRecords(records, false)).length, 1);
  stubInstalls(new Map());
  assert.equal((await dropSteamOwnedRecords(records, false)).length, 1);
});
