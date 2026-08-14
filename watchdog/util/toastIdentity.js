'use strict';

const os = require('os');
const startApps = require('./startApps.js');

// Desktop AppUserModelID declared by electron-builder.
const ACHIEVEMENT_WATCHER_AUMID = 'io.github.shirowwww.achievement.watcher';

// Legacy fallback; verify it before use.
const DEFAULT_TOAST_AUMID = 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp';
let registeredAumidsPromise = null;

function registeredAumids() {
  // Get-StartApps starts PowerShell and is noticeably slow on a cold Windows session. One Watchdog
  // process has a stable Start-menu view, so share the first lookup across tests and real unlocks.
  if (!registeredAumidsPromise) registeredAumidsPromise = startApps.listAumids().catch(() => []);
  return registeredAumidsPromise;
}

// Candidates are checked in override, app, then legacy order.
function toastIdentityCandidates(options, env = process.env) {
  const candidates = [];
  const override = options && options.notification_advanced ? options.notification_advanced.appID : '';
  if (override && override !== '') candidates.push({ id: override, why: 'user override' });
  candidates.push({ id: env.AW_AUMID || ACHIEVEMENT_WATCHER_AUMID, why: 'AW Next' });

  const win_ver = os.release().split('.');
  if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
    candidates.push({ id: 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames', why: 'Xbox (Win8.x)' });
  } else {
    candidates.push({ id: 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App', why: 'Xbox Game Bar' });
  }
  candidates.push({ id: DEFAULT_TOAST_AUMID, why: 'built-in default' });

  return candidates.filter((c) => startApps.isValidAUMID(c.id));
}

/** Pick the first usable AppUserModelID and report whether it is registered. */
async function resolveToastIdentity(options, { env = process.env, log } = {}) {
  const debug = log || { log() {}, warn() {}, error() {} };
  const candidates = toastIdentityCandidates(options, env);
  const registered = await registeredAumids();

  // Respect an explicit override even when it cannot be enumerated.
  if (candidates[0] && candidates[0].why === 'user override') {
    const override = candidates.shift();
    const known = await startApps.hasAumid(override.id, registered);
    if (!known) debug.warn(`[Toast] "${override.id}" (user override) is not a registered app id — toasts may not appear`);
    debug.log(`[Toast] will use appid: "${override.id}" (${override.why})`);
    return { ...override, registered: known };
  }

  for (const candidate of candidates) {
    if (await startApps.hasAumid(candidate.id, registered)) {
      debug.log(`[Toast] will use appid: "${candidate.id}" (${candidate.why})`);
      return { ...candidate, registered: true };
    }
    debug.warn(`[Toast] "${candidate.id}" (${candidate.why}) is not registered on this system > SKIPPING`);
  }

  debug.error(
    '[Toast] no registered AppUserModelID found — Windows will silently discard these toasts. ' +
      'Fix: reinstall so the Start Menu shortcut is recreated, or set a registered app id in ' +
      'Settings > Notifications > Advanced. Overlay notifications are unaffected.'
  );
  const fallback = candidates[0] || { id: DEFAULT_TOAST_AUMID, why: 'built-in default' };
  return { ...fallback, registered: false };
}

// Desktop AUMIDs require local image files, so artwork is prefetched.
function requiresLocalImages(aumid) {
  return !startApps.isPackagedAUMID(aumid);
}

module.exports = {
  ACHIEVEMENT_WATCHER_AUMID,
  DEFAULT_TOAST_AUMID,
  toastIdentityCandidates,
  resolveToastIdentity,
  requiresLocalImages,
};
