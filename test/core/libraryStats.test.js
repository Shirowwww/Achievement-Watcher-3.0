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

test('library statistics include only games with an achievement set by default', () => {
  assert.deepEqual(calculateLibraryStats(games), {
    totalUnlocked: 15,
    completed: 1,
    total: 2,
    average: 75,
  });
});

test('installed-only statistics match the visible installed library', () => {
  assert.deepEqual(calculateLibraryStats(games, { installedOnly: true }), {
    totalUnlocked: 5,
    completed: 0,
    total: 1,
    average: 50,
  });
  assert.equal(isInstalled(games[0]), true);
  assert.equal(isInstalled(games[1]), false);
  assert.equal(isInstalled(games[2]), true);
});

test('achievement-less games never affect completed, unlocked, total or average stats', () => {
  const baseline = calculateLibraryStats(games.slice(0, 2));
  const withAchievementlessGames = calculateLibraryStats([
    ...games.slice(0, 2),
    { appid: 391540, name: 'UNDERTALE', installed: true, achievement: { unlocked: 0, total: 0, list: [] } },
    { appid: 'manual-local', manual: true, installed: true, achievement: { unlocked: 0, total: 0, list: [] } },
  ]);
  assert.deepEqual(withAchievementlessGames, baseline);
});

test('empty and invalid libraries produce a stable zero summary', () => {
  const empty = { totalUnlocked: 0, completed: 0, total: 0, average: 0 };
  assert.deepEqual(calculateLibraryStats([]), empty);
  assert.deepEqual(calculateLibraryStats(null, { installedOnly: true }), empty);
});
