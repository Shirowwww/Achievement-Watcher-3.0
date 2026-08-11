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

/*
  Clearing a manual unlock has to take the unlock back, or the library keeps counting it.

  applyToGame used to only drop the `manual` marker and leave Achieved true, so the achievement
  stayed unlocked (and the game's percentage stayed up) until the next full rescan re-read the real
  save. It must still never undo an unlock the save itself reported.
*/
test('clearing a manual unlock lowers the count, but never undoes a real unlock', () => {
  const game = {
    achievement: {
      total: 4,
      unlocked: 1,
      list: [
        { name: 'REAL', Achieved: true },
        { name: 'FORCED', Achieved: false },
        { name: 'OTHER', Achieved: false },
        { name: 'LOCKED', Achieved: false },
      ],
    },
  };

  let map = {};
  map = manualUnlock.update(map, '123', 'steamEmu', 'FORCED', 'mark-unlocked').map;
  map = manualUnlock.update(map, '123', 'steamEmu', 'OTHER', 'mark-unlocked').map;
  manualUnlock.applyToGame(game, map, '123', 'steamEmu');
  assert.equal(game.achievement.unlocked, 3, 'two manual unlocks on top of one real one');

  map = manualUnlock.update(map, '123', 'steamEmu', 'FORCED', 'clear-manual').map;
  manualUnlock.applyToGame(game, map, '123', 'steamEmu');
  assert.equal(game.achievement.unlocked, 2, 'clearing a forced unlock lowers the count');
  assert.equal(game.achievement.list[1].Achieved, false, 'the forced achievement is locked again');
  assert.equal(game.achievement.list[1].manual, undefined, 'and loses its manual marker');

  // Marking, then clearing, an achievement the save already reported must leave it unlocked.
  map = manualUnlock.update(map, '123', 'steamEmu', 'REAL', 'mark-unlocked').map;
  manualUnlock.applyToGame(game, map, '123', 'steamEmu');
  map = manualUnlock.update(map, '123', 'steamEmu', 'REAL', 'clear-manual').map;
  manualUnlock.applyToGame(game, map, '123', 'steamEmu');
  assert.equal(game.achievement.list[0].Achieved, true, 'a real unlock survives clearing its override');
  assert.equal(game.achievement.unlocked, 2, 'and the count is unchanged by that round trip');
});
