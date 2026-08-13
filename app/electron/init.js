'use strict';

const path = require('path');
const { app } = require('electron');
const { APP_DATA_DIR_NAME } = require('../util/userDataPath.js');
const { migrateLegacyUserData } = require('../util/migrateUserData.js');
app.setName('Achievement Watcher');
// Keep 3.x data separate from the legacy folder; --user-data-dir still overrides it for tests.
const cliUserDataDir = (() => {
  try {
    const argv = process.argv.slice(1);
    const eq = argv.find((a) => a.startsWith('--user-data-dir='));
    if (eq) return eq.slice('--user-data-dir='.length);
    const i = argv.indexOf('--user-data-dir');
    return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
  } catch {
    return '';
  }
})();
app.setPath('userData', cliUserDataDir || path.join(app.getPath('appData'), APP_DATA_DIR_NAME));
migrateLegacyUserData(app.getPath('userData'));
// Keep GPU acceleration enabled, but avoid Chromium background services AW does not use in tray mode.
for (const sw of ['disable-extensions', 'disable-component-extensions-with-background-pages', 'disable-default-apps', 'disable-background-networking', 'disable-accelerated-video-decode']) {
  app.commandLine.appendSwitch(sw);
}
// Bound heap growth while the app sits in the tray: the renderer's measured heap stays near 20 MB,
// so a 192 MB ceiling makes V8 collect earlier instead of letting every process grow toward 256 MB.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=192');
const { BrowserWindow, dialog, session, shell, ipcMain, globalShortcut, Tray, Menu, nativeImage, Notification } = require('electron');
const os = require('os');
const { autoUpdater } = require('electron-updater');
  const { verifyUpdateCodeSignature } = require('../util/updateSignature.js');
  const { withScrapeLease } = require('../util/scrapeLease.js');
  const steamSchemaFetch = require(path.join(__dirname, '../util/steamSchemaFetch.js'));
  const { clampWindowBoundsToWorkArea } = require('../util/windowBounds.js');
// Updates require an explicit download and install confirmation.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// Differential downloads patch a cached copy of the previous installer that is never revalidated
// between runs. A corrupted base (interrupted download, disk issue, an old stacked-download bug)
// makes every future patch attempt fail with a sha512 checksum mismatch until someone finds and
// deletes the cache by hand. Always downloading the full installer removes that whole failure class.
autoUpdater.disableDifferentialDownload = true;
// Accept the project's self-signed publisher through the tested verifier.
autoUpdater.verifyUpdateCodeSignature = (publisherNames, tempUpdateFile) =>
  verifyUpdateCodeSignature(publisherNames, tempUpdateFile, (message) => debug.log(message));
const UPDATE_RELEASES_URL = 'https://github.com/Shirowwww/Achievement-Watcher-3.0/releases';
let updateCheckTimer = null;
let updatePromptOpen = false;
let updaterErrorNotified = false;
let manualUpdateCheckPending = false; // Settings requested a check.
let manualUpdateResult = null; // 'available' | 'uptodate' | 'error'
let updateDownloading = false; // true from the accepted "Download && Install" until it lands or fails
let checksumRetryInFlight = false; // guards the one automatic retry after a cache-clearing recovery
const UPDATE_RECHECK_MS = 60 * 60 * 1000; // silent hourly re-check while the app stays resident
const UPDATE_RETRY_MS = 30 * 60 * 1000; // slower retry after a failed check
// Number of games currently reported by the monitor.
let gamesRunning = 0;
const isGameRunning = () => gamesRunning > 0;
// A completed update waiting for the current game to end.
let promptDownloadedUpdate = null;
let pendingInstallPrompt = null;

// Update prompt policy lives in the unit-tested update gate.
const updateGate = require(path.join(__dirname, '../util/updateGate.js'));
const { isChecksumMismatchError } = require(path.join(__dirname, '../util/updateChecksum.js'));
const { clearUpdaterCacheDir: clearCacheDirForHelper } = require(path.join(__dirname, '../util/updateCacheClear.js'));
const { clearSafeCaches } = require(path.join(__dirname, '../util/clearableCaches.js'));

async function applyGeneralPatch(patch) {
  if (!configJS) return;
  if (!configJS.general) configJS.general = {};
  Object.assign(configJS.general, patch);
  await settingsJS.save(configJS);
}

async function postponeUpdate(version) {
  try {
    const patch = updateGate.postponePatch(version);
    await applyGeneralPatch(patch);
    debug.log(`[updater] version ${version} postponed until ${new Date(patch.updatePostponedUntil).toISOString()}`);
  } catch (err) {
    debug.log(`[updater] could not persist the postpone: ${err.message || err}`);
  }
}

// A user who asks for a check has just overruled their own "later".
async function clearUpdatePostpone() {
  try {
    const general = (configJS && configJS.general) || {};
    if (!general.updatePostponedVersion && !general.updatePostponedUntil) return;
    await applyGeneralPatch(updateGate.clearPostponePatch());
  } catch (err) {
    debug.log(`[updater] could not clear the postpone: ${err.message || err}`);
  }
}

function shouldSuppressUpdatePrompt(version, { manual = false } = {}) {
  const { suppress, reason } = updateGate.shouldSuppressUpdatePrompt((configJS && configJS.general) || {}, version, { manual });
  if (suppress) debug.log(`[updater] version ${version} not offered (${reason})`);
  return suppress;
}

// Keep download progress for both the taskbar and tray tooltip. -1 clears it.
let updateDownloadFraction = -1;
let updateProgressLogged = -1;

function applyUpdateProgressToWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setProgressBar(updateDownloadFraction);
  } catch (err) {
    debug.log(`[updater] could not set the taskbar progress: ${err.message || err}`);
  }
}

function setUpdateDownloadProgress(fraction) {
  updateDownloadFraction = fraction;
  applyUpdateProgressToWindow(MainWin);
  if (!tray) return;
  try {
    tray.setToolTip(
      fraction >= 0
        ? `Achievement Watcher — ${t('downloading-update', 'downloading update {percent}%', 'téléchargement de la mise à jour {percent} %', { percent: Math.round(fraction * 100) })}`
        : 'Achievement Watcher',
    );
  } catch {}
}

function clearUpdateDownloadProgress() {
  if (updateDownloadFraction < 0) return;
  updateProgressLogged = -1;
  setUpdateDownloadProgress(-1);
}

function notifyUpdateError(message) {
  debug.log(`[updater] ${message}`);
  clearUpdateDownloadProgress();
  updateDownloading = false;
  manualUpdateResult = 'error';
  manualUpdateCheckPending = false;
  if (!updaterErrorNotified && tray) {
    updaterErrorNotified = true;
    try {
      tray.displayBalloon({
        iconType: 'warning',
        title: t('achievement-watcher', 'Achievement Watcher'),
        content: t('update-check-failed-detail', 'Update check failed: {message}', 'Échec de la vérification des mises à jour : {message}', { message }),
      });
    } catch {}
  }
}

// Wipes the whole electron-updater cache directory (both the differential-download base files and
// the pending/ download), and resets the updater's in-memory record of what it has on disk. Shared
// by the automatic checksum-mismatch recovery and the manual Settings > Advanced button. The actual
// clearing lives in util/updateCacheClear.js, tested against the real electron-updater cache class.
async function clearUpdaterCacheDir() {
  const helper = await autoUpdater.getOrCreateDownloadHelper();
  return clearCacheDirForHelper(helper, {
    onHelperClearError: (err) => debug.log(`[updater] could not reset the download helper state: ${err.message || err}`),
  });
}

// The one automatic retry (cache cleared, full download re-attempted) also failed: this is no
// longer a corrupted-cache problem, so stop being quiet about it and offer a manual way out.
async function notifyChecksumRecoveryFailed(message, cacheDir) {
  debug.log(`[updater] retry after clearing the update cache also failed: ${message}`);
  clearUpdateDownloadProgress();
  updateDownloading = false;
  manualUpdateResult = 'error';
  manualUpdateCheckPending = false;
  if (updatePromptOpen) return; // a real dialog is already up; do not stack another one on top
  updatePromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: t('achievement-watcher', 'Achievement Watcher'),
      message: t(
        'update-retry-failed-message',
        'The update still failed after clearing the cached files in {folder}.',
        'La mise à jour a encore échoué après avoir vidé les fichiers en cache dans {folder}.',
        { folder: cacheDir }
      ),
      detail: t(
        'update-retry-failed-detail',
        'This is likely a network or release problem, not something clearing the cache can fix. You can download and install the update manually from the release page.',
        'Il s’agit probablement d’un problème réseau ou lié à la publication, que vider le cache ne peut pas résoudre. Vous pouvez télécharger et installer la mise à jour manuellement depuis la page de version.'
      ),
      buttons: [t('open-release-page', 'Open Release Page', 'Ouvrir la page de version'), t('ok', 'OK', 'OK')],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(UPDATE_RELEASES_URL).catch(() => {});
  } catch (err) {
    debug.log(`[updater] could not show the recovery-failed dialog: ${err.message || err}`);
  } finally {
    updatePromptOpen = false;
  }
}

function scheduleUpdateCheck(delayMs) {
  clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(() => {
    updateCheckTimer = null;
    if (!app.isPackaged) return;
    if (updatePromptOpen) {
      // Keep checking after an open prompt closes.
      scheduleUpdateCheck(UPDATE_RECHECK_MS);
      return;
    }
    // Do not interrupt a running game with a modal update dialog.
    if (isGameRunning()) {
      debug.log('[updater] check deferred: a game is running');
      scheduleUpdateCheck(updateGate.INTERVALS.inGame);
      return;
    }
    autoUpdater
      .checkForUpdates()
      .then(() => {
        updaterErrorNotified = false; // a healthy check clears the "already told the user" flag
        scheduleUpdateCheck(updateGate.nextCheckDelayMs({ gameRunning: isGameRunning() }));
      })
      .catch((err) => {
        notifyUpdateError(err && err.message ? err.message : String(err));
        scheduleUpdateCheck(updateGate.nextCheckDelayMs({ gameRunning: isGameRunning(), failed: true }));
      });
  }, delayMs);
}

// Record the runtime, paths, flags and display layout once for troubleshooting.
function logStartupDiagnostics() {
  const line = (label, value) => debug.log(`[diag] ${label}: ${value}`);
  try {
    const { node, electron, chrome, v8 } = process.versions;
    line('app', `${app.getName()} ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'dev'}${manifest.config.debug ? ', debug' : ''})`);
    line('runtime', `electron ${electron} · chrome ${chrome} · node ${node} · v8 ${v8}`);
    line('os', `${os.type()} ${os.release()} ${process.arch} · ${os.cpus().length} cpu · ${Math.round(os.totalmem() / 1048576)} MB`);
    line('paths', `exe=${process.execPath}`);
    line('paths', `app=${app.getAppPath()}`);
    line('paths', `userData=${userData}`);
    line('argv', JSON.stringify(process.argv.slice(1)));
    line('flags', `hidden=${process.argv.includes('--hidden')} safeMode=${safeMode} gpuDisabled=${!!(manifest.config['disable-gpu'] || userDisableGpu || safeMode)}`);
    const general = (configJS && configJS.general) || {};
    line('settings', `lang=${(configJS && configJS.achievement && configJS.achievement.lang) || '?'} theme=${general.theme || '?'} closeToTray=${general.closeToTray !== false} startWithWindows=${general.startWithWindows !== false}`);
    line('settings', `skippedVersion=${general.skippedVersion || 'none'} updatePostponed=${general.updatePostponedVersion || '-'}${general.updatePostponedUntil ? ' until ' + new Date(Number(general.updatePostponedUntil)).toISOString() : ''}`);
    // Access screen only after app readiness.
    const electronScreen = require('electron').screen;
    const primaryId = electronScreen.getPrimaryDisplay().id;
    for (const display of electronScreen.getAllDisplays()) {
      const { width, height } = display.size;
      const work = display.workAreaSize;
      line(
        'display',
        `${display.id}${display.id === primaryId ? ' (primary)' : ''} ${width}x${height} @${display.scaleFactor}x work=${work.width}x${work.height} rotation=${display.rotation}`
      );
    }
  } catch (err) {
    debug.log(`[diag] failed to collect startup diagnostics: ${err.message || err}`);
  }
}

// Defer updates while games run and check again when the last one exits.
function setGameActivity(count) {
  const wasRunning = isGameRunning();
  gamesRunning = Math.max(0, Number(count) || 0);
  debug.log(`[game-activity] ${gamesRunning} game(s) running`);
  if (wasRunning === isGameRunning()) return;
  if (isGameRunning() || !app.isPackaged) return;

  // Reopen a completed download prompt after the game ends.
  if (pendingInstallPrompt && typeof promptDownloadedUpdate === 'function') {
    const info = pendingInstallPrompt;
    pendingInstallPrompt = null;
    setTimeout(() => promptDownloadedUpdate(info), updateGate.INTERVALS.afterGame);
    return;
  }
  scheduleUpdateCheck(updateGate.INTERVALS.afterGame);
}
const minimist = require('minimist');
const { execFileSync, execFile, spawn } = require('child_process');
const fs = require('fs');
const ipc = require(path.join(__dirname, 'ipc.js'));
const notificationSounds = require(path.join(__dirname, '../util/notificationSounds.js'));
const userThemes = require(path.join(__dirname, '../util/userThemes.js'));
const themeLayers = require(path.join(__dirname, '../util/themeLayers.js'));
const overlayLocale = require(path.join(__dirname, '../util/overlayLocale.js'));
const { resolveOverlayRequest } = require(path.join(__dirname, '../util/overlayRequest.js'));
const { normalizeWindowArgs } = require(path.join(__dirname, '../util/windowArgs.js'));
const notificationBounds = require(path.join(__dirname, '../util/notificationBounds.js'));

// Resolve main-process strings from the selected locale, with English/French fallback.
let mainLocaleCache = null;
function t(key, english, french, params) {
  const interpolate = (value) =>
    params && typeof params === 'object'
      ? String(value).replace(/\{(\w+)\}/g, (match, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        )
      : value;
  try {
    const lang = String((configJS && configJS.achievement && configJS.achievement.lang) || 'english');
    if (!mainLocaleCache || mainLocaleCache.lang !== lang) {
      const englishData = JSON.parse(fs.readFileSync(path.join(__dirname, '../locale/lang/english.json'), 'utf8'));
      let data = englishData;
      if (lang !== 'english') {
        const requested = JSON.parse(fs.readFileSync(path.join(__dirname, '../locale/lang', `${lang}.json`), 'utf8'));
        const deepmerge = require('deepmerge');
        data = deepmerge(englishData, requested, { arrayMerge: (dest, src) => src });
      }
      mainLocaleCache = { lang, data };
    }
    const dialogs = mainLocaleCache.data && mainLocaleCache.data.dialogs;
    const value = dialogs && typeof dialogs[key] === 'string' ? dialogs[key] : null;
    if (value && value.trim()) return interpolate(value);
  } catch {}
  const lang = String((configJS && configJS.achievement && configJS.achievement.lang) || '');
  const fallback = lang.toLowerCase().startsWith('fr') && french ? french : english;
  return interpolate(fallback || key);
}

// Build the locale payload sent to the in-game overlay.
let cachedOverlayLanguagePayload = null;
function overlayLanguagePayload() {
  const lang = String((configJS && configJS.achievement && configJS.achievement.lang) || 'english');
  if (cachedOverlayLanguagePayload && cachedOverlayLanguagePayload.lang === lang) {
    return cachedOverlayLanguagePayload;
  }
  try {
    cachedOverlayLanguagePayload = overlayLocale.loadOverlayLocale({ localeDir: path.join(__dirname, '../locale/lang'), lang });
    return cachedOverlayLanguagePayload;
  } catch (err) {
    debug.log(`[overlay] language payload failed: ${err.message || err}`);
    cachedOverlayLanguagePayload = null;
    return { lang, strings: {} };
  }
}

// Controller shortcuts + button layout are sent to the overlay as a small config payload.
function overlayControllerConfigPayload() {
  const c = (configJS && configJS.controller) || {};
  const split = (value, fallback) => {
    const parts = String(value || '')
      .split('+')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    return parts.length ? parts : fallback;
  };
  return {
    layout: String(c.layout || 'auto'),
    nativeModeToggles: c.enabled === true,
    bindings: {
      toggle: split(c.toggleBinding, ['BACK', 'START', 'LEFT_SHOULDER']),
      ui: split(c.uiModeBinding, ['LEFT_SHOULDER', 'X']),
      move: split(c.controlModeBinding, ['LEFT_SHOULDER', 'RIGHT_SHOULDER']),
    },
  };
}

// Resolve the current theme for the main window and overlay.
function currentThemePayload(nameOverride) {
  const name = String(nameOverride || (configJS && configJS.general && configJS.general.theme) || 'default');
  const user = userThemes.parseValue(name);
  let userCss = '';
  if (user) {
    try {
      const matches = userThemes.listUserThemes(userData).filter((t) => t.name === user);
      if (matches.length > 0) userCss = userThemes.readThemeFile(matches[0].file);
    } catch {}
  }
  return themeLayers.themePayload(userData, name, themeLayers.loadCustomTheme(userData), userCss);
}

const BASE_URL = 'https://www.steamgriddb.com/api/v2';
const DEFAULT_API_KEY = '2a9d32ddd0bfe4e1191b4f6ff56fef60'; // bundled public fallback (rate-limited)
// Bound artwork requests so a dead network cannot stall a scan for minutes.
const SGDB_FETCH_TIMEOUT_MS = 8000;
const startupArgs = normalizeWindowArgs(minimist(process.argv.slice(1)));
const safeMode = startupArgs['safe-mode'] === true || startupArgs.safeMode === true || startupArgs['reset-window'] === true;

// SteamGridDB artwork key: the bundled public fallback is used directly — no per-user key.
function getSteamGridDbApiKey() {
  return DEFAULT_API_KEY;
}

let remoteMain = null;
function getRemoteMain() {
  if (!remoteMain) {
    remoteMain = require('@electron/remote/main');
    remoteMain.initialize();
  }
  return remoteMain;
}

function fetch(...args) {
  return globalThis.fetch(...args);
}

function createXmlParser() {
  const { XMLParser } = require('fast-xml-parser');
  return new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true, cdataPropName: '__cdata' });
}

function fetchSteamIcon(url, appid) {
  return require(path.join(__dirname, '../parser/steam.js')).fetchIcon(url, appid);
}

// Plain-HTTP fetches for the keyless schema chain. SteamHunters serves its public JSON API to
// browser-like clients; SteamCommunity also expects a real UA. Modest timeouts keep a stalled
// host from blocking a scan (the browser scrape remains the last-resort fallback).
const STEAM_FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const STEAM_KEYLESS_TIMEOUT_MS = 10000;

let client; //lazyload SteamUser
let clientLoginPromise;
// SteamHunters DLC/update groups rarely change; one lookup per appid per session (memory) plus a
// 30-day disk cache (steam_cache, so "Clear caches" wipes it too) is enough.
const steamGroupsCache = new Map();
const STEAM_GROUPS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function clientLogOn() {
  const SteamUser = require('steam-user');
  if (!client) client = new SteamUser();
  if (client.steamID) return Promise.resolve();
  if (clientLoginPromise) return clientLoginPromise;
  clientLoginPromise = new Promise((resolve) => {
    client.logOn({ anonymous: true });
    client.on('loggedOn', () => {
      clientLoginPromise = null;
      resolve();
    });
  });
  return clientLoginPromise;
}

const manifest = require('../package.json');
const userData = app.getPath('userData');
let currentlyscraping = { steamcommunity: false, steamhunters: false };
let settingsJS = null;
let configJS = null;
let achievementsJS = null;

// Read the GPU preference before app.ready; disabling it is opt-in.
let userDisableGpu = false;
try {
  const parsed = require('../util/ini').parse(fs.readFileSync(path.join(userData, 'cfg/options.ini'), 'utf8'));
  const v = parsed && parsed.general && parsed.general.disableHardwareAccel;
  userDisableGpu = v === true || v === 'true';
} catch {
  /* no options.ini yet (first run) -> keep GPU acceleration on */
}
if (manifest.config['disable-gpu'] || userDisableGpu || safeMode) app.disableHardwareAcceleration();
if (manifest.config.appid) app.setAppUserModelId(manifest.config.appid);
manifest.config.debug = process.env.NODE_ENV === 'development' || process.defaultApp || /[\\/]electron/.test(process.execPath);
// Keep DevTools available in development, but open it only when requested.
const openDevTools = manifest.config.debug && /^(1|true)$/i.test(String(process.env.AW_OPEN_DEVTOOLS || ''));

// Register a per-user URI scheme so toast clicks can reopen the unpackaged app.
const TOAST_PROTOCOL = 'achievement-watcher';
let toastProtocolReady = false;
if (!manifest.config.debug) {
  try {
    toastProtocolReady = app.setAsDefaultProtocolClient(TOAST_PROTOCOL);
  } catch {
    /* protocol registration is best-effort: without it toasts still show, they just aren't clickable */
  }
}

