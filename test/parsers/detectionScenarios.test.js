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
const libraryDirs = require('../../app/parser/libraryDirs.js');

function writeBytes(file, size = 1024) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

async function detectIn({ build, persistSmartFind = false } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scen-user-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scen-root-'));
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-scen-env-'));
  const oldEnv = {};
  for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PUBLIC', 'PROGRAMDATA']) {
    oldEnv[key] = process.env[key];
  }
  process.env.USERPROFILE = envRoot;
  process.env.APPDATA = path.join(envRoot, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = path.join(envRoot, 'AppData', 'Local');
  process.env.PUBLIC = path.join(envRoot, 'Public');
  process.env.PROGRAMDATA = path.join(envRoot, 'ProgramData');
  fs.mkdirSync(process.env.APPDATA, { recursive: true });
  fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true });
  fs.mkdirSync(path.join(process.env.PUBLIC, 'Desktop'), { recursive: true });
  fs.mkdirSync(process.env.PROGRAMDATA, { recursive: true });

  achievements.initDebug({ isDev: false, userDataPath: userData });
  await libraryDirs.save([root]);
  try {
    if (build) build({ root, envRoot });
    // Smart Find is a review/persistence step now: discovery never injects invisible roots directly
    // into the achievement scan.
    if (persistSmartFind) {
      const detected = (await libraryDirs.findEntries()).filter((entry) => path.resolve(entry.path).startsWith(path.resolve(envRoot) + path.sep));
      await libraryDirs.save([{ path: root, origin: 'manual', enabled: true }, ...detected]);
    }
    return await achievements.detectInstalledAppids({
      achievement_source: { steamEmu: true },
      steam: { main: null },
    });
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(envRoot, { recursive: true, force: true });
  }
}

function install(root, name, files = [], dirs = []) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), 'x');
  for (const sub of dirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });
}

test('official launcher games and non-game apps in a library root are never surfaced', async () => {
  const found = await detectIn({
    build: ({ root }) => {
      install(root, 'Epic Game', ['EpicGame.exe'], ['.egstore']);
      install(root, 'GOG Game', ['goggame-1423049311.info', 'GogGame.exe']);
      install(root, 'Ubi Game', ['uplay_install.state', 'UbiGame.exe']);
      install(root, 'MS Game', ['AppxManifest.xml', 'MsGame.exe']);
      install(root, 'Firefox', ['firefox.exe']);
      install(root, 'Docker', ['Docker Desktop.exe']);
      install(root, 'Office', ['winword.exe']);
      install(root, 'Cheat Engine', ['Cheat Engine.exe']);
    },
  });
  assert.deepEqual(found, []);
});

test('legit Steam-style steamapps/common subtrees are skipped', async () => {
  const found = await detectIn({
    build: ({ root }) => install(root, 'steamapps/common/Portal 2', ['portal2.exe']),
  });
  assert.deepEqual(found, []);
});

test('a Goldberg game with steam markers is promoted to its appid', async () => {
  const found = await detectIn({
    build: ({ root }) => {
      const dir = path.join(root, 'Real Game');
      fs.mkdirSync(path.join(dir, 'steam_settings'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'steam_settings', 'steam_appid.txt'), '12345');
      writeBytes(path.join(dir, 'steam_api64.dll'));
      writeBytes(path.join(dir, 'RealGame.exe'));
    },
  });
  assert.ok(found.includes('12345'));
  assert.ok(!found.some((id) => id.startsWith('local-')));
});

test('a renamed bare exe folder yields one local entry named from PE metadata', (t) => {
  const notepad = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe');
  if (!fs.existsSync(notepad)) {
    t.skip('no system PE available for the metadata-naming scenario');
    return;
  }
  return detectIn({
    build: ({ root }) => {
      const dir = path.join(root, 'Game123');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(notepad, path.join(dir, 'Game123.exe'));
    },
  }).then((found) => {
    assert.equal(found.filter((id) => id.startsWith('local-')).length, 1);
  });
});

test('Desktop\\Jeux\\<game> nested installs are found, loose Desktop folders are not', async () => {
  const found = await detectIn({
    build: ({ envRoot }) => {
      writeBytes(path.join(envRoot, 'Desktop', 'Jeux', 'Nested Game', 'NestedGame.exe'));
      writeBytes(path.join(envRoot, 'Desktop', 'Random Folder', 'random.exe'));
    },
    persistSmartFind: true,
  });
  assert.equal(found.filter((id) => id.startsWith('local-')).length, 1);
});

test('portable games under an AppData\\Games profile root are found', async () => {
  const found = await detectIn({
    build: ({ envRoot }) => {
      writeBytes(path.join(envRoot, 'AppData', 'Local', 'Games', 'Portable Game', 'PortableGame.exe'));
    },
    persistSmartFind: true,
  });
  assert.equal(found.filter((id) => id.startsWith('local-')).length, 1);
});

test('a leftover emulator save folder still maps to its appid (folder-based detection by design)', async () => {
  const found = await detectIn({
    build: ({ envRoot }) => {
      writeBytes(path.join(envRoot, 'AppData', 'Roaming', 'Goldberg SteamEmu Saves', '99999', 'achievements.ini'), 64);
    },
  });
  assert.ok(found.includes('99999'));
});

test('a cracked Uplay R2 install (markers + loader) is promoted, not skipped as official', async () => {
  const found = await detectIn({
    build: ({ root }) => {
      const dir = path.join(root, 'Completely Unrelated Repack Folder');
      fs.mkdirSync(dir, { recursive: true });
      writeBytes(path.join(dir, 'ACBlackFlag.exe'));
      fs.writeFileSync(path.join(dir, 'uplay_install.manifest'), '{}');
      fs.writeFileSync(path.join(dir, 'uplay_install.state'), "Assassin's Creed Black Flag Resynced");
      writeBytes(path.join(dir, 'upc_r2_loader64.dll'));
    },
  });
  assert.ok(found.includes('3751950'));
  assert.ok(!found.some((id) => id.startsWith('local-')));
});
