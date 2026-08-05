'use strict';

const os = require('os');
const startApps = require('./startApps.js');

// Last-resort AppUserModelID. Kept only for continuity with older installs — on Windows 11 the
// classic Xbox app it names is no longer shipped, which is precisely why it must never be trusted
// without an existence check (issue #8).
const DEFAULT_TOAST_AUMID = 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp';

// Ordered identities a toast may be posted under, best first:
//   1. the user's explicit override (Settings > Notifications > Advanced),
//   2. Achievement Watcher's own identity — registered by the installer's Start Menu shortcut, so
//      toasts appear under "Achievement Watcher" instead of a borrowed Xbox app id,
//   3. the legacy Xbox ids, for Windows 8.x and for installs where (2) is unavailable (dev runs).
function toastIdentityCandidates(options, env = process.env) {
  const candidates = [];
  const override = options && options.notification_advanced ? options.notification_advanced.appID : '';
  if (override && override !== '') candidates.push({ id: override, why: 'user override' });
  if (env.AW_AUMID) candidates.push({ id: env.AW_AUMID, why: 'Achievement Watcher' });

  const win_ver = os.release().split('.');
  if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
    candidates.push({ id: 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames', why: 'Xbox (Win8.x)' });
  } else {
    candidates.push({ id: 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App', why: 'Xbox Game Bar' });
  }
  candidates.push({ id: DEFAULT_TOAST_AUMID, why: 'built-in default' });

  return candidates.filter((c) => startApps.isValidAUMID(c.id));
}

/**
 * Pick the AppUserModelID toasts are posted under, checking that Windows actually knows it.
 *
 * Windows silently drops a toast whose AUMID no installed app owns — no error, no callback, nothing
 * in the log. That is exactly what happened on Windows 11: the hardcoded default was the classic
 * Xbox app, which no longer ships, and the old format-only check happily reported it as a "valid
 * AUMID" (issue #8). So candidates are now checked for EXISTENCE, and the failure is reported.
 *
 * Returns `{ id, why, registered }`; `registered` is false when nothing could be verified, in which
 * case the first candidate is still returned so a toast is at least attempted.
 */
async function resolveToastIdentity(options, { env = process.env, log } = {}) {
  const debug = log || { log() {}, warn() {}, error() {} };
  const candidates = toastIdentityCandidates(options, env);
  const registered = await startApps.listAumids();

  // An explicit override is obeyed even when Get-StartApps does not list it: the user may be
  // pointing at an identity we cannot enumerate, and silently ignoring their setting would be worse
  // than a warning. Only the automatic candidates have to prove they exist.
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

// Only a packaged (MSIX/UWP) identity lets Windows download http(s) toast images; a desktop app id
// must point at files on disk. Achievement Watcher's own id is a desktop one, so its icons have to
// be prefetched or every toast would render without artwork.
function requiresLocalImages(aumid) {
  return !startApps.isPackagedAUMID(aumid);
}

module.exports = { DEFAULT_TOAST_AUMID, toastIdentityCandidates, resolveToastIdentity, requiresLocalImages };
