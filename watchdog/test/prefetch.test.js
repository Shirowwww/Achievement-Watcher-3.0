'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { pathToFileURL } = require('url');
const prefetch = require('../notification/prefetch.js');

test('prefetch preserves existing local emulator icons', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prefetch-'));
  try {
    const icon = path.join(temp, 'achievement.png');
    fs.writeFileSync(icon, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(await prefetch(icon, 'TEST'), icon);
    assert.equal(await prefetch(pathToFileURL(icon).href, 'TEST'), icon);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
