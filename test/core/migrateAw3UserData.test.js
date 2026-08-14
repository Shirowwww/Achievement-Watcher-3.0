'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrateAw3UserData, migrateSouvenirFolder, configuredSouvenirDir, AW3_MARKER_REL, SOUVENIR_MARKER_REL } = require('../../app/util/migrateUserData.js');

/*
  The "Achievement Watcher 3.0" -> "Achievement Watcher Next" data hop. Everything here is about not
  losing or clobbering user data: the import must carry real state across, must never overwrite what
  is already in the destination, must survive a locked file, and must be a no-op on the second run.
  The souvenir rule gets its own coverage because moving screenshots a user deliberately pointed
  somewhere else is the one genuinely destructive mistake available in this file.
*/

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-next-migrate-'));
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function seedAw3(root) {
  const aw3 = path.join(root, 'Achievement Watcher 3.0');
  write(path.join(aw3, 'cfg', 'options.ini'), '[souvenir]\ndir=\n');
  write(path.join(aw3, 'cfg', 'gameIndex.json'), '{"appid":1}');
  write(path.join(aw3, 'presets', 'Users Presets', 'Mine', 'index.html'), '<html></html>');
  write(path.join(aw3, 'theme-images', 'bg.png'), 'PNG');
  write(path.join(aw3, 'covers', '440.jpg'), 'JPG');
  write(path.join(aw3, 'steam_cache', 'schema', '440.json'), '{}');
  write(path.join(aw3, 'cache', 'uplayR2', 'loader.dll'), 'DLL');
  write(path.join(aw3, 'logs', 'parser.log'), 'log line');
  write(path.join(aw3, 'epic_tokens.enc'), 'TOKEN');
  // Chromium profile data that must be left behind.
  write(path.join(aw3, 'Local State'), '{}');
  write(path.join(aw3, 'GPUCache', 'data_0'), 'bin');
  return aw3;
}

test('the 3.0 import carries user state across and leaves Chromium profile data behind', () => {
  const root = tempRoot();
  try {
    const aw3 = seedAw3(root);
    const target = path.join(root, 'Achievement Watcher Next');

    assert.equal(migrateAw3UserData(target, { aw3Dir: aw3, skipRegistry: true }), aw3);

    for (const rel of [
      path.join('cfg', 'options.ini'),
      path.join('cfg', 'gameIndex.json'),
      path.join('presets', 'Users Presets', 'Mine', 'index.html'),
      path.join('theme-images', 'bg.png'),
      path.join('covers', '440.jpg'),
      path.join('steam_cache', 'schema', '440.json'),
      path.join('cache', 'uplayR2', 'loader.dll'),
      path.join('logs', 'parser.log'),
      'epic_tokens.enc',
    ]) {
      assert.ok(fs.existsSync(path.join(target, rel)), `${rel} must be imported`);
    }

    assert.equal(fs.existsSync(path.join(target, 'Local State')), false, 'Chromium profile must not be copied');
    assert.equal(fs.existsSync(path.join(target, 'GPUCache')), false, 'Chromium cache must not be copied');

    // The source is never destroyed: a failed upgrade has to leave something to go back to.
    assert.ok(fs.existsSync(path.join(aw3, 'cfg', 'options.ini')), 'the 3.0 folder must survive the import');
    assert.ok(fs.existsSync(path.join(target, AW3_MARKER_REL)), 'a marker records the import');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the import is idempotent and never overwrites data already in the destination', () => {
  const root = tempRoot();
  try {
    const aw3 = seedAw3(root);
    const target = path.join(root, 'Achievement Watcher Next');

    migrateAw3UserData(target, { aw3Dir: aw3, skipRegistry: true });
    write(path.join(target, 'cfg', 'options.ini'), '[general]\ntheme=light\n');

    // Second run: the destination is initialized, so nothing is touched.
    assert.equal(migrateAw3UserData(target, { aw3Dir: aw3, skipRegistry: true }), null);
    assert.equal(fs.readFileSync(path.join(target, 'cfg', 'options.ini'), 'utf8'), '[general]\ntheme=light\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a destination that already holds settings is left completely alone', () => {
  const root = tempRoot();
  try {
    const aw3 = seedAw3(root);
    const target = path.join(root, 'Achievement Watcher Next');
    write(path.join(target, 'cfg', 'options.ini'), '[general]\ntheme=nord\n');

    assert.equal(migrateAw3UserData(target, { aw3Dir: aw3, skipRegistry: true }), null);
    assert.equal(fs.existsSync(path.join(target, 'covers', '440.jpg')), false, 'an initialized profile must not be back-filled');
    assert.equal(fs.readFileSync(path.join(target, 'cfg', 'options.ini'), 'utf8'), '[general]\ntheme=nord\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing or identical source is a no-op rather than an error', () => {
  const root = tempRoot();
  try {
    const target = path.join(root, 'Achievement Watcher Next');
    assert.equal(migrateAw3UserData(target, { aw3Dir: path.join(root, 'absent'), skipRegistry: true }), null);
    assert.equal(migrateAw3UserData(target, { aw3Dir: target, skipRegistry: true }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('souvenirs move to the new default folder only when the user never chose one', () => {
  const root = tempRoot();
  try {
    const userData = path.join(root, 'userData');
    write(path.join(userData, 'cfg', 'options.ini'), '[souvenir]\nscreenshot=true\ndir=\n');
    const from = path.join(root, 'Pictures', 'Achievement Watcher');
    const to = path.join(root, 'Pictures', 'Achievement Watcher Next');
    write(path.join(from, 'Hollow Knight', 'shot.png'), 'PNG');

    assert.equal(migrateSouvenirFolder(userData, { fromDir: from, toDir: to }), from);
    assert.ok(fs.existsSync(path.join(to, 'Hollow Knight', 'shot.png')), 'existing shots must appear in the new folder');
    assert.ok(fs.existsSync(path.join(from, 'Hollow Knight', 'shot.png')), 'the original shots must stay where they are');

    // Second run is a no-op thanks to the marker.
    assert.equal(migrateSouvenirFolder(userData, { fromDir: from, toDir: to }), null);
    assert.ok(fs.existsSync(path.join(userData, SOUVENIR_MARKER_REL)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a souvenir folder the user picked is never relocated', () => {
  const root = tempRoot();
  try {
    const userData = path.join(root, 'userData');
    const custom = path.join(root, 'Elsewhere', 'Shots');
    write(path.join(userData, 'cfg', 'options.ini'), `[souvenir]\nscreenshot=true\ndir=${custom}\n`);
    const from = path.join(root, 'Pictures', 'Achievement Watcher');
    const to = path.join(root, 'Pictures', 'Achievement Watcher Next');
    write(path.join(from, 'shot.png'), 'PNG');

    assert.equal(configuredSouvenirDir(userData), custom);
    assert.equal(migrateSouvenirFolder(userData, { fromDir: from, toDir: to }), null);
    assert.equal(fs.existsSync(to), false, 'a custom souvenir path must not be migrated anywhere');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
