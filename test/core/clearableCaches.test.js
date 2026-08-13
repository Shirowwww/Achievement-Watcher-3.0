'use strict';

// The one thing this module must never get wrong: deleting a userData folder that isn't a pure,
// re-fetchable cache. This test builds a real userData tree with both safe caches and the known
// irreplaceable folders side by side (including cache/uplayR2, the exact user-seeded folder called
// out in util/migrateUserData.js), runs the real clearSafeCaches() against it on a real filesystem,
// and asserts the dangerous ones are still there, untouched, afterward.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const test = require('node:test');
const { SAFE_CACHE_DIRS, clearSafeCaches } = require('../../app/util/clearableCaches.js');
const coverStore = require('../../app/util/coverStore.js');

function makeUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-userdata-'));
}

function seedFile(root, rel) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
}

test('clearSafeCaches removes every allowlisted folder that exists and reports which ones', async () => {
  const root = makeUserDataDir();
  try {
    for (const rel of SAFE_CACHE_DIRS) seedFile(root, path.join(rel, 'sentinel.txt'));

    const cleared = await clearSafeCaches(root);

    assert.deepEqual([...cleared].sort(), [...SAFE_CACHE_DIRS].sort());
    for (const rel of SAFE_CACHE_DIRS) {
      assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} should be gone`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearSafeCaches never touches the user-seeded Uplay R2 loader cache', async () => {
  const root = makeUserDataDir();
  try {
    seedFile(root, path.join('cache', 'uplayR2', 'demde-loader64.dll'));
    seedFile(root, path.join('steam_cache', 'schema', 'irrelevant.db'));

    await clearSafeCaches(root);

    assert.ok(
      fs.existsSync(path.join(root, 'cache', 'uplayR2', 'demde-loader64.dll')),
      'cache/uplayR2 has no public download source and must survive'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearSafeCaches never touches backups, settings, custom covers, presets or theme images', async () => {
  const root = makeUserDataDir();
  try {
    const guarded = [
      path.join('backups', 'gbe', 'somegame', 'achievements.json.bak'),
      path.join('cfg', 'options.ini'),
      path.join('cfg', 'gameIndex.json'),
      path.join('cfg', 'manual-unlocks.json'),
      path.join('covers', '480.jpg'),
      path.join('presets', 'Users Presets', 'mypreset.json'),
      path.join('theme-images', 'bg-my-custom-background.png'),
      'epic_tokens.enc',
      'lockfile',
    ];
    for (const rel of guarded) seedFile(root, rel);
    for (const rel of SAFE_CACHE_DIRS) seedFile(root, path.join(rel, 'sentinel.txt'));

    await clearSafeCaches(root);

    for (const rel of guarded) {
      assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must survive a cache clear`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearSafeCaches promotes a custom cached cover before deleting steam_cache', async () => {
  const root = makeUserDataDir();
  try {
    const cached = path.join(root, 'steam_cache', 'icon', '480', 'header.jpg');
    seedFile(root, path.relative(root, cached));
    const database = path.join(root, 'cfg', 'covers.db');
    fs.mkdirSync(path.dirname(database), { recursive: true });
    fs.writeFileSync(database, JSON.stringify({ 480: pathToFileURL(cached).href }), 'utf8');
    // Reproduce the renderer having loaded covers.db before the main process clears caches.
    coverStore.setStoreFile(database);
    assert.equal(coverStore.get('480'), pathToFileURL(cached).href);

    await clearSafeCaches(root);

    // A refresh reloads the externally changed database and must see the promoted durable path,
    // not its stale in-memory cache reference.
    const durable = fileURLToPath(coverStore.get('480'));
    assert.equal(fs.existsSync(cached), false, 'the disposable cache should still be cleared');
    assert.equal(path.dirname(durable), path.join(root, 'covers'));
    assert.equal(fs.existsSync(durable), true, 'the selected cover must survive in durable storage');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearSafeCaches is a no-op-safe when userData has no caches at all yet', async () => {
  const root = makeUserDataDir();
  try {
    const cleared = await clearSafeCaches(root);
    assert.deepEqual(cleared, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