let puppeteerWindow = {};
let MainWin = null;
let overlayWindow = null;
let overlayVisible = false;
let overlayWarmupTimer = null;
const OVERLAY_WARMUP_KEEP_MS = 300000;
let debug = new (require('../util/logger'))({
  console: manifest.config.debug || false,
  file: path.join(userData, `logs/renderer.log`),
});

process.on('uncaughtException', (err) => {
  debug.log(`[uncaughtException] ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (err) => {
  debug.log(`[unhandledRejection] ${err && err.stack ? err.stack : err}`);
});

async function fetchSteamCommunityAchievements(url) {
  // Parse the server-rendered achievements page without launching Chromium.
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': STEAM_FETCH_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'birthtime=662716801; wants_mature_content=1', // bypass age gate; ?l= controls language
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return steamSchemaFetch.parseSteamCommunityRows(await res.text()).map((row) => ({
      img: row.img || null,
      icon: row.icon || '',
      title: row.title || null,
      description: row.description || null,
    }));
  } catch (err) {
    debug.log(`steamcommunity fetch failed: ${err}`);
    return [];
  }
}

// Prefer the official Steam API; return null on transport/auth errors so scraping can take over.
async function getSchemaFromWebAPI(appid, lang) {
  const language = (lang && (lang.api || lang)) || 'english';
  const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid=${appid}&language=${encodeURIComponent(language)}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS) });
  } catch (err) {
    debug.log(`[${appid}] GetGameAchievements network error: ${err.message}`);
    return null;
  }
  if (!res.ok) {
    debug.log(`[${appid}] GetGameAchievements HTTP ${res.status}`);
    return null; // let the caller decide to scrape
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    return null;
  }
  return steamSchemaFetch.mapOfficialAchievements(json?.response, appid);
}

// SteamHunters' public JSON API: full achievement list (apiName/name/description/global rarity)
// in one plain request. { ok: true } with an empty list is a valid "no achievements" answer.
async function fetchSteamHuntersJson(appid) {
  try {
    const res = await fetch(`https://steamhunters.com/api/apps/${appid}/achievements`, {
      headers: { 'User-Agent': STEAM_FETCH_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, list: [] };
    const json = await res.json();
    return Array.isArray(json) ? { ok: true, list: json } : { ok: false, list: [] };
  } catch (err) {
    debug.log(`[${appid}] SteamHunters JSON fetch failed: ${err.message}`);
    return { ok: false, list: [] };
  }
}

// Icon-hash -> real apiName lookup, one small file per appid (steam_cache, so "Clear caches" wipes
// it too). Feeds the degraded SteamCommunity-only fallback below when every apiName source fails.
function apiNameIndexPath(appid) {
  return path.join(userData, 'steam_cache/apinames', `${appid}.json`);
}

function loadApiNameIndex(appid) {
  try {
    return JSON.parse(fs.readFileSync(apiNameIndexPath(appid), 'utf8'));
  } catch {
    return null;
  }
}

function rememberApiNameIndex(appid, achievements) {
  try {
    const fresh = steamSchemaFetch.buildApiNameIndex(achievements);
    if (Object.keys(fresh).length === 0) return;
    const merged = { ...(loadApiNameIndex(appid) || {}), ...fresh };
    const file = apiNameIndexPath(appid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged));
  } catch (err) {
    debug.log(`[${appid}] could not persist the apiName index: ${err.message || err}`);
  }
}

function steamGroupsCachePath(appid) {
  return path.join(userData, 'steam_cache/steamhunters_groups', `${appid}.json`);
}

function loadSteamGroupsCache(appid) {
  try {
    const raw = JSON.parse(fs.readFileSync(steamGroupsCachePath(appid), 'utf8'));
    if (raw && Array.isArray(raw.groups) && raw.fetchedAt && Date.now() - raw.fetchedAt < STEAM_GROUPS_CACHE_TTL_MS) {
      return raw.groups;
    }
  } catch {}
  return null;
}

function saveSteamGroupsCache(appid, groups) {
  try {
    const file = steamGroupsCachePath(appid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), groups }));
  } catch (err) {
    debug.log(`[${appid}] could not persist the SteamHunters groups cache: ${err.message || err}`);
  }
}

// Fast keyless chain: the official endpoint first (works without a key and is the only source with
// hidden descriptions + icons + rarity), then SteamHunters JSON enriched with SteamCommunity
// icons/hidden, then SteamCommunity alone, then nothing (the caller may fall back to the browser).
async function getAchievementsKeyless(appid, lang) {
  const official = await getSchemaFromWebAPI(appid, lang);
  if (official !== null) {
    rememberApiNameIndex(appid, official);
    return { achievements: official, source: 'official' };
  }

  const sh = await fetchSteamHuntersJson(appid);
  if (sh.ok) {
    if (sh.list.length === 0) return { achievements: [], source: 'steamhunters' };
    const language = (lang && (lang.api || lang)) || 'english';
    // SteamHunters titles are English-only, so icons/hidden come from the English SteamCommunity
    // page (title match); the localized page is then overlaid by icon hash (language-independent).
    const achievements = steamSchemaFetch.mapSteamHuntersJson(sh.list);
    const englishRows = await fetchSteamCommunityAchievements(
      `https://steamcommunity.com/stats/${appid}/achievements?l=english`
    );
    const merged = englishRows.length
      ? steamSchemaFetch.mergeSteamHuntersWithCommunity(sh.list, englishRows)
      : achievements;
    if (language !== 'english') {
      const localizedRows = await fetchSteamCommunityAchievements(
        `https://steamcommunity.com/stats/${appid}/achievements?l=${language}`
      );
      if (localizedRows.length) {
        const { mergeTranslatedAchievements } = require('../parser/achievementTranslations.js');
        mergeTranslatedAchievements(merged, localizedRows);
      }
    }
    // SteamHunters always carries real apiNames, with or without a successful icon merge.
    rememberApiNameIndex(appid, merged);
    return { achievements: merged, source: 'steamhunters' };
  }

  const language = (lang && (lang.api || lang)) || 'english';
  const rows = await fetchSteamCommunityAchievements(
    `https://steamcommunity.com/stats/${appid}/achievements?l=${language}`
  );
  if (rows.length) {
    const degraded = steamSchemaFetch.mapSteamCommunityRows(rows);
    const apiNames = loadApiNameIndex(appid);
    return { achievements: apiNames ? steamSchemaFetch.applyApiNameIndex(degraded, apiNames) : degraded, source: 'steamcommunity' };
  }
  return { achievements: [], source: 'none' };
}

async function getSteamData(request) {
  const appid = request.appid;
  const type = request.type;
  let user = request.user;
  let userid;
  const lang = request.lang || 'english';
  if (!configJS) {
    try {
      await startEngines(); // makes the config available for the browser-free schema path
    } catch (err) {
      debug.log('startEngines (getSteamData) failed: ' + err.message);
    }
  }
  try {
    if (type === 'user') {
      const url = `https://steamcommunity.com/profiles/${user}/stats/${appid}/?xml=1`;
      const res = await fetch(url);
      const xml = await res.text();
      const parser = createXmlParser();
      const data = parser.parse(xml);
      const achievements = data?.playerstats?.achievements?.achievement || [];
      const list = Array.isArray(achievements) ? achievements : [achievements];

      return list.map((a) => {
        const name = a.apiname?.__cdata || a.apiname || '';
        const unlock = parseInt(a.unlockTimestamp ?? 0);
        return {
          apiname: name,
          achieved: unlock > 0 ? 1 : 0,
          unlocktime: unlock || 0,
        };
      });
    }
    if (type === 'steamcommunity') {
      let info = { appid };
      const url = `https://steamcommunity.com/stats/${appid}/achievements?l=${lang.api}`; //this doesnt give hidden descriptions
      info.achievements = await fetchSteamCommunityAchievements(url);
      if (info.achievements.length > 0 && info.achievements.every((a) => a.description)) {
        return info;
      }

      let validXml = false;
      let xml;

      // Prefer SteamHunters owners over a blind SteamID loop.

      await scrapeWithPuppeteer(info, { userlist: true, steamhunters: true, appid });
      // Keep partial achievements when the owner list fails.

      // Use the first public owner profile with complete localized descriptions.
      const tryOwnerProfiles = async (ids) => {
        for (let id of ids) {
          userid = id;
          const url = `https://steamcommunity.com/profiles/${userid}/stats/${appid}/?xml=1`; // this for all data
          const res = await fetch(url);
          xml = await res.text();
          validXml = !(xml.startsWith('<!DOCTYPE html') || xml.includes('<html'));
          if (!validXml) continue;

          const parser = createXmlParser();
          const data = parser.parse(xml);
          const achievements = data?.playerstats?.achievements?.achievement || [];
          const list = achievements.map((a) => {
            const unlocked = a['@_closed'] === '1';
            const name = a.name.__cdata;
            const description = a.description.__cdata;
            return { name, description, unlocked };
          });
          const allgood = list.length > 0 && list.every((a) => a.description);
          if (!allgood) continue;
          const url2 = `https://steamcommunity.com/profiles/${userid}/stats/${appid}?l=${lang.api}`; // this for name and description, match them via icon hash
          info.achievements = await fetchSteamCommunityAchievements(url2);
          return true;
        }
        return false;
      };

      if (await tryOwnerProfiles((info.users || []).map((user) => user.steamId))) return info;

      // Fall back to the cached top-owner SteamID pool.
      const owners = await fetchTopOwners();
      if (owners.length && (await tryOwnerProfiles(owners))) return info;
      return info;
    }

    if (type === 'data' || type === 'steamhunters') {
      let info = { appid };
      // Prefer the official endpoint — Steam serves this schema without a key. null means
      // transport/auth failure: fall through to the keyless chain, then to the browser scrape.
      const keyless = await getAchievementsKeyless(appid, request.lang);
      if (keyless.source === 'none') {
        await scrapeWithPuppeteer(info, { steamhunters: true });
        if (type === 'data') {
          // Bound the fallback so a stalled scrape cannot hang sendSync forever.
          let waited = 0;
          while (!info.achievements && waited < 60) {
            await delay(500);
            waited++;
          }
        }
      } else {
        info.achievements = keyless.achievements;
        info.source = keyless.source;
      }
      if (!Array.isArray(info.achievements)) info.achievements = [];
      return info;
    }
    if (type === 'steamgroups') {
      const cacheKey = String(appid);
      if (steamGroupsCache.has(cacheKey)) return { ok: true, groups: steamGroupsCache.get(cacheKey) };
      const cachedGroups = loadSteamGroupsCache(appid);
      if (cachedGroups) {
        steamGroupsCache.set(cacheKey, cachedGroups);
        return { ok: true, groups: cachedGroups };
      }
      try {
        const res = await fetch(`https://steamhunters.com/api/GetAchievementGroups/v1?appId=${appid}`, {
          headers: { 'User-Agent': STEAM_FETCH_UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, groups: [] };
        const json = await res.json();
        const groups = Array.isArray(json && json.groups) ? json.groups : [];
        steamGroupsCache.set(cacheKey, groups);
        // Persist non-empty answers only: a transient empty response must not hide future groups.
        if (groups.length) saveSteamGroupsCache(appid, groups);
        return { ok: true, groups };
      } catch (err) {
        debug.log(`[${appid}] SteamHunters groups fetch failed: ${err.message || err}`);
        return { ok: false, groups: [] };
      }
    }
    // Resolve names from the local app list first, then fall back to Steam's product info.
    if (type === 'name') {
      const offlineName = require('../util/gameNameCache.js').lookupSteamDbName(appid);
      if (offlineName) return offlineName;
    }
    await clientLogOn();
    const storeURL = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`;
    const storeRes = await fetch(storeURL);
    const json = await storeRes.json();
    const storeData = json[appid] && json[appid].data;
    const { apps, packages, unknownApps, unknownPackages } = await client.getProductInfo([appid], [], false);
    const appInfo = apps[appid]?.appinfo || apps[0]?.appinfo;

    switch (type) {
      case 'name':
        return appInfo?.common?.name;

      case 'header':
        return (
          appInfo.common.header_image?.[lang.api] ||
          appInfo.common.library_assets_full?.library_header?.image[lang.api] ||
          appInfo.common.header_image.english ||
          appInfo.common.library_assets_full?.library_header?.image?.english
        );
      case 'icon':
        return appInfo.common.icon;
      case 'portrait':
        return (
          appInfo.common.library_assets_full?.library_capsule?.image[lang] || appInfo.common.library_assets_full?.library_capsule?.image?.english
        );
      default:
      case 'common':
        return {
          name: appInfo.common.name,
          isGame: appInfo?.common?.type?.toLowerCase() === 'game',
          translated: appInfo?.common?.languages?.[lang.api] || false,
          icon: appInfo.common.icon,
          header:
            appInfo.common.header_image?.[lang.api] ||
            appInfo.common.library_assets_full?.library_header?.image?.[lang.api] ||
            appInfo.common.header_image?.english ||
            appInfo.common.library_assets_full?.library_header?.image?.english ||
            storeData?.header_image,
          portrait:
            appInfo.common.library_assets_full?.library_capsule?.image?.[lang.api] ||
            appInfo.common.library_assets_full?.library_capsule?.image?.english,
          background: storeData?.background?.replace(/(\?|&)t=\d+$/, ''),
        };
    }
  } catch (err) {
    debug.log(err);
  }
  return {};
}

// Sources whose artwork and rarity come from local emulator data.
const OVERLAY_EMULATOR_RARITY_SOURCES = new Set(['RPCS3 Emulator', 'ShadPS4 Emulator', 'Xenia Emulator']);

  // Apply cached rarity so the overlay can render immediately without network access.
function attachOverlayRarity(game) {
  try {
    if (!game || !game.achievement || !Array.isArray(game.achievement.list)) return;
    const rarity = require(path.join(__dirname, '../util/rarity.js'));
    // Xbox PC caches rarity directly on each schema entry at import time (no sidecar file for it).
    if (String(game.source || '') === 'Xbox PC') {
      for (const a of game.achievement.list) {
        if (a && a.rarityPct != null && Number.isFinite(Number(a.rarityPct))) a.rarityPercent = Number(a.rarityPct);
      }
      return;
    }
    const context = rarity.resolveGameRarityContext(game, { emulatorSources: OVERLAY_EMULATOR_RARITY_SOURCES });
    if (!context) return;
    const cacheId = context.kind === 'steam-bridge' ? context.cacheId : context.kind === 'emulator' ? game.appid : context.appid;
    if (!cacheId) return;
    const entries = rarity.readRarityCacheEntries(cacheId);
    if (!Array.isArray(entries) || entries.length === 0) return;
    const byName = new Map(entries.map((e) => [String(e && e.name), e && e.percent]));
    for (const a of game.achievement.list) {
      if (!a || !a.name) continue;
      const percent = byName.get(String(a.name));
      if (percent !== undefined) a.rarityPercent = percent;
    }
  } catch (err) {
    debug.log(`[overlay] rarity attach failed: ${err.message || err}`);
  }
}

async function closePuppeteer() {
  currentlyscraping.steamcommunity = false;
  currentlyscraping.steamhunters = false;
  if (!puppeteerWindow) {
    puppeteerWindow = {};
    return;
  }
  // Detach handles first so a concurrent scrape cannot reuse a browser being closed.
  const browser = puppeteerWindow.browser;
  const context = puppeteerWindow.context;
  puppeteerWindow.browser = undefined;
  puppeteerWindow.context = undefined;
  puppeteerWindow.pagesh = undefined;
  try {
    if (context) await context.close();
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}
}

async function startEngines() {
  if (!settingsJS) {
    settingsJS = require(path.join(__dirname, '../settings.js'));
    settingsJS.setUserDataPath(userData);
  }
  configJS = await settingsJS.load();
  if (!achievementsJS) {
    achievementsJS = require(path.join(__dirname, '../parser/achievements.js'));
    achievementsJS.initDebug({ isDev: app.isDev || false, userDataPath: userData });
    // Emulator setup runs in the background; keep its completion toast wired.
    if (achievementsJS.setEmulatorFixedHandler) achievementsJS.setEmulatorFixedHandler((g) => notifyEmulatorFixed(g));
  }
}

async function getCachedData(info) {
  if (!info.source) info.source = 'steam';
  let g = await achievementsJS.getGameFromCache(info.appid, info.source, configJS);
  switch (info.source.toLowerCase()) {
    case 'epic':
    case 'gog':
    case 'luma':
    case 'steam':
    default:
      if (g) {
        info.a = g.achievement.list.find((ac) => ac.name === String(info.ach));
        info.game = g;
        info.description = info.a?.displayName;
        return;
      }
      const [data, com] = await Promise.all([
        getSteamData({ appid: info.appid, type: 'steamhunters' }),
        getSteamData({ appid: info.appid, type: 'common' }),
      ]);
      info.game = com;
      info.game.achievements = data.achievements;

      await achievementsJS.saveGameToCache(info, configJS.achievement.lang);
      info.a = info.game.achievements.find((ac) => ac.name === String(info.ach));
      info.description = info.a?.displayName;
  }
}

ipcMain.on('close-puppeteer', async (event, arg) => {
  await closePuppeteer();
  event.returnValue = true;
});

ipcMain.on('emulator-fixed-notify', async (event, game) => {
  try {
    await startEngines(); // refresh configJS so the master notification switch/language are respected
  } catch (err) {
    debug.log(`[bg-autofix] notify config refresh failed: ${err.message || err}`);
  }
  notifyEmulatorFixed(game);
});

ipcMain.on('get-steam-data', async (event, arg) => {
  const appid = +arg.appid;
  event.returnValue = await getSteamData({ appid, type: arg.type, user: arg.user, lang: arg.lang });
});

// Reload the main-process config after the renderer saves settings.
ipcMain.on('config-saved', async () => {
  try {
    await startEngines(); // re-reads options.ini into configJS
    if (overlayVisible) {
      overlayWindow.webContents.send('overlay-controller-config', overlayControllerConfigPayload());
    }
  } catch (err) {
    debug.log('[config-saved] config reload failed: ' + (err.message || err));
  }
});

// Async twin of the legacy handler; keep long scrapes off the renderer thread.
ipcMain.handle('get-steam-data', async (event, arg) => {
  const appid = +arg.appid;
  return await getSteamData({ appid, type: arg.type, user: arg.user, lang: arg.lang });
});

// Async Epic lookups keep slow store and artwork requests off the renderer thread.
async function resolveSteamAppidFromTitle(arg) {
  function normalizeTitle(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFKD') // normalize accents
      .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A']/g, '') // single quotes
      .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB"]/g, '') // double quotes
      .replace(/[™®©]/g, '') // trademark symbols
      .replace(/[:.,!?()\\[\\]{}\-]/g, '') // punctuation + hyphens
      .replace(/\s+/g, ' ') // collapse spaces
      .trim();
  }

  let info = { name: arg.title };
  searchForSteamAppId(info);
  let possibleMatch;
  // Bound the poll because the page may fail before populating info.games.
  let tries = 0;
  while (tries < 60) {
    if (info.games) {
      for (let game of info.games) {
        if (normalizeTitle(game.title) === normalizeTitle(arg.title)) return game.appid;
        if (!possibleMatch && normalizeTitle(game.title).includes(normalizeTitle(arg.title))) {
          possibleMatch = game.appid;
        }
      }
      break;
    }
    await delay(500);
    tries++;
  }
  return possibleMatch;
}

ipcMain.on('get-steam-appid-from-title', async (event, arg) => {
  try {
    event.returnValue = await resolveSteamAppidFromTitle(arg);
  } catch {
    event.returnValue = undefined;
  }
});
ipcMain.handle('get-steam-appid-from-title', (event, arg) => resolveSteamAppidFromTitle(arg));

async function resolveTitleFromEpicId(arg) {
  let info = { appid: arg.appid };
  await searchForGameName(info); // bounded internally; info.title may be undefined on a miss
  return info.title;
}

ipcMain.on('get-title-from-epic-id', async (event, arg) => {
  try {
    event.returnValue = await resolveTitleFromEpicId(arg);
  } catch {
    event.returnValue = undefined;
  }
});
ipcMain.handle('get-title-from-epic-id', (event, arg) => resolveTitleFromEpicId(arg));

async function resolveImagesForGame(arg) {
  const gameName = arg.name;
  const apiKey = getSteamGridDbApiKey();
  // Time-box artwork requests so network failures return quickly.
  const sgdb = (url) =>
    fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(SGDB_FETCH_TIMEOUT_MS) });
  try {
    const searchRes = await sgdb(`${BASE_URL}/search/autocomplete/${encodeURIComponent(gameName)}`);

    const searchData = await searchRes.json();
    // Error payloads may omit data.
    const game = searchData?.data?.[0];
    if (!game) {
      debug.log('Game not found');
      return null;
    }

    const gameId = game.id;

    const [iconsRes, gridsRes, heroesRes, logosRes] = await Promise.all([
      sgdb(`${BASE_URL}/icons/game/${gameId}`),
      sgdb(`${BASE_URL}/grids/game/${gameId}`),
      sgdb(`${BASE_URL}/heroes/game/${gameId}`),
      sgdb(`${BASE_URL}/logos/game/${gameId}`),
    ]);

    const [icons, grids, heroes, logos] = await Promise.all([iconsRes.json(), gridsRes.json(), heroesRes.json(), logosRes.json()]);

    const gridList = Array.isArray(grids?.data) ? grids.data : [];
    const portrait = gridList.find((g) => g.width === 600 && g.height === 900);
    const landscape = gridList.find((g) => g.width === 920 && g.height === 430);
    return {
      icon: icons?.data?.[0]?.url || logos?.data?.[0]?.url,
      background: heroes?.data?.[0]?.url,
      portrait: portrait?.url,
      landscape: landscape?.url,
    };
  } catch (err) {
    debug.log(`[get-images-for-game] ${gameName}: ${err.message}`);
    return null;
  }
}

ipcMain.on('get-images-for-game', async (event, arg) => {
  // Always set returnValue for legacy sendSync callers.
  try {
    event.returnValue = await resolveImagesForGame(arg);
  } catch {
    event.returnValue = null;
  }
});
ipcMain.handle('get-images-for-game', (event, arg) => resolveImagesForGame(arg));

ipcMain.on('stylize-background-for-appid', async (event, arg) => {
  const imageUrl = arg.background;
  const t = path.parse(imageUrl).base;
  const outputPath = path.join(app.getPath('userData'), 'steam_cache', 'icon', arg.appid, t);
  const sharp = require('sharp');

  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(SGDB_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    // Undici exposes arrayBuffer(), not node-fetch's buffer().
    const buffer = Buffer.from(await res.arrayBuffer());

    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    const processedBuffer = await sharp(buffer)
      .blur(5)
      .modulate({ saturation: 0.5 })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${height}">
              <rect width="100%" height="100%" fill="#3b65a7" fill-opacity="0.8"/>
              <rect width="100%" height="100%" fill="#000000" fill-opacity="0.4"/>
             </svg>`
          ),
          blend: 'over',
        },
      ])
      .toBuffer();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, processedBuffer);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

