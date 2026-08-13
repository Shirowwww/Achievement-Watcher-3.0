'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const libraryDirs = require('../../app/parser/libraryDirs.js');
const userDir = require('../../app/parser/userDir.js');

test('folder stores preserve provenance while disabled sources stay out of scans', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-folder-sources-'));
  try {
    await libraryDirs.setUserDataPath(userData);
    await userDir.setUserDataPath(userData);
    assert.deepEqual(await libraryDirs.getEntries(), [], 'a missing store must not seed invisible default folders');
    await libraryDirs.save([
      { path: 'D:\\Games', origin: 'manual', enabled: true },
      { path: 'E:\\Jeux', origin: 'auto', detector: 'Smart Find', enabled: false },
    ]);
    await userDir.save([
      { path: 'D:\\Saves', origin: 'manual', enabled: true, notify: true },
      { path: 'E:\\Saves', origin: 'auto', detector: 'Known achievement-data location', enabled: false, notify: true },
    ]);

    assert.deepEqual(await libraryDirs.get(), ['D:\\Games']);
    assert.equal((await libraryDirs.getEntries())[1].origin, 'auto');
    assert.deepEqual((await userDir.get()).map((entry) => entry.path), ['D:\\Saves']);
    assert.equal((await userDir.getEntries())[1].enabled, false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
