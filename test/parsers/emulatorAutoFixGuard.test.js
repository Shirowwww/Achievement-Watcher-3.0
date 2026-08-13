'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { ipcRenderer: { sendSync: () => false, invoke: async () => null } };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../../app/parser/achievements.js');

test('automatic repair paths stay gated on a real game executable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'parser', 'achievements.js'), 'utf8');
  assert.match(src, /realGameExePresent\(\)/, 'runtime config writes must be gated on a real game executable');
  assert.match(src, /requireGameExecutable: true/, 'background auto-fix must pass the executable requirement');
});

test('automatic emulator fix skips a folder that has no game executable', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guard-user-'));
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guard-game-'));
  fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
  achievements.initDebug({ isDev: false, userDataPath: userData });
  try {
    const result = await achievements.autoApplyEmulatorFix({
      gameDir,
      gameName: 'Test Game',
      appid: '12345',
      steamSettings: path.join(gameDir, 'steam_settings'),
      option: { emulator: { autoApplyNewGames: true }, achievement: {}, general: {} },
      requireGameExecutable: true,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-game-executable');
    assert.deepEqual(fs.readdirSync(gameDir), []);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});
