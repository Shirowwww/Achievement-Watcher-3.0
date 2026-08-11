'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
