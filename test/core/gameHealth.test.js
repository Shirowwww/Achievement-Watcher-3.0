'use strict';

/*
  Health-state derivation. The point of these is that the state, the explanation and the offered
  repairs stay consistent with each other: a game reported as Ready must have nothing to fix, and a
  game reported as Not tracking must be one AW Next genuinely cannot observe — not merely one whose
  setup is incomplete.
*/

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { deriveHealth, STATE, LEVEL, ACTION } = require(path.join(__dirname, '..', '..', 'app', 'util', 'gameHealth.js'));

// A fully healthy Steam-emulated game. Each test below breaks exactly one thing.
function healthyGame(overrides = {}) {
  return {
    appid: '367520',
    name: 'Hollow Knight',
    source: 'Goldberg',
    gameDir: 'C:/Jeux/Hollow Knight',
    gameDirExists: true,
    installed: true,
    exe: 'C:/Jeux/Hollow Knight/hollow_knight.exe',
    exeExists: true,
    achievements: { total: 63, unlocked: 12 },
    emulated: true,
    goldberg: {
      emulator: 'gbe',
      steamSettings: 'C:/Jeux/Hollow Knight/steam_settings',
      dllCount: 1,
      achievements: { expected: 63, found: 63, missing: [], missingIcons: [] },
      save: { exists: true, type: 'gbe', earned: 12, total: 63 },
      issues: [{ level: 'info', code: 'SAVE_PRESENT', message: 'Runtime save found (gbe): 12/63 unlocked.' }],
      ok: true,
    },
    uplay: null,
    tracking: { indexed: true, binary: 'hollow_knight.exe' },
    notifications: { transport: 'toast', progressMuted: false },
    playtime: { total: 7200, lastPlayed: 1750000000 },
    ...overrides,
  };
}

function checkFor(report, id) {
  return report.checks.find((entry) => entry.id === id);
}

test('a fully configured, played game is Ready with nothing to repair', () => {
  const report = deriveHealth(healthyGame());
  assert.equal(report.state, STATE.READY);
  assert.equal(report.reason, 'ready');
  assert.ok(
    !report.checks.some((entry) => entry.level === LEVEL.FAIL || entry.level === LEVEL.WARN),
    'a Ready game must raise no failing or warning check'
  );
  // The only offer left is a notification test, which repairs nothing.
  assert.deepEqual(report.actions, [ACTION.TEST_NOTIFICATION]);
});

test('a game with no achievement list at all is Not tracking, not merely incomplete', () => {
  const report = deriveHealth(healthyGame({ achievements: { total: 0, unlocked: 0 }, goldberg: null, emulated: false }));
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.equal(report.reason, 'no-achievement-data');
  assert.equal(checkFor(report, 'achievement-data').level, LEVEL.FAIL);
});

test('a disappeared install folder is reported, and blocks only when nothing else can be read', () => {
  // Unlocks already recorded stay readable, so the game is impaired rather than lost.
  const withHistory = deriveHealth(healthyGame({ gameDirExists: false, exeExists: false }));
  assert.equal(withHistory.state, STATE.ATTENTION);
  assert.equal(withHistory.reason, 'install-gone');
  assert.equal(withHistory.actions[0], ACTION.CHOOSE_EXE, 'locating the game must be the leading fix');
  // The path is preserved so the user can see which folder went missing.
  assert.equal(checkFor(withHistory, 'install').params.path, 'C:/Jeux/Hollow Knight');

  // Nothing unlocked and no save left: there is genuinely nothing to follow.
  const empty = deriveHealth(
    healthyGame({ gameDirExists: false, exeExists: false, achievements: { total: 63, unlocked: 0 }, goldberg: null, emulated: false })
  );
  assert.equal(empty.state, STATE.NOT_TRACKING);
  assert.equal(empty.reason, 'install-gone');
});

test('a game AW Next never found an install for, with nothing recorded, is Not tracking', () => {
  const report = deriveHealth(
    healthyGame({
      gameDir: '',
      gameDirExists: false,
      installed: false,
      exe: '',
      exeExists: false,
      achievements: { total: 63, unlocked: 0 },
      goldberg: null,
      emulated: false,
    })
  );
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.equal(report.reason, 'not-installed');
});