ipcMain.on('fetch-source-img', async (event, arg) => {
  switch (arg) {
    case 'epic':
      event.returnValue = path.join(userData, 'Source', 'epic.svg');
      break;
    case 'gog':
      event.returnValue = path.join(userData, 'Source', 'gog.svg');
      break;
    case 'Goldberg SocialClub':
      event.returnValue = path.join(userData, 'Source', 'socialclub.svg');
      break;
    case 'ubisoft':
      event.returnValue = path.join(userData, 'Source', 'ubisoft.svg');
      break;
    case 'RPCS3 Emulator':
    case 'ShadPS4 Emulator':
      event.returnValue = path.join(userData, 'Source', 'playstation.svg');
      break;
    case 'Xenia Emulator':
      event.returnValue = path.join(userData, 'Source', 'xbox.svg');
      break;
    case 'Unconfigured':
      // Use a generic icon for entries without a Steam appid.
      event.returnValue = path.join(__dirname, '../resources/img/file-text.png');
      break;
    case 'steam':
    default:
      event.returnValue = path.join(userData, 'Source', 'steam.svg');
      break;
  }
});

ipcMain.handle('get-achievements', async (event, appid) => {
  return await getSteamData({ appid, type: 'steamhunters' });
});

// Manual update checks reuse the automatic prompt and notification flow.
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { ok: false, error: 'dev-build' };
  if (updatePromptOpen) return { ok: false, error: 'prompt-open' };
  // A download is already running from an earlier "Download && Install": calling checkForUpdates()
  // again while electron-updater is mid-download re-fires update-available and stacks a second
  // downloadUpdate() on top of it, which is what corrupted the in-progress download.
  if (updateDownloading) return { ok: false, error: 'download-in-progress' };
  manualUpdateCheckPending = true;
  manualUpdateResult = null;
  updaterErrorNotified = false; // let a still-failing check re-notify even if it already did once
  // A manual check overrides a previous "later" choice.
  await clearUpdatePostpone();
  try {
    await autoUpdater.checkForUpdates();
    // Give update events a short window to report the result.
    for (let i = 0; i < 20 && manualUpdateResult === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { ok: true, status: manualUpdateResult || 'unknown' };
  } catch (err) {
    notifyUpdateError(err && err.message ? err.message : String(err));
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Settings > Advanced: one action that clears every disposable cache the app knows about — the
// updater's own download cache (the same corrupted-cache scenario the automatic checksum-mismatch
// recovery handles on its own, offered here pre-emptively or after the "still failed" dialog above)
// plus the re-fetchable Steam/Ubisoft schema, icon and emulator-tool caches under userData
// (util/clearableCaches.js's explicit allowlist). Never touches settings, GBE restore-point
// backups, notification presets, theme images, or the user-seeded Uplay R2 loader cache (no public
// download source for that one — see the allowlist file for the full "never add" list).
ipcMain.handle('clear-update-cache', async () => {
  if (updateDownloading || checksumRetryInFlight) return { ok: false, error: 'download-in-progress' };
  const result = { ok: true, error: null, updateFolder: null, updateCleared: false, updateError: null, clearedCaches: [] };
  try {
    const helper = await autoUpdater.getOrCreateDownloadHelper();
    const cacheDir = helper.cacheDir;
    let hadContents = false;
    try {
      const entries = await fs.promises.readdir(cacheDir);
      hadContents = entries.length > 0;
    } catch {
      hadContents = false; // the folder simply doesn't exist yet
    }
    await clearUpdaterCacheDir();
    result.updateFolder = cacheDir;
    result.updateCleared = hadContents;
  } catch (err) {
    // Non-fatal: still clear the other app caches even if the updater cache path could not be
    // resolved (e.g. a dev build missing dev-app-update.yml).
    debug.log(`[updater] could not clear the update cache: ${err.message || err}`);
    result.updateError = err && err.message ? err.message : String(err);
    result.updateCleared = false;
    result.ok = false;
    result.error = 'update-cache-clear-failed';
  }
  try {
    result.clearedCaches = await clearSafeCaches(userData);
  } catch (err) {
    debug.log(`[cache] could not clear app caches: ${err.message || err}`);
    result.ok = false;
    result.error = err && err.message ? err.message : String(err);
  }
  return result;
});

// ---- Epic account connection ---------------------------------------------------------------
ipcMain.handle('epic:auth-status', async () => {
  try {
    return await require(path.join(app.getAppPath(), 'util/epicAuth.js')).getEpicAuthStatus({ userDataDir: userData });
  } catch (err) {
    return { configured: false, connected: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('epic:logout', async () => {
  try {
    await require(path.join(app.getAppPath(), 'util/epicAuth.js')).clearEpicTokens({ userDataDir: userData });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

let epicLoginWindow = null;
ipcMain.handle('epic:login', async () => {
  const epicAuth = require(path.join(app.getAppPath(), 'util/epicAuth.js'));
  if (epicLoginWindow && !epicLoginWindow.isDestroyed()) {
    epicLoginWindow.focus();
    return { ok: false, error: 'login-already-open' };
  }
  const loginUrl = epicAuth.buildEpicLoginUrl();
  const redirectUrl = epicAuth.buildEpicAuthCodeUrl();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (epicLoginWindow && !epicLoginWindow.isDestroyed()) epicLoginWindow.destroy();
      epicLoginWindow = null;
      resolve(result);
    };

    epicLoginWindow = new BrowserWindow({
      width: 520,
      height: 760,
      title: t('connect-epic-games-account', 'Connect Epic Games account', 'Connecter le compte Epic Games'),
      parent: MainWin && !MainWin.isDestroyed() ? MainWin : undefined, // keep it above the app window
      autoHideMenuBar: true,
      show: false, // shown on ready-to-show so it never flashes an empty frame or opens behind
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:epic-login' },
    });
    epicLoginWindow.once('ready-to-show', () => {
      if (epicLoginWindow && !epicLoginWindow.isDestroyed()) {
        epicLoginWindow.show();
        epicLoginWindow.focus();
      }
    });

    // Allow SSO popups from the Epic login window and capture their redirects.
    const attachCapture = (contents) => {
      const grab = () => tryCapture(contents);
      contents.on('did-navigate', grab);
      contents.on('did-navigate-in-page', grab);
    };
    epicLoginWindow.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: epicLoginWindow,
        width: 520,
        height: 760,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:epic-login' },
      },
    }));
    epicLoginWindow.webContents.on('did-create-window', (childWindow) => {
      attachCapture(childWindow.webContents);
    });

    // Poll the redirect endpoint after each navigation settles.
    const tryCapture = async (contents) => {
      const wc = contents && !contents.isDestroyed() ? contents : epicLoginWindow && !epicLoginWindow.isDestroyed() ? epicLoginWindow.webContents : null;
      if (settled || !wc) return;
      try {
        // Fetch the redirect endpoint from the main process through the login window's session,
        // so cookies behave exactly like the page's own fetch without splicing the URL into an
        // injected script body.
        const res = await wc.session.fetch(redirectUrl, { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        const code = (json && (json.authorizationCode || json.code)) || '';
        if (code) {
          const token = await epicAuth.authenticateEpicWithCode(code, { userDataDir: userData });
          debug.log('[epic] account connected');
          finish({ ok: true, accountId: epicAuth.normalizeEpicAccountId(token && token.account_id), displayName: (token && token.displayName) || '' });
        }
      } catch (err) {
        debug.log(`[epic] auth code capture failed: ${err.message || err}`);
      }
    };

    attachCapture(epicLoginWindow.webContents);
    epicLoginWindow.on('closed', () => finish({ ok: false, error: 'window-closed' }));
    epicLoginWindow.loadURL(loginUrl).catch((err) => finish({ ok: false, error: String(err && err.message ? err.message : err) }));
  });
});

// ---- Xbox PC connection and library import -------------------------------------------------
let xboxLoginWindow = null;
ipcMain.handle('xbox-pc:status', async () => {
  try {
    const xboxPc = require(path.join(__dirname, '../parser/xboxPc.js'));
    xboxPc.setUserDataPath(userData);
    return xboxPc.status();
  } catch (err) {
    return { connected: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('xbox-pc:disconnect', async () => {
  try {
    const xboxPc = require(path.join(__dirname, '../parser/xboxPc.js'));
    xboxPc.setUserDataPath(userData);
    xboxPc.clearAuth();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('xbox-pc:login', async () => {
  const xboxPc = require(path.join(__dirname, '../parser/xboxPc.js'));
  xboxPc.setUserDataPath(userData);
  if (xboxLoginWindow && !xboxLoginWindow.isDestroyed()) {
    xboxLoginWindow.focus();
    return { ok: false, error: 'login-already-open' };
  }
  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (xboxLoginWindow && !xboxLoginWindow.isDestroyed()) xboxLoginWindow.destroy();
      xboxLoginWindow = null;
      resolve(result);
    };
    const state = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    let loginUrl;
    try {
      loginUrl = xboxPc.buildXboxDirectAuthorizeUrl(xboxPc.XBOX_PC_CLIENT_ID, state);
    } catch (err) {
      return finish({ ok: false, error: String(err && err.message ? err.message : err) });
    }
    // Track the login window and any consent/SSO popup that can carry the redirect.
    const trackedContents = new Set();
    const tryCapture = (contents, url) => {
      const wc =
        contents && !contents.isDestroyed()
          ? contents
          : xboxLoginWindow && !xboxLoginWindow.isDestroyed()
            ? xboxLoginWindow.webContents
            : null;
      if (settled || !wc) return;
      // Navigation events carry the redirect URL before it commits; fall back to the current URL
      // for the poll timer and for flows that never surface navigation events (blocked localhost
      // load — the URL is still readable from getURL() once the navigation is attempted).
      const result = xboxPc.extractXboxDirectAuthResult(url || wc.getURL(), state);
      if (!result) return;
      if (result.error) {
        finish({ ok: false, error: result.error });
        return;
      }
      xboxPc
        .completeXboxDirectAuthentication(result)
        .then((auth) => finish({ ok: true, gamertag: auth.gamertag || '', xuid: auth.xuid || '' }))
        .catch((err) => finish({ ok: false, error: String(err && err.message ? err.message : err) }));
    };
    xboxLoginWindow = new BrowserWindow({
      width: 560,
      height: 760,
      title: t('connect-microsoft-xbox-network', 'Connect Microsoft / Xbox Network', 'Connecter Microsoft / Xbox Network'),
      parent: MainWin && !MainWin.isDestroyed() ? MainWin : undefined,
      autoHideMenuBar: true,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    xboxLoginWindow.once('ready-to-show', () => {
      if (xboxLoginWindow && !xboxLoginWindow.isDestroyed()) {
        xboxLoginWindow.show();
        xboxLoginWindow.focus();
      }
    });
    const attach = (contents) => {
      contents.on('will-navigate', (event, url) => {
        // Do NOT prevent the navigation: the callback URL must commit (even as a failed localhost
        // load) so getURL() exposes the code to the poll fallback.
        tryCapture(contents, url);
      });
      contents.on('will-redirect', (event, url) => {
        tryCapture(contents, url);
      });
      contents.on('did-navigate', () => tryCapture(contents));
      contents.on('did-navigate-in-page', () => tryCapture(contents));
      trackedContents.add(contents);
      contents.on('destroyed', () => trackedContents.delete(contents));
    };
    xboxLoginWindow.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: xboxLoginWindow,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      },
    }));
    xboxLoginWindow.webContents.on('did-create-window', (childWindow) => attach(childWindow.webContents));
    attach(xboxLoginWindow.webContents);
    xboxLoginWindow.on('closed', () => finish({ ok: false, error: 'window-closed' }));
    // Safety net: some flows end on a redirect the navigation events never surface (blocked
    // localhost load); poll the current URL until the user closes the window.
    pollTimer = setInterval(() => {
      for (const wc of trackedContents) tryCapture(wc);
    }, 400);
    xboxLoginWindow.loadURL(loginUrl).catch((err) => finish({ ok: false, error: String(err && err.message ? err.message : err) }));
  });
});

ipcMain.handle('xbox-pc:import', async (event, opts = {}) => {
  try {
    const xboxPc = require(path.join(__dirname, '../parser/xboxPc.js'));
    xboxPc.setUserDataPath(userData);
    const lang = String(opts.lang || '').trim() || (configJS && configJS.achievement && configJS.achievement.lang) || 'english';
    const result = await xboxPc.importLibrary({
      lang,
      onProgress: (p) => {
        if (!event.sender.isDestroyed()) event.sender.send('xbox-pc:import-progress', p);
      },
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Kill any Watchdog currently holding the WS port (8082). The monitor is normally our own supervised
// child, but a crash of this app can leave an orphaned Watchdog behind (it outlives its parent on
// Windows), so we sweep by the well-known port once at startup before the first launch. Normal quits
// tear the child down explicitly; respawns skip the sweep.
function killWatchdog() {
  try {
    const out = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (line.includes(':8082') && /LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill.exe', ['/F', '/PID', pid], { windowsHide: true, stdio: 'ignore' });
        debug.log(`[watchdog] killed stale instance PID ${pid} on port 8082`);
      } catch {}
    }
  } catch (err) {
    debug.log(`[watchdog] killWatchdog failed: ${err.message}`);
  }
}

// Supervise the Watchdog monitor: we re-launch this executable in ELECTRON_RUN_AS_NODE mode with an
// 'ipc' channel (koffi native deps are ABI-stable), forward its overlay/notification requests here,
// and re-spawn it on unexpected exit.
let monitorProc = null;
let monitorRespawnTimer = null;
let watchdogStatusInterval = null;
let monitorRespawnDelay = 3000;
let watchdogSwept = false;

// Route a monitor IPC message. It sends { argv: ['--wintype=overlay'|'notification', ...] } in place
// of the legacy `Achievement Watcher.exe --wintype=...` spawn; feed it through the existing dispatch.
function handleMonitorMessage(msg) {
  try {
    if (msg && Array.isArray(msg.argv)) parseArgs(minimist(msg.argv));
    else if (msg && msg.overlayControl) handleOverlayControl(msg.overlayControl.action, msg.overlayControl.payload);
    else if (msg && msg.gameActivity) setGameActivity(msg.gameActivity.count);
  } catch (err) {
    debug.log(`[monitor] message handling failed: ${err.message || err}`);
  }
}

// Tell the monitor whether the overlay is on screen: it owns the hotkey flag, so a change it did not
// initiate must be reported from the window's own lifecycle events (redundant sends are dropped).
function notifyMonitorOverlayState(opened) {
  if (!monitorProc || monitorProc.exitCode !== null || monitorProc.killed || !monitorProc.connected) return;
  try {
    monitorProc.send({ overlayState: { opened: opened === true } });
  } catch (err) {
    debug.log(`[monitor] overlay state sync failed: ${err.message || err}`);
  }
}

// Schedule the supervised respawn with an exponential backoff (3s -> 6s -> 12s -> ... -> 60s cap)
// so a monitor that crashes in a loop (bad code, missing native module, config corruption) does not
// hammer the machine every three seconds. The backoff resets once a child survives 30 seconds.
function scheduleMonitorRespawn() {
  if (app.isQuiting || monitorRespawnTimer) return;
  const delay = monitorRespawnDelay;
  monitorRespawnDelay = Math.min(monitorRespawnDelay * 2, 60000);
  monitorRespawnTimer = setTimeout(() => {
    monitorRespawnTimer = null;
    launchWatchdog();
  }, delay);
  debug.log(`[monitor] respawn scheduled in ${delay}ms`);
}

// The main window is usually not created yet when this first runs (createMainWindow() runs after
// launchWatchdog() on a fresh start), so callers must not assume a non-null result means "no window".
function getRendererPid() {
  try {
    if (MainWin && !MainWin.isDestroyed() && MainWin.webContents && !MainWin.webContents.isDestroyed()) {
      const rendererPid = MainWin.webContents.getOSProcessId();
      if (Number.isInteger(rendererPid) && rendererPid > 0) return rendererPid;
    }
  } catch {}
  return null;
}

// Covers the gap AW_APP_PIDS cannot: on a fresh launch the watchdog is already running (and has
// already read its env) by the time createMainWindow() gives the renderer its OS PID. Without this,
// the "send Escape to the game, never to AW itself" safeguard would not protect the main window
// until the next watchdog respawn.
function notifyWatchdogOfAppPid() {
  const rendererPid = getRendererPid();
  if (!rendererPid) return;
  if (!monitorProc || monitorProc.exitCode !== null || monitorProc.killed || !monitorProc.connected) return;
  try {
    monitorProc.send({ appPid: rendererPid });
  } catch {}
}

function launchWatchdog() {
  // Clearing the handle is not enough: scheduleMonitorRespawn() treats a non-null monitorRespawnTimer
  // as "a respawn is already pending" and returns early. A manual restart (tray/Settings) landing
  // while a respawn was pending used to leave the stale, already-cleared handle in place, which
  // silently disabled supervised respawn for the rest of the session — the next monitor crash then
  // killed notifications and playtime tracking with no way back short of restarting the app.
  clearTimeout(monitorRespawnTimer);
  monitorRespawnTimer = null;
  if (monitorProc && monitorProc.exitCode === null && !monitorProc.killed) {
    return { ok: true }; // already running — idempotent
  }

  const baseDir = manifest.config.debug ? path.join(__dirname, '../../') : path.dirname(process.execPath);
  const wdDir = path.join(baseDir, 'watchdog');

  // Validate the launch chain up front. Missing pieces (notably watchdog/node_modules) would
  // otherwise fail in ways that are hard to diagnose from a detached child.
  const requiredPaths = {
    'watchdog dir': wdDir,
    'watchdog/node_modules': path.join(wdDir, 'node_modules'),
  };
  for (const [label, p] of Object.entries(requiredPaths)) {
    if (!fs.existsSync(p)) {
      debug.log(`[monitor] Cannot launch: missing ${label} at ${p}`);
      return { ok: false, error: `missing ${label}` };
    }
  }

  // Run the monitor under Electron's own Node (ELECTRON_RUN_AS_NODE; replaces the bundled node.exe),
  // with a 128 MB V8 ceiling — the watchdog is a lightweight event-driven process.
  const nodeOpts = [process.env.NODE_OPTIONS, '--max-old-space-size=128'].filter(Boolean).join(' ');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: nodeOpts,
    AW_USER_DATA: userData,
    // Where the bundled notification sounds live, so the Watchdog's Windows toasts play the
    // same sound files as the in-game overlay (user-imported sounds are under <userData>/sounds).
    AW_SOUNDS_DIR: path.join(__dirname, '../sounds'),
    // The Watchdog's Windows toasts should appear under Achievement Watcher's own identity, not a
    // borrowed Xbox app id. The app's AUMID is registered by the installer's Start Menu shortcut;
    // the Watchdog checks it and falls back to the legacy ids when it is not registered (dev runs).
    AW_AUMID: manifest.config.appid || '',
    // URI scheme a toast click activates. Empty when registration failed (or in a dev run), in
    // which case the Watchdog omits the activation instead of emitting one that goes nowhere.
    AW_TOAST_PROTOCOL: toastProtocolReady ? TOAST_PROTOCOL : '',
    // Lets the Watchdog's "send Escape on controller overlay open" helper avoid ever injecting
    // input into the Achievement Watcher window itself (e.g. when the combo is pressed while the
    // app has focus instead of the game). Covers both the browser process and the main window's
    // renderer, whichever owns the foreground HWND.
    // MainWin usually does not exist yet on a fresh launch (createMainWindow() runs after this),
    // so this only covers the common respawn/restart case. notifyWatchdogOfAppPid() covers the gap.
    AW_APP_PIDS: [String(process.pid), getRendererPid()]
      .filter(Boolean)
      .join(','),
  };

  try {
    const child = spawn(process.execPath, ['watchdog.js'], {
      cwd: wdDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // 'ipc' => process.send()/'message' in the child
    });
    monitorProc = child;
    child.stdout?.on('data', (d) => debug.log(`[monitor] ${String(d).trimEnd()}`));
    child.stderr?.on('data', (d) => debug.log(`[monitor:err] ${String(d).trimEnd()}`));
    child.on('message', handleMonitorMessage);
    child.on('error', (err) => {
      // spawn failure (missing exe, EACCES, ...) emits 'error' but not 'exit'; without this the stale
      // monitorProc would make every future launch return "already running" and the monitor would
      // stay dead for the whole session.
      debug.log(`[monitor] spawn error: ${err.message}`);
      if (monitorProc === child) monitorProc = null;
      // Only the monitor can tell us a game ended. If it dies mid-session the count would stay
      // above zero forever and updates would never be offered again.
      setGameActivity(0);
      scheduleMonitorRespawn();
    });
    child.on('exit', (code, signal) => {
      debug.log(`[monitor] exited code=${code}${signal ? ` signal=${signal}` : ''}`);
      const wasCurrent = monitorProc === child;
      if (wasCurrent) monitorProc = null; // only clear if still the current child
      if (wasCurrent) setGameActivity(0); // see the spawn-error handler above
      if (wasCurrent) scheduleMonitorRespawn(); // manual restarts take over their own relaunch
    });
    // Backoff reset: if this child survives 30s the crash loop is likely over.
    const stableTimer = setTimeout(() => {
      if (!app.isQuiting) monitorRespawnDelay = 3000;
    }, 30000);
    child.once('exit', () => clearTimeout(stableTimer));
    child.once('error', () => clearTimeout(stableTimer));
    debug.log('[monitor] launched (node.exe watchdog.js, ipc channel)');
    return { ok: true };
  } catch (err) {
    debug.log(`[monitor] exception launching: ${err.message}`);
    scheduleMonitorRespawn();
    return { ok: false, error: err.message };
  }
}

// Manual restart (Settings button or tray menu): kill the current child then relaunch so it always
// loads the current code. We wait for the child's actual 'exit' (port 8082 is then free) instead of
// a fixed sleep, with a safety fallback in case the exit event is lost.
function restartWatchdog() {
  monitorRespawnDelay = 3000;
  const child = monitorProc;
  monitorProc = null;
  if (!child || child.exitCode !== null || child.killed) return launchWatchdog();
  const fallback = setTimeout(() => launchWatchdog(), 5000);
  child.once('exit', () => {
    clearTimeout(fallback);
    launchWatchdog();
  });
  try {
    child.kill();
  } catch {
    clearTimeout(fallback);
    return launchWatchdog();
  }
  return { ok: true };
}

ipcMain.handle('start-watchdog', async (event) => {
  event.sender.send('reset-watchdog-status');
  return restartWatchdog();
});

// The renderer re-seeds cfg/gameIndex.json at the end of every library scan. Ask the running
// Watchdog to reload it so non-Steam games added while it is already up are tracked without a
// restart. No-op when the Watchdog is down; the next launch reads the fresh index anyway.
ipcMain.handle('watchdog-reload-playtime-index', () => {
  if (!monitorProc || monitorProc.exitCode !== null || monitorProc.killed || !monitorProc.connected) return false;
  try {
    monitorProc.send({ reloadPlaytimeIndex: true });
    return true;
  } catch (err) {
    debug.log(`[monitor] playtime index reload request failed: ${err.message}`);
    return false;
  }
});

// --- Background emulator auto-fix (daemon) -----------------------------------
// While the window is closed, periodically apply the same one-shot emulator fix the UI scan does,
// gated by emulator.autoApplyNewGames, and toast each game actually fixed.
let bgAutoFixTimer = null;
let bgAutoFixInFlight = false;
let bgKnownAppids = null; // baseline of discovered appids; null until the first full pass seeds it
const BG_AUTOFIX_INTERVAL_MS = 15 * 60 * 1000;

function notifyEmulatorFixed(game) {
  try {
    if (configJS && configJS.notification && configJS.notification.notify === false) return; // master notif switch
    if (!Notification.isSupported || !Notification.isSupported()) return;
    const name = (game && game.name) || `AppID ${game && game.appid}`;
    new Notification({
      title: t('emulator-fix-applied', 'Emulator fix applied', 'Correctif émulateur appliqué'),
      body: t('x-is-ready-achievements-enabled', '{name} is ready — achievements enabled.', '{name} est prêt — succès activés.', { name }),
      icon: path.join(__dirname, '../resources/icon/icon.png'),
    }).show();
    debug.log(`[bg-autofix] toast: emulator fix applied for ${name}`);
  } catch (err) {
    debug.log(`[bg-autofix] notify failed: ${err.message || err}`);
  }
}

async function runBackgroundAutoFix(reason) {
  if (MainWin) return; // window open → the renderer's own new-game scan handles fixes
  if (bgAutoFixInFlight) return;
  try {
    await startEngines(); // loads configJS + achievementsJS
  } catch (err) {
    debug.log(`[bg-autofix] startEngines failed: ${err.message || err}`);
    return;
  }
  if (!configJS || !configJS.emulator || configJS.emulator.autoApplyNewGames === false) return;
  bgAutoFixInFlight = true;
  try {
    // Once a baseline exists, do a cheap discovery-only poll first and run the heavier full scan only
    // when a genuinely new install appears (mirrors the renderer's runNewGameScan).
    if (bgKnownAppids !== null) {
      const discovered = await achievementsJS.detectInstalledAppids(configJS);
      const fresh = discovered.filter((id) => !bgKnownAppids.has(String(id)));
      bgKnownAppids = new Set(discovered.map(String));
      if (fresh.length === 0) return;
      debug.log(`[bg-autofix] ${fresh.length} new install(s) detected: ${fresh.join(', ')}`);
    }
    if (MainWin) return; // user opened the window during the poll — defer to the renderer
    debug.log(`[bg-autofix] running headless scan (${reason})`);
    // makeList drives the same one-shot auto-fix as the UI scan, but the per-game emulator setup now
    // runs in the background and completes AFTER makeList returns. The "emulator fix applied" toast is
    // therefore fired by the setEmulatorFixedHandler callback (registered in startEngines) as each fix
    // actually lands — not collected from onGame here.
    await achievementsJS.makeList(configJS, () => {}, () => {});
    try {
      const all = await achievementsJS.detectInstalledAppids(configJS);
      bgKnownAppids = new Set(all.map(String));
    } catch {}
    debug.log(`[bg-autofix] done — background emulator setup (if any) will toast on completion`);
  } catch (err) {
    debug.log(`[bg-autofix] failed: ${err.message || err}`);
  } finally {
    bgAutoFixInFlight = false;
  }
}

function scheduleBackgroundAutoFix() {
  if (bgAutoFixTimer) return;
  // Initial pass shortly after startup (catches games installed while AW was off / closed), then a
  // periodic poll on the same cadence the renderer uses.
  setTimeout(() => runBackgroundAutoFix('startup'), 90 * 1000);
  bgAutoFixTimer = setInterval(() => runBackgroundAutoFix('interval'), BG_AUTOFIX_INTERVAL_MS);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Microsoft Edge ships with Windows 10/11 and is Chromium-based, so puppeteer can drive it exactly
// like Chrome (the stealth plugin works on the CDP layer, independent of which Chromium binary runs).
// Using it as a fallback means AW never needs to download and retain a second, quickly outdated browser.
function findInstalledEdge() {
  if (process.platform !== 'win32') return null;
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], 'C:\\Program Files (x86)', 'C:\\Program Files'];
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function startPuppeteer(headless, strip) {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  const ChromeLauncher = require('chrome-launcher');
  // The old `'…macOS path…' || ChromeLauncher…` form always short-circuited to the (truthy) macOS
  // string, so on Windows Puppeteer never reused an installed Chrome and always downloaded Chromium.
  // Pick per-platform; getInstallations()[0] may be undefined when Chrome is not installed.
  const installedChromePath =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : ChromeLauncher.Launcher.getInstallations()[0];
  // Browser preference: installed Chrome, then Edge (included with supported Windows versions).
  const browserPaths = [installedChromePath, findInstalledEdge()].filter(
    (browserPath, index, paths) => browserPath && fs.existsSync(browserPath) && paths.indexOf(browserPath) === index
  );
  const launchArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-extensions'];
  if (!puppeteerWindow.browser) {
    if (browserPaths.length === 0) throw new Error('Steam scraping requires Google Chrome or Microsoft Edge.');
    let lastError;
    for (const executablePath of browserPaths) {
      try {
        puppeteerWindow.browser = await puppeteer.launch({ headless: Boolean(headless), executablePath, args: launchArgs });
        break;
      } catch (err) {
        lastError = err;
        debug.log(`puppeteer: browser launch failed for ${executablePath} (${err.message})`);
      }
    }
    if (!puppeteerWindow.browser) throw lastError;
  }
  if (!puppeteerWindow.context) puppeteerWindow.context = await puppeteerWindow.browser.createBrowserContext();
  if (!puppeteerWindow.pagesh) {
    puppeteerWindow.pagesh = await puppeteerWindow.context.newPage();
    if (strip) {
      const page = puppeteerWindow.pagesh;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }
  }
}

async function scrapeWithPuppeteer(info = { appid: 269770 }, alternate) {
  return withScrapeLease(currentlyscraping, alternate, async () => {
    await startPuppeteer(alternate, alternate?.steamhunters);
    try {
      if (alternate) {
        if (alternate.steamhunters) {
          if (alternate.userlist) {
            const url = `https://steamhunters.com/apps/${info.appid}/users?sort=completionstate`;
            const page = puppeteerWindow.pagesh;
            try {
              await page.goto(url);
              await page.waitForFunction(() => {
                return Array.from(document.querySelectorAll('script')).some((s) => s.textContent.includes('var sh'));
              });
              await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script'));
                const target = scripts.find((s) => s.textContent.includes('var sh'));
                eval(target.textContent);
              });
              const users = (await page.evaluate(() => sh.model.listData.pagedList.items)) || [];

              const results = [];
              users.forEach((item) => {
                results.push({
                  id: item.steamId,
                  isPublic: item.privacyState === 0,
                });
              });
              info.users = users;
            } catch (e) {
              debug.log(e);
            }
            return;
          }
          let start = Date.now();
          const url = `https://steamhunters.com/apps/${info.appid}/achievements?group=&sort=name`;
          const page = puppeteerWindow.pagesh;
          try {
            await page.goto(url);
            await page.waitForFunction(() => {
              return Array.from(document.querySelectorAll('script')).some((s) => s.textContent.includes('var sh'));
            });
            await page.evaluate(() => {
              const scripts = Array.from(document.querySelectorAll('script'));
              const target = scripts.find((s) => s.textContent.includes('var sh'));
              eval(target.textContent);
            });
            const achievements = (await page.evaluate(() => sh.model.listData.pagedList.items)) || [];

            const results = [];
            achievements.forEach((item) => {
              results.push({
                name: item.apiName,
                default_value: 0,
                displayName: item.name,
                hidden: item.hidden ? 1 : 0,
                description: item.description || ' ',
                icon: item.icon,
                icongray: item.iconGray,
              });
            });
            info.achievements = results;
            debug.log(`[${info.appid}] steamhunters took ${(Date.now() - start) / 1000}s`);
          } catch (e) {
            debug.log(e);
          }
          return;
        }

        // NB: the old steamcommunity-in-page and steamdb scrape branches were removed — every caller
        // goes through the steamhunters paths above (the steamcommunity schema now uses a plain HTTP
        // fetch, see fetchSteamCommunityAchievements), and the steamdb branch relied on a
        // `puppeteerWindow.page` that startPuppeteer never created.
      }
    } catch (err) {
      debug.log(err);
    }
  }, delay);
}

// Drop the payloads a SteamDB/HTML scrape never reads: video, fonts and (optionally) images. The
// shared SteamHunters page does this via startPuppeteer(strip), but the on-demand SteamDB pages open
// their own page — without this they pull the whole capsule/screenshot gallery over the wire.
async function blockHeavyResources(page, { keepImages = false } = {}) {
  const blockedTypes = new Set(['media', 'font', 'stylesheet']);
  if (!keepImages) blockedTypes.add('image');
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (blockedTypes.has(req.resourceType()) || /\.(mp4|webm|gif|woff2?|ttf|otf)(\?|$)/i.test(req.url())) req.abort();
    else req.continue();
  });
}

// SteamDB library-capsule covers: modern Steam covers live under a hashed store_item_assets path
// that cannot be derived from the appid. SteamDB's app-info page lists the real asset links —
// scrape it (stealth browser: it 403s plain requests) and cache the whole list for 30 days. The
// scrape is serialized through one queue so a cold first scan never opens N parallel browser pages.
const steamdbCoversDir = path.join(userData, 'steam_cache', 'steamdb_covers');
const steamdbCoversInFlight = new Map();
let steamdbCoversQueue = Promise.resolve();

function filterSteamDbCoversByOrientation(urls, orientation) {
  const list = Array.isArray(urls) ? urls : [];
  if (String(orientation || '').toLowerCase() === 'landscape') {
    const wide = list.filter((url) => /library_capsule/i.test(url));
    return wide.length ? wide : list;
  }
  const tall = list.filter((url) => /library_600x900/i.test(url));
  return tall.length ? tall : list;
}

async function fetchSteamDbCovers(appid, orientation = 'portrait') {
  const id = String(appid || '').trim();
  if (!/^\d+$/.test(id)) return [];
  const cacheFile = path.join(steamdbCoversDir, `${id}.json`);
  const TTL = 30 * 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < TTL) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached.urls)) return filterSteamDbCoversByOrientation(cached.urls, orientation);
    }
  } catch {
    /* stale/corrupt -> refetch */
  }
  if (steamdbCoversInFlight.has(id)) return steamdbCoversInFlight.get(id);

  const scrape = async () => {
    const steamdbCover = require(path.join(app.getAppPath(), 'parser/steamdbCover.js'));
    let page = null;
    try {
      await startPuppeteer(true, false);
      page = await puppeteerWindow.context.newPage();
      await blockHeavyResources(page);
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
      );
      await page.goto(`https://steamdb.info/app/${id}/info/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page
        .waitForSelector('a[href*="library_600x900.jpg"], a[href*="library_capsule"], #js-assets-table', { timeout: 8000 })
        .catch(() => {});
      const html = await page.evaluate(() => {
        const assets = document.querySelector('#js-assets-table');
        return assets ? assets.outerHTML : document.documentElement.innerHTML;
      });
      const urls = steamdbCover.coversFromHtml(id, html);
      if (urls.length) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify({ appid: id, urls }, null, 2));
        } catch {
          /* cache write failure is non-fatal */
        }
        debug.log(`[${id}] SteamDB covers: ${urls.length} asset(s)`);
      } else {
        debug.log(`[${id}] SteamDB covers: no library asset found`);
      }
      return urls;
    } catch (err) {
      debug.log(`[${id}] SteamDB covers fetch failed: ${err.message || err}`);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  };
  const pending = steamdbCoversQueue.then(scrape);
  steamdbCoversQueue = pending.catch(() => {});
  steamdbCoversInFlight.set(id, pending);
  try {
    return filterSteamDbCoversByOrientation(await pending, orientation);
  } finally {
    steamdbCoversInFlight.delete(id);
  }
}

async function fetchSteamDbCover(appid) {
  const urls = await fetchSteamDbCovers(appid, 'portrait');
  return urls[0] || null;
}

ipcMain.handle('get-steamdb-cover', async (event, appid) => {
  return await fetchSteamDbCover(appid);
});

// SteamGridDB covers (bundled public API key): when neither the guessable CDN path nor SteamDB has
// a portrait, the community grids usually do. Results are cached 30 days per game name.
const steamgriddbCoversDir = path.join(userData, 'steam_cache', 'steamgriddb_covers');
const steamgriddbCoversInFlight = new Map();

// Prefer an exact title match, then a token-level match (all query words present, at most one extra
// word for edition tags). Never take an unrelated first result — a wrong cover is worse than none.
function pickSteamGridDbGame(games, name) {
  const list = Array.isArray(games) ? games : [];
  const queryTokens = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tokensOf = (g) => String((g && g.name) || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const exact = list.find((g) => String((g && g.name) || '').trim().toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (list.length === 1) return list[0];
  if (!queryTokens.length) return null;
  return (
    list.find((g) => {
      const tokens = tokensOf(g);
      if (!tokens.length) return false;
      return queryTokens.every((t) => tokens.includes(t)) && tokens.length - queryTokens.length <= 1;
    }) || null
  );
}

async function fetchSteamGridDbCovers(gameName, limit = 8, orientation = 'portrait') {
  const name = String(gameName || '').trim();
  if (!name) return [];
  const wantsPortrait = String(orientation || 'portrait').toLowerCase() !== 'landscape';
  const key = require('crypto').createHash('sha1').update(name.toLowerCase()).digest('hex');
  const cacheFile = path.join(steamgriddbCoversDir, `${key}.json`);
  const pickUrls = (grids) => {
    const list = Array.isArray(grids) ? grids : [];
    let matched = list.filter((g) =>
      wantsPortrait
        ? Number(g.width) === 600 && Number(g.height) === 900
        : Number(g.width) === 920 && Number(g.height) === 430
    );
    if (!matched.length) matched = list.filter((g) => g.url);
    return matched.slice(0, limit).map((g) => String(g.url));
  };
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 30 * 24 * 60 * 60 * 1000) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached.grids)) return pickUrls(cached.grids);
    }
  } catch {
    /* stale/corrupt -> refetch */
  }
  if (steamgriddbCoversInFlight.has(key)) return steamgriddbCoversInFlight.get(key);

  const pending = (async () => {
    try {
      const apiKey = getSteamGridDbApiKey();
      const searchRes = await fetch(`${BASE_URL}/search/autocomplete/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!searchRes.ok) return [];
      const search = await searchRes.json();
      const game = pickSteamGridDbGame(search.data, name);
      if (!game || !game.id) return [];
      const gridsRes = await fetch(`${BASE_URL}/grids/game/${game.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!gridsRes.ok) return [];
      const grids = await gridsRes.json();
      const gridList = (Array.isArray(grids.data) ? grids.data : []).filter((g) => g.url);
      if (gridList.length) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({ name, grids: gridList.map((g) => ({ url: String(g.url), width: Number(g.width), height: Number(g.height) })) }, null, 2)
          );
        } catch {
          /* cache write failure is non-fatal */
        }
      }
      return pickUrls(gridList);
    } catch (err) {
      debug.log(`[steamgriddb] cover list failed for "${name}": ${err.message || err}`);
      return [];
    }
  })();
  steamgriddbCoversInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    steamgriddbCoversInFlight.delete(key);
  }
}

async function fetchSteamGridDbCover(gameName) {
  const urls = await fetchSteamGridDbCovers(gameName, 1, 'portrait');
  return urls[0] || null;
}

ipcMain.handle('get-steamgriddb-cover', async (event, gameName) => {
  return await fetchSteamGridDbCover(gameName);
});

// Cover picker options: SteamDB library assets plus SteamGridDB community grids, filtered to the
// library orientation (portrait 600x900 or landscape 920x430), so the gallery matches the current
// vertical/horizontal tile layout.
ipcMain.handle('get-cover-options', async (event, { name, orientation, steamAppid } = {}) => {
  const gameName = String(name || '').trim();
  const orient = String(orientation || 'portrait').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
  // SteamDB is only queried for a real Steam release (explicit numeric steamAppid). Non-Steam ids
  // (GOG/Xbox/local) would hit a SteamDB page with no assets and stall the gallery.
  const id = /^\d+$/.test(String(steamAppid || '').trim()) ? String(steamAppid).trim() : '';
  const [steamdb, grids] = await Promise.all([
    /^\d+$/.test(id) ? fetchSteamDbCovers(id, orient) : Promise.resolve([]),
    gameName ? fetchSteamGridDbCovers(gameName, 8, orient) : Promise.resolve([]),
  ]);
  return { steamdb: Array.isArray(steamdb) ? steamdb : [], grids: Array.isArray(grids) ? grids : [] };
});

// Top-owners SteamID pool. Last-resort seed for the keyless schema/rarity scrape: when no SteamHunters
// owner 100%'d a game, these prolific collectors' public profiles are tried instead. Scraped from
// SteamLadder through the stealth browser (it challenges plain requests) and disk-cached for 7 days.
let topOwnersInFlight = null;
async function fetchTopOwners() {
  const cacheFile = path.join(userData, 'steam_cache', 'topOwners.json');
  const TTL = 7 * 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < TTL) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached) && cached.length) return cached;
    }
  } catch {
    /* stale/corrupt -> refetch */
  }
  if (topOwnersInFlight) return topOwnersInFlight;

  topOwnersInFlight = (async () => {
    const topOwners = require(path.join(app.getAppPath(), 'parser/topOwners.js'));
    let page = null;
    try {
      await startPuppeteer(true, false);
      page = await puppeteerWindow.context.newPage();
      await blockHeavyResources(page);
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
      );
      await page.goto(topOwners.DEFAULT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('a[href^="/profile/"]', { timeout: 12000 }).catch(() => {});
      const html = await page.content();
      const ids = topOwners.extractSteamIdsFromHtml(html, 250);
      if (ids.length >= 10) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(ids, null, 0));
        } catch {
          /* cache write failure is non-fatal */
        }
        debug.log(`[top-owners] scraped ${ids.length} SteamIDs`);
        return ids;
      }
      debug.log(`[top-owners] not enough SteamIDs found (${ids.length})`);
      return [];
    } catch (err) {
      debug.log(`[top-owners] fetch failed: ${err.message || err}`);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  })();
  try {
    return await topOwnersInFlight;
  } finally {
    topOwnersInFlight = null;
  }
}

ipcMain.handle('get-top-owners', async () => {
  return await fetchTopOwners();
});

// SteamDB launch-metadata fallback: when local exe detection fails, scrape the game's SteamDB config
// page (through the stealth browser — it 403s plain requests) to learn the launch executable's
// process name so the watchdog can still detect the game running. Disk-cached for 30 days since
// launch options change rarely. Returns { process_name, best_process_name, arguments } or null.
const steamdbLaunchInFlight = new Map();
async function fetchSteamDbLaunch(appid) {
  const id = String(appid || '').trim();
  if (!/^\d+$/.test(id)) return null;
  const cacheFile = path.join(userData, 'steam_cache', 'steamdb_launch', `${id}.json`);
  const TTL = 30 * 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < TTL) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return cached && cached.best_process_name ? cached : null;
    }
  } catch {
    /* stale/corrupt -> refetch */
  }
  if (steamdbLaunchInFlight.has(id)) return steamdbLaunchInFlight.get(id);

  const pending = (async () => {
    const steamdbLaunch = require(path.join(app.getAppPath(), 'parser/steamdbLaunch.js'));
    let page = null;
    try {
      await startPuppeteer(true, false);
      page = await puppeteerWindow.context.newPage();
      await blockHeavyResources(page);
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
      );
      await page.goto(`https://steamdb.info/app/${id}/config/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('h2', { timeout: 8000 }).catch(() => {});
      // Pull just the "Launch Options" section HTML; steamdbLaunch parses/ranks it (unit-tested).
      const sectionHtml = await page.evaluate(() => {
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const h = Array.from(document.querySelectorAll('h2')).find((el) => norm(el.textContent) === 'Launch Options');
        if (!h) return '';
        let html = h.outerHTML;
        let n = h.nextElementSibling;
        while (n && n.tagName !== 'H2') {
          html += n.outerHTML;
          n = n.nextElementSibling;
        }
        return html;
      });
      const meta = steamdbLaunch.launchMetadataFromHtml(id, sectionHtml);
      if (meta && meta.best_process_name) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(meta, null, 2));
        } catch {
          /* cache write failure is non-fatal */
        }
        debug.log(`[${id}] SteamDB launch metadata: process_name="${meta.process_name}"`);
        return meta;
      }
      debug.log(`[${id}] SteamDB launch metadata: no usable launch option found`);
      return null;
    } catch (err) {
      debug.log(`[${id}] SteamDB launch metadata fetch failed: ${err.message || err}`);
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  })();
  steamdbLaunchInFlight.set(id, pending);
  try {
    return await pending;
  } finally {
    steamdbLaunchInFlight.delete(id);
  }
}

