'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const epic = require('../app/parser/epic.js');
const request = require('../app/node_modules/request-zero');

test('legacy Epic discovery reads mapped ids first and preserves uncached ids during an outage', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-epic-scan-cache-'));
  const previousAppData = process.env.APPDATA;
  const realGet = request.get;

  try {
    process.env.APPDATA = temp;
    epic.setUserDataPath(temp);
    epic._internal.resetProductMappingCache();

    const root = path.join(temp, 'NemirtingasEpicEmu', 'account');
    fs.mkdirSync(path.join(root, 'CACHED'), { recursive: true });
    const cacheDir = path.join(temp, 'steam_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'epic.db');
    fs.writeFileSync(cacheFile, JSON.stringify([{ epicid: 'CACHED', steamid: '12345' }]));

    let requests = 0;
    request.get = async () => {
      requests += 1;
      throw new Error('offline');
    };

    const cachedOnly = await epic.scan();
    assert.deepEqual(cachedOnly.map((game) => [game.appid, game.steamappid]), [['CACHED', '12345']]);
    assert.equal(requests, 0, 'a fully mapped cache must not download Epic productmapping');

    fs.mkdirSync(path.join(root, 'UNMAPPED'), { recursive: true });
    epic._internal.resetProductMappingCache();
    const outage = await epic.scan();
    assert.deepEqual(
      outage.map((game) => game.appid).sort(),
      ['CACHED', 'UNMAPPED'],
      'an endpoint outage must not make either cached or new local saves disappear'
    );
    assert.equal(requests, 1, 'only the unmapped artifact triggers one productmapping request');
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), [{ epicid: 'CACHED', steamid: '12345' }]);
  } finally {
    request.get = realGet;
    epic._internal.resetProductMappingCache();
    process.env.APPDATA = previousAppData;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
