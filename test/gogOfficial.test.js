'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep every side-effect (rarity sidecar, image cache) inside the sandbox: both caches key off
// APPDATA / the parser's userData path, so point them at the tmp dir BEFORE loading the modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gog-official-'));
process.env.APPDATA = tmp;

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  console.log('SKIP: node:sqlite unavailable in this runtime');
  process.exit(0);
}

const gogOfficial = require('../app/parser/gogOfficial.js');
const gogWatch = require('../watchdog/console/gogWatch.js');

function buildStorageDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE ProductAuthorizations (productId INTEGER, clientId TEXT);
    CREATE TABLE InstalledBaseProducts (productId INTEGER, installationPath TEXT);
    CREATE TABLE ProductsToReleaseKeys (gogId INTEGER, releaseKey TEXT);
    CREATE TABLE LimitedDetails (productId INTEGER, title TEXT, languageId INTEGER, stored_at INTEGER);
    CREATE TABLE PlayTasks (id INTEGER, gameReleaseKey TEXT, isPrimary INTEGER, "order" INTEGER, typeId INTEGER);
    CREATE TABLE PlayTaskTypes (id INTEGER, type TEXT);
    CREATE TABLE PlayTaskLaunchParameters (playTaskId INTEGER, executablePath TEXT, commandLineArgs TEXT, label TEXT);
    CREATE TABLE Users (id INTEGER);
    INSERT INTO ProductAuthorizations VALUES (1423049311, '53652320436400298');
    INSERT INTO InstalledBaseProducts VALUES (1423049311, '${tmp.replace(/\\/g, '\\\\')}');
    INSERT INTO ProductsToReleaseKeys VALUES (1423049311, 'gog_1423049311');
    INSERT INTO LimitedDetails VALUES (1423049311, 'Cyberpunk 2077', 24, 1000);
    INSERT INTO LimitedDetails VALUES (1423049311, 'Cyberpunk 2077 (default lang)', 16, 900);
    INSERT INTO PlayTaskTypes VALUES (1, 'BuiltInPrimary');
    INSERT INTO PlayTasks VALUES (10, 'gog_1423049311', 1, 0, 1);
    INSERT INTO PlayTaskLaunchParameters VALUES (10, 'C:\\\\Games\\\\CP2077\\\\bin\\\\Game.exe', '', 'Play');
    INSERT INTO Users VALUES (53435691055014860);
  `);
  db.close();
}

function buildGameplayDb(file, { retrieved = '1', mode = 'all_visible' } = {}) {
  fs.rmSync(file, { force: true }); // rebuilds replace the previous fixture
  const db = new DatabaseSync(file);
  try {
    db.exec(`
    CREATE TABLE database_info (key TEXT, value TEXT);
    CREATE TABLE achievement (
      id INTEGER, key TEXT, name TEXT, description TEXT, visible_while_locked INTEGER,
      unlock_time TEXT, image_url_locked TEXT, image_url_unlocked TEXT, changed INTEGER,
      rarity REAL, rarity_level_description TEXT, rarity_level_slug TEXT
    );
    INSERT INTO database_info VALUES ('achievements_retrieved', '${retrieved}');
    INSERT INTO database_info VALUES ('achievements_mode', '${mode}');
    INSERT INTO achievement VALUES
      (53794170518163195, 'TheFool', 'Le Fou', 'Devenir mercenaire.', 0,
       '2020-12-10T21:52:11+00:00', 'https://img/locked1.png', 'https://img/unlocked1.jpg', 0,
       94, 'Common', 'common'),
      (53794172015897726, 'TheWheel', 'La Roue', 'Caché jusqu’au déblocage.', 0,
       NULL, 'https://img/locked2.png', 'https://img/unlocked2.jpg', 0,
       12.5, 'Rare', 'rare');
  `);
  } finally {
    db.close();
  }
}

(async () => {
  try {
    // synthetic Galaxy layout: storage db + Applications/<clientId>/Gameplay/<userId>/gameplay.db
    const storageDb = path.join(tmp, 'galaxy-2.0.db');
    buildStorageDb(storageDb);
    const gameplayDir = path.join(tmp, 'Applications', '53652320436400298', 'Gameplay', '53435691055014860');
    fs.mkdirSync(gameplayDir, { recursive: true });
    const gameplayDb = path.join(gameplayDir, 'gameplay.db');
    buildGameplayDb(gameplayDb);

    const { readGogGalaxyProducts, listGameplayEntries, readGogGameplayDb, isGameplayReady } = gogOfficial._internal;

    // catalog read: title picked by language preference, launch exe resolved, BigInt ids survive
    const products = readGogGalaxyProducts({ storageDbPath: storageDb });
    const product = products.byClientId.get('53652320436400298');
    assert.ok(product, 'product resolved by clientId');
    assert.equal(product.productId, '1423049311');
    assert.equal(product.title, 'Cyberpunk 2077 (default lang)'); // languageId 16 wins
    assert.match(product.executablePath, /Game\.exe$/);

    // gameplay entries enumeration
    const entries = listGameplayEntries({ storageDbPath: storageDb, applicationsRoot: path.join(tmp, 'Applications') });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, '53435691055014860');

    // gameplay read + readiness
    const gameplay = readGogGameplayDb(gameplayDb);
    assert.equal(gameplay.achievements.length, 2);
    assert.equal(isGameplayReady(gameplay), true);

    // schema mapping through the parser contract
    gogOfficial.setUserDataPath(path.join(tmp, 'Achievement Watcher'));
    const appidEntry = {
      appid: '1423049311',
      source: 'GOG Galaxy',
      data: { type: 'gogOfficial', gameplayDbPath: gameplayDb, title: 'Cyberpunk 2077' },
    };
    // pre-seed the image cache so getGameData stays offline in tests
    const imgCache = path.join(tmp, 'Achievement Watcher', 'steam_cache', 'gogOfficial');
    fs.mkdirSync(imgCache, { recursive: true });
    fs.writeFileSync(path.join(imgCache, '1423049311.json'), JSON.stringify({ header: 'h', background: 'b', portrait: 'p', icon: 'i' }));

    const game = await gogOfficial.getGameData(appidEntry);
    assert.equal(game.name, 'Cyberpunk 2077');
    assert.equal(game.achievement.total, 2);
    assert.equal(game.achievement.list[0].name, 'TheFool');
    assert.equal(game.achievement.list[0].displayName, 'Le Fou');
    assert.equal(game.achievement.list[0].icon, 'https://img/unlocked1.jpg');
    assert.equal(game.achievement.list[0].icongray, 'https://img/locked1.png');
    // achievements_mode=all_visible overrides the per-row visible_while_locked=0 flags
    assert.ok(game.achievement.list.every((a) => a.hidden === 0));
    assert.deepEqual(game.img, { header: 'h', background: 'b', portrait: 'p', icon: 'i' });

    // rarity sidecar seeded from the DB into the shared cache
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(tmp, 'Achievement Watcher', 'steam_cache', 'rarity', '1423049311.json'), 'utf8')
    );
    assert.equal(sidecar.achievements.length, 2);
    assert.deepEqual(sidecar.achievements[0], { name: 'TheFool', percent: 94 });

    // unlock-state map for the shared merge (seconds, earned flags)
    const unlocks = gogOfficial.getAchievements(appidEntry);
    assert.equal(unlocks.TheFool.earned, true);
    assert.equal(unlocks.TheFool.earned_time, Math.floor(Date.parse('2020-12-10T21:52:11+00:00') / 1000));
    assert.equal(unlocks.TheWheel.earned, false);

    // per-row hidden flag respected when the mode is NOT all_visible
    buildGameplayDb(gameplayDb, { mode: 'default' });
    const masked = await gogOfficial.getGameData(appidEntry);
    assert.ok(masked.achievement.list.every((a) => a.hidden === 1));

    // a db that never fetched achievements is not ready and never listed by scan-like flows
    buildGameplayDb(gameplayDb, { retrieved: '0' });
    assert.equal(isGameplayReady(readGogGameplayDb(gameplayDb)), false);

    // watchdog reader shares the same layout
    buildGameplayDb(gameplayDb);
    const wRead = gogWatch._internal.read({ gameplayDbPath: gameplayDb });
    assert.equal(wRead.length, 2);
    assert.equal(wRead[0].key, 'TheFool');
    assert.equal(wRead[0].earned, true);
    assert.equal(wRead[1].earned, false);

    console.log('PASS: gogOfficial reads Galaxy catalog + gameplay achievements');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup — never mask the real test failure */
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
