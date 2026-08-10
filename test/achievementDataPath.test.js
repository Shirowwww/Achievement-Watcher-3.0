'use strict';

const assert = require('assert');
const test = require('node:test');
const { resolveAchievementDataPath, isFilesystemPath } = require('../app/util/achievementDataPath.js');

test('the folder an entry was parsed from is exposed for the context menu (issue #21)', () => {
  // Shapes recorded by the parsers: emulator save folders, trophy dirs, Ubisoft spool folders.
  assert.strictEqual(
    resolveAchievementDataPath({ type: 'file', path: 'C:\\Users\\Tester\\AppData\\Roaming\\GSE Saves\\271590' }),
    'C:\\Users\\Tester\\AppData\\Roaming\\GSE Saves\\271590'
  );
  assert.strictEqual(resolveAchievementDataPath({ type: 'xenia', path: 'D:/roms/xenia/content' }), 'D:/roms/xenia/content');
  assert.strictEqual(
    resolveAchievementDataPath({ type: 'ubisoftOfficial', path: '\\\\nas\\ubisoft\\spool' }),
    '\\\\nas\\ubisoft\\spool'
  );
});

test('registry-backed sources offer no folder to open', () => {
  // GreenLuma and LumaPlay keep unlock state under HKCU; opening that string in Explorer would
  // land the user somewhere unrelated, which is worse than not offering the action at all.
  assert.strictEqual(resolveAchievementDataPath({ type: 'greenluma', path: 'SOFTWARE/GreenLuma/AppID/480/Achievements' }), '');
  assert.strictEqual(resolveAchievementDataPath({ type: 'lumaPlay', path: 'SOFTWARE/LumaPlay/user/720/Achievements' }), '');
});

test('a missing or empty path resolves to nothing', () => {
  assert.strictEqual(resolveAchievementDataPath({ type: 'xboxPc' }), '');
  assert.strictEqual(resolveAchievementDataPath({ path: '   ' }), '');
  assert.strictEqual(resolveAchievementDataPath(null), '');
  assert.strictEqual(resolveAchievementDataPath(undefined), '');
});

test('filesystem paths are recognised independently of the host platform', () => {
  for (const value of ['C:\\Games', 'c:/games', '/home/user/saves', '\\\\server\\share']) {
    assert.strictEqual(isFilesystemPath(value), true, `${value} must be a filesystem path`);
  }
  for (const value of ['SOFTWARE/Valve', 'HKCU', 'relative/path', '', null]) {
    assert.strictEqual(isFilesystemPath(value), false, `${value} must not be a filesystem path`);
  }
});
