'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateLibraryStats, isInstalled } = require('../../app/util/libraryStats.js');

const games = [
  { appid: 1, installed: true, achievement: { unlocked: 5, total: 10 } },
  { appid: 2, installed: false, achievement: { unlocked: 10, total: 10 } },
  { appid: 3, installed: '1', achievement: { unlocked: 0, total: 0 } },
  { appid: 4, installed: true },
];

test('library statistics include every game with achievement data by default', () => {
  assert.deepEqual(calculateLibraryStats(games), {
    totalUnlocked: 15,
    completed: 1,
    total: 3,
    average: 50,
  });
});

test('installed-only statistics match the visible installed library', () => {
  assert.deepEqual(calculateLibraryStats(games, { installedOnly: true }), {
    totalUnlocked: 5,
    completed: 0,
    total: 2,
    average: 25,
  });
  assert.equal(isInstalled(games[0]), true);
  assert.equal(isInstalled(games[1]), false);
  assert.equal(isInstalled(games[2]), true);
});

test('empty and invalid libraries produce a stable zero summary', () => {
  const empty = { totalUnlocked: 0, completed: 0, total: 0, average: 0 };
  assert.deepEqual(calculateLibraryStats([]), empty);
  assert.deepEqual(calculateLibraryStats(null, { installedOnly: true }), empty);
});
