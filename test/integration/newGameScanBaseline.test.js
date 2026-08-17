'use strict';

// The new-game detector diffs discovery against the previous discovery, not against the rendered
// list: merged, hidden or schema-less appids are discovered forever and rendered never.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const appUi = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
const refreshUi = fs.readFileSync(path.join(root, 'app', 'ui', 'refresh.js'), 'utf8');
const scan = appUi.slice(appUi.indexOf('async function runNewGameScan'), appUi.indexOf('function forgetScanCaches'));

test('the detector diffs discovery against the previous discovery, never against the rendered list', () => {
  assert.match(appUi, /let knownDiscoveredAppids = null;/);
  assert.match(scan, /const previous = knownDiscoveredAppids;/);
  assert.match(scan, /knownDiscoveredAppids = new Set\(discovered\);/);
  assert.match(scan, /discovered\.filter\(\(id\) => !previous\.has\(id\)\)/);
  assert.doesNotMatch(scan, /gameList/, 'the rendered list must not take part in the diff');
});

test('the first tick only establishes a baseline, so a cold start cannot refresh on nothing', () => {
  assert.match(scan, /if \(previous === null\) return;/);
});

test('a completed scan seeds the baseline, so an install during the scan is still detected', () => {
  assert.match(appUi, /self\.hasCompletedFirstScan = true;[\s\S]{0,240}seedNewGameScanBaseline\(\);/);
  assert.match(appUi, /function seedNewGameScanBaseline\(\)[\s\S]*?achievements[\s\S]*?\.detectInstalledAppids\(app\.config\)/);
});

test('a genuinely new appid still triggers the refresh that re-seeds the watchdog index', () => {
  assert.match(scan, /if \(fresh\.length > 0\) \{[\s\S]*?app\.onStart\(\)/);
});

test('a manual refresh clears the resolve caches without touching the baseline', () => {
  assert.match(refreshUi, /forgetScanCaches\(\);/);
  assert.match(appUi, /function forgetScanCaches\(\)[\s\S]*?steamParser\.forgetUnresolved\(\)[\s\S]*?steamParser\.forgetLocalSchemaLocations\(\)/);
  // The old memo is gone: with a discovery baseline there is nothing to write off.
  assert.doesNotMatch(appUi, /unrenderedAppids/);
});