test('the signature case: everything present, no progress recorded yet', () => {
  const report = deriveHealth(
    healthyGame({
      achievements: { total: 63, unlocked: 0 },
      goldberg: { ...healthyGame().goldberg, save: { exists: false, type: null, earned: 0, total: 0 } },
    })
  );
  // Nothing is broken, so this must not be reported as untracked.
  assert.equal(report.state, STATE.ATTENTION);
  assert.equal(report.reason, 'no-progress-yet');
  assert.equal(checkFor(report, 'progress').level, LEVEL.WARN);
  assert.equal(checkFor(report, 'achievement-data').level, LEVEL.OK);
});

test('a genuine 0% game with a save file present is not treated as a fault', () => {
  const report = deriveHealth(
    healthyGame({
      achievements: { total: 63, unlocked: 0 },
      goldberg: { ...healthyGame().goldberg, save: { exists: true, type: 'gbe', earned: 0, total: 63 } },
    })
  );
  assert.equal(report.state, STATE.READY);
  assert.equal(report.reason, 'nothing-unlocked-yet');
  assert.equal(checkFor(report, 'progress').level, LEVEL.INFO);
});

test('a schema present with no emulator dll offers the runtime repair and nothing broader', () => {
  const report = deriveHealth(healthyGame({ goldberg: { ...healthyGame().goldberg, dllCount: 0 } }));
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.equal(report.reason, 'emulator-runtime-missing');
  assert.ok(report.actions.includes(ACTION.INSTALL_RUNTIME));
  assert.ok(!report.actions.includes(ACTION.REPAIR_DATA), 'the schema is fine — only the runtime is missing');
});

test('no emulator at all explains the problem without offering a repair AW Next cannot do here', () => {
  const report = deriveHealth(healthyGame({ goldberg: { ...healthyGame().goldberg, steamSettings: null, dllCount: 0 } }));
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.equal(report.reason, 'emulator-missing');
  assert.ok(!report.actions.includes(ACTION.INSTALL_RUNTIME), 'the full emulator setup chain is not offered from here');
  assert.ok(!report.actions.includes(ACTION.REPAIR_DATA));
});

test('achievements missing from the emulator file offer the data rewrite', () => {
  const report = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        achievements: { expected: 63, found: 60, missing: ['A', 'B', 'C'], missingIcons: [] },
        issues: [{ level: 'error', code: 'MISSING_ACHIEVEMENTS', message: '3 achievement(s) ... are absent' }],
      },
    })
  );
  assert.equal(report.state, STATE.ATTENTION, 'an incomplete schema is fixable, not untracked');
  assert.equal(report.reason, 'achievement-data-incomplete');
  assert.equal(report.actions[0], ACTION.REPAIR_DATA);
  assert.deepEqual(checkFor(report, 'achievement-data').params, { total: 63, missing: 3 });
});

test('an emulator row names the subjects at fault instead of counting them', () => {
  const report = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        issues: [
          { level: 'warning', code: 'APPID_MISMATCH', message: 'steam_appid.txt (1) does not match (2).' },
          { level: 'warning', code: 'NO_DLC_CONFIG', message: 'configs.app.ini is missing' },
          { level: 'warning', code: 'BAD_DLC_CONFIG', message: 'unlock_all is not set' },
        ],
      },
    })
  );
  // Two distinct subjects from three issues — the row says what to look at, not how many.
  assert.deepEqual(checkFor(report, 'emulator').params.topics, ['appid', 'dlc']);
});

test('a game with no gameIndex entry is only flagged when the process monitor is what tracks it', () => {
  // A PlayStation record is followed by its own watcher; demanding an executable for it was a
  // guaranteed false alarm on every console game in the library.
  const console = deriveHealth(
    healthyGame({ system: 'playstation', source: 'RPCS3 Emulator', emulated: false, goldberg: null, processTracking: false, tracking: { indexed: false, binary: '' } })
  );
  assert.equal(checkFor(console, 'tracking'), undefined, 'no live-tracking row for a console record');
  assert.equal(console.state, STATE.READY);

  const pc = deriveHealth(healthyGame({ tracking: { indexed: false, binary: '' } }));
  assert.equal(checkFor(pc, 'tracking').level, LEVEL.WARN, 'a PC game still gets the row');
});

