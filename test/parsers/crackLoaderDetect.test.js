'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crackLoaderDetect = require(path.join(__dirname, '..', '..', 'app', 'util', 'crackLoaderDetect.js'));

// ---- tiny soft-assert harness (mirrors test/parsers/crackFix.test.js) --------------------------
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const tmpDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// ---- no loader present ---------------------------------------------------------------------------
{
  const dir = tmp('aw-crackloader-none-');
  fs.writeFileSync(path.join(dir, 'game.exe'), 'stub');
  fs.writeFileSync(path.join(dir, 'steam_api64.dll'), 'stub');
  eq(crackLoaderDetect.detectWorkingCrackLoader(dir), null, 'a plain (uncracked / already-Goldberg) folder has no known loader');
  eq(crackLoaderDetect.hasWorkingCrackLoader(dir), false, 'hasWorkingCrackLoader mirrors detectWorkingCrackLoader');
}

// ---- OnlineFix64.dll marker ------------------------------------------------------------------
{
  const dir = tmp('aw-crackloader-onlinefix64-');
  fs.writeFileSync(path.join(dir, 'game.exe'), 'stub');
  fs.writeFileSync(path.join(dir, 'OnlineFix64.dll'), 'stub');
  const hit = crackLoaderDetect.detectWorkingCrackLoader(dir);
  ok(hit && hit.name === 'OnlineFix', 'OnlineFix64.dll in the game root is recognised as OnlineFix');
  eq(crackLoaderDetect.hasWorkingCrackLoader(dir), true, 'hasWorkingCrackLoader true for OnlineFix64.dll');
}

// ---- OnlineFix.ini marker (case-insensitive) --------------------------------------------------
{
  const dir = tmp('aw-crackloader-onlinefixini-');
  fs.writeFileSync(path.join(dir, 'ONLINEFIX.INI'), 'stub');
  const hit = crackLoaderDetect.detectWorkingCrackLoader(dir);
  ok(hit && hit.name === 'OnlineFix', 'OnlineFix.ini is matched case-insensitively');
}

// ---- OnlineFix32.dll marker --------------------------------------------------------------------
{
  const dir = tmp('aw-crackloader-onlinefix32-');
  fs.writeFileSync(path.join(dir, 'OnlineFix32.dll'), 'stub');
  const hit = crackLoaderDetect.detectWorkingCrackLoader(dir);
  ok(hit && hit.name === 'OnlineFix', 'OnlineFix32.dll (x86 build) is also recognised');
}

// ---- Other installed emulator families are protected by the same automatic-write gate --------
for (const [name, marker] of [
  ['TENOKE', 'tenoke.ini'],
  ['ALI213', 'ALI213.ini'],
  ['SmartSteamEmu', 'SmartSteamEmu.ini'],
  ['UniverseLAN', 'UniverseLAN.ini'],
  ['CODEX / RUNE / scene emulator', 'steam_emu.ini'],
]) {
  const dir = tmp(`aw-crackloader-${name.replace(/\W/g, '').toLowerCase()}-`);
  fs.writeFileSync(path.join(dir, marker), 'stub');
  const hit = crackLoaderDetect.detectWorkingCrackLoader(dir);
  ok(hit && hit.name === name, `${marker} is recognised as an existing ${name} setup`);
}

// ---- nested marker does NOT count (top-level only) -------------------------------------------
{
  const dir = tmp('aw-crackloader-nested-');
  fs.mkdirSync(path.join(dir, 'Game_Data', 'Plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Game_Data', 'Plugins', 'OnlineFix64.dll'), 'stub');
  eq(crackLoaderDetect.detectWorkingCrackLoader(dir), null, 'a marker buried in a subfolder is not the loader\'s own drop point');
}

// ---- missing / unreadable folder never throws --------------------------------------------------
{
  eq(crackLoaderDetect.detectWorkingCrackLoader(path.join(os.tmpdir(), 'aw-crackloader-does-not-exist-xyz')), null, 'missing folder => null, no throw');
  eq(crackLoaderDetect.detectWorkingCrackLoader(null), null, 'null gameDir => null, no throw');
  eq(crackLoaderDetect.detectWorkingCrackLoader(''), null, 'empty gameDir => null, no throw');
  eq(crackLoaderDetect.detectWorkingCrackLoader(undefined), null, 'undefined gameDir => null, no throw');
}

// ---- summary ----------------------------------------------------------------------------------
for (const d of tmpDirs) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}
if (failures.length) {
  console.error(`FAIL: ${failures.length} assertion(s) failed (of ${passed + failures.length}):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASS: crackLoaderDetect — ${passed} assertions`);
