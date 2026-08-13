'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const saveRoots = require('../../app/parser/saveRoots.js');
const userDir = require('../../app/parser/userDir.js');

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
  const socialClubRoot = path.join(appdata, 'Goldberg SocialClub Emu Saves');
  const lsxRoot = path.join(localappdata, 'anadius', 'LSX emu', 'achievement_watcher');
  fs.mkdirSync(uplayRoot, { recursive: true });
  fs.mkdirSync(socialClubRoot, { recursive: true });
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
      assert.ok(roots.includes(socialClubRoot));
      assert.ok(roots.includes(lsxRoot));
    }
  );
});

test('userDir.check accepts Goldberg SocialClub roots, game folders and profile folders', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-socialclub-check-'));
  const root = path.join(tmp, 'Goldberg SocialClub Emu Saves');
  const gameDir = path.join(root, 'GTA V');
  const profileDir = path.join(gameDir, '0F74F4C4');
  fs.mkdirSync(path.join(profileDir, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'local_save.txt'), '', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'settings', 'cfg.dat'), 'binary', 'utf8');

  assert.equal(await userDir.check(root), true);
  assert.equal(await userDir.check(gameDir), true);
  assert.equal(await userDir.check(profileDir), true);
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

test('Public Documents Steam parent expands to concrete RUNE/CODEX save roots', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rune-parent-'));
  const steamParent = path.join(tmp, 'Public', 'Documents', 'Steam');
  const runeRoot = path.join(steamParent, 'RUNE');
  fs.mkdirSync(path.join(runeRoot, '2531310'), { recursive: true });

  const roots = saveRoots.defaultSteamScanRoots([steamParent]);
  assert.ok(roots.includes(steamParent));
  assert.ok(roots.includes(runeRoot));
  assert.equal(await userDir.check(steamParent), true);
});

test('isSteamLikePath flags Steam library/install paths but keeps neutral game folders', () => {
  assert.equal(saveRoots.isSteamLikePath('D:\\SteamLibrary'), true);
  assert.equal(saveRoots.isSteamLikePath('D:\\Steam'), true);
  assert.equal(saveRoots.isSteamLikePath('C:\\Program Files (x86)\\Steam'), true);
  assert.equal(saveRoots.isSteamLikePath('D:\\Steam\\steamapps\\common\\Portal 2'), true);
  assert.equal(saveRoots.isSteamLikePath('C:\\Games'), false);
  assert.equal(saveRoots.isSteamLikePath('C:\\Games\\SteamWorld Dig 2'), false);
  assert.equal(saveRoots.isSteamLikePath(''), false);
});

test('library folder probes cover common neutral names and repack folders on every drive', () => {
  for (const name of [
    'Games',
    'Games Library',
    'GameLibrary',
    'Repacks',
    'Repack',
    // Localised "games library" names across the bundled locales and beyond.
    'Jeux',
    'Bibliothèque de jeux',
    'Spiele',
    'Spielbibliothek',
    'Juegos',
    'Biblioteca de juegos',
    'Giochi',
    'Jogos',
    'Spellen',
    'Spel',
    'Spil',
    'Spill',
    'Pelit',
    'Gry',
    'Hry',
    'Játékok',
    'Jocuri',
    'Игры',
    'Ігри',
    'Игри',
    'Παιχνίδια',
    'Oyunlar',
    'ألعاب',
    'משחקים',
    'ゲーム',
    '게임',
    '游戏',
    '游戏库',
    'เกม',
    'Trò chơi',
    'Permainan',
    'गेम',
    'GOG Games',
    'Epic Games',
  ]) {
    assert.ok(saveRoots.GAME_LIBRARY_FOLDER_NAMES.includes(name), `GAME_LIBRARY_FOLDER_NAMES must probe "${name}"`);
  }
});

test('launcher-managed storefront roots are never probed as library folders', () => {
  // These are the default install dirs of legit launchers: they hold real launcher games that the
  // official sources already cover, and scanning them would surface duplicates as "Unconfigured".
  // (The drive-root "Epic Games"/"GOG Games" probes are pre-existing custom-location checks and
  // are covered by the previous test; the launcher dirs under Program Files must never appear.)
  for (const name of ['Ubisoft Game Launcher', 'GOG Galaxy', 'Origin Games', 'EA Games']) {
    assert.ok(!saveRoots.GAME_LIBRARY_FOLDER_NAMES.includes(name), `"${name}" must never be auto-probed`);
  }
});

test('library-like folder names gate the Desktop subfolder scan', () => {
  for (const name of [
    'Jeux',
    'Games',
    'Juegos',
    'Spiele',
    'Giochi',
    'Games Library',
    'GameLibrary',
    'GOG Games',
    'Epic Games',
    'Repacks',
    'Repack',
    'Bibliothèque',
    'Bibliotheque',
    'My Games',
    'Biblioteca de juegos',
    'Spielbibliothek',
    'Игры',
    'Библиотека игр',
    'Jogos',
    'Játékok',
    'Jocuri',
    'Hry',
    'Gry',
    'Oyunlar',
    '游戏',
    '游戏库',
    'ゲーム',
    '게임',
    'เกมส์',
    'Trò chơi',
    'Permainan',
    'משחקים',
  ]) {
    assert.equal(saveRoots.isLibraryLikeFolderName(name), true, `"${name}" must count as a library folder`);
  }
  for (const name of ['Desktop', 'Documents', 'Steam', 'Ubisoft Game Launcher', 'GOG Galaxy', 'Epic Games Launcher', 'Game', 'Gamez', '']) {
    assert.equal(saveRoots.isLibraryLikeFolderName(name), false, `"${name}" must not count as a library folder`);
  }
});

test('per-user game libraries under the profile and AppData are probed (never the raw roots)', () => {
  const previous = {
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };
  process.env.USERPROFILE = 'C:\\Users\\TestUser';
  process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
  process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';
  try {
    const roots = saveRoots.profileLibraryRoots();
    for (const expected of [
      'C:\\Users\\TestUser\\Games',
      'C:\\Users\\TestUser\\Jeux',
      'C:\\Users\\TestUser\\AppData\\Roaming\\Games',
      'C:\\Users\\TestUser\\AppData\\Local\\Games',
      'C:\\Users\\TestUser\\AppData\\Local\\Repacks',
      'C:\\Users\\TestUser\\Игры',
      'C:\\Users\\TestUser\\AppData\\Local\\Jogos',
    ]) {
      assert.ok(roots.includes(expected), `profile roots must include "${expected}"`);
    }
    assert.ok(!roots.some((r) => r === 'C:\\Users\\TestUser\\AppData\\Roaming'), 'the raw AppData root must never be probed');
    assert.ok(!roots.some((r) => r === 'C:\\Users\\TestUser\\AppData\\Local'), 'the raw LocalAppData root must never be probed');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
