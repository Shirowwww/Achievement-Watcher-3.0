'use strict';

// Standalone test runner. Run with: node --test test/core/coverStore.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const coverStore = require('../../app/util/coverStore.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.stack || e.message || e}`);
    process.exitCode = 1;
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cover-'));
const tmpFile = path.join(tmpRoot, 'cfg', 'covers.db');
coverStore.setStoreFile(tmpFile);

test('get returns null when nothing is set', () => {
  assert.strictEqual(coverStore.get('480'), null);
});

test('set then get round-trips and coerces appid to string', () => {
  coverStore.set(480, 'file:///C:/art/480.png');
  assert.strictEqual(coverStore.get('480'), 'file:///C:/art/480.png');
  assert.strictEqual(coverStore.get(480), 'file:///C:/art/480.png');
});

test('set ignores empty appid or url', () => {
  coverStore.set('', 'x');
  coverStore.set('999', '');
  assert.strictEqual(coverStore.get('999'), null);
});

test('overwriting an appid replaces the value', () => {
  coverStore.set('480', 'https://example/new.jpg');
  assert.strictEqual(coverStore.get('480'), 'https://example/new.jpg');
});

test('remove deletes only the targeted appid', () => {
  coverStore.set('CUSA01', 'file:///a.png');
  coverStore.set('CUSA02', 'file:///b.png');
  coverStore.remove('CUSA01');
  assert.strictEqual(coverStore.get('CUSA01'), null);
  assert.strictEqual(coverStore.get('CUSA02'), 'file:///b.png');
});

test('readAll survives a corrupt/missing store file', () => {
  fs.writeFileSync(tmpFile, '{ this is not json', 'utf8');
  assert.deepStrictEqual(coverStore.readAll(), {});
});

test('readAll returns a copy and reloads after external file changes', () => {
  coverStore.writeAll({ 1: 'a' });
  const first = coverStore.readAll();
  first[1] = 'mutated';
  assert.strictEqual(coverStore.get(1), 'a');
  fs.writeFileSync(tmpFile, JSON.stringify({ 1: 'b' }, null, 2), 'utf8');
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(tmpFile, future, future);
  assert.strictEqual(coverStore.get(1), 'b');
});

test('persist copies a cache-backed selection into the durable covers folder', () => {
  const cached = path.join(tmpRoot, 'steam_cache', 'icon', '480', 'header.jpg');
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, 'custom cover');

  const stored = coverStore.persist('480', pathToFileURL(cached).href, tmpRoot);
  const durable = fileURLToPath(stored);

  assert.strictEqual(path.dirname(durable), path.join(tmpRoot, 'covers'));
  assert.strictEqual(fs.readFileSync(durable, 'utf8'), 'custom cover');
  fs.rmSync(path.join(tmpRoot, 'steam_cache'), { recursive: true, force: true });
  assert.strictEqual(coverStore.isUsable(coverStore.get('480')), true);
});

/*
  Choosing a second cover for a game used to write it over the first one, at the same
  covers/<appid>.<ext> path. The value handed to CSS was therefore the same file:// URL both times,
  and Chromium keys its decoded-image cache on the URL - so the tile kept painting the old picture
  and choosing a cover looked like it silently did nothing.
*/
test('a different cover for the same game gets a different URL, so the tile actually repaints', () => {
  const first = path.join(tmpRoot, 'steam_cache', 'icon', '1478500', 'a.png');
  const second = path.join(tmpRoot, 'steam_cache', 'icon', '1478500', 'b.png');
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(first, 'the first cover');
  fs.writeFileSync(second, 'a completely different cover');

  const storedFirst = coverStore.persist('1478500', pathToFileURL(first).href, tmpRoot);
  const storedSecond = coverStore.persist('1478500', pathToFileURL(second).href, tmpRoot);

  assert.notStrictEqual(storedFirst, storedSecond, 'a new image must not reuse the previous URL');
  assert.strictEqual(fs.readFileSync(fileURLToPath(storedSecond), 'utf8'), 'a completely different cover');
  assert.strictEqual(coverStore.get('1478500'), storedSecond, 'the store must point at the new selection');

  // The replaced copy is not left behind to accumulate.
  assert.strictEqual(fs.existsSync(fileURLToPath(storedFirst)), false, 'the superseded cover file must be pruned');

  // Same extension, different bytes: the case that produced the "it did nothing" report.
  assert.strictEqual(path.extname(fileURLToPath(storedFirst)), path.extname(fileURLToPath(storedSecond)));
});

