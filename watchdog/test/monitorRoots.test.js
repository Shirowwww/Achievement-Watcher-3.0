'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const monitor = require('../monitor.js');

test('built-in watch roots include the RLD! and CreamAPI emulator saves', async (t) => {
  if (process.platform !== 'win32' || !process.env.Public || !process.env.APPDATA) {
    return t.skip('Windows-only watch roots');
  }
  const folders = await monitor.getFolders([]);
  const dirs = folders.map((entry) => String(entry.dir || '').toLowerCase());
  const has = (target) => dirs.includes(String(target).toLowerCase());

  assert.equal(
    has(path.join(process.env.Public, 'Documents', 'Steam', 'RLD!')),
    true,
    'Public Documents Steam RLD! root must be watched',
  );
  assert.equal(
    has(path.join(process.env.APPDATA, 'Steam', 'RLD!')),
    true,
    'AppData Steam RLD! root must be watched',
  );
  assert.equal(
    has(path.join(process.env.APPDATA, 'CreamAPI')),
    true,
    'AppData CreamAPI root must be watched',
  );
});

test('a configured folder that repeats a built-in root is watched once, on the built-in options', async (t) => {
  if (process.platform !== 'win32' || !process.env.APPDATA) return t.skip('Windows-only watch roots');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-monitor-dup-'));
  try {
    // userDir.js seeds userdir.db with exactly these roots, so the app's own detector produced this.
    const root = path.join(process.env.APPDATA, 'Goldberg UplayEmu Saves');
    const config = path.join(tmp, 'userdir.db');
    fs.writeFileSync(config, JSON.stringify([{ path: root, notify: true, origin: 'auto', enabled: true }]), 'utf8');

    const folders = await monitor.getFolders(config);
    const matching = folders.filter((entry) => path.resolve(String(entry.dir || '')).toLowerCase() === path.resolve(root).toLowerCase());

    assert.equal(matching.length, 1, 'a duplicated root must yield exactly one watcher');
    // The generic configured-dir entry carries no uplayR2 flag; losing it would feed Ubisoft
    // product ids into the Steam lookup path.
    assert.equal(matching[0].options.uplayR2, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a disabled configured folder is excluded from Watchdog roots', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-monitor-disabled-'));
  try {
    const custom = path.join(tmp, 'custom-saves');
    const config = path.join(tmp, 'userdir.db');
    fs.mkdirSync(custom, { recursive: true });
    fs.writeFileSync(config, JSON.stringify([{ path: custom, notify: true, enabled: false }]), 'utf8');
    const dirs = (await monitor.getFolders(config)).map((entry) => path.resolve(String(entry.dir || '')).toLowerCase());
    assert.equal(dirs.includes(path.resolve(custom).toLowerCase()), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
