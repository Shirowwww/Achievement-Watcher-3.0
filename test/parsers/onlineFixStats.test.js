'use strict';

// Online-Fix repacks keep raw stat values in a sibling Stats.ini; getAchievementsFromFile must merge
// them so statProgress can resolve progress-type achievements through the local GBE schema.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const steam = require('../../app/parser/steam.js');
const { applyLocalStatProgress } = require('../../app/parser/statProgress.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onlinefix-stats-'));
}

test('getAchievementsFromFile merges a sibling stats/Stats.ini into the flat result', async () => {
  const tmp = mkTmp();
  try {
    const statsDir = path.join(tmp, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(
      path.join(statsDir, 'achievements.ini'),
      ['[ACH_UNLOCKED]', 'Achieved=1', 'UnlockTime=1700000000', '', '[ACH_PROGRESS]', 'Achieved=0', 'UnlockTime=0'].join('\r\n')
    );
    fs.writeFileSync(path.join(statsDir, 'Stats.ini'), ['[Stats]', 'stat_kills=7', 'stat_unused=3'].join('\r\n'));

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.ACH_UNLOCKED.Achieved, '1');
    // the stat value must land as a plain numeric top-level entry, not shadow a real achievement
    assert.equal(root.stat_kills, 7);
    assert.equal(root.stat_unused, 3);

    const schema = [{ name: 'ACH_PROGRESS', progress: { max_val: 10, value: { operation: 'statvalue', operand1: 'stat_kills' } } }];
    const applied = applyLocalStatProgress(root, schema);
    assert.equal(applied, 1);
    assert.deepEqual(root.ACH_PROGRESS.CurProgress, 7);
    assert.deepEqual(root.ACH_PROGRESS.MaxProgress, 10);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile tolerates an empty sibling Stats.ini (no crash, no merge)', async () => {
  const tmp = mkTmp();
  try {
    const statsDir = path.join(tmp, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(path.join(statsDir, 'achievements.ini'), ['[ACH_UNLOCKED]', 'Achieved=1'].join('\r\n'));
    fs.writeFileSync(path.join(statsDir, 'Stats.ini'), '');

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.ACH_UNLOCKED.Achieved, '1');
    assert.equal(Object.keys(root).length, 1, 'an empty Stats.ini must not add or break anything');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile never lets a stat value shadow a real achievement entry', async () => {
  const tmp = mkTmp();
  try {
    const statsDir = path.join(tmp, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(path.join(statsDir, 'achievements.ini'), ['[ACH_UNLOCKED]', 'Achieved=1'].join('\r\n'));
    // A pathological Stats.ini that happens to reuse an achievement's own key name.
    fs.writeFileSync(path.join(statsDir, 'Stats.ini'), ['[Stats]', 'ACH_UNLOCKED=999'].join('\r\n'));

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.ACH_UNLOCKED.Achieved, '1', 'the real achievement object must survive untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile shadow guard is case-insensitive', async () => {
  const tmp = mkTmp();
  try {
    const statsDir = path.join(tmp, 'stats');
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(path.join(statsDir, 'achievements.ini'), ['[ACH_UNLOCKED]', 'Achieved=1'].join('\r\n'));
    // readIniSectionValues lower-cases stat names; the achievement key keeps its original casing.
    fs.writeFileSync(path.join(statsDir, 'Stats.ini'), ['[Stats]', 'ach_unlocked=999'].join('\r\n'));

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.ACH_UNLOCKED.Achieved, '1', 'the real achievement object must survive untouched');
    assert.equal(root.ach_unlocked, undefined, 'the shadowing stat name must not be merged');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile without a sibling Stats.ini behaves exactly as before', async () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'achievements.ini'), ['[ACH_UNLOCKED]', 'Achieved=1'].join('\r\n'));
    const root = await steam.getAchievementsFromFile(tmp);
    assert.deepEqual(Object.keys(root), ['ACH_UNLOCKED']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
