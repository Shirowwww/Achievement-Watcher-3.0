'use strict';

// Standalone test runner. Run with: node test/coverStore.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const coverStore = require('../app/util/coverStore.js');

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

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cover-')), 'covers.db');
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

console.log(`\n${passed} passed`);
