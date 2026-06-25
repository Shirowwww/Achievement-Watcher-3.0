'use strict';

// Standalone test (run via: node --test "../test/*.test.js").
// Characterizes epic.isExclusive's cache lookup — including the uncached branch
// (the //TODO at epic.js:44, which currently resolves to "not exclusive").
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const epic = require(path.join(__dirname, '..', 'app', 'parser', 'epic.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.message}`);
    process.exitCode = 1;
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-epic-'));
try {
  epic.setUserDataPath(temp);

  test('uncached appid with no cache file yet → not exclusive', () => {
    assert.strictEqual(epic.isExclusive('E-none'), false);
  });

  const cacheDir = path.join(temp, 'steam_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, 'epic.db'),
    JSON.stringify([
      { epicid: 'EPIC-ONLY' }, // no steamid → Epic-exclusive
      { epicid: 'BOTH', steamid: '12345' }, // also on Steam → not exclusive
    ])
  );

  test('cached Epic-only title (no steamid) → exclusive', () => {
    assert.strictEqual(epic.isExclusive('EPIC-ONLY'), true);
  });
  test('cached title that also has a steamid → not exclusive', () => {
    assert.strictEqual(epic.isExclusive('BOTH'), false);
  });
  test('lookup by the steam id of a dual title → not exclusive', () => {
    assert.strictEqual(epic.isExclusive('12345'), false);
  });
  test('appid absent from a populated cache → not exclusive (uncached TODO branch)', () => {
    assert.strictEqual(epic.isExclusive('NOPE'), false);
  });

  console.log(`PASS: epic.isExclusive (${passed} checks)`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
