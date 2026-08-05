'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrateLegacyUserData, isAlreadyInitialized } = require('../app/util/migrateUserData.js');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// A legacy %APPDATA%\Achievement Watcher as it really looks after a while: AW's own data next to a
// full Chromium profile (the bulk of the folder) and a log directory.
function fixture(root) {
  const legacy = path.join(root, 'Achievement Watcher');
  const target = path.join(root, 'Achievement Watcher 3.0');

  write(path.join(legacy, 'cfg', 'options.ini'), '[general]\nusername = Screamir58\n');
  write(path.join(legacy, 'cfg', 'gbe-backups.db'), '{}');
  write(path.join(legacy, 'steam_cache', 'schema', 'english', '480.db'), '{"name":"Spacewar"}');
  write(path.join(legacy, 'backups', 'gbe', '480 - GBE backup', 'backup.json'), '{"appid":480}');
  write(path.join(legacy, 'cache', 'uplayR2', 'upc_r2_loader64.dll'), 'seeded-by-user');
  write(path.join(legacy, 'themes', 'neon.css'), 'body{}');
  write(path.join(legacy, 'epic_tokens.enc'), 'enc');

  // Chromium-managed profile state + logs: must never be imported.
  write(path.join(legacy, 'Cache', 'Cache_Data', 'data_0'), 'chromium');
  write(path.join(legacy, 'Code Cache', 'js', 'index'), 'chromium');
  write(path.join(legacy, 'GPUCache', 'data_1'), 'chromium');
  write(path.join(legacy, 'Local Storage', 'leveldb', '000003.log'), 'chromium');
  write(path.join(legacy, 'Preferences'), '{}');
  write(path.join(legacy, 'logs', 'parser.log'), 'old log');

  return { legacy, target };
}

test('imports the Achievement Watcher payload without copying the Chromium profile', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-migrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { legacy, target } = fixture(root);

  assert.equal(migrateLegacyUserData(target, { legacyDir: legacy, skipRegistry: true }), legacy);

  for (const rel of [
    ['cfg', 'options.ini'],
    ['cfg', 'gbe-backups.db'],
    ['steam_cache', 'schema', 'english', '480.db'],
    ['backups', 'gbe', '480 - GBE backup', 'backup.json'],
    ['cache', 'uplayR2', 'upc_r2_loader64.dll'],
    ['themes', 'neon.css'],
    ['epic_tokens.enc'],
    ['cfg', 'migrated-from-legacy.json'],
  ]) {
    assert.equal(fs.existsSync(path.join(target, ...rel)), true, `${rel.join('/')} must be imported`);
  }

  // The Chromium profile is regenerated on first launch and is by far the biggest part of the
  // legacy folder — importing it would stall startup and double disk usage for nothing.
  for (const rel of [['Cache', 'Cache_Data'], ['Code Cache'], ['GPUCache'], ['Local Storage'], ['Preferences'], ['logs']]) {
    assert.equal(fs.existsSync(path.join(target, ...rel)), false, `${rel.join('/')} must NOT be imported`);
  }

  // Import, never move: 1.6.8 may still be installed and must keep working.
  assert.equal(fs.existsSync(path.join(legacy, 'cfg', 'options.ini')), true);
});

test('large write-once payloads are hard-linked instead of copied', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-migrate-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { legacy, target } = fixture(root);

  migrateLegacyUserData(target, { legacyDir: legacy, skipRegistry: true });

  // backups/steam_cache/cache are hard links: one inode, two directory entries. That is what keeps
  // the 1.6.8 uninstaller from taking the data with it while costing no extra disk (issue #6).
  const linked = fs.statSync(path.join(target, 'backups', 'gbe', '480 - GBE backup', 'backup.json'));
  const source = fs.statSync(path.join(legacy, 'backups', 'gbe', '480 - GBE backup', 'backup.json'));
  if (linked.nlink > 1) {
    assert.equal(linked.ino, source.ino, 'hard-linked entries share an inode');
  }

  // cfg is a real copy: 3.x rewrites options.ini in place and must not write through into 1.6.8's
  // configuration.
  fs.writeFileSync(path.join(target, 'cfg', 'options.ini'), '[general]\nusername = Changed\n', 'utf8');
  assert.equal(fs.readFileSync(path.join(legacy, 'cfg', 'options.ini'), 'utf8').includes('Screamir58'), true);
});

test('a target that only holds freshly created logs is still migrated', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-migrate-logs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { legacy, target } = fixture(root);

  // The Watchdog and the loggers create <userData>\logs on their very first write, so the new
  // directory routinely exists before the first migrated launch. Treating "non-empty" as "already
  // set up" would block the import forever.
  write(path.join(target, 'logs', 'notification.log'), 'watchdog started');
  assert.equal(isAlreadyInitialized(target), false);
  assert.equal(migrateLegacyUserData(target, { legacyDir: legacy, skipRegistry: true }), legacy);
  assert.equal(fs.existsSync(path.join(target, 'cfg', 'options.ini')), true);
});

test('an already configured target is never overwritten, and no-ops stay no-ops', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-migrate-noop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { legacy, target } = fixture(root);

  write(path.join(target, 'cfg', 'options.ini'), '[general]\nusername = NewUser\n');
  assert.equal(isAlreadyInitialized(target), true);
  assert.equal(migrateLegacyUserData(target, { legacyDir: legacy, skipRegistry: true }), null);
  assert.equal(fs.readFileSync(path.join(target, 'cfg', 'options.ini'), 'utf8').includes('NewUser'), true);

  // Missing legacy directory, and source === target, are both no-ops.
  const other = path.join(root, 'Achievement Watcher 3.0 other');
  assert.equal(migrateLegacyUserData(other, { legacyDir: path.join(root, 'nope'), skipRegistry: true }), null);
  assert.equal(migrateLegacyUserData(legacy, { legacyDir: legacy, skipRegistry: true }), null);
});
