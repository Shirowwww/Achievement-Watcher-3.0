'use strict';
const { ipcRenderer } = require('electron');
let userDataPath = null;
function getUserDataPath() {
  if (userDataPath) return userDataPath;
  userDataPath = ipcRenderer.sendSync('get-user-data-path-sync');
  return userDataPath;
}
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const args_split = require('argv-split');
const args = require('minimist');
const moment = require('moment');
const { spawn } = require('child_process');
const humanizeDuration = require('humanize-duration');
const settings = require(path.join(appPath, 'settings.js'));
settings.setUserDataPath(getUserDataPath());
const achievements = require(path.join(appPath, 'parser/achievements.js'));
const userdatapath = getUserDataPath();
const isDev = ipcRenderer.sendSync('win-isDev') || false;
achievements.initDebug({ isDev, userDataPath: userdatapath });
if (achievements.setEmulatorFixedHandler) {
  achievements.setEmulatorFixedHandler((game) => {
    try {
      ipcRenderer.send('emulator-fixed-notify', game);
    } catch (err) {
      debug && debug.log(`[emulator-fixed] notify bridge failed => ${formatErr(err)}`);
    }
  });
}
const blacklist = require(path.join(appPath, 'parser/blacklist.js'));
const userDir = require(path.join(appPath, 'parser/userDir.js'));
const libraryDirs = require(path.join(appPath, 'parser/libraryDirs.js'));
const goldberg = require(path.join(appPath, 'parser/goldberg.js'));
const gbeInstaller = require(path.join(appPath, 'parser/gbeInstaller.js'));
const steamParser = require(path.join(appPath, 'parser/steam.js'));
const exeList = require(path.join(appPath, 'parser/exeList.js'));
const exeDetect = require(path.join(appPath, 'parser/exeDetect.js'));
const gameIndex = require(path.join(appPath, 'parser/gameIndex.js'));
const PlaytimeTracking = require(path.join(appPath, 'parser/playtime.js'));
const progressMute = require(path.join(appPath, 'parser/progressMute.js'));
progressMute.setUserDataPath(getUserDataPath());
const l10n = require(path.join(appPath, 'locale/loader.js'));
const toastAudio = require(path.join(appPath, 'util/toastAudio.js'));
const coverStore = require(path.join(appPath, 'util/coverStore.js'));
// `escapeHtml` is declared once in ui/settings.js (which loads immediately before this script).
// Classic <script>s share a single global lexical scope, so re-declaring `const escapeHtml` here
// would throw "Identifier 'escapeHtml' has already been declared" and abort app.js entirely — it is
// consumed from that shared scope, exactly like `path` / `appPath` / `remote`.
let debug = new (require('@xan105/log'))({
  console: isDev,
  file: path.join(userdatapath, `logs/${ipcRenderer.sendSync('get-app-name-sync')}.log`),
});

// Surface otherwise-silent renderer failures to the log file. Without this a thrown error or a
// rejected promise outside an explicit .catch() disappears, which is how the UI ends up stuck on a
// perpetual "Loading" with no trace of what went wrong.
window.addEventListener('unhandledrejection', (e) => {
  try {
    debug.error(`[unhandledrejection] ${(e.reason && e.reason.stack) || e.reason}`);
  } catch {}
});
window.addEventListener('error', (e) => {
  try {
    debug.error(`[window.error] ${(e.error && e.error.stack) || e.message}`);
  } catch {}
});

const gameElements = new Map();
let gameList = [];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentFromProgress(current, max) {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((current / max) * 100)));
}

function getAchievementProgressState(achievement) {
  const max = Math.max(0, finiteNumber(achievement.MaxProgress ?? achievement.max_progress, 0));
  let current = Math.max(0, finiteNumber(achievement.CurProgress ?? achievement.progress, 0));
  const achieved = achievement.Achieved == 1 || achievement.Achieved === true;
  if (achieved && max > 0 && current < max) current = max;
  if (max > 0 && current > max) current = max;
  const percent = percentFromProgress(current, max);
  return {
    current,
    max,
    percent,
    // Binary 0/1 progress is just a normal locked/unlocked achievement, not a useful counter.
    hasProgress: max > 1,
  };
}

// Background new-game detection. Every NEW_GAME_SCAN_INTERVAL_MS we run a cheap discovery-only pass
// (no per-game achievement/icon loading) and compare the discovered appids against what's currently
// on screen. When a genuinely new install appears we trigger a full refresh, which re-seeds the
// watchdog gameIndex so the new game is tracked for playtime/notifications without the user having to
// reopen the app. Kept idle-friendly: it skips when the user is mid-session (game detail or settings
// open) and never overlaps an in-flight scan.
const NEW_GAME_SCAN_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
let newGameScanTimer = null;
let scanInFlight = false;

// One detection tick: cheap discover, diff against the games on screen, full refresh only on a new one.
async function runNewGameScan() {
  if (scanInFlight) return; // a scan is already running
  if ($('#achievement').is(':visible')) return; // user is reading a game's achievements — don't yank the view
  if ($('title-bar')[0] && $('title-bar')[0].inSettings) return; // user is configuring — leave them be
  scanInFlight = true;
  try {
    const discovered = await achievements.detectInstalledAppids(app.config);
    const known = new Set(gameList.map((g) => String(g.appid)));
    const fresh = discovered.filter((id) => !known.has(id));
    if (fresh.length > 0) {
      debug.log(`[new-game-scan] ${fresh.length} new game(s) detected (${fresh.join(', ')}) — refreshing library`);
      app.onStart(); // re-seeds the watchdog gameIndex so the new game is tracked
    }
  } catch (err) {
    debug.log(`[new-game-scan] failed: ${err}`);
  } finally {
    scanInFlight = false;
  }
}

// (Re)arm the background detection. onStart can run more than once, so clear any previous
// timer first to keep exactly one interval alive.
function scheduleNewGameScan() {
  if (newGameScanTimer) clearInterval(newGameScanTimer);
  newGameScanTimer = setInterval(runNewGameScan, NEW_GAME_SCAN_INTERVAL_MS);
}

function resolveUnpackedBinary(binPath) {
  const normalized = String(binPath || '');
  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

// Per-game-box busy overlay for the longer context-menu actions (GBE install, DRM removal): reuses
// the `.loading-overlay` spinner already in every box and the `.wait` class that reveals it, adding an
// optional status line under the spinner. `.text()` (not `.html()`) keeps any dynamic label inert.
// clearGameBoxBusy restores the plain spinner so the box's other `.wait` users are unaffected.
function setGameBoxBusy($box, text) {
  if (!$box || !$box.length) return;
  const content = $box.find('.loading-overlay .content').first();
  content.html('<i class="fas fa-spinner fa-spin"></i><div class="status"></div>');
  content.find('.status').text(text || '');
  $box.addClass('wait');
}
function clearGameBoxBusy($box) {
  if (!$box || !$box.length) return;
  $box.removeClass('wait');
  $box.find('.loading-overlay .content').first().html('<i class="fas fa-spinner fa-spin"></i>');
}

// request-zero (and some native callbacks) reject with a plain { code, message } object rather than an
// Error, so `${err}` renders as the useless "[object Object]" in dialogs. Coerce anything thrown into a
// readable one-liner: Error message, string, { message/error/reason }(+code), or a JSON fallback.
function formatErr(err) {
  if (err == null) return 'unknown error';
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const msg = err.message || err.error || err.reason;
    if (msg) return err.code && String(err.code) !== String(msg) ? `${msg} (${err.code})` : String(msg);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// Source-platform icons are shared by many games (most are "Steam (<user>)" or one of a handful of
// crack sources), yet the old code did a *synchronous* IPC round-trip per game inside the render
// loop. Memoize by source string so we pay one sync call per distinct source instead of one per game.
const sourceImgCache = new Map();
function getSourceImg(source) {
  if (sourceImgCache.has(source)) return sourceImgCache.get(source);
  const img = ipcRenderer.sendSync('fetch-source-img', source);
  sourceImgCache.set(source, img);
  return img;
}

// ---- Cover-art overrides (per-appid; cfg/covers.db) ------------------------------------------
// In-memory snapshot so the render path can apply an override synchronously (no disk read per tile).
let coverOverrides = coverStore.readAll();
function reloadCoverOverrides() {
  coverOverrides = coverStore.readAll();
}
function coverOverrideFor(appid) {
  return coverOverrides[String(appid)] || null;
}
function applyCoverBackground(appid, value) {
  const el = $(`#game-header-${appid}`);
  if (!value || value === 'none') {
    el.css({ background: 'none', backgroundSize: '', backgroundPosition: '', backgroundRepeat: '' });
  } else {
    el.css({ backgroundImage: `url('${value}')`, backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat' });
  }
}

// Styled in-app text prompt (Electron disables window.prompt). Resolves to the trimmed value or null.
function promptText(message, defaultValue = '', type = 'text') {
  return new Promise((resolve) => {
    const fr = String(window.app?.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
    const isSteamGuard = /(steam.*(?:2fa|guard)|(?:2fa|guard).*code|two.?factor)/i.test(message);
    const overlay = document.createElement('div');
    overlay.className = 'aw-prompt-overlay';
    const box = document.createElement('div');
    box.className = 'aw-prompt';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('div');
    heading.className = 'aw-prompt-heading';
    const icon = document.createElement('span');
    icon.className = 'aw-prompt-icon';
    icon.innerHTML = `<i class="fas ${isSteamGuard ? 'fa-shield-alt' : 'fa-keyboard'}"></i>`;
    const copy = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'aw-prompt-title';
    title.textContent = isSteamGuard ? 'Steam Guard' : fr ? 'Saisie requise' : 'Input required';
    const label = document.createElement('div');
    label.className = 'aw-prompt-description';
    label.textContent = isSteamGuard
      ? fr
        ? 'Saisis le code reçu par e-mail pour confirmer la connexion Steam.'
        : 'Enter the code sent by email to confirm the Steam login.'
      : message;
    copy.append(title, label);
    heading.append(icon, copy);
    const input = document.createElement('input');
    input.type = type;
    input.value = defaultValue;
    input.className = `aw-prompt-input${isSteamGuard ? ' code' : ''}`;
    if (isSteamGuard) {
      input.maxLength = 10;
      input.autocomplete = 'one-time-code';
      input.spellcheck = false;
      input.setAttribute('aria-label', fr ? 'Code Steam Guard' : 'Steam Guard code');
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\s+/g, '').toUpperCase();
      });
    }
    const row = document.createElement('div');
    row.className = 'aw-prompt-actions';
    const cancel = document.createElement('button');
    cancel.className = 'aw-prompt-button secondary';
    cancel.textContent = fr ? 'Annuler' : 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'aw-prompt-button primary';
    ok.textContent = fr ? 'Valider' : 'Confirm';
    row.append(cancel, ok);
    box.append(heading, input, row);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
    input.select();
    const done = (val) => {
      overlay.remove();
      resolve(val);
    };
    cancel.onclick = () => done(null);
    ok.onclick = () => done(input.value.trim() || null);
    overlay.onmousedown = (ev) => {
      if (ev.target === overlay) done(null);
    };
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') ok.click();
      else if (ev.key === 'Escape') cancel.click();
    };
  });
}
// Settings' Steam-login test uses the same modal so generate_emu_config can forward Steam Guard,
// email-code and captcha prompts without opening a console window.
window.awPromptText = promptText;

// Emulator sources whose achievement/header icons are already resolved local file:/// paths, so they
// must bypass the Steam `fetch-icon` IPC (which expects a Steam icon hash) and be used verbatim.
const EMU_LOCAL_ICON_SOURCES = new Set(['RPCS3 Emulator', 'ShadPS4 Emulator', 'Xenia Emulator']);
function gameHasAchievements(game) {
  return !!(game && game.achievement && (Number(game.achievement.total) > 0 || (Array.isArray(game.achievement.list) && game.achievement.list.length > 0)));
}

function sourcePresentationFor(game) {
  const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
  const source = game && game.source;
  const sourceLower = String(source || '').toLowerCase();
  const system = String((game && game.system) || '').toLowerCase();

  if (!gameHasAchievements(game)) {
    return {
      img: getSourceImg('Unconfigured'),
      label: fr ? 'Aucun succès trouvé' : 'No achievements found',
      kind: 'empty',
    };
  }

  if (system === 'playstation' || source === 'RPCS3 Emulator' || source === 'ShadPS4 Emulator') {
    return { img: getSourceImg(source === 'ShadPS4 Emulator' ? source : 'RPCS3 Emulator'), label: fr ? 'Succès PlayStation' : 'PlayStation trophies', kind: 'playstation' };
  }
  if (system === 'xbox' || source === 'Xenia Emulator') {
    return { img: getSourceImg('Xenia Emulator'), label: fr ? 'Succès Xbox' : 'Xbox achievements', kind: 'xbox' };
  }
  if (sourceLower === 'epic') {
    return { img: getSourceImg('epic'), label: fr ? 'Succès Epic Games' : 'Epic Games achievements', kind: 'epic' };
  }
  if (sourceLower === 'gog') {
    return { img: getSourceImg('gog'), label: fr ? 'Succès GOG' : 'GOG achievements', kind: 'gog' };
  }
  if (system === 'uplay' || sourceLower.includes('uplay') || sourceLower.includes('ubisoft')) {
    return { img: pathToFileURL(path.join(appPath, 'resources/img/achievement.svg')).href, label: fr ? 'Succès Ubisoft Connect' : 'Ubisoft Connect achievements', kind: 'ubisoft' };
  }
  if (system === 'ea' || sourceLower.includes('ea')) {
    return { img: pathToFileURL(path.join(appPath, 'resources/img/achievement.svg')).href, label: fr ? 'Succès EA app' : 'EA app achievements', kind: 'ea' };
  }

  return { img: getSourceImg(source), label: fr ? 'Succès Steam' : 'Steam achievements', kind: 'steam' };
}

function dllPresentationFor(game) {
  const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
  const present = !!(game && game.hasSteamApiDll);
  return {
    present,
    label: present
      ? fr
        ? 'steam_api(64).dll détecté'
        : 'steam_api(64).dll detected'
      : fr
        ? 'steam_api(64).dll introuvable'
        : 'steam_api(64).dll not found',
  };
}

function normalizePathKey(value) {
  return path.resolve(String(value || '')).toLowerCase();
}

function isPathInsideDir(value, root) {
  if (!value || !root) return false;
  const childKey = normalizePathKey(value);
  const rootKey = normalizePathKey(root);
  return childKey === rootKey || childKey.startsWith(rootKey + path.sep);
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function gbeBackupIndexFile() {
  return path.join(getUserDataPath(), 'cfg/gbe-backups.db');
}

function automaticGbeBackupRoot() {
  return path.join(getUserDataPath(), 'backups', 'gbe');
}

function readGbeBackupIndex() {
  const data = readJsonFile(gbeBackupIndexFile(), []);
  return Array.isArray(data) ? data : [];
}

function writeGbeBackupIndex(entries) {
  const file = gbeBackupIndexFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf8');
}

function backupManifestFor(backupDir) {
  const manifest = readJsonFile(path.join(backupDir || '', 'backup.json'), null);
  if (!manifest || !Array.isArray(manifest.files) || !manifest.gameDir) return null;
  return manifest;
}

function rememberGbeBackup({ appid, gameDir, backupDir, manifest }) {
  try {
    const resolvedBackup = path.resolve(backupDir);
    const entries = readGbeBackupIndex().filter((entry) => entry && normalizePathKey(entry.backupDir) !== normalizePathKey(resolvedBackup));
    entries.push({
      appid: String(appid || ''),
      gameDir: path.resolve(gameDir),
      backupDir: resolvedBackup,
      createdAt: (manifest && manifest.createdAt) || new Date().toISOString(),
    });
    writeGbeBackupIndex(entries.slice(-80));
  } catch (err) {
    debug.log(`[gbe-backup] could not remember backup => ${formatErr(err)}`);
  }
}

function createAutomaticGbeBackup({ appid, gameDir, steamSettings } = {}) {
  try {
    const localSteamSettings = isPathInsideDir(steamSettings, gameDir) ? steamSettings : null;
    const result = goldberg.backupSetup({
      gameDir,
      steamSettings: localSteamSettings,
      destinationRoot: automaticGbeBackupRoot(),
    });
    rememberGbeBackup({
      appid,
      gameDir,
      backupDir: result.backupDir,
      manifest: result.manifest,
    });
    debug.log(`[${appid || '?'}] GBE/Goldberg pre-fix backup created => ${result.backupDir}`);
    return { ...result, skipped: false };
  } catch (err) {
    const message = formatErr(err);
    if (/no steam_settings or Steam API DLL was found/i.test(message)) {
      debug.log(`[${appid || '?'}] GBE/Goldberg pre-fix backup skipped (${message})`);
      return { skipped: true, reason: message };
    }
    throw new Error(`backup before emulator fix failed: ${message}`);
  }
}

function backupCandidateFromDir(backupDir, { appid, gameDir, source = 'scan', indexedAppid = null } = {}) {
  try {
    if (!backupDir || !fs.existsSync(backupDir)) return null;
    const manifest = backupManifestFor(backupDir);
    if (!manifest) return null;
    const sameGameDir = normalizePathKey(manifest.gameDir) === normalizePathKey(gameDir);
    const sameIndexedAppid = indexedAppid && String(indexedAppid) === String(appid);
    if (!sameGameDir && !sameIndexedAppid) return null;
    const stat = fs.statSync(backupDir);
    const createdAt = manifest.createdAt || stat.mtime.toISOString();
    return { backupDir: path.resolve(backupDir), manifest, createdAt, source };
  } catch {
    return null;
  }
}

function scanBackupRoot(root, game) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const push = (dir) => {
    const candidate = backupCandidateFromDir(dir, { appid: game.appid, gameDir: game.gameDir, source: 'scan' });
    if (candidate) out.push(candidate);
  };
  push(root);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) push(path.join(root, entry.name));
  }
  return out;
}

