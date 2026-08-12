'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// watchdog.js opens pipes, spawns watchers and reads real settings on require, so its reload
// plumbing is asserted on the source (same approach as watchdogReload.test.js).
const watchdogSource = fs.readFileSync(path.join(__dirname, '..', 'watchdog', 'watchdog.js'), 'utf8');
const monitorSource = fs.readFileSync(path.join(__dirname, '..', 'watchdog', 'playtime', 'monitor.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');

test('watchdog reloads the playtime index when the app asks', () => {
  assert.match(watchdogSource, /reloadPlaytimeIndex === true/);
  assert.match(watchdogSource, /playtimeMonitorEmitter\.reloadGameIndex\(\)/);
  assert.match(watchdogSource, /playtimeIndexReloadQueued = true/, 'requests arriving before init are queued');
  assert.match(watchdogSource, /monitor\.reloadGameIndex\(\)/, 'queued reload runs once the monitor is ready');
});

test('playtime monitor exposes a reload that rebuilds the binary index', () => {
  assert.match(monitorSource, /emitter\.reloadGameIndex = async \(\) =>/);
  assert.match(monitorSource, /gameIndexByBinary = buildBinaryIndex\(next\)/);
  assert.match(monitorSource, /never replace a working index with an empty one/);
});

test('the library notifies the watchdog after re-seeding the game index', () => {
  assert.match(appSource, /watchdog-reload-playtime-index/);
});

test('achievements page shows playtime for every trackable non-Steam source', () => {
  assert.match(appSource, /if \(game\.system !== 'playstation'\) \{\s*PlaytimeTracking\(game\.appid\)/);
  assert.doesNotMatch(appSource, /game\.system !== 'playstation' && game\.system !== 'uplay'/);
});
