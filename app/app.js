'use strict';
const { ipcRenderer, clipboard } = require('electron');
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
const { cssUrl } = require(path.join(appPath, 'util/cssUrl.js'));
const { stripTags } = require(path.join(appPath, 'util/stripTags.js'));
const { splitLaunchArgs } = require(path.join(appPath, 'util/launchArgs.js'));
const { openExternalSafe } = require(path.join(appPath, 'util/externalLink.js'));
const args = require('minimist');
const moment = require('moment');
const { spawn } = require('child_process');
const humanizeDuration = require('humanize-duration');
const settings = require(path.join(appPath, 'settings.js'));
settings.setUserDataPath(getUserDataPath());
const achievements = require(path.join(appPath, 'parser/achievements.js'));
const scanScope = require(path.join(appPath, 'parser/scanScope.js'));
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
const uplayR2 = require(path.join(appPath, 'parser/uplayR2.js'));
const uplayR2Installer = require(path.join(appPath, 'parser/uplayR2Installer.js'));
const steamParser = require(path.join(appPath, 'parser/steam.js'));
const exeList = require(path.join(appPath, 'parser/exeList.js'));
const manualUnlock = require(path.join(appPath, 'parser/manualUnlock.js'));
const exeDetect = require(path.join(appPath, 'parser/exeDetect.js'));
const gameIndex = require(path.join(appPath, 'parser/gameIndex.js'));
const PlaytimeTracking = require(path.join(appPath, 'parser/playtime.js'));
const progressMute = require(path.join(appPath, 'parser/progressMute.js'));
progressMute.setUserDataPath(getUserDataPath());
const emulatorSourceOverride = require(path.join(appPath, 'parser/emulatorSourceOverride.js'));
emulatorSourceOverride.setUserDataPath(getUserDataPath());
const l10n = require(path.join(appPath, 'locale/loader.js'));
const coverStore = require(path.join(appPath, 'util/coverStore.js'));
const uninstall = require(path.join(appPath, 'util/uninstall.js'));
const { calculateLibraryStats } = require(path.join(appPath, 'util/libraryStats.js'));
const { resolveGameRarityContext } = require(path.join(appPath, 'util/rarity.js'));
// `t` and `escapeHtml` come from ui/settings.js; classic scripts share their lexical scope.
let debug = new (require(path.join(appPath, 'util/logger.js')))({
  console: isDev,
  file: path.join(userdatapath, `logs/${ipcRenderer.sendSync('get-app-name-sync')}.log`),
});

// Keep otherwise-silent renderer failures in the log.
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
let profileStatsAnimationTimer = null;

function renderProfileStats(stats, { animate = false } = {}) {
  const values = [String(stats.totalUnlocked), `${stats.completed}/${stats.total}`, String(stats.average)];
  const dataElements = $('#user-info .info .stats li span.data');
  let changed = false;
  dataElements.each(function (index) {
    if ($(this).text() === values[index]) return;
    $(this).text(values[index]);
    changed = true;
  });

  const distEl = $('#user-info .completion-dist');
  distEl.find('.fill').css('width', stats.average + '%');
  distEl.attr('title', stats.average + '%');

  const statsEl = $('#user-info .info .stats');
  if (!animate || !changed || !statsEl.length) return;
  statsEl.removeClass('is-updating');
  void statsEl[0].offsetWidth;
  statsEl.addClass('is-updating');
  clearTimeout(profileStatsAnimationTimer);
  profileStatsAnimationTimer = setTimeout(() => statsEl.removeClass('is-updating'), 220);
}

function refreshProfileStats({ animate = false } = {}) {
  const installedOnly = typeof window.installedOnlyEnabled === 'function' && window.installedOnlyEnabled();
  renderProfileStats(calculateLibraryStats(gameList, { installedOnly }), { animate });
}

window.refreshProfileStats = refreshProfileStats;

function gameTouchesScanScope(game, scope) {
  const data = (game && game.data) || {};
  const sourcePaths = Array.isArray(game && game.dataPaths) ? game.dataPaths.map((entry) => entry && entry.path) : [];
  return [game && game.path, game && game.dataPath, game && game.gameDir, game && game.exe, data.path, data.root, data.gameDir, data.exe, ...sourcePaths]
    .filter(Boolean)
    .some((candidate) => scanScope.pathIsWithinSelectedDirectories(candidate, scope));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentFromProgress(current, max) {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((current / max) * 100)));
}

function getAchievementProgressState(achievement) {
  // Keep float counters readable without changing integers.
  const max = Math.round(Math.max(0, finiteNumber(achievement.MaxProgress ?? achievement.max_progress, 0)) * 100) / 100;
  let current = Math.max(0, finiteNumber(achievement.CurProgress ?? achievement.progress, 0));
  const achieved = achievement.Achieved == 1 || achievement.Achieved === true;
  if (achieved && max > 0 && current < max) current = max;
  if (max > 0 && current > max) current = max;
  current = Math.round(current * 100) / 100;
  const percent = percentFromProgress(current, max);
  return {
    current,
    max,
    percent,
    // 0/1 is a normal locked/unlocked state, not a counter.
    hasProgress: max > 1,
  };
}

// Periodically discover new installs without loading their full data.
const NEW_GAME_SCAN_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
let newGameScanTimer = null;
let scanInFlight = false;

// Remember discovered ids that do not reach the rendered list to avoid refresh loops.
let unrenderedAppids = new Set();

// One detection tick: cheap discover, diff against the games on screen, full refresh only on a new one.
async function runNewGameScan() {
  if (scanInFlight) return; // a scan is already running
  if ($('#achievement').is(':visible')) return; // user is reading a game's achievements — don't yank the view
  if ($('title-bar')[0] && $('title-bar')[0].inSettings) return; // user is configuring — leave them be
  scanInFlight = true;
  try {
    const discovered = await achievements.detectInstalledAppids(app.config);
    const known = new Set(gameList.map((g) => String(g.appid)));
    const fresh = discovered.filter((id) => !known.has(id) && !unrenderedAppids.has(id));
    if (fresh.length > 0) {
      debug.log(`[new-game-scan] ${fresh.length} new game(s) detected (${fresh.join(', ')}) — refreshing library`);
      // Avoid retrying ids that still cannot be rendered on the next tick.
      for (const id of fresh) unrenderedAppids.add(id);
      app.onStart(); // re-seeds the watchdog gameIndex so the new game is tracked
    }
  } catch (err) {
    debug.log(`[new-game-scan] failed: ${err}`);
  } finally {
    scanInFlight = false;
  }
}

// Manual refresh clears the background and Steam miss caches.
function forgetUnrenderedAppids() {
  unrenderedAppids = new Set();
  try {
    steamParser.forgetUnresolved();
    // Also drop remembered local-schema locations, so a schema added by hand since the last scan
    // is found now rather than whenever the miss memo happens to expire.
    steamParser.forgetLocalSchemaLocations();
  } catch (err) {
    debug.log(`[new-game-scan] could not clear the unresolved-appid cache: ${err}`);
  }
}

// Keep one background discovery timer alive.
function scheduleNewGameScan() {
  if (newGameScanTimer) clearInterval(newGameScanTimer);
  newGameScanTimer = setInterval(runNewGameScan, NEW_GAME_SCAN_INTERVAL_MS);
}

function resolveUnpackedBinary(binPath) {
  const normalized = String(binPath || '');
  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

// Show progress for long per-game actions without exposing dynamic HTML.
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

// Show a progress cursor while the interactive library scan runs.
function setLibraryBusyCursor(busy) {
  try {
    document.documentElement.classList.toggle('library-loading', busy === true);
  } catch (err) {
    debug.warn(`[cursor] ${err && err.message ? err.message : err}`);
  }
}

// Skeleton tiles fill the grid while a scan streams real games in. Without them a fast local
// install (Big Walk loads in ~30ms, network-backed games take seconds) sits alone on screen,
// then the whole rest of the library pops in at once. They are inert and removed as real tiles
// arrive (and any leftover at the end of the scan).
const MAX_SKELETON_TILES = 18;
const DEFAULT_SKELETON_TILES = 12;

function skeletonTileHtml(index) {
  const delay = ((index || 0) % 6 * -0.2).toFixed(1);
  return `
    <li>
      <div class="game-box skeleton" aria-hidden="true" style="--skeleton-delay:${delay}s">
        <div class="header"></div>
        <div class="info">
          <div class="info-head"><div class="title"></div></div>
          <div class="progressBar"><span class="meter"></span></div>
        </div>
      </div>
    </li>`;
}

function addSkeletonTiles(count) {
  const list = $('#game-list ul');
  for (let i = 0; i < count; i++) list.append(skeletonTileHtml(i));
}

function replaceSkeletonWith(item) {
  const skeleton = $('#game-list ul li:has(.game-box.skeleton)').first();
  if (skeleton.length) skeleton.replaceWith(item);
  else $('#game-list ul').append(item);
}

function clearSkeletonTiles() {
  $('#game-list ul li:has(.game-box.skeleton)').remove();
}

// Repaint one tile and the header counters from the current in-memory list.
function refreshLibraryProgressFor(appid, games) {
  const list = Array.isArray(games) ? games : [];
  const game = list.find((g) => g && String(g.appid) === String(appid));
  if (game && game.achievement) {
    const total = Number(game.achievement.total) || 0;
    const percent = total > 0 ? Math.round((100 * (Number(game.achievement.unlocked) || 0)) / total) : 0;
    const bar = $('#game-list .game-box')
      .filter(function () {
        return String($(this).data('appid')) === String(appid);
      })
      .first()
      .find('.progressBar')
      .first();
    if (bar.length) {
      bar.attr('data-percent', percent);
      bar.find('.meter').css('width', percent + '%');
      bar.find('.progress-value').text(percent + '%');
    }
  }

  refreshProfileStats({ animate: true });
}

// Open catalog links only after validating their http(s) scheme.
function openCatalogLink(url) {
  return openExternalSafe(remote.shell, url, (rejected) => {
    debug.warn(`[crackfix] refused to open a non-http(s) link: ${String(rejected).slice(0, 120)}`);
    remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
      type: 'warning',
      title: t('crakfiles', 'CrakFiles'),
      message: t(
        'link-not-opened',
        'This link was not opened because it is not a web address.',
        "Ce lien n'a pas \u00e9t\u00e9 ouvert car ce n'est pas une adresse web."
      ),
      detail: String(rejected || ''),
    });
  });
}

// Tracks in-flight uninstall completions so the game list refreshes once the
// uninstaller (or Steam) has actually removed the game. One poll per
// (mode, appid, folder) so repeated right-click actions don't stack timers.
const uninstallPolls = new Map();
function pollUninstallCompletion({ appid, gameDir, mode } = {}) {
  const key = `${mode}|${String(appid)}|${String(gameDir || '')}`;
  if (uninstallPolls.has(key)) return;
  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - started;
    let done = false;
    if (mode === 'local') {
      done = gameDir ? !fs.existsSync(gameDir) : false;
    } else if (mode === 'steam') {
      const gameDirGone = gameDir ? !fs.existsSync(gameDir) : false;
      const info = /^[0-9]+$/.test(String(appid)) ? uninstall.getSteamUninstallInfo(appid) : null;
      done = gameDirGone || (info && info.installed === false);
    }
    if (done || elapsed >= 120000) {
      clearInterval(timer);
      uninstallPolls.delete(key);
      if (done) setTimeout(() => app.onStart(), 800);
    }
  }, 3000);
  uninstallPolls.set(key, timer);
}

// Convert Error, string, and plain-object failures into readable text.
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

