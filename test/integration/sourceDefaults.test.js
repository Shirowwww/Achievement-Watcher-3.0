'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const appSettings = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'settings.js'), 'utf8');
const watchdogSettings = fs.readFileSync(path.join(__dirname, '..', '..', 'watchdog', 'settings.js'), 'utf8');

function defaults(source) {
  const block = source.match(/achievement_source:\s*\{([^}]*)\}/);
  assert.ok(block, 'achievement_source defaults must exist');
  const entries = {};
  for (const line of block[1].split('\n')) {
    const match = line.match(/^\s*(\w+)\s*:\s*(true|false|\d+)\s*,?\s*$/);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

function validated(source) {
  return new Set([...source.matchAll(/achievement_source\.(\w+) !== 'boolean'/g)].map((m) => m[1]));
}

// The app writes options.ini and the Watchdog reads it back. A source the Watchdog does not know
// about keeps working (its live watchers test `=== false`), but the two loaders writing different
// defaults into the same file is how a setting silently flips between scans.
test('the app and the Watchdog agree on the achievement source defaults', () => {
  assert.deepStrictEqual(defaults(watchdogSettings), defaults(appSettings));
});

test('both loaders validate the same boolean sources', () => {
  const app = validated(appSettings);
  const watchdog = validated(watchdogSettings);
  assert.deepStrictEqual([...watchdog].sort(), [...app].sort());
  // Every boolean default must actually be validated by both.
  for (const [key, value] of Object.entries(defaults(appSettings))) {
    if (value !== 'true' && value !== 'false') continue; // legitSteam is a 0/1/2 level
    assert.ok(app.has(key), `app/settings.js does not validate achievement_source.${key}`);
    assert.ok(watchdog.has(key), `watchdog/settings.js does not validate achievement_source.${key}`);
  }
});

// A toggle the user flips has to reach the live notification path too, not just the library scan.
test('every live watcher honours its own source toggle', () => {
  const watchers = {
    shadps4Watch: 'shadps4',
    xeniaWatch: 'xenia',
    gogWatch: 'gogOfficial',
    ubisoftWatch: 'ubisoftOfficial',
    eaWatch: 'ea',
  };
  for (const [file, key] of Object.entries(watchers)) {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'watchdog', 'console', `${file}.js`), 'utf8');
    assert.ok(
      source.includes(`achievement_source.${key} === false`),
      `${file}.js must bail out when achievement_source.${key} is disabled`
    );
  }
});
