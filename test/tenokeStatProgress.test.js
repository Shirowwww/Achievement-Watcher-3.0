'use strict';

// TENOKE's user_stats.ini carries both an [ACHIEVEMENTS] section (unlock flags, optionally inline
// progress) and a sibling [STATS] section (raw stat values) in the SAME file. Tenoke ties an
// achievement's progress to its own key name directly (no operand1-style indirection the way the
// GBE/Goldberg schema does), so getAchievementsFromFile must cross-reference same-key STATS values
// when an achievement has no inline progress.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const steam = require('../app/parser/steam.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tenoke-stats-'));
}

test('getAchievementsFromFile cross-references TENOKE STATS values by matching achievement key', async () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'user_stats.ini'),
      [
        '[STATS]',
        '"felinePriorities" = 12,',
        '',
        '[ACHIEVEMENTS]',
        '"businessAsUnusual" = {unlocked=true, time=1712253396}',
        '"felinePriorities" = {unlocked=false, time=0}',
      ].join('\r\n')
    );

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.businessAsUnusual.Achieved, '1');
    assert.equal(root.felinePriorities.Achieved, '0');
    assert.equal(root.felinePriorities.CurProgress, 12);
    assert.equal(root.businessAsUnusual.CurProgress, undefined, 'a plain unlocked achievement gets no synthesized progress');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile prefers inline TENOKE progress over the STATS section', async () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'user_stats.ini'),
      ['[STATS]', '"felinePriorities" = 12,', '', '[ACHIEVEMENTS]', '"felinePriorities" = {unlocked=false, time=0, progress=25}'].join('\r\n')
    );

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.felinePriorities.CurProgress, 25);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile ignores STATS entries with no matching achievement key', async () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'user_stats.ini'),
      ['[STATS]', '"orphan_stat" = 5,', '', '[ACHIEVEMENTS]', '"businessAsUnusual" = {unlocked=true, time=1712253396}'].join('\r\n')
    );

    const root = await steam.getAchievementsFromFile(tmp);
    assert.deepEqual(Object.keys(root), ['businessAsUnusual']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getAchievementsFromFile finds the STATS section regardless of its casing', async () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(
      path.join(tmp, 'user_stats.ini'),
      ['[Stats]', '"felinePriorities" = 7,', '', '[ACHIEVEMENTS]', '"felinePriorities" = {unlocked=false, time=0}'].join('\r\n')
    );

    const root = await steam.getAchievementsFromFile(tmp);
    assert.equal(root.felinePriorities.CurProgress, 7);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
