'use strict';

/*
  Two ways a game keeps its unlock state somewhere other than the well-known %APPDATA% / %PUBLIC%
  roots, both of which used to read as a permanent 0% (or as no library entry at all):

    - a GBE/Goldberg setup whose configs.user.ini redirects local_save_path into the game folder,
      which is how a repack makes itself portable;
    - a CODEX/RUNE portable release, which keeps the Steam\<SOURCE>\<appid> tree it would otherwise
      write under %PUBLIC%\Documents inside the game folder (issue #32).
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const goldberg = require('../../app/parser/goldberg.js');
const userDir = require('../../app/parser/userDir.js');

function tempGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));
}

function writeUserIni(steamSettings, savePath) {
  fs.mkdirSync(steamSettings, { recursive: true });
  fs.writeFileSync(
    path.join(steamSettings, 'configs.user.ini'),
    `[user::general]\naccount_name=Player\nlanguage=english\n\n[user::saves]\nlocal_save_path=${savePath}\n`
  );
}

test('a relative local_save_path resolves against the dll folder, with or without the appid level', () => {
  const gameDir = tempGame('localsave');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    writeUserIni(steamSettings, '.\\saves');

    // Nothing written yet: the folder does not exist, so there is nothing to point at.
    assert.equal(goldberg.resolveLocalSaveDir({ steamSettings, appid: '480' }), null);

    // Goldberg's own shape: <save root>/<appid>/achievements.json.
    const withAppid = path.join(gameDir, 'saves', '480');
    fs.mkdirSync(withAppid, { recursive: true });
    fs.writeFileSync(path.join(withAppid, 'achievements.json'), JSON.stringify({ A: { earned: true, earned_time: 1 } }));
    assert.equal(goldberg.resolveLocalSaveDir({ steamSettings, appid: '480' }), withAppid);

    const state = goldberg.inspectSaveState('480', [], withAppid);
    assert.equal(state.exists, true);
    assert.equal(state.type, 'local');
    assert.equal(state.earned, 1);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('a build that writes straight into the configured folder is found too', () => {
  const gameDir = tempGame('localsave-flat');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    writeUserIni(steamSettings, 'GameSaves');
    const flat = path.join(gameDir, 'GameSaves');
    fs.mkdirSync(flat, { recursive: true });
    fs.writeFileSync(path.join(flat, 'achievements.json'), JSON.stringify({ A: { earned: false } }));
    assert.equal(goldberg.resolveLocalSaveDir({ steamSettings, appid: '480' }), flat);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('the GBE template placeholder is not a folder and is never followed', () => {
  const gameDir = tempGame('localsave-placeholder');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    writeUserIni(steamSettings, 'path/relative/to/dll');
    assert.equal(goldberg.readConfiguredSavePath(steamSettings), '');
    assert.equal(goldberg.resolveLocalSaveDir({ steamSettings, appid: '480' }), null);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('classic Goldberg local_save.txt beside the dll is honoured as well', () => {
  const gameDir = tempGame('localsave-txt');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    fs.mkdirSync(steamSettings, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'local_save.txt'), 'mysaves\r\n');
    assert.equal(goldberg.readConfiguredSavePath(steamSettings), 'mysaves');
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

/*
  A redirected save folder is only a problem when AW cannot find it. It used to be reported as a
  warning unconditionally, which is a yellow row on a perfectly working portable repack that no
  repair could ever clear.
*/
test('diagnose reads the redirected folder and stops calling a working setup broken', () => {
  const gameDir = tempGame('diagnose-localsave');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    writeUserIni(steamSettings, '.\\saves');
    fs.writeFileSync(path.join(gameDir, 'steam_api64.dll'), 'emu');
    fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '480');
    fs.writeFileSync(
      path.join(steamSettings, 'achievements.json'),
      JSON.stringify([{ name: 'A', displayName: 'A', description: 'first', hidden: '0' }])
    );
    const saveDir = path.join(gameDir, 'saves', '480');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'achievements.json'), JSON.stringify({ A: { earned: true, earned_time: 5 } }));

    const report = goldberg.diagnose({
      gameDir,
      appid: '480',
      schema: { achievement: { list: [{ name: 'A' }] } },
      savesRoots: [],
    });

    assert.equal(report.localSaveDir, saveDir);
    assert.equal(report.save.exists, true);
    assert.equal(report.save.earned, 1);
    const savePathIssue = report.issues.find((i) => i.code === 'CUSTOM_SAVE_PATH');
    assert.ok(savePathIssue, 'the redirect is still reported');
    assert.equal(savePathIssue.level, 'info', 'but not as a fault AW cannot fix');
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('a redirect AW cannot resolve stays a warning', () => {
  const gameDir = tempGame('diagnose-localsave-missing');
  try {
    const steamSettings = path.join(gameDir, 'steam_settings');
    writeUserIni(steamSettings, 'D:\\nowhere\\at\\all');
    fs.writeFileSync(path.join(gameDir, 'steam_api64.dll'), 'emu');
    fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '480');
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), JSON.stringify([{ name: 'A', description: 'first' }]));

    const report = goldberg.diagnose({ gameDir, appid: '480', schema: { achievement: { list: [{ name: 'A' }] } }, savesRoots: [] });
    assert.equal(report.localSaveDir, null);
    assert.equal(report.issues.find((i) => i.code === 'CUSTOM_SAVE_PATH').level, 'warning');
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

