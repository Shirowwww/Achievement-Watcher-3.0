'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrateAw3UserData, migrateSouvenirFolder, retargetBackupIndex, configuredSouvenirDir, AW3_MARKER_REL, SOUVENIR_MARKER_REL } = require('../../app/util/migrateUserData.js');

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

test('an interrupted import resumes without rolling newer files back', () => {
  // A first run that died partway (power loss, antivirus, a locked file) leaves files in the
  // destination but no marker and no cfg/options.ini, so the next launch legitimately runs the
  // import again. Anything already in the destination is the newer copy - the app may have written
  // it since - and must survive the resume untouched.
  const root = tempRoot();
  try {
    const aw3 = seedAw3(root);
    const target = path.join(root, 'Achievement Watcher Next');

    write(path.join(target, 'covers', '440.jpg'), 'NEWER-JPG');
    write(path.join(target, 'logs', 'parser.log'), 'newer log line');
    assert.equal(fs.existsSync(path.join(target, 'cfg', 'options.ini')), false, 'the interrupted run never reached the config');

    assert.equal(migrateAw3UserData(target, { aw3Dir: aw3, skipRegistry: true }), aw3, 'the resume must run');

    assert.equal(fs.readFileSync(path.join(target, 'covers', '440.jpg'), 'utf8'), 'NEWER-JPG', 'an already-placed file must not be overwritten by the older source');
    assert.equal(fs.readFileSync(path.join(target, 'logs', 'parser.log'), 'utf8'), 'newer log line', 'a linked tree must not clobber the destination either');
    assert.ok(fs.existsSync(path.join(target, 'cfg', 'options.ini')), 'what the interrupted run missed must be filled in');
    assert.ok(fs.existsSync(path.join(target, 'epic_tokens.enc')), 'loose state files must be filled in too');
    assert.ok(fs.existsSync(path.join(target, AW3_MARKER_REL)), 'the completed resume records its marker');
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

/*
  The restore-point index. `backups/` migrates like any other folder, but each entry records an
  absolute backupDir, and copying a file does not rewrite what is inside it - so every entry kept
  naming the folder it came from. That looks fine while the old folder is still on disk, and the
  uninstaller deletes it outright.
*/
test('migrated restore points are repointed at the folder that now holds them', () => {
  const root = tempRoot();
  try {
    const userData = path.join(root, 'userData');
    const oldRoot = path.join(root, 'Achievement Watcher 3.0', 'backups', 'gbe');
    const newRoot = path.join(userData, 'backups', 'gbe');

    // Two restore points carried across, plus one whose files are not here at all.
    for (const name of ['Game A - GBE backup - 2026-06-29T11-44-23-679Z', 'Game B - GBE backup - 2026-07-01T09-00-00-000Z']) {
      write(path.join(oldRoot, name, 'backup.json'), '{}');
      write(path.join(newRoot, name, 'backup.json'), '{}');
    }
    const orphan = path.join(root, 'Somewhere Else', 'Game C - GBE backup');
    write(path.join(orphan, 'backup.json'), '{}');

    write(
      path.join(userData, 'cfg', 'gbe-backups.db'),
      JSON.stringify([
        { appid: '1', gameDir: 'C:\Jeux\A', backupDir: path.join(oldRoot, 'Game A - GBE backup - 2026-06-29T11-44-23-679Z') },
        { appid: '2', gameDir: 'C:\Jeux\B', backupDir: path.join(oldRoot, 'Game B - GBE backup - 2026-07-01T09-00-00-000Z') },
        { appid: '3', gameDir: 'C:\Jeux\C', backupDir: orphan },
      ])
    );

    assert.equal(retargetBackupIndex(userData), 2, 'both carried-across restore points must be repointed');

    const entries = JSON.parse(fs.readFileSync(path.join(userData, 'cfg', 'gbe-backups.db'), 'utf8'));
    assert.equal(path.dirname(entries[0].backupDir), newRoot);
    assert.equal(path.dirname(entries[1].backupDir), newRoot);
    for (const entry of entries) assert.ok(fs.existsSync(entry.backupDir), `${entry.appid}: the recorded path must exist`);

    // An entry this cannot vouch for keeps the path it had rather than being repointed at nothing.
    assert.equal(entries[2].backupDir, orphan, 'an unknown backup must be left alone');

    // Re-running changes nothing: the entries already live here.
    assert.equal(retargetBackupIndex(userData), 0, 'the repoint must be idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing or unreadable restore-point index never stops startup', () => {
  const root = tempRoot();
  try {
    const userData = path.join(root, 'userData');
    assert.equal(retargetBackupIndex(userData), 0, 'no index at all is fine');
    write(path.join(userData, 'cfg', 'gbe-backups.db'), 'not json');
    assert.equal(retargetBackupIndex(userData), 0, 'a corrupt index must be survivable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