test('a non-Goldberg emulator is never asked for a steam_settings folder', () => {
  // A CODEX/OnlineFix/SmartSteamEmu game keeps its unlocks elsewhere. The caller proves whether
  // Goldberg is in play; without that proof there must be no emulator verdict at all.
  const report = deriveHealth(
    healthyGame({
      source: 'OnlineFix',
      emulated: false,
      goldberg: null,
      achievements: { total: 30, unlocked: 4 },
      saveSources: [{ source: 'OnlineFix', path: 'C:/Users/Public/Documents/OnlineFix/1234' }],
    })
  );
  assert.equal(checkFor(report, 'emulator'), undefined, 'no Goldberg verdict without Goldberg');
  assert.equal(report.state, STATE.READY);
  assert.deepEqual(report.technical.saveSources, [{ source: 'OnlineFix', path: 'C:/Users/Public/Documents/OnlineFix/1234' }]);
});

test('a cracked game with no unlocks yet is not accused of a broken setup', () => {
  const report = deriveHealth(
    healthyGame({ source: 'Codex', emulated: false, goldberg: null, achievements: { total: 30, unlocked: 0 } })
  );
  assert.equal(checkFor(report, 'progress').level, LEVEL.INFO, 'nowhere was searched, so nothing is wrong');
  assert.notEqual(report.reason, 'no-progress-yet');
});

test('only repairable emulator issues offer the rewrite', () => {
  const unrepairable = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        issues: [{ level: 'warning', code: 'CUSTOM_SAVE_PATH', message: 'configs.user.ini sets local_save_path=…' }],
      },
    })
  );
  assert.equal(unrepairable.state, STATE.ATTENTION);
  assert.ok(!unrepairable.actions.includes(ACTION.REPAIR_DATA), 'a custom save path is not something repair() rewrites');

  const repairable = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        issues: [{ level: 'warning', code: 'NO_DLC_CONFIG', message: 'configs.app.ini is missing' }],
      },
    })
  );
  assert.ok(repairable.actions.includes(ACTION.REPAIR_DATA));
});

test('an unwatched game offers to start watching only when an executable is known', () => {
  const withExe = deriveHealth(healthyGame({ tracking: { indexed: false, binary: '' } }));
  assert.equal(withExe.reason, 'not-watched');
  assert.ok(withExe.actions.includes(ACTION.START_TRACKING));

  const withoutExe = deriveHealth(healthyGame({ tracking: { indexed: false, binary: '' }, exe: '', exeExists: false }));
  assert.ok(!withoutExe.actions.includes(ACTION.START_TRACKING), 'nothing to seed the watchdog index with');
  assert.ok(withoutExe.actions.includes(ACTION.CHOOSE_EXE));
});

test('muted progress is reported as a setting, not a fault', () => {
  const report = deriveHealth(healthyGame({ notifications: { transport: 'both', progressMuted: true } }));
  assert.equal(report.state, STATE.READY, 'muting progress notifications does not break a game');
  assert.equal(report.reason, 'progress-muted');
  assert.equal(checkFor(report, 'notifications').level, LEVEL.INFO);
  assert.ok(report.actions.includes(ACTION.UNMUTE_PROGRESS));
});

test('an official-launcher game is judged without any emulator check', () => {
  const report = deriveHealth(
    healthyGame({ source: 'Steam (installed)', emulated: false, goldberg: null, achievements: { total: 40, unlocked: 3 } })
  );
  assert.equal(report.state, STATE.READY);
  assert.equal(checkFor(report, 'emulator'), undefined, 'no emulator row for a game that does not use one');
});

test('a Ubisoft game reports its own emulator diagnosis', () => {
  const report = deriveHealth(
    healthyGame({
      emulated: false,
      goldberg: null,
      isUbisoft: true,
      achievements: { total: 50, unlocked: 0 },
      uplay: {
        ok: false,
        mapping: null,
        issues: [{ level: 'error', code: 'NO_STEAM_MAPPING', message: 'No Steam equivalent found' }],
        save: null,
      },
    })
  );
  assert.equal(report.state, STATE.NOT_TRACKING, 'an unmapped Ubisoft game cannot be followed');
  assert.equal(report.reason, 'uplay-broken');
});

test('a Ubisoft game whose mapping resolved is fixable rather than untracked', () => {
  const report = deriveHealth(
    healthyGame({
      emulated: false,
      goldberg: null,
      isUbisoft: true,
      uplay: {
        ok: false,
        mapping: { steam_appid: '242050' },
        issues: [{ level: 'error', code: 'NO_SCHEMA_JSON', message: 'achievements schema is missing' }],
        save: null,
      },
    })
  );
  assert.equal(report.state, STATE.ATTENTION);
});

