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

// Windows states that indicate a foreground/full-screen app.
const FULLSCREEN_STATES = ['QUNS_BUSY', 'QUNS_RUNNING_D3D_FULL_SCREEN', 'QUNS_PRESENTATION_MODE', 'QUNS_APP'];

// States where Windows sends toasts to the notification centre instead of showing a popup.
const POPUP_SUPPRESSED_STATES = [...FULLSCREEN_STATES, 'QUNS_QUIET_TIME'];

// Import the shell32 function directly and reject failed HRESULTs.
const QUERY_SCRIPT = `
  $ErrorActionPreference = 'Stop';
  Add-Type -Namespace AchievementWatcher -Name Shell32 -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);';
  $state = 0;
  $hr = [AchievementWatcher.Shell32]::SHQueryUserNotificationState([ref]$state);
  if ($hr -ne 0) { throw "SHQueryUserNotificationState failed with hr=$hr" }
  Write-Output $state;
`;

// Share the answer briefly across a batch of notifications.
const STATE_TTL_MS = 1000;
let cached = { at: 0, state: null, valid: false };

// Share the in-flight query too; a batch can arrive before the first result.
let inFlight = null;

// Avoid repeating the same failure warning every second.
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
  // Always release the shared promise slot.
  inFlight.catch(() => {}).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readNotificationState() {
  let state = null;
  try {
    if (process.platform !== 'win32') throw new Error('not a Windows host');
    const { stdout } = await execFileAsync(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', QUERY_SCRIPT]);
    const raw = String(stdout).trim();
    state = QUERY_USER_NOTIFICATION_STATE[Number.parseInt(raw, 10)] || null;
    // Unknown output means the query failed.
    if (!state) throw new Error(`unrecognized state ${JSON.stringify(raw)}`);
    lastReportedFailure = null;
  } catch (err) {
    state = null;
    reportFailure(err.message || String(err));
  }

  // Cache failures too, and start the TTL after PowerShell returns.
  cached = { at: Date.now(), state, valid: true };
  return state;
}

async function isFullscreenAppRunning() {
  return FULLSCREEN_STATES.includes(await queryUserNotificationState());
}

// Unknown states never suppress a working notification.
async function arePopupsSuppressed() {
  return POPUP_SUPPRESSED_STATES.includes(await queryUserNotificationState());
}

/*
  Whether an always-on-top window would play where nobody can see it. Only exclusive full-screen
  Direct3D qualifies: that app owns the display's swap chain, so the desktop compositor never puts
  our popup on top of it. A borderless/windowed game reports one of the other busy states and the
  overlay does appear over it, which is why this deliberately does not reuse FULLSCREEN_STATES.

  Returns null when the state could not be read — the caller must treat that as "unknown", not as
  "fine": tri-state is what keeps a failed query from silently selecting an invisible transport.
*/
async function isOverlayLikelyHidden() {
  const state = await queryUserNotificationState();
  if (!state) return null;
  return state === 'QUNS_RUNNING_D3D_FULL_SCREEN';
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
  isOverlayLikelyHidden,
  queryUserNotificationState,
  FULLSCREEN_STATES,
  POPUP_SUPPRESSED_STATES,
  QUERY_USER_NOTIFICATION_STATE,
  _resetCache,
};
