'use strict';

// Exercises the real recovery mechanism end to end: the actual electron-updater
// DownloadedUpdateHelper class (no mock) against a real temp directory seeded to look like a
// corrupted differential-download cache, run through our own clearUpdaterCacheDir(). This is the
// exact object autoUpdater.getOrCreateDownloadHelper() hands back at runtime.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { DownloadedUpdateHelper } = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'electron-updater', 'out', 'DownloadedUpdateHelper.js'));
const { clearUpdaterCacheDir } = require('../../app/util/updateCacheClear.js');

function makeTempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-update-cache-'));
}

test('clearUpdaterCacheDir removes a corrupted differential-download base and the pending/ folder', async () => {
  const cacheDir = makeTempCacheDir();
  try {
    // Simulate exactly what a stuck cache looks like: a differential-download base installer +
    // its blockmap sitting directly under cacheDir, and a stale pending/ download with its
    // update-info.json (what getValidCachedUpdateFile() reads on the next check).
    fs.writeFileSync(path.join(cacheDir, 'installer.exe'), 'corrupted base installer bytes');
    fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), 'stale blockmap');
    const pendingDir = path.join(cacheDir, 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'Achievement.Watcher.Setup.3.8.5.exe'), 'partial/corrupt download');
    fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({ fileName: 'Achievement.Watcher.Setup.3.8.5.exe', sha512: 'deadbeef' }));

    assert.ok(fs.existsSync(path.join(cacheDir, 'installer.exe')), 'sanity: base file was seeded');
    assert.ok(fs.readdirSync(pendingDir).length === 2, 'sanity: pending/ was seeded');

    const helper = new DownloadedUpdateHelper(cacheDir);
    const returnedDir = await clearUpdaterCacheDir(helper);

    assert.equal(returnedDir, cacheDir);
    // fs.promises.rm(recursive) removes the directory itself along with its contents; the next
    // download simply recreates it (electron-updater always mkdir({recursive:true}) before use).
    assert.equal(fs.existsSync(cacheDir), false, 'the whole cache directory, base file and pending/ are gone');

    // The exact scenario from the issue: a future check must no longer see a poisoned cache.
    const freshHelper = new DownloadedUpdateHelper(cacheDir);
    const cached = await freshHelper.getValidCachedUpdateFile(
      { info: { sha512: 'anything' } },
      { info: () => {}, warn: () => {} }
    );
    assert.equal(cached, null, 'a future validation finds nothing left to (mis)trust');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('clearUpdaterCacheDir is a no-op-safe when the cache directory does not exist yet', async () => {
  const parent = makeTempCacheDir();
  const cacheDir = path.join(parent, 'never-created');
  try {
    const helper = new DownloadedUpdateHelper(cacheDir);
    const returnedDir = await clearUpdaterCacheDir(helper);
    assert.equal(returnedDir, cacheDir);
    assert.equal(fs.existsSync(cacheDir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('clearUpdaterCacheDir resets the helper in-memory state (never re-offers a wiped file)', async () => {
  const cacheDir = makeTempCacheDir();
  try {
    const pendingDir = path.join(cacheDir, 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    const updateFile = path.join(pendingDir, 'Achievement.Watcher.Setup.3.8.5.exe');
    fs.writeFileSync(updateFile, 'bytes');

    const helper = new DownloadedUpdateHelper(cacheDir);
    // Simulate a prior successful in-memory record of "we already have this file" - the exact
    // state validateDownloadedPath() would trust without clear() resetting it first.
    helper._file = updateFile;
    helper.versionInfo = { version: '3.8.5' };
    helper.fileInfo = { info: { sha512: 'deadbeef' } };

    await clearUpdaterCacheDir(helper);

    assert.equal(helper.file, null);
    assert.equal(helper.versionInfo, null);
    assert.equal(helper.fileInfo, null);
    assert.equal(fs.existsSync(updateFile), false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
