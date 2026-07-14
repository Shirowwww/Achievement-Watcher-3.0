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
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../app/parser/achievements.js');
const libraryDirs = require('../app/parser/libraryDirs.js');

test('Ubisoft install without Steam markers is promoted through the Uplay R2 mapping', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-uplayr2-discovery-user-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-uplayr2-discovery-root-'));
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-uplayr2-discovery-env-'));
  const gameDir = path.join(root, 'Completely Unrelated Repack Folder');
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

  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'ACBlackFlag.exe'), Buffer.alloc(1024, 1));
  fs.writeFileSync(path.join(gameDir, 'uplay_install.manifest'), '{}');
  fs.writeFileSync(
    path.join(gameDir, 'uplay_install.state'),
    Buffer.concat([Buffer.from([0x0a, 0x24]), Buffer.from("Assassin's Creed Black Flag Resynced"), Buffer.from([0x10, 0x01])])
  );
  fs.writeFileSync(path.join(gameDir, 'upc_r2_loader64.dll'), Buffer.alloc(1024, 2));

  achievements.initDebug({ isDev: false, userDataPath: userData });
  await libraryDirs.save([root]);

  t.after(() => {
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

  assert.ok(found.includes('3751950'), 'the renamed Ubisoft install should use its internal title and mapped Steam AppID');
  assert.ok(!found.some((appid) => appid.startsWith('local-')), 'the mapped install must not remain a local fallback entry');
});