test('every offered action is unique and led by the fix for the reported problem', () => {
  const report = deriveHealth(
    healthyGame({
      gameDirExists: false,
      exeExists: false,
      tracking: { indexed: false, binary: '' },
      notifications: { transport: 'toast', progressMuted: true },
    })
  );
  assert.equal(new Set(report.actions).size, report.actions.length, 'no action is offered twice');
  assert.equal(report.actions[0], ACTION.CHOOSE_EXE);
});

test('technical details keep the exact values the primary UI leaves out', () => {
  const report = deriveHealth(healthyGame());
  const technical = report.technical;
  assert.equal(technical.gameDir, 'C:/Jeux/Hollow Knight');
  assert.equal(technical.goldberg.steamSettings, 'C:/Jeux/Hollow Knight/steam_settings');
  assert.equal(technical.goldberg.emulator, 'gbe');
  assert.equal(technical.goldberg.issues[0].code, 'SAVE_PRESENT');
  assert.deepEqual(technical.goldberg.save, { exists: true, type: 'gbe', earned: 12, total: 63 });
  assert.equal(technical.tracking.binary, 'hollow_knight.exe');
  assert.equal(technical.playtime.total, 7200);
  assert.ok(JSON.stringify(technical).length > 0, 'the block must be serialisable for a bug report');
});

test('a game AW Next knows almost nothing about still produces a usable report', () => {
  const report = deriveHealth({});
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.ok(report.reason, 'an explanation is always chosen');
  assert.ok(report.checks.length > 0);
  assert.ok(Array.isArray(report.actions));
});

test('a game known only through its emulator save is tracked, not written off', () => {
  // Most cracked games have no resolved install folder: AW Next re-reads their save every scan.
  // Calling that "Not tracking" condemned an entire working library.
  const report = deriveHealth(
    healthyGame({
      gameDir: '',
      gameDirExists: false,
      installed: false,
      exe: '',
      exeExists: false,
      emulated: false,
      goldberg: null,
      achievements: { total: 42, unlocked: 0 },
      saveSources: [{ source: 'Rune', path: 'C:/Users/Public/Documents/Steam/RUNE/1245620' }],
    })
  );
  assert.equal(report.state, STATE.ATTENTION, 'a limitation, not a dead end');
  assert.equal(report.reason, 'install-unknown', 'the sentence must match the state, not claim all is well');
  assert.equal(checkFor(report, 'install').level, LEVEL.WARN);
  assert.ok(report.actions.includes(ACTION.CHOOSE_EXE));
});

test('with no save and no install there is genuinely nothing to follow', () => {
  const report = deriveHealth(
    healthyGame({ gameDir: '', gameDirExists: false, installed: false, exe: '', exeExists: false, emulated: false, goldberg: null, saveSources: [], achievements: { total: 42, unlocked: 0 } })
  );
  assert.equal(report.state, STATE.NOT_TRACKING);
  assert.equal(report.reason, 'not-installed');
});

test('a lost install folder still counts as tracked while its save survives', () => {
  const report = deriveHealth(
    healthyGame({ gameDirExists: false, exeExists: false, saveSources: [{ source: 'gbe', path: 'C:/x/GSE Saves/1' }] })
  );
  assert.equal(report.state, STATE.ATTENTION, 'the unlocks already recorded remain readable');
  assert.equal(checkFor(report, 'install').blocking, false);
});

/*
  Notification state. Which transport is configured is a setting; which one actually delivered is an
  observation the Watchdog records per game (watchdog/util/transportMemory.js). Reporting the second
  is what stops the automatic fallback from reading as a fault: no overlay appeared, and that was the
  intended behaviour.
*/
test('a game with no notification yet is reported from the setting alone', () => {
  const report = deriveHealth(healthyGame({ notifications: { transport: 'auto', progressMuted: false } }));
  const check = checkFor(report, 'notifications');
  assert.equal(check.level, LEVEL.OK);
  assert.equal(check.params.transport, 'auto');
  assert.equal(check.params.effective, undefined, 'nothing observed must not be presented as an observation');
});

test('a fallback delivery is reported as working, naming the transport that ran and why', () => {
  const report = deriveHealth(
    healthyGame({
      notifications: {
        transport: 'auto',
        progressMuted: false,
        effective: { transport: 'toast', reason: 'fullscreen-hidden', outcome: 'delivered' },
      },
    })
  );
  const check = checkFor(report, 'notifications');
  assert.equal(check.level, LEVEL.OK, 'the fallback doing its job is not a problem to report');
  assert.equal(report.state, STATE.READY);
  assert.equal(check.params.effective, 'toast');
  assert.equal(check.params.effectiveReason, 'fullscreen-hidden');
});