function findLatestGbeBackup(game) {
  if (!game || !game.gameDir) return null;
  const candidates = [];
  for (const entry of readGbeBackupIndex()) {
    if (!entry || !entry.backupDir) continue;
    const candidate = backupCandidateFromDir(entry.backupDir, {
      appid: game.appid,
      gameDir: game.gameDir,
      source: 'index',
      indexedAppid: entry.appid,
    });
    if (candidate) candidates.push(candidate);
  }

  const roots = [];
  const addRoot = (root) => {
    if (!root) return;
    const key = normalizePathKey(root);
    if (!roots.some((existing) => normalizePathKey(existing) === key)) roots.push(root);
  };
  try {
    addRoot(remote.app.getPath('documents'));
  } catch {}
  try {
    addRoot(automaticGbeBackupRoot());
  } catch {}
  try {
    addRoot(path.dirname(game.gameDir));
  } catch {}
  for (const entry of readGbeBackupIndex()) {
    try {
      addRoot(path.dirname(entry.backupDir));
    } catch {}
  }
  for (const root of roots) candidates.push(...scanBackupRoot(root, game));

  const unique = new Map();
  for (const candidate of candidates) unique.set(normalizePathKey(candidate.backupDir), candidate);
  return [...unique.values()].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
}

function formatGbeBackupDetail(backup, game, fr) {
  const lines = [];
  if (game?.gameDir) lines.push(`${fr ? 'Jeu' : 'Game'}: ${game.gameDir}`);
  if (backup?.backupDir) lines.push(`${fr ? 'Sauvegarde' : 'Backup'}: ${backup.backupDir}`);
  if (backup?.createdAt) {
    const created = moment(backup.createdAt);
    if (created.isValid()) lines.push(`${fr ? 'Créée' : 'Created'}: ${created.format('L LT')}`);
  }
  if (backup?.manifest?.gameDir && game?.gameDir && normalizePathKey(backup.manifest.gameDir) !== normalizePathKey(game.gameDir)) {
    lines.push(`${fr ? 'Dossier d’origine' : 'Original folder'}: ${backup.manifest.gameDir}`);
  }
  if (backup?.source && backup.source !== 'manual') {
    const source = backup.source === 'index' ? (fr ? 'historique AW' : 'AW history') : fr ? 'scan disque' : 'disk scan';
    lines.push(fr ? `Trouvée automatiquement via ${source}.` : `Found automatically via ${source}.`);
  }
  return lines.join('\n');
}

// Watchdog-status banner is localized here (it's set imperatively, not via the nth-child locale loader).
function watchdogLangFr() {
  try {
    return String((app && app.config && app.config.achievement && app.config.achievement.lang) || '')
      .toLowerCase()
      .startsWith('fr');
  } catch {
    return false;
  }
}

ipcRenderer.on('reset-watchdog-status', (event) => {
  let shadow = document.querySelector('title-bar').shadowRoot;
  let watchdogStatus = shadow.querySelector('.status-dot');
  let watchdoglbl = shadow.querySelector('.status-text');
  watchdoglbl.textContent = watchdogLangFr() ? 'Vérification du Watchdog…' : 'Checking watchdog status...';
  watchdogStatus.classList.remove('status-green', 'status-red');
  watchdogStatus.classList.add('status-orange');
  let startBtn = shadow.querySelector('#start-watchdog');
  startBtn.textContent = '';
  startBtn.innerHTML = '';
});

ipcRenderer.on('watchdog-status', (event, found) => {
  const fr = watchdogLangFr();
  let shadow = document.querySelector('title-bar').shadowRoot;
  let watchdogStatus = shadow.querySelector('.status-dot');
  let watchdoglbl = shadow.querySelector('.status-text');
  watchdoglbl.textContent = fr
    ? 'Watchdog arrêté ! (les overlays/notifications ne se déclencheront pas)'
    : "Watchdog is not running! (overlay/notifications won't trigger.)";
  watchdogStatus.classList.remove('status-green', 'status-orange');
  watchdogStatus.classList.add('status-red');
  let startBtn = shadow.querySelector('#start-watchdog');
  startBtn.innerHTML = fr
    ? '<i class="fas fa-shield-alt"></i> Cliquez pour démarrer le Watchdog !'
    : '<i class="fas fa-shield-alt"></i> Click to Start Watchdog!';
  if (found) {
    //let watchdogStatus = shadow.querySelector('.status-dot.status-orange');
    watchdogStatus.classList.remove('status-orange', 'status-red');
    watchdogStatus.classList.add('status-green');
    watchdoglbl.textContent = fr
      ? 'Watchdog actif (overlays et notifications fonctionnels)'
      : 'Watchdog is running (overlay/notifications should work properly)';
    startBtn.textContent = '';
  }
});

ipcRenderer.on('achievement-unlock', (event, { appid, ach_data }) => {
  // A toast can arrive for a game that isn't in the current (filtered / hide-zero) list, or for an
  // achievement name the cached schema doesn't know — guard both before dereferencing.
  const game = gameList.find((game) => game.appid == appid);
  if (!game) return;
  const achievement = game.achievement.list.find((ach) => ach.name == ach_data.name);
  if (!achievement) return;
  if (!achievement.Achieved) {
    achievement.Achieved = 1;
    achievement.UnlockTime = Date.now() / 1000;
    game.achievement.unlocked += 1;
    updateGameBox(appid, game.achievement.total > 0 ? Math.floor((game.achievement.unlocked / game.achievement.total) * 100) : 0);
  }
  updateGamePage(appid, ach_data);
});

function updateGamePage(appid, ach_data) {
  // Only live-refresh the detail view when it's actually open AND already showing this game.
  // Otherwise a background unlock would crash (missing tile element) or yank the user off the
  // home/list screen into a game page on every toast.
  if (!$('#achievement').is(':visible')) return;
  if (String($('#achievement .wrapper > .header').attr('data-appid')) !== String(appid)) return;
  const el = gameElements.get(`${appid}`);
  if (!el) return;
  app.onGameBoxClick($(el), gameList);
}

function updateGameBox(appid, newProgress) {
  const gameEl = gameElements.get(`${appid}`);
  if (!gameEl) return;
  const progressBar = gameEl.querySelector('.progressBar');
  const meter = progressBar.querySelector('.meter');
  const value = progressBar.querySelector('.progress-value');
  meter.style.width = `${newProgress}%`;
  progressBar.dataset.percent = newProgress;
  if (value) value.textContent = `${newProgress}%`;
}

// Best-effort exe auto-detection for Goldberg/GBE games whose install folder was already
// found by discover() (game.gameDir) — avoids re-asking the user to browse to a path the
// app already knows. Returns the detected full exe path, or null.
// Resolve the launch executable for a game folder. gameName drives name-aware scoring; taken is the
// set of exe paths already assigned to OTHER games so auto-detection never picks a duplicate.
function autodetectGameExe(gameDir, gameName, taken) {
  if (!gameDir) return null;
  try {
    const emu = goldberg.detectEmulator(gameDir);
    const exeInfo = exeDetect.detect(gameDir, gameName || '', { dllPaths: emu.dll, taken });
    if (exeInfo?.full && fs.existsSync(exeInfo.full)) return exeInfo.full;
  } catch (err) {
    debug.log(err);
  }
  return null;
}

// Build the set of exe paths already claimed by appids other than `appid`, for anti-collision.
async function takenExePaths(appid) {
  try {
    const all = await exeList.list();
    return new Set(all.filter((e) => String(e.appid) !== String(appid) && e.exe).map((e) => e.exe));
  } catch {
    return new Set();
  }
}

