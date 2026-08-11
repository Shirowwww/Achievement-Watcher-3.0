'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { binaryMatchesProcess, buildBinaryIndex } = require('../playtime/seed.js');
const { getTrackableGameMatches } = require('../playtime/monitor.js');

function legacyTrackableMatches(gameIndex, process, isIgnored) {
  return gameIndex.filter(
    (game) => binaryMatchesProcess(game.binary, process) && !isIgnored(game.appid) && !String(game.name || '').toLowerCase().includes('demo')
  );
}

test('indexed live matches preserve Unreal aliases, collisions, and game-index order', () => {
  const gameIndex = [
    { appid: 'first', name: 'First', binary: 'shared.exe' },
    { appid: 'second', name: 'Second', binary: 'shared.exe' },
    { appid: 'unreal-base', name: 'Unreal base', binary: 'unreal.exe' },
    { appid: 'unreal-shipping', name: 'Unreal shipping', binary: 'unreal-Win64-Shipping.exe' },
    { appid: 'portable', name: 'Portable', binary: 'portable-game' },
    { appid: 'trimmed', name: 'Trimmed', binary: ' padded.exe ' },
  ];
  const index = buildBinaryIndex(gameIndex);
  const neverIgnored = () => false;

  assert.deepEqual(getTrackableGameMatches(index, 'shared.exe', neverIgnored).map((game) => game.appid), ['first', 'second']);
  assert.deepEqual(getTrackableGameMatches(index, 'unreal-Win64-Shipping.exe', neverIgnored).map((game) => game.appid), ['unreal-base', 'unreal-shipping']);
  assert.deepEqual(getTrackableGameMatches(index, 'portable-game', neverIgnored).map((game) => game.appid), ['portable']);
  assert.deepEqual(getTrackableGameMatches(index, 'padded.exe', neverIgnored).map((game) => game.appid), ['trimmed']);
});

test('indexed live matches remain equivalent to the legacy scan while filters change', () => {
  const binaries = ['alpha.exe', 'beta.exe', 'unreal.exe', 'portable-game', ' spaced.exe ', 'alpha-Win64-Shipping.exe', null, ''];
  const gameIndex = Array.from({ length: 128 }, (_, index) => ({
    appid: String(index),
    name: index % 13 === 0 ? `Demo ${index}` : `Game ${index}`,
    binary: binaries[index % binaries.length],
  }));
  const binaryIndex = buildBinaryIndex(gameIndex);
  const processes = [
    'alpha.exe',
    'ALPHA.EXE',
    'alpha-Win64-Shipping.exe',
    'unreal-Win64-Shipping.exe',
    'portable-game',
    'spaced.exe',
    ' spaced.exe',
    'unknown.exe',
    '',
    null,
  ];
  const ignored = new Set(['1', '3', '7']);
  const isIgnored = (appid) => ignored.has(String(appid));

  for (const process of processes) {
    assert.deepEqual(
      getTrackableGameMatches(binaryIndex, process, isIgnored).map((game) => game.appid),
      legacyTrackableMatches(gameIndex, process, isIgnored).map((game) => game.appid),
      `matches ${String(process)}`
    );
  }

  // The index intentionally contains only binary candidates. Exclusions are evaluated on each
  // event, so a changed exclusion list takes effect without an index rebuild.
  ignored.add('0');
  ignored.add('8');
  assert.deepEqual(
    getTrackableGameMatches(binaryIndex, 'alpha.exe', isIgnored).map((game) => game.appid),
    legacyTrackableMatches(gameIndex, 'alpha.exe', isIgnored).map((game) => game.appid)
  );
});