ipcMain.handle('get-steamdb-launch', async (event, appid) => {
  return await fetchSteamDbLaunch(appid);
});

async function searchForGameName(info = { appid: '' }) {
  if (info.appid.length === 0) {
    info.title = undefined;
    return;
  }

  let locale = 'en-US'; // use AW's languague in the future? does it even make a difference in this context?
  let startIndex = 0;
  let matchResult;
  await startPuppeteer(true, false);

  async function scrapePage(startIndex) {
    const page = await puppeteerWindow.context.newPage();

    const url = `https://store.epicgames.com/pt/browse?sortBy=releaseDate&sortDir=DESC&tag=Windows&priceTier=tier3&category=Game&count=40&start=${
      40 * startIndex
    }`;

    try {
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      );
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      await page.waitForFunction(() => !!window.__REACT_QUERY_INITIAL_QUERIES__, { timeout: 15000 });
      const queries = await page.evaluate(() => window.__REACT_QUERY_INITIAL_QUERIES__);
      if (queries.queries) {
        const catalogQuery = queries.queries.find((q) => q?.state?.data?.Catalog?.searchStore?.elements);
        if (catalogQuery) {
          const elements = catalogQuery.state.data.Catalog.searchStore.elements;
          const found = elements.find((el) => el.namespace === info.appid);
          if (found) {
            matchResult = found.title;
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error on page ${startIndex}:`, err.message);
    } finally {
      await page.close();
    }
    return matchResult;
  }

  async function run(start) {
    const tasks = [];
    for (let i = start; i < start + 5; i++) {
      const startIndex = i;
      tasks.push(scrapePage(startIndex));
    }

    await Promise.all(tasks);
  }

  // Bound the catalog scan: without a cap, a title that never matches (delisted, renamed, region-
  // locked) scrapes Epic's store endlessly. Stop after MAX_PAGES; info.title stays undefined on a miss.
  const MAX_PAGES = 100;
  while (!info.title && startIndex < MAX_PAGES) {
    await run(startIndex);
    info.title = matchResult;
    startIndex += 5;
  }
  return;
}

function searchForSteamAppId(info = { name: '' }) {
  if (info.name.length === 0) {
    info.appid = undefined;
    return;
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const closeHiddenSearchWindow = () => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  };
  const searchTimeout = setTimeout(() => {
    if (!info.games) info.games = [];
    closeHiddenSearchWindow();
  }, 30000);
  win.on('closed', () => clearTimeout(searchTimeout));
  win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
  // Inject JS *before* the page starts executing its own scripts
  win.webContents.on('dom-ready', async () => {
    await win.webContents.executeJavaScript(`
      // Override navigator.userAgent
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      });

      // Override platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32'
      });

      // Override vendor
      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.'
      });

      // Fake Chrome object
      window.chrome = { runtime: {} };
    `);
  });
  //win.loadURL(`https://steamdb.info/search/?a=app&q=${info.name}&type=1&category=0`);
  win.loadURL(`https://store.steampowered.com/search/?term=${info.name}&category1=998&ndl=1`);
  win.webContents.on('did-finish-load', async () => {
    let games = undefined;
    try {
      while (!games) {
        games = await win.webContents.executeJavaScript(`
          (() => {
            const rows = document.querySelectorAll('#search_resultsRows a[data-ds-appid]');
            const list = [];

            for (const row of rows) {
              if (list.length >= 10) break;

              const appid = row.getAttribute('data-ds-appid');
              const title = row.querySelector('.title')?.innerText.trim() || '';

              if (appid && title) {
                list.push({ appid, title });
              }
            }

            return list;
          })();
        `);

        await delay(500);
      }
      info.games = games;
    } catch (error) {
      console.error('Failed to find appid:', error);
      if (!info.games) info.games = [];
    } finally {
      closeHiddenSearchWindow();
    }
  });
}

