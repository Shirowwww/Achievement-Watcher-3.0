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

// Querying costs a PowerShell round-trip (~100-300 ms), and a save file that unlocks a whole batch
// of achievements asks the same question once per achievement. One shared answer per second is
// plenty: the display state cannot meaningfully change faster than a toast is built.
const STATE_TTL_MS = 1000;
let cached = { at: 0, state: null };

async function queryUserNotificationState() {
  const now = Date.now();
  if (cached.state && now - cached.at < STATE_TTL_MS) return cached.state;
  try {
    const { stdout } = await execFileAsync(resolvePowerShell(), [
      '-NoProfile',
      '-Command',
      `
        Add-Type -AssemblyName shell32;
        $state = 0;
        [shell32]::SHQueryUserNotificationState([ref]$state);
        Write-Output $state;
      `,
    ]);
    const state = QUERY_USER_NOTIFICATION_STATE[parseInt(stdout.trim(), 10)] || null;
    cached = { at: now, state };
    return state;
  } catch (err) {
    debug.warn(`Failed to query the user notification state: ${err.message || err}`);
    return null;
  }
}

async function isFullscreenAppRunning() {
  return FULLSCREEN_STATES.includes(await queryUserNotificationState());
}

// True only when Windows is known to be swallowing toast popups. An unknown state (query failed,
// not Windows) answers false so a working notification is never suppressed on a guess.
async function arePopupsSuppressed() {
  return POPUP_SUPPRESSED_STATES.includes(await queryUserNotificationState());
}

module.exports = {
  isFullscreenAppRunning,
  arePopupsSuppressed,
  queryUserNotificationState,
  FULLSCREEN_STATES,
  POPUP_SUPPRESSED_STATES,
};
