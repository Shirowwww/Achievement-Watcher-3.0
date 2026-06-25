'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bypass = require(path.join(__dirname, '..', 'app', 'parser', 'apiCheckBypass.js'));

// Minimal valid x64 PE header so pe.exeArch (used by applyBypass) returns 'x64'.
function fakePE() {
  const buf = Buffer.alloc(0x100, 0);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x8664, 0x84);
  return buf;
}

// ---- buildBypassConfig (pure rules, mirrors SteamAutoCrack) ----
const cfg = bypass.buildBypassConfig({
  exeName: 'game.exe',
  exeBackup: 'game.exe.steamstub.bak',
  steamApiDlls: ['steam_api64.dll'],
  mode: 'nth_time_only',
  nthTimes: [1],
});
assert.deepStrictEqual(cfg['game.exe'], { mode: 'file_redirect', to: 'game.exe.steamstub.bak', file_must_exist: true }, 'exe redirects to its backup');
assert.deepStrictEqual(
  cfg['steam_api64.dll'],
  { mode: 'file_redirect', to: 'steam_api64.dll.bak', file_must_exist: true, hook_times_mode: 'nth_time_only', hook_time_n: [1] },
  'steam_api redirects to .bak with the gating mode'
);
assert.deepStrictEqual(cfg['steam_settings'], { mode: 'file_hide' }, 'steam_settings folder is hidden');
assert.deepStrictEqual(
  cfg['steam_settings\\achievements.json'],
  { mode: 'file_hide', hook_times_mode: 'not_nth_time_only', hook_time_n: '1' },
  'steam_settings files are hidden after the first read'
);
// `all` mode drops the per-call gating on the api dll.
const cfgAll = bypass.buildBypassConfig({ exeName: 'g.exe', steamApiDlls: ['steam_api.dll'], mode: 'all' });
assert.ok(!('hook_times_mode' in cfgAll['steam_api.dll']), 'mode=all has no hook gating');
assert.ok(!('g.exe' in cfgAll), 'no exe rule without a backup');

// ---- apply + revert against a fake game folder ----
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bypass-'));
try {
  const gameDir = path.join(temp, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const exe = path.join(gameDir, 'game.exe');
  fs.writeFileSync(exe, fakePE());
  fs.writeFileSync(exe + '.steamstub.bak', 'orig-exe');
  fs.writeFileSync(path.join(gameDir, 'steam_api64.dll'), 'gbe');
  fs.writeFileSync(path.join(gameDir, 'steam_api64.dll.bak'), 'orig-dll');
  // Stand-in proxy DLLs (applyBypass just copies the arch-matching one).
  const dlls = { x64: path.join(temp, 'SteamAPICheckBypass.dll'), x86: path.join(temp, 'SteamAPICheckBypass_x32.dll') };
  fs.writeFileSync(dlls.x64, 'proxy-x64');
  fs.writeFileSync(dlls.x86, 'proxy-x86');

  const res = bypass.applyBypass({ gameDir, exePath: exe, dlls });
  assert.strictEqual(res.applied, true);
  assert.strictEqual(res.dll, 'winmm.dll', 'default hijack name is winmm.dll');
  assert.strictEqual(fs.readFileSync(path.join(gameDir, 'winmm.dll'), 'utf8'), 'proxy-x64', 'x64 proxy copied for an x64 exe');
  const written = JSON.parse(fs.readFileSync(path.join(gameDir, 'SteamAPICheckBypass.json'), 'utf8'));
  assert.strictEqual(written['steam_api64.dll'].to, 'steam_api64.dll.bak');
  assert.strictEqual(written['game.exe'].to, 'game.exe.steamstub.bak');

  // Idempotent / non-clobbering: a second apply is a no-op because winmm.dll already exists.
  const res2 = bypass.applyBypass({ gameDir, exePath: exe, dlls });
  assert.strictEqual(res2.applied, false, 'does not clobber an existing hijack DLL');

  const rev = bypass.revertBypass({ exePath: exe });
  assert.ok(rev.removed.includes('winmm.dll') && rev.removed.includes('SteamAPICheckBypass.json'), 'revert removes proxy + json');
  assert.ok(!fs.existsSync(path.join(gameDir, 'winmm.dll')), 'winmm.dll gone after revert');
  assert.ok(fs.existsSync(path.join(gameDir, 'steam_api64.dll')) && fs.existsSync(exe), 'revert leaves game files intact');

  console.log('PASS: apiCheckBypass (config rules + apply/idempotent/revert)');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