function createMainWindow() {
  try {
    if (MainWin) {
      if (MainWin.isMinimized()) MainWin.restore();
      if (!MainWin.isVisible()) MainWin.show();
      MainWin.focus();
      return;
    }
    let options = manifest.config.window;
    options.show = false;
    options.webPreferences = {
      devTools: manifest.config.debug || false,
      // Full contextIsolation is a separate, larger migration (the renderer relies on nodeIntegration
      // for require/remote). Until then the XSS->RCE surface is held shut by the page CSP (no
      // 'unsafe-inline' / 'unsafe-eval') + output escaping; the flags below are cheap defence-in-depth.
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      enableWebSQL: false,
      spellcheck: false,
      v8CacheOptions: manifest.config.debug ? 'none' : 'code',
      // Tray daemon: the main UI window spends most of its life hidden/minimized. Let Chromium
      // throttle its background timers then (cuts idle CPU). Safe here because the only renderer
      // timer is the 15-min new-game scan (far slower than the ~1/min throttle floor) and WebSocket
      // message handling is unaffected by throttling. The hidden scrape window (searchForSteamAppId)
      // and the overlay/notification windows keep backgroundThrottling:false — they must run hidden.
      backgroundThrottling: true,
    };
    //electron 9 crash if no icon exists to specified path
    try {
      fs.accessSync(options.icon, fs.constants.F_OK);
    } catch {
      delete options.icon;
    }
    //getSteamData({ appid: 2321470, type: 'user' });
    MainWin = new BrowserWindow(options);
    getRemoteMain().enable(MainWin.webContents);
    notifyWatchdogOfAppPid();

    // A download started while the app was tray-only has no taskbar button to draw on. Opening the
    // window creates one, so hand it the progress that is already running.
    if (updateDownloadFraction >= 0) applyUpdateProgressToWindow(MainWin);

    // BrowserWindow.hide() does not reliably update document.visibilityState on every Electron
    // version. Tell the renderer directly so its optional controller polling can stop while the
    // app is resident only in the tray.
    const sendMainWindowVisibility = (visible) => {
      if (!MainWin || MainWin.isDestroyed() || MainWin.webContents.isDestroyed()) return;
      MainWin.webContents.send('main-window-visibility', visible);
    };
    MainWin.on('show', () => sendMainWindowVisibility(true));
    MainWin.on('hide', () => sendMainWindowVisibility(false));
    MainWin.webContents.on('did-finish-load', () => sendMainWindowVisibility(MainWin.isVisible()));

    //Frameless
    if (options.frame === false) MainWin.isFrameless = true;

    //Debug tool
    if (manifest.config.debug) {
      if (openDevTools) MainWin.webContents.openDevTools({ mode: 'undocked' });
      MainWin.isDev = true;
      console.info((({ node, electron, chrome }) => ({ node, electron, chrome }))(process.versions));
      // electron-context-menu is ESM-only in v4+ — must use dynamic import
      import('electron-context-menu').then((mod) => {
        const contextMenuFn = mod.default || mod;
        if (typeof contextMenuFn === 'function') {
          contextMenuFn({
            append: (defaultActions, params, browserWindow) => [
              { role: 'reload', visible: Boolean(params) },
            ],
          });
        }
      }).catch((err) => {
        console.warn('electron-context-menu init failed:', err.message);
      });
    }

    //User agent
    MainWin.webContents.userAgent = manifest.config['user-agent'];
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = manifest.config['user-agent'];
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // External open links: only http(s) reaches the OS — forwarding anything else turned in-page
    // navigation into arbitrary protocol launches (ms-msdt:, search-ms:, UNC…).
    const openExternal = function (event, url) {
      if (url.startsWith('file:///')) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
      else debug.log(`[nav] blocked navigation to a non-http(s) scheme: ${String(url).slice(0, 80)}`);
    };
    MainWin.webContents.on('will-navigate', openExternal); //a href

    // Hardening: never let the renderer spawn its own BrowserWindow; route real links to the OS
    // browser instead (a href target="_blank" lands here — the legacy 'new-window' event no longer
    // exists on Electron ≥22).
    MainWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    // Hardening: the app needs no web permissions (camera, mic, geolocation, web-notifications, …) —
    // its toasts are native and audio samples use <audio>/main-process playback. Deny every request
    // and check so a compromised renderer can't obtain one.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    MainWin.loadFile(manifest.config.window.view);

    let mainWindowShown = false;
    // Window geometry, in the log. "It opened/closed the wrong shape" is otherwise unreconstructable
    // after the fact, and the shape almost always comes from the display it landed on: a bounds line
    // next to the display block in [diag] turns a vague report into something answerable.
    const logWindowGeometry = (event) => {
      if (!MainWin || MainWin.isDestroyed()) return;
      try {
        const b = MainWin.getBounds();
        const c = MainWin.getContentBounds();
        const display = require('electron').screen.getDisplayMatching(b);
        debug.log(
          `[MainWindow] ${event}: bounds=${b.width}x${b.height}@${b.x},${b.y} content=${c.width}x${c.height}` +
            ` state=${MainWin.isMinimized() ? 'minimized' : MainWin.isMaximized() ? 'maximized' : 'normal'}` +
            `${MainWin.isFullScreen() ? '/fullscreen' : ''} visible=${MainWin.isVisible()}` +
            ` display=${display.id}@${display.scaleFactor}x`
        );
      } catch (err) {
        debug.log(`[MainWindow] ${event}: geometry unavailable (${err.message || err})`);
      }
    };
    // 'resize'/'move' fire continuously while dragging, so they are logged once the user lets go.
    MainWin.on('resized', () => logWindowGeometry('resized'));
    MainWin.on('moved', () => logWindowGeometry('moved'));
    MainWin.on('maximize', () => logWindowGeometry('maximized'));
    MainWin.on('unmaximize', () => logWindowGeometry('unmaximized'));
    MainWin.on('minimize', () => logWindowGeometry('minimized'));
    MainWin.on('restore', () => logWindowGeometry('restored'));
    MainWin.on('enter-full-screen', () => logWindowGeometry('enter-full-screen'));
    MainWin.on('leave-full-screen', () => logWindowGeometry('leave-full-screen'));

    const fitMainWindowInWorkArea = () => {
      if (!MainWin || MainWin.isDestroyed()) return;
      try {
        const bounds = MainWin.getBounds();
        const display = require('electron').screen.getDisplayMatching(bounds);
        const fitted = clampWindowBoundsToWorkArea(bounds, display.workArea);
        if (fitted.x === bounds.x && fitted.y === bounds.y) return;
        MainWin.setBounds(fitted);
        debug.log(`[MainWindow] moved into work area: ${bounds.x},${bounds.y} -> ${fitted.x},${fitted.y}`);
      } catch (err) {
        debug.log(`[MainWindow] could not validate its work area (${err.message || err})`);
      }
    };

    const showMainWindow = (reason) => {
      if (mainWindowShown || !MainWin) return;
      mainWindowShown = true;
      debug.log(`[MainWindow] showing (${reason})`);
      fitMainWindowInWorkArea();
      MainWin.show();
      MainWin.focus();
      logWindowGeometry('shown');
      const net = require('net');
      const PIPE_NAME = '\\\\.\\pipe\\AchievementWatchdogPipe';
      function checkWatchdogStatus(callback) {
        const client = net.createConnection(PIPE_NAME);

        client.on('connect', () => {
          callback(true);
          client.end();
        });

        client.on('error', () => {
          callback(false);
        });
      }
      // Report monitor status to the renderer (its connection indicator). The monitor is launched and
      // supervised by the daemon itself (spawned on 'ready', respawned on unexpected exit), so there
      // is no auto-launch here. Stored + cleared on window close so repeated open/close never leaks
      // intervals.
      clearInterval(watchdogStatusInterval);
      watchdogStatusInterval = setInterval(() => {
        checkWatchdogStatus((running) => {
          if (MainWin) MainWin.webContents.send('watchdog-status', running);
        });
      }, 5000);
    };

    const isReady = [
      new Promise(function (resolve) {
        MainWin.once('ready-to-show', () => {
          debug.log('[MainWindow] ready-to-show');
          return resolve();
        }); //Window is loaded and ready to be drawn
      }),
      new Promise(function (resolve) {
        // Clear any handler left behind by a window that was closed before its renderer reported in:
        // handleOnce only unregisters when it actually fires, and registering a second handler for
        // the same channel throws — which would take the whole window creation down with it.
        ipcMain.removeHandler('components-loaded');
        ipcMain.handleOnce('components-loaded', () => {
          debug.log('[MainWindow] components-loaded');
          return resolve();
        }); //Wait for custom event
      }),
    ];

    Promise.all(isReady).then(() => showMainWindow('ready'));
    // Resilience: never let a hung or failed renderer (e.g. a component import error, or a slow/blocked
    // data load) keep the window hidden forever. Once the page can paint, show it after a short grace
    // period even if the 'components-loaded' IPC never arrives.
    MainWin.once('ready-to-show', () => {
      setTimeout(() => showMainWindow('fallback-timeout'), 8000);
    });
    // Absolute last resort: show regardless of paint/IPC events so the app is never invisible.
    setTimeout(() => showMainWindow('absolute-timeout'), 15000);

    MainWin.on('close', (event) => {
      if (app.isQuiting) return;
      if (configJS?.general?.closeToTray === false) {
        debug.log('[MainWindow] close requested -> quitting app (closeToTray disabled)');
        app.isQuiting = true;
        setImmediate(() => app.quit());
        return;
      }
      event.preventDefault();
      logWindowGeometry('closing');
      debug.log('[MainWindow] close intercepted -> hiding to tray');
      clearInterval(watchdogStatusInterval);
      watchdogStatusInterval = null;
      closePuppeteer().catch(() => {});
      MainWin.hide();
    });

    MainWin.on('closed', () => {
      MainWin = null;
      // Daemon stays alive in the tray; just release the window-bound status poller. The monitor and
      // tray are untouched, so background tracking continues.
      clearInterval(watchdogStatusInterval);
      watchdogStatusInterval = null;
      // Closing the window mid-scrape would otherwise leave an orphaned headless Chromium resident
      // (the renderer fires 'close-puppeteer' only once the game list finishes). Tear it down here so
      // a key-less scrape can't leak ~100-200 MB into the background tray state (cf. #32).
      closePuppeteer().catch(() => {});
    });
  } catch (e) {
    debug.log(`Error creating main window: ${e}`);
    if (shouldQuitApp()) app.quit();
  }
}

