'use strict';

/*
  Turns the per-game signals AW Next already collects (install folder, executable, achievement
  schema, emulator diagnosis, runtime save, watchdog index, notification settings) into one overall
  state, one plain-language explanation, a list of checks and the repair actions that genuinely
  exist for this game.

  Deliberately pure: no fs, no Electron, no i18n. Signals come in as plain data and everything user
  visible comes out as an ID the renderer resolves through t(). That keeps every branch below
  testable without a window, a game install or a locale bundle.
*/

const STATE = { READY: 'ready', ATTENTION: 'attention', NOT_TRACKING: 'not-tracking' };
const LEVEL = { OK: 'ok', WARN: 'warn', FAIL: 'fail', INFO: 'info' };

// Repair actions. Each one maps to a capability AW Next already has - nothing here is aspirational.
const ACTION = {
  CHOOSE_EXE: 'choose-exe', //    the panel's own executable picker
  OPEN_FOLDER: 'open-folder', //  shell.openPath(gameDir)
  REPAIR_DATA: 'repair-data', //  goldberg.repair() - writes schema + icons + configs, backs up first
  INSTALL_RUNTIME: 'install-runtime', // gbeInstaller.installDlls() - backs up replaced dlls as .bak
  START_TRACKING: 'start-tracking', //  gameIndex.upsert() - the same seed the scan writes
  UNMUTE_PROGRESS: 'unmute-progress', // progressMute.toggle()
  TEST_NOTIFICATION: 'test-notification', // the watchdog websocket test the Settings panel uses
  FIX_APPID: 'fix-appid', //          goldberg.writeSteamAppId() - one file, previous value kept
};

// goldberg.diagnose() issue codes that goldberg.repair() actually rewrites. Mirrors the list the
// right-click diagnosis uses to decide whether to offer its repair button.
const REPAIRABLE_GOLDBERG_CODES = new Set([
  'NO_ACHIEVEMENTS_JSON',
  'BAD_ACHIEVEMENTS_JSON',
  'ACHIEVEMENTS_JSON_NOT_ARRAY',
  'MISSING_ACHIEVEMENTS',
  'NO_STEAM_SETTINGS',
  'NO_APPID_TXT',
  'MISSING_ICONS',
  'NO_DLC_CONFIG',
  'NO_MAIN_CONFIG',
  'NO_NEW_APP_TICKET',
  'NO_GC_TOKEN',
  'NO_USER_CONFIG',
  'BAD_DLC_CONFIG',
  'BAD_USER_CONFIG',
  // Both are properties of achievements.json, which the repair rewrites from the fetched schema.
  // They were raised as warnings with no action attached, so a game whose only fault was a fabricated
  // achievement list showed a permanent yellow row and offered no way to clear it.
  'BLANK_NAMES',
  'BLANK_DESCRIPTIONS',
]);

/*
  Which part of the setup each diagnosis code is about. "2 points to review" told the user a number
  and nothing else; grouping the codes lets the row name the actual subjects instead, while the
  individual codes and messages stay available under Technical details.
*/
const ISSUE_TOPIC = {
  NO_ACHIEVEMENTS_JSON: 'schema',
  BAD_ACHIEVEMENTS_JSON: 'schema',
  ACHIEVEMENTS_JSON_NOT_ARRAY: 'schema',
  MISSING_ACHIEVEMENTS: 'schema',
  BLANK_NAMES: 'schema',
  BLANK_DESCRIPTIONS: 'schema',
  NO_SCHEMA_JSON: 'schema',
  BAD_SCHEMA_JSON: 'schema',
  SCHEMA_KEYS_UNPREFIXED: 'schema',
  SCHEMA_KEYS_PREFIXED: 'schema',
  MISSING_ICONS: 'icons',
  NO_APPID_TXT: 'appid',
  APPID_MISMATCH: 'appid',
  NO_DLC_CONFIG: 'dlc',
  BAD_DLC_CONFIG: 'dlc',
  NO_MAIN_CONFIG: 'compat',
  NO_NEW_APP_TICKET: 'compat',
  NO_GC_TOKEN: 'compat',
  NO_INI: 'compat',
  NO_USER_CONFIG: 'account',
  BAD_USER_CONFIG: 'account',
  CUSTOM_SAVE_PATH: 'savepath',
  LOADER_NO_ACH_REDIRECT: 'loader',
  NO_STEAM_MAPPING: 'mapping',
};

