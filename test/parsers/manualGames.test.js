'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const manualGames = require('../../app/parser/manualGames.js');

test('manual games keep a stable id and can be updated and removed', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-manual-games-'));
  try {
    manualGames.setUserDataPath(userData);
    const exe = path.join(userData, 'Games', 'Example', 'example.exe');
    const first = manualGames.upsert({ title: 'Example Game', exe, platform: 'PC' });
    const same = manualGames.upsert({ title: 'Example Game', exe, platform: 'Steam', storeAppId: '1234' });

    assert.match(first.id, /^manual-[0-9a-f]{12}$/);
    assert.equal(same.id, first.id);
    assert.deepEqual(manualGames.list(), [same]);
    assert.equal(manualGames.remove(first.id), true);
    assert.deepEqual(manualGames.list(), []);
    assert.equal(manualGames.remove(first.id), false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