// --- In-game overlay manipulation: nudge / snap / click-through toggle + position persistence -------
// The overlay (overlay.html) is already drag-movable via -webkit-app-region on its header. These add
// keyboard fine-positioning and a click-through toggle (so it can pass clicks to the game), registered
// as global shortcuts only while the overlay is open. Bounds persist to <userData>/cfg/overlayBounds.json
// (a tiny standalone store, like progressMute.json) and are restored next time the overlay opens.
function overlayBoundsFile() {
  return path.join(userData, 'cfg', 'overlayBounds.json');
}
function readOverlayBounds() {
  try {
    return JSON.parse(fs.readFileSync(overlayBoundsFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function writeOverlayBounds(patch) {
  try {
    const next = Object.assign(readOverlayBounds(), patch);
    fs.mkdirSync(path.dirname(overlayBoundsFile()), { recursive: true });
    fs.writeFileSync(overlayBoundsFile(), JSON.stringify(next), 'utf8');
  } catch (e) {
    debug.log('[overlay-bounds] ' + (e.message || e));
  }
}
let overlayClickThrough = false;
let overlayAppid = null;
function persistInGameBounds() {
  if (overlayWindow && !overlayWindow.isDestroyed()) writeOverlayBounds({ inGame: overlayWindow.getBounds() });
}
function nudgeOverlay(dx, dy) {
  if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return;
  const b = overlayWindow.getBounds();
  overlayWindow.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
  persistInGameBounds();
}
function snapOverlay(corner) {
  if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return;
  const { x: ax, y: ay, width: aw, height: ah } = require('electron').screen.getPrimaryDisplay().workArea;
  const b = overlayWindow.getBounds();
  let x = ax;
  let y = ay;
  switch (corner) {
    case 1: x = ax; y = ay; break; // top-left
    case 2: x = ax + aw - b.width; y = ay; break; // top-right
    case 3: x = ax + Math.floor((aw - b.width) / 2); y = ay + Math.floor((ah - b.height) / 2); break; // center
    case 4: x = ax; y = ay + ah - b.height; break; // bottom-left
    case 5: x = ax + aw - b.width; y = ay + ah - b.height; break; // bottom-right
  }
  overlayWindow.setBounds({ x, y, width: b.width, height: b.height });
  persistInGameBounds();
}
function toggleOverlayClickThrough() {
  if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return;
  overlayClickThrough = !overlayClickThrough;
  overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
}

// --- Controller-driven overlay control (Tier 4) ----------------------------------------------------
// The Watchdog forwards { overlayControl: { action, payload } } over IPC when a controller drives the
// overlay (see handleMonitorMessage). These reuse the same window ops as the keyboard shortcuts.
let overlaySnapIndex = 0;
function moveOverlayRelative(dx, dy) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (!x && !y) return;
  nudgeOverlay(x, y);
}
function cycleOverlaySnapPreset() {
  overlaySnapIndex = (overlaySnapIndex % 5) + 1;
  snapOverlay(overlaySnapIndex);
}
function scrollOverlayPage(direction) {
  if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return;
  const sign = direction === 'up' ? -1 : 1;
  // The overlay content scrolls inside .scroll-container; nudge it by ~55% of the viewport per repeat.
  overlayWindow.webContents
    .executeJavaScript(
      `(() => { const el = document.querySelector('.scroll-container') || document.scrollingElement || document.body;` +
        ` if (el) el.scrollBy({ top: ${sign} * Math.round(window.innerHeight * 0.55), behavior: 'smooth' }); })();`,
      true
    )
    .catch(() => {});
}
function setOverlayControlMode(active) {
  // No overlayVisible check here on purpose: hideOverlayWindow() calls this to reset click-through
  // state during the hide transition itself, after overlayVisible has already been set false but
  // while the window is still valid — an overlayVisible guard would silently skip that reset.
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  // In control mode the overlay must receive stick/dpad-driven moves, so force it interactive
  // (not click-through). Leaving control mode restores the last click-through state.
  if (active) {
    overlayWindow.setIgnoreMouseEvents(false);
  } else {
    overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
  }
}
function handleOverlayControl(action, payload = {}) {
  switch (String(action || '')) {
    case 'move-relative':
      moveOverlayRelative(payload.dx, payload.dy);
      return;
    case 'scroll-page':
      scrollOverlayPage(payload.direction);
      return;
    case 'nudge': {
      const step = 20;
      const map = { up: [0, -step], down: [0, step], left: [-step, 0], right: [step, 0] };
      const d = map[payload.direction];
      if (d) nudgeOverlay(d[0], d[1]);
      return;
    }
    case 'snap-cycle':
      cycleOverlaySnapPreset();
      return;
    case 'control-mode':
      setOverlayControlMode(payload.active === true);
      return;
    case 'ui-mode-toggle':
      if (overlayVisible) {
        overlayWindow.webContents.send('overlay-controller-mode', { mode: 'ui' });
      }
      return;
    default:
      return;
  }
}
const OVERLAY_SHORTCUT_KEYS = ['Up', 'Down', 'Left', 'Right', '1', '2', '3', '4', '5', 'C'];
function registerOverlayShortcuts() {
  const reg = (accel, fn) => {
    try {
      globalShortcut.register(accel, fn);
    } catch (e) {
      debug.log('[overlay-shortcut] register failed ' + accel + ': ' + (e.message || e));
    }
  };
  reg('CommandOrControl+Alt+Shift+Up', () => nudgeOverlay(0, -20));
  reg('CommandOrControl+Alt+Shift+Down', () => nudgeOverlay(0, 20));
  reg('CommandOrControl+Alt+Shift+Left', () => nudgeOverlay(-20, 0));
  reg('CommandOrControl+Alt+Shift+Right', () => nudgeOverlay(20, 0));
  reg('CommandOrControl+Alt+Shift+1', () => snapOverlay(1));
  reg('CommandOrControl+Alt+Shift+2', () => snapOverlay(2));
  reg('CommandOrControl+Alt+Shift+3', () => snapOverlay(3));
  reg('CommandOrControl+Alt+Shift+4', () => snapOverlay(4));
  reg('CommandOrControl+Alt+Shift+5', () => snapOverlay(5));
  reg('CommandOrControl+Alt+Shift+C', () => toggleOverlayClickThrough());
}
function unregisterOverlayShortcuts() {
  for (const k of OVERLAY_SHORTCUT_KEYS) {
    try {
      globalShortcut.unregister('CommandOrControl+Alt+Shift+' + k);
    } catch {}
  }
}

// When the overlay hotkey is pressed with no game running, the Watchdog sends
// appid=0 + description=open. Resolve the game currently open in the app window
// (or the first library tile) so the overlay still has something to show.
async function resolveOverlayFallbackAppid() {
  if (!MainWin || MainWin.isDestroyed() || MainWin.webContents.isDestroyed()) return null;
  try {
    const id = await MainWin.webContents.executeJavaScript(
      `(() => {
        const open = document.querySelector('#achievement .wrapper > .header');
        const first = document.querySelector('#game-list .game-box[data-appid]');
        return (open && open.dataset.appid) || (first && first.dataset.appid) || '';
      })()`
    );
    return String(id || '').trim() || null;
  } catch (err) {
    debug.log(`[overlay] fallback appid lookup failed: ${err.message || err}`);
    return null;
  }
}

// The overlay is kept alive (hidden) between opens so toggling it is nearly instant.
// "Closing" therefore means hiding; the BrowserWindow itself is only destroyed on app quit,
// a crash, or an explicit recreate (e.g. the overlay HTML changed in dev).
function hideOverlayWindow(reason = 'close') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const wasVisible = overlayVisible;
  overlayVisible = false;
  overlayAppid = null;
  overlayClickThrough = false;
  unregisterOverlayShortcuts();
  setOverlayControlMode(false);
  try {
    overlayWindow.webContents.send('overlay-visibility', false);
  } catch {}
  try {
    // Drop the loaded achievement DOM while hidden so the reused window stays light.
    overlayWindow.webContents.send('show-overlay', null);
  } catch {}
  try {
    overlayWindow.hide();
  } catch {}
  if (overlayWarmupTimer) clearTimeout(overlayWarmupTimer);
  overlayWarmupTimer = setTimeout(() => {
    overlayWarmupTimer = null;
    if (!overlayVisible && overlayWindow && !overlayWindow.isDestroyed()) {
      debug.log('[overlay] warm window released after idle');
      overlayWindow.destroy();
    }
  }, OVERLAY_WARMUP_KEEP_MS);
  if (typeof overlayWarmupTimer.unref === 'function') overlayWarmupTimer.unref();
  if (wasVisible) notifyMonitorOverlayState(false);
  debug.log(`[overlay] hidden (${reason})`);
}

function sendOverlayPayloads(info) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayVisible) return;
  overlayWindow.webContents.send('overlay-language', overlayLanguagePayload());
  overlayWindow.webContents.send('overlay-theme', currentThemePayload());
  overlayWindow.webContents.send('overlay-controller-config', overlayControllerConfigPayload());
  overlayWindow.webContents.send('show-overlay', info.game);
}

function showOverlayAfterLoad(info) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayVisible) return;
  if (overlayWarmupTimer) {
    clearTimeout(overlayWarmupTimer);
    overlayWarmupTimer = null;
  }
  sendOverlayPayloads(info);
  try {
    overlayWindow.webContents.send('overlay-visibility', true);
  } catch {}
  if ((configJS && configJS.controller && configJS.controller.focusOverlay) === true) {
    overlayWindow.show();
    overlayWindow.focus();
  } else {
    overlayWindow.showInactive();
  }
  registerOverlayShortcuts();
  notifyMonitorOverlayState(true);
}

/**
 * @param {{appid: string, action:string}} info
 */
async function createOverlayWindow(info) {
  try {
    if (!info.action) info.action = 'open';
    const isOpen = overlayVisible;
    const request = resolveOverlayRequest({ action: info.action, appid: info.appid, isOpen, openAppid: overlayAppid });

    if (request.action === 'ignore') return;
    if (request.action === 'close') {
      hideOverlayWindow('close');
      return;
    }
    if (request.action === 'refresh') {
      if (!overlayVisible) return;
      overlayWindow.webContents.send('refresh-achievements-table', String(info.appid));
      return;
    }
    if (request.action === 'reopen') {
      // The active game changed while the overlay was open: hide the old contents, then fall
      // through and swap in the new game's achievements without recreating the window.
      hideOverlayWindow('reopen');
    }
    if (request.action === 'fallback') {
      const fallback = await resolveOverlayFallbackAppid();
      if (!fallback) return;
      info.appid = fallback;
    }
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

    // Avoid re-reading options.ini + re-initializing the achievements parser on every toggle.
    // Settings saves already call startEngines(), so a loaded configJS is fresh enough here.
    if (!configJS || !achievementsJS) await startEngines();
    await getCachedData(info);
    info.game = await achievementsJS.getSavedAchievementsForAppid(configJS, { appid: info.appid });
    attachOverlayRarity(info.game);

    // Fast path: the window already exists (hidden) from a previous open. Swap the data and show.
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayVisible = true;
      overlayAppid = String(info.appid);
      overlayClickThrough = false;
      const savedInGame = readOverlayBounds().inGame;
      if (savedInGame && Number.isFinite(savedInGame.x) && Number.isFinite(savedInGame.y)) {
        overlayWindow.setBounds({
          x: savedInGame.x,
          y: savedInGame.y,
          width: savedInGame.width || 450,
          height: savedInGame.height || 800,
        });
      }
      showOverlayAfterLoad(info);
      return;
    }

    overlayAppid = String(info.appid);
    overlayWindow = new BrowserWindow({
      title: t('achievements-overlay-title', 'Achievements Overlay', 'Overlay de succès'),
      width: 450,
      height: 800,
      x: width - 470,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      minWidth: 260,
      minHeight: 200,
      focusable: true,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../overlayPreload.js'),
        additionalArguments: [`--isDev=${app.isDev ? 'true' : 'false'}`, `--userDataPath=${userData}`],
        contextIsolation: true,
        nodeIntegration: false,
        devTools: manifest.config.debug || false,
        backgroundThrottling: false,
      },
    });

    if (manifest.config.debug) {
      if (openDevTools) overlayWindow.webContents.openDevTools({ mode: 'undocked' });
      overlayWindow.isDev = true;
      console.info((({ node, electron, chrome }) => ({ node, electron, chrome }))(process.versions));
      // electron-context-menu is ESM-only in v4+ — must use dynamic import (same as the MainWin path;
      // the old require() always threw here and popped a warning dialog on every debug overlay open).
      import('electron-context-menu').then((mod) => {
        const contextMenuFn = mod.default || mod;
        if (typeof contextMenuFn === 'function') {
          contextMenuFn({
            append: (defaultActions, params, browserWindow) => [
              { role: 'reload', visible: Boolean(params) },
            ],
          });
        }
      }).catch((err) => {
        console.warn('electron-context-menu init failed:', err.message);
      });
    }

    //User agent
    overlayWindow.webContents.userAgent = manifest.config['user-agent'];
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = manifest.config['user-agent'];
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.setFullScreenable(false);
    overlayWindow.setFocusable(true);
    overlayWindow.blur();

    // Restore the user's last overlay position/size (from drag, nudge or snap), if any.
    const savedInGame = readOverlayBounds().inGame;
    if (savedInGame && Number.isFinite(savedInGame.x) && Number.isFinite(savedInGame.y)) {
      overlayWindow.setBounds({
        x: savedInGame.x,
        y: savedInGame.y,
        width: savedInGame.width || 450,
        height: savedInGame.height || 800,
      });
    }
    overlayClickThrough = false; // each open starts interactive (drag/scroll), not click-through

    // Load the bundled overlay (same policy as the main window): a userData copy can be stale and
    // would drift from the app's own view/overlay.html + util/overlayUi.js.
    overlayVisible = true;
    overlayWindow.loadFile(path.join(__dirname, '../view/overlay.html'));
    overlayWindow.webContents.on('did-finish-load', () => {
      showOverlayAfterLoad(info);
    });

    // Persist position/size after a drag (app-region move fires 'moved') or an edge/corner resize.
    overlayWindow.on('moved', persistInGameBounds);
    overlayWindow.on('resize', persistInGameBounds);

    overlayWindow.on('closed', () => {
      overlayWindow = null;
      overlayVisible = false;
      if (overlayWarmupTimer) {
        clearTimeout(overlayWarmupTimer);
        overlayWarmupTimer = null;
      }
      overlayAppid = null;
      overlayClickThrough = false;
      unregisterOverlayShortcuts();
      // Only a real destroy lands here now (app quit / crash / dev reload); normal toggles hide.
      notifyMonitorOverlayState(false);
    });

  } catch (e) {
    debug.log(`Error creating overlay window, ${e}`);
    if (shouldQuitApp()) app.quit();
  }
}

function shouldQuitApp() {
  // Resident tray daemon: the app stays alive in the system tray with no window. Closing the main
  // window (or finishing notifications/overlay) must NEVER quit the process — the monitor keeps
  // running in the background. The app quits only via the tray "Quit" item (which sets app.isQuiting
  // and calls app.quit() directly). All the historical `if (shouldQuitApp()) app.quit()` call sites
  // therefore become no-ops.
  return false;
}

function parseArgs(args) {
  args = normalizeWindowArgs(args);
  let windowType = args['wintype'] || 'main'; // overlay (in-game) or main; notifications are Windows system notifications
  let appid = args['appid']; // appid
  let source = args['source'] || 'steam'; // source: steam, epic, gog, luma
  let description = args['description']; // text
  // What was ASKED for, not what will happen: an overlay request carries an action (open/close/
  // refresh) and createOverlayWindow may well decide to do nothing with it. Logging "opening
  // overlay window" for an incoming close — which is what this said before — made issue #19 look
  // like it was still happening in the logs long after it was fixed.
  debug.log(`${windowType} window request` + (description ? ` (${description})` : ''));
  switch (windowType) {
    case 'overlay':
      createOverlayWindow({ appid, source, action: description });
      break;
    case 'notification':
      // Styled overlay notification. The monitor forwards these args over IPC (handleMonitorMessage)
      // and they are rendered as a BrowserWindow inside this resident daemon — no transient process,
      // no single-instance forwarding, so no self-quit safety net is needed any more.
      enqueueNotificationFromArgs(args);
      break;
    case 'main':
    default:
      // Resident tray daemon: open the UI window on demand. A login-item / `--hidden` start stays in
      // the tray with no window; a normal launch, a tray "Open", or a second-instance opens it.
      // Startup-only init (resources, tray, monitor, icon-cache prune) runs once in the 'ready'
      // handler, not here, so reopening the window never repeats it.
      if (!args.hidden) createMainWindow();
      break;
  }
}

// A toast click activates the app through the registered URI scheme, so the game arrives as a raw
// argv entry ("achievement-watcher://game/480/ACH_WIN") rather than as flags. The identifiers are
// path segments because the URI is embedded verbatim in the toast XML, where a query string's "&"
// would make the notification malformed (see buildActivation in watchdog/notification/transport).
function parseToastActivation(argv) {
  for (const raw of Array.isArray(argv) ? argv : []) {
    const value = String(raw || '');
    if (!value.toLowerCase().startsWith(`${TOAST_PROTOCOL}://game/`)) continue;
    try {
      const url = new URL(value);
      const [appid, achievement] = url.pathname.replace(/^\/+/, '').split('/').map((s) => decodeURIComponent(s || ''));
      if (appid) return { appid, achievement: achievement || '' };
    } catch {
      /* malformed URI — ignore it rather than crash the launch path */
    }
  }
  return null;
}

// Whether the app was already running (second-instance) or cold-started from the notification, wait
// for the main window and ask the renderer to open the game page.
function openGameFromLaunchArgs(args) {
  if (!args || !args.appid) return;
  const tryOpen = (attempt = 0) => {
    if (MainWin && !MainWin.isDestroyed()) {
      const openGame = () => {
        MainWin.webContents.send('open-game', { appid: String(args.appid), achievement: String(args.achievement || '') });
      };
      if (MainWin.webContents.isLoading()) MainWin.webContents.once('did-finish-load', openGame);
      else setTimeout(openGame, 300);
      return;
    }
    if (attempt < 20) setTimeout(() => tryOpen(attempt + 1), 250); // window is still being created
  };
  tryOpen();
}

// --- Overlay notification (optional transport) -----------------------------------
// Spawns a frameless click-through window rendering a preset via window.api; toasts remain the
// default transport. Resolves presets from the bundled library, falling back to "Shirow".
function resolvePresetFolder(presetName) {
  const requestedRaw = String(presetName || 'Shirow');
  const requested = requestedRaw === 'Raposo' ? 'Shirow' : requestedRaw;
  // Generated presets (<userData>) first, then the bundled libraries, then the flat legacy folder.
  const roots = [usersPresetsDir(), ...bundledPresetRoots(), path.join(__dirname, '../presets')];
  for (const root of roots) {
    const f = path.join(root, requested);
    if (fs.existsSync(path.join(f, 'index.html'))) return f;
  }
  for (const root of roots) {
    const f = path.join(root, 'Default');
    if (fs.existsSync(path.join(f, 'index.html'))) return f;
  }
  return null;
}

// Read the preset's window size from its <meta width="" height=""> tag (reference convention).
function getPresetDimensions(presetFolder) {
  try {
    const content = fs.readFileSync(path.join(presetFolder, 'index.html'), 'utf8');
    const m = content.match(/<meta\s+width\s*=\s*"(\d+)"\s+height\s*=\s*"(\d+)"\s*\/?>/i);
    if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  } catch (err) {
    debug.log('[overlay-notif] preset dimensions read failed: ' + (err.message || err));
  }
  return { width: 400, height: 200 };
}

function notificationPlacementArea(customAnchor = null) {
  const electronScreen = require('electron').screen;
  try {
    // A custom popup belongs to the display where the user placed it, regardless of where the
    // cursor happens to be when a later achievement unlocks. Using the cursor here used to pull a
    // saved popup onto another monitor before placeNotification() clamped it.
    if (customAnchor && Number.isFinite(Number(customAnchor.x)) && Number.isFinite(Number(customAnchor.y))) {
      const savedDisplay = electronScreen.getDisplayNearestPoint({
        x: Math.round(Number(customAnchor.x)),
        y: Math.round(Number(customAnchor.y)),
      });
      // Custom placement is allowed across the taskbar, matching the draggable witness. Electron
      // reports these bounds in DIP, so this also stays exact on scaled/HiDPI displays.
      if (savedDisplay && savedDisplay.bounds) return savedDisplay.bounds;
    }
    // The cursor is normally over the game that triggered the unlock, so this keeps the popup on
    // that monitor instead of unexpectedly putting it on the primary display.
    const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
    if (display && display.workArea) return display.workArea;
  } catch {}
  const primary = electronScreen.getPrimaryDisplay();
  return customAnchor && primary.bounds ? primary.bounds : primary.workArea;
}

// Place the window inside the target display's usable area. The shared helper clamps both edges,
// including a manually repositioned popup, instead of only protecting the left/top edges.
function computeNotificationBounds(position, width, height, workArea, customAnchor = null) {
  return notificationBounds.placeNotification({
    position,
    width,
    height,
    workArea: workArea || notificationPlacementArea(),
    custom: position === 'custom' ? customAnchor || readOverlayBounds().notif : null,
    // A manually placed popup may intentionally overlap the taskbar or sit flush to a screen edge.
    margin: position === 'custom' ? 0 : undefined,
  });
}

// Localized strings used by the notification preset windows (fallback titles/descriptions).
// Reads the active locale JSON directly (the renderer loader is not available in the main
// process); every bundled locale contains the same `watchdog` keys, so a missing per-language
// file degrades to English exactly like the rest of the app.
function loadNotificationStrings() {
  try {
    const lang = String((configJS && configJS.achievement && configJS.achievement.lang) || 'english');
    const langDir = path.join(__dirname, '../locale/lang');
    let data = JSON.parse(fs.readFileSync(path.join(langDir, 'english.json'), 'utf8'));
    if (lang !== 'english') {
      try {
        data = JSON.parse(fs.readFileSync(path.join(langDir, `${lang}.json`), 'utf8'));
      } catch (err) {
        debug.log(`[overlay-notif] locale load failed (${lang}), using English: ${err.message || err}`);
      }
    }
    return (data && data.watchdog) || {};
  } catch (err) {
    debug.log(`[overlay-notif] notification strings unavailable: ${err.message || err}`);
    return {};
  }
}