// Distinct topics raised by these issues, in a stable order so the row text doesn't reshuffle.
function issueTopics(issues) {
  const topics = [];
  for (const issue of issues || []) {
    const topic = ISSUE_TOPIC[issue && issue.code];
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function issuesAtLevel(report, level) {
  if (!report || !Array.isArray(report.issues)) return [];
  return report.issues.filter((issue) => issue && issue.level === level);
}

/*
  The appid the emulator will announce disagrees with the one AW Next resolved. It is the one
  diagnosis whose fix is a single known value written to a single file, so it gets its own action
  instead of being folded into "rewrite the achievement data" - which deliberately never overwrites
  an existing steam_appid.txt, and would therefore have left this exact warning standing.
*/
function appidMismatch(report) {
  const issue = (report && Array.isArray(report.issues) ? report.issues : []).find(
    (entry) => entry && entry.code === 'APPID_MISMATCH' && entry.data && entry.data.expected
  );
  return issue ? issue.data : null;
}

/*
  One check row. `blocking` marks the failures that mean AW Next cannot observe this game at all -
  those are what separate "Not tracking" from "Needs attention", so a merely incomplete setup never
  gets reported as untracked.
*/
function check(id, level, { params = {}, blocking = false, actions = [] } = {}) {
  return { id, level, params, blocking, actions };
}

/*
  An unknown install folder limits repairs and playtime; it does not by itself stop tracking. Most
  cracked games are known to AW Next only through their emulator's save folder, which it re-reads on
  every scan - reporting those as untracked called a whole library broken when nothing was.
*/
function readableWithoutInstall(signals) {
  if (Array.isArray(signals.saveSources) && signals.saveSources.length > 0) return true;
  return num(signals.achievements && signals.achievements.unlocked) > 0;
}

function installCheck(signals) {
  const { gameDir, gameDirExists, installed } = signals;
  const readable = readableWithoutInstall(signals);
  if (gameDir && gameDirExists) return check('install', LEVEL.OK, { params: { path: gameDir } });
  if (gameDir && !gameDirExists) {
    // The folder was resolved once and is gone now: moved, uninstalled or an unmounted drive.
    return check('install', LEVEL.FAIL, { params: { path: gameDir }, blocking: !readable, actions: [ACTION.CHOOSE_EXE] });
  }
  if (installed || readable) return check('install', LEVEL.WARN, { actions: [ACTION.CHOOSE_EXE] });
  return check('install', LEVEL.FAIL, { blocking: true, actions: [ACTION.CHOOSE_EXE] });
}

function executableCheck(signals) {
  const { exe, exeExists, gameDir } = signals;
  if (exe && exeExists) return check('executable', LEVEL.OK, { params: { path: exe } });
  if (exe && !exeExists) return check('executable', LEVEL.FAIL, { params: { path: exe }, actions: [ACTION.CHOOSE_EXE] });
  // No executable is only worth reporting once AW Next knows where to look for one.
  if (!gameDir) return null;
  return check('executable', LEVEL.WARN, { actions: [ACTION.CHOOSE_EXE] });
}

function identityCheck(signals) {
  const { appid, steamappid, source, unconfigured } = signals;
  const resolved = steamappid || (/^\d+$/.test(String(appid || '')) ? String(appid) : '');
  if (resolved && !unconfigured) return check('identity', LEVEL.OK, { params: { appid: resolved, source: source || '' } });
  if (resolved) return check('identity', LEVEL.WARN, { params: { appid: resolved, source: source || '' } });
  return check('identity', LEVEL.WARN, { params: { source: source || '' } });
}

function achievementDataCheck(signals) {
  const total = num(signals.achievements && signals.achievements.total);
  const goldberg = signals.goldberg;

  if (total === 0) {
    // An emulated game with a readable on-disk schema still has data even when the app's own
    // list came back empty, so only call it missing when neither source produced anything.
    const onDisk = goldberg ? num(goldberg.achievements && goldberg.achievements.found) : 0;
    if (onDisk > 0) return check('achievement-data', LEVEL.WARN, { params: { found: onDisk } });
    return check('achievement-data', LEVEL.FAIL, { blocking: true });
  }

  if (goldberg && goldberg.steamSettings) {
    const missing = (goldberg.achievements && goldberg.achievements.missing) || [];
    const missingIcons = (goldberg.achievements && goldberg.achievements.missingIcons) || [];
    const repairable = issuesAtLevel(goldberg, 'error')
      .concat(issuesAtLevel(goldberg, 'warning'))
      .some((issue) => REPAIRABLE_GOLDBERG_CODES.has(issue.code));
    if (missing.length > 0) {
      return check('achievement-data', LEVEL.FAIL, {
        params: { total, missing: missing.length },
        actions: [ACTION.REPAIR_DATA],
      });
    }
    if (missingIcons.length > 0) {
      return check('achievement-data', LEVEL.WARN, {
        params: { total, missingIcons: missingIcons.length },
        actions: [ACTION.REPAIR_DATA],
      });
    }
    if (repairable) return check('achievement-data', LEVEL.WARN, { params: { total }, actions: [ACTION.REPAIR_DATA] });
  }

  return check('achievement-data', LEVEL.OK, { params: { total } });
}

/*
  Goldberg/GBE setup, for the games whose unlocks can only come from one. Split from the achievement
  data check because "the schema is fine but nothing will ever write to it" is a different problem
  with a different fix.

  `emulated` means specifically "Goldberg/GBE is this game's achievement mechanism", proven on disk
  by the caller. It must never be inferred from the source label: CODEX, RUNE, OnlineFix,
  SmartSteamEmu, TENOKE and Goldberg SocialClub are all emulators that keep their unlocks somewhere
  else entirely, and demanding a steam_settings folder from them reported working games as broken.
*/
function emulatorCheck(signals) {
  const goldberg = signals.goldberg;
  if (!signals.emulated || !goldberg) return null;

  const dllCount = num(goldberg.dllCount);
  if (!goldberg.steamSettings && dllCount === 0) {
    // Nothing is set up at all. The full setup chain lives in the right-click menu; offering a
    // partial copy of it here would fork that flow, so this check explains and stops.
    return check('emulator', LEVEL.FAIL, { blocking: true });
  }
  if (goldberg.steamSettings && dllCount === 0) {
    // The schema is present but no steam_api dll will ever read it. installDlls() repairs exactly
    // this, backing the replaced file up as .bak.
    return check('emulator', LEVEL.FAIL, { blocking: true, actions: [ACTION.INSTALL_RUNTIME] });
  }
  if (!goldberg.steamSettings) return check('emulator', LEVEL.FAIL, { params: { emulator: goldberg.emulator || 'none' }, blocking: true });

  // Offered alongside whatever else the report raises: a mismatched appid is its own one-file fix.
  const mismatch = appidMismatch(goldberg);
  const withAppidFix = (actions) => (mismatch ? [...actions, ACTION.FIX_APPID] : actions);
  const appidParams = mismatch ? { appidOnDisk: mismatch.onDisk, appidExpected: mismatch.expected } : {};

  const errors = issuesAtLevel(goldberg, 'error');
  if (errors.length > 0) {
    const actions = errors.some((issue) => REPAIRABLE_GOLDBERG_CODES.has(issue.code)) ? [ACTION.REPAIR_DATA] : [];
    return check('emulator', LEVEL.FAIL, {
      params: { emulator: goldberg.emulator || 'none', topics: issueTopics(errors), ...appidParams },
      actions: withAppidFix(actions),
    });
  }

  const warnings = issuesAtLevel(goldberg, 'warning');
  if (warnings.length > 0) {
    const actions = warnings.some((issue) => REPAIRABLE_GOLDBERG_CODES.has(issue.code)) ? [ACTION.REPAIR_DATA] : [];
    return check('emulator', LEVEL.WARN, {
      params: { emulator: goldberg.emulator || 'none', topics: issueTopics(warnings), ...appidParams },
      actions: withAppidFix(actions),
    });
  }

  return check('emulator', LEVEL.OK, { params: { emulator: goldberg.emulator || 'none' } });
}

function uplayCheck(signals) {
  const uplay = signals.uplay;
  if (!uplay) return null;
  const errors = issuesAtLevel(uplay, 'error');
  if (errors.length > 0) return check('uplay', LEVEL.FAIL, { params: { topics: issueTopics(errors) }, blocking: !uplay.mapping });
  const warnings = issuesAtLevel(uplay, 'warning');
  if (warnings.length > 0) return check('uplay', LEVEL.WARN, { params: { topics: issueTopics(warnings) } });
  return check('uplay', LEVEL.OK, {});
}

/*
  Has anything actually been unlocked or recorded yet. The distinction that matters is "AW Next has
  progress data" vs "AW Next has nowhere to read progress from" - a genuine 0% game is not a fault.
*/
function progressCheck(signals) {
  const unlocked = num(signals.achievements && signals.achievements.unlocked);
  const save = signals.goldberg && signals.goldberg.save;
  const uplaySave = signals.uplay && signals.uplay.save;

  if (unlocked > 0) return check('progress', LEVEL.OK, { params: { unlocked } });
  if (save && save.exists && num(save.earned) > 0) return check('progress', LEVEL.OK, { params: { unlocked: num(save.earned) } });
  if (uplaySave && uplaySave.exists && num(uplaySave.earned) > 0) return check('progress', LEVEL.OK, { params: { unlocked: num(uplaySave.earned) } });
  if (save && save.exists) return check('progress', LEVEL.INFO, { params: { type: save.type || '' } });
  // Only warn when the save location is actually known and empty. Without a diagnosed setup there
  // is nowhere to have looked, so "no progress" is just a game with no progress.
  if (signals.emulated && signals.goldberg && signals.goldberg.steamSettings) return check('progress', LEVEL.WARN, {});
  return check('progress', LEVEL.INFO, {});
}

/*
  Live tracking means the watchdog's process monitor matching a running binary. Console emulators
  and the official platform libraries are followed by their own watchers instead, so for them the
  absence of a gameIndex entry is normal and reporting it would be a false alarm.
*/
function trackingCheck(signals) {
  if (signals.processTracking === false) return null;
  const tracking = signals.tracking || {};
  if (tracking.indexed && tracking.binary) return check('tracking', LEVEL.OK, { params: { binary: tracking.binary } });
  if (signals.exe && signals.exeExists) return check('tracking', LEVEL.WARN, { actions: [ACTION.START_TRACKING] });
  return check('tracking', LEVEL.WARN, { actions: [ACTION.CHOOSE_EXE] });
}

/*
  What is configured, and - when the Watchdog has actually delivered something for this game - what
  carried it. `effective` is an observation, not a setting: the transport that ran, why it was
  chosen and how it ended ('delivered' | 'fallback' | 'unknown' | 'failed'). It is what lets the row
  say "working, through the Windows fallback" instead of naming a mode that was overridden.
*/
function notificationCheck(signals) {
  const notifications = signals.notifications || {};
  const effective = notifications.effective || null;
  const params = { transport: notifications.transport || '' };
  if (effective) {
    params.effective = effective.transport || '';
    params.effectiveReason = effective.reason || '';
    params.outcome = effective.outcome || 'delivered';
    // "It worked, but not through the transport you picked" is a decision, not a wording choice, so
    // it belongs here: the renderer must not have to compare transport ids to phrase a sentence.
    params.fallbackActive = params.outcome === 'fallback' || (!!params.effective && params.effective !== params.transport);
  }

  if (notifications.progressMuted) {
    return check('notifications', LEVEL.INFO, { params, actions: [ACTION.UNMUTE_PROGRESS, ACTION.TEST_NOTIFICATION] });
  }
  // The transport itself reported the send failing - the one notification state that is a fault
  // rather than a routing detail.
  if (effective && effective.outcome === 'failed') {
    return check('notifications', LEVEL.WARN, { params, actions: [ACTION.TEST_NOTIFICATION] });
  }
  return check('notifications', LEVEL.OK, { params, actions: [ACTION.TEST_NOTIFICATION] });
}

function buildChecks(signals) {
  return [
    installCheck(signals),
    executableCheck(signals),
    identityCheck(signals),
    achievementDataCheck(signals),
    emulatorCheck(signals),
    uplayCheck(signals),
    progressCheck(signals),
    trackingCheck(signals),
    notificationCheck(signals),
  ].filter(Boolean);
}

function byId(checks, id) {
  return checks.find((entry) => entry.id === id) || null;
}

/*
  The one sentence a user reads first. Ordered by what blocks unlocks earliest, so the explanation
  always names the root cause rather than the symptom furthest downstream.
*/
function explain(state, checks, signals) {
  const install = byId(checks, 'install');
  const data = byId(checks, 'achievement-data');
  const emulator = byId(checks, 'emulator');
  const uplay = byId(checks, 'uplay');
  const progress = byId(checks, 'progress');
  const tracking = byId(checks, 'tracking');
  const notifications = byId(checks, 'notifications');

  if (install && install.level === LEVEL.FAIL) {
    return { reason: signals.gameDir ? 'install-gone' : 'not-installed', params: install.params };
  }
  if (data && data.level === LEVEL.FAIL && data.blocking) return { reason: 'no-achievement-data', params: data.params };
  // Only a blocking emulator failure means "there is no emulator here". An emulator report that
  // merely carries schema or config errors is explained by the check that owns those instead -
  // otherwise a repairable achievements.json would be reported as a missing emulator.
  if (emulator && emulator.level === LEVEL.FAIL && emulator.blocking) {
    const canInstall = emulator.actions.includes(ACTION.INSTALL_RUNTIME);
    return { reason: canInstall ? 'emulator-runtime-missing' : 'emulator-missing', params: emulator.params };
  }
  if (uplay && uplay.level === LEVEL.FAIL) return { reason: 'uplay-broken', params: uplay.params };
  if (data && data.level === LEVEL.FAIL) return { reason: 'achievement-data-incomplete', params: data.params };
  /*
    A wrong appid outranks the "nothing unlocked yet" sentence below, because it is the reason there
    is nothing: the emulator announces one game and AW Next is watching another. Naming the topic
    ("game ID file") told the user which file was involved and nothing about what was wrong with it,
    which is exactly the dead end this branch exists to remove.
  */
  if (emulator && emulator.params && emulator.params.appidExpected) return { reason: 'appid-mismatch', params: emulator.params };
  // The signature case: everything needed is present, nothing has been recorded yet. Say where the
  // fault is likely to be, because "no notifications appeared" is the usual misread.
  if (progress && progress.level === LEVEL.WARN) return { reason: 'no-progress-yet', params: progress.params };
  if (data && data.level === LEVEL.WARN) return { reason: 'achievement-data-incomplete', params: data.params };
  if (emulator && (emulator.level === LEVEL.WARN || emulator.level === LEVEL.FAIL)) return { reason: 'emulator-partial', params: emulator.params };
  // Reading unlocks out of a save folder without knowing where the game lives is a real state, and
  // a common one for cracked games. Saying "nothing unlocked yet" here would contradict the chip.
  if (install && install.level === LEVEL.WARN) return { reason: 'install-unknown', params: install.params };
  if (tracking && tracking.level === LEVEL.WARN) return { reason: 'not-watched', params: tracking.params };
  // Everything is set up and unlocks are being seen - the last one just could not be announced.
  if (notifications && notifications.level === LEVEL.WARN) return { reason: 'notification-failed', params: notifications.params };
  if (notifications && notifications.level === LEVEL.INFO) return { reason: 'progress-muted', params: notifications.params };
  if (progress && progress.level === LEVEL.INFO) return { reason: 'nothing-unlocked-yet', params: progress.params };
  if (state === STATE.READY) return { reason: 'ready', params: {} };
  return { reason: 'attention', params: {} };
}

function deriveState(checks) {
  if (checks.some((entry) => entry.blocking && entry.level === LEVEL.FAIL)) return STATE.NOT_TRACKING;
  if (checks.some((entry) => entry.level === LEVEL.FAIL || entry.level === LEVEL.WARN)) return STATE.ATTENTION;
  return STATE.READY;
}

/*
  Everything the Technical details block shows. Kept as raw values on purpose: exact paths, counts,
  emulator issue codes and messages, so a bug report can be assembled from this alone.
*/
function buildTechnical(signals) {
  const goldberg = signals.goldberg;
  const uplay = signals.uplay;
  return {
    appid: signals.appid != null ? String(signals.appid) : '',
    steamAppid: signals.steamappid ? String(signals.steamappid) : '',
    name: signals.name || '',
    source: signals.source || '',
    system: signals.system || '',
    installed: !!signals.installed,
    gameDir: signals.gameDir || '',
    gameDirExists: !!signals.gameDirExists,
    exe: signals.exe || '',
    exeExists: !!signals.exeExists,
    achievements: {
      total: num(signals.achievements && signals.achievements.total),
      unlocked: num(signals.achievements && signals.achievements.unlocked),
    },
    emulated: !!signals.emulated,
    processTracking: signals.processTracking !== false,
    saveSources: Array.isArray(signals.saveSources) ? signals.saveSources : [],
    goldberg: goldberg
      ? {
          emulator: goldberg.emulator || 'none',
          steamSettings: goldberg.steamSettings || '',
          dllCount: num(goldberg.dllCount),
          expected: goldberg.achievements ? goldberg.achievements.expected : null,
          found: num(goldberg.achievements && goldberg.achievements.found),
          missing: ((goldberg.achievements && goldberg.achievements.missing) || []).length,
          missingIcons: ((goldberg.achievements && goldberg.achievements.missingIcons) || []).length,
          save: goldberg.save || null,
          issues: (goldberg.issues || []).map((issue) => ({ level: issue.level, code: issue.code, message: issue.message })),
        }
      : null,
    uplay: uplay
      ? {
          dll: uplay.dll || null,
          iniFile: uplay.iniFile || '',
          mapping: uplay.mapping || null,
          save: uplay.save || null,
          issues: (uplay.issues || []).map((issue) => ({ level: issue.level, code: issue.code, message: issue.message })),
        }
      : null,
    tracking: signals.tracking || { indexed: false, binary: '' },
    notifications: signals.notifications || {},
    playtime: signals.playtime || { total: 0, lastPlayed: 0 },
  };
}

/*
  signals - see buildTechnical() for the full accepted shape. Every field is optional; a game the
  app knows almost nothing about still produces a usable report.
*/
function deriveHealth(signals = {}) {
  const checks = buildChecks(signals);
  const state = deriveState(checks);
  const { reason, params } = explain(state, checks, signals);

  // Offer each action once, in the order the checks raised it, so the primary fix for the reported
  // problem is always the first button.
  const actions = [];
  for (const entry of checks) {
    for (const action of entry.actions) if (!actions.includes(action)) actions.push(action);
  }

  return { state, reason, params, checks, actions, technical: buildTechnical(signals) };
}

module.exports = { deriveHealth, issueTopics, STATE, LEVEL, ACTION, ISSUE_TOPIC, REPAIRABLE_GOLDBERG_CODES };
