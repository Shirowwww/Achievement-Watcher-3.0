'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadJsonArrayCached, lookupSteamDbName } = require('../app/util/gameNameCache.js');

(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-cache-'));
  try {
    const dump = path.join(tmp, 'appList.json');
    fs.writeFileSync(dump, JSON.stringify([
      { appid: 10, name: 'Counter-Strike' },
      { appid: 1145360, name: 'Hades' },
      { appid: 999, name: '' }, // blank names must not resolve
    ]));

    // basic lookup, number or string appid
    assert.equal(lookupSteamDbName(1145360, { runtimePath: dump }), 'Hades');
    assert.equal(lookupSteamDbName('10', { runtimePath: dump }), 'Counter-Strike');
    assert.equal(lookupSteamDbName(999, { runtimePath: dump }), null);
    assert.equal(lookupSteamDbName(42424242, { runtimePath: dump }), null);
    assert.equal(lookupSteamDbName('', { runtimePath: dump }), null);

    // missing/corrupt sources return empty results, never throw
    assert.equal(lookupSteamDbName(10, { runtimePath: path.join(tmp, 'nope.json'), fallbackPath: path.join(tmp, 'nope2.json') }), null);
    const corrupt = path.join(tmp, 'corrupt.json');
    fs.writeFileSync(corrupt, '{not json');
    assert.deepEqual(loadJsonArrayCached(corrupt), []);
    const nonArray = path.join(tmp, 'obj.json');
    fs.writeFileSync(nonArray, '{"appid":10}');
    assert.deepEqual(loadJsonArrayCached(nonArray), []);

    // runtime steamdb.json takes precedence over the appList fallback
    const override = path.join(tmp, 'steamdb.json');
    fs.writeFileSync(override, JSON.stringify([{ appid: 10, name: 'Renamed CS' }]));
    assert.equal(lookupSteamDbName(10, { runtimePath: override, fallbackPath: dump }), 'Renamed CS');
    // …but a missing runtime file falls back
    assert.equal(lookupSteamDbName(10, { runtimePath: path.join(tmp, 'ghost.json'), fallbackPath: dump }), 'Counter-Strike');

    // the mtime+size cache revalidates when the file changes
    const first = loadJsonArrayCached(dump);
    assert.equal(loadJsonArrayCached(dump), first, 'unchanged file must return the cached array');
    const future = new Date(Date.now() + 5000);
    fs.writeFileSync(dump, JSON.stringify([{ appid: 10, name: 'CS 2' }]));
    fs.utimesSync(dump, future, future); // force a distinct mtime even on coarse filesystems
    assert.equal(lookupSteamDbName(10, { runtimePath: dump }), 'CS 2');

    console.log('PASS: gameNameCache offline lookup + mtime/size revalidation');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
