'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const eligibility = require('../../app/util/emulatorFixEligibility.js');

const roots = [];
function gameDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aw-fix-eligibility-${name}-`));
  roots.push(dir);
  fs.writeFileSync(path.join(dir, 'game.exe'), 'stub');
  fs.writeFileSync(path.join(dir, 'steam_api64.dll'), 'stub');
  fs.writeFileSync(path.join(dir, 'steam_appid.txt'), '1234');
  return dir;
}

test.after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

test('a bare Steam API install with only an AppID is eligible for its initial GBE config', () => {
  assert.deepEqual(eligibility.inspect({ gameDir: gameDir('bare') }), { eligible: true, reason: 'unconfigured' });
});

test('existing emulator fixes are protected, including nested runtime folders', () => {
  const cases = [
    ['onlinefix', 'OnlineFix64.dll'],
    ['tenoke', 'tenoke.ini'],
    ['ali213', 'ALI213.ini'],
    ['scene', 'steam_emu.ini'],
    ['smartsteamemu', 'SmartSteamEmu.ini'],
  ];
  for (const [name, marker] of cases) {
    const dir = gameDir(name);
    const runtime = path.join(dir, 'Engine', 'Binaries', 'Win64');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, marker), 'stub');
    const result = eligibility.inspect({ gameDir: dir });
    assert.equal(result.eligible, false, `${name} must not be replaced by an initial GBE config`);
    assert.equal(result.reason, 'existing-fix');
  }
});

test('an existing GBE/Goldberg steam_settings folder is a repair target, not an initial config target', () => {
  const dir = gameDir('gbe');
  fs.mkdirSync(path.join(dir, 'Binaries', 'steam_settings'), { recursive: true });
  const result = eligibility.inspect({ gameDir: dir });
  assert.equal(result.eligible, false);
  assert.equal(result.existingFix.name, 'GBE / Goldberg');
});

test('official launchers, Ubisoft, consoles and manual entries are excluded before disk mutation', () => {
  const epic = gameDir('epic');
  fs.mkdirSync(path.join(epic, '.egstore'));
  assert.equal(eligibility.inspect({ gameDir: epic }).reason, 'official-launcher');

  const uplay = gameDir('uplay');
  fs.writeFileSync(path.join(uplay, 'uplay_r2_loader64.dll'), 'stub');
  assert.equal(eligibility.inspect({ gameDir: uplay }).reason, 'uplay-r2');

  assert.equal(eligibility.inspect({ gameDir: gameDir('xbox'), system: 'xbox' }).reason, 'unsupported-platform');
  assert.equal(eligibility.inspect({ gameDir: gameDir('manual'), source: 'Manual', manual: true }).reason, 'unsupported-source');
  assert.equal(eligibility.inspect({ gameDir: gameDir('manual-source-only'), source: 'Manual' }).reason, 'unsupported-source');
});

test('a single manual PC entry can opt in without bypassing existing-fix guards', () => {
  const bare = gameDir('manual-opt-in');
  assert.deepEqual(eligibility.inspect({ gameDir: bare, source: 'Manual', manual: true, allowManual: true }), {
    eligible: true,
    reason: 'unconfigured',
  });

  const protectedDir = gameDir('manual-protected');
  fs.writeFileSync(path.join(protectedDir, 'OnlineFix64.dll'), 'stub');
  const protectedResult = eligibility.inspect({
    gameDir: protectedDir,
    source: 'Manual',
    manual: true,
    allowManual: true,
  });
  assert.equal(protectedResult.eligible, false);
  assert.equal(protectedResult.reason, 'existing-fix');
});

test('a manual program without a Steam API DLL never receives a GBE install action', () => {
  const dir = gameDir('manual-non-steam');
  fs.rmSync(path.join(dir, 'steam_api64.dll'));
  assert.equal(eligibility.hasSteamApiDll(dir), false);
  const result = eligibility.inspect({ gameDir: dir, source: 'Manual', manual: true, allowManual: true });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no-steam-api');
});
