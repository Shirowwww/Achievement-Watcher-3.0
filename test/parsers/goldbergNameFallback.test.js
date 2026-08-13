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

const achievements = require('../../app/parser/achievements.js');
const libraryDirs = require('../../app/parser/libraryDirs.js');
const steam = require('../../app/parser/steam.js');

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
  const legitEpicDir = path.join(root, 'Legit Epic Game');
  const legitGogDir = path.join(root, 'Legit GOG Game');
  const legitUbiDir = path.join(root, 'Legit Ubisoft Game');
  const nestedGameDir = path.join(envRoot, 'Desktop', 'Jeux', 'Nested Game');
  const nestedGamesDir = path.join(root, 'Games', 'Nested Under Games');
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

  writeBytes(path.join(gameDir, 'RealGame.exe'), 1024);
  fs.mkdirSync(path.join(gameDir, 'steam_settings'), { recursive: true });
  writeBytes(path.join(legitEpicDir, 'LegitEpic.exe'), 1024);
  fs.mkdirSync(path.join(legitEpicDir, '.egstore'), { recursive: true });
  writeBytes(path.join(legitGogDir, 'LegitGog.exe'), 1024);
  fs.writeFileSync(path.join(legitGogDir, 'goggame-1423049311.info'), 'name = "Legit GOG Game"');
  writeBytes(path.join(legitUbiDir, 'LegitUbi.exe'), 1024);
  fs.writeFileSync(path.join(legitUbiDir, 'uplay_install.state'), Buffer.from('Legit Ubisoft Game', 'utf8'));
  fs.mkdirSync(nestedGameDir, { recursive: true });
  writeBytes(path.join(nestedGameDir, 'NestedGame.exe'), 1024);
  fs.mkdirSync(nestedGamesDir, { recursive: true });
  writeBytes(path.join(nestedGamesDir, 'NestedUnderGames.exe'), 1024);
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
  // Isolate the scan to the sandbox: the automatic smart-find (libraryDirs.find) would merge the
  // developer machine's real game libraries into this discovery run.
  const originalFind = libraryDirs.find;
  libraryDirs.find = async () => [];

  const originalFindAppidByName = steam.findAppidByName;
  steam.findAppidByName = async (name) => {
    const n = String(name).toLowerCase();
    if (n === 'real game') return '999999';
    if (n === 'dolphin') return '222480';
    return null;
  };
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

  assert.ok(found.some((appid) => String(appid) === '999999'), 'the install should be promoted to the resolved Steam appid');
  assert.ok(!found.some((appid) => String(appid) === '222480'), 'a bare emulator/tool folder must not be promoted to a Steam game by name only');
  assert.ok(!found.some((appid) => String(appid) === '534680'), 'a Dolphin emulator folder with stale GBE files must still be ignored');
  const locals = found.filter((appid) => String(appid).startsWith('local-'));
  assert.equal(
    locals.length,
    2,
    `only the nested games may be local entries — official Epic/GOG/Ubisoft games and Dolphin tools must be skipped (got: ${locals.join(', ')})`
  );
});
