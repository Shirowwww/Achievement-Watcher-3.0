'use strict';

// RLD! writes achievements.ini values as 5-byte hex blobs (little-endian uint32 + a discarded
// trailing byte) and carries NO achieved flag: a locked achievement is written with Time=0, an
// unlocked one with a real timestamp. Builds that omit the State key entirely used to reach the
// normalizer with Time still raw hex, so every one of their achievements read as locked.
//
// The decode is deliberately conservative: an all-digit blob is ambiguous ("1712253396" is both
// valid hex and a real unix timestamp) and is left alone rather than guessed at.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// achievements.js pulls in the Electron renderer bridge on require; stub it out so the parser can be
// exercised under plain Node (same pattern as discoveryLookup.test.js).
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return { ipcRenderer: { sendSync: () => false, invoke: async () => null } };
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const steam = require('../../app/parser/steam.js');
const { normalizeSaveEntry } = require('../../app/parser/achievements.js')._internal;

function writeIni(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rld-'));
  fs.writeFileSync(path.join(dir, 'achievements.ini'), lines.join('\r\n'));
  return dir;
}

// 0x66151AD0 = 1712659152, written little-endian as D0 1A 15 66 with a trailing padding byte.
const HEX_TIME = 'd01a156600';
const HEX_TIME_DECODED = 1712659152;

test('a State-less RLD entry decodes its hex Time and reads as unlocked', async () => {
  const dir = writeIni(['[ACH_WIN_ONE]', `Time=${HEX_TIME}`, '', '[ACH_LOCKED]', 'Time=0000000000']);

  const root = await steam.getAchievementsFromFile(dir);
  assert.equal(root.ACH_WIN_ONE.Time, HEX_TIME_DECODED, 'hex blob is decoded even with no State key');

  assert.equal(normalizeSaveEntry(root.ACH_WIN_ONE, 'steam').Achieved, true);
  assert.equal(normalizeSaveEntry(root.ACH_LOCKED, 'steam').Achieved, false, 'Time=0 stays locked');
  assert.equal(normalizeSaveEntry(root.ACH_WIN_ONE, 'steam').UnlockTime, HEX_TIME_DECODED);
});

test('an all-digit Time is left as-is rather than misread as hex', async () => {
  const dir = writeIni(['[ACH_DECIMAL]', 'Time=1712253396']);

  const root = await steam.getAchievementsFromFile(dir);
  assert.equal(Number(root.ACH_DECIMAL.Time), 1712253396, 'an ambiguous blob keeps its decimal reading');
  assert.equal(Number(normalizeSaveEntry(root.ACH_DECIMAL, 'steam').UnlockTime), 1712253396);
});

test('the classic State-carrying RLD layout still decodes every field', async () => {
  const dir = writeIni([
    '[ACH_PROGRESS]',
    'State=0100000000',
    'CurProgress=0a00000000',
    'MaxProgress=6400000000',
    `Time=${HEX_TIME}`,
  ]);

  const root = await steam.getAchievementsFromFile(dir);
  assert.equal(root.ACH_PROGRESS.State, 1);
  assert.equal(root.ACH_PROGRESS.CurProgress, 10);
  assert.equal(root.ACH_PROGRESS.MaxProgress, 100);
  assert.equal(root.ACH_PROGRESS.Time, HEX_TIME_DECODED);

  const parsed = normalizeSaveEntry(root.ACH_PROGRESS, 'steam');
  assert.equal(parsed.Achieved, true, 'State=1 unlocks it');
  assert.equal(parsed.CurProgress, 10);
  assert.equal(parsed.MaxProgress, 100);
});

test('an explicit locked flag is never overridden by a stray timestamp', () => {
  // UniverseLAN-style: the entry states it is locked AND carries a timestamp. The Time>0 rule must
  // not fire here, otherwise issue #48 comes straight back as a mass false-unlock.
  const parsed = normalizeSaveEntry({ Unlocked: false, UnlockTime: 1712253396 }, 'steam');
  assert.equal(parsed.Achieved, false);

  assert.equal(normalizeSaveEntry({ earned: false, earned_time: 1712253396 }, 'steam').Achieved, false);
  assert.equal(normalizeSaveEntry({ Achieved: '0', Time: 1712253396 }, 'steam').Achieved, false);
});

test('the RUNE/Codex decimal alias set still resolves both facts', () => {
  // Codex builds disagree on spelling; each of these is one real save layout.
  for (const entry of [
    { Achieved: 1, UnlockTime: 1712253396 },
    { unlocked: 'true', unlock_time: 1712253396 },
    { earned: true, earned_time: 1712253396 },
    { HaveAchieved: 1, HaveAchievedTime: 1712253396 },
  ]) {
    const parsed = normalizeSaveEntry(entry, 'steam');
    assert.equal(parsed.Achieved, true, `unlock flag for ${JSON.stringify(entry)}`);
    assert.equal(Number(parsed.UnlockTime), 1712253396, `unlock time for ${JSON.stringify(entry)}`);
  }
});

test('a bare non-object entry is still handled', () => {
  assert.equal(normalizeSaveEntry('1', 'steam').Achieved, true);
  assert.equal(normalizeSaveEntry(null, 'steam').Achieved, false);
  // Legacy GOG/Epic saves list only unlocked achievements, with no flag to read.
  assert.equal(normalizeSaveEntry({}, 'gog').Achieved, true);
  assert.equal(normalizeSaveEntry({ Unlocked: false }, 'gog').Achieved, false);
});
