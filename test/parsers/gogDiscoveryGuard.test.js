'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// gogWatch resolves the Galaxy catalog and Applications root from the environment at require time,
// so both are pointed at an empty sandbox BEFORE loading the module to model "GOG not installed".
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gog-guard-'));
process.env.APPDATA = tmp;
process.env.ProgramData = path.join(tmp, 'ProgramData');
process.env.LOCALAPPDATA = path.join(tmp, 'Local');

const gogWatch = require('../../watchdog/console/gogWatch.js');

test('discovery reports nothing instead of throwing when Galaxy is not installed', () => {
  // Before the guard, the missing catalog reached SQLite and surfaced as the opaque
  // "unable to open database file", warned once per settings reload (94 times in one field log).
  const targets = gogWatch._internal.discover();
  assert.deepEqual(targets, [], 'a machine without GOG Galaxy simply has no GOG targets');
});

test('discovery stays quiet when the catalog exists but no game is installed', () => {
  const storageDir = path.join(process.env.ProgramData, 'GOG.com', 'Galaxy', 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  // A present-but-unreadable catalog must not throw either: the Applications root is empty, so the
  // cheap checks short-circuit before any SQLite open is attempted.
  fs.writeFileSync(path.join(storageDir, 'galaxy-2.0.db'), 'not a database');
  fs.mkdirSync(path.join(process.env.LOCALAPPDATA, 'GOG.com', 'Galaxy', 'Applications'), { recursive: true });

  assert.deepEqual(gogWatch._internal.discover(), [], 'no client folders means no targets');
});

test('a start() with no GOG installed resolves without warning', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await gogWatch.start({
      options: { achievement_source: {}, notification: { notify: true } },
      notify: () => {},
      getToastID: () => 'test',
    });
  } finally {
    console.warn = originalWarn;
    gogWatch.stop();
  }
  assert.equal(
    warnings.filter((line) => line.includes('discovery failed')).length,
    0,
    'GOG being absent is a normal state, not a recurring warning'
  );
});