var app = {
  args: getArgs(remote.process.argv),
  config: settings.load(),
  errorExit: function (err, message = 'An unexpected error has occured') {
    remote.dialog.showMessageBoxSync({ type: 'error', title: 'Unexpected Error', message: `${message}`, detail: `${err}` });
    remote.app.quit();
  },
  onStart: function () {
    let self = this;

    // Re-entry guard. onStart is triggered from several places (boot, the 15-min new-game scan, F5 /
    // refresh, settings save, onboarding finish). makeList streams tiles into #game-list as each game
    // loads, so two overlapping runs both append and the whole library shows up DUPLICATED — one copy
    // fully loaded, the other still on the loading spinner. Coalesce instead: if a load is already
    // running, request a single follow-up pass for when it finishes rather than starting a second
    // concurrent scan.
    if (self.listLoadInFlight) {
      self.listRescanPending = true;
      return;
    }
    self.listLoadInFlight = true;
    clearTimeout(self.listLoadGuardTimer);
    // Safety net: a makeList that rejects outright must never wedge the guard permanently.
    self.listLoadGuardTimer = setTimeout(() => {
      self.listLoadInFlight = false;
    }, 5 * 60 * 1000);

    debug.log(`${remote.app.name} loading...`);

    // Arm background detection so newly-installed games are picked up (and registered with the
    // watchdog for playtime tracking) without the user having to manually refresh.
    scheduleNewGameScan();

    $('title-bar')[0].inSettings = true;

    l10n
      .load(self.config.achievement.lang)
      .then((locale) => {
        moment.locale(locale);
      })
      .catch((err) => {
        debug.log(err);
        app.errorExit(err, 'Error loading lang.');
      });

    $('#user-info .info .name').text(self.config.general.username || os.userInfo().username || 'User');

    let loadingElem = {
      elem: $('#main-footer .loading'),
      progress: $('#main-footer .loading .progressBar'),
      meter: $('#main-footer .loading .progressBar > .meter'),
    };
    // A refresh reuses the same DOM: reopen the loading footer before scanning, then collapse the
    // whole footer when done so it does not leave an empty strip below the game list.
    $('#main-footer').removeClass('done');
    loadingElem.elem.show();

    $('#user-info .info .stats li:eq(0) span.data').text('0');
    $('#user-info .info .stats li:eq(1) span.data').text('0');
    $('#user-info .info .stats li:eq(2) span.data').text('0');

    $('#search-bar input[type=search]').val('').change().blur();

    // Running accumulators for the home header stats. The old code recomputed each of these by
    // filter/reduce-ing the *entire growing* gameList on every appended game (O(n²)); keeping running
    // totals makes each append O(1). statCount tracks displayed games (mirrors gameList.length).
    let statSumProgress = 0;
    let statCount = 0;
    let statTotalUnlocked = 0;
    let statCompleted = 0;
    // Average achievement completion across the library, filled as each game streams in. Mirrors the
    // "average %" stat shown above the bar — one simple, self-explanatory fill (was a 3-tier spread).
    sortOptions(); // reflect persisted sort state on the sort-box during load (real sort runs once at the end)
    $('#user-info').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('#sort-box').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('#search-bar').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('title-bar')[0].inSettings = false;
    gameList = [];
    const renderedAppids = new Set();
    // Make onStart() idempotent: re-running it (e.g. after right-click → remove from list) must not
    // append to the existing DOM or stack duplicate delegated handlers, which previously duplicated the
    // whole list until a full page refresh.
    $('#game-list ul').empty();
    gameElements.clear();
    $('#game-list').off();
    $('#game-config').off('click', '.edit').off('click', '.unlink');
    $('#btn-game-config-save').off('click');
    $('#btn-game-config-cancel, #game-config .overlay').off('click');
    achievements
      .makeList(
        self.config,
        (percent) => {
          loadingElem.progress.attr('data-percent', percent);
          loadingElem.meter.css('width', percent + '%');
        },
        (game) => {
          let elem = $('#game-list ul');
          if (game.achievement.unlocked > 0 || self.config.achievement.hideZero == false) {
            const appidKey = String(game.appid);
            if (renderedAppids.has(appidKey)) {
              debug.log(`[${game.appid}] duplicate streamed tile ignored`);
              return;
            }
            renderedAppids.add(appidKey);
            let progress = game.achievement.total > 0 ? Math.round((100 * game.achievement.unlocked) / game.achievement.total) : 0;

            statSumProgress += progress;
            statCount += 1;
            const avgCompletion = Math.floor(statSumProgress / statCount);
            $('#user-info .info .stats li:eq(2) span.data').text(avgCompletion);

            const distEl = $('#user-info .completion-dist');
            distEl.find('.fill').css('width', avgCompletion + '%');
            distEl.attr('title', avgCompletion + '%');

            let timeMostRecent = Math.max.apply(
              Math,
              game.achievement.list
                .filter((ach) => ach.Achieved && ach.UnlockTime > 0)
                .map((ach) => {
                  return ach.UnlockTime;
                })
            );

            // Last-played timestamp (watchdog playtime tracking) — drives the "recently played" sort.
            let lastPlayed = PlaytimeTracking.lastPlayedSync(game.appid);

            let portrait = self.config.achievement.thumbnailPortrait;

            portrait ? $('#game-list').addClass('view-portrait') : $('#game-list').removeClass('view-portrait');
            let isPortrait = portrait && game.img.portrait;
            let imgName = isPortrait ? game.img.portrait : game.img.header;
            const sourceIcon = sourcePresentationFor(game);
            const dllIcon = typeof game.hasSteamApiDll === 'boolean' ? dllPresentationFor(game) : null;
            let template = `
            <li>
                <div class="game-box" data-index="${gameList.length}" data-appid="${game.appid}" data-installed="${
              game.installed ? 1 : 0
            }" data-time="${timeMostRecent > 0 ? timeMostRecent : 0}" data-lastplayed="${lastPlayed}" ${
              game.system ? `data-system="${game.system}"` : ''
            }>
                  <div class="loading-overlay"><div class="content"><i class="fas fa-spinner fa-spin"></i></div></div>
                  <div class="header ${isPortrait ? 'glow' : ''}" id="game-header-${game.appid}" style="background: url('${
              pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href
            }');">
                  <!-- Play Button -->
                  <div class="play-button"><i class="fas fa-play"></i></div>
                  </div>

                  <!-- Top Left Button -->
                  <button class="achievement-button">
                    <i class="fas fa-trophy"></i>
                  </button>

                  <!-- Top Right Button -->
                  <div class="config-button">
                    <i class="fas fa-tools"></i>
                  </div>

                  <div class="info">
                    <div class="info-head">
                      <div class="title" title="${escapeHtml(game.name)}"><span>${escapeHtml(game.name)}</span></div>
                      <div class="game-meta">
                        ${
                          dllIcon
                            ? `<span class="dll-badge ${dllIcon.present ? 'present' : 'missing'}" title="${escapeHtml(
                                dllIcon.label
                              )}" role="img" aria-label="${escapeHtml(dllIcon.label)}"></span>`
                            : ''
                        }
                        <img class="source-icon" src="${sourceIcon.img}" data-kind="${escapeHtml(sourceIcon.kind)}" title="${escapeHtml(
              sourceIcon.label
            )}" alt="${escapeHtml(sourceIcon.label)}" aria-label="${escapeHtml(sourceIcon.label)}">
                      </div>
                    </div>
                    <div class="progressBar" data-percent="${progress}"><span class="meter" style="width:${progress}%"></span><span class="progress-value">${progress}%</span></div>
                    <!--${game.source ? `<div class="source">${game.source}</div>` : ''}-->
                  </div>
                </div>
            </li>
            `;

            const item = $(template);
            elem.append(item);
            const headerEl = item.find('.header').first();
            gameList.push(game);

            // "completed / total" — a game counts as completed only when it actually has achievements
            // and every one is unlocked. (statCount mirrors gameList.length; incremented above.)
            if (game.achievement.total > 0 && game.achievement.unlocked == game.achievement.total) statCompleted += 1;
            $('#user-info .info .stats li:eq(1) span.data').text(`${statCompleted}/${statCount}`);

            statTotalUnlocked += parseInt(game.achievement.unlocked) || 0;
            $('#user-info .info .stats li:eq(0) span.data').text(statTotalUnlocked);

            setTimeout(() => {
              const coverOverride = coverOverrideFor(game.appid);
              if (coverOverride) {
                // User-set cover (local image / alternate AppID) wins over every default source.
                headerEl.css('background', `url('${coverOverride}')`);
                return;
              }
              if (EMU_LOCAL_ICON_SOURCES.has(game.source)) {
                if (game.img && game.img.header) headerEl.css('background', `url('${game.img.header}')`);
                else headerEl.css('background', 'none');
                return;
              }
              if (!imgName) { headerEl.css('background', 'none'); return; } // no art: clear the loading.gif so the spinner doesn't run forever
              ipcRenderer
                .invoke('fetch-icon', imgName, game.steamappid || game.appid)
                .then((localPath) => {
                  if (localPath) {
                    headerEl.css('background', `url('${localPath}')`);
                  }
                })
                .catch((err) => debug.warn(`[${game.appid}] header icon fetch failed => ${err}`));
            }, 0);
          }
        }
      )
      .then((list) => {
        // Scan finished — release the re-entry guard. If a refresh was requested while this run was in
        // flight, run exactly one more pass now (the just-finished list is stale) and skip finalising it.
        clearTimeout(self.listLoadGuardTimer);
        self.listLoadInFlight = false;
        if (self.listRescanPending) {
          self.listRescanPending = false;
          return self.onStart();
        }
        loadingElem.elem.hide();
        $('#main-footer').addClass('done');

        if (list.length == 0) {
          debug.log('No game found !');
          $('#game-list .isEmpty').show();
          return;
        }
        ipcRenderer.send('close-puppeteer');
        debug.log('Populating game list ...');

        // Sort the fully-built list exactly once. The old code re-sorted the whole (growing) list on
        // every appended game — O(n²) detach/sort/re-append churn during load. Tiles stream in arrival
        // order, then settle into the chosen sort here.
        sort($('#game-list ul'), sortOptions());

        // Drop duplicate binary assignments in the watchdog game index (e.g. a stale "Forza Horizon 5"
        // pointing at forzahorizon6.exe alongside the real Forza Horizon 6) so playtime is attributed
        // to the right game.
        try {
          const removed = gameIndex.reconcile(gameList);
          if (removed > 0) debug.log(`[gameIndex] reconcile removed ${removed} duplicate binary entr${removed === 1 ? 'y' : 'ies'}`);
        } catch (err) {
          debug.log(err);
        }

        // Auto-update launch list against what's installed now: drop dead paths, break collisions
        // (e.g. several games stuck on the same exe), and re-detect from each game's install folder.
        exeList
          .reconcile(gameList)
          .then(async (n) => {
            if (n > 0) debug.log(`[exeList] reconcile fixed ${n} entr${n === 1 ? 'y' : 'ies'}`);
            // exeList signal for the "installed only" filter: a game with a still-living configured
            // launch exe is installed even if discovery couldn't resolve its install folder. reconcile
            // just dropped dead paths, so any non-empty exe here exists on disk.
            try {
              const entries = await exeList.list();
              const withExe = new Set(entries.filter((e) => e.exe).map((e) => String(e.appid)));
              for (const box of document.querySelectorAll('#game-list .game-box[data-installed="0"]')) {
                if (withExe.has(String(box.dataset.appid))) box.dataset.installed = '1';
              }
              window.applyInstalledFilter?.();
            } catch (err) {
              debug.log(err);
            }
          })
          .catch((err) => debug.log(err));

        let elem = $('#game-list ul');

        elem.find('.game-box').each(function () {
          const appid = this.dataset.appid;
          gameElements.set(appid, this);
        });

        $('#btn-game-config-cancel, #game-config .overlay').on('click', function () {
          self.onGameConfigCancelClick($(this));
        });

        $('#btn-game-config-save').click(async function () {
          self.onGameConfigSaveClick($(this));
        });

        $('#game-list')
          .on('mouseenter', '.game-box .info .title', function () {
            const text = this.querySelector('span');
            if (!text) return;
            const overflow = Math.max(0, Math.ceil(text.getBoundingClientRect().width - this.clientWidth));
            if (overflow <= 2) return;

            this._scrollAnimation?.cancel();
            this._scrollAnimation = text.animate(
              [
                { transform: 'translateX(0)', offset: 0 },
                { transform: 'translateX(0)', offset: 0.14 },
                { transform: `translateX(-${overflow}px)`, offset: 0.78 },
                { transform: `translateX(-${overflow}px)`, offset: 1 },
              ],
              {
                duration: Math.max(3200, overflow * 28),
                iterations: Infinity,
                direction: 'alternate',
                easing: 'ease-in-out',
              }
            );
          })
          .on('mouseleave', '.game-box .info .title', function () {
            this._scrollAnimation?.cancel();
            this._scrollAnimation = null;
          })
          .on('click', '.game-box', function () {
            self.onGameBoxClick($(this), gameList);
          })
          .on('click', '.game-box .play-button', async function (e) {
            e.stopPropagation();
            self.onPlayButtonClick($(this));
          })
          .on('click', '.game-box .config-button', async function (e) {
            e.stopPropagation();
            self.onConfigButtonClick($(this), gameList, await exeList.get());
          });

        $('#game-config').on('click', '.edit', async function (e) {
          e.stopPropagation();
          let appid = parseInt($('#game-config .header').attr('title'));
          let cfg = await exeList.get(appid);
          let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            title: 'Choose the game executable',
            buttonLabel: 'Select',
            defaultPath: cfg.exe,
            filters: [{ name: 'Executables', extensions: ['exe', 'bat'] }],
            properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
          });

          if (dialog.filePaths.length > 0 && dialog.filePaths[0].length > 0) {
            const filePath = dialog.filePaths[0];

            $('#game-config').find('.constant').text(filePath);
            $('#game-config').find('.constant').attr('title', filePath);
          }
        });

        $('#game-config')
          .on('mouseenter', '#dirlist .path', function () {
            const text = this.querySelector('.constant');
            if (!text) return;
            const overflow = Math.max(0, Math.ceil(text.scrollWidth - this.clientWidth));
            this.classList.toggle('overflow', overflow > 2);
            if (overflow <= 2) return;

            this._scrollAnimation?.cancel();
            this._scrollAnimation = text.animate(
              [
                { transform: 'translateX(0)', offset: 0 },
                { transform: 'translateX(0)', offset: 0.14 },
                { transform: `translateX(-${overflow}px)`, offset: 0.78 },
                { transform: `translateX(-${overflow}px)`, offset: 1 },
              ],
              {
                duration: Math.max(3400, overflow * 18),
                iterations: Infinity,
                direction: 'alternate',
                easing: 'ease-in-out',
              }
            );
          })
          .on('mouseleave', '#dirlist .path', function () {
            this._scrollAnimation?.cancel();
            this._scrollAnimation = null;
          });

        // Unlink: clear the configured executable for this game and persist immediately.
        $('#game-config').on('click', '.unlink', async function (e) {
          e.stopPropagation();
          let appid = parseInt($('#game-config .header').attr('title'));
          let cfg = await exeList.get(appid);
          cfg.exe = '';
          await exeList.add(cfg);
          $('#game-config').find('.constant').text('').attr('title', '');
        });

        $('#game-list .game-box').contextmenu(function (e) {
          e.preventDefault();
          let self = $(this);
          let appid = self.data('appid');
          // "Unconfigured" games carry a synthetic "local-<hash>" id (no confirmed Steam appid), not a
          // real numeric Steam appid. goldberg.repair() writes whatever appid it's given straight into
          // steam_appid.txt — passing the synthetic id there corrupts the install's identity marker, so
          // on the next scan it matches neither the appid-based Goldberg scan (needs a numeric appid)
          // nor the unconfigured scan (which now sees an appid marker and stops treating it as
          // unconfigured) and the game vanishes from the list entirely (reported: GBE Fork install
          // made Jackbox 1/2/9 disappear on reload). Resolve a real numeric appid first — the
          // unconfigured branch in achievements.js already looked one up via findAppidByName and
          // exposed it as game.steamappid — and fall back to leaving steam_appid.txt untouched.
          // `let`, not `const`: the GBE-install action below may resolve a still-unknown appid via the
          // fuzzy picker and reassign this so the diagnose/repair closures (which read it at call time)
          // write the correct steam_appid.txt.
          let writableAppid = /^[0-9]+$/.test(String(appid)) ? appid : list.find((g) => g.appid == appid)?.steamappid || null;

          const { Menu, MenuItem, nativeImage } = remote;
          const menu = new Menu();
          const gameMenu = new Menu();
          const emulatorMenu = new Menu();
          const folderMenu = new Menu();
          const linkMenu = new Menu();
          const diagnosisRepairCodes = [
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
          ];
          const canRepairGoldbergReport = (report) => report.issues.some((i) => diagnosisRepairCodes.includes(i.code));
          const buildGoldbergDiagnosisLines = (report) => {
            const emuLabel = { gbe: 'GBE Fork', goldberg: 'Goldberg (classic)', none: 'none detected' }[report.emulator] || report.emulator;
            const lines = [];
            lines.push(`emulator: ${emuLabel}`);
            lines.push(report.steamSettings ? `steam_settings: ${report.steamSettings}` : 'steam_settings: not found');
            if (report.achievements.expected != null) {
              lines.push(`achievements: ${report.achievements.found} in file / ${report.achievements.expected} in schema`);
            }
            if (report.issues.length === 0) {
              lines.push('');
              lines.push('No problems detected.');
            } else {
              lines.push('');
              for (const i of report.issues) lines.push(`[${i.level}] ${i.message}`);
            }
            return lines;
          };
          const repairGoldbergSetup = async ({ report, gameDir, game }) => {
            const request = require('request-zero');
            const target = report.steamSettings || path.join(gameDir, 'steam_settings');
            const downloadIcon = async (url, dir) => {
              const r = await request.download(url, dir);
              return r && r.path;
            };
            // Also enable all DLCs (configs.app.ini) and stamp the app's username/language into
            // configs.user.ini — the full GBE setup, not just achievements.json.
            return goldberg.repair({
              steamSettings: target,
              appid: writableAppid,
              schema: game,
              downloadIcon,
              fetchDlc: (id) => steamParser.getDLCList(id),
              accountName: app.config?.general?.username,
              language: app.config?.achievement?.lang,
            });
          };
          const diagnoseGoldbergSetup = async ({ game, gameDir, autoRepair = false, showDialog = true }) => {
            let report = goldberg.diagnose({ gameDir, appid: writableAppid, schema: game });
            let repaired = null;
            let repairError = null;
            const canRepair = canRepairGoldbergReport(report);

            if (autoRepair && canRepair) {
              try {
                repaired = await repairGoldbergSetup({ report, gameDir, game });
                report = goldberg.diagnose({ gameDir, appid: writableAppid, schema: game });
              } catch (err) {
                repairError = err;
              }
            }

            if (showDialog) {
              const lines = buildGoldbergDiagnosisLines(report);
              if (repaired) {
                lines.push('');
                lines.push(`Auto-repair wrote ${repaired.achievementsJson.length} achievements to ${repaired.steamSettings}`);
                lines.push(`icons: ${repaired.icons.downloaded} downloaded, ${repaired.icons.failed} failed, ${repaired.icons.skipped} skipped`);
                if (repaired.wroteAppId) lines.push('steam_appid.txt created');
                if (repaired.main && repaired.main.changed) lines.push('configs.main.ini updated (new_app_ticket + gc_token)');
                if (repaired.dlc) lines.push(`configs.app.ini updated (${repaired.dlc.count} DLC entries, unlock_all=${repaired.dlc.unlockAll ? '1' : '0'})`);
                if (repaired.user && repaired.user.changed) lines.push('configs.user.ini updated');
              }
              if (repairError) {
                lines.push('');
                lines.push(`Auto-repair failed: ${repairError.message || repairError}`);
              }

              const choice = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                type: report.ok && !repairError ? 'info' : 'warning',
                title: `Goldberg/GBE diagnosis — ${game?.name || appid}`,
                message: report.ok ? 'Setup looks valid.' : 'Problems were detected.',
                detail: lines.join('\n'),
                buttons: !autoRepair && canRepair ? ['OK', 'Repair steam_settings (write schema + icons)...'] : ['OK'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });

              if (!autoRepair && canRepair && choice.response === 1) {
                try {
                  const summary = await repairGoldbergSetup({ report, gameDir, game });
                  remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                    type: 'info',
                    title: 'Repair complete',
                    message: `Wrote ${summary.achievementsJson.length} achievements to ${summary.steamSettings}`,
                    detail:
                      `icons: ${summary.icons.downloaded} downloaded, ${summary.icons.failed} failed, ${summary.icons.skipped} skipped` +
                      (summary.wroteAppId ? '\nsteam_appid.txt created' : '') +
                      (summary.main && summary.main.changed ? '\nconfigs.main.ini updated (new_app_ticket + gc_token)' : '') +
                      (summary.dlc ? `\nconfigs.app.ini updated (${summary.dlc.count} DLC entries, unlock_all=${summary.dlc.unlockAll ? '1' : '0'})` : '') +
                      (summary.user && summary.user.changed ? '\nconfigs.user.ini updated' : ''),
                    noLink: true,
                  });
                } catch (err) {
                  remote.dialog.showMessageBoxSync({ type: 'error', title: 'Repair failed', message: 'Could not write steam_settings.', detail: `${err}` });
                }
              }
            }

            return { report, repaired, repairError };
          };
          gameMenu.append(
            new MenuItem({
              icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/cross.png')),
              label: $('#game-list').attr('data-contextMenu0'),
              click() {
                try {
                  blacklist.add(appid);
                  app.onStart();
                } catch (err) {
                  remote.dialog.showMessageBoxSync({
                    type: 'error',
                    title: 'Unexpected Error',
                    message: `Failed to add item to user blacklist`,
                    detail: `${err}`,
                  });
                }
              },
            })
          );

          gameMenu.append(
            new MenuItem({
              label: progressMute.isMuted(appid)
                ? $('#game-list').attr('data-ctx-unmuteprogress') || 'Unmute progress notifications'
                : $('#game-list').attr('data-ctx-muteprogress') || 'Mute progress notifications',
              click() {
                try {
                  progressMute.toggle(appid);
                } catch (err) {
                  debug.error(err);
                }
              },
            })
          );

          if (!self.data('system')) {
            //Steam only
            gameMenu.append(
              new MenuItem({
                label: $('#game-list').attr('data-ctx-resetplaytime') || 'Reset playtime and last played',
                async click() {
                  self.css('pointer-events', 'none');
                  await PlaytimeTracking.reset(appid).catch((err) => {
                    debug.error(err);
                  });
                  self.css('pointer-events', 'initial');
                },
              })
            );
            if (app.config.notification_advanced.iconPrefetch) {
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/image.png')),
                  label: $('#game-list').attr('data-contextMenu1'),
                  async click() {
                    self.css('pointer-events', 'none');
                    self.addClass('wait');
                    try {
                      const request = require('request-zero');
                      const cache = path.join(remote.app.getPath('userData'), `steam_cache/icon/${appid}`);

                      for (let achievement of list.find((game) => game.appid == appid).achievement.list) {
                        await Promise.all([request.download(achievement.icon, cache), request.download(achievement.icongray, cache)]).catch(() => {});
                      }
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: 'Unexpected Error',
                        message: `Failed to build icon cache`,
                        detail: `${err}`,
                      });
                    }
                    self.removeClass('wait');
                    self.css('pointer-events', 'initial');
                  },
                })
              );
            }

            emulatorMenu.append(
              new MenuItem({
                icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/file-text.png')),
                label: $('#game-list').attr('data-ctx-genjson') || 'Generate achievements.json for Goldberg Emu',
                async click() {
                  self.css('pointer-events', 'none');
                  try {
                    const request = require('request-zero');

                    let dialog = await remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
                      title: 'Choose where to generate achievements.json',
                      buttonLabel: 'Generate',
                      defaultPath: 'achievements.json',
                      properties: ['showHiddenFiles', 'dontAddToRecent'],
                    });

                    self.addClass('wait');

                    if (dialog.filePath.length > 0) {
                      const filePath = dialog.filePath;
                      const dir = path.parse(filePath).dir;
                      const achievements = list.find((game) => game.appid == appid).achievement.list;

                      let result = [];

                      for (let achievement of achievements) {
                        try {
                          let icons = await Promise.all([
                            request.download(achievement.icon, path.join(dir, 'images')),
                            request.download(achievement.icongray, path.join(dir, 'images')),
                          ]);
                          result.push({
                            description: achievement.description || '',
                            displayName: achievement.displayName,
                            hidden: achievement.hidden == 1 ? '1' : '0',
                            icon: 'images/' + path.parse(icons[0].path).base,
                            icongray: 'images/' + path.parse(icons[1].path).base,
                            name: achievement.name,
                          });
                        } catch {
                          result.push({
                            description: achievement.description || '',
                            displayName: achievement.displayName,
                            hidden: achievement.hidden == 1 ? '1' : '0',
                            name: achievement.name,
                          });
                        }
                      }

                      if (result.length > 0) {
                        fs.mkdirSync(path.dirname(filePath), { recursive: true });
                        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
                      }
                    }
                  } catch (err) {
                    remote.dialog.showMessageBoxSync({
                      type: 'error',
                      title: 'Unexpected Error',
                      message: `Failed to generate achievements.json`,
                      detail: `${err}`,
                    });
                  }
                  self.removeClass('wait');
                  self.css('pointer-events', 'initial');
                },
              })
            );

            // Three visually distinct tool clusters: data, diagnostics/backups, then game-file fixes.
            emulatorMenu.append(new MenuItem({ type: 'separator' }));
            emulatorMenu.append(
              new MenuItem({
                icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/file-text.png')),
                label: $('#game-list').attr('data-ctx-diagnose') || 'Diagnose Goldberg/GBE setup',
                async click() {
                  try {
                    const game = list.find((g) => g.appid == appid);
                    // Reuse the install folder discover() already found instead of asking the
                    // user to re-browse to it; only prompt when it's genuinely unknown.
                    let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                    if (!gameDir) {
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: "Select the game's install folder (where the emulator .dll is)",
                        buttonLabel: 'Diagnose',
                        properties: ['openDirectory', 'dontAddToRecent'],
                      });
                      if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }
                    await diagnoseGoldbergSetup({ game, gameDir });
                  } catch (err) {
                    remote.dialog.showMessageBoxSync({ type: 'error', title: 'Diagnose failed', message: 'Could not diagnose the setup.', detail: `${err}` });
                  }
                },
              })
            );

            const backupGame = list.find((g) => g.appid == appid);
            if (backupGame?.gameDir && fs.existsSync(backupGame.gameDir)) {
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/folder-open.png')),
                  label: $('#game-list').attr('data-ctx-backupgbe') || 'Back up GBE/Goldberg setup (steam_settings + steam_api(64).dll)…',
                  async click() {
                    try {
                      const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: fr ? 'Où sauvegarder GBE/Goldberg (steam_settings + steam_api) ?' : 'Where should AW save the GBE/Goldberg setup?',
                        buttonLabel: fr ? 'Créer la sauvegarde' : 'Create backup',
                        defaultPath: remote.app.getPath('documents'),
                        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
                      });
                      if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                      const result = goldberg.backupSetup({
                        gameDir: backupGame.gameDir,
                        steamSettings: backupGame.steamSettings,
                        destinationRoot: picked.filePaths[0],
                      });
                      rememberGbeBackup({
                        appid,
                        gameDir: backupGame.gameDir,
                        backupDir: result.backupDir,
                        manifest: result.manifest,
                      });
                      const choice = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: fr ? 'Sauvegarde GBE/Goldberg créée' : 'GBE/Goldberg backup created',
                        message: fr
                          ? `${result.files.length} élément(s) sauvegardé(s) : steam_settings + DLL Steam.`
                          : `Backed up ${result.files.length} item(s): steam_settings + Steam DLLs.`,
                        detail: formatGbeBackupDetail({ backupDir: result.backupDir, manifest: result.manifest, createdAt: result.manifest?.createdAt }, backupGame, fr),
                        buttons: ['OK', fr ? 'Ouvrir la sauvegarde' : 'Open backup folder'],
                        defaultId: 0,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (choice === 1) remote.shell.openPath(result.backupDir);
                    } catch (err) {
                      const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'error',
                        title: fr ? 'Échec de la sauvegarde GBE/Goldberg' : 'GBE/Goldberg backup failed',
                        message: fr
                          ? 'Impossible de sauvegarder steam_settings et les DLL Steam de ce jeu.'
                          : 'Could not back up steam_settings and Steam DLLs for this game.',
                        detail: formatErr(err),
                      });
                    }
                  },
                })
              );

              // Counterpart to "Back up GBE/Goldberg setup": copy the files from a backup folder
              // (one created by the item above, identified by its backup.json manifest) back over the
              // live install — the manual undo for a bad emulator fix / DLC edit / DRM strip.
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/redo-alt.png')),
                  label: $('#game-list').attr('data-ctx-restoregbe') || 'Restore latest GBE/Goldberg backup…',
                  async click() {
                    const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                    try {
                      let backup = findLatestGbeBackup({ ...backupGame, appid });
                      if (!backup) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: fr ? 'Aucune sauvegarde connue : choisir un dossier GBE/Goldberg' : 'No known backup: choose a GBE/Goldberg backup folder',
                          buttonLabel: fr ? 'Restaurer ce dossier' : 'Restore this folder',
                          defaultPath: remote.app.getPath('documents'),
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        const backupDir = path.resolve(picked.filePaths[0]);
                        const manifest = backupManifestFor(backupDir);
                        if (!manifest) throw new Error('restore: backup.json manifest is missing — not an Achievement Watcher GBE backup');
                        backup = { backupDir, manifest, createdAt: manifest.createdAt, source: 'manual' };
                      }
                      const confirm = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'warning',
                        title: fr ? 'Restaurer la sauvegarde GBE/Goldberg ?' : 'Restore GBE/Goldberg backup?',
                        message: fr
                          ? 'AW va restaurer steam_settings et les DLL Steam sauvegardées pour ce jeu.'
                          : 'AW will restore the saved steam_settings and Steam DLLs for this game.',
                        detail: formatGbeBackupDetail(backup, backupGame, fr),
                        buttons: [fr ? 'Annuler' : 'Cancel', fr ? 'Restaurer' : 'Restore'],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm !== 1) return;
                      const result = goldberg.restoreSetup({
                        backupDir: backup.backupDir,
                        gameDir: backupGame.gameDir,
                      });
                      rememberGbeBackup({
                        appid,
                        gameDir: backupGame.gameDir,
                        backupDir: backup.backupDir,
                        manifest: backup.manifest || result.manifest,
                      });
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: fr ? 'Restauration GBE/Goldberg terminée' : 'GBE/Goldberg restore complete',
                        message: fr ? `${result.files.length} élément(s) restauré(s).` : `Restored ${result.files.length} item(s).`,
                        detail: formatGbeBackupDetail({ ...backup, manifest: result.manifest }, { ...backupGame, gameDir: result.gameDir }, fr),
                        noLink: true,
                      });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'error',
                        title: fr ? 'Échec de la restauration GBE/Goldberg' : 'GBE/Goldberg restore failed',
                        message: fr
                          ? 'Impossible de restaurer cette sauvegarde GBE/Goldberg.'
                          : 'Could not restore this GBE/Goldberg backup.',
                        detail: formatErr(err),
                      });
                    }
                  },
                })
              );
            }

            // GBE Fork install helper — hidden only for games legitimately owned/installed via the
            // real Steam client (source "Steam (<username>)") or native-launcher sources (GOG/Epic),
            // none of which use a replaceable steam_api dll. Every other source (OnlineFix, Codex,
            // Rune, Skidrow, SmartSteamEmu, CreamAPI, Reloaded - 3DM, Goldberg, GBE Fork, Unconfigured,
            // custom Folder-tab dirs with no explicit source, …) is some flavor of cracked/emulated
            // install and can always have GBE Fork (re)installed — this used to be an allowlist that
            // missed most crack sources (#bug: "ne marche pas sur Fast Food Simulator/Forza Horizon 6").
            const gameSource = list.find((g) => g.appid == appid)?.source || '';
            const isLegitSteamOwned = gameSource.startsWith('Steam (');
            const isNativeLauncher = gameSource === 'gog' || gameSource === 'epic';
            if (!isLegitSteamOwned && !isNativeLauncher) {
              emulatorMenu.append(new MenuItem({ type: 'separator' }));
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/file-text.png')),
                  label: $('#game-list').attr('data-ctx-installgbe') || 'Apply emulator fix (GBE Fork)…',
                  async click() {
                    const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                    try {
                      // 1 — reuse the install folder discover() already found; only prompt when
                      // it's genuinely unknown (e.g. a manually-added custom-dir game).
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: "Select the game's install folder (where steam_api(64).dll should go)",
                          buttonLabel: 'Install here',
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }

                      // 1a — Create a portable restore point before any write step. CrakFiles remains
                      // the first actual fix applied, but the user can now undo the pre-fix
                      // steam_settings + steam_api(64).dll state from "Restore latest GBE/Goldberg backup".
                      setGameBoxBusy(self, fr ? 'Sauvegarde avant fix…' : 'Backing up before fix…');
                      const preFixBackup = createAutomaticGbeBackup({
                        appid,
                        gameDir,
                        steamSettings: game?.steamSettings,
                      });
                      const preFixBackupNote = preFixBackup && preFixBackup.backupDir
                        ? fr
                          ? `\n\nSauvegarde avant fix:\n${preFixBackup.backupDir}`
                          : `\n\nBackup before fix:\n${preFixBackup.backupDir}`
                        : fr
                          ? '\n\nSauvegarde avant fix: aucun steam_settings / steam_api existant.'
                          : '\n\nBackup before fix: no existing steam_settings / steam_api found.';

                      // 1b — Community CrakFiles fix FIRST, same as the per-scan auto-apply
                      // (achievements.js autoApplyEmulatorFix STEP 1). On a CONFIDENT name match with an
                      // auto-installable (pixeldrain) fix, apply the crack before the emulator so the GBE
                      // steam_api installed on top makes achievements work — and a cracked runtime makes
                      // the Steamless/SteamStub step below unnecessary. Idempotent + confident-only, so it's
                      // a silent no-op for games not in the list. Overwritten files are backed up under
                      // <gameDir>/.aw-crackfix-backups/. Opt out with emulator.autoApplyCrackFix=false.
                      let crackApplied = false;
                      let crackNote = '';
                      if ((app.config?.emulator || {}).autoApplyCrackFix !== false) {
                        try {
                          const crackFix = require(path.join(appPath, 'parser/crackFix.js'));
                          let arch = null;
                          let exe0 = null;
                          try {
                            const pe = require(path.join(appPath, 'util/pe.js'));
                            const emu0 = goldberg.detectEmulator(gameDir);
                            exe0 = exeDetect.detect(gameDir, game?.name || '', { dllPaths: emu0.dll });
                            if (exe0 && exe0.full) arch = pe.exeArch(exe0.full);
                          } catch {}
                          const gameNameCandidates = [game?.name, path.basename(gameDir || ''), path.basename((exe0 && (exe0.full || exe0.name)) || '').replace(/\.exe$/i, '')].filter(Boolean);
                          setGameBoxBusy(self, fr ? 'Recherche d’un crack communautaire…' : 'Checking community crack…');
                          const cf = await crackFix.applyBestFix({
                            cacheDir: path.join(getUserDataPath(), 'cache/crackfiles'),
                            gameName: game?.name || '',
                            gameNames: gameNameCandidates,
                            gameDir,
                            arch,
                            proxyFallback: (app.config?.emulator || {}).pixeldrainProxyFallback !== false,
                            log: debug,
                          });
                          if (cf && cf.applied) {
                            crackApplied = true;
                            crackNote = fr
                              ? `\nCrack communautaire : « ${cf.entry?.name} » appliqué (${(cf.files || []).length} fichier(s))`
                              : `\nCommunity crack: "${cf.entry?.name}" applied (${(cf.files || []).length} file(s))`;
                            debug.log(`[${appid}] CrakFiles (manual emu fix): applied "${cf.entry?.name}" via "${cf.matchedName || game?.name}" (${(cf.files || []).length} file(s))`);
                          } else if (cf && cf.skipped && cf.reason === 'already-applied') {
                            crackApplied = true;
                            crackNote = fr
                              ? `\nCrack communautaire : « ${cf.entry?.name} » déjà appliqué`
                              : `\nCommunity crack: "${cf.entry?.name}" already applied`;
                            debug.log(`[${appid}] CrakFiles (manual emu fix): already applied "${cf.entry?.name}" via "${cf.matchedName || game?.name}"`);
                          } else if (cf && cf.reason === 'pixeldrain-unavailable') {
                            // A crack matched but pixeldrain rate-limited it (captcha/paid) — can't be
                            // auto-fetched. Note it so the user knows to grab it manually; the emulator
                            // install still proceeds below.
                            crackNote = fr
                              ? `\nCrack communautaire trouvé mais limité par pixeldrain (captcha requis) — à télécharger à la main : ${cf.href || ''}`
                              : `\nCommunity crack found but pixeldrain-rate-limited (captcha required) — download it manually: ${cf.href || ''}`;
                            debug.log(`[${appid}] CrakFiles (manual emu fix): pixeldrain-unavailable (${cf.availability}) ${cf.href || ''}`);
                          } else {
                            debug.log(`[${appid}] CrakFiles (manual emu fix): nothing applied (${cf && cf.reason})`);
                          }
                        } catch (e) {
                          debug.log(`[${appid}] CrakFiles (manual emu fix) failed => ${formatErr(e)}`);
                        }
                      }

                      // 1b — if we still don't have a real Steam appid (unconfigured game, no
                      // steam_appid.txt), resolve it interactively with the fuzzy name search and write
                      // it via repair below. Skipped silently when the name yields no candidates.
                      if (!writableAppid && game?.name) {
                        const candidates = await steamParser.findAppidCandidatesByName(game.name, 3);
                        if (candidates.length > 0) {
                          const labels = candidates.map((c) => `${c.name} (${c.appid})`);
                          const pick = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                            type: 'question',
                            title: fr ? "Identifier le jeu (AppID Steam)" : 'Identify the game (Steam AppID)',
                            message: fr ? `Quel jeu est « ${game.name} » ?` : `Which game is "${game.name}"?`,
                            detail: fr
                              ? 'Choisis la correspondance pour écrire le bon steam_appid.txt (succès + DLC corrects), ou ignore.'
                              : 'Pick the match to write the correct steam_appid.txt (correct achievements + DLCs), or skip.',
                            buttons: [...labels, fr ? 'Ignorer' : 'Skip'],
                            defaultId: 0,
                            cancelId: labels.length,
                            noLink: true,
                          });
                          if (pick.response < candidates.length) writableAppid = candidates[pick.response].appid;
                        }
                      }

                      // 2 — detect where the dll currently lives. Both arches are handled: an existing
                      // steam_api.dll and/or steam_api64.dll is replaced in place; a folder with
                      // neither (fresh manual install) gets a 64-bit dll by default.
                      setGameBoxBusy(self, fr ? 'Préparation…' : 'Preparing…');
                      const emu = goldberg.detectEmulator(gameDir);
                      const detectedRuntimeExe = exeDetect.detect(gameDir, game?.name || '', { dllPaths: emu.dll });
                      const dllDirs = gbeInstaller.runtimeDllDirs({
                        gameDir,
                        dllPaths: emu.dll,
                        exePath: detectedRuntimeExe && detectedRuntimeExe.full,
                        steamSettings: emu.steamSettings,
                        fallbackDir: gameDir,
                      });

                      // Emulator setup is driven by the Settings → Emulator section: Regular DLL setup,
                      // optional Steamless pre-unpack, and whether to re-check GitHub for a newer GBE build.
                      const emuCfg = app.config?.emulator || {};
                      const forceUpdate = emuCfg.checkUpdates !== false;

                      // Advanced steam_settings: shell out to generate_emu_config for deeper
                      // coverage (depots, languages, stats, branches), merged into the game's
                      // steam_settings without clobbering AW's own achievements.json/configs. Optional
                      // Steam login (THROWAWAY account) pulls data Steam hides anonymously; the Steam
                      // Guard prompt is forwarded to the in-app text prompt. Returns a one-line note.
                      const runAdvanced = async (steamSettingsDirs) => {
                        if (emuCfg.steamSettingsMode !== 'advanced') return '';
                        if (!/^[0-9]+$/.test(String(writableAppid || ''))) return '\nAdvanced data: skipped (no numeric AppID)';
                        let login = null;
                        if (emuCfg.login === 'steam') {
                          // Prefer the credentials saved in Settings → Emulator; only prompt for what's missing.
                          let user = emuCfg.loginAccountName;
                          let pass = emuCfg.loginPassword;
                          if (!user)
                            user = await promptText(
                              fr ? 'Identifiant Steam (COMPTE JETABLE uniquement) :' : 'Steam username (THROWAWAY account only):',
                              ''
                            );
                          if (!user) return '\nAdvanced data: login cancelled';
                          if (!pass) pass = await promptText(fr ? 'Mot de passe Steam :' : 'Steam password:', '', 'password');
                          if (!pass) return '\nAdvanced data: login cancelled';
                          login = { username: user, password: pass };
                        }
                        try {
                          setGameBoxBusy(self, fr ? 'Données avancées (generate_emu_config)…' : 'Advanced data (generate_emu_config)…');
                          const genEmu = require(path.join(appPath, 'parser/genEmuConfig.js'));
                          const tool = await genEmu.ensureGenerateEmuConfig({
                            cacheDir: path.join(getUserDataPath(), 'cache/gse_emu_config'),
                            preferredTag: dlls && dlls.tag ? dlls.tag : null,
                            log: debug,
                          });
                          const onPrompt = (q) => promptText(`generate_emu_config — ${q}`);
                          const res = await genEmu.generate({ tool, appid: writableAppid, login, onPrompt, log: debug });
                          let added = 0;
                          for (const dir of steamSettingsDirs) added += genEmu.mergeIntoGame(res.steamSettings, dir).length;
                          try {
                            fs.rmSync(res.workDir, { recursive: true, force: true });
                          } catch {}
                          return `\nAdvanced data: merged ${added} extra file(s) (generate_emu_config ${tool.tag || ''})`;
                        } catch (e) {
                          return `\nAdvanced data: ${e.message || e}`;
                        }
                      };

                      let drmNote = '';

                      // SteamStub: strip it with Steamless so the plain DLL works (the SteamAutoCrack
                      // way). There is no ColdClient fallback — if Steamless can't strip a detected stub
                      // the plain DLL is still installed and the game may fail to launch.
                      try {
                        const pe = require(path.join(appPath, 'util/pe.js'));
                        // Skip DRM stripping when the community crack already replaced the runtime — a
                        // cracked exe is DRM-free, same call the auto flow makes.
                        const hasSteamStub = !crackApplied && !!(detectedRuntimeExe && detectedRuntimeExe.full && pe.detectSteamStub(detectedRuntimeExe.full));
                        const shouldRunSteamless = !crackApplied && !!(detectedRuntimeExe && detectedRuntimeExe.full && (emuCfg.steamlessAutoUnpack || hasSteamStub));
                        if (shouldRunSteamless) {
                          setGameBoxBusy(self, fr ? 'Téléchargement de Steamless…' : 'Downloading Steamless…');
                          const steamlessMod = require(path.join(appPath, 'parser/steamless.js'));
                          let stripped = false;
                          let reason = '';
                          try {
                            const cli = await steamlessMod.ensureSteamless({ cacheDir: path.join(getUserDataPath(), 'cache/steamless'), log: debug });
                            setGameBoxBusy(self, fr ? 'Retrait du DRM…' : 'Removing DRM…');
                            const r = await steamlessMod.stripDrm({ steamless: cli, exePath: detectedRuntimeExe.full, experimental: !!emuCfg.steamlessExperimental, log: debug });
                            stripped = !!(r && r.stripped);
                            reason = (r && r.reason) || '';
                          } catch (e) {
                            reason = e.message || String(e);
                            debug.log(`[${appid}] Steamless failed => ${e}`);
                          }
                          if (stripped) {
                            drmNote = fr ? `\nDRM : SteamStub retiré (${path.basename(detectedRuntimeExe.full)})` : `\nDRM: SteamStub removed (${path.basename(detectedRuntimeExe.full)})`;
                          } else if (hasSteamStub) {
                            drmNote = fr ? `\nDRM : SteamStub présent, Steamless a échoué (${reason}) ; la DLL seule risque de ne pas charger` : `\nDRM: SteamStub present, Steamless failed (${reason}); the plain DLL may not load`;
                          } else if (emuCfg.steamlessAutoUnpack) {
                            drmNote = fr ? `\nDRM : ${reason === 'no-steamstub' ? 'pas de SteamStub' : reason}` : `\nDRM: ${reason === 'no-steamstub' ? 'no SteamStub' : reason}`;
                          }
                        }
                      } catch (e) {
                        debug.log(`[${appid}] DRM auto-detect skipped => ${e}`);
                      }

                      // Download/cache the GBE Fork build (steam_api DLLs).
                      setGameBoxBusy(self, fr ? 'Téléchargement de GBE Fork…' : 'Downloading GBE Fork…');
                      const cacheDir = path.join(getUserDataPath(), 'cache/gse_fork');
                      const dlls = await gbeInstaller.ensureEmulatorDlls({ cacheDir, force: forceUpdate, log: debug });

                      // GBE/GSE setup requires steam_interfaces.txt generated from the
                      // original game steam_api DLL. Run the matching bundled tool before replacing
                      // anything; on a repeated repair generateInterfaces prefers the original .bak.
                      const runtimeDirKeys = new Set(dllDirs.map((dir) => path.resolve(dir).toLowerCase()));
                      const interfaceDlls = emu.dll.filter(
                        (file) => /^steam_api(64)?\.dll$/i.test(path.basename(file)) && runtimeDirKeys.has(path.resolve(path.dirname(file)).toLowerCase())
                      );
                      for (const dllPath of interfaceDlls) {
                        const dest = path.join(path.dirname(dllPath), 'steam_settings');
                        const interfaces = await gbeInstaller.generateInterfaces({ dllPath, steamSettings: dest, dlls, log: debug });
                        if (!interfaces.generated) debug.log(`[${writableAppid}] steam_interfaces.txt skipped (${interfaces.reason})`);
                      }

                      {
                        // ── Standalone (replace steam_api dll) — the only emulator-apply path ──
                        setGameBoxBusy(self, fr ? 'Installation de la DLL…' : 'Installing the DLL…');
                        const pe = require(path.join(appPath, 'util/pe.js'));
                        const missingArch = detectedRuntimeExe && detectedRuntimeExe.full ? pe.exeArch(detectedRuntimeExe.full) : 'x64';
                        const installResult = gbeInstaller.installDlls({
                          dllDirs,
                          dlls,
                          writeIfMissing: missingArch || 'x64',
                          log: debug,
                        });
                        // Pre-create both GBE Fork and classic Goldberg runtime folders. PSPC/repack
                        // guides mention both, and discovery dedupes them by appid once real state exists.
                        try {
                          if (process.env.APPDATA) {
                            fs.mkdirSync(path.join(process.env.APPDATA, 'GSE Saves', String(writableAppid)), { recursive: true });
                            fs.mkdirSync(path.join(process.env.APPDATA, 'Goldberg SteamEmu Saves', String(writableAppid)), { recursive: true });
                          }
                        } catch (e) {
                          debug.log(`[${writableAppid}] could not pre-create Goldberg/GBE save folder => ${e}`);
                        }
                        // Optional, opt-in: SteamAutoCrack's Steam API ownership-check bypass (proxy DLL).
                        if (emuCfg.apiCheckBypass && detectedRuntimeExe && detectedRuntimeExe.full) {
                          try {
                            const apiCheckBypass = require(path.join(appPath, 'parser/apiCheckBypass.js'));
                            setGameBoxBusy(self, fr ? 'Contournement du contrôle API Steam…' : 'Steam API check bypass…');
                            const bypassDlls = await apiCheckBypass.ensureBypassDlls({ cacheDir: path.join(getUserDataPath(), 'cache/api_check_bypass'), log: debug });
                            const rb = apiCheckBypass.applyBypass({ gameDir, exePath: detectedRuntimeExe.full, dlls: bypassDlls, log: debug });
                            debug.log(`[${writableAppid}] Steam API check bypass: ${rb.applied ? `applied (${rb.dll})` : `skipped (${rb.reason})`}`);
                          } catch (e) {
                            debug.log(`[${writableAppid}] Steam API check bypass failed => ${e}`);
                          }
                        }
                        setGameBoxBusy(self, fr ? 'Configuration (succès + DLC)…' : 'Configuring (achievements + DLCs)…');
                        let repairedDirs = 0;
                        const diagnosisLines = [];
                        const repairErrors = [];
                        for (const dir of dllDirs) {
                          const result = await diagnoseGoldbergSetup({ game, gameDir: dir, autoRepair: true, showDialog: false });
                          if (result.repaired) repairedDirs++;
                          if (result.repairError) repairErrors.push(`${dir}: ${result.repairError.message || result.repairError}`);
                          diagnosisLines.push(`${dir}: ${result.report.ok ? 'ok' : 'needs attention'}`);
                        }
                        const regAdvNote = await runAdvanced(dllDirs.map((d) => path.join(d, 'steam_settings')));
                        const installedDlls = [...new Set(installResult.perDir.flatMap((d) => d.wrote))].join(', ') || 'steam_api64.dll';
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'info',
                          title: 'GBE Fork installed',
                          message: `${installedDlls} installed to ${installResult.installed} location(s)`,
                          detail:
                            dllDirs.join('\n') +
                            `\n\nVersion: ${dlls.tag || 'unknown'}` +
                            (installResult.backedUp > 0 ? `\nExisting dll(s) backed up as *.bak in ${installResult.backedUp} location(s)` : '') +
                            preFixBackupNote +
                            crackNote +
                            drmNote +
                            `\n\nDiagnostic after install:\n${diagnosisLines.join('\n')}` +
                            (repairedDirs > 0 ? `\n\nAuto-repaired steam_settings (schema + icons + DLCs) in ${repairedDirs} location(s)` : '') +
                            (repairErrors.length > 0 ? `\nAuto-repair failed for: ${repairErrors.join('; ')}` : '') +
                            regAdvNote,
                          noLink: true,
                        });
                      }
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: 'GBE Fork install failed',
                        message: 'Could not download or install GBE Fork.',
                        detail: formatErr(err),
                      });
                    } finally {
                      clearGameBoxBusy(self);
                    }
                  },
                })
              );

              // Remove Steam DRM (SteamStub) from the game's main exe via atom0s/Steamless — the same
              // tool ARMGDDN Autocracker bundles. A no-op when the exe has no stub; the original is kept
              // as <exe>.steamstub.bak. Manual-only since it rewrites the game binary.
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/file-text.png')),
                  label: $('#game-list').attr('data-ctx-removedrm') || 'Remove Steam DRM (Steamless)…',
                  async click() {
                    const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                    try {
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: fr ? "Choisir le dossier d'installation du jeu" : "Select the game's install folder",
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }

                      // Detect the main game exe (name-aware); let the user override the guess.
                      const emu = goldberg.detectEmulator(gameDir);
                      const detected = exeDetect.detect(gameDir, game?.name || '', { dllPaths: emu.dll });
                      let exePath = detected && detected.full ? detected.full : null;

                      const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                        type: 'question',
                        title: fr ? 'Retirer le DRM Steam (Steamless)' : 'Remove Steam DRM (Steamless)',
                        message: exePath
                          ? fr
                            ? `Retirer le SteamStub de : ${path.basename(exePath)} ?`
                            : `Remove SteamStub from: ${path.basename(exePath)}?`
                          : fr
                          ? 'Aucun exe détecté — en choisir un ?'
                          : 'No exe detected — choose one?',
                        detail: fr
                          ? "Modifie l'exécutable du jeu (l'original est conservé en .steamstub.bak). Sans effet si le jeu n'a pas de DRM SteamStub."
                          : 'Modifies the game executable (the original is kept as .steamstub.bak). No effect if the game has no SteamStub DRM.',
                        buttons: fr ? ['Annuler', 'Choisir un .exe…', 'Retirer le DRM'] : ['Cancel', 'Choose an .exe…', 'Remove DRM'],
                        defaultId: exePath ? 2 : 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm.response === 0) return;
                      if (confirm.response === 1) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: fr ? "Choisir l'exécutable du jeu" : 'Select the game executable',
                          defaultPath: gameDir,
                          filters: [{ name: 'Executable', extensions: ['exe'] }],
                          properties: ['openFile', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        exePath = picked.filePaths[0];
                      }
                      if (!exePath) return;

                      setGameBoxBusy(self, fr ? 'Téléchargement de Steamless…' : 'Downloading Steamless…');
                      const steamlessMod = require(path.join(appPath, 'parser/steamless.js'));
                      const cli = await steamlessMod.ensureSteamless({ cacheDir: path.join(getUserDataPath(), 'cache/steamless'), log: debug });
                      setGameBoxBusy(self, fr ? 'Retrait du DRM…' : 'Removing DRM…');
                      const result = await steamlessMod.stripDrm({ steamless: cli, exePath, log: debug });

                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: result.stripped ? 'info' : 'warning',
                        title: 'Steamless',
                        message: result.stripped
                          ? fr
                            ? 'DRM SteamStub retiré.'
                            : 'SteamStub DRM removed.'
                          : result.reason === 'no-steamstub'
                          ? fr
                            ? 'Aucun DRM SteamStub détecté — exe inchangé.'
                            : 'No SteamStub DRM detected — exe left unchanged.'
                          : fr
                          ? 'Échec du retrait du DRM.'
                          : 'DRM removal failed.',
                        detail:
                          path.basename(exePath) +
                          (result.stripped ? `\n${fr ? 'Original conservé :' : 'Original kept as:'} ${path.basename(result.backup)}` : '') +
                          (result.reason && result.reason !== 'no-steamstub' && result.reason !== 'unpacked' ? `\n${result.reason}` : '') +
                          `\n\nSteamless ${cli.tag || ''}`,
                        noLink: true,
                      });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: fr ? 'Échec de Steamless' : 'Steamless failed',
                        message: fr ? 'Impossible de retirer le DRM Steam.' : 'Could not remove the Steam DRM.',
                        detail: `${err}`,
                      });
                    } finally {
                      clearGameBoxBusy(self);
                    }
                  },
                })
              );

              // Community "Fixes & Bypasses" from the CrakFiles list — a SEPARATE launch helper. These
              // can overwrite game files (incl. steam_api), so it warns that achievement detection runs
              // through the emulator and the emulator fix may need re-applying. Overwritten files are
              // backed up under <gameDir>/.aw-crackfix-backups/.
              emulatorMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/file-text.png')),
                  label: $('#game-list').attr('data-ctx-crackfix') || 'Community fix (CrakFiles)…',
                  async click() {
                    const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
                    // Hoisted so the catch's "pixeldrain captcha → apply a manually-downloaded file" flow
                    // can reach the resolved game / fix / install dir.
                    let game = null;
                    let top = null;
                    let fix = null;
                    let gameDir = null;
                    const crackFix = require(path.join(appPath, 'parser/crackFix.js'));
                    try {
                      game = list.find((g) => g.appid == appid);
                      if (!game?.name) {
                        remote.dialog.showMessageBoxSync({ type: 'info', title: 'CrakFiles', message: fr ? 'Nom de jeu inconnu.' : 'Unknown game name.' });
                        return;
                      }
                      const cacheDir = path.join(getUserDataPath(), 'cache/crackfiles');
                      setGameBoxBusy(self, fr ? 'Recherche de fixes…' : 'Searching fixes…');
                      const cfList = await crackFix.fetchList({ cacheDir, log: debug });
                      clearGameBoxBusy(self);
                      const matches = crackFix.findFixes(cfList, game.name, { limit: 5 });
                      if (matches.length === 0) {
                        const c = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'info',
                          title: 'CrakFiles',
                          message: fr ? `Aucun fix trouvé pour « ${game.name} ».` : `No fix found for "${game.name}".`,
                          detail: fr ? 'La liste CrakFiles est communautaire et limitée.' : 'The CrakFiles list is community-maintained and limited.',
                          buttons: ['OK', fr ? 'Ouvrir CrakFiles' : 'Open CrakFiles'],
                          defaultId: 0,
                          cancelId: 0,
                          noLink: true,
                        });
                        if (c === 1) remote.shell.openExternal('https://github.com/KoriaPolis/CrakFiles');
                        return;
                      }
                      top = matches[0];
                      // Pick the best fix instead of blindly the first listed: prefer an auto-installable
                      // (pixeldrain) link and the build matching the game's architecture when detectable.
                      let arch = null;
                      try {
                        if (game.gameDir && fs.existsSync(game.gameDir)) {
                          const pe = require(path.join(appPath, 'util/pe.js'));
                          const emu0 = goldberg.detectEmulator(game.gameDir);
                          const exe0 = exeDetect.detect(game.gameDir, game.name || '', { dllPaths: emu0.dll });
                          if (exe0 && exe0.full) arch = pe.exeArch(exe0.full);
                        }
                      } catch {}
                      fix = crackFix.pickBestFix(top, { arch }) || (top.fixes && top.fixes[0]) || {};
                      const badges = (fix.badges || []).join(', ');
                      const choice = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                        type: 'warning',
                        title: 'CrakFiles',
                        message: fr ? `Fix trouvé : ${top.name}` : `Fix found: ${top.name}`,
                        detail:
                          (fix.filename ? `${fix.filename}${badges ? ` [${badges}]` : ''}\n` : '') +
                          (fr
                            ? "\n⚠ Un crack communautaire peut écraser des fichiers du jeu (dont steam_api(64).dll). La détection des succès passe par l'émulateur — si le crack remplace steam_api, relance « Appliquer le fix émulateur » après. Les fichiers écrasés sont sauvegardés."
                            : '\n⚠ A community crack may overwrite game files (incl. steam_api(64).dll). Achievement detection runs through the emulator — if the crack replaces steam_api, re-run "Apply emulator fix" afterwards. Overwritten files are backed up.'),
                        // NB: Windows treats `&` in a button label as the Alt-mnemonic marker and hides
                        // it ("Download  apply"); double it so a literal ampersand shows.
                        buttons: fr
                          ? ['Annuler', 'Ouvrir la page de téléchargement', 'Ouvrir la source', 'Télécharger && appliquer']
                          : ['Cancel', 'Open download page', 'Open source', 'Download && apply'],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (choice.response === 0) return;
                      if (choice.response === 1) {
                        if (fix.href) remote.shell.openExternal(fix.href);
                        return;
                      }
                      if (choice.response === 2) {
                        const src = (top.source_crack || [])[0];
                        if (src) remote.shell.openExternal(src);
                        return;
                      }
                      // Download & apply
                      gameDir = game.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: fr ? "Dossier d'installation du jeu" : "Game install folder",
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }
                      if (!crackFix.pixeldrainDirectUrl(fix.href)) {
                        const c = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'info',
                          title: 'CrakFiles',
                          message: fr ? 'Ce lien ne peut pas être appliqué automatiquement.' : 'This link cannot be applied automatically.',
                          detail: fr ? 'Ouvre la page de téléchargement et applique-le manuellement.' : 'Open the download page and apply it manually.',
                          buttons: ['OK', fr ? 'Ouvrir' : 'Open'],
                          defaultId: 1,
                          cancelId: 0,
                          noLink: true,
                        });
                        if (c === 1 && fix.href) remote.shell.openExternal(fix.href);
                        return;
                      }
                      setGameBoxBusy(self, fr ? 'Téléchargement du fix…' : 'Downloading fix…');
                      const res = await crackFix.downloadAndApply({ fix, gameDir, cacheDir, entryName: top.name, proxyFallback: (app.config?.emulator || {}).pixeldrainProxyFallback !== false, log: debug });
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: 'CrakFiles',
                        message: fr ? `${res.applied.length} fichier(s) appliqué(s).` : `Applied ${res.applied.length} file(s).`,
                        detail:
                          gameDir +
                          (res.backupDir ? `\n${fr ? 'Sauvegarde :' : 'Backup:'} ${res.backupDir}` : '') +
                          (fr
                            ? '\n\nSi steam_api a été remplacé, relance « Appliquer le fix émulateur » pour garder la détection des succès.'
                            : '\n\nIf steam_api was replaced, re-run "Apply emulator fix" to keep achievement detection.'),
                        noLink: true,
                      });
                    } catch (err) {
                      // Pixeldrain rate-limits popular files (403): they can't be auto-downloaded, only
                      // fetched through a browser (captcha). Rather than a dead end, walk the user through
                      // downloading it themselves and then hand the file to AW to extract + apply.
                      if (err && err.code === 'PIXELDRAIN_UNAVAILABLE') {
                        const href = err.href || fix?.href;
                        const choice = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                          type: 'warning',
                          title: 'CrakFiles',
                          message: fr ? 'Captcha pixeldrain requis pour ce fichier.' : 'Pixeldrain captcha required for this file.',
                          detail:
                            (fr
                              ? "Pixeldrain limite ce fichier (trop de téléchargements) : il faut résoudre un captcha dans le navigateur.\n\n1) Ouvre la page et télécharge le .rar.\n2) Reviens et sélectionne le fichier téléchargé — AW l'extraira et l'appliquera automatiquement (les fichiers écrasés sont sauvegardés)."
                              : "Pixeldrain rate-limited this file (too many downloads): you must solve a captcha in the browser.\n\n1) Open the page and download the .rar.\n2) Come back and select the downloaded file — AW will extract and apply it automatically (overwritten files are backed up)."),
                          buttons: fr
                            ? ['Annuler', 'Ouvrir la page', 'Sélectionner le fichier téléchargé…']
                            : ['Cancel', 'Open page', 'Select downloaded file…'],
                          defaultId: 1,
                          cancelId: 0,
                          noLink: true,
                        });
                        if (choice.response === 0) return;
                        if (choice.response === 1) {
                          if (href) remote.shell.openExternal(href);
                          // Wait (non-blocking modal) for the user to finish the browser download, then let
                          // them pick the file. Cancelling here just leaves the page open.
                          const after = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                            type: 'info',
                            title: 'CrakFiles',
                            message: fr ? 'Une fois le téléchargement terminé…' : 'Once the download is finished…',
                            detail: fr
                              ? 'Sélectionne le fichier téléchargé (.rar/.zip/.7z) pour l’appliquer.'
                              : 'Select the downloaded file (.rar/.zip/.7z) to apply it.',
                            buttons: fr ? ['Annuler', 'Sélectionner le fichier…'] : ['Cancel', 'Select file…'],
                            defaultId: 1,
                            cancelId: 0,
                            noLink: true,
                          });
                          if (after.response !== 1) return;
                        }
                        // Pick + apply the locally-downloaded archive.
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: fr ? 'Sélectionne le crack téléchargé' : 'Select the downloaded crack',
                          properties: ['openFile', 'dontAddToRecent'],
                          filters: [
                            { name: fr ? 'Archives' : 'Archives', extensions: ['rar', 'zip', '7z'] },
                            { name: fr ? 'Tous les fichiers' : 'All files', extensions: ['*'] },
                          ],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        // Resolve the install folder (the try-scoped one may be unset if we failed early).
                        let applyDir = (gameDir && fs.existsSync(gameDir) && gameDir) ||
                          (game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null);
                        if (!applyDir) {
                          const pd = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                            title: fr ? "Dossier d'installation du jeu" : 'Game install folder',
                            properties: ['openDirectory', 'dontAddToRecent'],
                          });
                          if (pd.canceled || !pd.filePaths || pd.filePaths.length === 0) return;
                          applyDir = pd.filePaths[0];
                        }
                        try {
                          setGameBoxBusy(self, fr ? 'Application du fichier…' : 'Applying file…');
                          const res = await crackFix.applyLocalArchive({
                            archivePath: picked.filePaths[0],
                            gameDir: applyDir,
                            fix: fix && fix.href ? fix : null,
                            entryName: top?.name || '',
                            log: debug,
                          });
                          clearGameBoxBusy(self);
                          remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                            type: 'info',
                            title: 'CrakFiles',
                            message: fr ? `${res.applied.length} fichier(s) appliqué(s).` : `Applied ${res.applied.length} file(s).`,
                            detail:
                              applyDir +
                              (res.backupDir ? `\n${fr ? 'Sauvegarde :' : 'Backup:'} ${res.backupDir}` : '') +
                              (fr
                                ? '\n\nSi steam_api a été remplacé, relance « Appliquer le fix émulateur » pour garder la détection des succès.'
                                : '\n\nIf steam_api was replaced, re-run "Apply emulator fix" to keep achievement detection.'),
                            noLink: true,
                          });
                        } catch (e2) {
                          remote.dialog.showMessageBoxSync({ type: 'error', title: 'CrakFiles', message: fr ? 'Échec de l’application.' : 'Apply failed.', detail: formatErr(e2) });
                        }
                      } else {
                        remote.dialog.showMessageBoxSync({ type: 'error', title: 'CrakFiles', message: fr ? 'Échec.' : 'Failed.', detail: formatErr(err) });
                      }
                    } finally {
                      clearGameBoxBusy(self);
                    }
                  },
                })
              );
            }

            folderMenu.append(
              new MenuItem({
                icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/folder-open.png')),
                label: $('#game-list').attr('data-ctx-iconcache') || `Open the game's icon cache folder`,
                click() {
                  remote.shell.openPath(path.join(process.env['APPDATA'], 'Achievement Watcher', 'steam_cache', 'icon', `${appid}`));
                },
              })
            );
            folderMenu.append(
              new MenuItem({
                icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/folder-open.png')),
                label: $('#game-list').attr('data-ctx-dbcache') || `Open the game's .db cache folder`,
                click() {
                  remote.shell.showItemInFolder(
                    path.join(process.env['APPDATA'], 'Achievement Watcher', 'steam_cache', 'schema', `${app.config.achievement.lang}`, `${appid}.db`)
                  );
                },
              })
            );

            // Open the actual game install folder, when AW managed to resolve one (Goldberg/GBE scan
            // or name-based folder match).
            const gameForDir = list.find((g) => g.appid == appid);
            if (gameForDir?.gameDir && fs.existsSync(gameForDir.gameDir)) {
              folderMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/folder-open.png')),
                  label: $('#game-list').attr('data-ctx-installloc') || `Open the game's install location`,
                  click() {
                    remote.shell.openPath(gameForDir.gameDir);
                  },
                })
              );
            }

            // Steam/SteamDB/PCGamingWiki links rely on `appid` being a real Steam appid. "Unconfigured"
            // entries use a synthetic "local-<hash>" id (no confirmed Steam catalog match), so these
            // links would 404/error — hide them for exe-detected-only games.
            if (gameSource !== 'Unconfigured') {
              linkMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/globe.png')),
                  label: 'Steam',
                  click() {
                    remote.shell.openExternal(`https://store.steampowered.com/app/${appid}/`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/globe.png')),
                  label: 'SteamDB',
                  click() {
                    remote.shell.openExternal(`https://steamdb.info/app/${appid}/`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/globe.png')),
                  label: 'PCGamingWiki',
                  click() {
                    remote.shell.openExternal(`https://pcgamingwiki.com/api/appid.php?appid=${appid}`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/globe.png')),
                  label: 'SteamHunters',
                  click() {
                    remote.shell.openExternal(`https://steamhunters.com/apps/${appid}/achievements`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: nativeImage.createFromPath(path.join(appPath, 'resources/img/globe.png')),
                  label: 'Steam Community',
                  click() {
                    remote.shell.openExternal(`https://steamcommunity.com/app/${appid}/guides/`);
                  },
                })
              );
            }
          }

          // Native Electron menu labels treat a lone "&" as an accelerator marker (swallowed at
          // render time), so a literal ampersand must be doubled ("&&"). Locale strings keep the
          // single "&" (they're also used in HTML); escape only here, at the native-menu boundary.
          const groupLabel = (attribute, fallback) => ($('#game-list').attr(attribute) || fallback).replace(/&/g, '&&');
          if (gameMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-game', 'Game'), submenu: gameMenu }));
          if (emulatorMenu.items.length)
            menu.append(new MenuItem({ label: groupLabel('data-ctx-group-emulator', 'Emulator & tools'), submenu: emulatorMenu }));
          if (folderMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-folders', 'Folders'), submenu: folderMenu }));
          if (linkMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-links', 'Useful links'), submenu: linkMenu }));

          // ---- Cover art management (re-download / alternate AppID / local image) ----
          const coverGame = list.find((g) => g.appid == appid);
          if (coverGame) {
            const coverCacheAppid = String(coverGame.steamappid || appid);
            const defaultCoverUrl = () => (coverGame.img && (coverGame.img.header || coverGame.img.landscape || coverGame.img.portrait)) || null;
            const refetchDefaultCover = async () => {
              if (EMU_LOCAL_ICON_SOURCES.has(coverGame.source)) {
                applyCoverBackground(appid, (coverGame.img && coverGame.img.header) || 'none');
                return;
              }
              const url = defaultCoverUrl();
              const local = url ? await ipcRenderer.invoke('fetch-icon', url, coverCacheAppid) : null;
              applyCoverBackground(appid, local || 'none');
            };

            const coverMenu = new Menu();
            coverMenu.append(
              new MenuItem({
                label: 'Re-download cover',
                async click() {
                  try {
                    coverStore.remove(appid);
                    reloadCoverOverrides();
                    // Purge the cached art so fetch-icon actually re-downloads instead of returning the stale file.
                    try {
                      for (const id of new Set([String(appid), coverCacheAppid])) {
                        fs.rmSync(path.join(getUserDataPath(), 'steam_cache', 'icon', id), { recursive: true, force: true });
                      }
                    } catch {}
                    await refetchDefaultCover();
                  } catch (err) {
                    debug.warn(`[cover] redownload failed => ${err}`);
                  }
                },
              })
            );
            coverMenu.append(
              new MenuItem({
                label: 'Use another Steam AppID…',
                async click() {
                  const alt = await promptText('Steam AppID to pull cover art from:', /^[0-9]+$/.test(String(appid)) ? String(appid) : '');
                  if (!alt || !/^[0-9]+$/.test(alt)) return;
                  let local = await ipcRenderer.invoke('fetch-icon', `https://cdn.cloudflare.steamstatic.com/steam/apps/${alt}/header.jpg`, appid);
                  if (!local)
                    local = await ipcRenderer.invoke('fetch-icon', `https://cdn.cloudflare.steamstatic.com/steam/apps/${alt}/library_600x900.jpg`, appid);
                  if (!local) {
                    remote.dialog.showMessageBox({ type: 'warning', message: `No Steam cover art found for AppID ${alt}.` });
                    return;
                  }
                  coverStore.set(appid, local);
                  reloadCoverOverrides();
                  applyCoverBackground(appid, local);
                },
              })
            );
            coverMenu.append(
              new MenuItem({
                label: 'Choose local image…',
                click() {
                  const files = remote.dialog.showOpenDialogSync({
                    title: 'Choose cover image',
                    properties: ['openFile'],
                    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
                  });
                  if (!files || !files[0]) return;
                  try {
                    const src = files[0];
                    const destDir = path.join(getUserDataPath(), 'covers');
                    fs.mkdirSync(destDir, { recursive: true });
                    const ext = path.extname(src) || '.png';
                    const dest = path.join(destDir, `${String(appid).replace(/[^\w.-]/g, '_')}${ext}`);
                    fs.copyFileSync(src, dest);
                    const url = pathToFileURL(dest).href;
                    coverStore.set(appid, url);
                    reloadCoverOverrides();
                    applyCoverBackground(appid, url);
                  } catch (err) {
                    debug.warn(`[cover] local image failed => ${err}`);
                    remote.dialog.showMessageBox({ type: 'error', message: `Could not set cover: ${err.message || err}` });
                  }
                },
              })
            );
            if (coverOverrideFor(appid)) {
              coverMenu.append(new MenuItem({ type: 'separator' }));
              coverMenu.append(
                new MenuItem({
                  label: 'Reset cover to default',
                  async click() {
                    coverStore.remove(appid);
                    reloadCoverOverrides();
                    await refetchDefaultCover();
                  },
                })
              );
            }
            menu.append(new MenuItem({ label: groupLabel('data-ctx-group-cover', 'Cover'), submenu: coverMenu }));
          }

          menu.popup({ window: remote.getCurrentWindow() });
        });

        if (self.args.appid)
          $(`#game-list .game-box[data-appid="${self.args.appid.toString().replace(/[^\d]/g, '')}"]`)
            .first()
            .trigger('click');
      })
      .catch((err) => {
        loadingElem.elem.hide();
        $('#main-footer').addClass('done');
        $('#game-list .isEmpty').show();
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: 'Unexpected Error',
          message: 'Game list generation failure',
          detail: `${err}`,
        });
      })
      .finally(() => {
        $('#user-info').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('#sort-box').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('#search-bar').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('title-bar')[0].inSettings = false;
      });
  },
  onGameBoxClick: function (self, list) {
    self.css('pointer-events', 'none');

    let game = list.find((elem) => elem.appid == self.data('appid') && list.indexOf(elem) == self.data('index'));

    // A list/DOM desync (stale index after a re-sort or removal) can leave no match; bail out instead
    // of dereferencing game.img below and throwing an uncaught error that strands the click.
    if (!game) {
      debug.warn(`onGameBoxClick: no game for appid=${self.data('appid')} index=${self.data('index')}`);
      self.css('pointer-events', 'initial');
      return;
    }

    if (self.data('time') > 0) $('#unlock > .header .sort-ach .sort.time').addClass('show');

    $('#search-bar-float input[type=search]').val('').blur().removeClass('has'); //reset

    $('#home').fadeOut(function () {
      $('body').fadeIn().css('background', `url('../resources/img/ach_background.jpg')`);
      if (game.img.background) {
        ipcRenderer.invoke('fetch-icon', game.img.background, game.steamappid || game.appid).then((localPath) => {
          if (game.system === 'uplay' || game.img?.overlay === true) {
            let gradient = `linear-gradient(to bottom right, rgba(0, 47, 75, .8), rgba(35, 54, 78, 0.9))`;
            $('body').fadeIn().attr('style', `background: ${gradient}, url('${localPath}')`);
          } else {
            $('body').fadeIn().css('background', `url('${localPath}')`);
          }
        });
      }

      // Mark which game the detail view is currently showing, so a live unlock toast only
      // refreshes this page when it belongs to the game on screen (see updateGamePage).
      $('#achievement .wrapper > .header').attr('data-appid', game.appid);

      if (game.system) {
        $('#achievement .wrapper > .header').attr('data-system', game.system);
      } else {
        $('#achievement .wrapper > .header').removeAttr('data-system');
      }

      if (game.img.icon) {
        const iconEl = $('#achievement .wrapper > .header .title .icon');
        iconEl.css('background', `url('${pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href}')`);
        ipcRenderer.invoke('fetch-icon', game.img.icon, game.steamappid || game.appid).then((localPath) => {
          if (localPath) iconEl.css('background', `url('${localPath}')`);
        });
      }

      $('#achievement .wrapper > .header .title span').text(game.name);
      // Never let the denominator fall below what's actually displayed: a desynced schema could leave
      // total at 0 for a completed game, rendering "39 / 0" and a NaN%/Infinity% percentage.
      const unlockedCount = Math.max(0, Math.floor(finiteNumber(game.achievement.unlocked, 0)));
      const counterMax = Math.max(Math.floor(finiteNumber(game.achievement.total, 0)), game.achievement.list.length, unlockedCount);
      $('#achievement .wrapper > .header .stats .counter')
        .attr('data-count', unlockedCount)
        .attr('data-max', counterMax)
        .attr('data-percent', percentFromProgress(unlockedCount, counterMax));

      if (game.system === 'playstation') {
        $('#achievement .wrapper > .header[data-system="playstation"] .trophy li.platinum span').text(
          game.achievement.list.filter((ach) => ach.Achieved && ach.type === 'P').length
        );
        $('#achievement .wrapper > .header[data-system="playstation"] .trophy li.gold span').text(
          game.achievement.list.filter((ach) => ach.Achieved && ach.type === 'G').length
        );
        $('#achievement .wrapper > .header[data-system="playstation"] .trophy li.silver span').text(
          game.achievement.list.filter((ach) => ach.Achieved && ach.type === 'S').length
        );
        $('#achievement .wrapper > .header[data-system="playstation"] .trophy li.bronze span').text(
          game.achievement.list.filter((ach) => ach.Achieved && ach.type === 'B').length
        );
      }

      $('#achievement .wrapper > .header .playtime').hide();
      $('#achievement .wrapper > .header .lastplayed').hide();
      if (game.system !== 'playstation' && game.system !== 'uplay') {
        PlaytimeTracking(game.appid)
          .then(({ playtime, lastplayed }) => {
            if (playtime > 0) {
              let humanized;
              if (playtime < 60) {
                humanized = moment.duration(playtime, 'seconds').humanize();
              } else if (playtime >= 86400) {
                humanized =
                  humanizeDuration(playtime * 1000, { language: moment.locale(), fallbacks: ['en'], units: ['h', 'm'], round: true }) +
                  ' (~ ' +
                  moment.duration(playtime, 'seconds').humanize() +
                  ')';
              } else {
                humanized = humanizeDuration(playtime * 1000, {
                  language: moment.locale(),
                  fallbacks: ['en'],
                  units: ['h', 'm'],
                  round: true,
                });
              }
              $('#achievement .wrapper > .header .playtime span').text(`${humanized}`);
              $('#achievement .wrapper > .header .playtime').css('display', 'inline-block');
            }

            if (lastplayed > 0) {
              $('#achievement .wrapper > .header .lastplayed span').text(`${moment.unix(lastplayed).format('ll')}`);
              $('#achievement .wrapper > .header .lastplayed').css('display', 'inline-block');
            }
          })
          .catch((err) => {
            debug.error(err);
          });
      }

      $('#achievement .sort-ach .sort').removeClass('active');
      let unlock = $('#unlock ul');
      let lock = $('#lock ul');
      unlock.empty();
      lock.empty();

      const hiddenDescLabel = $('#lock').data('lang-hiddenDesc') || 'Hidden description';

      let i = 0;
      for (let achievement of game.achievement.list) {
        const progress = getAchievementProgressState(achievement);
        const progressMax = progress.hasProgress ? progress.max : 0;
        const progressLabel = `${progress.current} / ${progress.max}`;

        // Hidden + still locked + "show hidden" off => mask the description inline. The real text is
        // stashed in data-desc and revealed in place on click (delegated handler below), instead of
        // being hidden away in a separate bottom "reveal all" section.
        const isHiddenMasked = achievement.hidden == 1 && !app.config.achievement.showHidden && !achievement.Achieved;
        const realDesc = achievement.description || '...';
        const descHtml = isHiddenMasked
          ? `<div class="description masked-desc" data-desc="${escapeHtml(realDesc)}">${escapeHtml(hiddenDescLabel)}</div>`
          : `<div class="description">${escapeHtml(realDesc)}</div>`;

        let template = `
                <li>

                         <div class="achievement" data-name="${escapeHtml(achievement.name)}" data-index="${i}">
                            <div class="box">
                              <div class="glow mask contain">
                                  <div class="glow mask ray ">
                                    <div class="glow fx"></div>
                                  </div>
                              </div>
                              <div class="icon" id="achievement-${String(achievement.name)
                                .replace(/\s+/g, '_')
                                .replace(/[^\w\-]/g, '')}" style="background: url('${
          pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href
        }');"></div>
                            </div>
                            <div class="content">
                                <div class="title">${
                                  game.system === 'playstation'
                                    ? `<i class="fas fa-trophy" data-type="${escapeHtml(achievement.type)}"></i> ${escapeHtml(achievement.displayName)}`
                                    : `${escapeHtml(achievement.displayName)}`
                                }</div>
                                ${descHtml}
                                <div class="progressBar" data-current="${progress.current}" data-max="${progressMax}" data-percent="${
          progress.percent
        }" data-label="${progressLabel}">
                                <span class="meter" style="width:${progress.hasProgress ? progress.percent : 0}%"></span></div>
                            </div>
                            <div class="stats">
                              <div class="time" data-time="${achievement.UnlockTime}"><i class="fas fa-clock"></i>
                                <span>${moment.unix(achievement.UnlockTime).format('L LT')}</span>
                                <span>${moment.unix(achievement.UnlockTime).fromNow()}</span>
                              </div>
                              <div class="community"><i class="fab fa-steam"></i> <span class="data">--</span>% ${$(
                                '#achievement .achievements'
                              ).data('lang-globalStat')}</div>
                            </div>
                        </div>

                </li>
                `;

        // Hidden achievements are no longer collected into a separate "reveal all" row — they render
        // inline in the locked list like any other (with their description masked, click to reveal).
        if (achievement.Achieved) {
          unlock.append(template);
        } else {
          lock.append(template);
        }
        i += 1;
      }

      function setAchievementImage(selector, imagePath) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            $(selector).css('background', `url(${imagePath})`);
            resolve();
          };
          img.onerror = () => {
            resolve();
          };
          img.src = imagePath;
        });
      }
      const imageCache = new Map(); // hash -> promise
      const preloadPromises = game.achievement.list.map(async (achievement) => {
        const hash = achievement.Achieved ? achievement.icon : achievement.icongray;
        let localPathPromise;
        if (!EMU_LOCAL_ICON_SOURCES.has(game.source)) {
          if (imageCache.has(hash)) {
            localPathPromise = imageCache.get(hash);
          } else {
            localPathPromise = ipcRenderer.invoke('fetch-icon', hash, game.steamappid || game.appid);
            imageCache.set(hash, localPathPromise);
          }
        }
        const localPath = EMU_LOCAL_ICON_SOURCES.has(game.source) ? hash : await localPathPromise;
        await setAchievementImage(
          `#achievement-${String(achievement.name)
            .replace(/\s+/g, '_')
            .replace(/[^\w\-]/g, '')}`,
          localPath
        );
      });

      if (typeof window.restoreAchievementSorts === 'function') window.restoreAchievementSorts();

      let count_unlocked = game.achievement.list.filter(
        (elem) => elem.Achieved
      ).length; /*can replace by value on header which were calculated parse etc already*/
      let count_locked = game.achievement.list.length - count_unlocked;

      $('#unlock .header .title').attr('data-count', count_unlocked);
      $('#lock .header .title').attr('data-count', count_locked);

      if (game.achievement.list.length === 0) {
        $('#unlock').hide();
        $('#lock').show();
        const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
        const title = fr ? 'Aucun succès Steam trouvé' : 'No Steam achievements found';
        const detail = game.unconfigured
          ? fr
            ? "Ce dossier n'a pas encore de configuration Goldberg/GBE avec un AppID Steam fiable."
            : 'This folder does not have a Goldberg/GBE setup with a reliable Steam AppID yet.'
          : fr
            ? "AW affiche le jeu, mais Steam ne fournit aucun schéma de succès pour cet AppID."
            : 'AW can show the game, but Steam did not provide an achievement schema for this AppID.';
        lock.append(`
              <li>
                <div class="notice empty-achievement-notice">
                  <p><i class="fas fa-trophy"></i> ${title}</p>
                  <p>${detail}</p>
                </div>
              </li>`);
      } else {
        $('#unlock').show();
      }

      if (game.achievement.list.length > 0 && count_unlocked == 0) {
        let template = `
              <li>
                <div class="notice">
                  <p>${$('#unlock').data('lang-noneUnlocked')} <i class="fas fa-frown-open"></i> ${$('#unlock').data('lang-play')}</p>
                  <p>⚠️ ${$('#unlock').data('lang-noneUnlockedHint')} <a href="https://github.com/xan105/Achievement-Watcher/wiki" target="_blank">Wiki ↗</a></p>
                  </div>
              </li>`;
        unlock.append(template);
      }

      if (game.achievement.list.length > 0 && count_locked == 0) {
        $('#lock').hide();
      } else {
        $('#lock').show();
      }

      let elem = $('#achievement .achievement-list ul > li');
      elem.removeClass('highlight');

      if (game.system) {
        $('.achievement .stats .community').hide();
      } else {
        $('.achievement .stats .community').show();
        getGlobalStat(
          game.source === 'epic' && game.steamappid ? game.steamappid : self.data('appid'),
          game.source === 'epic' ? (game.steamappid ? 'steam' : 'epic') : 'steam'
        );
      }

      $('#achievement').fadeIn(600, function () {
        if (app.args.appid && app.args.name) {
          let target = elem.find(`.achievement[data-name="${app.args.name.toString().replace(/<\/?[^>]+>/gi, '')}"]`).parent('li');
          target.addClass('highlight');

          let pos = target.offset().top + $(this).scrollTop() - target.outerHeight(true);

          $(this).animate(
            {
              scrollTop: pos,
            },
            250,
            'swing'
          );
        }

        self.css('pointer-events', 'initial');
      });
    });
  },
  onPlayButtonClick: async function (self) {
    let appid = self.closest('.game-box').data('appid');
    let cfg = await exeList.get(appid);
    if (!cfg?.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) {
      const game = gameList.find((g) => g.appid == appid);
      let detected = autodetectGameExe(game?.gameDir, game?.name, await takenExePaths(appid));
      if (detected) {
        cfg.exe = detected;
        await exeList.add(cfg);
      }
    }
    if (!cfg?.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) {
      let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: 'Choose the game executable',
        buttonLabel: 'Select',
        defaultPath: cfg?.exe || '',
        filters: [{ name: 'Executables', extensions: ['exe', 'bat'] }],
        properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
      });

      if (dialog.filePaths.length > 0 && dialog.filePaths[0].length > 0) {
        const filePath = dialog.filePaths[0];
        if (!fs.existsSync(filePath)) return;
        cfg.exe = filePath;
        await exeList.add(cfg);
      }
    }
    if (!cfg.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) return;
    if (fs.statSync(cfg.exe).isFile()) {
      // spawn() takes (command, args, options) — there is no callback overload, so the old 4th-arg
      // callback was dead code and launch failures (missing/blocked exe) were swallowed silently.
      // Listen on 'error' and surface it so the user knows the click did something.
      const reportLaunchFailure = (error) => {
        debug.error(`Failed to launch ${cfg.exe}: ${error}`);
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: 'Launch failed',
          message: 'Could not start the game.',
          detail: `${error}`,
        });
      };
      try {
        let game = spawn(cfg.exe, (cfg.args || '').trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [], {
          cwd: path.dirname(cfg.exe),
          detached: true,
          stdio: 'ignore',
        });
        game.on('error', reportLaunchFailure);
        game.unref();
      } catch (error) {
        reportLaunchFailure(error);
      }
    }
  },
  onConfigButtonClick: async function (self) {
    let appid = self.closest('.game-box').data('appid');
    $('#game-config').show();
    $('#game-config .box').fadeIn();
    $('#game-config .header').attr('title', appid);
    let cfg = await exeList.get(appid);
    if (!cfg?.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) {
      const game = gameList.find((g) => g.appid == appid);
      let detected = autodetectGameExe(game?.gameDir, game?.name, await takenExePaths(appid));
      if (detected) {
        cfg.exe = detected;
        await exeList.add(cfg);
      }
    }
    let exeLbl = $('#game-config').find('.constant');
    let argsInput = $('#launch-args');
    exeLbl.attr('title', cfg.exe);
    exeLbl.text(cfg.exe);
    argsInput.val(cfg.args);
  },
  onGameConfigCancelClick: async function (self) {
    self.css('pointer-events', 'none');
    $('#game-config .box').fadeOut(() => {
      $('#game-config').hide();
      self.css('pointer-events', 'initial');
    });
  },
  onGameConfigSaveClick: async function (self) {
    let appid = parseInt($('#game-config .header').attr('title'));
    let cfg = await exeList.get(appid);
    let exeLbl = $('#game-config').find('.constant');
    let argsInput = $('#launch-args');
    cfg.exe = exeLbl.text();
    cfg.args = argsInput.val() === undefined ? '' : argsInput.val();
    await exeList.add(cfg);
    this.onGameConfigCancelClick(self);
  },
};