// Cache source icons so each distinct source needs one IPC lookup.
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
  const id = String(appid);
  const override = coverOverrides[id] || null;
  if (override && !coverStore.isUsable(override)) {
    const recovered = coverStore.recoverRemote(override);
    if (recovered) {
      // Old SteamGridDB selections retain their content hash in the deleted cache filename. Restore
      // the exact CDN URL now; it no longer depends on steam_cache and can be downloaded again.
      coverStore.set(id, recovered);
      coverOverrides[id] = recovered;
      debug.log(`[cover] recovered SteamGridDB override for ${id}`);
      return recovered;
    }
    // A pre-fix covers.db can still reference steam_cache after that cache was already removed.
    // Drop only the broken reference so the normal cover fallback renders instead of a blank tile.
    coverStore.remove(id);
    delete coverOverrides[id];
    debug.warn(`[cover] removed missing override for ${id}`);
    return null;
  }
  return override;
}
function applyCoverBackground(appid, value) {
  const el = $(`#game-header-${appid}`);
  if (!value || value === 'none') {
    el.css({ background: 'none', backgroundSize: '', backgroundPosition: '', backgroundRepeat: '' });
  } else {
    el.css({ backgroundImage: cssUrl(value), backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat' });
  }
}

// Fetch the preferred cover, then try its portrait/header alternative.
function applyCoverWithFallback(game, headerEl, imgName, tried) {
  const img = (game && game.img) || {};
  const fallback = (current) => {
    if (current === img.portrait && img.header) return img.header;
    if (current === img.header && img.portrait) return img.portrait;
    return null;
  };
  if (!imgName || (tried && tried.has(imgName))) {
    headerEl.css('background', 'none');
    return;
  }
  tried = tried || new Set();
  tried.add(imgName);
  ipcRenderer
    .invoke('fetch-icon', imgName, game.steamappid || game.appid)
    .then((localPath) => {
      if (localPath && localPath !== imgName) {
        headerEl.css('background', cssUrl(localPath));
      } else {
        const alt = fallback(imgName);
        if (alt) applyCoverWithFallback(game, headerEl, alt, tried);
        else headerEl.css('background', 'none');
      }
    })
    .catch(() => {
      const alt = fallback(imgName);
      if (alt) applyCoverWithFallback(game, headerEl, alt, tried);
      else headerEl.css('background', 'none');
    });
}

// Show alternate SteamDB and SteamGridDB covers for a game.
function openCoverPicker(game, appid, coverCacheAppid) {
  const portraitView = !!(app.config && app.config.achievement && app.config.achievement.thumbnailPortrait);
  const img = (game && game.img) || {};
  const currentUrl = portraitView ? img.portrait || img.header : img.header || img.portrait;
  const overlay = document.createElement('div');
  overlay.className = 'aw-prompt-overlay aw-cover-picker-overlay';
  const box = document.createElement('div');
  box.className = 'aw-prompt aw-cover-picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t('chooseAnotherCoverTitle', 'Choose another cover', 'Choisir une autre jaquette'));
  const head = document.createElement('div');
  head.className = 'aw-prompt-heading';
  const icon = document.createElement('div');
  icon.className = 'aw-prompt-icon';
  icon.innerHTML = '<i class="fas fa-images"></i>';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'aw-prompt-title';
  titleWrap.textContent = t('chooseAnotherCoverTitle', 'Choose another cover', 'Choisir une autre jaquette');
  head.append(icon, titleWrap);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'aw-prompt-button secondary aw-cover-picker-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('cancel', 'Cancel', 'Annuler');
  head.append(closeBtn);
  const status = document.createElement('div');
  status.className = 'aw-cover-picker-status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = t('coverPickerLoading', 'Loading covers…', 'Chargement des jaquettes…');
  const grid = document.createElement('div');
  grid.className = 'aw-cover-picker-grid';
  const actions = document.createElement('div');
  actions.className = 'aw-prompt-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'aw-prompt-button secondary';
  cancelBtn.textContent = t('cancel', 'Cancel', 'Annuler');
  actions.append(cancelBtn);
  box.append(head, status, grid, actions);
  overlay.append(box);

  const done = () => overlay.remove();
  closeBtn.onclick = done;
  cancelBtn.onclick = done;
  overlay.onmousedown = (ev) => {
    if (ev.target === overlay) done();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      done();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  // Show the gallery even when loading its options fails.
  document.body.append(overlay);

  const addTile = (url, source) => {
    const tile = document.createElement('div');
    tile.className = 'aw-cover-picker-tile';
    if (!portraitView) tile.classList.add('aw-landscape');
    tile.style.backgroundImage = cssUrl(url);
    tile.title = url;
    const tag = document.createElement('span');
    tag.className = 'aw-cover-picker-source';
    tag.textContent = source;
    tile.append(tag);
    tile.onclick = async () => {
      try {
        // Bound downloads and fall back to the remote URL on failure.
        const local = await Promise.race([
          ipcRenderer.invoke('fetch-icon', url, coverCacheAppid),
          new Promise((_, reject) => setTimeout(() => reject(new Error('fetch-icon timeout')), 15000)),
        ]).catch((err) => {
          debug.warn(`[cover] picker download failed (${err.message || err}) — applying remote URL`);
          return null;
        });
        const target = coverStore.persist(String(appid), local && local !== url ? local : url, getUserDataPath());
        if (!target) throw new Error('selected cover could not be persisted');
        reloadCoverOverrides();
        applyCoverBackground(String(appid), target);
      } catch (err) {
        debug.warn(`[cover] picker apply failed => ${err}`);
      }
      done();
    };
    grid.append(tile);
  };

  ipcRenderer
    .invoke('get-cover-options', {
      appid: coverCacheAppid,
      name: game.name,
      orientation: portraitView ? 'portrait' : 'landscape',
      // Only a real Steam release should hit SteamDB — passing a non-Steam numeric id (GOG/Xbox)
      // would scrape a page with no assets and stall the gallery for up to 45s.
      steamAppid: /^\d+$/.test(String(game && game.steamappid || '')) ? String(game.steamappid) : '',
    })
    .then((opts = {}) => {
      status.remove();
      if (currentUrl) addTile(currentUrl, t('currentCover', 'Current', 'Actuelle'));
      for (const url of Array.isArray(opts.steamdb) ? opts.steamdb : []) addTile(url, 'SteamDB');
      for (const url of Array.isArray(opts.grids) ? opts.grids : []) addTile(url, 'SteamGridDB');
      if (!grid.children.length) {
        status.textContent = t('noCoversFound', 'No alternative covers found.', 'Aucune jaquette alternative trouvée.');
        box.append(status);
      }
    })
    .catch((err) => {
      debug.warn(`[cover] picker options failed => ${err}`);
      status.textContent = t('noCoversFound', 'No alternative covers found.', 'Aucune jaquette alternative trouvée.');
    });

}

// Styled in-app text prompt (Electron disables window.prompt). Resolves to the trimmed value or null.
function promptText(message, defaultValue = '', type = 'text') {
  return new Promise((resolve) => {
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
    title.textContent = isSteamGuard ? 'Steam Guard' : t('input-required', 'Input required', 'Saisie requise');
    const label = document.createElement('div');
    label.className = 'aw-prompt-description';
    label.textContent = isSteamGuard
      ? t('enter-the-code-sent-by-email-to-confirm-the-steam-login', 'Enter the code sent by email to confirm the Steam login.', 'Saisis le code reçu par e-mail pour confirmer la connexion Steam.')
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
      input.setAttribute('aria-label', t('steam-guard-code', 'Steam Guard code', 'Code Steam Guard'));
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\s+/g, '').toUpperCase();
      });
    }
    const row = document.createElement('div');
    row.className = 'aw-prompt-actions';
    const cancel = document.createElement('button');
    cancel.className = 'aw-prompt-button secondary';
    cancel.textContent = t('cancel', 'Cancel', 'Annuler');
    const ok = document.createElement('button');
    ok.className = 'aw-prompt-button primary';
    ok.textContent = t('confirm', 'Confirm', 'Valider');
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
// Share the modal with the Steam-login test and emulator setup prompts.
window.awPromptText = promptText;

// These emulator sources already provide local artwork paths.
const EMU_LOCAL_ICON_SOURCES = new Set(['RPCS3 Emulator', 'ShadPS4 Emulator', 'Xenia Emulator']);

function gameHasAchievements(game) {
  return !!(game && game.achievement && (Number(game.achievement.total) > 0 || (Array.isArray(game.achievement.list) && game.achievement.list.length > 0)));
}

// Legitimate Steam-library entries already have a Steam appid; do not add a source badge.
function isLegitSteamLibraryGame(game) {
  return String((game && game.source) || '').startsWith('Steam (');
}

function sourcePresentationFor(game) {
  const source = game && game.source;
  const sourceLower = String(source || '').toLowerCase();
  const system = String((game && game.system) || '').toLowerCase();
  const isUbisoft = uplayR2.isUbisoftGame(game, game && game.appid);

  if (isLegitSteamLibraryGame(game)) {
    return { img: '', label: '', kind: 'steam-hidden' };
  }

  if (!gameHasAchievements(game)) {
    if (isUbisoft) {
      return {
        img: getSourceImg('ubisoft'),
        label: t('ubisoft-game-no-achievements-found', 'Ubisoft game — no achievements found', 'Jeu Ubisoft — aucun succès trouvé'),
        kind: 'ubisoft-empty',
      };
    }
    return {
      img: getSourceImg('Unconfigured'),
      label: t('no-achievements-found', 'No achievements found', 'Aucun succès trouvé'),
      kind: 'empty',
    };
  }

  if (system === 'playstation' || source === 'RPCS3 Emulator' || source === 'ShadPS4 Emulator') {
    return { img: getSourceImg(source === 'ShadPS4 Emulator' ? source : 'RPCS3 Emulator'), label: t('playstation-trophies', 'PlayStation trophies', 'Succès PlayStation'), kind: 'playstation' };
  }
  if (system === 'xbox' || source === 'Xenia Emulator') {
    return { img: getSourceImg('Xenia Emulator'), label: t('xbox-achievements', 'Xbox achievements', 'Succès Xbox'), kind: 'xbox' };
  }
  if (sourceLower === 'epic') {
    return { img: getSourceImg('epic'), label: t('epic-games-achievements', 'Epic Games achievements', 'Succès Epic Games'), kind: 'epic' };
  }
  if (sourceLower === 'gog') {
    return { img: getSourceImg('gog'), label: t('gog-achievements', 'GOG achievements', 'Succès GOG'), kind: 'gog' };
  }
  if (sourceLower === 'goldberg socialclub') {
    return {
      img: getSourceImg('Goldberg SocialClub'),
      label: t('social-club-achievements', 'Social Club achievements', 'Succès Social Club'),
      kind: 'socialclub',
    };
  }
  if (isUbisoft) {
    return { img: getSourceImg('ubisoft'), label: t('ubisoft-connect-achievements', 'Ubisoft Connect achievements', 'Succès Ubisoft Connect'), kind: 'ubisoft' };
  }
  if (system === 'ea' || sourceLower.includes('ea')) {
    return { img: pathToFileURL(path.join(appPath, 'resources/img/achievement.svg')).href, label: t('ea-app-achievements', 'EA app achievements', 'Succès EA app'), kind: 'ea' };
  }

  return { img: getSourceImg(source), label: t('steam-achievements', 'Steam achievements', 'Succès Steam'), kind: 'steam' };
}

function dllPresentationFor(game) {
  const present = !!(game && game.hasSteamApiDll);
  return {
    present,
    label: present
      ? t('steam-api-64-dll-detected', 'steam_api(64).dll detected', 'steam_api(64).dll détecté')
      : t('steam-api-64-dll-not-found', 'steam_api(64).dll not found', 'steam_api(64).dll introuvable'),
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

function formatGbeBackupDetail(backup, game) {
  const lines = [];
  if (game?.gameDir) lines.push(`${t('game', 'Game', 'Jeu')}: ${game.gameDir}`);
  if (backup?.backupDir) lines.push(`${t('backup', 'Backup', 'Sauvegarde')}: ${backup.backupDir}`);
  if (backup?.createdAt) {
    const created = moment(backup.createdAt);
    if (created.isValid()) lines.push(`${t('created', 'Created', 'Créée')}: ${created.format('L LT')}`);
  }
  if (backup?.manifest?.gameDir && game?.gameDir && normalizePathKey(backup.manifest.gameDir) !== normalizePathKey(game.gameDir)) {
    lines.push(`${t('original-folder', 'Original folder', 'Dossier d’origine')}: ${backup.manifest.gameDir}`);
  }
  if (backup?.source && backup.source !== 'manual') {
    const source = backup.source === 'index' ? (t('aw-history', 'AW history', 'historique AW')) : t('disk-scan', 'disk scan', 'scan disque');
    lines.push(t('found-automatically-via-x', 'Found automatically via {source}.', 'Trouvée automatiquement via {source}.', { source }));
  }
  return lines.join('\n');
}

// Return the title-bar shadow root when the custom element is ready.
function titleBarShadow() {
  const bar = document.querySelector('title-bar');
  return (bar && bar.shadowRoot) || null;
}

ipcRenderer.on('reset-watchdog-status', (event) => {
  let shadow = titleBarShadow();
  if (!shadow) return;
  let watchdogStatus = shadow.querySelector('.status-dot');
  let watchdoglbl = shadow.querySelector('.status-text');
  watchdoglbl.textContent = t('checking-watchdog-status', 'Checking watchdog status...', 'Vérification du Watchdog…');
  watchdogStatus.classList.remove('status-green', 'status-red');
  watchdogStatus.classList.add('status-orange');
  let startBtn = shadow.querySelector('#start-watchdog');
  startBtn.textContent = '';
  startBtn.innerHTML = '';
});

ipcRenderer.on('watchdog-status', (event, found) => {
  let shadow = titleBarShadow();
  if (!shadow) return;
  let watchdogStatus = shadow.querySelector('.status-dot');
  let watchdoglbl = shadow.querySelector('.status-text');
  watchdoglbl.textContent = t(
    'watchdog-stopped',
    "Watchdog is not running! (in-game overlay/notifications won't trigger.)",
    'Watchdog arrêté ! (overlays en jeu et notifications ne se déclencheront pas)'
  );
  watchdogStatus.classList.remove('status-green', 'status-orange');
  watchdogStatus.classList.add('status-red');
  let startBtn = shadow.querySelector('#start-watchdog');
  startBtn.innerHTML = t('i-class-fas-fa-shield-alt-i-click-to-start-watchdog', '<i class="fas fa-shield-alt"></i> Click to Start Watchdog!', '<i class="fas fa-shield-alt"></i> Cliquez pour démarrer le Watchdog !');
  if (found) {
    watchdogStatus.classList.remove('status-orange', 'status-red');
    watchdogStatus.classList.add('status-green');
    watchdoglbl.textContent = t('watchdog-is-running-in-game-overlay-windows-notifications-should', 'Watchdog is running (in-game overlay/notifications should work properly)', 'Watchdog actif (overlays en jeu et notifications fonctionnels)');
    startBtn.textContent = '';
  }
});

ipcRenderer.on('achievement-unlock', (event, { appid, ach_data }) => {
  // Ignore toasts for games or achievements missing from the current view.
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

// Open the library tile targeted by a Windows toast click.
ipcRenderer.on('open-game', (event, { appid, achievement } = {}) => {
  if (!appid) return;
  const el = $('#game-list .game-box')
    .filter(function () {
      return String(this.dataset.appid) === String(appid);
    })
    .first();
  if (el.length && typeof app.onGameBoxClick === 'function') {
    debug.log(`[open-game] opening ${appid}${achievement ? ` (${achievement})` : ''}`);
    app.onGameBoxClick(el, gameList);
  } else {
    debug.warn(`[open-game] no library tile for appid=${appid}`);
  }
});

function updateGamePage(appid, ach_data) {
  // Refresh details only when this game is already open.
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

// Auto-detect a launch executable from a known install folder.
function autodetectGameExe(gameDir, gameName, taken) {
  if (!gameDir) return null;
  try {
    const emu = goldberg.detectEmulator(gameDir);
    // Require strong evidence; otherwise let the user choose the executable.
    const exeInfo = exeDetect.detectConfident(gameDir, gameName || '', { dllPaths: emu.dll, taken });
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
    remote.dialog.showMessageBoxSync({ type: 'error', title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'), message: `${message}`, detail: `${err}` });
    remote.app.quit();
  },
  onStart: function (options = {}) {
    let self = this;
    const activeScanScope = scanScope.normalizeScanScope(options && options.scanScope);

    // Coalesce overlapping scans so streaming tiles are not duplicated.
    if (self.listLoadInFlight) {
      self.listRescanPending = true;
      // "Recheck achievement lists" must survive coalescing: carry the force into the follow-up pass.
      if (options && options.forceAchievementRecheck === true) self.listRescanForceRecheck = true;
      // A full refresh takes precedence over queued selective retries.
      if (!activeScanScope) self.listRescanScope = null;
      else if (self.listRescanScope !== null) self.listRescanScope = activeScanScope;
      return self.listLoadPromise || Promise.resolve();
    }
    self.listLoadInFlight = true;
    clearTimeout(self.listLoadGuardTimer);
    // Safety net: a makeList that rejects outright must never wedge the guard permanently.
    self.listLoadGuardTimer = setTimeout(() => {
      self.listLoadInFlight = false;
    }, 5 * 60 * 1000);

    // The main process may have promoted legacy cache-backed cover overrides while clearing caches.
    // Refresh this snapshot before rebuilding tiles so the renderer uses the new durable paths.
    reloadCoverOverrides();

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

    $('#user-info .info .name').text(self.config.general.username || os.userInfo().username || '');

    let loadingElem = {
      elem: $('#main-footer .loading'),
      progress: $('#main-footer .loading .progressBar'),
      meter: $('#main-footer .loading .progressBar > .meter'),
    };
    // Reuse the loading footer during refreshes.
    $('#main-footer').removeClass('done');
    loadingElem.elem.show();
    // Show activity across the whole window while scanning.
    setLibraryBusyCursor(true);

    renderProfileStats(calculateLibraryStats([]));

    $('#search-bar input[type=search]').val('').change().blur();

    // Keep the profile summary in sync with the streamed list and active installed-only filter.
    sortOptions(); // reflect persisted sort state on the sort-box during load (real sort runs once at the end)
    $('#user-info').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('#sort-box').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('#search-bar').fadeTo('fast', 1).css('pointer-events', 'initial');
    $('title-bar')[0].inSettings = false;
    // A scoped refresh replaces only entries under the selected roots.
    const previousGames = activeScanScope ? gameList.slice() : [];
    // First scan of the session: serve cached data immediately (no cover/description re-fetch per
    // game) so the library appears fast; details refresh themselves when opened.
    const fastStart = !self.hasCompletedFirstScan;
    // Settings > Advanced > "Check now" bypasses the 3-day achievement-recheck cooldown for this scan.
    const forceAchievementRecheck = options && options.forceAchievementRecheck === true;
    const scanConfig = activeScanScope
      ? { ...self.config, scanScope: activeScanScope, fastStart, forceAchievementRecheck }
      : { ...self.config, fastStart, forceAchievementRecheck };
    // Read the manual-unlock sidecar once for this scan. Applying it in the streamed callback makes
    // tile percentages and profile counters survive an app restart without doing sync I/O per game.
    const manualUnlockMap = (() => {
      const file = manualUnlock.sidecarFile();
      return file ? manualUnlock.readMap(file) : {};
    })();
    const previousGameCount = gameList.length;
    gameList = [];
    const renderedAppids = new Set();
    // Reset the list and handlers so onStart() stays idempotent.
    $('#game-list ul').empty();
    addSkeletonTiles(
      previousGameCount > 0 ? Math.min(MAX_SKELETON_TILES, Math.max(previousGameCount, 6)) : DEFAULT_SKELETON_TILES
    );
    gameElements.clear();
    // Remove only handlers owned by this scan.
    $('#game-list').off('.awLibrary');
    $('#game-config').off('click', '.edit').off('click', '.unlink');
    $('#btn-game-config-save').off('click');
    $('#btn-game-config-cancel, #game-config .overlay').off('click');
    let renderGame;
    const listLoadPromise = achievements
      .makeList(
        scanConfig,
        (percent) => {
          loadingElem.progress.attr('data-percent', percent);
          loadingElem.meter.css('width', percent + '%');
        },
        (renderGame = (game) => {
          manualUnlock.applyToGame(game, manualUnlockMap, game.appid, game.source);
          if (game.achievement.unlocked > 0 || self.config.achievement.hideZero == false) {
            const appidKey = String(game.appid);
            if (renderedAppids.has(appidKey)) {
              debug.log(`[${game.appid}] duplicate streamed tile ignored`);
              return;
            }
            renderedAppids.add(appidKey);
            let progress = game.achievement.total > 0 ? Math.round((100 * game.achievement.unlocked) / game.achievement.total) : 0;

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
            const hideSteamBadges = sourceIcon.kind === 'steam-hidden';
            let template = `
            <li>
                <div class="game-box" data-index="${gameList.length}" data-appid="${game.appid}" data-installed="${
              game.installed ? 1 : 0
            }" data-time="${timeMostRecent > 0 ? timeMostRecent : 0}" data-lastplayed="${lastPlayed}" ${
              game.system ? `data-system="${game.system}"` : ''
            }>
                  <div class="loading-overlay"><div class="content"><i class="fas fa-spinner fa-spin"></i></div></div>
                  <div class="header ${isPortrait ? 'glow' : ''}" id="game-header-${game.appid}" style="background: ${cssUrl(
              pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href
            )};">
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
                          dllIcon && !hideSteamBadges
                            ? `<span class="dll-badge ${dllIcon.present ? 'present' : 'missing'}" title="${escapeHtml(
                                dllIcon.label
                              )}" role="img" aria-label="${escapeHtml(dllIcon.label)}"></span>`
                            : ''
                        }
                        ${
                          sourceIcon.img
                            ? `<img class="source-icon" src="${sourceIcon.img}" data-kind="${escapeHtml(sourceIcon.kind)}" title="${escapeHtml(
                                sourceIcon.label
                              )}" alt="${escapeHtml(sourceIcon.label)}" aria-label="${escapeHtml(sourceIcon.label)}">`
                            : ''
                        }
                      </div>
                    </div>
                    <div class="progressBar" data-percent="${progress}"><span class="meter" style="width:${progress}%"></span><span class="progress-value">${progress}%</span></div>
                    <!--${game.source ? `<div class="source">${game.source}</div>` : ''}-->
                  </div>
                </div>
            </li>
            `;

            const item = $(template);
            replaceSkeletonWith(item);
            const headerEl = item.find('.header').first();
            gameList.push(game);
            refreshProfileStats();

            setTimeout(() => {
              const coverOverride = coverOverrideFor(game.appid);
              if (coverOverride) {
                // User-set cover (local image / alternate AppID) wins over every default source.
                headerEl.css('background', cssUrl(coverOverride));
                if (/^https?:\/\//i.test(coverOverride)) {
                  // A download that previously failed, or a recovered SteamGridDB legacy URL, is
                  // promoted to durable storage as soon as it is reachable again.
                  ipcRenderer
                    .invoke('fetch-icon', coverOverride, game.steamappid || game.appid)
                    .then((local) => {
                      if (!local) return;
                      const durable = coverStore.persist(game.appid, local, getUserDataPath());
                      if (!durable) return;
                      reloadCoverOverrides();
                      headerEl.css('background', cssUrl(durable));
                    })
                    .catch(() => {});
                }
                return;
              }
              if (EMU_LOCAL_ICON_SOURCES.has(game.source)) {
                if (game.img && game.img.header) headerEl.css('background', cssUrl(game.img.header));
                else headerEl.css('background', 'none');
                return;
              }
              // No art: clear the loading.gif so the spinner doesn't run forever. Otherwise fetch
              // with portrait<->header fallback, so a modern game whose portrait URL 404s (hashed
              // CDN path) still shows its header, and vice-versa.
              applyCoverWithFallback(game, headerEl, imgName);
            }, 0);
          }
        })
      )
      .then((list) => {
        // Scan finished — release the re-entry guard. If a refresh was requested while this run was in
        // flight, run exactly one more pass now (the just-finished list is stale) and skip finalising it.
        clearTimeout(self.listLoadGuardTimer);
        self.listLoadInFlight = false;
        if (self.listRescanPending) {
          self.listRescanPending = false;
          const nextScope = self.listRescanScope;
          const forceRecheck = self.listRescanForceRecheck === true;
          self.listRescanScope = undefined;
          self.listRescanForceRecheck = false;
          return self.onStart(
            nextScope
              ? { scanScope: nextScope, forceAchievementRecheck: forceRecheck }
              : { forceAchievementRecheck: forceRecheck }
          );
        }
        self.hasCompletedFirstScan = true;
        if (activeScanScope && previousGames.length > 0 && Array.isArray(list)) {
          const freshAppids = new Set(list.map((game) => String(game && game.appid)));
          const preserved = previousGames.filter(
            (game) => game && !freshAppids.has(String(game.appid)) && !gameTouchesScanScope(game, activeScanScope)
          );
          for (const game of preserved) {
            list.push(game);
            renderGame(game);
          }
        }
        loadingElem.elem.hide();
        $('#main-footer').addClass('done');
        setLibraryBusyCursor(false);

        if (list.length == 0) {
          debug.log('No game found !');
          clearSkeletonTiles();
          $('#game-list .isEmpty').show();
          return;
        }
        ipcRenderer.send('close-puppeteer');
        debug.log('Populating game list ...');

        // Sort once after all tiles have loaded.
        clearSkeletonTiles();
        sort($('#game-list ul'), sortOptions());

        // Remove duplicate executable assignments before playtime tracking.
        try {
          const removed = gameIndex.reconcile(gameList);
          if (removed > 0) debug.log(`[gameIndex] reconcile removed ${removed} duplicate binary entr${removed === 1 ? 'y' : 'ies'}`);
        } catch (err) {
          debug.log(err);
        }
        // The scan just (re)seeded cfg/gameIndex.json; let the Watchdog reload it so freshly added
        // non-Steam games are tracked without waiting for a Watchdog restart.
        ipcRenderer.invoke('watchdog-reload-playtime-index').catch((err) => debug.log(err));

        // Reconcile launch paths with the installed games.
        exeList
          .reconcile(gameList)
          .then(async (n) => {
            if (n > 0) debug.log(`[exeList] reconcile fixed ${n} entr${n === 1 ? 'y' : 'ies'}`);
            // exeList signal for the "installed only" filter: a game with a still-living configured
            // launch exe is installed even if discovery couldn't resolve its install folder. reconcile
            // just dropped dead paths, so any non-empty exe here exists on disk.
            try {
              const entries = await exeList.list();
              // Known non-game executables (R.exe from SPSS, browser/office tools, …) must never
              // count as an install proof — a stale "configure executable" pointing at one of those
              // used to mark uninstalled games (e.g. The Last of Us Part II) as installed.
              const withExe = new Set(
                entries.filter((e) => e.exe && !exeDetect.isKnownNonGameExe(path.basename(e.exe))).map((e) => String(e.appid))
              );
              for (const game of gameList) {
                if (withExe.has(String(game.appid))) game.installed = true;
              }
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
          .on('mouseenter.awLibrary', '.game-box .info .title', function () {
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
          .on('mouseleave.awLibrary', '.game-box .info .title', function () {
            this._scrollAnimation?.cancel();
            this._scrollAnimation = null;
          })
          .on('click.awLibrary', '.game-box', function () {
            self.onGameBoxClick($(this), gameList);
          })
          .on('click.awLibrary', '.game-box .play-button', async function (e) {
            e.stopPropagation();
            self.onPlayButtonClick($(this));
          })
          .on('click.awLibrary', '.game-box .config-button', async function (e) {
            e.stopPropagation();
            self.onConfigButtonClick($(this), gameList, await exeList.get());
          });

        $('#game-config').on('click', '.edit', async function (e) {
          e.stopPropagation();
          let appid = parseInt($('#game-config .header').attr('title'));
          let cfg = await exeList.get(appid);
          let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            title: t('choose-the-game-executable', 'Choose the game executable', 'Choisir l\'exécutable du jeu'),
            buttonLabel: t('select', 'Select', 'Sélectionner'),
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
          // Never write a synthetic local id to steam_appid.txt; use a real Steam id when available.
          let writableAppid = /^[0-9]+$/.test(String(appid)) ? appid : list.find((g) => g.appid == appid)?.steamappid || null;
          const ctxGame = list.find((g) => g.appid == appid);
          const gameSource = ctxGame?.source || '';
          // Offer GBE for non-Steam and non-native-launcher installs.
          const isLegitSteamOwned = gameSource.startsWith('Steam (');
          const isNativeLauncher = gameSource === 'gog' || gameSource === 'epic';
          // Console-emulator records do not use Steam/Ubisoft tools; Uplay is the exception.
          const rawSystem = self.data('system');
          const isConsoleSystem = !!rawSystem && rawSystem !== 'uplay';
          // Manual per-game override (right-click → Emulator source) lets the user force GBE Fork or
          // Uplay R2 when the on-disk marker heuristic (isUbisoftGame) guesses wrong — e.g. a Ubisoft
          // title repacked with both a steam_api dll and leftover Ubisoft engine files (a Steam-store
          // Ubisoft remaster). `null` means no override: keep the automatic detection.
          const emulatorSourceForced = emulatorSourceOverride.get(appid);
          const isUbisoftSource =
            emulatorSourceForced === 'ubisoft' ? true : emulatorSourceForced === 'steam' ? false : uplayR2.isUbisoftGame(ctxGame, appid);
          const ubisoftTools = isUbisoftSource ? uplayR2.getGameToolPaths(ctxGame, appid) : null;
          const catalogAppid = String(
            (ubisoftTools && ubisoftTools.steamAppid) || ctxGame?.steamappid || writableAppid || (/^[0-9]+$/.test(String(appid)) ? appid : '')
          );
          const { Menu, MenuItem, nativeImage } = remote;
          // Native Windows menus render icons at their natural size; the bundled
          // icons are 32×32 and look oversized at typical DPI. Normalize every
          // context-menu icon to the standard 16×16 size.
          const menuIcon = (name) => {
            const img = nativeImage.createFromPath(path.join(appPath, 'resources/img', name));
            if (img.isEmpty()) return img;
            return img.resize({ width: 16, height: 16, quality: 'best' });
          };

          // CrakFiles community fixes. Declared here, appended by whichever branch below applies:
          // the list is matched by game NAME (it holds no appids) and a fix is just files dropped into
          // the install folder, so nothing about it is Steam-specific. It used to live inside the
          // Steam-only branch, which silently denied it to cracked Ubisoft games.
          const appendCrackFixItem = () => {
            // Community "Fixes & Bypasses" from the CrakFiles list — a SEPARATE launch helper. These
            // can overwrite game files (incl. steam_api), so it warns that achievement detection runs
            // through the emulator and the emulator fix may need re-applying. Overwritten files are
            // backed up under <gameDir>/.aw-crackfix-backups/.
            emulatorMenu.append(
              new MenuItem({
                icon: menuIcon('file-text.png'),
                label: $('#game-list').attr('data-ctx-crackfix') || '',
                async click() {
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
                      remote.dialog.showMessageBoxSync({ type: 'info', title: t('crakfiles', 'CrakFiles'), message: t('unknown-game-name', 'Unknown game name.', 'Nom de jeu inconnu.') });
                      return;
                    }
                    const cacheDir = path.join(getUserDataPath(), 'cache/crackfiles');
                    setGameBoxBusy(self, t('searching-fixes', 'Searching fixes…', 'Recherche de fixes…'));
                    const cfList = await crackFix.fetchList({ cacheDir, log: debug });
                    clearGameBoxBusy(self);
                    const matches = crackFix.findFixes(cfList, game.name, { limit: 5 });
                    if (matches.length === 0) {
                      const c = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: t('crakfiles', 'CrakFiles'),
                        message: t('no-fix-found-for-x', 'No fix found for "{name}".', 'Aucun fix trouvé pour « {name} ».', { name: game.name }),
                        detail: t('the-crakfiles-list-is-community-maintained-and-limited', 'The CrakFiles list is community-maintained and limited.', 'La liste CrakFiles est communautaire et limitée.'),
                        buttons: [t('ok', 'OK', 'OK'), t('open-crakfiles', 'Open CrakFiles', 'Ouvrir CrakFiles')],
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
                      title: t('crakfiles', 'CrakFiles'),
                      message: t('fix-found-x', 'Fix found: {name}', 'Fix trouvé : {name}', { name: top.name }),
                      detail:
                        (fix.filename ? `${fix.filename}${badges ? ` [${badges}]` : ''}\n` : '') +
                        t(
                          'crackfix-overwrite-warning',
                          '\n⚠ A community crack may overwrite game files (incl. steam_api(64).dll). Achievement detection runs through the emulator — if the crack replaces steam_api, re-run "Apply emulator fix" afterwards. Overwritten files are backed up.',
                          "\n⚠ Un crack communautaire peut écraser des fichiers du jeu (dont steam_api(64).dll). La détection des succès passe par l'émulateur — si le crack remplace steam_api, relance « Appliquer le fix émulateur » après. Les fichiers écrasés sont sauvegardés."
                        ),
                      // NB: Windows treats `&` in a button label as the Alt-mnemonic marker and hides
                      // it ("Download  apply"); double it so a literal ampersand shows.
                      buttons: [
                        t('cancel', 'Cancel', 'Annuler'),
                        t('open-download-page', 'Open download page', 'Ouvrir la page de téléchargement'),
                        t('open-source', 'Open source', 'Ouvrir la source'),
                        t('download-apply', 'Download && apply', 'Télécharger && appliquer'),
                      ],
                      defaultId: 1,
                      cancelId: 0,
                      noLink: true,
                    });
                    if (choice.response === 0) return;
                    if (choice.response === 1) {
                      if (fix.href) openCatalogLink(fix.href);
                      return;
                    }
                    if (choice.response === 2) {
                      const src = (top.source_crack || [])[0];
                      if (src) openCatalogLink(src);
                      return;
                    }
                    // Download & apply
                    gameDir = game.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                    if (!gameDir) {
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: t('game-install-folder', 'Game install folder', "Dossier d'installation du jeu"),
                        properties: ['openDirectory', 'dontAddToRecent'],
                      });
                      if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                      gameDir = picked.filePaths[0];
                    }
                    if (!crackFix.pixeldrainDirectUrl(fix.href)) {
                      const c = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: t('crakfiles', 'CrakFiles'),
                        message: t('this-link-cannot-be-applied-automatically', 'This link cannot be applied automatically.', 'Ce lien ne peut pas être appliqué automatiquement.'),
                        detail: t('open-the-download-page-and-apply-it-manually', 'Open the download page and apply it manually.', 'Ouvre la page de téléchargement et applique-le manuellement.'),
                        buttons: [t('ok', 'OK', 'OK'), t('open', 'Open', 'Ouvrir')],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (c === 1 && fix.href) openCatalogLink(fix.href);
                      return;
                    }
                    setGameBoxBusy(self, t('downloading-fix', 'Downloading fix…', 'Téléchargement du fix…'));
                    const res = await crackFix.downloadAndApply({ fix, gameDir, cacheDir, entryName: top.name, proxyFallback: (app.config?.emulator || {}).pixeldrainProxyFallback !== false, log: debug });
                    remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                      type: 'info',
                      title: t('crakfiles', 'CrakFiles'),
                      message: t('applied-x-file-s', 'Applied {count} file(s).', '{count} fichier(s) appliqué(s).', { count: res.applied.length }),
                      detail:
                        gameDir +
                        (res.backupDir ? `\n${t('backup', 'Backup:', 'Sauvegarde :')} ${res.backupDir}` : '') +
                        (t('n-nif-steam-api-was-replaced-re-run-apply-emulator-fix-to-keep-a', '\n\nIf steam_api was replaced, re-run "Apply emulator fix" to keep achievement detection.', '\n\nSi steam_api a été remplacé, relance « Appliquer le fix émulateur » pour garder la détection des succès.')),
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
                        title: t('crakfiles', 'CrakFiles'),
                        message: t('pixeldrain-captcha-required-for-this-file', 'Pixeldrain captcha required for this file.', 'Captcha pixeldrain requis pour ce fichier.'),
                        detail: t(
                          'pixeldrain-rate-limited',
                          "Pixeldrain rate-limited this file (too many downloads): you must solve a captcha in the browser.\n\n1) Open the page and download the .rar.\n2) Come back and select the downloaded file — AW will extract and apply it automatically (overwritten files are backed up).",
                          "Pixeldrain limite ce fichier (trop de téléchargements) : il faut résoudre un captcha dans le navigateur.\n\n1) Ouvre la page et télécharge le .rar.\n2) Reviens et sélectionne le fichier téléchargé — AW l'extraira et l'appliquera automatiquement (les fichiers écrasés sont sauvegardés)."
                        ),
                        buttons: [
                          t('cancel', 'Cancel', 'Annuler'),
                          t('open-page', 'Open page', 'Ouvrir la page'),
                          t('select-downloaded-file', 'Select downloaded file…', 'Sélectionner le fichier téléchargé…'),
                        ],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (choice.response === 0) return;
                      if (choice.response === 1) {
                        if (href) openCatalogLink(href);
                        // Wait (non-blocking modal) for the user to finish the browser download, then let
                        // them pick the file. Cancelling here just leaves the page open.
                        const after = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                          type: 'info',
                          title: t('crakfiles', 'CrakFiles'),
                          message: t('once-the-download-is-finished', 'Once the download is finished…', 'Une fois le téléchargement terminé…'),
                          detail: t('select-the-downloaded-file-rar-zip-7z-to-apply-it', 'Select the downloaded file (.rar/.zip/.7z) to apply it.', 'Sélectionne le fichier téléchargé (.rar/.zip/.7z) pour l’appliquer.'),
                          buttons: [t('cancel', 'Cancel', 'Annuler'), t('select-file', 'Select file…', 'Sélectionner le fichier…')],
                          defaultId: 1,
                          cancelId: 0,
                          noLink: true,
                        });
                        if (after.response !== 1) return;
                      }
                      // Pick + apply the locally-downloaded archive.
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: t('select-the-downloaded-crack', 'Select the downloaded crack', 'Sélectionne le crack téléchargé'),
                        properties: ['openFile', 'dontAddToRecent'],
                        filters: [
                          { name: t('archives', 'Archives', 'Archives'), extensions: ['rar', 'zip', '7z'] },
                          { name: t('all-files', 'All files', 'Tous les fichiers'), extensions: ['*'] },
                        ],
                      });
                      if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                      // Resolve the install folder (the try-scoped one may be unset if we failed early).
                      let applyDir = (gameDir && fs.existsSync(gameDir) && gameDir) ||
                        (game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null);
                      if (!applyDir) {
                        const pd = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('game-install-folder', 'Game install folder', "Dossier d'installation du jeu"),
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (pd.canceled || !pd.filePaths || pd.filePaths.length === 0) return;
                        applyDir = pd.filePaths[0];
                      }
                      try {
                        setGameBoxBusy(self, t('applying-file', 'Applying file…', 'Application du fichier…'));
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
                          title: t('crakfiles', 'CrakFiles'),
                          message: t('applied-x-file-s', 'Applied {count} file(s).', '{count} fichier(s) appliqué(s).', { count: res.applied.length }),
                          detail:
                            applyDir +
                            (res.backupDir ? `\n${t('backup', 'Backup:', 'Sauvegarde :')} ${res.backupDir}` : '') +
                            (t('n-nif-steam-api-was-replaced-re-run-apply-emulator-fix-to-keep-a', '\n\nIf steam_api was replaced, re-run "Apply emulator fix" to keep achievement detection.', '\n\nSi steam_api a été remplacé, relance « Appliquer le fix émulateur » pour garder la détection des succès.')),
                          noLink: true,
                        });
                      } catch (e2) {
                        remote.dialog.showMessageBoxSync({ type: 'error', title: t('crakfiles', 'CrakFiles'), message: t('apply-failed', 'Apply failed.', 'Échec de l’application.'), detail: formatErr(e2) });
                      }
                    } else {
                      remote.dialog.showMessageBoxSync({ type: 'error', title: t('crakfiles', 'CrakFiles'), message: t('failed', 'Failed.', 'Échec.'), detail: formatErr(err) });
                    }
                  } finally {
                    clearGameBoxBusy(self);
                  }
                },
              })
            );
          };
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
            const emuLabel = {
              gbe: 'GBE Fork',
              goldberg: 'Goldberg (classic)',
              none: t('diagnosis-emulator-none', 'none detected', 'aucun détecté'),
            }[report.emulator] || report.emulator;
            const lines = [];
            lines.push(t('diagnosis-emulator', 'Emulator: {emulator}', 'Émulateur : {emulator}', { emulator: emuLabel }));
            lines.push(
              report.steamSettings
                ? t('diagnosis-steam-settings', 'steam_settings: {path}', 'steam_settings : {path}', { path: report.steamSettings })
                : t('diagnosis-steam-settings-missing', 'steam_settings: not found', 'steam_settings : introuvable')
            );
            if (report.achievements.expected != null) {
              lines.push(
                t('diagnosis-achievements-count', 'achievements: {found} in file / {expected} in schema', 'succès : {found} dans le fichier / {expected} dans le schéma', {
                  found: report.achievements.found,
                  expected: report.achievements.expected,
                })
              );
            }
            if (report.issues.length === 0) {
              lines.push('');
              lines.push(t('diagnosis-no-problems', 'No problems detected.', 'Aucun problème détecté.'));
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
                lines.push(
                  t('diagnosis-auto-repair-wrote', 'Auto-repair wrote {count} achievements to {path}', 'La réparation automatique a écrit {count} succès dans {path}', {
                    count: repaired.achievementsJson.length,
                    path: repaired.steamSettings,
                  })
                );
                lines.push(
                  t('diagnosis-icons-summary', 'icons: {downloaded} downloaded, {failed} failed, {skipped} skipped', 'icônes : {downloaded} téléchargées, {failed} en échec, {skipped} ignorées', {
                    downloaded: repaired.icons.downloaded,
                    failed: repaired.icons.failed,
                    skipped: repaired.icons.skipped,
                  })
                );
                if (repaired.wroteAppId) lines.push(t('diagnosis-steam-appid-created', 'steam_appid.txt created', 'steam_appid.txt créé'));
                if (repaired.main && repaired.main.changed) {
                  lines.push(t('diagnosis-configs-main-updated', 'configs.main.ini updated (new_app_ticket + gc_token)', 'configs.main.ini mis à jour (new_app_ticket + gc_token)'));
                }
                if (repaired.dlc) {
                  lines.push(
                    t('diagnosis-configs-app-updated', 'configs.app.ini updated ({count} DLC entries, unlock_all={unlockAll})', 'configs.app.ini mis à jour ({count} entrées DLC, unlock_all={unlockAll})', {
                      count: repaired.dlc.count,
                      unlockAll: repaired.dlc.unlockAll ? '1' : '0',
                    })
                  );
                }
                if (repaired.user && repaired.user.changed) lines.push(t('diagnosis-configs-user-updated', 'configs.user.ini updated', 'configs.user.ini mis à jour'));
              }
              if (repairError) {
                lines.push('');
                lines.push(
                  t('diagnosis-auto-repair-failed', 'Auto-repair failed: {error}', 'La réparation automatique a échoué : {error}', {
                    error: repairError.message || repairError,
                  })
                );
              }

              const choice = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                type: report.ok && !repairError ? 'info' : 'warning',
                title: t('goldberg-diagnosis-title', 'Goldberg/GBE diagnosis — {gameName}', 'Diagnostic Goldberg/GBE — {gameName}', { gameName: game?.name || appid }),
                message: report.ok
                  ? t('setupLooksValid', 'Setup looks valid.', 'La configuration semble valide.')
                  : t('problemsWereDetected', 'Problems were detected.', 'Des problèmes ont été détectés.'),
                detail: lines.join('\n'),
                buttons: !autoRepair && canRepair
                  ? ['OK', t('repairSteamSettings', 'Repair steam_settings (write schema + icons)…', 'Réparer steam_settings (écrire le schéma + les icônes)…')]
                  : ['OK'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });

              if (!autoRepair && canRepair && choice.response === 1) {
                try {
                  const summary = await repairGoldbergSetup({ report, gameDir, game });
                  remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                    type: 'info',
                    title: t('repair-complete', 'Repair complete', 'Réparation terminée'),
                    message: t(
                      'repair-complete-message',
                      'Wrote {count} achievements to {path}',
                      '{count} succès écrits dans {path}',
                      { count: summary.achievementsJson.length, path: summary.steamSettings }
                    ),
                    detail:
                      t('diagnosis-icons-summary', 'icons: {downloaded} downloaded, {failed} failed, {skipped} skipped', 'icônes : {downloaded} téléchargées, {failed} en échec, {skipped} ignorées', {
                        downloaded: summary.icons.downloaded,
                        failed: summary.icons.failed,
                        skipped: summary.icons.skipped,
                      }) +
                      (summary.wroteAppId ? '\n' + t('diagnosis-steam-appid-created', 'steam_appid.txt created', 'steam_appid.txt créé') : '') +
                      (summary.main && summary.main.changed ? '\n' + t('diagnosis-configs-main-updated', 'configs.main.ini updated (new_app_ticket + gc_token)', 'configs.main.ini mis à jour (new_app_ticket + gc_token)') : '') +
                      (summary.dlc
                        ? '\n' +
                          t('diagnosis-configs-app-updated', 'configs.app.ini updated ({count} DLC entries, unlock_all={unlockAll})', 'configs.app.ini mis à jour ({count} entrées DLC, unlock_all={unlockAll})', {
                            count: summary.dlc.count,
                            unlockAll: summary.dlc.unlockAll ? '1' : '0',
                          })
                        : '') +
                      (summary.user && summary.user.changed ? '\n' + t('diagnosis-configs-user-updated', 'configs.user.ini updated', 'configs.user.ini mis à jour') : ''),
                    noLink: true,
                  });
                } catch (err) {
                  remote.dialog.showMessageBoxSync({ type: 'error', title: t('repair-failed', 'Repair failed', 'Échec de la réparation'), message: t('could-not-write-steam-settings', 'Could not write steam_settings.', 'Impossible d\'écrire steam_settings.'), detail: `${err}` });
                }
              }
            }

            return { report, repaired, repairError };
          };
          gameMenu.append(
            new MenuItem({
              icon: menuIcon('cross.png'),
              label: $('#game-list').attr('data-contextMenu0'),
              click() {
                try {
                  // Store the display name alongside the id so the Settings blacklist manager can
                  // show which game each entry is.
                  blacklist.add(appid, list.find((g) => g.appid == appid)?.name || self.find('.info .title span').text() || '');
                  app.onStart();
                } catch (err) {
                  remote.dialog.showMessageBoxSync({
                    type: 'error',
                    title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
                    message: t('blacklist-add-failed', 'Failed to add item to user blacklist', 'Échec de l’ajout à la liste noire'),
                    detail: `${err}`,
                  });
                }
              },
            })
          );

          // Manual override for which emulator family this game's tools should target — for the
          // rare Ubisoft title (e.g. a Steam-store Ubisoft remaster) whose folder trips the on-disk
          // marker heuristic the wrong way, or a genuine Ubisoft install the user wants to try GBE
          // Fork on anyway. Hidden for legit Steam-owned/GOG/Epic records and console emulators,
          // where neither fix could ever apply.
          if (!isConsoleSystem && !isLegitSteamOwned && !isNativeLauncher) {
            gameMenu.append(new MenuItem({ type: 'separator' }));
            const emulatorSourceMenu = new Menu();
            const emulatorSourceOptions = [
              { value: null, labelKey: 'emulator-source-auto', labelEn: 'Automatic (detected)', labelFr: 'Automatique (détecté)' },
              { value: 'steam', labelKey: 'emulator-source-steam', labelEn: 'Steam / GBE Fork', labelFr: 'Steam / GBE Fork' },
              { value: 'ubisoft', labelKey: 'emulator-source-ubisoft', labelEn: 'Ubisoft (Uplay R2)', labelFr: 'Ubisoft (Uplay R2)' },
            ];
            for (const opt of emulatorSourceOptions) {
              emulatorSourceMenu.append(
                new MenuItem({
                  type: 'radio',
                  label: t(opt.labelKey, opt.labelEn, opt.labelFr),
                  checked: emulatorSourceForced === opt.value,
                  click() {
                    emulatorSourceOverride.set(appid, opt.value);
                  },
                })
              );
            }
            gameMenu.append(
              new MenuItem({
                icon: menuIcon('file-text.png'),
                label: t('emulator-source', 'Emulator source', 'Source de l’émulateur'),
                submenu: emulatorSourceMenu,
              })
            );
          }

          // Launching and picking the executable are not Ubisoft-specific: every tile carries the
          // same play and config buttons, and onPlayButtonClick works for any source. These two
          // entries used to sit inside the Ubisoft branch, so right-clicking a Steam, GOG or Epic
          // game offered no way to start it even with the executable already configured.
          gameMenu.append(new MenuItem({ type: 'separator' }));
          gameMenu.append(
            new MenuItem({
              label: t('launch-game', 'Launch game', 'Lancer le jeu'),
              async click() {
                await app.onPlayButtonClick(self.find('.play-button'));
              },
            })
          );
          gameMenu.append(
            new MenuItem({
              label: t('configure-executable', 'Configure executable…', 'Configurer l’exécutable…'),
              async click() {
                await app.onConfigButtonClick(self.find('.config-button'));
              },
            })
          );

          if (isUbisoftSource) {
            // Non-Ubisoft games get their own reset-playtime entry in the emulator section below.
            gameMenu.append(
              new MenuItem({
                label: $('#game-list').attr('data-ctx-resetplaytime') || '',
                async click() {
                  self.css('pointer-events', 'none');
                  await PlaytimeTracking.reset(appid).catch((err) => debug.error(err));
                  self.css('pointer-events', 'initial');
                },
              })
            );
          }

          gameMenu.append(
            new MenuItem({
              label: progressMute.isMuted(appid)
                ? $('#game-list').attr('data-ctx-unmuteprogress') || ''
                : $('#game-list').attr('data-ctx-muteprogress') || '',
              click() {
                try {
                  progressMute.toggle(appid);
                } catch (err) {
                  debug.error(err);
                }
              },
            })
          );

          // Native-platform records normally skip Steam-emulator tools. Ubisoft is the exception:
          // it needs its own Uplay R2 section plus the common folder/catalog/cover actions below.
          // Gated on the raw system value (isConsoleSystem), not isUbisoftSource, so forcing a
          // system="uplay" record to 'steam' via the override still opens this block (for the GBE
          // Fork tools) instead of hiding both toolsets.
          if (!isConsoleSystem) {
            if (!isUbisoftSource) {
            // Steam/GBE only
            gameMenu.append(
              new MenuItem({
                label: $('#game-list').attr('data-ctx-resetplaytime') || '',
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
                  icon: menuIcon('image.png'),
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
                        title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
                        message: t('icon-cache-build-failed', 'Failed to build icon cache', 'Échec de la construction du cache d’icônes'),
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
                icon: menuIcon('file-text.png'),
                label: $('#game-list').attr('data-ctx-genjson') || '',
                async click() {
                  self.css('pointer-events', 'none');
                  try {
                    const request = require('request-zero');

                    let dialog = await remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
                      title: t('choose-where-to-generate-achievements-json', 'Choose where to generate achievements.json', 'Choisir où générer achievements.json'),
                      buttonLabel: t('generate', 'Generate', 'Générer'),
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
                      title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
                      message: t('generate-achievements-json-failed', 'Failed to generate achievements.json', 'Échec de la génération de achievements.json'),
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
                icon: menuIcon('file-text.png'),
                label: $('#game-list').attr('data-ctx-diagnose') || '',
                async click() {
                  try {
                    const game = list.find((g) => g.appid == appid);
                    // Reuse the install folder discover() already found instead of asking the
                    // user to re-browse to it; only prompt when it's genuinely unknown.
                    let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                    if (!gameDir) {
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: t('select-install-folder-emulator-dll', "Select the game's install folder (where the emulator .dll is)", "Sélectionne le dossier d'installation du jeu (où se trouve la .dll de l'émulateur)"),
                        buttonLabel: t('diagnose', 'Diagnose', 'Diagnostiquer'),
                        properties: ['openDirectory', 'dontAddToRecent'],
                      });
                      if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }
                    await diagnoseGoldbergSetup({ game, gameDir });
                  } catch (err) {
                    remote.dialog.showMessageBoxSync({ type: 'error', title: t('diagnose-failed', 'Diagnose failed', 'Échec du diagnostic'), message: t('could-not-diagnose-the-setup', 'Could not diagnose the setup.', 'Impossible de diagnostiquer la configuration.'), detail: `${err}` });
                  }
                },
              })
            );

            const backupGame = list.find((g) => g.appid == appid);
            if (backupGame?.gameDir && fs.existsSync(backupGame.gameDir)) {
              emulatorMenu.append(
                new MenuItem({
                  icon: menuIcon('folder-open.png'),
                  label: $('#game-list').attr('data-ctx-backupgbe') || '',
                  async click() {
                    try {
                      const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                        title: t('where-should-aw-save-the-gbe-goldberg-setup', 'Where should AW save the GBE/Goldberg setup?', 'Où sauvegarder GBE/Goldberg (steam_settings + steam_api) ?'),
                        buttonLabel: t('create-backup', 'Create backup', 'Créer la sauvegarde'),
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
                        title: t('gbe-goldberg-backup-created', 'GBE/Goldberg backup created', 'Sauvegarde GBE/Goldberg créée'),
                        message: t('backed-up-x-item-s-steam-settings-steam-dlls', 'Backed up {count} item(s): steam_settings + Steam DLLs.', '{count} élément(s) sauvegardé(s) : steam_settings + DLL Steam.', { count: result.files.length }),
                        detail: formatGbeBackupDetail({ backupDir: result.backupDir, manifest: result.manifest, createdAt: result.manifest?.createdAt }, backupGame),
                        buttons: [t('ok', 'OK', 'OK'), t('open-backup-folder', 'Open backup folder', 'Ouvrir la sauvegarde')],
                        defaultId: 0,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (choice === 1) remote.shell.openPath(result.backupDir);
                    } catch (err) {
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'error',
                        title: t('gbe-goldberg-backup-failed', 'GBE/Goldberg backup failed', 'Échec de la sauvegarde GBE/Goldberg'),
                        message: t('could-not-back-up-steam-settings-and-steam-dlls-for-this-game', 'Could not back up steam_settings and Steam DLLs for this game.', 'Impossible de sauvegarder steam_settings et les DLL Steam de ce jeu.'),
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
                  icon: menuIcon('redo-alt.png'),
                  label: $('#game-list').attr('data-ctx-restoregbe') || '',
                  async click() {
                    try {
                      let backup = findLatestGbeBackup({ ...backupGame, appid });
                      if (!backup) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('no-known-backup-choose-a-gbe-goldberg-backup-folder', 'No known backup: choose a GBE/Goldberg backup folder', 'Aucune sauvegarde connue : choisir un dossier GBE/Goldberg'),
                          buttonLabel: t('restore-this-folder', 'Restore this folder', 'Restaurer ce dossier'),
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
                        title: t('restore-gbe-goldberg-backup', 'Restore GBE/Goldberg backup?', 'Restaurer la sauvegarde GBE/Goldberg ?'),
                        message: t('aw-will-restore-the-saved-steam-settings-and-steam-dlls-for-this', 'AW will restore the saved steam_settings and Steam DLLs for this game.', 'AW va restaurer steam_settings et les DLL Steam sauvegardées pour ce jeu.'),
                        detail: formatGbeBackupDetail(backup, backupGame),
                        buttons: [t('cancel', 'Cancel', 'Annuler'), t('restore', 'Restore', 'Restaurer')],
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
                        title: t('gbe-goldberg-restore-complete', 'GBE/Goldberg restore complete', 'Restauration GBE/Goldberg terminée'),
                        message: t('restored-x-item-s', 'Restored {count} item(s).', '{count} élément(s) restauré(s).', { count: result.files.length }),
                        detail: formatGbeBackupDetail({ ...backup, manifest: result.manifest }, { ...backupGame, gameDir: result.gameDir }),
                        noLink: true,
                      });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'error',
                        title: t('gbe-goldberg-restore-failed', 'GBE/Goldberg restore failed', 'Échec de la restauration GBE/Goldberg'),
                        message: t('could-not-restore-this-gbe-goldberg-backup', 'Could not restore this GBE/Goldberg backup.', 'Impossible de restaurer cette sauvegarde GBE/Goldberg.'),
                        detail: formatErr(err),
                      });
                    }
                  },
                })
              );
            }

            // Ubisoft installs use Uplay R2 instead of the Steam GBE fix.
            if (!isLegitSteamOwned && !isNativeLauncher && !isUbisoftSource) {
              emulatorMenu.append(new MenuItem({ type: 'separator' }));
              emulatorMenu.append(
                new MenuItem({
                  icon: menuIcon('file-text.png'),
                  label: $('#game-list').attr('data-ctx-installgbe') || '',
                  async click() {
                    try {
                      // 1 — reuse the install folder discover() already found; only prompt when
                      // it's genuinely unknown (e.g. a manually-added custom-dir game).
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('select-install-folder-steam-api', "Select the game's install folder (where steam_api(64).dll should go)", "Sélectionne le dossier d'installation du jeu (où doit aller steam_api(64).dll)"),
                          buttonLabel: t('install-here', 'Install here', 'Installer ici'),
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }

                      // 1a — Create a portable restore point before any write step. CrakFiles remains
                      // the first actual fix applied, but the user can now undo the pre-fix
                      // steam_settings + steam_api(64).dll state from "Restore latest GBE/Goldberg backup".
                      setGameBoxBusy(self, t('backing-up-before-fix', 'Backing up before fix…', 'Sauvegarde avant fix…'));
                      const preFixBackup = createAutomaticGbeBackup({
                        appid,
                        gameDir,
                        steamSettings: game?.steamSettings,
                      });
                      const preFixBackupNote = preFixBackup && preFixBackup.backupDir
                        ? t('n-nbackup-before-fix-nx', '\n\nBackup before fix:\n{dir}', '\n\nSauvegarde avant fix:\n{dir}', { dir: preFixBackup.backupDir })
                        : t('n-nbackup-before-fix-no-existing-steam-settings-steam-api-found', '\n\nBackup before fix: no existing steam_settings / steam_api found.', '\n\nSauvegarde avant fix: aucun steam_settings / steam_api existant.');

                      // Apply a confident CrakFiles fix before the emulator repair.
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
                          setGameBoxBusy(self, t('checking-community-crack', 'Checking community crack…', 'Recherche d’un crack communautaire…'));
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
                            crackNote = t(
                              'ncommunity-crack-x-applied-x-file-s',
                              '\nCommunity crack: "{name}" applied ({count} file(s))',
                              '\nCrack communautaire : « {name} » appliqué ({count} fichier(s))',
                              { name: cf.entry?.name, count: (cf.files || []).length }
                            );
                            debug.log(`[${appid}] CrakFiles (manual emu fix): applied "${cf.entry?.name}" via "${cf.matchedName || game?.name}" (${(cf.files || []).length} file(s))`);
                          } else if (cf && cf.skipped && cf.reason === 'already-applied') {
                            crackApplied = true;
                            crackNote = t('ncommunity-crack-x-already-applied', '\nCommunity crack: "{name}" already applied', '\nCrack communautaire : « {name} » déjà appliqué', { name: cf.entry?.name });
                            debug.log(`[${appid}] CrakFiles (manual emu fix): already applied "${cf.entry?.name}" via "${cf.matchedName || game?.name}"`);
                          } else if (cf && cf.reason === 'pixeldrain-unavailable') {
                            // A crack matched but pixeldrain rate-limited it (captcha/paid) — can't be
                            // auto-fetched. Note it so the user knows to grab it manually; the emulator
                            // install still proceeds below.
                            crackNote = t(
                              'ncommunity-crack-found-but-pixeldrain-rate-limited-captcha-requi',
                              '\nCommunity crack found but pixeldrain-rate-limited (captcha required) — download it manually: {url}',
                              '\nCrack communautaire trouvé mais limité par pixeldrain (captcha requis) — à télécharger à la main : {url}',
                              { url: cf.href || '' }
                            );
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
                            title: t('identify-game-title', 'Identify the game (Steam AppID)', 'Identifier le jeu (AppID Steam)'),
                            message: t('which-game-is-x', 'Which game is "{name}"?', 'Quel jeu est « {name} » ?', { name: game.name }),
                            detail: t('pick-the-match-to-write-the-correct-steam-appid-txt-correct-achi', 'Pick the match to write the correct steam_appid.txt (correct achievements + DLCs), or skip.', 'Choisis la correspondance pour écrire le bon steam_appid.txt (succès + DLC corrects), ou ignore.'),
                            buttons: [...labels, t('skip', 'Skip', 'Ignorer')],
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
                      setGameBoxBusy(self, t('preparing', 'Preparing…', 'Préparation…'));
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
                        if (!/^[0-9]+$/.test(String(writableAppid || ''))) {
                          return '\n' + t('diagnosis-advanced-data-skipped', 'Advanced data: skipped (no numeric AppID)', 'Données avancées : ignorées (AppID numérique absent)');
                        }
                        let login = null;
                        if (emuCfg.login === 'steam') {
                          // Prefer the credentials saved in Settings → Emulator; only prompt for what's missing.
                          let user = emuCfg.loginAccountName;
                          let pass = emuCfg.loginPassword;
                          if (!user)
                            user = await promptText(
                              t('steam-username-throwaway-account-only', 'Steam username (THROWAWAY account only):', 'Identifiant Steam (COMPTE JETABLE uniquement) :'),
                              ''
                            );
                          if (!user) return '\n' + t('diagnosis-advanced-data-login-cancelled', 'Advanced data: login cancelled', 'Données avancées : connexion annulée');
                          if (!pass) pass = await promptText(t('steam-password', 'Steam password:', 'Mot de passe Steam :'), '', 'password');
                          if (!pass) return '\n' + t('diagnosis-advanced-data-login-cancelled', 'Advanced data: login cancelled', 'Données avancées : connexion annulée');
                          login = { username: user, password: pass };
                        }
                        try {
                          setGameBoxBusy(self, t('advanced-data-generate-emu-config', 'Advanced data (generate_emu_config)…', 'Données avancées (generate_emu_config)…'));
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
                          return (
                            '\n' +
                            t('diagnosis-advanced-data-merged', 'Advanced data: merged {count} extra file(s) (generate_emu_config {tag})', 'Données avancées : {count} fichier(s) supplémentaire(s) fusionné(s) (generate_emu_config {tag})', {
                              count: added,
                              tag: tool.tag || '',
                            })
                          );
                        } catch (e) {
                          return '\n' + t('diagnosis-advanced-data-failed', 'Advanced data: {error}', 'Données avancées : {error}', { error: e.message || e });
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
                          setGameBoxBusy(self, t('downloading-steamless', 'Downloading Steamless…', 'Téléchargement de Steamless…'));
                          const steamlessMod = require(path.join(appPath, 'parser/steamless.js'));
                          let stripped = false;
                          let reason = '';
                          try {
                            const cli = await steamlessMod.ensureSteamless({ cacheDir: path.join(getUserDataPath(), 'cache/steamless'), log: debug });
                            setGameBoxBusy(self, t('removing-drm', 'Removing DRM…', 'Retrait du DRM…'));
                            const r = await steamlessMod.stripDrm({ steamless: cli, exePath: detectedRuntimeExe.full, experimental: !!emuCfg.steamlessExperimental, log: debug });
                            stripped = !!(r && r.stripped);
                            reason = (r && r.reason) || '';
                          } catch (e) {
                            reason = e.message || String(e);
                            debug.log(`[${appid}] Steamless failed => ${e}`);
                          }
                          if (stripped) {
                            drmNote = t('ndrm-steamstub-removed-x', '\nDRM: SteamStub removed ({exe})', '\nDRM : SteamStub retiré ({exe})', { exe: path.basename(detectedRuntimeExe.full) });
                          } else if (hasSteamStub) {
                            drmNote = t('ndrm-steamstub-present-steamless-failed-x-the-plain-dll-may-not-', '\nDRM: SteamStub present, Steamless failed ({reason}); the plain DLL may not load', '\nDRM : SteamStub présent, Steamless a échoué ({reason}) ; la DLL seule risque de ne pas charger', { reason });
                          } else if (emuCfg.steamlessAutoUnpack) {
                            drmNote = t('ndrm-x', '\nDRM: {label}', '\nDRM : {label}', {
                              label: reason === 'no-steamstub' ? t('noSteamStub', 'no SteamStub', 'pas de SteamStub') : reason,
                            });
                          }
                        }
                      } catch (e) {
                        debug.log(`[${appid}] DRM auto-detect skipped => ${e}`);
                      }

                      // Download/cache the GBE Fork build (steam_api DLLs).
                      setGameBoxBusy(self, t('downloading-gbe-fork', 'Downloading GBE Fork…', 'Téléchargement de GBE Fork…'));
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
                        setGameBoxBusy(self, t('installing-the-dll', 'Installing the DLL…', 'Installation de la DLL…'));
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
                            setGameBoxBusy(self, t('steam-api-check-bypass', 'Steam API check bypass…', 'Contournement du contrôle API Steam…'));
                            const bypassDlls = await apiCheckBypass.ensureBypassDlls({ cacheDir: path.join(getUserDataPath(), 'cache/api_check_bypass'), log: debug });
                            const rb = apiCheckBypass.applyBypass({ gameDir, exePath: detectedRuntimeExe.full, dlls: bypassDlls, log: debug });
                            debug.log(`[${writableAppid}] Steam API check bypass: ${rb.applied ? `applied (${rb.dll})` : `skipped (${rb.reason})`}`);
                          } catch (e) {
                            debug.log(`[${writableAppid}] Steam API check bypass failed => ${e}`);
                          }
                        }
                        setGameBoxBusy(self, t('configuring-achievements-dlcs', 'Configuring (achievements + DLCs)…', 'Configuration (succès + DLC)…'));
                        let repairedDirs = 0;
                        const diagnosisLines = [];
                        const repairErrors = [];
                        for (const dir of dllDirs) {
                          const result = await diagnoseGoldbergSetup({ game, gameDir: dir, autoRepair: true, showDialog: false });
                          if (result.repaired) repairedDirs++;
                          if (result.repairError) repairErrors.push(`${dir}: ${result.repairError.message || result.repairError}`);
                          diagnosisLines.push(
                            t('diagnosis-dir-status-line', '{dir}: {status}', '{dir} : {status}', {
                              dir,
                              status: result.report.ok
                                ? t('diagnosis-dir-status-ok', 'ok', 'ok')
                                : t('diagnosis-dir-status-attention', 'needs attention', 'à vérifier'),
                            })
                          );
                        }
                        const regAdvNote = await runAdvanced(dllDirs.map((d) => path.join(d, 'steam_settings')));
                        const installedDlls = [...new Set(installResult.perDir.flatMap((d) => d.wrote))].join(', ') || 'steam_api64.dll';
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'info',
                          title: t('gbe-fork-installed', 'GBE Fork installed', 'GBE Fork installé'),
                          message: t('gbe-fork-installed-message', '{installed} installed to {count} location(s)', '{installed} installée(s) dans {count} emplacement(s)', {
                            installed: installedDlls,
                            count: installResult.installed,
                          }),
                          detail:
                            dllDirs.join('\n') +
                            '\n\n' +
                            t('diagnosis-version', 'Version: {version}', 'Version : {version}', {
                              version: dlls.tag || t('diagnosis-version-unknown', 'unknown', 'inconnue'),
                            }) +
                            (installResult.backedUp > 0
                              ? '\n' +
                                t('diagnosis-dlls-backed-up-locations', 'Existing dll(s) backed up as *.bak in {count} location(s)', 'Dll(s) existante(s) sauvegardée(s) en .bak dans {count} emplacement(s)', {
                                  count: installResult.backedUp,
                                })
                              : '') +
                            preFixBackupNote +
                            crackNote +
                            drmNote +
                            '\n\n' +
                            t('diagnosis-after-install', 'Diagnostic after install:', 'Diagnostic après installation :') +
                            '\n' +
                            diagnosisLines.join('\n') +
                            (repairedDirs > 0
                              ? '\n\n' +
                                t('diagnosis-auto-repaired-steam-settings', 'Auto-repaired steam_settings (schema + icons + DLCs) in {count} location(s)', 'steam_settings réparé automatiquement (schéma + icônes + DLC) dans {count} emplacement(s)', {
                                  count: repairedDirs,
                                })
                              : '') +
                            (repairErrors.length > 0
                              ? '\n' +
                                t('diagnosis-auto-repair-failed-for', 'Auto-repair failed for: {paths}', 'La réparation automatique a échoué pour : {paths}', {
                                  paths: repairErrors.join('; '),
                                })
                              : '') +
                            regAdvNote,
                          noLink: true,
                        });
                      }
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: t('gbe-fork-install-failed', 'GBE Fork install failed', 'Échec de l\'installation de GBE Fork'),
                        message: t('could-not-download-or-install-gbe-fork', 'Could not download or install GBE Fork.', 'Impossible de télécharger ou d\'installer GBE Fork.'),
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
                  icon: menuIcon('file-text.png'),
                  label: $('#game-list').attr('data-ctx-removedrm') || '',
                  async click() {
                    try {
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('select-game-install-folder', "Select the game's install folder", "Choisir le dossier d'installation du jeu"),
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
                        title: t('remove-steam-drm-steamless', 'Remove Steam DRM (Steamless)', 'Retirer le DRM Steam (Steamless)'),
                        message: exePath
                          ? t('remove-steamstub-from-x', 'Remove SteamStub from: {exe}?', 'Retirer le SteamStub de : {exe} ?', { exe: path.basename(exePath) })
                          : t('no-exe-detected-choose-one', 'No exe detected — choose one?', 'Aucun exe détecté — en choisir un ?'),
                        detail: t(
                          'steamless-detail',
                          'Modifies the game executable (the original is kept as .steamstub.bak). No effect if the game has no SteamStub DRM.',
                          "Modifie l'exécutable du jeu (l'original est conservé en .steamstub.bak). Sans effet si le jeu n'a pas de DRM SteamStub."
                        ),
                        buttons: [t('cancel', 'Cancel', 'Annuler'), t('choose-an-exe', 'Choose an .exe…', 'Choisir un .exe…'), t('remove-drm', 'Remove DRM', 'Retirer le DRM')],
                        defaultId: exePath ? 2 : 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm.response === 0) return;
                      if (confirm.response === 1) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('select-game-executable', 'Select the game executable', "Choisir l'exécutable du jeu"),
                          defaultPath: gameDir,
                          filters: [{ name: 'Executable', extensions: ['exe'] }],
                          properties: ['openFile', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        exePath = picked.filePaths[0];
                      }
                      if (!exePath) return;

                      setGameBoxBusy(self, t('downloading-steamless', 'Downloading Steamless…', 'Téléchargement de Steamless…'));
                      const steamlessMod = require(path.join(appPath, 'parser/steamless.js'));
                      const cli = await steamlessMod.ensureSteamless({ cacheDir: path.join(getUserDataPath(), 'cache/steamless'), log: debug });
                      setGameBoxBusy(self, t('removing-drm', 'Removing DRM…', 'Retrait du DRM…'));
                      const result = await steamlessMod.stripDrm({ steamless: cli, exePath, log: debug });

                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: result.stripped ? 'info' : 'warning',
                        title: t('steamless', 'Steamless'),
                        message: result.stripped
                          ? t('steamstub-drm-removed', 'SteamStub DRM removed.', 'DRM SteamStub retiré.')
                          : result.reason === 'no-steamstub'
                          ? t('no-steamstub-drm-detected-exe-left-unchanged', 'No SteamStub DRM detected — exe left unchanged.', 'Aucun DRM SteamStub détecté — exe inchangé.')
                          : t('drm-removal-failed', 'DRM removal failed.', 'Échec du retrait du DRM.'),
                        detail:
                          path.basename(exePath) +
                          (result.stripped ? `\n${t('original-kept-as', 'Original kept as:', 'Original conservé :')} ${path.basename(result.backup)}` : '') +
                          (result.reason && result.reason !== 'no-steamstub' && result.reason !== 'unpacked' ? `\n${result.reason}` : '') +
                          `\n\nSteamless ${cli.tag || ''}`,
                        noLink: true,
                      });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: t('steamless-failed', 'Steamless failed', 'Échec de Steamless'),
                        message: t('could-not-remove-the-steam-drm', 'Could not remove the Steam DRM.', 'Impossible de retirer le DRM Steam.'),
                        detail: `${err}`,
                      });
                    } finally {
                      clearGameBoxBusy(self);
                    }
                  },
                })
              );

              appendCrackFixItem();
            }
            }

            // Ubisoft/uPlay counterpart of the GBE Fork block above: maps the game to its Steam
            // equivalent, writes a matching achievements_schema.json for the Uplay R2 loader, and
            // redirects its save path into %AppData%\GSE Saves\<steamAppid> — already read by AW.
            if (isUbisoftSource) {
              if (emulatorMenu.items.length) {
                emulatorMenu.append(new MenuItem({ type: 'separator' }));
              }

              const diagnoseUplayR2Setup = async ({ game, gameDir, showDialog = true }) => {
                const report = uplayR2.diagnose({ gameDir, appid, name: game?.name });
                if (showDialog) {
                  const lines = [];
                  lines.push(
                    report.mapping
                      ? t('diagnosis-steam-appid', 'Steam AppID: {appid} ({name})', 'Steam AppID : {appid} ({name})', {
                          appid: report.mapping.steam_appid,
                          name: report.mapping.steam_name,
                        })
                      : t('diagnosis-steam-appid-not-resolved', 'Steam AppID: not resolved', 'Steam AppID : non résolu')
                  );
                  lines.push('');
                  for (const issue of report.issues) lines.push(`[${issue.level}] ${issue.code}: ${issue.message}`);
                  remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                    type: report.ok ? 'info' : 'warning',
                    title: t('uplay-r2-diagnosis-title', 'Uplay R2 diagnosis — {gameName}', 'Diagnostic Uplay R2 — {gameName}', { gameName: game?.name || appid }),
                    message: report.ok
                      ? t('setupLooksValid', 'Setup looks valid.', 'La configuration semble valide.')
                      : t('problemsWereDetected', 'Problems were detected.', 'Des problèmes ont été détectés.'),
                    detail: lines.join('\n'),
                    noLink: true,
                  });
                }
                return report;
              };

              emulatorMenu.append(
                new MenuItem({
                  icon: menuIcon('file-text.png'),
                  label:
                    $('#game-list').attr('data-ctx-installuplayr2') ||
                    t('apply-emulator-fix-uplay-r2', 'Apply emulator fix (Uplay R2)…', 'Appliquer le correctif émulateur (Uplay R2)…'),
                  async click() {
                    try {
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('select-install-folder-uplay-r2-loader', "Select the game's install folder (where the Uplay R2 loader .dll should go)", "Sélectionne le dossier d'installation du jeu (où doit aller la .dll du loader Uplay R2)"),
                          buttonLabel: t('install-here', 'Install here', 'Installer ici'),
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }

                      setGameBoxBusy(self, t('resolving-the-steam-equivalent', 'Resolving the Steam equivalent…', 'Résolution du jeu Steam…'));
                      const mapping = uplayR2.resolveSteamMapping({ appid, name: game?.name, gameDir });
                      if (!mapping) {
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'warning',
                          title: t('no-steam-equivalent-found', 'No Steam equivalent found', 'Jeu Steam introuvable'),
                          message: t('uplay-no-steam-match', 'This Ubisoft game has no known match in uplay-steam.json.', "Ce jeu Ubisoft n'a pas de correspondance connue dans uplay-steam.json."),
                          detail: t('the-uplay-r2-fix-needs-the-steam-version-of-the-game-to-fetch-th', 'The Uplay R2 fix needs the Steam version of the game to fetch the achievement schema.', 'Le fix Uplay R2 a besoin de la version Steam du jeu pour récupérer le schéma des succès.'),
                        });
                        return;
                      }

                      setGameBoxBusy(self, t('fetching-the-steam-schema', 'Fetching the Steam schema…', 'Récupération du schéma Steam…'));
                      let schema = null;
                      try {
                        schema = await steamParser.getGameData({
                          appID: mapping.steam_appid,
                          lang: app.config?.achievement?.lang || 'english',
                          showHidden: true,
                        });
                      } catch (e) {
                        debug.log(`[${appid}] uplayR2: getGameData failed => ${formatErr(e)}`);
                      }
                      const achList = (schema && schema.achievement && schema.achievement.list) || [];
                      const prefixInfo = uplayR2.derivePrefixedIds(achList);
                      if (!prefixInfo) {
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'warning',
                          title: t('unsupported-game', 'Unsupported game', 'Jeu non pris en charge'),
                          message: t('uplay-prefix-pattern-mismatch', "This game's Steam achievement names don't follow the required <prefix><digits> pattern.", 'Les noms de succès Steam de ce jeu ne suivent pas le format <préfixe><chiffres> requis.'),
                          detail: t('the-automatic-goldberg-uplay-r2-mapping-cannot-be-generated-for-', 'The automatic Goldberg Uplay R2 mapping cannot be generated for this game.', 'Le mappage automatique vers Goldberg Uplay R2 ne peut pas être généré pour ce jeu.'),
                        });
                        return;
                      }

                      // Most Ubisoft repacks already ship the Goldberg Uplay R2 loader — they just never
                      // configure its achievement half. Only fall back to the user-seeded dll cache when
                      // the game has no loader at all, so a game that already has one is fixable with an
                      // empty cache (all it needs is achievements_schema.json + the ini keys).
                      const emu = uplayR2.detectEmulator(gameDir);
                      const dllDirs = emu.dll.length > 0 ? [...new Set(emu.dll.map((f) => path.dirname(f)))] : [gameDir];
                      let installResult = { installed: 0, backedUp: 0 };
                      if (emu.dll.length === 0) {
                        setGameBoxBusy(self, t('installing-the-dll', 'Installing the DLL…', 'Installation de la DLL…'));
                        const cacheDir = path.join(getUserDataPath(), 'cache/uplayR2');
                        const dlls = uplayR2Installer.ensureEmulatorDlls({ cacheDir });
                        if (!dlls.seeded) {
                          remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                            type: 'warning',
                            title: t('uplay-r2-dll-not-seeded', 'Uplay R2 dll not seeded', 'DLL Uplay R2 manquantes'),
                            message: t('no-files-found-in-the-uplay-r2-cache', 'No files found in the Uplay R2 cache.', 'Aucun fichier trouvé dans le cache Uplay R2.'),
                            detail: t('copy-the-uplay-r2-loader-64-dll-upc-r2-loader-64-dll-files-into-', 'Copy the uplay_r2_loader(64).dll / upc_r2_loader(64).dll files into (one-time setup):\n{dir}', 'Copie une fois les fichiers uplay_r2_loader(64).dll / upc_r2_loader(64).dll dans :\n{dir}', { dir: cacheDir }),
                          });
                          remote.shell.openPath(cacheDir);
                          return;
                        }
                        installResult = uplayR2Installer.installDlls({ dllDirs, dlls, log: debug });
                      } else if (!uplayR2.inspectInstalledLoaders(emu.dll).supportsAchRedirect) {
                        // The game has a loader, but one too old to understand AchSaveType/AchSavePath.
                        // Everything still works on such a build (AW reads the emulator's own save
                        // folder), so this is an optional upgrade — and swapping a loader the game
                        // currently launches with is not something to do behind the user's back.
                        const cacheDir = path.join(getUserDataPath(), 'cache/uplayR2');
                        let cached = { seeded: false, files: {} };
                        try {
                          cached = uplayR2Installer.ensureEmulatorDlls({ cacheDir });
                        } catch (err) {
                          debug.log(`[${appid}] uplayR2: could not read the loader cache => ${formatErr(err)}`);
                        }
                        const betterCached = Object.values(cached.files || {}).some(
                          (file) => file && uplayR2.inspectLoader(file).supportsAchRedirect
                        );
                        if (betterCached) {
                          const choice = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                            type: 'question',
                            title: t('update-the-uplay-r2-loader', 'Update the Uplay R2 loader?', 'Mettre à jour le loader Uplay R2 ?'),
                            message: t('uplay-r2-old-loader-message', 'This game uses a loader too old to redirect achievements.', 'Ce jeu utilise un loader trop ancien pour rediriger les succès.'),
                            detail: t(
                              'uplay-r2-old-loader-detail',
                              "The fix works without updating: Achievement Watcher reads the emulator's own save folder.\n\nUpdating enables the redirect into GSE Saves, but replaces a DLL the game currently launches with (the original is kept as .bak).",
                              "Le correctif fonctionne sans mise à jour : Achievement Watcher lit le dossier de sauvegarde de l'émulateur.\n\nMettre à jour le loader permet la redirection vers GSE Saves, mais remplace une DLL avec laquelle le jeu se lance actuellement (l'originale est conservée en .bak)."
                            ),
                            buttons: [t('keep-current-loader', 'Keep the current loader', 'Garder le loader actuel'), t('update-loader', 'Update', 'Mettre à jour')],
                            defaultId: 0,
                            cancelId: 0,
                            noLink: true,
                          });
                          if (choice === 1) {
                            setGameBoxBusy(self, t('updating-the-dll', 'Updating the DLL…', 'Mise à jour de la DLL…'));
                            installResult = uplayR2Installer.installDlls({ dllDirs, dlls: cached, log: debug });
                          }
                        }
                      }

                      setGameBoxBusy(self, t('configuring-achievements', 'Configuring (achievements)…', 'Configuration (succès)…'));
                      const targetDir = dllDirs[0];
                      const summary = uplayR2.repair({
                        dir: targetDir,
                        steamAppid: mapping.steam_appid,
                        schema,
                        prefix: prefixInfo.prefix,
                        accountName: app.config?.general?.username,
                        language: app.config?.achievement?.lang,
                      });

                      const installedLabel =
                        installResult.installed > 0
                          ? t('dllsInstalled', '{count} dll(s) installed', '{count} dll(s) installée(s)', { count: installResult.installed })
                          : t('loaderAlreadyPresent', 'loader already present', 'loader déjà présent');
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: t('uplay-r2-installed', 'Uplay R2 installed', 'Uplay R2 installé'),
                        message: t('uplay-r2-installed-message', '{installedLabel} — {mapped} achievement(s) mapped', '{installedLabel} — {mapped} succès mappé(s)', {
                          installedLabel,
                          mapped: Object.keys(summary.achievementsSchemaJson).length,
                        }),
                        detail:
                          targetDir +
                          '\n\n' +
                          t('diagnosis-steam-appid', 'Steam AppID: {appid} ({name})', 'Steam AppID : {appid} ({name})', {
                            appid: mapping.steam_appid,
                            name: mapping.steam_name,
                          }) +
                          '\n' +
                          t('diagnosis-ach-key-prefix', 'AchKeyPrefix: {prefix}', 'AchKeyPrefix : {prefix}', {
                            prefix: prefixInfo.prefix || t('diagnosis-none-parenthesized', '(none)', '(aucun)'),
                          }) +
                          (installResult.backedUp > 0
                            ? '\n' + t('diagnosis-dlls-backed-up', 'Existing dll(s) backed up as *.bak', 'Dll(s) existante(s) sauvegardée(s) en .bak')
                            : '') +
                          (summary.backupDir
                            ? '\n' + t('diagnosis-config-backed-up', 'Previous config backed up: {path}', 'Configuration précédente sauvegardée : {path}', { path: summary.backupDir })
                            : ''),
                        noLink: true,
                      });

                      await diagnoseUplayR2Setup({ game, gameDir: targetDir, showDialog: false });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({
                        type: 'error',
                        title: t('uplay-r2-install-failed', 'Uplay R2 install failed', 'Échec de l\'installation de Uplay R2'),
                        message: t('could-not-install-or-configure-goldberg-uplay-r2', 'Could not install or configure Goldberg Uplay R2.', 'Impossible d\'installer ou de configurer Goldberg Uplay R2.'),
                        detail: formatErr(err),
                      });
                    } finally {
                      clearGameBoxBusy(self);
                    }
                  },
                })
              );

              emulatorMenu.append(
                new MenuItem({
                  icon: menuIcon('file-text.png'),
                  label:
                    $('#game-list').attr('data-ctx-diagnoseuplayr2') ||
                    t('diagnose-uplay-r2-setup', 'Diagnose Uplay R2 setup', 'Diagnostiquer la configuration Uplay R2'),
                  async click() {
                    try {
                      const game = list.find((g) => g.appid == appid);
                      let gameDir = game?.gameDir && fs.existsSync(game.gameDir) ? game.gameDir : null;
                      if (!gameDir) {
                        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
                          title: t('select-install-folder-uplay-r2-loader-diagnose', "Select the game's install folder (where the Uplay R2 loader .dll is)", "Sélectionne le dossier d'installation du jeu (où se trouve la .dll du loader Uplay R2)"),
                          buttonLabel: t('diagnose', 'Diagnose', 'Diagnostiquer'),
                          properties: ['openDirectory', 'dontAddToRecent'],
                        });
                        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
                        gameDir = picked.filePaths[0];
                      }
                      await diagnoseUplayR2Setup({ game, gameDir });
                    } catch (err) {
                      remote.dialog.showMessageBoxSync({ type: 'error', title: t('diagnose-failed', 'Diagnose failed', 'Échec du diagnostic'), message: t('could-not-diagnose-the-uplay-r2-setup', 'Could not diagnose the Uplay R2 setup.', 'Impossible de diagnostiquer la configuration Uplay R2.'), detail: `${err}` });
                    }
                  },
                })
              );

              // Undo the last fix. Every Uplay R2 repair snapshots the schema + ini files it is about
              // to overwrite, but nothing could read those back — the Steam side has had its
              // "restore a backup" entry from the start, which is most of why this submenu looked so
              // much thinner. Only offered when a snapshot actually exists.
              {
                const restoreDir = ctxGame?.gameDir && fs.existsSync(ctxGame.gameDir) ? ctxGame.gameDir : null;
                const backups = restoreDir ? uplayR2.listConfigBackups(restoreDir) : [];
                if (backups.length > 0) {
                  emulatorMenu.append(
                    new MenuItem({
                      icon: menuIcon('redo-alt.png'),
                      label:
                        $('#game-list').attr('data-ctx-restoreuplayr2') ||
                        t('restore-uplay-r2-config', 'Restore the previous Uplay R2 configuration…', 'Restaurer la configuration Uplay R2 précédente…'),
                      async click() {
                        try {
                          const latest = backups[0];
                          const confirmed = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                            type: 'question',
                            buttons: [t('restore', 'Restore', 'Restaurer'), t('cancel', 'Cancel', 'Annuler')],
                            defaultId: 0,
                            cancelId: 1,
                            title: t('restore-uplay-r2-title', 'Restore Uplay R2 configuration', 'Restaurer la configuration Uplay R2'),
                            message: t(
                              'restore-uplay-r2-message',
                              'Restore the snapshot taken before the last repair?',
                              'Restaurer la sauvegarde prise avant la dernière réparation ?'
                            ),
                            detail: `${latest.name}\n${latest.files.join('\n')}`,
                            noLink: true,
                          });
                          if (confirmed !== 0) return;
                          const result = uplayR2.restoreConfigBackup({ dir: restoreDir, backup: latest });
                          remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                            type: 'info',
                            title: t('restore-uplay-r2-title', 'Restore Uplay R2 configuration', 'Restaurer la configuration Uplay R2'),
                            message: t('restore-uplay-r2-done', 'Configuration restored.', 'Configuration restaurée.'),
                            detail: result.restored.join('\n'),
                            noLink: true,
                          });
                        } catch (err) {
                          remote.dialog.showMessageBoxSync({
                            type: 'error',
                            title: t('restore-failed', 'Restore failed', 'Échec de la restauration'),
                            message: t('could-not-restore-the-uplay-r2-setup', 'Could not restore the Uplay R2 configuration.', 'Impossible de restaurer la configuration Uplay R2.'),
                            detail: `${err}`,
                          });
                        }
                      },
                    })
                  );
                }
              }

              // A cracked Ubisoft game is exactly what the CrakFiles list is full of, and the entry
              // needs nothing Steam-specific — it was simply unreachable from this branch.
              appendCrackFixItem();

              emulatorMenu.append(new MenuItem({ type: 'separator' }));
              emulatorMenu.append(
                new MenuItem({
                  label: t('refresh-game-data', 'Refresh game data', 'Actualiser les données du jeu'),
                  click() {
                    app.onStart();
                  },
                })
              );
              if (ubisoftTools.steamAppid) {
                emulatorMenu.append(
                  new MenuItem({
                    label: `${t('copy-steam-appid', 'Copy Steam AppID', 'Copier l’AppID Steam')} (${ubisoftTools.steamAppid})`,
                    click() {
                      clipboard.writeText(ubisoftTools.steamAppid);
                    },
                  })
                );
              }
              if (ubisoftTools.uplayId) {
                emulatorMenu.append(
                  new MenuItem({
                    label: `${t('copy-ubisoft-product-id', 'Copy Ubisoft product ID', 'Copier l’ID produit Ubisoft')} (${ubisoftTools.uplayId})`,
                    click() {
                      clipboard.writeText(ubisoftTools.uplayId);
                    },
                  })
                );
              }
            }

            // Open the actual game install folder, when AW managed to resolve one (Goldberg/GBE scan
            // or name-based folder match).
            const gameForDir = list.find((g) => g.appid == appid);
            if (gameForDir?.gameDir && fs.existsSync(gameForDir.gameDir)) {
              folderMenu.append(
                new MenuItem({
                  icon: menuIcon('folder-open.png'),
                  label: $('#game-list').attr('data-ctx-installloc') || '',
                  click() {
                    remote.shell.openPath(gameForDir.gameDir);
                  },
                })
              );
            }

            // Keep the top-level menu short, while retaining the useful maintenance paths. Some
            // sources point at the save FILE itself, so reveal it rather than trying to open a file
            // as a folder.
            const revealDataPath = (target) => {
              try {
                if (!fs.existsSync(target)) return;
                if (fs.statSync(target).isDirectory()) remote.shell.openPath(target);
                else remote.shell.showItemInFolder(target);
              } catch (err) {
                debug.error(err);
              }
            };
            // A merged card can have several sources. Keep each real source available in one
            // submenu instead of silently picking a fallback or filling the parent menu with paths.
            const seenDataPaths = new Set();
            const dataPaths = (gameForDir?.dataPaths?.length ? gameForDir.dataPaths : [{ source: '', path: gameForDir?.dataPath }]).filter(
              (entry) => {
                if (!entry.path || seenDataPaths.has(entry.path) || !fs.existsSync(entry.path)) return false;
                seenDataPaths.add(entry.path);
                return true;
              }
            );
            if (dataPaths.length) {
              const dataMenu = new Menu();
              const segments = (folderPath) => folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
              const rootOf = (folderPath) => segments(folderPath).slice(-2)[0] || segments(folderPath).pop() || folderPath;
              const labels = dataPaths.map((entry) => entry.source || rootOf(entry.path));
              const labelCounts = labels.reduce((counts, label) => counts.set(label, (counts.get(label) || 0) + 1), new Map());
              dataPaths.forEach((entry, index) => {
                const label = labels[index];
                dataMenu.append(
                  new MenuItem({
                    icon: menuIcon('folder-open.png'),
                    label: labelCounts.get(label) > 1 ? `${label} — ${rootOf(entry.path)}` : label,
                    click: () => revealDataPath(entry.path),
                  })
                );
              });
              dataMenu.append(new MenuItem({ type: 'separator' }));
              dataMenu.append(
                new MenuItem({
                  label: t('copy-achievement-data-path', 'Copy achievement data path', 'Copier le chemin des données de succès'),
                  click() {
                    clipboard.writeText(dataPaths.map((entry) => entry.path).join('\r\n'));
                  },
                })
              );
              folderMenu.append(
                new MenuItem({
                  icon: menuIcon('folder-open.png'),
                  label: t('achievement-data-folders', 'Achievement data', 'Données de succès'),
                  submenu: dataMenu,
                })
              );
            }

            const cacheMenu = new Menu();
            cacheMenu.append(
              new MenuItem({
                icon: menuIcon('folder-open.png'),
                label: $('#game-list').attr('data-ctx-iconcache') || '',
                click() {
                  remote.shell.openPath(path.join(getUserDataPath(), 'steam_cache', 'icon', catalogAppid || `${appid}`));
                },
              })
            );
            cacheMenu.append(
              new MenuItem({
                icon: menuIcon('folder-open.png'),
                label: $('#game-list').attr('data-ctx-dbcache') || '',
                click() {
                  remote.shell.showItemInFolder(
                    path.join(getUserDataPath(), 'steam_cache', 'schema', `${app.config.achievement.lang}`, `${catalogAppid || appid}.db`)
                  );
                },
              })
            );
            folderMenu.append(
              new MenuItem({
                icon: menuIcon('folder-open.png'),
                label: t('cache-folders', 'Caches', 'Caches'),
                submenu: cacheMenu,
              })
            );

            // Catalog links use the mapped Steam appid for Ubisoft records (including namespaced
            // uplay-<productId> official entries). Never emit broken URLs with a local/native id.
            if (/^[0-9]+$/.test(catalogAppid)) {
              linkMenu.append(
                new MenuItem({
                  icon: menuIcon('globe.png'),
                  label: 'Steam',
                  click() {
                    remote.shell.openExternal(`https://store.steampowered.com/app/${catalogAppid}/`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: menuIcon('globe.png'),
                  label: 'SteamDB',
                  click() {
                    remote.shell.openExternal(`https://steamdb.info/app/${catalogAppid}/`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: menuIcon('globe.png'),
                  label: 'PCGamingWiki',
                  click() {
                    remote.shell.openExternal(`https://pcgamingwiki.com/api/appid.php?appid=${catalogAppid}`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: menuIcon('globe.png'),
                  label: 'SteamHunters',
                  click() {
                    remote.shell.openExternal(`https://steamhunters.com/apps/${catalogAppid}/achievements`);
                  },
                })
              );
              linkMenu.append(
                new MenuItem({
                  icon: menuIcon('globe.png'),
                  label: 'Steam Community',
                  click() {
                    remote.shell.openExternal(`https://steamcommunity.com/app/${catalogAppid}/guides/`);
                  },
                })
              );
            }

            // Platform metadata links: non-Steam sources get a
            // store/search page plus PCGamingWiki instead of Steam-only links.
            const linkGame = list.find((g) => g.appid == appid);
            const linkName = encodeURIComponent((linkGame && linkGame.name) || '');
            const sourceLower = String((linkGame && linkGame.source) || '').toLowerCase();
            const globeIcon = () => menuIcon('globe.png');
            const hasLink = (label) => linkMenu.items.some((item) => item.label === label);
            const addPcgw = (label) => {
              if (hasLink(label)) return;
              linkMenu.append(
                new MenuItem({
                  icon: globeIcon(),
                  label,
                  click() {
                    remote.shell.openExternal(`https://pcgamingwiki.com/w/index.php?search=${linkName}`);
                  },
                })
              );
            };
            if (linkName) {
              if (sourceLower.startsWith('epic')) {
                linkMenu.append(
                  new MenuItem({
                    icon: globeIcon(),
                    label: 'Epic Games Store',
                    click() {
                      remote.shell.openExternal(`https://store.epicgames.com/search?q=${linkName}`);
                    },
                  })
                );
                addPcgw('PCGamingWiki');
              } else if (sourceLower.startsWith('gog')) {
                linkMenu.append(
                  new MenuItem({
                    icon: globeIcon(),
                    label: 'GOG',
                    click() {
                      remote.shell.openExternal(`https://www.gog.com/games?search=${linkName}`);
                    },
                  })
                );
                addPcgw('PCGamingWiki');
              } else if (sourceLower === 'ea') {
                linkMenu.append(
                  new MenuItem({
                    icon: globeIcon(),
                    label: 'EA',
                    click() {
                      remote.shell.openExternal(`https://www.ea.com/search?q=${linkName}`);
                    },
                  })
                );
                addPcgw('PCGamingWiki');
              } else if (sourceLower.includes('rpcs3')) {
                linkMenu.append(
                  new MenuItem({
                    icon: globeIcon(),
                    label: 'RPCS3 Wiki',
                    click() {
                      remote.shell.openExternal(`https://wiki.rpcs3.net/index.php?search=${linkName}`);
                    },
                  })
                );
                addPcgw('PCGamingWiki');
              } else if (sourceLower.includes('shadps4') || sourceLower.includes('xenia')) {
                addPcgw('PCGamingWiki');
              } else if (sourceLower.includes('uplay') || sourceLower === 'lumaplay' || sourceLower.includes('ubisoft')) {
                linkMenu.append(
                  new MenuItem({
                    icon: globeIcon(),
                    label: 'Ubisoft Store',
                    click() {
                      remote.shell.openExternal(`https://store.ubi.com/us/search?q=${linkName}`);
                    },
                  })
                );
                addPcgw('PCGamingWiki');
              }
            }
          }

          // ---- Uninstall (opt-in via Settings > General) ----
          if (app.config?.general?.uninstallContextMenu !== false) {
            const uninstallCtx = $('#game-list');
            const uninstallGame = list.find((g) => g.appid == appid);
            const uninstallDir =
              uninstallGame && uninstallGame.gameDir && fs.existsSync(uninstallGame.gameDir)
                ? path.resolve(uninstallGame.gameDir)
                : null;
            const uninstallMenu = new Menu();
            let uninstallEntries = 0;

            // 1) Steam client uninstall (steam://uninstall/<appid>) — offered for real
            //    Steam-owned games, or any numeric AppID the Steam client confirms as
            //    installed (covers GreenLuma-style libraries too).
            const steamUrl = uninstall.steamUninstallUrl(catalogAppid);
            if (steamUrl) {
              const steamInfo = uninstall.getSteamUninstallInfo(catalogAppid);
              if (isLegitSteamOwned || steamInfo.installed === true) {
                uninstallMenu.append(
                  new MenuItem({
                    icon: menuIcon('steam.png'),
                    label: uninstallCtx.attr('data-ctx-uninstall-steam') || (t('uninstall-via-steam', 'Uninstall via Steam…', 'Désinstaller via Steam…')),
                    async click() {
                      const gameName = list.find((g) => g.appid == appid)?.name || String(appid);
                      const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                        type: 'warning',
                        title: t('uninstall-via-steam', 'Uninstall via Steam', 'Désinstaller via Steam'),
                        message: t('uninstall-x-via-steam', 'Uninstall "{name}" via Steam?', 'Désinstaller « {name} » via Steam ?', { name: gameName }),
                        detail: t(
                          'steam-uninstall-detail',
                          "Steam will remove the game's local files. You can reinstall it later from your library.",
                          'Steam supprimera les fichiers locaux du jeu. Tu pourras le réinstaller plus tard depuis ta bibliothèque.'
                        ),
                        buttons: [t('cancel', 'Cancel', 'Annuler'), t('uninstall', 'Uninstall', 'Désinstaller')],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm.response !== 1) return;
                      try {
                        await remote.shell.openExternal(steamUrl);
                      } catch (err) {
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'error',
                          title: t('steam-uninstall-failed', 'Steam uninstall failed', 'Échec de la désinstallation Steam'),
                          message: t('steam-uninstall-open-failed', 'Could not open Steam to uninstall this game.', "Impossible d'ouvrir Steam pour désinstaller ce jeu."),
                          detail: formatErr(err),
                        });
                        return;
                      }
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: t('steam-opened', 'Steam opened', 'Steam ouvert'),
                        message: t('steam-will-handle-the-uninstall-the-game-list-will-refresh-autom', 'Steam will handle the uninstall. The game list will refresh automatically.', 'Steam va gérer la désinstallation. La liste se rafraîchira automatiquement.'),
                        noLink: true,
                      });
                      if (uninstallDir) {
                        pollUninstallCompletion({ appid: catalogAppid, gameDir: uninstallDir, mode: 'steam' });
                      } else {
                        // No local folder to watch and the registry may be unavailable:
                        // give Steam a moment, then refresh once.
                        setTimeout(() => app.onStart(), 12000);
                      }
                    },
                  })
                );
                uninstallEntries++;
              }
            }

            // 2) Local uninstaller / folder removal — never for legit Steam games
            //    (Steam owns those files and should be the one removing them).
            if (uninstallDir && !isLegitSteamOwned) {
              const local = uninstall.findLocalUninstaller(uninstallDir);
              if (local) {
                uninstallMenu.append(
                  new MenuItem({
                    icon: menuIcon('file-text.png'),
                    label: uninstallCtx.attr('data-ctx-uninstall-run') || (t('run-game-uninstaller', 'Run game uninstaller…', 'Lancer le désinstalleur du jeu…')),
                    async click() {
                      const gameName = list.find((g) => g.appid == appid)?.name || String(appid);
                      const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                        type: 'warning',
                        title: t('uninstall-game', 'Uninstall game', 'Désinstaller le jeu'),
                        message: t('uninstall-x-with-x', 'Uninstall "{name}" with {uninstaller}?', 'Désinstaller « {name} » avec {uninstaller} ?', { name: gameName, uninstaller: local.name }),
                        detail:
                          uninstallDir +
                          (local.silent
                            ? t('n-nthe-uninstaller-will-run-in-silent-mode', '\n\nThe uninstaller will run in silent mode.', '\n\nLe désinstalleur s’exécutera en mode silencieux.')
                            : t('n-nno-reliable-silent-mode-was-detected-follow-the-uninstaller-p', '\n\nNo reliable silent mode was detected: follow the uninstaller prompts.', '\n\nAucun mode silencieux fiable n’a été détecté : suis les invites du désinstalleur.')),
                        buttons: [t('cancel', 'Cancel', 'Annuler'), t('uninstall', 'Uninstall', 'Désinstaller')],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm.response !== 1) return;
                      // The tile stays busy for as long as the uninstaller runs, so a silent
                      // uninstall (no window of its own) is not mistaken for nothing happening.
                      setGameBoxBusy(self, t('uninstalling-game', 'Uninstalling…', 'Désinstallation…'));
                      let child;
                      try {
                        child = spawn(local.file, local.args, { cwd: uninstallDir, detached: true, stdio: 'ignore' });
                      } catch (err) {
                        clearGameBoxBusy(self);
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'error',
                          title: t('launch-failed', 'Launch failed', 'Échec du lancement'),
                          message: t('could-not-launch-the-uninstaller', 'Could not launch the uninstaller.', 'Impossible de lancer le désinstalleur.'),
                          detail: formatErr(err),
                        });
                        return;
                      }
                      child.on('error', (err) => {
                        debug.warn(`[uninstall] ${local.file} => ${formatErr(err)}`);
                        clearGameBoxBusy(self);
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'error',
                          title: t('launch-failed', 'Launch failed', 'Échec du lancement'),
                          message: t('could-not-launch-the-uninstaller', 'Could not launch the uninstaller.', 'Impossible de lancer le désinstalleur.'),
                          detail: formatErr(err),
                        });
                      });
                      // Refresh after the uninstaller exits; clean up silent temp files on success.
                      child.on('exit', (code) => {
                        if (code === 0) uninstall.cleanupSilentUninstaller(local);
                        clearGameBoxBusy(self);
                        setTimeout(() => app.onStart(), 1500);
                      });
                      child.unref();
                      remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                        type: 'info',
                        title: t('uninstall-started', 'Uninstall started', 'Désinstallation lancée'),
                        message: t('the-uninstaller-was-started-the-game-list-will-refresh-automatic', 'The uninstaller was started. The game list will refresh automatically.', 'Le désinstalleur a été lancé. La liste se rafraîchira automatiquement.'),
                        noLink: true,
                      });
                      pollUninstallCompletion({ appid, gameDir: uninstallDir, mode: 'local' });
                    },
                  })
                );
                uninstallEntries++;
              } else if (uninstall.isSafeTrashTarget(uninstallDir)) {
                uninstallMenu.append(
                  new MenuItem({
                    icon: menuIcon('folder-open.png'),
                    label:
                      uninstallCtx.attr('data-ctx-uninstall-delete') ||
                      (t('delete-game-folder-recycle-bin', 'Delete game folder (Recycle Bin)…', 'Supprimer le dossier du jeu (Corbeille)…')),
                    async click() {
                      const gameName = list.find((g) => g.appid == appid)?.name || String(appid);
                      const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
                        type: 'warning',
                        title: t('delete-game-folder', 'Delete game folder', 'Supprimer le dossier du jeu'),
                        message: t('move-x-s-folder-to-the-recycle-bin', 'Move "{name}"\'s folder to the Recycle Bin?', 'Déplacer le dossier de « {name} » vers la Corbeille ?', { name: gameName }),
                        detail:
                          uninstallDir +
                          (t('n-nno-uninstaller-was-found-in-this-folder-the-files-will-be-mov', '\n\nNo uninstaller was found in this folder. The files will be moved to the Recycle Bin (recoverable).', '\n\nAucun désinstalleur n’a été trouvé dans ce dossier. Les fichiers seront déplacés vers la Corbeille (récupérables).')),
                        buttons: [t('cancel', 'Cancel', 'Annuler'), t('delete', 'Delete', 'Supprimer')],
                        defaultId: 1,
                        cancelId: 0,
                        noLink: true,
                      });
                      if (confirm.response !== 1) return;
                      // Moving a game folder to the Recycle Bin takes as long as the folder is big,
                      // and the tile gave no sign of it — the same spinner the emulator fix uses says
                      // the work started and is still going.
                      setGameBoxBusy(self, t('deleting-game-folder', 'Moving to the Recycle Bin…', 'Déplacement vers la Corbeille…'));
                      try {
                        await remote.shell.trashItem(uninstallDir);
                      } catch (err) {
                        clearGameBoxBusy(self);
                        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                          type: 'error',
                          title: t('delete-failed', 'Delete failed', 'Échec de la suppression'),
                          message: t('could-not-move-the-folder-to-the-recycle-bin', 'Could not move the folder to the Recycle Bin.', 'Impossible de déplacer le dossier vers la Corbeille.'),
                          detail: formatErr(err),
                        });
                        return;
                      }
                      clearGameBoxBusy(self);
                      app.onStart();
                    },
                  })
                );
                uninstallEntries++;
              }
            }

            if (uninstallEntries > 0) {
              gameMenu.append(new MenuItem({ type: 'separator' }));
              gameMenu.append(
                new MenuItem({
                  icon: menuIcon('cross.png'),
                  label: uninstallCtx.attr('data-ctx-uninstall-group') || (t('uninstall', 'Uninstall', 'Désinstaller')),
                  submenu: uninstallMenu,
                })
              );
            }
          }

          // Native Electron menu labels treat a lone "&" as an accelerator marker (swallowed at
          // render time), so a literal ampersand must be doubled ("&&"). Locale strings keep the
          // single "&" (they're also used in HTML); escape only here, at the native-menu boundary.
          const groupLabel = (attribute) => ($('#game-list').attr(attribute) || '').replace(/&/g, '&&');
          if (gameMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-game'), submenu: gameMenu }));
          if (emulatorMenu.items.length)
            menu.append(
              new MenuItem({
                label: isUbisoftSource ? 'Ubisoft Connect' : groupLabel('data-ctx-group-emulator'),
                submenu: emulatorMenu,
              })
            );
          if (folderMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-folders'), submenu: folderMenu }));
          if (linkMenu.items.length) menu.append(new MenuItem({ label: groupLabel('data-ctx-group-links'), submenu: linkMenu }));

          // ---- Cover art management (re-download / alternate AppID / local image) ----
          const coverGame = list.find((g) => g.appid == appid);
          if (coverGame) {
            const coverCacheAppid = catalogAppid || String(coverGame.steamappid || appid);
            const defaultCoverUrl = () => {
              const img = coverGame.img || {};
              return app.config?.achievement?.thumbnailPortrait
                ? img.portrait || img.header || img.landscape || null
                : img.header || img.landscape || img.portrait || null;
            };
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
                label: t('re-download-cover', 'Re-download cover', 'Retélécharger la jaquette'),
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
                label: t('chooseAnotherCover', 'Choose another cover…', 'Choisir une autre jaquette…'),
                click() {
                  openCoverPicker(coverGame, appid, coverCacheAppid);
                },
              })
            );
            coverMenu.append(
              new MenuItem({
                label: t('use-another-steam-appid', 'Use another Steam AppID…', 'Utiliser un autre AppID Steam…'),
                async click() {
                  const alt = await promptText(
                    t('steam-appid-to-pull-cover-art-from', 'Steam AppID to pull cover art from:', 'AppID Steam à utiliser pour la jaquette :'),
                    /^[0-9]+$/.test(coverCacheAppid) ? coverCacheAppid : ''
                  );
                  if (!alt || !/^[0-9]+$/.test(alt)) return;
                  let local = await ipcRenderer.invoke('fetch-icon', `https://cdn.cloudflare.steamstatic.com/steam/apps/${alt}/header.jpg`, appid);
                  if (!local)
                    local = await ipcRenderer.invoke('fetch-icon', `https://cdn.cloudflare.steamstatic.com/steam/apps/${alt}/library_600x900.jpg`, appid);
                  if (!local) {
                    remote.dialog.showMessageBox({ type: 'warning', message: t('no-steam-cover-art-for-appid', 'No Steam cover art found for AppID {appid}.', 'Aucune jaquette Steam trouvée pour l\'AppID {appid}.', { appid: alt }) });
                    return;
                  }
                  local = coverStore.persist(appid, local, getUserDataPath());
                  if (!local) throw new Error('downloaded cover could not be persisted');
                  reloadCoverOverrides();
                  applyCoverBackground(appid, local);
                },
              })
            );
            coverMenu.append(
              new MenuItem({
                label: t('choose-local-image', 'Choose local image…', 'Choisir une image locale…'),
                click() {
                  const files = remote.dialog.showOpenDialogSync({
                    title: t('choose-cover-image', 'Choose cover image', 'Choisir une jaquette'),
                    properties: ['openFile'],
                    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
                  });
                  if (!files || !files[0]) return;
                  try {
                    const url = coverStore.persist(appid, pathToFileURL(files[0]).href, getUserDataPath());
                    if (!url) throw new Error('selected image could not be persisted');
                    reloadCoverOverrides();
                    applyCoverBackground(appid, url);
                  } catch (err) {
                    debug.warn(`[cover] local image failed => ${err}`);
                    remote.dialog.showMessageBox({ type: 'error', message: t('could-not-set-cover', 'Could not set cover: {error}', 'Impossible de définir la jaquette : {error}', { error: err.message || err }) });
                  }
                },
              })
            );
            if (coverOverrideFor(appid)) {
              coverMenu.append(new MenuItem({ type: 'separator' }));
              coverMenu.append(
                new MenuItem({
                  label: t('reset-cover-to-default', 'Reset cover to default', 'Réinitialiser la jaquette'),
                  async click() {
                    coverStore.remove(appid);
                    reloadCoverOverrides();
                    await refetchDefaultCover();
                  },
                })
              );
            }
            menu.append(new MenuItem({ label: groupLabel('data-ctx-group-cover'), submenu: coverMenu }));
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
        setLibraryBusyCursor(false);
        clearSkeletonTiles();
        $('#game-list .isEmpty').show();
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
          message: t('game-list-generation-failure', 'Game list generation failure', 'Échec de la génération de la liste des jeux'),
          detail: `${err}`,
        });
      })
      .finally(() => {
        $('#user-info').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('#sort-box').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('#search-bar').fadeTo('fast', 1).css('pointer-events', 'initial');
        $('title-bar')[0].inSettings = false;
      });
    self.listLoadPromise = listLoadPromise;
    return listLoadPromise;
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

    // Merge manually-unlocked achievements (user overrides) before anything renders, so the header
    // counters, unlocked/locked lists and sorting all reflect them consistently.
    manualUnlock.loadAndApplyToGame(game, game.appid, game.source);

    if (self.data('time') > 0) $('#unlock > .header .sort-ach .sort.time').addClass('show');

    $('#search-bar-float input[type=search]').val('').blur().removeClass('has'); //reset

    $('#home').fadeOut(function () {
      $('body').fadeIn().css('background', `url('../resources/img/ach_background.jpg')`);
      if (game.img.background) {
        ipcRenderer.invoke('fetch-icon', game.img.background, game.steamappid || game.appid).then((localPath) => {
          if (game.system === 'uplay' || game.img?.overlay === true) {
            let gradient = `linear-gradient(to bottom right, color-mix(in srgb, var(--bg-base) 88%, black) 0%, color-mix(in srgb, var(--bg-glow) 78%, black) 100%)`;
            $('body').fadeIn().attr('style', `background: ${gradient}, ${cssUrl(localPath)}`);
          } else {
            $('body').fadeIn().css('background', cssUrl(localPath));
          }
        });
      }

      // Mark which game the detail view is currently showing, so a live unlock toast only
      // refreshes this page when it belongs to the game on screen (see updateGamePage).
      $('#achievement .wrapper > .header').attr('data-appid', game.appid);
      $('#achievement .wrapper > .header').attr('data-source', game.source || '');

      if (game.system) {
        $('#achievement .wrapper > .header').attr('data-system', game.system);
      } else {
        $('#achievement .wrapper > .header').removeAttr('data-system');
      }

      // Steam doesn't set a "clienticon" for every app (notably brand-new releases — their store
      // page/product info simply has no icon hash yet), which used to leave this box empty. Fall
      // back to the header/portrait art so there's always something recognizable to show.
      const headerIconSource = game.img.icon || game.img.header || game.img.portrait;
      const iconEl = $('#achievement .wrapper > .header .title .icon');
      // The icon element is shared across game pages. When this game has no artwork at all it must
      // be reset to the neutral CSS surface — otherwise the previous game's icon stays behind,
      // which reads as "this page belongs to another game" (issue #15).
      const resetIconToPlaceholder = () => iconEl.css('background', '');
      if (headerIconSource) {
        iconEl.css('background', cssUrl(pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href));
        ipcRenderer.invoke('fetch-icon', headerIconSource, game.steamappid || game.appid).then((localPath) => {
          if (localPath) iconEl.css('background', cssUrl(localPath));
          else resetIconToPlaceholder();
        }).catch(() => resetIconToPlaceholder());
      } else {
        resetIconToPlaceholder();
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
      // PlayStation emulators have no per-game process to attribute; every other source (Steam,
      // official Ubisoft Connect, Uplay R2, Epic, GOG, EA, Xbox PC, ...) can be tracked by exe.
      if (game.system !== 'playstation') {
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

                         <div class="achievement${achievement.manual ? ' manual' : ''}" data-name="${escapeHtml(achievement.name)}" data-index="${i}" data-achieved="${
          achievement.Achieved ? 1 : 0
        }" data-manual="${achievement.manual ? 1 : 0}" title="${achievement.manual ? escapeHtml($('#achievement .achievement-list').attr('data-lang-manualUnlocked') || t('manuallyUnlocked', 'Manually unlocked', 'Débloqué manuellement')) : ''}">
                            <div class="box">
                              <div class="glow mask contain">
                                  <div class="glow mask ray ">
                                    <div class="glow fx"></div>
                                  </div>
                              </div>
                              <div class="icon" id="achievement-${String(achievement.name)
                                .replace(/\s+/g, '_')
                                .replace(/[^\w\-]/g, '')}" style="background: ${cssUrl(
          pathToFileURL(path.join(appPath, 'resources/img/loading.gif')).href
        )};"></div>
                            </div>
                            <div class="content">
                                <div class="title">${
                                  game.system === 'playstation'
                                    ? `<i class="fas fa-trophy" data-type="${escapeHtml(achievement.type)}"></i> ${escapeHtml(achievement.displayName)}`
                                    : `${escapeHtml(achievement.displayName)}`
                                }</div>
                                ${
                                  achievement.category
                                    ? `<div class="ach-category">${escapeHtml(achievement.category)}</div>`
                                    : ''
                                }
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
            $(selector).css('background', cssUrl(imagePath));
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
        const title = t('no-steam-achievements-found', 'No Steam achievements found', 'Aucun succès Steam trouvé');
        const detail = game.unconfigured
          ? t('no-ach-unconfigured', 'This folder does not have a Goldberg/GBE setup with a reliable Steam AppID yet.', "Ce dossier n'a pas encore de configuration Goldberg/GBE avec un AppID Steam fiable.")
          : t('no-ach-no-schema', 'AW can show the game, but Steam did not provide an achievement schema for this AppID.', 'AW affiche le jeu, mais Steam ne fournit aucun schéma de succès pour cet AppID.');
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

      // Reconciled rarity: any source that maps to Steam (Uplay R2, official Ubisoft via the id
      // bridge, Epic-with-Steam-release) gets the same Steam community column and refresh path as a
      // native Steam game. Console emulators keep Exophase (trophy icon), Xbox PC paints its import
      // cache, and sources without any percentage source (EA) keep the column hidden.
      const rarityContext = resolveGameRarityContext(game, { emulatorSources: EMU_LOCAL_ICON_SOURCES });
      if (!rarityContext) {
        $('.achievement .stats .community').hide();
      } else {
        $('.achievement .stats .community').show();
        $('.achievement .stats .community i').attr(
          'class',
          rarityContext.kind === 'emulator' ? 'fas fa-trophy' : 'fab fa-steam'
        );
        if (rarityContext.kind === 'xbox') {
          // Rarity was cached at import time on each schema entry — paint it directly, no network.
          const entries = (game.achievement.list || [])
            .filter((a) => a && a.rarityPct != null && Number.isFinite(Number(a.rarityPct)))
            .map((a) => ({ name: a.name, percent: Number(a.rarityPct) }));
          applyRarity(entries);
        } else if (rarityContext.kind === 'steam-bridge') {
          getGlobalStat(rarityContext.cacheId, 'steam-bridge', game.name, game.achievement.list, rarityContext);
        } else if (rarityContext.kind === 'emulator') {
          getGlobalStat(game.appid, rarityContext.source, game.name, game.achievement.list);
        } else if (rarityContext.kind === 'steam') {
          getGlobalStat(rarityContext.appid, 'steam', game.name, game.achievement.list);
        } else {
          getGlobalStat(rarityContext.appid, rarityContext.source, game.name, game.achievement.list);
        }
      }

      $('#achievement').fadeIn(600, function () {
        if (app.args.appid && app.args.name) {
          let target = elem.find(`.achievement[data-name="${stripTags(app.args.name.toString())}"]`).parent('li');
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
  // Mark/clear a manually-unlocked achievement (right-click on an achievement row) and re-render
  // the current game view so counters/lists reflect the override immediately.
  manualUnlockAction: async function (appid, source, name, action) {
    try {
      const result = manualUnlock.saveUpdate(appid, source, name, action);
      if (!result.changed) return result;
      const box = $('#game-list .game-box')
        .filter(function () {
          return String($(this).data('appid')) === String(appid);
        })
        .first();
      if (box.length && typeof this.onGameBoxClick === 'function') {
        // Re-rendering the detail view is what re-applies the overrides to the in-memory game, so
        // the tile and the header counters are refreshed from it afterwards — otherwise the library
        // kept showing the percentage from the last full scan.
        this.onGameBoxClick(box, gameList);
      }
      refreshLibraryProgressFor(appid, gameList);
      return result;
    } catch (err) {
      debug.warn(`[manualUnlock] ${err && err.stack ? err.stack : err}`);
      return { changed: false };
    }
  },
  onPlayButtonClick: async function (self) {
    let appid = self.closest('.game-box').data('appid');
    let cfg = await exeList.get(appid);
    if (!cfg?.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) {
      const game = gameList.find((g) => g.appid == appid);
      let detected =
        game && game.exe && game.exeConfident && fs.existsSync(game.exe)
          ? game.exe
          : autodetectGameExe(game?.gameDir, game?.name, await takenExePaths(appid));
      if (detected) {
        cfg.exe = detected;
        await exeList.add(cfg);
      }
    }
    if (!cfg?.exe || cfg.exe === '' || !fs.existsSync(cfg.exe)) {
      let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: t('choose-the-game-executable', 'Choose the game executable', 'Choisir l\'exécutable du jeu'),
        buttonLabel: t('select', 'Select', 'Sélectionner'),
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
          title: t('launch-failed', 'Launch failed', 'Échec du lancement'),
          message: t('could-not-start-the-game', 'Could not start the game.', 'Impossible de démarrer le jeu.'),
          detail: `${error}`,
        });
      };
      try {
        // args_split (argv-split) strips the quotes it uses for grouping; the hand-rolled regex that
        // used to live here kept them, and since spawn() runs without a shell Node re-quoted the token,
        // so a game asked for -savedir "D:\My Games\Save" received the literal quotes as part of the path.
        let game = spawn(cfg.exe, splitLaunchArgs(cfg.args, (m) => debug.log(m)), {
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
      let detected =
        game && game.exe && game.exeConfident && fs.existsSync(game.exe)
          ? game.exe
          : autodetectGameExe(game?.gameDir, game?.name, await takenExePaths(appid));
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
      // Apply the saved app theme before anything renders (Settings > General > Theme).
      const savedTheme = app.config.general?.theme || 'default';
      const isUserTheme = userThemes.parseValue(savedTheme) !== null;
      document.documentElement.dataset.theme = isUserTheme || savedTheme === 'custom' ? 'default' : savedTheme;
      userThemes.applyCss('');
      ipcRenderer
        .invoke('get-theme-payload')
        .then((payload) => {
          if (!payload) return;
          const css = [payload.appCss || '', payload.userCss || ''].join('\n');
          userThemes.applyCss(css);
        })
        .catch(() => userThemes.applyCss(''));

      // Game executable configuration modal: localize the static strings that the
      // i18n loader does not bind (title, launch arguments, placeholder, actions).
      try {
        $('#game-config-title').text(t('game-config-title', 'Executable configuration', "Configuration de l'exécutable"));
        $('#launch-args-label').html(
          `<i class="fas fa-terminal"></i> ${t('launch-args-label', 'Launch arguments:', 'Arguments de lancement :')}`
        );
        $('#game-config .constant').attr(
          'data-placeholder',
          t('game-config-placeholder', '…Click EDIT to choose the executable…', '…Cliquez sur MODIFIER pour choisir l’exécutable…')
        );
        $('#game-config .unlink').attr('title', t('game-config-unlink', 'Unlink executable', "Dissocier l'exécutable"));
      } catch (err) {
        debug.log(`game-config i18n failed: ${err}`);
      }

      // On a genuine first run, defer the initial library scan until the onboarding guide is done:
      // onboarding lets the user set their profile (and game folders), and finish()/skip()
      // trigger the first scan via resetUI()/onStart(). Scanning here too would run a duplicate
      // pass before the user has chosen folders or sources.
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
          result.text(t('no-detected-game-with-a-known-install-folder-to-fix', 'No detected game with a known install folder to fix.', 'Aucun jeu détecté avec un dossier d’installation connu à réparer.'));
          return;
        }
        const confirm = await remote.dialog.showMessageBox(remote.getCurrentWindow(), {
          type: 'question',
          buttons: [t('fix-all', 'Fix all', 'Réparer tous'), t('cancel', 'Cancel', 'Annuler')],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: t('fix-all-games', 'Fix all games', 'Réparer tous les jeux'),
          message: t(
            'apply-the-emulator-fix-to-x-detected-game-s-existing-files-are-b',
            'Apply the emulator fix to {count} detected game(s)? Existing files are backed up before being overwritten.',
            'Appliquer le fix émulateur à {count} jeu(x) détecté(s) ? Les fichiers existants sont sauvegardés avant d’être écrasés.',
            { count: targets.length }
          ),
        });
        if (confirm.response !== 0) return;

        fixAllRunning = true;
        $(this).css('pointer-events', 'none');
        let fixed = 0;
        let failed = 0;
        for (let i = 0; i < targets.length; i++) {
          const game = targets[i];
          result.text((t('fixing', 'Fixing', 'Réparation')) + ` ${i + 1} / ${targets.length} — ${game.name}`);
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
                fetchDlc: (id) => steamParser.getDLCList(id),
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
          t('done-x-game-s-fixed-x-skipped-x-failed', 'Done — {fixed} game(s) fixed, {skipped} skipped, {failed} failed.', 'Terminé — {fixed} jeu(x) réparé(s), {skipped} ignoré(s), {failed} en échec.', { fixed, skipped, failed })
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
