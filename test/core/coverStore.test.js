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

console.log(`\n${passed} passed`);