(function ($, window, document) {
  $(function () {
    try {
      // On a genuine first run, defer the initial library scan until the onboarding guide is done:
      // onboarding lets the user set their Steam Web API key (and game folders), and finish()/skip()
      // trigger the first scan via resetUI()/onStart(). Scanning here too would run a slow, key-less
      // scrape pass that the onboarding key is meant to avoid — so the first real scan picks up the key.
      if (app.config.general?.onboardingCompleted === true) {
        app.onStart();
      }

      // Empty-state call to action: jump straight to Settings → Folders so a first-time user with no
      // detected games knows where to point the app. Bound once (static element, survives onStart re-runs).
      $('#empty-open-folders').on('click', function () {
        $('title-bar').trigger('open-settings');
        $("#settingNav li[data-view='folder']").trigger('click');
      });

      // Reveal a hidden achievement's masked description in place. Delegated from the stable #achievement
      // container (the list is rebuilt on every game open), so it's bound exactly once here.
      $('#achievement').on('click', '.achievement .content .description.masked-desc', function () {
        const el = $(this);
        const real = el.data('desc');
        if (real == null) return;
        el.text(real).removeClass('masked-desc');
      });

      // Settings → Advanced: "Fix all games". Runs the same emulator-fix chain the per-scan auto-apply
      // uses (achievements.autoApplyEmulatorFix) over every emulator-detected game that has a real
      // install folder. Sequential + per-game try/catch so one failure never aborts the batch.
      let fixAllRunning = false;
      $('#fix-all-games').on('click', async function () {
        if (fixAllRunning) return;
        const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
        const result = $('#fix-all-result');
        // Only games with a live install dir, a usable appid/schema and an emulator signal —
        // never touch plain legit Steam installs.
        const targets = gameList.filter(
          (g) =>
            g &&
            g.gameDir &&
            /^[0-9]+$/.test(String(g.appid)) &&
            g.achievement &&
            Array.isArray(g.achievement.list) &&
            g.achievement.list.length > 0 &&
            (g.hasSteamApiDll === true || !!g.steamSettings || g.source === 'GBE Fork' || g.source === 'Goldberg') &&
            fs.existsSync(g.gameDir)
        );
        if (targets.length === 0) {
          result.text(fr ? 'Aucun jeu détecté avec un dossier d’installation connu à réparer.' : 'No detected game with a known install folder to fix.');
          return;
        }
        const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
          type: 'question',
          buttons: [fr ? 'Réparer tous' : 'Fix all', fr ? 'Annuler' : 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: fr ? 'Réparer tous les jeux' : 'Fix all games',
          message: fr
            ? `Appliquer le fix émulateur à ${targets.length} jeu(x) détecté(s) ? Les fichiers existants sont sauvegardés avant d’être écrasés.`
            : `Apply the emulator fix to ${targets.length} detected game(s)? Existing files are backed up before being overwritten.`,
        });
        if (confirm.response !== 0) return;

        fixAllRunning = true;
        $(this).css('pointer-events', 'none');
        let fixed = 0;
        let failed = 0;
        for (let i = 0; i < targets.length; i++) {
          const game = targets[i];
          result.text((fr ? 'Réparation' : 'Fixing') + ` ${i + 1} / ${targets.length} — ${game.name}`);
          try {
            const detectedEmu = goldberg.detectEmulator(game.gameDir);
            const detectedExe = exeDetect.detect(game.gameDir, game.name || '', { dllPaths: detectedEmu.dll });
            createAutomaticGbeBackup({
              appid: game.appid,
              gameDir: game.gameDir,
              steamSettings: game.steamSettings || detectedEmu.steamSettings,
            });
            const schema = {
              name: game.name,
              achievement: {
                total: game.achievement && game.achievement.total,
                list: game.achievement && Array.isArray(game.achievement.list) ? game.achievement.list.map((a) => ({ ...a })) : [],
              },
            };
            const setup = await achievements.autoApplyEmulatorFix({
              gameDir: game.gameDir,
              gameName: game.name,
              appid: game.appid,
              steamSettings: game.steamSettings || detectedEmu.steamSettings,
              option: app.config,
              detectedEmu,
              detectedExe,
              skipAdvanced: true,
              schema,
            });
            const repairDirs = new Set(setup.steamSettingsDirs || []);
            if (game.steamSettings) repairDirs.add(game.steamSettings);
            if (detectedEmu.steamSettings) repairDirs.add(detectedEmu.steamSettings);
            const downloadIcon =
              app.config.achievement && app.config.achievement.goldbergDownloadIcons
                ? (() => {
                    const request = require('request-zero');
                    return async (url, dir) => {
                      const r = await request.download(url, dir);
                      return r && r.path;
                    };
                  })()
                : undefined;
            for (const steamSettingsDir of repairDirs) {
              if (!steamSettingsDir) continue;
              await goldberg.repair({
                steamSettings: steamSettingsDir,
                appid: game.appid,
                schema,
                downloadIcon,
                fetchDlc: (id) => steam.getDLCList(id),
                accountName: app.config.general && app.config.general.username,
                language: app.config.achievement && app.config.achievement.lang,
              });
              try {
                goldberg.seedRuntimeSave({
                  appid: game.appid,
                  schema,
                  steamSettings: steamSettingsDir,
                  types: ['gbe'],
                });
              } catch (seedErr) {
                debug.log(`[fix-all] ${game.appid} (${game.name}) runtime seed failed => ${seedErr}`);
              }
            }
            fixed++;
          } catch (err) {
            failed++;
            debug.log(`[fix-all] ${game.appid} (${game.name}) failed => ${err}`);
          }
        }
        const skipped = targets.length - fixed - failed;
        result.text(
          fr
            ? `Terminé — ${fixed} jeu(x) réparé(s), ${skipped} ignoré(s), ${failed} en échec.`
            : `Done — ${fixed} game(s) fixed, ${skipped} skipped, ${failed} failed.`
        );
        $(this).css('pointer-events', 'initial');
        fixAllRunning = false;
      });

      remote.app.on('second-instance', (event, argv, cwd) => {
        // ignore, focus on achievement if one is unlocked via toast?
      });
    } catch (err) {
      debug.log(err);
      app.errorExit(err);
    }
  });
})(window.jQuery, window, document);

function getArgs(argv) {
  if (argv[1]) {
    if (argv[1].includes('ach:')) {
      argv[1] = argv[1].replace('ach:', '');
      argv = args_split(argv[1]);
    }
  }

  return args(argv);
}