test('re-picking the identical image is stable and does not pile up copies', () => {
  const source = path.join(tmpRoot, 'steam_cache', 'icon', '999', 'same.png');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'identical bytes');

  const once = coverStore.persist('999', pathToFileURL(source).href, tmpRoot);
  const twice = coverStore.persist('999', pathToFileURL(source).href, tmpRoot);

  assert.strictEqual(once, twice, 'the same bytes must resolve to the same stored cover');
  const files = fs.readdirSync(path.join(tmpRoot, 'covers')).filter((n) => n.startsWith('999'));
  assert.strictEqual(files.length, 1, `exactly one file should exist for this game, found ${files.join(', ')}`);
});

test('a cover stored by an older build is replaced, not left alongside the new one', () => {
  // What an older build wrote: covers/<appid>.<ext> with no digest.
  const legacy = path.join(tmpRoot, 'covers', '4242.png');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'old style cover');
  coverStore.set('4242', pathToFileURL(legacy).href);

  const replacement = path.join(tmpRoot, 'steam_cache', 'icon', '4242', 'new.png');
  fs.mkdirSync(path.dirname(replacement), { recursive: true });
  fs.writeFileSync(replacement, 'the newly chosen cover');

  const stored = coverStore.persist('4242', pathToFileURL(replacement).href, tmpRoot);
  assert.notStrictEqual(fileURLToPath(stored).toLowerCase(), legacy.toLowerCase());
  assert.strictEqual(fs.existsSync(legacy), false, 'the pre-digest file must be cleaned up too');
  assert.strictEqual(fs.readFileSync(fileURLToPath(stored), 'utf8'), 'the newly chosen cover');
});

test('preserveCachedOverrides upgrades selections made by older builds before cache deletion', () => {
  const cached = path.join(tmpRoot, 'steam_cache', 'icon', '570', 'library_600x900.png');
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, 'legacy custom cover');
  coverStore.writeAll({ 570: pathToFileURL(cached).href });

  assert.deepStrictEqual(coverStore.preserveCachedOverrides(tmpRoot), ['570']);
  coverStore.setStoreFile(tmpFile);
  const durable = fileURLToPath(coverStore.get('570'));
  assert.strictEqual(path.dirname(durable), path.join(tmpRoot, 'covers'));
  assert.strictEqual(fs.readFileSync(durable, 'utf8'), 'legacy custom cover');
});

test('isUsable rejects a deleted local override but keeps a remote fallback', () => {
  assert.strictEqual(coverStore.isUsable(pathToFileURL(path.join(tmpRoot, 'missing.png')).href), false);
  assert.strictEqual(coverStore.isUsable('https://example.test/cover.png'), true);
});

test('recoverRemote reconstructs an exact SteamGridDB selection from its legacy cache filename', () => {
  const legacy = pathToFileURL(
    path.join(tmpRoot, 'steam_cache', 'icon', '391540', '06f867ad5a8dd38502b33ec03d5abc47.png')
  ).href;
  assert.strictEqual(
    coverStore.recoverRemote(legacy),
    'https://cdn2.steamgriddb.com/grid/06f867ad5a8dd38502b33ec03d5abc47.png'
  );
  assert.strictEqual(
    coverStore.recoverRemote(pathToFileURL(path.join(tmpRoot, 'steam_cache', 'icon', '480', 'header.jpg')).href),
    null,
    'a generic filename cannot reveal which alternate Steam AppID supplied it'
  );
});

/*
  Before orientation-scoped entries, one override applied to a game no matter which shape was on
  screen - so picking a portrait cover and then switching to the landscape grid kept showing that
  same portrait image instead of falling back to the default landscape art.
*/
test('portrait and landscape overrides are independent, and legacy values apply to both', () => {
  assert.strictEqual(coverStore.get('7001', 'portrait'), null);
  assert.strictEqual(coverStore.get('7001', 'landscape'), null);

  coverStore.set('7001', 'file:///legacy.png');
  assert.strictEqual(coverStore.get('7001', 'portrait'), 'file:///legacy.png');
  assert.strictEqual(coverStore.get('7001', 'landscape'), 'file:///legacy.png');

  coverStore.set('7001', 'file:///portrait-pick.png', 'portrait');
  assert.strictEqual(coverStore.get('7001', 'portrait'), 'file:///portrait-pick.png');
  // The legacy value is preserved for the orientation not just picked, rather than dropped.
  assert.strictEqual(coverStore.get('7001', 'landscape'), 'file:///legacy.png');

  coverStore.set('7001', 'file:///landscape-pick.png', 'landscape');
  assert.strictEqual(coverStore.get('7001', 'landscape'), 'file:///landscape-pick.png');
  assert.strictEqual(coverStore.get('7001', 'portrait'), 'file:///portrait-pick.png');

  coverStore.remove('7001', 'portrait');
  assert.strictEqual(coverStore.get('7001', 'portrait'), null, 'clearing one orientation must not resurrect the other');
  assert.strictEqual(coverStore.get('7001', 'landscape'), 'file:///landscape-pick.png');

  coverStore.remove('7001', 'landscape');
  assert.strictEqual(coverStore.get('7001'), null, 'removing the last orientation clears the entry entirely');
});

