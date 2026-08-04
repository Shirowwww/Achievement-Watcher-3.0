'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const track = require('../track.js');
const fsAsync = require('../util/fsAsync.js');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-track-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('save creates the missing cache directory and round-trips through load (issue #5)', async (t) => {
  const root = tempDir(t);
  // Reproduces the reported failure: the steam_cache/data directory does not exist yet, so the old
  // code threw ENOENT on writeFile and the baseline never persisted.
  const dataDir = path.join(root, 'Achievement Watcher', 'steam_cache', 'data');
  track.setCacheDir(dataDir);

  const achievements = [
    { name: 'Burning Chrome', Achieved: 1, UnlockTime: 1000 },
    { name: 'From Zero To Hero', Achieved: 1, UnlockTime: 2000 },
    { name: 'Locked', Achieved: 0 },
  ];

  await track.save('2592160', achievements);

  assert.equal(fs.existsSync(path.join(dataDir, '2592160.db')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, '2592160.db'), 'utf8')), achievements);
  assert.deepEqual(await track.load('2592160'), achievements);
});

test('load returns [] when the cache directory or baseline file is missing', async (t) => {
  const root = tempDir(t);
  track.setCacheDir(path.join(root, 'never-created'));

  assert.deepEqual(await track.load('123'), []);
});

test('load tolerates corrupted or non-array baseline files', async (t) => {
  const root = tempDir(t);
  const dataDir = path.join(root, 'data');
  track.setCacheDir(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, '1.db'), '{not json');
  assert.deepEqual(await track.load('1'), []);

  fs.writeFileSync(path.join(dataDir, '2.db'), '{"name":"not-an-array"}');
  assert.deepEqual(await track.load('2'), []);
});

test('a failed disk write keeps the in-memory baseline so the next scan is not a first observation', async (t) => {
  const root = tempDir(t);
  // A regular file as a parent makes mkdir/writeFile fail, simulating a disk/ACL/antivirus error
  // that can still happen after the missing-directory fix.
  const blocker = path.join(root, 'blocker');
  fs.writeFileSync(blocker, 'i am a file, not a directory');
  track.setCacheDir(path.join(blocker, 'data'));

  const achievements = [{ name: 'Burning Chrome', Achieved: 1, UnlockTime: 1000 }];
  await assert.rejects(track.save('2592160', achievements));

  // Without the in-memory fallback this would be [] and watchdog.js would seed/notify again.
  assert.deepEqual(await track.load('2592160'), achievements);
});

test('concurrent saves serialize and leave one complete loadable snapshot without temp leftovers', async (t) => {
  const root = tempDir(t);
  track.setCacheDir(path.join(root, 'data'));

  const first = [{ name: 'A', Achieved: 1 }];
  const second = [
    { name: 'A', Achieved: 1 },
    { name: 'B', Achieved: 1 },
    { name: 'C', Achieved: 1 },
  ];

  await Promise.all([track.save('1', first), track.save('1', second)]);

  const loaded = await track.load('1');
  const complete = JSON.stringify(first) === JSON.stringify(loaded) || JSON.stringify(second) === JSON.stringify(loaded);
  assert.equal(complete, true, 'baseline must be one complete snapshot, not an interleaved mix');
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')).sort(), ['1.db']);
});

test('falls back to an in-place write when the atomic rename fails (Windows open-file race)', async (t) => {
  const root = tempDir(t);
  track.setCacheDir(path.join(root, 'data'));

  const originalRename = fsAsync.rename;
  fsAsync.rename = async () => {
    const err = new Error('simulated EPERM: destination is open');
    err.code = 'EPERM';
    throw err;
  };
  t.after(() => {
    fsAsync.rename = originalRename;
  });

  const achievements = [{ name: 'Burning Chrome', Achieved: 1, UnlockTime: 1000 }];
  await track.save('2592160', achievements); // must not throw

  assert.deepEqual(await track.load('2592160'), achievements);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data', '2592160.db'), 'utf8')), achievements);
  assert.equal(fs.existsSync(path.join(root, 'data', '2592160.db.tmp')), false, 'temp file should be cleaned up after the fallback');
});