// --- issue #32: portable CODEX/RUNE ---------------------------------------------------------------

test('a portable RUNE release is accepted as an achievement folder and read from its own tree', async () => {
  const gameDir = tempGame('rune-portable');
  try {
    fs.writeFileSync(path.join(gameDir, 'steam_emu.ini'), '[Settings]\r\nAppId=1774580\r\nLanguage=english\r\n');
    const saveDir = path.join(gameDir, 'Steam', 'RUNE', '1774580');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'achievements.ini'), '[SteamAchievements]\r\nACH_ONE=1\r\n');

    assert.equal(await userDir.check(gameDir), true, 'the game folder must not be rejected');

    const found = await userDir.scan(gameDir);
    assert.equal(found.length, 1);
    assert.equal(found[0].appid, '1774580');
    assert.equal(found[0].source, 'Rune');
    assert.equal(found[0].data.type, 'file');
    assert.equal(found[0].data.path, saveDir);
    assert.equal(found[0].data.gameDir, gameDir);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

/*
  The expected behaviour the report asks for: with achievement data present but nowhere AW can read
  it, the game still gets a library entry. A missing card is indistinguishable from a game that was
  never installed; a 0% card says "found, nothing read yet" - and steam.getAchievementsFromFile()
  already treats a missing file as exactly that.
*/
test('a scene release with no save written yet still produces a discovery record', async () => {
  const gameDir = tempGame('rune-nosave');
  try {
    // An appid no machine running this test can own a real save for, so the fallback is what is
    // being measured rather than whatever happens to sit in %PUBLIC%\Documents\Steam here.
    fs.writeFileSync(path.join(gameDir, 'steam_emu.ini'), '[SETTINGS]\r\nappid = 999999901\r\n');
    const found = await userDir.scan(gameDir);
    assert.equal(found.length, 1);
    assert.equal(found[0].appid, '999999901');
    assert.equal(found[0].data.type, 'file');
    assert.equal(found[0].data.path, path.join(gameDir, 'Steam', 'RUNE', '999999901'));
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('a folder named like a save folder but holding nothing readable is not chosen', () => {
  const gameDir = tempGame('rune-decoy');
  try {
    fs.mkdirSync(path.join(gameDir, 'Steam', 'RUNE', '480'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'Steam', 'RUNE', '480', 'readme.txt'), 'not a save');
    assert.equal(userDir.findSceneSaveDir(gameDir, '480'), null);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('a cpy.ini release resolves the same way', async () => {
  const gameDir = tempGame('cpy-portable');
  try {
    fs.writeFileSync(path.join(gameDir, 'cpy.ini'), '[Settings]\r\nAppID=292030\r\n');
    const saveDir = path.join(gameDir, 'Steam', 'CODEX', '292030');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'achievements.ini'), '[Steam]\r\nACH=1\r\n');
    const found = await userDir.scan(gameDir);
    assert.equal(found.length, 1);
    assert.equal(found[0].appid, '292030');
    assert.equal(found[0].source, 'Codex');
    assert.equal(found[0].data.path, saveDir);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

/*
  The reported workflow, and the half of issue #32 the folder-level fix alone did not cover: the
  user adds their games LIBRARY, not one game folder. check() accepted such a root on the strength
  of the emulator configs below it, while scan() returned on the spot because the root itself had
  none - so the folder was listed in Settings and still produced no card at all.
*/
test('adding the library folder finds the portable releases inside it', async () => {
  const lib = tempGame('rune-library');
  try {
    const game = path.join(lib, 'STAR WARS Jedi Survivor');
    fs.mkdirSync(game, { recursive: true });
    fs.writeFileSync(path.join(game, 'steam_emu.ini'), '[Settings]\r\nAppId=1774580\r\n');
    const saveDir = path.join(game, 'Steam', 'RUNE', '1774580');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'achievements.ini'), '[SteamAchievements]\r\nACH_ONE=1\r\n');

    const other = path.join(lib, 'Another Game');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'cpy.ini'), '[Settings]\r\nAppID=292030\r\n');

    assert.equal(await userDir.check(lib), true);

    const found = await userDir.scan(lib);
    assert.deepEqual(found.map((f) => f.appid).sort(), ['1774580', '292030']);

    const jedi = found.find((f) => f.appid === '1774580');
    assert.equal(jedi.source, 'Rune');
    assert.equal(jedi.data.path, saveDir);
    // The record is handed on as a game folder, so it must be a native path, not a glob result.
    assert.equal(jedi.data.gameDir, game);
  } finally {
    fs.rmSync(lib, { recursive: true, force: true });
  }
});
