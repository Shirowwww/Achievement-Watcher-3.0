'use strict';

/*
  The notification-health store is written by one process and read by another, so the contract worth
  testing is the round trip: what the Watchdog records after a delivery is exactly what the app shows
  in Game Health. Both sides are exercised through their real modules, against a temp profile.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-notification-health-'));
process.env.AW_USER_DATA = USER_DATA;

const reader = require(path.join(__dirname, '..', '..', 'app', 'parser', 'notificationHealth.js'));
const writer = require(path.join(__dirname, '..', '..', 'watchdog', 'util', 'transportMemory.js'));
require(path.join(__dirname, '..', '..', 'watchdog', 'util', 'userData.js')).resetCache();
reader.setUserDataPath(USER_DATA);

test.beforeEach(() => {
  writer._reset();
  fs.rmSync(writer.file(), { force: true });
});

test.after(() => fs.rmSync(USER_DATA, { recursive: true, force: true }));

test('what the Watchdog recorded is what the app reads back', () => {
  writer.remember('480', { transport: 'toast', reason: 'fullscreen-hidden', outcome: 'fallback' });
  assert.deepEqual(
    { ...reader.forGame('480'), at: undefined },
    { transport: 'toast', reason: 'fullscreen-hidden', outcome: 'fallback', at: undefined }
  );
  assert.ok(reader.forGame('480').at > 0, 'the record must carry when it was observed');
});

// A game that has never fired a notification has nothing observed about it — the panel falls back to
// the configured mode rather than inventing a delivery that never happened.
test('an unknown game and an unreadable store both read as "nothing observed"', () => {
  assert.equal(reader.forGame('999999'), null);
  fs.mkdirSync(path.dirname(writer.file()), { recursive: true });
  fs.writeFileSync(writer.file(), '{ not json', 'utf8');
  assert.equal(reader.forGame('480'), null);
});

test('the newest answer for a game replaces the previous one', () => {
  const now = Date.now();
  writer.remember('480', { transport: 'overlay', reason: 'overlay', outcome: 'delivered', now: now - 60000 });
  writer.remember('480', { transport: 'toast', reason: 'overlay-failing', outcome: 'fallback', now });
  assert.equal(reader.forGame('480').transport, 'toast');
  assert.equal(writer.forGame('480'), 'toast');
});

// A burst unlock records the same answer for every achievement in it; rewriting the file each time
// would put a disk write on the notification path for no new information.
test('an unchanged answer is not rewritten, and a changed one always is', () => {
  const now = Date.now();
  assert.equal(writer.remember('480', { transport: 'overlay', reason: 'overlay', now }), true);
  assert.equal(writer.remember('480', { transport: 'overlay', reason: 'overlay', now: now + 500 }), false);
  assert.equal(writer.remember('480', { transport: 'toast', reason: 'fullscreen-hidden', now: now + 500 }), true);
});

test('a stale record is ignored rather than deciding anything years later', () => {
  writer.remember('480', { transport: 'toast', reason: 'fullscreen-hidden', now: Date.now() - writer.MAX_AGE_MS - 1 });
  assert.equal(writer.forGame('480'), null, 'the automatic tie-breaker must not act on an ancient observation');
});

test('the store stays small: the least recently played games drop out first', () => {
  const now = Date.now();
  for (let index = 0; index < writer.MAX_ENTRIES + 10; index += 1) {
    writer.remember(String(index), { transport: 'overlay', reason: 'overlay', now: now + index });
  }
  const games = JSON.parse(fs.readFileSync(writer.file(), 'utf8')).games;
  assert.equal(Object.keys(games).length, writer.MAX_ENTRIES);
  assert.equal(games['0'], undefined, 'the oldest record is the one that goes');
  assert.ok(games[String(writer.MAX_ENTRIES + 9)], 'the most recent record must survive');
});

test('a game with no id is never recorded', () => {
  assert.equal(writer.remember('', { transport: 'toast' }), false);
  assert.equal(writer.remember('480', { transport: '' }), false);
});
