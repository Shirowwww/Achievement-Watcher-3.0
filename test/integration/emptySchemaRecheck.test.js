'use strict';

/*
  A schema cached with a name but zero achievements used to be permanent: getCachedData has no TTL
  and getGameData only tested `name`, so an entry written by a fetch that reached the store page but
  not the schema stayed empty forever. Every scan then fell back to getLocalAchievementSchema, which
  walks the whole install synchronously — that is what turned a 4s scan into 13-34s.

  The re-check must never cost the entry itself: offline, the retry fails for EVERY appid, and
  dropping the record there would empty the game list on a single offline scan.
*/

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const steam = require('../../app/parser/steam.js');

// Run something with every outbound lookup failing the way a real outage makes it fail.
async function offline(run) {
  const err = () => Object.assign(new Error('getaddrinfo ENOTFOUND (simulated)'), { code: 'ENOTFOUND' });
  const saved = [
    [http, 'request', http.request],
    [http, 'get', http.get],
    [https, 'request', https.request],
    [https, 'get', https.get],
    [dns, 'lookup', dns.lookup],
  ];
  for (const [mod, name, real] of saved) {
    if (name === 'lookup') {
      mod[name] = (host, opts, cb) => process.nextTick(() => (typeof opts === 'function' ? opts : cb)(err()));
    } else {
      mod[name] = (...args) => {
        const req = real.apply(mod, args);
        process.nextTick(() => req.destroy(err()));
        return req;
      };
    }
  }
  try {
    return await run();
  } finally {
    for (const [mod, name, real] of saved) mod[name] = real;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const emptyRecord = (extra = {}) => ({ name: 'The Jackbox Party Pack 7', appid: '1211630', achievement: { total: 0, list: [] }, ...extra });

test('an empty cached schema is stale until a check is stamped on it', () => {
  assert.equal(steam.isStaleEmptySchema(emptyRecord()), true);

  // Stamped recently: a game that genuinely has no achievements (UNDERTALE) must not be re-fetched
  // once per scan for the rest of time.
  assert.equal(steam.isStaleEmptySchema(emptyRecord({ emptyCheckedAt: Date.now() - DAY })), false);

  // The stamp expires, so a game that gains achievements later is still picked up.
  assert.equal(steam.isStaleEmptySchema(emptyRecord({ emptyCheckedAt: Date.now() - 8 * DAY })), true);
});

test('anything that is not an ambiguous empty entry is left alone', () => {
  // A populated schema is the normal cache hit — re-fetching it would undo the cache entirely.
  assert.equal(steam.isStaleEmptySchema({ name: 'Big Walk', achievement: { total: 1, list: [{ name: 'ACH' }] } }), false);
  // No name: already handled by the existing miss path, not ours to claim.
  assert.equal(steam.isStaleEmptySchema({ achievement: { total: 0, list: [] } }), false);
  // Shapes saveGameToCache never writes must fail closed (no extra network), never open.
  assert.equal(steam.isStaleEmptySchema({ name: 'x' }), false);
  assert.equal(steam.isStaleEmptySchema({ name: 'x', achievement: { list: null } }), false);
  assert.equal(steam.isStaleEmptySchema(null), false);
  assert.equal(steam.isStaleEmptySchema(), false);
  // A garbage stamp is not a check.
  assert.equal(steam.isStaleEmptySchema(emptyRecord({ emptyCheckedAt: 'soon' })), true);
});

test('a re-check that cannot run hands back the cached entry instead of dropping the game', async () => {
  // The one branch that reaches a verdict with no network: the appid is in the negative cache, so
  // getGameData returns without fetching. Before the fix it returned undefined here — which is the
  // game vanishing from the list — even though a perfectly usable record was on disk.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-empty-schema-'));
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: temp });

  const schemaDir = path.join(temp, 'steam_cache', 'schema', 'english');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, '1211630.db'), JSON.stringify(emptyRecord()));
  fs.writeFileSync(path.join(temp, 'steam_cache', 'unresolved.json'), JSON.stringify({ 1211630: Date.now() }));

  const game = await steam.getGameData({ appID: '1211630', lang: 'english' });
  assert.ok(game, 'the cached record must survive a re-check that could not run');
  assert.equal(game.name, 'The Jackbox Party Pack 7');
  assert.equal(game.emptyCheckedAt, undefined, 'nothing was verified, so nothing may be stamped');
});

test('an offline re-check keeps the game, even though the lookups throw', async () => {
  /*
    The regression this pins was found by running the real scan with the network cut: offline the
    lookups do not return empty, they THROW, and the throw escaped the guard above — so every
    re-checked game was dropped at once. A real library went from 19 games to 8.
  */
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-empty-offline-'));
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: temp });

  const schemaDir = path.join(temp, 'steam_cache', 'schema', 'english');
  fs.mkdirSync(schemaDir, { recursive: true });
  const record = emptyRecord();
  fs.writeFileSync(path.join(schemaDir, '1211630.db'), JSON.stringify(record));

  const game = await offline(() => steam.getGameData({ appID: '1211630', lang: 'english' }));
  assert.ok(game, 'an offline scan must not drop a game it has a cached record for');
  assert.equal(game.name, 'The Jackbox Party Pack 7');
  assert.equal(game.emptyCheckedAt, undefined, 'a failed lookup is not a verification');

  // The record on disk must be intact, and no appid may be blacklisted by an outage.
  const onDisk = JSON.parse(fs.readFileSync(path.join(schemaDir, '1211630.db'), 'utf8'));
  assert.deepEqual(onDisk, record);
  const negative = path.join(temp, 'steam_cache', 'unresolved.json');
  const blacklisted = fs.existsSync(negative) ? Object.keys(JSON.parse(fs.readFileSync(negative, 'utf8'))) : [];
  assert.deepEqual(blacklisted, [], 'an outage is not evidence that an appid does not exist');
});
