'use strict';

/*
  The library must be a function of what is on disk, not of how the network behaved during the scan.

  Two field reports, one root cause (issues #33 and #34): per-game metadata resolution is allowed to
  fail, and both of its failure paths were wrong. A game whose lookup timed out was dropped from the
  library entirely - so the same disk produced a different handful of games on every scan - while a
  game whose lookup returned without a name survived wearing its numeric appid as a title. The
  timeouts themselves were self-inflicted: a SteamDB launch-metadata scrape (headless browser,
  serialized in the main process, 5-20s per game) was awaited inside the per-game load, under a 30s
  budget, purely to decorate the watchdog's playtime index.
*/

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { ipcRenderer: { sendSync: () => false, invoke: async () => null } };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../../app/parser/achievements.js');
const { buildProvisionalGame, resolveLocalGameName } = achievements._internal;

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'parser', 'achievements.js'), 'utf8');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-${label}-`));
}

// ---------------------------------------------------------------------------------------------
// issue #33 - a failed lookup must not delete the game
// ---------------------------------------------------------------------------------------------

test('a game whose metadata lookup fails still gets a library entry', () => {
  const saveDir = tempDir('rune-save');
  fs.writeFileSync(path.join(saveDir, 'achievements.ini'), '[SOME_ACH]\nAchieved=1\n');

  const entry = buildProvisionalGame({
    appid: '1544020',
    source: 'Rune',
    data: { type: 'file', path: saveDir },
  });

  assert.ok(entry, 'the entry must exist: the achievement data on disk is what proves the game does');
  assert.equal(entry.appid, '1544020');
  assert.equal(entry.provisional, true, 'it must be marked provisional so a later scan replaces it');
  assert.equal(entry.source, 'Rune', 'the source that found it is known locally and must be kept');
  assert.deepEqual(entry.achievement, { total: 0, unlocked: 0, list: [] });
});

test('the entry carries the artwork the appid alone can resolve', () => {
  // This is why a card could show the right cover under a numeric title (#34): Steam's CDN paths are
  // built from the appid, so artwork never depended on the lookup that failed.
  const saveDir = tempDir('art');
  fs.writeFileSync(path.join(saveDir, 'achievements.ini'), '');

  const entry = buildProvisionalGame({ appid: '2012840', source: 'Goldberg', data: { path: saveDir } });
  assert.match(entry.img.header, /\/2012840\/header\.jpg$/);
  assert.match(entry.img.portrait, /\/2012840\/library_600x900\.jpg$/);

  // A non-numeric (emulator/manual) id has no such CDN path - empty, not a broken URL.
  const emu = buildProvisionalGame({ appid: 'NPUB30500', source: 'RPCS3', data: { path: saveDir } });
  assert.equal(emu.img.header, '');
});

test('a record with nothing on disk behind it is still not resurrected', () => {
  // The keep-filter drops non-installed 0-achievement entries because they are phantom cache
  // imports. Making a failed load visible must not smuggle those back in.
  assert.equal(buildProvisionalGame({ appid: '480', source: 'Steam', data: {} }), null);
  assert.equal(buildProvisionalGame({ appid: '480', source: 'Steam' }), null);
  assert.equal(buildProvisionalGame(null), null);
});

test('makeList admits the provisional entry and no longer silently skips a failed load', () => {
  assert.match(source, /game = buildProvisionalGame\(appid\);/, 'a failed load must fall back to the local entry');
  assert.match(
    source,
    /if \(game && \(game\.provisional \|\| game\.unconfigured \|\| game\.installed \|\| \(game\.achievement && game\.achievement\.total > 0\)\)\)/,
    'the keep-filter must admit a provisional entry on its own terms'
  );
});

// ---------------------------------------------------------------------------------------------
// issue #33 - the decoration that caused the timeouts must not block the load
// ---------------------------------------------------------------------------------------------

test('the SteamDB launch lookup is never awaited on the game-load path', () => {
  assert.match(source, /function seedPlaytimeFromSteamDb\(appid, apply\)/, 'it must run through the detached helper');
  // The only await left is the one inside that helper, which nothing waits on. It goes through
  // ipcInvoke because achievements.js is also required from the main process, where ipcRenderer is
  // undefined and a direct call threw a bare TypeError once per game.
  assert.equal((source.match(/await ipcInvoke\('get-steamdb-launch'/g) || []).length, 1);
  assert.doesNotMatch(source, /ipcRenderer\.invoke\('get-steamdb-launch'/);
  const load = source.slice(source.indexOf('module.exports.getSavedAchievementsForAppid'));
  assert.ok(
    !/get-steamdb-launch/.test(load),
    'awaiting the SteamDB scrape inside a game load is what blew the 30s per-game budget and dropped 11 of 19 games'
  );
  // Both former call sites (generic playtime seed, SocialClub row) go through the helper.
  assert.equal((source.match(/seedPlaytimeFromSteamDb\(/g) || []).length, 3, 'one definition, two call sites');
});

test('a rescan started while a lookup is still running does not queue it twice', () => {
  assert.match(source, /_steamDbLaunchInFlight\.has\(id\)/, 'the helper must dedupe by appid');
  assert.match(source, /_steamDbLaunchInFlight\.delete\(id\)/, 'and release the id when it settles');
});

// ---------------------------------------------------------------------------------------------
// issue #34 - the bare appid is a last resort, not the first fallback
// ---------------------------------------------------------------------------------------------

test('a title known locally is preferred over the appid, most authoritative first', () => {
  const userData = tempDir('names');
  const schemaDir = path.join(userData, 'steam_cache', 'schema', 'french');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, '3768760.db'), JSON.stringify({ name: '007 First Light', appid: '3768760' }));

  achievements.initDebug({ isDev: false, userDataPath: userData });

  // 1) the name the discovery record already carried wins outright
  assert.equal(
    resolveLocalGameName({ appid: '3768760', name: 'Declared Title', data: {} }),
    'Declared Title'
  );

  // 2) otherwise the schema cache the app wrote for this game on an earlier scan
  assert.equal(resolveLocalGameName({ appid: '3768760', data: {} }), '007 First Light');

  // 3) otherwise the folder the game actually lives in
  const gameDir = path.join(userData, 'Games', 'STAR WARS Jedi Survivor');
  fs.mkdirSync(gameDir, { recursive: true });
  assert.equal(resolveLocalGameName({ appid: '1774580', data: { gameDir } }), 'STAR WARS Jedi Survivor');

  // 4) and nothing at all is reported as nothing - never as a numeric title
  assert.equal(resolveLocalGameName({ appid: '999999999', data: {} }), '');
});

test('a save folder named after the appid never becomes the title', () => {
  const userData = tempDir('numeric-dir');
  achievements.initDebug({ isDev: false, userDataPath: userData });
  const numericDir = path.join(userData, 'Goldberg SteamEmu Saves', '2012840');
  fs.mkdirSync(numericDir, { recursive: true });
  assert.equal(resolveLocalGameName({ appid: '2012840', data: { gameDir: numericDir } }), '');
});

test('an unresolved title is flagged and kept out of the watchdog index', () => {
  assert.match(source, /game\.nameUnresolved = true;/, 'the appid-as-title case must be marked');
  assert.match(
    source,
    /if \(game\.name && !game\.nameUnresolved && !\(appid\.data && appid\.data\.type === 'socialclub'\)\)/,
    'a numeric placeholder title must never be written into gameIndex, where notifications would read it back'
  );
});
