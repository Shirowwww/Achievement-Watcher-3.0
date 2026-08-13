'use strict';

/*
  getLocalAchievementSchema locates its input by walking the game install — synchronously, depth 6.
  On a large install that is 0.3-2.1s, and because it blocks the renderer's event loop, makeList's
  worker pool serializes behind it: every game in a batch ends up reporting the whole batch's time.

  Two things keep that off the per-scan path, and both are pinned below:
    - the known emulator locations are probed before any walk (tenoke.ini is the rare file, and
      looking for it first used to force a full walk of every non-TENOKE install just to prove it
      wasn't there);
    - the walk's outcome is memoized, "not here" included — that is the answer that costs a walk.
  The assertions count directory reads rather than time, so they mean the same thing on any machine.
*/

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const steam = require('../../app/parser/steam.js');

const SCHEMA = [{ name: 'ACH_WIN', displayName: 'Winner', description: 'Win', hidden: '0', icon: 'a.jpg' }];
// Enough nesting that a walk is unmistakable next to a handful of targeted stats.
const NOISE = ['Managed', 'Resources', 'Logs', 'Mono', 'Shaders', 'Audio'];

function makeInstall({ withSchema = true, deep = false } = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-locate-')), 'Big Walk');
  // Unity layout: the emulator dll and its schema dump live under <Game>_Data/Plugins/<arch>.
  const settings = deep
    ? path.join(dir, 'Big Walk_Data', 'Plugins', 'x86_64', 'steam_settings')
    : path.join(dir, 'steam_settings');
  fs.mkdirSync(settings, { recursive: true });
  for (const junk of NOISE) fs.mkdirSync(path.join(dir, junk, 'nested'), { recursive: true });
  if (withSchema) fs.writeFileSync(path.join(settings, 'achievements.json'), JSON.stringify(SCHEMA));
  return dir;
}

// Count directory reads for one call, whatever route it takes internally. A walk reads every
// directory it descends into; a probe reads at most the top level.
function countingReaddir(run) {
  const real = fs.readdirSync;
  let calls = 0;
  fs.readdirSync = (...args) => {
    calls++;
    return real.apply(fs, args);
  };
  try {
    return { value: run(), calls };
  } finally {
    fs.readdirSync = real;
  }
}

const PROBE_BUDGET = 2; // one top-level read per filename probed, and nothing deeper

test('a schema where the emulator put it is found without walking the install', () => {
  const dir = makeInstall();
  steam.forgetLocalSchemaLocations();

  const { value, calls } = countingReaddir(() => steam.getLocalAchievementSchema(dir, '1478500', 'english'));
  assert.equal(value.length, 1);
  assert.equal(value[0].displayName, 'Winner');
  assert.ok(calls <= PROBE_BUDGET, `expected a probe, not a walk (readdir calls: ${calls})`);
});

test('the Unity layout is probed too, not walked', () => {
  const dir = makeInstall({ deep: true });
  steam.forgetLocalSchemaLocations();

  const { value, calls } = countingReaddir(() => steam.getLocalAchievementSchema(dir, '1478500', 'english'));
  assert.equal(value.length, 1);
  assert.ok(calls <= PROBE_BUDGET, `expected a probe, not a walk (readdir calls: ${calls})`);
});

test('an install with no schema anywhere stops re-walking to find that out', () => {
  const dir = makeInstall({ withSchema: false });
  steam.forgetLocalSchemaLocations();

  // First pass: the probes miss, so absence has to be proven by walking.
  const first = countingReaddir(() => steam.getLocalAchievementSchema(dir, '1478500', 'english'));
  assert.deepEqual(first.value, []);
  assert.ok(first.calls > PROBE_BUDGET, 'sanity: proving absence really does walk');

  // Every scan after that — the app rescans every 3 minutes — must not repeat it.
  const second = countingReaddir(() => steam.getLocalAchievementSchema(dir, '1478500', 'english'));
  assert.deepEqual(second.value, []);
  assert.ok(second.calls <= PROBE_BUDGET, `"not here" must be remembered too (readdir calls: ${second.calls})`);
});

test('a same-named save file no longer shadows the real schema', () => {
  /*
    Real case, AC Black Flag Resynced: the install carries both steam_settings/achievements.json (the
    49-entry schema) and saves/<id>/achievements.json (the unlock state, same filename, object shape).
    The depth-first walk reached "saves" before "steam_settings" purely on alphabetical order and
    handed back the save file, which parses to [] — so the game had no local schema at all. Probing
    the emulator's own directory first settles it by layout instead of by directory ordering.
  */
  const dir = makeInstall();
  fs.mkdirSync(path.join(dir, 'saves', '65043'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'saves', '65043', 'achievements.json'),
    JSON.stringify({ ACH_WIN: { earned: true, earned_time: 1 } })
  );
  steam.forgetLocalSchemaLocations();

  const schema = steam.getLocalAchievementSchema(dir, '3751950', 'english');
  assert.equal(schema.length, 1, 'the schema must win over an identically named save file');
  assert.equal(schema[0].name, 'ACH_WIN');
});

test('a schema written after a miss is picked up once the memo is dropped', () => {
  const dir = makeInstall({ withSchema: false });
  steam.forgetLocalSchemaLocations();
  assert.deepEqual(steam.getLocalAchievementSchema(dir, '1478500', 'english'), []);

  // This is what the emulator fix does: it writes the schema the scan just failed to find.
  fs.writeFileSync(path.join(dir, 'steam_settings', 'achievements.json'), JSON.stringify(SCHEMA));
  steam.forgetLocalSchemaLocations(dir);

  const schema = steam.getLocalAchievementSchema(dir, '1478500', 'english');
  assert.equal(schema.length, 1, 'the repair path must not sit behind its own stale miss');
});

test('a remembered walk hit is dropped when the file it points at goes away', () => {
  // Deep enough that the probes miss and the memoized walk result is what gets reused.
  const dir = makeInstall({ withSchema: false });
  const buried = path.join(dir, 'Mono', 'nested', 'steam_settings');
  fs.mkdirSync(buried, { recursive: true });
  fs.writeFileSync(path.join(buried, 'achievements.json'), JSON.stringify(SCHEMA));
  steam.forgetLocalSchemaLocations();
  assert.equal(steam.getLocalAchievementSchema(dir, '1478500', 'english').length, 1);

  fs.rmSync(path.join(buried, 'achievements.json'));
  assert.deepEqual(
    steam.getLocalAchievementSchema(dir, '1478500', 'english'),
    [],
    'a remembered path is revalidated, never trusted blind'
  );
});

test('clearing one install leaves the others remembered', () => {
  const kept = makeInstall({ withSchema: false });
  const cleared = makeInstall({ withSchema: false });
  steam.forgetLocalSchemaLocations();
  steam.getLocalAchievementSchema(kept, '1478500', 'english');
  steam.getLocalAchievementSchema(cleared, '1478500', 'english');

  steam.forgetLocalSchemaLocations(cleared);
  assert.ok(countingReaddir(() => steam.getLocalAchievementSchema(kept, '1478500', 'english')).calls <= PROBE_BUDGET);
  assert.ok(countingReaddir(() => steam.getLocalAchievementSchema(cleared, '1478500', 'english')).calls > PROBE_BUDGET);
});