test('a transport that reported the send failing is the one notification state worth flagging', () => {
  const report = deriveHealth(
    healthyGame({
      notifications: {
        transport: 'auto',
        progressMuted: false,
        effective: { transport: 'toast', reason: 'overlay-failing', outcome: 'failed' },
      },
    })
  );
  assert.equal(checkFor(report, 'notifications').level, LEVEL.WARN);
  assert.equal(report.state, STATE.ATTENTION);
  assert.equal(report.reason, 'notification-failed', 'the sentence must name the notification, not the game setup');
  assert.ok(report.actions.includes(ACTION.TEST_NOTIFICATION));
});

// An unconfirmed delivery is not a failure: the Watchdog could not observe the outcome, which is
// reported as such rather than being escalated into a fault the user cannot act on.
test('an unconfirmed delivery leaves the game Ready', () => {
  const report = deriveHealth(
    healthyGame({
      notifications: {
        transport: 'overlay',
        progressMuted: false,
        effective: { transport: 'overlay', reason: 'forced-overlay', outcome: 'unknown' },
      },
    })
  );
  assert.equal(report.state, STATE.READY);
  assert.equal(checkFor(report, 'notifications').params.outcome, 'unknown');
});

test('a muted game still reports which transport delivered its unlocks', () => {
  const report = deriveHealth(
    healthyGame({
      notifications: {
        transport: 'auto',
        progressMuted: true,
        effective: { transport: 'overlay', reason: 'overlay', outcome: 'delivered' },
      },
    })
  );
  const check = checkFor(report, 'notifications');
  assert.equal(check.level, LEVEL.INFO);
  assert.equal(check.params.effective, 'overlay');
  assert.ok(check.actions.includes(ACTION.UNMUTE_PROGRESS));
});

/*
  A steam_appid.txt that names another game. It was the one diagnosis with no way out: "rewrite the
  achievement data" deliberately never overwrites an existing steam_appid.txt, so offering it would
  have left the warning standing, and the row named a file without saying what was wrong with it.
*/
function mismatchedAppid(overrides = {}) {
  return healthyGame({
    goldberg: {
      ...healthyGame().goldberg,
      issues: [
        {
          level: 'warning',
          code: 'APPID_MISMATCH',
          message: 'steam_appid.txt (111) does not match the detected appid (367520).',
          data: { onDisk: '111', expected: '367520', file: 'C:/Jeux/Hollow Knight/steam_settings/steam_appid.txt' },
        },
      ],
    },
    ...overrides,
  });
}

test('a mismatched game ID offers its own one-file repair, carrying both values', () => {
  const report = deriveHealth(mismatchedAppid());
  const check = checkFor(report, 'emulator');
  assert.equal(check.level, LEVEL.WARN);
  assert.ok(report.actions.includes(ACTION.FIX_APPID), 'the dead end was having no action at all');
  assert.equal(check.params.appidOnDisk, '111');
  assert.equal(check.params.appidExpected, '367520');
});

test('the mismatch is what the explanation names, ahead of the symptom it causes', () => {
  // No progress is the SYMPTOM of watching the wrong appid, so it must not win the sentence.
  const report = deriveHealth(mismatchedAppid({ achievements: { total: 63, unlocked: 0 } }));
  assert.equal(report.reason, 'appid-mismatch');
  assert.equal(report.params.appidExpected, '367520');
});

test('an issue with no structured values cannot offer the appid repair', () => {
  // The repair writes a specific number; without one there is nothing to write.
  const report = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        issues: [{ level: 'warning', code: 'APPID_MISMATCH', message: 'steam_appid.txt does not match.' }],
      },
    })
  );
  assert.equal(report.actions.includes(ACTION.FIX_APPID), false);
});

test('the appid repair is offered beside the schema repair, not instead of it', () => {
  const report = deriveHealth(
    healthyGame({
      goldberg: {
        ...healthyGame().goldberg,
        issues: [
          { level: 'warning', code: 'NO_DLC_CONFIG', message: 'configs.app.ini is missing.' },
          { level: 'warning', code: 'APPID_MISMATCH', message: 'x', data: { onDisk: '111', expected: '367520' } },
        ],
      },
    })
  );
  assert.ok(report.actions.includes(ACTION.REPAIR_DATA));
  assert.ok(report.actions.includes(ACTION.FIX_APPID));
});
