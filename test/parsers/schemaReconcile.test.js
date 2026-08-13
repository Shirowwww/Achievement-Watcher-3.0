'use strict';

/*
  Steam never signals "this game's achievement list changed", so getGameData self-repairs a cached
  schema every 3 days (or on demand, via Settings > Advanced). reconcileAchievementList is the pure
  merge step: patches blanks, appends new achievements, never removes one.
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

test('reconcileAchievementList appends achievements missing from the cached list', () => {
  const list = [{ name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 0 }];
  const fresh = [
    { name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 0 },
    { name: 'ACH_2', displayName: 'Two (new DLC)', description: 'Second.', hidden: 0 },
  ];
  const { changed, addedCount } = steam.reconcileAchievementList(list, fresh);
  assert.equal(changed, true);
  assert.equal(addedCount, 1);
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'ACH_2');
});

test('reconcileAchievementList appends a duplicated fresh apiName only once', () => {
  const list = [{ name: 'ACH_1' }];
  const fresh = [{ name: 'ACH_2' }, { name: 'ach_2' }, { name: 'ACH_3' }];
  const { changed, addedCount } = steam.reconcileAchievementList(list, fresh);
  assert.equal(changed, true);
  assert.equal(addedCount, 2);
  assert.deepEqual(list.map((achievement) => achievement.name), ['ACH_1', 'ACH_2', 'ACH_3']);
});

test('reconcileAchievementList patches blank description/displayName/hidden by apiName', () => {
  const list = [{ name: 'ach_1', displayName: '', description: '', hidden: null }];
  const fresh = [{ name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 1 }];
  const { changed, addedCount } = steam.reconcileAchievementList(list, fresh);
  assert.equal(changed, true);
  assert.equal(addedCount, 0);
  assert.equal(list[0].description, 'First.');
  assert.equal(list[0].displayName, 'One');
  assert.equal(list[0].hidden, 1);
});

test('reconcileAchievementList never overwrites an already-filled field or removes an entry', () => {
  const list = [
    { name: 'ACH_1', displayName: 'Mine', description: 'Kept.', hidden: 0 },
    { name: 'ACH_2', displayName: 'Only Local', description: 'Still here.', hidden: 0 },
  ];
  // `fresh` is missing ACH_2 entirely (e.g. a short/rate-limited response) and disagrees with ACH_1.
  const fresh = [{ name: 'ACH_1', displayName: 'Theirs', description: 'Overwritten?', hidden: 1 }];
  const { changed } = steam.reconcileAchievementList(list, fresh);
  assert.equal(changed, false);
  assert.equal(list.length, 2, 'an entry missing from a short fresh response must never be dropped');
  assert.equal(list[0].description, 'Kept.', 'a non-blank field is never overwritten');
  assert.equal(list[1].name, 'ACH_2');
});

test('reconcileAchievementList treats an empty fresh list as "unreachable this cycle", not "no achievements"', () => {
  const list = [{ name: 'ACH_1', displayName: 'One', description: '', hidden: 0 }];
  const { changed, addedCount } = steam.reconcileAchievementList(list, []);
  assert.equal(changed, false);
  assert.equal(addedCount, 0);
  assert.equal(list.length, 1);
});

test('reconcileAchievementList tolerates non-array input', () => {
  assert.deepEqual(steam.reconcileAchievementList(null, [{ name: 'A' }]), { changed: false, addedCount: 0 });
  assert.deepEqual(steam.reconcileAchievementList([{ name: 'A' }], null), { changed: false, addedCount: 0 });
});

// Same network-outage simulation as emptySchemaRecheck.test.js.
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

test('an offline periodic self-repair keeps every cached achievement and still stamps the attempt', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-schema-reconcile-'));
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: temp });

  const schemaDir = path.join(temp, 'steam_cache', 'schema', 'english');
  fs.mkdirSync(schemaDir, { recursive: true });
  const record = {
    name: 'Portal 2',
    appid: '620',
    img: { header: 'h', background: 'b', portrait: 'p', icon: 'i' },
    achievement: { total: 1, list: [{ name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 0 }] },
  };
  fs.writeFileSync(path.join(schemaDir, '620.db'), JSON.stringify(record));

  const game = await offline(() => steam.getGameData({ appID: '620', lang: 'english', fastStart: false }));
  assert.ok(game, 'a cached game must survive an offline periodic self-repair attempt');
  assert.equal(game.achievement.list.length, 1, 'nothing is lost when the periodic re-check cannot reach the network');
  assert.equal(game.achievement.list[0].name, 'ACH_1');
  assert.ok(game.descBackfilledAt, 'the attempt is stamped even offline, so it does not retry every scan');
});

test('forceRecheck bypasses the 3-day cooldown even right after a previous check', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-schema-force-'));
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: temp });

  const schemaDir = path.join(temp, 'steam_cache', 'schema', 'english');
  fs.mkdirSync(schemaDir, { recursive: true });
  const record = {
    name: 'Portal 2',
    appid: '620',
    img: { header: 'h', background: 'b', portrait: 'p', icon: 'i' },
    // Checked one hour ago: well inside the 3-day cooldown, so a normal scan would skip the re-check.
    descBackfilledAt: Date.now() - 60 * 60 * 1000,
    achievement: { total: 1, list: [{ name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 0 }] },
  };
  const before = record.descBackfilledAt;
  fs.writeFileSync(path.join(schemaDir, '620.db'), JSON.stringify(record));

  const game = await offline(() => steam.getGameData({ appID: '620', lang: 'english', fastStart: false, forceRecheck: true }));
  assert.ok(game, 'a cached game must survive a forced, offline re-check attempt');
  assert.ok(game.descBackfilledAt > before, 'forceRecheck must re-attempt the check despite the recent stamp');
});

test('forceRecheck also bypasses fastStart, so "Check now" works on the first scan of a session', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-schema-force-fast-'));
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: temp });

  const schemaDir = path.join(temp, 'steam_cache', 'schema', 'english');
  fs.mkdirSync(schemaDir, { recursive: true });
  const record = {
    name: 'Portal 2',
    appid: '620',
    img: { header: 'h', background: 'b', portrait: 'p', icon: 'i' },
    achievement: { total: 1, list: [{ name: 'ACH_1', displayName: 'One', description: 'First.', hidden: 0 }] },
  };
  fs.writeFileSync(path.join(schemaDir, '620.db'), JSON.stringify(record));

  const game = await offline(() => steam.getGameData({ appID: '620', lang: 'english', fastStart: true, forceRecheck: true }));
  assert.ok(game, 'a cached game must survive the forced first-scan re-check');
  assert.ok(game.descBackfilledAt, 'fastStart must not suppress an explicit force re-check');
});
