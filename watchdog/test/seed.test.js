'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { binaryMatchesProcess, buildSeededSessions } = require('../playtime/seed.js');

const gameIndex = [
  { appid: '100', name: 'Alpha', binary: 'alpha.exe', icon: 'a', source: 'GBE Fork' },
  { appid: '200', name: 'Unreal Game', binary: 'unrealgame.exe', icon: 'u', source: 'Xbox PC' },
  { appid: '300', name: 'Beta', binary: 'beta.exe', icon: 'b' },
];

test('binary match tolerates UE shipping variant', () => {
  assert.equal(binaryMatchesProcess('unrealgame.exe', 'unrealgame-Win64-Shipping.exe'), true);
  assert.equal(binaryMatchesProcess('alpha.exe', 'alpha.exe'), true);
  assert.equal(binaryMatchesProcess('alpha.exe', 'beta.exe'), false);
  assert.equal(binaryMatchesProcess('', 'alpha.exe'), false);
});

test('seeds one session per running known game and groups multi-process games', () => {
  const now = 1000;
  const sessions = buildSeededSessions({
    gameIndex,
    processes: [
      { pid: 11, name: 'alpha.exe' },
      { pid: 12, name: 'alpha.exe' },
      { pid: 21, name: 'unrealgame-Win64-Shipping.exe' },
      { pid: 99, name: 'unknown.exe' },
    ],
    now,
    createTimer: () => ({ fake: true }),
  });
  assert.equal(sessions.length, 2);
  const alpha = sessions.find((s) => s.appid === '100');
  assert.deepEqual([...alpha.pids], [11, 12]);
  assert.equal(alpha.seeded, true);
  assert.equal(alpha.timer.fake, true);
  assert.equal(alpha.source, 'GBE Fork');
  const unreal = sessions.find((s) => s.appid === '200');
  assert.deepEqual([...unreal.pids], [21]);
  assert.equal(unreal.source, 'Xbox PC');
  assert.equal(sessions.find((s) => s.appid === '300'), undefined);
});

test('ambiguous binary matches are skipped (delegated to the live watcher)', () => {
  const sessions = buildSeededSessions({
    gameIndex: [
      { appid: '1', binary: 'game.exe' },
      { appid: '2', binary: 'game.exe' },
    ],
    processes: [{ pid: 1, name: 'game.exe' }],
  });
  assert.equal(sessions.length, 0);
});
