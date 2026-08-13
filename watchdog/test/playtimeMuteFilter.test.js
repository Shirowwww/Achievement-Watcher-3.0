'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isMutedByPath, shouldMuteProcessPath } = require('../playtime/monitor.js');

test('path mute filter matches a child of a muted root (case-insensitive)', () => {
  const dirs = ['C:\\Program Files', 'D:\\Games'];
  assert.equal(isMutedByPath('c:\\PROGRAM FILES\\Steam\\steam.exe', dirs), true);
  assert.equal(isMutedByPath('d:/games/My Game/game.exe', dirs), true);
  assert.equal(isMutedByPath('C:\\Program Files (x86)\\Steam\\steam.exe', dirs), false);
});

test('path mute filter ignores undefined entries (missing env vars)', () => {
  const dirs = ['C:\\Windows', undefined, null, ''];
  assert.equal(isMutedByPath('C:\\Windows\\System32\\svchost.exe', dirs), true);
  assert.equal(isMutedByPath('C:\\Games\\game.exe', dirs), false);
});

test('path mute filter tolerates empty or missing lists and empty paths', () => {
  assert.equal(isMutedByPath('C:\\Games\\game.exe', []), false);
  assert.equal(isMutedByPath('C:\\Games\\game.exe', undefined), false);
  assert.equal(isMutedByPath('', ['C:\\']), false);
  assert.equal(isMutedByPath(null, ['C:\\']), false);
});

test('an explicitly indexed manual game overrides the broad user-profile path mute', () => {
  const desktopGame = 'C:\\Users\\Player\\Desktop\\Games\\Ryujinx\\Ryujinx.exe';
  const mutedRoots = ['C:\\Users\\Player'];
  assert.equal(shouldMuteProcessPath(desktopGame, mutedRoots, []), true);
  assert.equal(shouldMuteProcessPath(desktopGame, mutedRoots, [{ appid: 'manual-1', source: 'Manual' }]), false);
  assert.equal(shouldMuteProcessPath(desktopGame, mutedRoots, [{ appid: '123', source: 'Steam' }]), true);
});
