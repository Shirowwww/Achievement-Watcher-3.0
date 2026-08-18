'use strict';

/*
  Three defects found on a real library, each with a different root cause:

  1. "Call of Duty: Black Ops III" (SmartSteamEmu) was badged as an EA title, because the source
     test was a substring match and "SmartSt(ea)mEmu" contains "ea".
  2. Cyberpunk 2077 appeared twice - once from its GOG install, once from a leftover CODEX save -
     because the dedupe resolved names from an english-only cache path on a French profile.
  3. "The Jackbox Party Pack" (not installed) adopted the whole Jackbox collection folder as its
     install directory and was handed another pack's executable.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const gameNameCache = require(path.join(appDir, 'util', 'gameNameCache.js'));
const exeDetect = require(path.join(appDir, 'parser', 'exeDetect.js'));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---- 1. the EA badge -------------------------------------------------------------------------

test('the EA badge is earned by the EA label alone, not by any label containing "ea"', () => {
  const { SOURCE_BADGE } = badgeTables();
  assert.ok(SOURCE_BADGE.ea.test('ea'), 'the EA parser emits exactly "ea"');

  // The labels a substring test used to swallow: "ea" hides inside "St(ea)m" in every one of them.
  for (const label of ['SmartSteamEmu', 'Goldberg SteamEmu', 'Steam (Shirow)']) {
    assert.ok(label.toLowerCase().includes('ea'), `${label} would have matched the old test`);
    assert.ok(!SOURCE_BADGE.ea.test(label.toLowerCase()), `${label} must not be treated as EA`);
  }

  // No pattern in the table may be an unanchored substring test again.
  for (const [name, pattern] of Object.entries(SOURCE_BADGE)) {
    assert.match(pattern.source, /^\^/, `${name} must be anchored at the start`);
    assert.match(pattern.source, /\$$/, `${name} must be anchored at the end`);
  }
});

test('EA has a source icon of its own instead of the unknown-source placeholder', () => {
  assert.ok(fs.existsSync(path.join(appDir, 'Source', 'ea.svg')), 'app/Source/ea.svg must ship');
  const init = fs.readFileSync(path.join(appDir, 'electron', 'init.js'), 'utf8');
  assert.match(init, /case 'ea':\s*\n\s*event\.returnValue = path\.join\(userData, 'Source', 'ea\.svg'\)/);
  const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  assert.doesNotMatch(
    appSource,
    /kind: 'ea'[\s\S]{0,200}achievement\.svg/,
    'the EA badge must not fall back to the generic question-mark icon'
  );
});

// Lift the shipped tables out of app.js so these check the real code, not a copy of it.
function badgeTables() {
  const source = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  const literal = (name, opener) => {
    const from = source.slice(source.indexOf(`const ${name} =`));
    const body = from.slice(from.indexOf(opener), from.indexOf(opener === '{' ? '};' : ';') + 1);
    return eval(`(${opener === '{' ? body : body.replace(/;$/, '')})`);
  };
  return { SOURCE_BADGE: literal('SOURCE_BADGE', '{'), STEAM_BADGE_SOURCES: literal('STEAM_BADGE_SOURCES', '/') };
}

// Every source label the parsers emit, gathered the same way a reviewer would.
function emittedSourceLabels() {
  const parserDir = path.join(appDir, 'parser');
  const emitted = new Set();
  for (const file of fs.readdirSync(parserDir).filter((f) => f.endsWith('.js'))) {
    for (const match of fs.readFileSync(path.join(parserDir, file), 'utf8').matchAll(/source: '([^']*)'/g)) emitted.add(match[1]);
  }
  return [...emitted];
}

test('every official platform label is recognised, in both spellings the parsers emit', () => {
  const { SOURCE_BADGE } = badgeTables();
  const badgeOf = (label) => Object.keys(SOURCE_BADGE).find((k) => SOURCE_BADGE[k].test(label.toLowerCase())) || null;

  // A label matching none of these falls through to the Steam badge, which is how an official GOG
  // copy of Cyberpunk 2077 ended up presented as a Steam game.
  for (const [label, expected] of [
    ['gog', 'gog'],
    ['GOG Galaxy', 'gog'],
    ['epic', 'epic'],
    ['epic-official', 'epic'],
    ['ea', 'ea'],
    ['Goldberg SocialClub', 'socialclub'],
    ['RPCS3 Emulator', 'playstation'],
    ['ShadPS4 Emulator', 'playstation'],
    ['Xenia Emulator', 'xbox'],
  ]) {
    assert.equal(badgeOf(label), expected, `${label} must earn the ${expected} badge`);
  }

  // Anchored, so an emulator is never mistaken for an official platform - the EA bug in reverse.
  for (const label of ['gog galaxy emulator', 'not gog', 'epicfail', 'Goldberg', 'SmartSteamEmu', 'Steam (Shirow)', 'GBE Fork']) {
    assert.equal(badgeOf(label), null, `${label} must not match any official platform`);
  }
});

test('no source label the parsers emit can go unclassified', () => {
  // The real guard. "Falls through to Steam" is the failure mode of BOTH earlier bugs, so a label
  // that reaches it must be there deliberately: either a platform pattern claims it, or it is
  // listed as a Steam-badged source, or Ubisoft detection owns it. Anything else fails here rather
  // than shipping a plausible wrong badge.
  const { SOURCE_BADGE, STEAM_BADGE_SOURCES } = badgeTables();
  const uplayR2 = require(path.join(appDir, 'parser', 'uplayR2.js'));

  const unclassified = emittedSourceLabels().filter((label) => {
    const lower = label.toLowerCase();
    if (Object.values(SOURCE_BADGE).some((re) => re.test(lower))) return false;
    if (STEAM_BADGE_SOURCES.test(lower)) return false;
    if (uplayR2.isUbisoftGame({ source: label }, null)) return false;
    if (/^steam\s*\(/.test(lower)) return false; // the user's own Steam library, badge hidden
    return true;
  });

  assert.deepEqual(
    unclassified,
    [],
    `classify these in SOURCE_BADGE or STEAM_BADGE_SOURCES (app/app.js), or they become Steam-badged silently: ${unclassified.join(', ')}`
  );
});

test('the Steam-badged list stays a list of real emulators, not a catch-all', () => {
  const { SOURCE_BADGE, STEAM_BADGE_SOURCES } = badgeTables();
  // It must not swallow a platform label - that would defeat the coverage test above.
  for (const label of ['gog', 'gog galaxy', 'epic', 'epic-official', 'ea', 'goldberg socialclub', 'xenia emulator']) {
    assert.ok(!STEAM_BADGE_SOURCES.test(label), `${label} belongs to a platform, not to the Steam fallback list`);
  }
  // And the platform patterns must not claim an emulator.
  for (const label of ['codex', 'rune', 'onlinefix', 'smartsteamemu', 'tenoke', 'hoodlum']) {
    assert.ok(!Object.values(SOURCE_BADGE).some((re) => re.test(label)), `${label} is a Steam emulator`);
  }
});

test('the icon handler answers to both spellings too', () => {
  const init = fs.readFileSync(path.join(appDir, 'electron', 'init.js'), 'utf8');
  const handler = init.slice(init.indexOf("ipcMain.on('fetch-source-img'"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  for (const [label, file] of [
    ["case 'GOG Galaxy':", 'gog.svg'],
    ["case 'epic-official':", 'epic.svg'],
  ]) {
    assert.ok(body.includes(label), `${label} must be handled`);
    assert.ok(body.includes(file));
  }
});

// ---- 2. the Cyberpunk duplicate --------------------------------------------------------------

test('an offline schema name is found whatever language the profile caches', () => {
  const userData = tempDir('aw-schema-name-');
  try {
    // Only the user's own language is ever written, so an english-only lookup found nothing.
    const french = path.join(userData, 'steam_cache', 'schema', 'french');
    fs.mkdirSync(french, { recursive: true });
    fs.writeFileSync(path.join(french, '1091500.db'), JSON.stringify({ appid: 1091500, name: 'Cyberpunk 2077' }));

    assert.equal(gameNameCache.lookupSchemaCacheName(userData, '1091500'), 'Cyberpunk 2077');
    assert.equal(gameNameCache.lookupSchemaCacheName(userData, 1091500), 'Cyberpunk 2077', 'a numeric appid works too');
    assert.equal(gameNameCache.lookupSchemaCacheName(userData, '999999'), '');
    assert.equal(gameNameCache.lookupSchemaCacheName(userData, ''), '');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('a corrupt or empty schema entry falls through to the next language', () => {
  const userData = tempDir('aw-schema-name-bad-');
  try {
    for (const [lang, body] of [
      ['english', '{ not json'],
      ['german', JSON.stringify({ name: '   ' })],
      ['french', JSON.stringify({ name: 'Cyberpunk 2077' })],
    ]) {
      const dir = path.join(userData, 'steam_cache', 'schema', lang);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '1091500.db'), body);
    }
    assert.equal(gameNameCache.lookupSchemaCacheName(userData, '1091500'), 'Cyberpunk 2077');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('a missing cache never throws', () => {
  assert.equal(gameNameCache.lookupSchemaCacheName(path.join(os.tmpdir(), 'aw-does-not-exist-xyz'), '1'), '');
});

test('the cross-source dedupe resolves names through the shared cache, not an english-only path', () => {
  const source = fs.readFileSync(path.join(appDir, 'parser', 'achievements.js'), 'utf8');
  assert.match(source, /cachedSteamName = \(appid\) => gameNameCache\.lookupSchemaCacheName\(/);
  assert.doesNotMatch(source, /'steam_cache', 'schema', 'english'/, 'no hard-coded language in the dedupe');
});

test('the blacklist and the library dedupe share one implementation', () => {
  const blacklist = fs.readFileSync(path.join(appDir, 'parser', 'blacklist.js'), 'utf8');
  assert.match(blacklist, /gameNameCache\.js'\)\)\.lookupSchemaCacheName\(/, 'no second copy of the language walk');
});

// ---- 3. the Jackbox collection folder --------------------------------------------------------

test('a folder holding other games is not offered as a game folder', () => {
  const root = tempDir('aw-collection-');
  try {
    // A collection: numbered subfolders, each a real install, and only a launcher at the top.
    fs.writeFileSync(path.join(root, 'Launcher.exe'), '');
    for (const pack of ['2', '9']) {
      const dir = path.join(root, pack);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, `The Jackbox Party Pack ${pack}.exe`), '');
    }
    const claimed = new Set([path.join(root, '2').toLowerCase(), path.join(root, '9').toLowerCase()]);

    // The rule the parser applies: contains another game's install AND has no game exe of its own.
    const holdsAnotherGame = (dir) => {
      const prefix = path.resolve(dir).toLowerCase() + path.sep;
      return [...claimed].some((c) => path.resolve(c).toLowerCase().startsWith(prefix));
    };
    const isCollection = (dir) => holdsAnotherGame(dir) && !exeDetect.shallowGameExe(dir);

    assert.equal(isCollection(root), true, 'the collection root is a container, not a game');
    assert.equal(exeDetect.shallowGameExe(root), null, 'a bare launcher is not a game executable');
    assert.equal(isCollection(path.join(root, '9')), false, 'a real pack stays a game folder');

    // Without the guard the uninstalled pack matched the container and then took a pack's exe.
    const index = [{ dir: root, name: 'The Jackbox Party Pack Collection' }];
    assert.equal(exeDetect.bestFolderMatch('The Jackbox Party Pack', index), root, 'the name match itself is strong');
    assert.equal(exeDetect.bestFolderMatch('The Jackbox Party Pack', index.filter((f) => !isCollection(f.dir))), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a game folder that merely contains a claimed sub-install is still a game folder', () => {
  const root = tempDir('aw-nested-');
  try {
    // Nested engine layouts (Unreal/Unity) put the emulator deeper than the game root.
    fs.writeFileSync(path.join(root, 'MyGame.exe'), '');
    const nested = path.join(root, 'Binaries', 'Win64');
    fs.mkdirSync(nested, { recursive: true });
    const claimed = new Set([nested.toLowerCase()]);

    const prefix = path.resolve(root).toLowerCase() + path.sep;
    const holdsAnotherGame = [...claimed].some((c) => path.resolve(c).toLowerCase().startsWith(prefix));
    assert.equal(holdsAnotherGame, true, 'it does contain a claimed folder');
    assert.ok(exeDetect.shallowGameExe(root), 'but it has its own executable, so it is not a container');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the name-based folder match filters collections before scoring', () => {
  const source = fs.readFileSync(path.join(appDir, 'parser', 'achievements.js'), 'utf8');
  assert.match(source, /function isGameCollectionDir/, 'the container rule must exist');
  const resolver = source.slice(source.indexOf('async function resolveGameDirByName'));
  const body = resolver.slice(0, resolver.indexOf('\n}'));
  assert.match(body, /filter\(\(f\) => !isGameCollectionDir\(f\.dir\)\)/, 'containers must be dropped before bestFolderMatch');
});
