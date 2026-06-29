'use strict';

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

const achievements = require('../app/parser/achievements.js');
const libraryDirs = require('../app/parser/libraryDirs.js');
const steam = require('../app/parser/steam.js');

function writeBytes(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

test('Goldberg install with steam_settings but no appid resolves by game name, bare exe folders do not', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-fallback-user-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-fallback-root-'));
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-fallback-env-'));
  const gameDir = path.join(root, 'Real Game');
  const dolphinDir = path.join(root, 'Dolphin');
  const dolphinGbeDir = path.join(root, 'Dolphin-x64');
  const oldEnv = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PUBLIC: process.env.PUBLIC,
    PROGRAMDATA: process.env.PROGRAMDATA,
  };
  process.env.APPDATA = path.join(envRoot, 'AppData');
  process.env.LOCALAPPDATA = path.join(envRoot, 'LocalAppData');
  process.env.PUBLIC = path.join(envRoot, 'Public');
  process.env.PROGRAMDATA = path.join(envRoot, 'ProgramData');

  writeBytes(path.join(gameDir, 'RealGame.exe'), 1024);
  fs.mkdirSync(path.join(gameDir, 'steam_settings'), { recursive: true });
  writeBytes(path.join(dolphinDir, 'Dolphin.exe'), 1024);
  writeBytes(path.join(dolphinGbeDir, 'Dolphin.exe'), 1024);
  writeBytes(path.join(dolphinGbeDir, 'DolphinTool.exe'), 1024);
  fs.mkdirSync(path.join(dolphinGbeDir, 'Sys'), { recursive: true });
  fs.mkdirSync(path.join(dolphinGbeDir, 'steam_settings'), { recursive: true });
  writeBytes(path.join(dolphinGbeDir, 'steam_api64.dll'), 1024);
  fs.writeFileSync(path.join(dolphinGbeDir, 'steam_settings', 'steam_appid.txt'), '534680');
  fs.writeFileSync(path.join(dolphinGbeDir, 'steam_settings', 'achievements.json'), JSON.stringify([{ name: 'bad', displayName: 'Bad' }]));

  achievements.initDebug({ isDev: false, userDataPath: userData });
  await libraryDirs.save([root]);

  const originalFindAppidByName = steam.findAppidByName;
  steam.findAppidByName = async (name) => {
    const n = String(name).toLowerCase();
    if (n === 'real game') return '999999';
    if (n === 'dolphin') return '222480';
    return null;
  };
  t.after(() => {
    steam.findAppidByName = originalFindAppidByName;
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

  assert.ok(found.some((appid) => String(appid) === '999999'), 'the install should be promoted to the resolved Steam appid');
  assert.ok(!found.some((appid) => String(appid) === '222480'), 'a bare emulator/tool folder must not be promoted to a Steam game by name only');
  assert.ok(!found.some((appid) => String(appid) === '534680'), 'a Dolphin emulator folder with stale GBE files must still be ignored');
  assert.ok(!found.some((appid) => String(appid).startsWith('local-')), 'Dolphin tool folders are skipped instead of surfaced as local games');
});