function createNotificationWindow(data = {}) {
  const presetFolder = resolvePresetFolder(data.preset);
  if (!presetFolder) {
    debug.log('[overlay-notif] no usable preset found under app/presets');
    return null;
  }
  const presetHtml = path.join(presetFolder, 'index.html');

  const scaleRaw = Number(data.scale);
  const requestedScale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const { width: baseW, height: baseH } = getPresetDimensions(presetFolder);
  const position = data.position || 'center-bottom';
  const customAnchor = position === 'custom' ? readOverlayBounds().notif : null;
  const workArea = notificationPlacementArea(customAnchor);
  // Scale the host window in both directions, then cap the effective scale to the current work
  // area. This keeps small themes tightly anchored and large themes visible instead of clipping.
  const geometry = notificationBounds.fitNotificationScale({
    baseWidth: baseW,
    baseHeight: baseH,
    scale: requestedScale,
    workArea,
    margin: position === 'custom' ? 0 : undefined,
  });
  const { x, y, width: w, height: h } = computeNotificationBounds(
    position,
    geometry.width,
    geometry.height,
    workArea,
    customAnchor
  );
  const scale = geometry.scale;

  debug.log('[overlay-notif] preset=' + path.basename(presetFolder) + ' pos=' + position + ' scale=' + requestedScale + '→' + scale + ' size=' + w + 'x' + h);

  const notif = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../notificationPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  notif.setAlwaysOnTop(true, 'screen-saver');
  notif.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const lockedCustomBounds = position === 'custom' && !data.reposition ? { x, y, width: w, height: h } : null;
  if (lockedCustomBounds) {
    // A real custom-position notification is click-through and must never be nudged by a preset,
    // focus/workspace transition or accidental native move. Reassert its exact saved bounds both
    // before display and whenever Windows proposes a move.
    notif.on('will-move', (event) => {
      event.preventDefault();
      if (!notif.isDestroyed()) notif.setBounds(lockedCustomBounds, false);
    });
    notif.on('show', () => {
      if (!notif.isDestroyed()) notif.setBounds(lockedCustomBounds, false);
    });
    notif.on('move', () => {
      if (notif.isDestroyed()) return;
      const current = notif.getBounds();
      if (current.x !== lockedCustomBounds.x || current.y !== lockedCustomBounds.y) {
        notif.setBounds(lockedCustomBounds, false);
      }
    });
  }
  // Real notifications are click-through; the reposition witness stays interactive so it can be dragged.
  if (!data.reposition) notif.setIgnoreMouseEvents(true, { forward: true });
  notif.loadFile(presetHtml);

  // Localized fallback labels for presets that render a placeholder when the payload has no
  // display name/description (e.g. the defensive `'Achievement Unlocked'` text in the themes).
  const notifStrings = loadNotificationStrings();

  // Match the proven overlayWindow pattern: show inactively once content is loaded
  // (no reliance on 'ready-to-show', which the working in-game overlay also avoids).
  notif.webContents.on('did-finish-load', () => {
    if (notif.isDestroyed()) return;
    notif.webContents.send('show-notification', {
      displayName: data.displayName != null ? data.displayName : notifStrings.achievementUnlocked || 'Achievement Unlocked',
      description: data.description != null ? data.description : '',
      rarityPercent: data.rarityPercent,
      notificationType: data.notificationType || '',
      // Reference-project presets key on these: `isPlatinum` (Xbox Series Platinum diamond) and
      // `headerPath` (Game Cover background). Keep them as aliases of our own fields.
      isPlatinum: String(data.notificationType || '').toLowerCase() === 'platinum',
      iconPath: data.iconPath || data.icon || '',
      gameIconPath: data.gameIconPath || data.gameIcon || '',
      imagePath: data.imagePath || data.image || '',
      headerPath: data.imagePath || data.image || '',
      progress: data.progress || null,
      progressCurrent: data.progress && data.progress.current,
      progressMax: data.progress && data.progress.max,
      progressPercent: data.progress && data.progress.percent,
      position: data.position,
      scale,
      // Forwarded so presets that support it can match their animation to the user's duration.
      durationMs: Number.isFinite(Number(data.durationMs)) ? Number(data.durationMs) : undefined,
      fallback: {
        achievementUnlocked: notifStrings.achievementUnlocked || 'Achievement Unlocked',
        achievement: notifStrings.achievement || 'Achievement',
        unknownOperation: notifStrings.unknownOperation || 'Unknown operation',
        unknownReward: notifStrings.unknownReward || 'Unknown reward',
      },
    });
    notif.showInactive();
    // Optional notification sound — played inside the (renderer) notification window. Volume is a
    // 0–200 percent setting: use a WebAudio gain node for >100% (Audio.volume caps at 1.0), and fall
    // back to Audio.volume (clamped) if WebAudio is unavailable.
    if (data.soundPath) {
      // In packaged builds the sound lives under app.asar.unpacked (see electron-builder asarUnpack).
      const u = String(data.soundPath).replace(/\\/g, '/').replace('app.asar/', 'app.asar.unpacked/');
      const src = u.startsWith('file://') ? u : 'file:///' + u;
      const gain = Math.max(0, Math.min(2, (Number(data.volume) != null && Number.isFinite(Number(data.volume)) ? Number(data.volume) : 100) / 100));
      notif.webContents
        .executeJavaScript(
          '(function(){try{var a=new Audio(' + JSON.stringify(src) + ');var g=' + gain + ';' +
          'try{var C=window.AudioContext||window.webkitAudioContext;if(C&&g!==1){var ctx=new C();var s=ctx.createMediaElementSource(a);var n=ctx.createGain();n.gain.value=g;s.connect(n);n.connect(ctx.destination);}else{a.volume=Math.min(1,g);}}catch(e){a.volume=Math.min(1,g);}' +
          'a.play().catch(function(){});}catch(e){}})();'
        )
        .catch(() => {});
    }
    // Reposition mode: overlay a full-window drag region so the user can place the popup, and persist
    // the chosen top-left as the 'custom' anchor. executeJavaScript is privileged (bypasses preset CSP).
    if (data.reposition) {
      notif.webContents
        .executeJavaScript(
          "(function(){var d=document.createElement('div');d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;-webkit-app-region:drag;cursor:move;z-index:2147483647';document.documentElement.appendChild(d);})();"
        )
        .catch(() => {});
    }
    // Custom duration: hold the notification on screen by FREEZING all animations after ~3s for the
    // chosen time, then resume. Preset-agnostic — it pauses existing AND newly-started animations during
    // the hold (an interval catches the exit animation), and the close is deferred (see ipc.js, via
    // awFrozenUntil) so a preset's own self-close can't cut the hold short. 'auto' = no freeze.
    const holdMs = Number.isFinite(Number(data.durationMs)) && Number(data.durationMs) > 0 ? Number(data.durationMs) : 0;
    if (holdMs > 0 && !data.reposition) {
      const FREEZE_AFTER = 3000;
      notif.awFrozenUntil = Date.now() + FREEZE_AFTER + holdMs + 1200; // +tail so the exit can finish
      notif.webContents
        .executeJavaScript(
          '(function(){var F=' + FREEZE_AFTER + ',H=' + holdMs + ';' +
          'function all(){try{return document.getAnimations?document.getAnimations():[];}catch(e){return [];}}' +
          'setTimeout(function(){' +
          'all().forEach(function(a){try{a.pause();}catch(e){}});' +
          'var iv=setInterval(function(){all().forEach(function(a){try{a.pause();}catch(e){}});},100);' +
          'setTimeout(function(){clearInterval(iv);all().forEach(function(a){try{a.play();}catch(e){}});},H);' +
          '},F);})();'
        )
        .catch(() => {});
    }
  });

  if (data.reposition) {
    let persistPositionTimer = null;
    const persistNotificationPosition = () => {
      if (notif.isDestroyed()) return;
      const bounds = notif.getBounds();
      writeOverlayBounds({ notif: { x: bounds.x, y: bounds.y } });
    };
    // `move` is the cross-platform BrowserWindow event and fires on Windows while dragging.
    // `moved` is macOS-specific, so listening only to it silently lost the chosen position here.
    notif.on('move', () => {
      clearTimeout(persistPositionTimer);
      persistPositionTimer = setTimeout(persistNotificationPosition, 80);
    });
    notif.on('close', () => {
      clearTimeout(persistPositionTimer);
      persistNotificationPosition();
    });
  }

  // Safety net: the preset normally closes itself via window.api.closeNotificationWindow(). With a
  // custom duration the freeze-hold above plays ~3s, freezes for that time, then exits, so the catch-all
  // must outlast 3s + hold + exit (never cut it short — the close defer in ipc.js targets ~3s+hold+1.2s).
  // 'auto' keeps the 20s catch-all; the reposition witness stays up much longer so there's time to place it.
  const customMs = Number(data.durationMs);
  const closeAfter = data.reposition ? 120000 : Number.isFinite(customMs) && customMs > 0 ? 3000 + customMs + 4000 : 20000;
  const safety = setTimeout(() => {
    if (!notif.isDestroyed()) notif.close();
  }, closeAfter);
  notif.on('closed', () => clearTimeout(safety));

  return notif;
}

// Serial queue: one overlay notification on screen at a time. The next opens once the current
// window closes (each preset closes itself via window.api.closeNotificationWindow()).
let notifQueue = [];
let notifActive = false;
let notifActiveWindow = null;

// Guard against the same overlay notification rendering twice in quick succession. This matters when
// the main app is open: the persistent process receives every Watchdog-forwarded notification, so a
// duplicate spawn (e.g. two rapid playtime/unlock events, or a forwarding race) would stack two
// identical overlays. Keyed by content within a short window. Transient app-closed processes each
// handle a single notification, so their map is always empty and never falsely suppresses.
const recentNotifKeys = new Map();
function isDuplicateNotification(data) {
  try {
    const progress = data.progress ? `${data.progress.current || 0}/${data.progress.max || 0}` : '';
    const key = [data.displayName || '', data.description || '', data.iconPath || data.icon || '', progress].join('');
    const now = Date.now();
    for (const [k, t] of recentNotifKeys) if (now - t > 5000) recentNotifKeys.delete(k);
    const last = recentNotifKeys.get(key);
    recentNotifKeys.set(key, now);
    return last != null && now - last < 5000;
  } catch {
    return false;
  }
}

function enqueueNotification(data) {
  data = data || {};
  if (data.test !== true && MainWin && isDuplicateNotification(data)) {
    debug.log('[overlay-notif] duplicate suppressed (app open): ' + (data.displayName || ''));
    return;
  }
  // A Settings test replaces whatever is on screen right away instead of queuing
  // behind it, so preset previews can be chained as fast as the tester clicks.
  if (data.test === true && notifActiveWindow && !notifActiveWindow.isDestroyed()) {
    notifActiveWindow.close();
  }
  notifQueue.push(data);
  processNotificationQueue();
}
function processNotificationQueue() {
  if (notifActive) return;
  const data = notifQueue.shift();
  if (!data) return;
  notifActive = true;
  let win = null;
  try {
    win = createNotificationWindow(data);
  } catch (err) {
    debug.log('[overlay-notif] spawn failed: ' + (err.message || err));
  }
  if (!win) {
    notifActive = false;
    if (notifQueue.length) {
      setTimeout(processNotificationQueue, 50);
    } else if (shouldQuitApp()) {
      // Vestigial. Back when a notification could be rendered by a transient Watchdog-spawned
      // process, a failed spawn left nothing to wait on ('window-all-closed' never fires) and that
      // process had to quit rather than sit idle holding the single-instance lock. The Watchdog is
      // now a child of the resident tray daemon, so notifications always render in the daemon and
      // shouldQuitApp() is a hard false: this branch is unreachable and quits nothing.
      app.quit();
    }
    return;
  }
  notifActiveWindow = win;
  win.on('closed', () => {
    if (notifActiveWindow === win) notifActiveWindow = null;
    notifActive = false;
    setTimeout(processNotificationQueue, 150);
  });
}

ipcMain.on('spawn-overlay-notification', (event, data) => {
  enqueueNotification(data || {});
});

// Settings > Notifications "preview" button next to the hotkey field: opens the real in-game overlay
// with a real game's achievement data so the look (and the configured hotkey binding) can be checked
// without a game actually running. Toggles like the hotkey itself — a second click while it is open
// closes it rather than stacking a duplicate window.
ipcMain.on('overlay-preview', (event, appid) => {
  if (overlayVisible) {
    hideOverlayWindow('preview-toggle');
    return;
  }
  if (!appid) return;
  createOverlayWindow({ appid: String(appid), source: 'steam', action: 'open' });
});

// The overlay header's × button (and Escape, which shares this path). Closing the window is all
// that is needed: its 'closed' handler reports the new state to the monitor, whatever triggered it.
ipcMain.on('overlay-close', () => {
  hideOverlayWindow('close');
});

function normalizeNotificationProgress(args) {
  const max = Number(args.progressMax);
  if (!Number.isFinite(max) || max <= 1) return null;
  const currentRaw = Number(args.progressCurrent);
  const current = Math.max(0, Math.min(max, Number.isFinite(currentRaw) ? currentRaw : 0));
  const percentArg = Number(args.progressPercent);
  const percent = Number.isFinite(percentArg)
    ? Math.max(0, Math.min(100, Math.floor(percentArg)))
    : Math.max(0, Math.min(100, Math.floor((current / max) * 100)));
  return { current, max, percent };
}

function resolvePrimaryNotificationIcon({ notificationType, iconPath, gameIconPath, imagePath, progress }) {
  const type = String(notificationType || '').toLowerCase();
  // Playtime: prefer the Steam library art (gameIcon) over the achievement-style `icon`, which is
  // Steam's tiny img_icon_url and renders blurry/low-res next to a high-res header. Keep it as a
  // fallback for the rare appid that has no library art.
  if (type === 'playtime') return gameIconPath || iconPath || imagePath || '';
  if (progress) return iconPath || gameIconPath || imagePath || '';
  return iconPath || imagePath || gameIconPath || '';
}

// Build an overlay notification from the CLI args the Watchdog passes to a `--wintype=notification`
// process. This process never runs startEngines (that's the main-window path), so configJS is null
// here — load the user's overlay settings (preset/position/scale/sound) directly from options.ini so
// the notification respects them. The icon is passed as a URL and resolved from the on-disk cache the
// Watchdog already prefetched into; a short race guards against a slow/offline fetch hanging the
// transient process (it would otherwise never reach window-all-closed and quit).
async function enqueueNotificationFromArgs(args) {
  let cfg = configJS;
  if (!cfg) {
    try {
      // settings.load() is async and must be awaited, or the overlay preset/position/scale/sound are
      // silently ignored (falling back to 'Default', which can be unresolvable → no window).
      cfg = await require(path.join(__dirname, '../settings.js')).load();
    } catch {
      cfg = {};
    }
  }
  const ov = (cfg && cfg.overlay) || {};

  let iconPath = '';
  if (args.icon) {
    try {
      iconPath =
        (await Promise.race([fetchSteamIcon(String(args.icon), args.appid), new Promise((resolve) => setTimeout(() => resolve(''), 4000))])) || '';
    } catch {
      /* icon is optional */
    }
  }

  let gameIconPath = '';
  if (args.gameIcon) {
    try {
      gameIconPath =
        (await Promise.race([fetchSteamIcon(String(args.gameIcon), args.appid), new Promise((resolve) => setTimeout(() => resolve(''), 4000))])) ||
        '';
    } catch {
      /* game art is optional */
    }
  }

  let imagePath = '';
  if (args.image) {
    try {
      imagePath =
        (await Promise.race([fetchSteamIcon(String(args.image), args.appid), new Promise((resolve) => setTimeout(() => resolve(''), 4000))])) || '';
    } catch {
      /* header art is optional */
    }
  }

  const progress = normalizeNotificationProgress(args);
  const notificationType = String(args.notificationType || (progress ? 'progress' : '') || '').toLowerCase();
  const primaryIconPath = resolvePrimaryNotificationIcon({ notificationType, iconPath, gameIconPath, imagePath, progress });

  // Playtime (and any caller passing --silent) must never play the overlay sound.
  const silent = !!args.silent;
  // "Random sound" picks a fresh file from the merged bundled+user sound list for each popup.
  const randomSound = ov.randomSound === true;
  const chosenSound = silent
    ? ''
    : randomSound
      ? notificationSounds.pickRandomSound([path.join(__dirname, '../sounds'), userSoundsDir()]) ||
        resolveNotificationSound(ov.notificationSound)
      : resolveNotificationSound(ov.notificationSound);
  const displayName =
    (args.displayName != null && String(args.displayName).trim()) ||
    (args.gameDisplayName != null && String(args.gameDisplayName).trim()) ||
    t('achievement-unlocked', 'Achievement Unlocked', 'Succès débloqué');

  const durSec = ov.notificationDuration === 'auto' || ov.notificationDuration == null ? 0 : Number(ov.notificationDuration) || 0;
  // Per-type and per-emulator preset overrides ('' = main preset): the watchdog only forwards
  // rarityPercent for rare unlocks (≤10%), platinum popups carry notificationType 'platinum', and
  // the source lets Xenia/RPCS3/ShadPS4 notifications use their own preset.
  const preset = require(path.join(__dirname, '../util/notificationPreset.js')).resolvePreset({
    presets: {
      main: ov.notificationPreset || 'Shirow',
      rare: ov.notificationPresetRare || '',
      platinum: ov.notificationPresetPlatinum || '',
      xenia: ov.notificationPresetXenia || '',
      rpcs3: ov.notificationPresetRpcs3 || '',
      shadps4: ov.notificationPresetShadps4 || '',
    },
    source: args.source || '',
    notificationType,
    rarityPercent: Number(args.rarityPercent),
  });
  enqueueNotification({
    preset,
    position: ov.notificationPosition || 'center-bottom',
    scale: ov.notificationScale || 1,
    volume: Number.isFinite(Number(ov.notificationVolume)) ? Number(ov.notificationVolume) : 100,
    durationMs: durSec > 0 ? durSec * 1000 : undefined,
    // Playtime notifications pass the game name in both fields. Keeping the dedicated game-name
    // fallback prevents a lost/empty displayName argument from becoming "Achievement Unlocked".
    displayName,
    description: args.description != null ? String(args.description) : '',
    rarityPercent: Number.isFinite(Number(args.rarityPercent)) ? Number(args.rarityPercent) : null,
    notificationType,
    iconPath: primaryIconPath,
    achievementIconPath: iconPath,
    gameIconPath,
    imagePath,
    progress,
    soundPath: chosenSound,
  });
}

