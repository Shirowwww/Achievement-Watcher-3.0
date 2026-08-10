'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolvePowerShell } = require('./util/powershell.js');
const debug = require('./util/log.js');
const execFileAsync = promisify(execFile);

const QUERY_USER_NOTIFICATION_STATE = {
  1: 'QUNS_NOT_PRESENT',
  2: 'QUNS_BUSY',
  3: 'QUNS_RUNNING_D3D_FULL_SCREEN',
  4: 'QUNS_PRESENTATION_MODE',
  5: 'QUNS_ACCEPTS_NOTIFICATIONS',
  6: 'QUNS_QUIET_TIME',
  7: 'QUNS_APP',
};

// States in which a game (or any other full-screen app) is on top of everything else. Used to
// decide whether a watched game counts as "running" without shelling out to tasklist.
const FULLSCREEN_STATES = ['QUNS_BUSY', 'QUNS_RUNNING_D3D_FULL_SCREEN', 'QUNS_PRESENTATION_MODE', 'QUNS_APP'];

// States in which Windows accepts a toast but never pops it on screen — it goes straight to the
// notification centre. This is why achievement toasts appeared to be lost while playtime toasts
// (fired once the game has exited) always showed up: the automatic "playing a game" / "using an
// app in full screen mode" do-not-disturb rules are on by default on Windows 11 (issue #18).
const POPUP_SUPPRESSED_STATES = [...FULLSCREEN_STATES, 'QUNS_QUIET_TIME'];

// SHQueryUserNotificationState is a shell32 export, not a .NET method: it has to be imported with a
// DllImport member definition. `Add-Type -AssemblyName shell32` — what this used to do — looks
// plausible but there is no such assembly, so PowerShell wrote two errors to stderr, left $state at
// its initialised 0, and still EXITED 0. The reader then parsed "0", found no matching state (the
// enum starts at 1) and returned null forever, without ever reaching its catch. Every caller
// silently answered "false" on every Windows machine. Keep the HRESULT check: a non-zero hr means
// the value is meaningless, and must be an error rather than a plausible-looking state.
const QUERY_SCRIPT = `
  $ErrorActionPreference = 'Stop';
  Add-Type -Namespace AchievementWatcher -Name Shell32 -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);';
  $state = 0;
  $hr = [AchievementWatcher.Shell32]::SHQueryUserNotificationState([ref]$state);
  if ($hr -ne 0) { throw "SHQueryUserNotificationState failed with hr=$hr" }
  Write-Output $state;
`;

// Querying costs a PowerShell round-trip, and a save file that unlocks a whole batch of
// achievements asks the same question once per achievement. One shared answer per second is plenty:
// the display state cannot meaningfully change faster than a toast is built.
const STATE_TTL_MS = 1000;
let cached = { at: 0, state: null, valid: false };

// The TTL alone does not help a burst: a save file that unlocks twenty achievements at once asks
// twenty times before the first answer has come back, so every caller misses the cache and starts
// its own round-trip. That was survivable when the query was broken and returned instantly; a real
// query costs a PowerShell start plus a C# compile, so the burst has to share one. Callers that
// arrive while a query is running await that same promise.
let inFlight = null;

// A machine where the query cannot work (not Windows, PowerShell locked down, shell32 import
// refused) would otherwise repeat the same warning every second. Say it once, loudly, and again
// only if the situation changes — a silent unusable query is what hid the bug above.
let lastReportedFailure = null;

function reportFailure(reason) {
  if (lastReportedFailure === reason) return;
  lastReportedFailure = reason;
  debug.warn(`Could not read the user notification state (${reason}) — full-screen/quiet-hours detection is unavailable`);
}

function queryUserNotificationState() {
  if (cached.valid && Date.now() - cached.at < STATE_TTL_MS) return Promise.resolve(cached.state);
  if (inFlight) return inFlight;
  inFlight = readNotificationState();
  // Clear the slot however it settles, so a failed query never wedges every later caller onto a
  // rejected promise. readNotificationState resolves rather than throws, but this must hold even if
  // that ever changes.
  inFlight.catch(() => {}).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readNotificationState() {
  const now = Date.now();
  let state = null;
  try {
    if (process.platform !== 'win32') throw new Error('not a Windows host');
    const { stdout } = await execFileAsync(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', QUERY_SCRIPT]);
    const raw = String(stdout).trim();
    state = QUERY_USER_NOTIFICATION_STATE[Number.parseInt(raw, 10)] || null;
    // Anything the enum does not cover means the query did not actually run. Treat it as the
    // failure it is instead of quietly degrading to "nothing is suppressed".
    if (!state) throw new Error(`unrecognized state ${JSON.stringify(raw)}`);
    lastReportedFailure = null;
  } catch (err) {
    state = null;
    reportFailure(err.message || String(err));
  }

  // Cache failures too, so a permanently broken query costs one round-trip per second at most.
  cached = { at: now, state, valid: true };
  return state;
}

async function isFullscreenAppRunning() {
  return FULLSCREEN_STATES.includes(await queryUserNotificationState());
}

// True only when Windows is known to be swallowing toast popups. An unknown state (query failed,
// not Windows) answers false so a working notification is never suppressed on a guess.
async function arePopupsSuppressed() {
  return POPUP_SUPPRESSED_STATES.includes(await queryUserNotificationState());
}

// Tests drive this through several states in a row; the 1s cache would otherwise leak between them.
function _resetCache() {
  cached = { at: 0, state: null, valid: false };
  inFlight = null;
  lastReportedFailure = null;
}

module.exports = {
  isFullscreenAppRunning,
  arePopupsSuppressed,
  queryUserNotificationState,
  FULLSCREEN_STATES,
  POPUP_SUPPRESSED_STATES,
  QUERY_USER_NOTIFICATION_STATE,
  _resetCache,
};
