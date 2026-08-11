'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { binaryMatchesProcess, buildBinaryIndex, buildSeededSessions, describeActiveGames } = require('../playtime/seed.js');

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

test('binary index treats an unavailable game index as an empty index', () => {
  assert.deepEqual([...buildBinaryIndex(null)], []);
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

test('seeds task-list snapshots that expose process instead of name', () => {
  const sessions = buildSeededSessions({
    gameIndex,
    processes: [{ pid: 11, process: 'alpha.exe' }],
    createTimer: () => ({ fake: true }),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].appid, '100');
  assert.deepEqual([...sessions[0].pids], [11]);
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

test('Unreal aliases preserve ambiguity and binaries without .exe stay uniquely matchable', () => {
  const sessions = buildSeededSessions({
    gameIndex: [
      { appid: '1', binary: 'game.exe' },
      { appid: '2', binary: 'game-Win64-Shipping.exe' },
      { appid: '3', binary: 'portable-game' },
    ],
    processes: [
      { pid: 1, name: 'game-Win64-Shipping.exe' },
      { pid: 2, name: 'portable-game' },
    ],
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].appid, '3');
});

test('process-trail activity projects sessions without replaying private timer or PID state', () => {
  const timer = { started: true };
  const sessions = [
    {
      appid: '100',
      name: 'Older game',
      source: 'Steam',
      pids: new Set([11]),
      timer,
      seeded: true,
    },
    {
      appid: '200',
      name: 'Xbox game',
      source: 'Xbox PC',
      pids: new Set([22]),
      timer,
      seeded: true,
    },
    {
      appid: '300',
      name: 'Most recent game',
      source: 'Steam',
      pids: new Set([33]),
      timer,
      seeded: true,
    },
  ];

  const activity = describeActiveGames(sessions);

  assert.deepEqual(activity.games.map((game) => game.appid), ['100', '200', '300']);
  assert.equal(activity.overlayGame.appid, '300', 'matches the last live launch as overlay target');
  assert.equal(activity.xboxGame.appid, '200', 'starts the single Xbox polling slot for the active Xbox title');
  assert.equal('pids' in activity.games[0], false);
  assert.equal('timer' in activity.games[0], false);
  assert.notEqual(activity.games[0], sessions[0]);

  activity.games[0].name = 'mutated projection';
  assert.equal(sessions[0].name, 'Older game', 'the monitor session remains private');
});

test('process-trail activity has no overlay or Xbox target when no session is active', () => {
  const activity = describeActiveGames(null);
  assert.deepEqual(activity.games, []);
  assert.equal(activity.overlayGame, null);
  assert.equal(activity.xboxGame, null);
});