// Notification sounds live in two places: bundled (app/sounds) and user-imported (<userData>/sounds).
// A user file shadows a bundled file of the same name.
function userSoundsDir() {
  return path.join(userData, 'sounds');
}
function resolveNotificationSound(name) {
  if (!name) return '';
  for (const p of [path.join(userSoundsDir(), name), path.join(__dirname, '../sounds', name)]) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

// Scratch preset the builder's Preview button renders through. It is a real preset folder (so the
// preview goes through the exact same notification path as a saved one) but a reserved name, hidden
// from every list so it can never be picked, exported or left behind as a "preset" the user made.
const PREVIEW_PRESET_NAME = '__aw-preview__';

// List available preset names (Default Presets + Users Presets) for the settings dropdown.
ipcMain.handle('list-presets', async () => {
  const out = [];
  const roots = [...bundledPresetRoots(), usersPresetsDir()];
  for (const root of roots) {
    try {
      for (const name of fs.readdirSync(root)) {
        if (name === PREVIEW_PRESET_NAME) continue;
        if (fs.existsSync(path.join(root, name, 'index.html')) && !out.includes(name)) out.push(name);
      }
    } catch {}
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
});

// --- Custom preset builder (Phase 3 customiser) -----------------------------------------------------
// The generator itself lives in util/customPreset.js (pure string work, unit-tested); this file owns
// where the generated files land and which preset names are reserved.
const customPreset = require(path.join(__dirname, '../util/customPreset.js'));
const { customPresetNumbers, buildCustomPresetHtml, buildCustomPresetCss } = customPreset;

// Folder-safe, readable preset name. Returns '' for anything unusable.
function sanitizePresetName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

/*
  Where a preset the builder generates is written: <userData>, never the app folder. Once packaged,
  app/presets lives inside app.asar — a single file — so mkdir below it fails with ENOTDIR, which
  broke Preview and Save on every installed build while a dev run worked. Sounds (userSoundsDir) and
  user themes already work this way, and it also means generated presets survive an update.
  The rule itself lives in util/customPreset.js so it can be unit-tested.
*/
const usersPresetsDir = () => customPreset.generatedPresetsDir(userData);

// Read-only preset libraries shipped with the app. Generated presets are looked up first, so
// re-saving under a bundled name shadows it rather than being ignored.
const bundledPresetRoots = () => [
  path.join(__dirname, '../presets/Default Presets'),
  path.join(__dirname, '../presets/Users Presets'),
];

// The builder's own options, stored next to the generated files. Without it a generated preset is
// write-only: the CSS can be read back but the eight slider/colour values that produced it cannot,
// so tweaking a preset meant rebuilding it from memory. Purely additive — the notification engine
// never reads this file, and a preset that predates it simply cannot be re-opened.
const PRESET_OPTIONS_FILE = 'aw-preset.json';

function writeCustomPreset(name, opts) {
  const dir = path.join(usersPresetsDir(), name);
  const values = customPresetNumbers(opts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildCustomPresetHtml(opts), 'utf8');
  fs.writeFileSync(path.join(dir, 'style.css'), buildCustomPresetCss(opts), 'utf8');
  fs.writeFileSync(path.join(dir, PRESET_OPTIONS_FILE), JSON.stringify({ name, ...values }, null, 2), 'utf8');
  return dir;
}

ipcMain.handle('create-custom-preset', async (event, opts = {}) => {
  try {
    const name = sanitizePresetName(opts.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    if (name === PREVIEW_PRESET_NAME) return { ok: false, error: 'reserved-name' };
    const existed = fs.existsSync(path.join(usersPresetsDir(), name, 'index.html'));
    debug.log('[custom-preset] wrote ' + writeCustomPreset(name, opts));
    return { ok: true, name, replaced: existed };
  } catch (err) {
    debug.log('[custom-preset] failed: ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
});

// Presets this builder generated, i.e. the ones it can load back into its controls.
ipcMain.handle('list-custom-presets', async () => {
  try {
    return fs
      .readdirSync(usersPresetsDir())
      .filter((name) => name !== PREVIEW_PRESET_NAME && fs.existsSync(path.join(usersPresetsDir(), name, PRESET_OPTIONS_FILE)))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
});

// Load one generated preset's stored options back into the builder. null when the preset was not
// made here (bundled/hand-written presets have no options file) or is unreadable.
ipcMain.handle('read-custom-preset', async (event, name) => {
  const safe = sanitizePresetName(name);
  if (!safe) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(usersPresetsDir(), safe, PRESET_OPTIONS_FILE), 'utf8'));
    return { name: safe, ...customPresetNumbers(parsed) };
  } catch {
    return null;
  }
});

/*
  Delete a preset the builder made. Deliberately narrow: the folder must sit directly under
  "Users Presets" AND carry the builder's own options file, so a bundled preset (or anything a user
  hand-authored in there) can never be removed through this channel. Without it the builder could
  only ever add to the preset list — a throwaway attempt had to be deleted from Explorer.
*/
ipcMain.handle('delete-custom-preset', async (event, name) => {
  const safe = sanitizePresetName(name);
  if (!safe || safe === PREVIEW_PRESET_NAME) return { ok: false, error: 'invalid-name' };
  const dir = path.join(usersPresetsDir(), safe);
  try {
    if (path.dirname(path.resolve(dir)) !== path.resolve(usersPresetsDir())) return { ok: false, error: 'outside-users-presets' };
    if (!fs.existsSync(path.join(dir, PRESET_OPTIONS_FILE))) return { ok: false, error: 'not-generated-here' };
    fs.rmSync(dir, { recursive: true, force: true });
    debug.log('[custom-preset] deleted ' + dir);
    return { ok: true, name: safe };
  } catch (err) {
    debug.log('[custom-preset] delete failed: ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
});

// Render the design currently in the builder without saving it: write the scratch preset and hand
// its reserved name back, so the caller fires an ordinary test notification through it. Previewing
// used to require creating the preset first, which filled the preset list with throwaway attempts.
ipcMain.handle('preview-custom-preset', async (event, opts = {}) => {
  try {
    writeCustomPreset(PREVIEW_PRESET_NAME, opts);
    return { ok: true, name: PREVIEW_PRESET_NAME };
  } catch (err) {
    debug.log('[custom-preset] preview failed: ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
});

// List available notification sound files for the overlay sound dropdown (bundled + user-imported).
ipcMain.handle('list-sounds', async () => {
  const set = new Set();
  for (const { name } of notificationSounds.listSoundFiles([path.join(__dirname, '../sounds'), userSoundsDir()])) set.add(name);
  return [...set].sort((a, b) => a.localeCompare(b));
});

// User themes: *.css from <userData>\themes (Settings > General > Theme).
ipcMain.handle('list-user-themes', async () =>
  userThemes.listUserThemes(userData).map((t) => ({ name: t.name, file: t.file, css: userThemes.readThemeFile(t.file) }))
);

// Resolve the active theme into CSS for the main window and the overlay.
ipcMain.handle('get-theme-payload', (event, name) => currentThemePayload(name));

// Persist the Custom theme (per-layer colors + optional images) and return the
// fresh payload so the renderer can re-apply it live.
async function prepareThemeBlurImages(theme) {
  for (const id of themeLayers.IMAGE_LAYER_IDS) {
    const layer = theme && theme[id];
    if (!layer || !layer.effect || layer.effect.enabled !== true) continue;
    if (!layer.image || !fs.existsSync(layer.image)) {
      layer.effect.blurImage = '';
      continue;
    }
    // The blur effect follows the user's intensity slider; the colored veil renders the
    // image through a light, fixed frosted blur so tinted images look soft and premium.
    const isBlurEffect = layer.effect.type === 'blur';
    const sigma = isBlurEffect ? Math.max(0.3, Math.min(12, layer.effect.blur / 5)) : 1.2;
    try {
      const sharp = require('sharp');
      const dir = themeLayers.themeImagesDir(userData);
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(layer.image).toLowerCase() || '.png';
      const stem = path.basename(layer.image, ext).replace(/[^a-z0-9-_]/gi, '_').slice(0, 40) || 'image';
      // Distinct suffix per effect so a blur copy and a veil copy never overwrite each other.
      const suffix = isBlurEffect ? `blur-${layer.effect.blur}` : `veilblur-${sigma}`;
      const dest = path.join(dir, `${id}-${stem}-${suffix}.png`);
      await sharp(layer.image)
        .resize({ width: 2560, withoutEnlargement: true })
        .blur(sigma)
        .png()
        .toFile(dest);
      layer.effect.blurImage = dest;
    } catch (err) {
      debug.log(`[theme-image] blur failed for ${id}: ${err.message || err}`);
      layer.effect.blurImage = '';
    }
  }
  return theme;
}

ipcMain.handle('save-custom-theme', async (event, theme) => {
  const clean = themeLayers.saveCustomTheme(userData, theme);
  await prepareThemeBlurImages(clean);
  themeLayers.saveCustomTheme(userData, clean); // persist generated blur paths
  return themeLayers.themePayload(userData, 'custom', clean, '');
});

// Pick a background image for one Custom-theme layer: copy the file into
// <userData>/theme-images (stable location, survives source-file moves) and
// return the stored absolute path. Returns null when the user cancels.
ipcMain.handle('pick-theme-image', async (event, layer) => {
  try {
    const allowed = themeLayers.IMAGE_LAYER_IDS.includes(layer) ? layer : null;
    if (!allowed) return { ok: false, error: 'invalid-layer' };
    const res = await dialog.showOpenDialog({
      title: t('choose-theme-image', 'Choose a background image', 'Choisir une image de fond'),
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
      ],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok: false, canceled: true };
    const src = res.filePaths[0];
    const dir = themeLayers.themeImagesDir(userData);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(src).toLowerCase() || '.png';
    const stem = path.basename(src, ext).replace(/[^a-z0-9-_]/gi, '_').slice(0, 48) || 'image';
    let dest = path.join(dir, `${layer}-${stem}${ext}`);
    let i = 1;
    while (fs.existsSync(dest)) {
      dest = path.join(dir, `${layer}-${stem} (${i++})${ext}`);
    }
    fs.copyFileSync(src, dest);
    debug.log(`[theme-image] ${layer} <- ${dest}`);
    return { ok: true, layer, file: dest };
  } catch (err) {
    debug.log(`[theme-image] failed: ${err.message || err}`);
    return { ok: false, error: String(err.message || err) };
  }
});

// Forward a theme change (Settings > General, or the Custom theme editor) to an
// already-open in-game overlay so it recolors without reopening.
ipcMain.on('theme-changed', (event, name) => {
  if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents.isDestroyed()) return;
  try {
    overlayWindow.webContents.send('overlay-theme', currentThemePayload(name));
  } catch (err) {
    debug.log(`[overlay-theme] broadcast failed: ${err.message || err}`);
  }
});

// Import a custom notification sound: copy a user-picked audio file into <userData>/sounds and return
// its (possibly de-duplicated) filename so the renderer can select it. Returns null on cancel/failure.
ipcMain.handle('import-sound', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: t('choose-a-notification-sound', 'Choose a notification sound', 'Choisir un son de notification'),
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'] }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
    const src = res.filePaths[0];
    const dir = userSoundsDir();
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(src);
    const stem = path.basename(src, ext);
    let base = stem + ext;
    let dest = path.join(dir, base);
    // Don't clobber a different existing file of the same name — suffix " (n)".
    let i = 1;
    while (fs.existsSync(dest)) {
      try {
        if (fs.realpathSync(dest) === fs.realpathSync(src)) return base; // same file already imported
      } catch {}
      base = `${stem} (${i++})${ext}`;
      dest = path.join(dir, base);
    }
    fs.copyFileSync(src, dest);
    return base;
  } catch (err) {
    debug.log('[import-sound] ' + (err.message || err));
    return null;
  }
});

// NOTE: overlay notifications are no longer rendered from an app-side WebSocket bridge. The Watchdog
// now spawns a `--wintype=notification` process for each overlay notification (see watchdog
// notification/toaster.js), so they appear with the main app closed; when the app is open the
// single-instance lock forwards the args to it via 'second-instance'. This avoids the duplicate that
// a still-listening bridge would cause and removes the "app must be open" requirement.

function checkResources() {
  function copyFolderRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
      const srcPath = path.join(src, e.name);
      const dstPath = path.join(dst, e.name);
      if (e.isDirectory()) {
        copyFolderRecursive(srcPath, dstPath);
      } else {
        let shouldCopy = false;
        if (!fs.existsSync(dstPath)) shouldCopy = true;
        else {
          try {
            fs.accessSync(dstPath, fs.constants.W_OK);
            const srcStat = fs.statSync(srcPath);
            const dstStat = fs.statSync(dstPath);
            if (srcStat.size !== dstStat.size || srcStat.mtimeMs > dstStat.mtimeMs) shouldCopy = true;
          } catch {}
        }
        if (shouldCopy) fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  const resourcesPath = path.join(manifest.config.debug ? path.join(__dirname, '..') : path.join(process.resourcesPath, 'userdata'));

  const media = path.join(resourcesPath, 'Media');
  copyFolderRecursive(media, path.join(userData, 'Media'));

  const view = path.join(resourcesPath, 'view');
  copyFolderRecursive(view, path.join(userData, 'view'));

  const source = path.join(resourcesPath, 'Source');
  copyFolderRecursive(source, path.join(userData, 'Source'));

  // Startup registration is user-controlled from Settings > General.
}

// System tray — the app lives here. Single left-click / "Open" shows the UI window; "Quit" is the only
// way to actually exit (it sets app.isQuiting so before-quit tears down the monitor).
let tray = null;
function createTray() {
  if (tray) return tray;
  try {
    const iconPath = path.join(__dirname, '../resources/icon/icon.ico');
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? iconPath : image);
    tray.setToolTip('Achievement Watcher');
    const rebuildMenu = () => {
      const contextMenu = Menu.buildFromTemplate([
        { label: t('open-achievement-watcher', 'Open Achievement Watcher', 'Ouvrir Achievement Watcher'), click: () => createMainWindow() },
        {
          label: t('restart-background-monitor', 'Restart background monitor', 'Redémarrer le moniteur en arrière-plan'),
          click: () => restartWatchdog(),
        },
        { type: 'separator' },
        {
          label: t('quit', 'Quit', 'Quitter'),
          click: () => {
            app.isQuiting = true;
            app.quit();
          },
        },
      ]);
      tray.setContextMenu(contextMenu);
    };
    rebuildMenu();
    tray.on('click', () => createMainWindow());
    tray.on('double-click', () => createMainWindow());
    debug.log('[tray] created');
  } catch (err) {
    debug.log(`[tray] failed to create: ${err.message || err}`);
  }
  return tray;
}

try {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
  autoUpdater.on('checking-for-update', () => debug.log('[updater] checking for updates'));
  autoUpdater.on('update-available', async (info) => {
    debug.log(`[updater] update available: ${info.version}`);
    manualUpdateResult = 'available';
    const manual = manualUpdateCheckPending;
    manualUpdateCheckPending = false; // the dialog below already answers a manual check
    // Claim the prompt BEFORE the first await. Checking here and setting the flag after
    // startEngines() let two checks landing in the same tick (the hourly timer racing the Settings
    // button) both walk past the guard and stack two dialogs on the user.
    if (updatePromptOpen) {
      debug.log('[updater] a prompt is already open; ignoring duplicate update-available');
      return;
    }
    updatePromptOpen = true;
    try {
      try {
        await startEngines();
      } catch (err) {
        debug.log(`[updater] config load failed before prompt: ${err.message || err}`);
      }
      if (shouldSuppressUpdatePrompt(info.version, { manual })) return;
      // A game can start between the check being fired and this handler running, and a manual check
      // is a deliberate request that should still answer. Nothing is recorded — the offer is only
      // held back, and the game-exit signal brings it straight back.
      if (!manual && isGameRunning()) {
        debug.log(`[updater] version ${info.version} held back: a game is running`);
        scheduleUpdateCheck(updateGate.INTERVALS.inGame);
        return;
      }
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: t('update-available', 'Update Available', 'Mise à jour disponible'),
        message: t('update-available-message', 'A new version ({version}) is available.', 'Une nouvelle version ({version}) est disponible.', { version: info.version }),
        detail: t('download-and-install-it-now', 'Download and install it now?', 'La télécharger et l’installer maintenant ?'),
        buttons: [t('download-install', 'Download && Install', 'Télécharger && installer'), t('later', 'Later', 'Plus tard'), t('skip-this-version', 'Skip this version', 'Ignorer cette version')],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        debug.log(`[updater] user accepted download of ${info.version}`);
        updateDownloading = true;
        autoUpdater.downloadUpdate().catch((err) => {
          // A checksum mismatch is handled entirely by the 'error' listener below, which clears
          // the cache and retries once instead of surfacing the raw failure immediately.
          if (!isChecksumMismatchError(err)) notifyUpdateError(`download failed: ${err.message || err}`);
        });
      } else if (response === 2) {
        configJS.general.skippedVersion = info.version;
        await settingsJS.save(configJS);
        debug.log(`[updater] version ${info.version} skipped by user`);
      } else {
        // "Later" (and the dialog's cancel path, which maps to it).
        await postponeUpdate(info.version);
      }
    } finally {
      updatePromptOpen = false;
    }
  });
  autoUpdater.on('update-not-available', (info) => {
    debug.log(`[updater] current version is up to date (${info.version})`);
    manualUpdateResult = 'uptodate';
    if (manualUpdateCheckPending && tray) {
      manualUpdateCheckPending = false;
      try {
        tray.displayBalloon({
          iconType: 'info',
          title: t('achievement-watcher', 'Achievement Watcher'),
          content: t('up-to-date', 'You are already using the latest version ({version}).', 'Vous utilisez déjà la dernière version ({version}).', { version: info.version }),
        });
      } catch {}
    }
  });
  // The download can take minutes on a slow line and gives no sign of life otherwise: the window is
  // usually closed (tray daemon) and the app never says it is busy. Drive the taskbar progress bar
  // from the updater's own byte counter.
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0));
    setUpdateDownloadProgress(percent / 100);
    try {
      if (MainWin && !MainWin.isDestroyed()) MainWin.webContents.send('update-download-progress', percent);
    } catch {}
    // One line per 10% rather than per chunk, so the log stays readable.
    const step = Math.floor(percent / 10);
    if (step !== updateProgressLogged) {
      updateProgressLogged = step;
      const speed = Math.round((Number(progress && progress.bytesPerSecond) || 0) / 1024);
      debug.log(`[updater] downloading: ${percent.toFixed(0)}% (${speed} KB/s)`);
    }
  });
  autoUpdater.on('error', (err) => {
    const message = err && err.message ? err.message : String(err);
    if (isChecksumMismatchError(err)) {
      if (checksumRetryInFlight) {
        // The retry's own downloadUpdate() rejection already goes through the catch block below;
        // this is electron-updater's duplicate 'error' emission for that same second failure.
        return;
      }
      checksumRetryInFlight = true;
      debug.log(`[updater] checksum mismatch (${message}); clearing the update cache and retrying the download once`);
      (async () => {
        let cacheDir = '';
        try {
          cacheDir = await clearUpdaterCacheDir();
          debug.log(`[updater] update cache cleared: ${cacheDir}`);
        } catch (clearErr) {
          debug.log(`[updater] could not clear the update cache: ${clearErr.message || clearErr}`);
        }
        try {
          await autoUpdater.downloadUpdate();
          updaterErrorNotified = false; // the retry succeeded; let a future failure notify again
        } catch (retryErr) {
          await notifyChecksumRecoveryFailed(retryErr && retryErr.message ? retryErr.message : String(retryErr), cacheDir);
        } finally {
          checksumRetryInFlight = false;
        }
      })();
      return;
    }
    notifyUpdateError(message);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloading = false;
    clearUpdateDownloadProgress();
    promptDownloadedUpdate(info);
  });
  promptDownloadedUpdate = async function (info) {
    // Same synchronous claim as update-available: the flag has to be taken before the first await.
    if (updatePromptOpen) {
      debug.log('[updater] a prompt is already open; ignoring duplicate update-downloaded');
      return;
    }
    updatePromptOpen = true;
    try {
      try {
        await startEngines();
      } catch (err) {
        debug.log(`[updater] config load failed before install prompt: ${err.message || err}`);
      }
      if (shouldSuppressUpdatePrompt(info.version)) {
        pendingInstallPrompt = null;
        return;
      }
      // The download finishes on its own schedule, so it can land mid-session. Asking to restart
      // and install while a game is running is the worst possible moment. The update is already on
      // disk, so remember it and re-open this exact prompt when the session ends — going back
      // through a fresh check would make the user answer the download question a second time.
      if (isGameRunning()) {
        debug.log(`[updater] install prompt for ${info.version} held back: a game is running`);
        pendingInstallPrompt = info;
        return;
      }
      pendingInstallPrompt = null;
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: t('update-ready', 'Update Ready', 'Mise à jour prête'),
        message: t('update-ready-message', 'A new version ({version}) has been downloaded.', 'Une nouvelle version ({version}) a été téléchargée.', { version: info.version }),
        detail: t('update-ready-detail', 'Would you like to install it now?', 'Voulez-vous l’installer maintenant ?'),
        buttons: [t('yes', 'Yes', 'Oui'), t('later', 'Later', 'Plus tard'), t('skip-this-version', 'Skip this version', 'Ignorer cette version')],
        defaultId: 0,
        cancelId: 1,
      });

      if (response === 0) autoUpdater.quitAndInstall();
      else if (response === 2) {
        configJS.general.skippedVersion = info.version;
        await settingsJS.save(configJS);
      } else {
        // Declining the install must silence the whole cycle: without this the next hourly check
        // re-offers the download, electron-updater reports the file it already has, and the very
        // same "install now?" box comes back an hour later.
        await postponeUpdate(info.version);
      }
    } finally {
      updatePromptOpen = false;
    }
  };

  app
    .on('ready', async function () {
      ipc.window();
      // Startup-only init for the resident tray daemon (runs once, regardless of --hidden):
      // load config, copy resources, sync the login item, create the tray, then spawn/supervise the monitor.
      try {
        await startEngines();
      } catch (err) {
        debug.log('[startEngines] failed before startup sync: ' + err.message);
      }
      logStartupDiagnostics();
      try {
        checkResources();
      } catch (err) {
        debug.log('[checkResources] failed: ' + err.message);
      }
      if (!manifest.config.debug) {
        try {
          ipc.setStartWithWindows(configJS?.general?.startWithWindows !== false);
        } catch (err) {
          debug.log('[startup] failed to sync login item: ' + (err.message || err));
        }
      }
      createTray();
      // electron-updater reads resources/app-update.yml generated by electron-builder. Checking a
      // few seconds after startup keeps the tray responsive; failed checks retry and healthy checks
      // re-run periodically while the app stays resident (see scheduleUpdateCheck). Development
      // runs never contact the release feed.
      if (app.isPackaged) scheduleUpdateCheck(8000);
      if (safeMode) {
        debug.log('[safe-mode] startup monitor/background scans skipped');
      } else {
        if (!watchdogSwept) {
          watchdogSwept = true;
          // Sweep stale detached Watchdogs from older app versions once, before the first launch.
          // They would hold port 8082 / the single-instance lock and double-fire notifications.
          killWatchdog();
        }
        launchWatchdog();
        scheduleBackgroundAutoFix(); // headless emulator auto-fix while the window stays closed
      }
      // Cap the per-appid icon cache off the startup critical path (LRU by access time, ~1 GiB
      // default; no-op when under cap).
      setTimeout(() => {
        try {
          const { pruneIconCache } = require(path.join(__dirname, '../util/iconCache.js'));
          const r = pruneIconCache(path.join(userData, 'steam_cache', 'icon'));
          if (r.count > 0)
            debug.log(`[iconCache] pruned ${r.count} folder(s), freed ${(r.freed / 1048576).toFixed(0)}MB (was ${(r.before / 1048576).toFixed(0)}MB)`);
        } catch (err) {
          debug.log('[iconCache] prune skipped: ' + (err.message || err));
        }
      }, 15000);
      if (safeMode) startupArgs.hidden = false;
      const startupToast = parseToastActivation(process.argv);
      if (startupToast) startupArgs.hidden = false; // clicking a toast must surface the window
      parseArgs(startupArgs); // opens the window unless launched with --hidden
      openGameFromLaunchArgs(startupToast || startupArgs); // toast activation on a cold start (issue #8)
    })
    .on('window-all-closed', function () {
      // Resident tray daemon: do NOT quit when the window closes — the tray + background monitor stay
      // alive. The app exits only via the tray "Quit" item.
    })
    .on('web-contents-created', (event, contents) => {
      // Default-deny popups for every window (overlay, notification presets, hidden scrape window).
      // MainWin overrides this right after creation with its own handler that routes http(s) links
      // to the OS browser. (Replaces the dead 'new-window' listener — removed in Electron 22.)
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    })
    .on('second-instance', async (event, argv, cwd) => {
      // A second launch (user re-running the exe, e.g. from the Start menu while it sits hidden in
      // the tray) should surface the UI window.
      debug.log(`[second-instance] argv=${JSON.stringify(argv || [])}`);
      const args = normalizeWindowArgs(minimist(argv.slice(1)));
      if ((args['wintype'] || 'main') === 'main') createMainWindow();
      else parseArgs(args);

      // A toast click re-launches the exe with the achievement-watcher:// URI: surface the window
      // and open the game page even when a first instance was already running.
      openGameFromLaunchArgs(parseToastActivation(argv) || args);
    })
    .on('before-quit', function () {
      // Resident tray daemon: the monitor is our supervised child, so terminate it on a real quit
      // instead of leaking a background process. app.isQuiting also disables the respawn supervisor.
      app.isQuiting = true;
      clearTimeout(monitorRespawnTimer);
      if (monitorProc) {
        debug.log('[monitor] terminating monitor child on quit');
        try {
          monitorProc.kill();
        } catch {}
        monitorProc = null;
      }
    });
  }
} catch (err) {
  dialog.showErrorBox(
    t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
    `${t('failed', 'Failed.', 'Échec.')}\n${err}`
  );
  app.quit();
}
