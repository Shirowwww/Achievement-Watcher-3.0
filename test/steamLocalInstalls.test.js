'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const steamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-local-'));
const extraLibrary = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-lib-'));
fs.writeFileSync(path.join(steamRoot, 'steam.exe'), '');

let fakeSteamPath = steamRoot;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../util/reg') {
    return {
      readRegistryString: () => fakeSteamPath,
      readRegistryStringAndExpand: () => '',
      regKeyExists: () => true,
      readRegistryInteger: () => 0,
      listRegistryAllSubkeys: () => [],
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const steam = require('../app/parser/steam.js');

test.after(() => {
  fs.rmSync(steamRoot, { recursive: true, force: true });
  fs.rmSync(extraLibrary, { recursive: true, force: true });
});

test('scanLocalInstalls maps appmanifests to install folders in every Steam library root', async () => {
  const mainApps = path.join(steamRoot, 'steamapps');
  const libApps = path.join(extraLibrary, 'steamapps');
  fs.mkdirSync(path.join(mainApps, 'common', 'GameTen'), { recursive: true });
  fs.mkdirSync(path.join(libApps, 'common', 'Game Twenty'), { recursive: true });
  fs.writeFileSync(path.join(mainApps, 'appmanifest_10.acf'), `
    "AppState"
    {
      "appid" "10"
      "name" "Game Ten"
      "installdir" "GameTen"
    }
  `);
  fs.writeFileSync(path.join(libApps, 'appmanifest_20.acf'), `
    "AppState"
    {
      "appid" "20"
      "name" "Game Twenty"
      "installdir" "Game Twenty"
    }
  `);
  fs.writeFileSync(path.join(mainApps, 'libraryfolders.vdf'), `
    "libraryfolders"
    {
      "0"
      {
        "path" "${extraLibrary.replace(/\\/g, '\\\\')}"
      }
    }
  `);

  const installs = await steam.scanLocalInstalls();
  assert.strictEqual(installs.size, 2);
  assert.strictEqual(installs.get('10').name, 'Game Ten');
  assert.strictEqual(installs.get('10').gameDir, path.join(mainApps, 'common', 'GameTen'));
  assert.strictEqual(installs.get('20').name, 'Game Twenty');
  assert.strictEqual(installs.get('20').gameDir, path.join(libApps, 'common', 'Game Twenty'));
});
