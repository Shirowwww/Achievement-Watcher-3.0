'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manualUnlock = require('../app/parser/manualUnlock.js');

function makeGame(list) {
  return {
    appid: '123',
    source: 'steamEmu',
    achievement: {
      total: list.length,
      unlocked: list.filter((a) => a.Achieved).length,
      list,
    },
  };
}

test('manual unlock marks a locked achievement and updates counters', () => {
  const game = makeGame([
    { name: 'ach_a', Achieved: false },
    { name: 'ach_b', Achieved: true, UnlockTime: 111 },
  ]);
  const map = {};
  const { map: next, changed } = manualUnlock.update(map, '123', 'steamEmu', 'ach_a', 'mark-unlocked', 222);
  assert.equal(changed, true);
  assert.equal(next['123::steamEmu'].ach_a.manual, true);

  const applied = manualUnlock.applyToGame(game, next, '123', 'steamEmu');
  assert.ok(applied >= 1);
  assert.equal(game.achievement.list[0].Achieved, true);
  assert.equal(game.achievement.list[0].UnlockTime, 222);
  assert.equal(game.achievement.list[0].manual, true);
  assert.equal(game.achievement.unlocked, 2);
  // A real unlock keeps its own timestamp and is not downgraded.
  assert.equal(game.achievement.list[1].UnlockTime, 111);
});

test('clear manual unlock only removes the override, keeping real save unlocks', () => {
  const game = makeGame([
    { name: 'ach_a', Achieved: true, UnlockTime: 222, manual: true },
    { name: 'ach_b', Achieved: true, UnlockTime: 111 },
  ]);
  let map = { '123::steamEmu': { ach_a: { earned_time: 222, manual: true } } };

  const { map: cleared, changed } = manualUnlock.update(map, '123', 'steamEmu', 'ach_a', 'clear-manual');
  assert.equal(changed, true);
  assert.equal(cleared['123::steamEmu'], undefined);

  map = cleared;
  const applied = manualUnlock.applyToGame(game, map, '123', 'steamEmu');
  assert.equal(applied, 1); // the stale manual marker is removed, one cleanup change
  assert.equal(game.achievement.list[0].Achieved, true); // underlying save unlock survives
  assert.equal(game.achievement.list[0].manual, undefined);
  assert.equal(game.achievement.unlocked, 2);
});

test('sidecar persists across mark and read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-manual-'));
  const file = path.join(dir, 'cfg/manual-unlocks.json');
  const map = {};
  const { map: next } = manualUnlock.update(map, '456', 'gog', 'x', 'mark-unlocked', 333);
  manualUnlock.writeMap(file, next);
  const loaded = manualUnlock.readMap(file);
  assert.equal(loaded['456::gog'].x.earned_time, 333);
});

test('unknown action or empty name is a no-op', () => {
  const map = {};
  assert.equal(manualUnlock.update(map, '1', 's', '', 'mark-unlocked').changed, false);
  assert.equal(manualUnlock.update(map, '1', 's', 'x', 'bogus').changed, false);
  assert.deepEqual(map, {});
});