test('persist keeps both orientations’ files when they differ, and prunes only what changed', () => {
  const portraitSrc = path.join(tmpRoot, 'steam_cache', 'icon', '7002', 'p.png');
  const landscapeSrc = path.join(tmpRoot, 'steam_cache', 'icon', '7002', 'l.png');
  fs.mkdirSync(path.dirname(portraitSrc), { recursive: true });
  fs.writeFileSync(portraitSrc, 'portrait bytes');
  fs.writeFileSync(landscapeSrc, 'landscape bytes');

  const storedPortrait = coverStore.persist('7002', pathToFileURL(portraitSrc).href, tmpRoot, 'portrait');
  const storedLandscape = coverStore.persist('7002', pathToFileURL(landscapeSrc).href, tmpRoot, 'landscape');

  assert.notStrictEqual(storedPortrait, storedLandscape);
  assert.strictEqual(fs.existsSync(fileURLToPath(storedPortrait)), true, 'the portrait file must survive picking a landscape cover');
  assert.strictEqual(fs.existsSync(fileURLToPath(storedLandscape)), true);
  assert.strictEqual(coverStore.get('7002', 'portrait'), storedPortrait);
  assert.strictEqual(coverStore.get('7002', 'landscape'), storedLandscape);

  // Re-picking a new landscape cover prunes the old landscape file but leaves portrait untouched.
  const landscapeSrc2 = path.join(tmpRoot, 'steam_cache', 'icon', '7002', 'l2.png');
  fs.writeFileSync(landscapeSrc2, 'a different landscape');
  const storedLandscape2 = coverStore.persist('7002', pathToFileURL(landscapeSrc2).href, tmpRoot, 'landscape');
  assert.strictEqual(fs.existsSync(fileURLToPath(storedLandscape)), false, 'the superseded landscape file must be pruned');
  assert.strictEqual(fs.existsSync(fileURLToPath(storedPortrait)), true, 'the untouched portrait file must not be pruned');
  assert.strictEqual(coverStore.get('7002', 'portrait'), storedPortrait);
  assert.strictEqual(coverStore.get('7002', 'landscape'), storedLandscape2);
});

/*
  The split above only helps covers picked from now on. Entries written before it exist as one plain
  string, and nothing in them records which shape the user picked - except the image itself.
*/
function writePng(file, width, height) {
  const png = Buffer.alloc(33);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'latin1');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  return pathToFileURL(file).href;
}

test('legacy covers are bound to the orientation their own artwork has', () => {
  const header = writePng(path.join(tmpRoot, 'covers', '8001.png'), 920, 430); // Steam header
  const grid = writePng(path.join(tmpRoot, 'covers', '8002.png'), 600, 900); // portrait grid
  const square = writePng(path.join(tmpRoot, 'covers', '8003.png'), 512, 512);

  coverStore.set('8001', header);
  coverStore.set('8002', grid);
  coverStore.set('8003', square);
  coverStore.set('8004', 'https://cdn2.steamgriddb.com/grid/deadbeef.png');
  coverStore.set('8005', 'file:///gone.png');
  coverStore.set('8006', 'file:///already-split.png', 'portrait');

  const changed = coverStore.splitLegacyByShape();
  assert.deepStrictEqual(changed.sort(), ['8001', '8002']);

  assert.strictEqual(coverStore.get('8001', 'landscape'), header);
  assert.strictEqual(coverStore.get('8001', 'portrait'), null, 'a header must stop being reused as the portrait cover');
  assert.strictEqual(coverStore.get('8002', 'portrait'), grid);
  assert.strictEqual(coverStore.get('8002', 'landscape'), null);

  // Nothing to go on: a square image, a remote URL and a deleted file keep applying to both.
  for (const id of ['8003', '8004', '8005']) {
    assert.strictEqual(typeof coverStore.readAll()[id], 'string', `${id} must be left alone`);
  }
  // Already per-orientation: untouched, and never collapsed back into a string.
  assert.strictEqual(coverStore.get('8006', 'portrait'), 'file:///already-split.png');
  assert.strictEqual(coverStore.get('8006', 'landscape'), null);

  // Running twice is a no-op: the migration has nothing left to classify.
  assert.deepStrictEqual(coverStore.splitLegacyByShape(), []);
});

console.log(`\n${passed} passed`);
