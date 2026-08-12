'use strict';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  debug?.error?.(`Uncaught exception: ${err && err.stack ? err.stack : err}`); // safe optional chaining if debug isn’t loaded yet
  // The main process supervises and restarts the monitor.
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason);
  debug?.error?.(`Unhandled promise rejection: ${reason}`);
});

// Terminate the controller HID worker thread cleanly when the monitor is asked to stop.
for (const signal of ['SIGTERM', 'SIGINT']) {
  try {
    process.on(signal, () => {
      try {
        overlayControllerService?.shutdown('signal');
      } catch {}
      process.exit();
    });
  } catch {}
}

const debug = require('./util/log.js');
// Use a separate mutex from the legacy watchdog.
const instance = new (require('single-instance'))('Achievement Watchdog 3.0');
const { spawn, execFile } = require('child_process');
const path = require('path');
const watch = require('node-watch');
const tasklist = require('./util/tasklist');
const moment = require('moment');
const websocket = require('./websocket.js');
const processPriority = require('./util/priority.js');
const fs = require('fs');
const request = require('request-zero');
const settings = require('./settings.js');
const monitor = require('./monitor.js');
const parseWithRetry = require('./util/parseWithRetry.js');
const waitForFileStable = require('./util/waitForFileStable.js');
const uplayR2 = require('./util/uplayR2.js');
const notificationDedup = require('./util/notificationDedup.js');
const progressMute = require('./util/progressMute.js');
const rarity = require('./util/rarity.js');
const steam = require('./steam.js');
const track = require('./track.js');
const { mapStatProgressEntries } = require('./util/statProgress.js');
const { notificationVolumePercent } = require('./util/notificationVolume.js');
const playtimeMonitor = require('./playtime/monitor.js');
const { describeActiveGames } = require('./playtime/seed.js');
const xboxPc = require('./xboxPc.js');
const notify = require('./notification/toaster.js');
const shadps4Watch = require('./console/shadps4Watch.js');
const xeniaWatch = require('./console/xeniaWatch.js');
const eaWatch = require('./console/eaWatch.js');
const gogWatch = require('./console/gogWatch.js');
const ubisoftWatch = require('./console/ubisoftWatch.js');
const { isWinRTAvailable } = require('./util/powertoast');
const { isFullscreenAppRunning } = require('./queryUserNotificationState.js');
const GlobalHotkey = require('./util/globalHotkey.js');
const { createOverlayControllerService } = require('./console/controller/overlay-controller-service.js');
const humanizeDuration = require('humanize-duration');
const { resolvePowerShell } = require('./util/powershell.js');
const { sendEscapeToFocusedWindow } = require('./util/sendKey.js');
const toastIdentity = require('./util/toastIdentity.js');
const { userDataDir } = require('./util/userData.js');
const { steamHeaderImage, steamLibraryImage } = require('./util/steamArtwork.js');
const { findIndexedSocialClubGame } = require('./util/socialClub.js');
const notifyStrings = require('./util/notifyStrings.js');
const { spawnDetached } = require('./util/spawnDetached.js');
const { buildSchemaIndex, findSchemaAchievement, buildPreviousAchievementIndex } = require('./util/achievementIndex.js');
const { createIndexedGameLookup } = require('./util/indexedGameLookup.js');
const { runXboxPoll, matchesActiveXboxPoll } = require('./util/xboxPolling.js');

const cfg_file = {
  option: path.join(userDataDir(), 'cfg', 'options.ini'),
  userDir: path.join(userDataDir(), 'cfg', 'userdir.db'),
};

const appRoot = path.join(__dirname, '../');

let isDev = process.env.NODE_ENV === 'development';
let runningAppid;
let overlayOpened = false;
// The playtime monitor instance once init() resolves; used to reload the game index on request.
let playtimeMonitorEmitter = null;
let playtimeIndexReloadQueued = false;
let xboxPollState = null;
const XBOX_POLL_INTERVAL_MS = 30000;

// Poll Xbox PC achievements while a matching title runs.
function startXboxPolling(game) {
  stopXboxPolling();
  const auth = xboxPc.loadAuth();
  const titleId = xboxPc.normalizeTitleId(game && game.appid);
  if (!auth || !titleId) return;
  debug.log(`[xbox-pc] live polling started for ${game.name}(${titleId})`);
  const state = {
    appid: titleId,
    game,
    auth,
    snapshot: xboxPc.readState(titleId),
    timer: null,
    polling: false,
  };
  xboxPollState = state;
  const poll = async () => {
    let schema = null;
    let schemaList = [];
    await runXboxPoll({
      state,
      getCurrentState: () => xboxPollState,
      ensureSession: xboxPc.ensureSession,
      pollOnce: xboxPc.pollOnce,
      writeState: xboxPc.writeState,
      beforeNotifications: (newUnlocked) => {
        debug.log(`[xbox-pc] ${newUnlocked.length} new unlock(s) for ${game.name}`);
        schema = xboxPc.readSchema(titleId);
        schemaList = schema && schema.achievement && Array.isArray(schema.achievement.list) ? schema.achievement.list : [];
      },
      notifyUnlock: async (id) => {
        const ach = schemaList.find((a) => a && String(a.name) === id);
        const rarityPercent = ach && ach.rarityPct != null ? Number(ach.rarityPct) : null;
        const rounded = Number.isFinite(rarityPercent) ? Math.round(rarityPercent * 10) / 10 : null;
        await notify(
          {
            source: 'Xbox PC',
            appid: titleId,
            gameDisplayName: game.name || titleId,
            achievementName: id,
            achievementDisplayName: (ach && ach.displayName) || id,
            achievementDescription: (ach && ach.description) || '',
            rarityPercent: rounded !== null && rounded <= 10 ? rounded : null,
            icon: (ach && ach.icon) || '',
            gameIcon: (schema && schema.img && schema.img.portrait) || '',
            image: (schema && schema.img && schema.img.header) || '',
            time: Math.floor(Date.now() / 1000),
          },
          {
            notify: app.options.notification.notify,
            lang: app.options.achievement.lang,
            transport: {
              toast: app.options.notification_transport.mode !== 'overlay',
              websocket: app.options.notification_transport.mode !== 'toast',
              overlay: app.options.notification_transport.mode === 'overlay' || app.options.notification_transport.mode === 'both',
            },
            toast: {
              appid: app.toastID,
              winrt: app.options.notification_transport.winRT,
              balloonFallback: app.options.notification_transport.balloon,
              customAudio: '0',
              imageIntegration: '1',
              group: app.options.notification_toast.groupToast,
              attribution: 'Achievement Watcher',
            },
            prefetch: app.options.notification_advanced.iconPrefetch,
            rumble: false,
          }
        );
      },
      onError: (err) => {
        debug.warn(`[xbox-pc] poll failed: ${err && err.message ? err.message : err}`);
      },
    });
  };
  state.timer = setInterval(poll, XBOX_POLL_INTERVAL_MS);
  poll();
}

function stopXboxPolling(exitedGame) {
  if (!matchesActiveXboxPoll(xboxPollState, exitedGame, xboxPc.normalizeTitleId)) return;
  if (xboxPollState && xboxPollState.timer) {
    clearInterval(xboxPollState.timer);
    debug.log(`[xbox-pc] live polling stopped for ${xboxPollState.game && xboxPollState.game.name}`);
  }
  xboxPollState = null;
}
const overlayHotkey = new GlobalHotkey({ debug });
let runningGames = [];
const localProgressSchemaCache = new Map();

// Tell the app how many games are running so updates can wait.
function forwardGameActivity() {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ gameActivity: { count: runningGames.length } });
  } catch (err) {
    debug.error(`[game-activity] IPC failed: ${err}`);
  }
}

function readProgressSchemaFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.some((item) => item && item.progress && item.progress.value && item.progress.value.operand1) ? parsed : [];
  } catch {
    return [];
  }
}

function findGeneratedProgressSchema(appID) {
  const root = path.join(userDataDir(), 'Cache', 'gse_emu_config');
  try {
    for (const tag of fs.readdirSync(root, { withFileTypes: true })) {
      if (!tag.isDirectory()) continue;
      const file = path.join(root, tag.name, 'generate_emu_config', '_OUTPUT', String(appID), 'steam_settings', 'achievements.json');
      const schema = readProgressSchemaFile(file);
      if (schema.length > 0) return schema;
    }
  } catch {
    /* cache folder is optional */
  }
  return [];
}

function findLocalProgressSchema(appID, game) {
  const key = `${appID}:${game && game.gameDir ? game.gameDir : ''}`;
  if (localProgressSchemaCache.has(key)) return localProgressSchemaCache.get(key);

  const candidates = [];
  if (game && game.steamSettings) candidates.push(path.join(game.steamSettings, 'achievements.json'));
  if (game && game.gameDir) candidates.push(path.join(game.gameDir, 'steam_settings', 'achievements.json'));
  candidates.push(path.join(userDataDir(), 'Cache', 'gse_emu_config', 'latest', 'generate_emu_config', '_OUTPUT', String(appID), 'steam_settings', 'achievements.json'));

  for (const file of candidates) {
    const schema = readProgressSchemaFile(file);
    if (schema.length > 0) {
      localProgressSchemaCache.set(key, schema);
      return schema;
    }
  }

  const generated = findGeneratedProgressSchema(appID);
  localProgressSchemaCache.set(key, generated);
  return generated;
}

const indexedGameLookup = createIndexedGameLookup({
  getFiles: () => [
    path.join(userDataDir(), 'steam_cache', 'schema', 'gameIndex.json'),
    path.join(userDataDir(), 'cfg', 'gameIndex.json'),
  ],
});

function findIndexedGame(appID) {
  return indexedGameLookup(appID);
}

function mergeIndexedGameMetadata(game, appID) {
  const indexed = findIndexedGame(appID);
  if (!indexed || !game) return game;
  if (!game.binary && indexed.binary) game.binary = indexed.binary;
  if (!game.icon && indexed.icon) game.icon = indexed.icon;
  if (!game.name && indexed.name) game.name = indexed.name;
  if (!game.source && indexed.source) game.source = indexed.source;
  if (!game.steamappid && indexed.steamappid) game.steamappid = indexed.steamappid;
  return game;
}

function RegisterOverlayHotkey(hotkey) {
  overlayHotkey.register(hotkey, () => {
    toggleOverlayForRunningGame();
  });
}

// Shared open/close path for the overlay of the currently running game — used by both the keyboard
// hotkey and the controller "overlay.toggle" action so they stay in sync (overlayOpened tracks state).
function toggleOverlayForRunningGame(fromController = false) {
  const opening = !overlayOpened;
  // "Pause the game" helper: before the overlay is shown (and can take focus), send Escape to the
  // focused window so many games open their pause/menu. Only runs for a controller-triggered open,
  // only when a game is actually running, and only when the user enabled the option.
  if (
    fromController &&
    opening &&
    runningAppid &&
    controllerOptions().sendEscapeOnControllerOpen === true
  ) {
    debug.log('[controller] sending Escape to the game on overlay open');
    sendEscapeToFocusedWindow();
  }
  // With a game running, the overlay follows it. Without one, the main process
  // resolves the currently open (or first) game from the app window so the
  // hotkey still toggles the overlay from anywhere.
  const appid = runningAppid || '0';
  SpawnOverlayNotification([`--wintype=overlay`, `--appid=${appid}`, `--description=${opening ? 'open' : 'close'}`]);
  overlayOpened = !overlayOpened;
  overlayControllerService?.notifyOverlayPresentationChanged(overlayOpened, 'overlay-toggled');
}

// Native controller input is polled here; window operations are forwarded to the main process.
let overlayControllerService = null;

// Parse a stored "BACK+START" binding string into the button-name array the manager expects.
function parseControllerBinding(value, fallback) {
  const parts = String(value || '')
    .split('+')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function controllerOptions() {
  return (app && app.options && app.options.controller) || {};
}

function forwardOverlayControl(action, payload) {
  if (typeof process.send === 'function' && process.connected) {
    try {
      process.send({ overlayControl: { action, payload: payload || {} } });
    } catch (err) {
      debug.error(`[controller] overlayControl IPC failed: ${err}`);
    }
  }
}

function handleControllerAction(type, payload = {}) {
  const action = String(type || '');
  switch (action) {
    case 'overlay.toggle':
      toggleOverlayForRunningGame(true);
      return;
    case 'overlay.control-mode':
      // Control mode makes stick and d-pad input interactive.
      forwardOverlayControl('control-mode', { active: payload.active === true });
      return;
    case 'overlay.ui-mode-toggle':
      forwardOverlayControl(action.replace('overlay.', ''), payload);
      return;
    case 'overlay.move-relative':
    case 'overlay.scroll-page':
    case 'overlay.nudge':
    case 'overlay.snap-cycle':
      forwardOverlayControl(action.replace('overlay.', ''), payload);
      return;
    default:
      return;
  }
}

function syncOverlayController() {
  const opts = controllerOptions();
  if (!overlayControllerService) {
    // Avoid loading HID support until the user opts in.
    if (opts.enabled !== true) return;
    overlayControllerService = createOverlayControllerService({
      logger: {
        info: (event, data) => debug.log(`[controller] ${event} ${data ? JSON.stringify(data) : ''}`),
        warn: (event, data) => debug.warn(`[controller] ${event} ${data ? JSON.stringify(data) : ''}`),
        error: (event, data) => debug.error(`[controller] ${event} ${data ? JSON.stringify(data) : ''}`),
        debug: () => {},
      },
      isSupportEnabled: () => controllerOptions().enabled === true,
      getPreferredBackend: () => controllerOptions().backend || 'auto',
      isDebugLoggingEnabled: () => controllerOptions().debugLogging === true,
      getOverlayToggleBinding: () => parseControllerBinding(controllerOptions().toggleBinding, ['BACK', 'START']),
      getOverlayControlModeBinding: () =>
        parseControllerBinding(controllerOptions().controlModeBinding, ['LEFT_SHOULDER', 'RIGHT_SHOULDER']),
      getOverlayUiModeBinding: () =>
        parseControllerBinding(controllerOptions().uiModeBinding, ['LEFT_SHOULDER', 'X']),
      canEnterOverlayControlMode: () => overlayOpened === true,
      isOverlayPresented: () => overlayOpened === true,
      onAction: handleControllerAction,
    });
  }
  try {
    overlayControllerService.sync('settings');
  } catch (err) {
    debug.error(`[controller] sync failed: ${err}`);
  }
}

function SpawnOverlayNotification(args) {
  // Use the main process when IPC is available; standalone runs use a detached child.
  if (typeof process.send === 'function' && process.connected) {
    try {
      process.send({ argv: args });
      return;
    } catch (err) {
      debug.error(`[overlay] IPC send failed, falling back to spawn: ${err}`);
    }
  }
  debug.log('Spawning achievement notification...');
  if (isDev) {
    const electronPath = require(path.join(appRoot, '../app/node_modules/electron')); // assumes 'electron' is installed in node_modules
    spawnDetached(
      spawn,
      electronPath,
      ['.', ...args],
      {
        cwd: path.join(appRoot, '../app'),
        detached: true,
        stdio: 'ignore',
      },
      (err) => debug.error(`[overlay] Failed to start Electron: ${err && err.message ? err.message : err}`)
    );
  } else {
    const execPath = path.join(appRoot, 'Achievement Watcher.exe'); // adjust for build path
    spawnDetached(
      spawn,
      execPath,
      args,
      {
        detached: true,
        stdio: ['ignore', process.stdout, process.stderr],
      },
      (err) => debug.error(`[overlay] Failed to start "${execPath}": ${err && err.message ? err.message : err}`)
    );
    debug.log(execPath);
  }
}
module.exports = { SpawnOverlayNotification };

// The app reports every overlay window that opens or closes, from the window's own lifecycle events
// rather than from any one button, so `overlayOpened` cannot drift out of sync with what is on
// screen — a stale "open" would make the next hotkey press send a close for a window that is
// already gone (and a stale "closed" would ask to open one that is already up). Transitions we
// caused ourselves arrive here too and are dropped by the equality check below.
process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.reloadPlaytimeIndex === true) {
    if (playtimeMonitorEmitter && typeof playtimeMonitorEmitter.reloadGameIndex === 'function') {
      playtimeMonitorEmitter.reloadGameIndex().catch((err) => {
        debug.warn(`[Playtime] gameIndex reload failed => ${err}`);
      });
    } else {
      // The monitor may still be initializing; flush the reload once it is ready.
      playtimeIndexReloadQueued = true;
    }
    return;
  }
  if (!msg.overlayState) return;
  const opened = msg.overlayState.opened === true;
  if (opened === overlayOpened) return;
  overlayOpened = opened;
  overlayControllerService?.notifyOverlayPresentationChanged(opened, 'main-process-sync');
  debug.log(`[overlay] presentation state synced from the app: ${opened ? 'open' : 'closed'}`);
});

// Pick the AppUserModelID every toast is posted under (see util/toastIdentity.js for why the id has
// to be checked for existence rather than for format), then apply what that choice implies.
async function applyToastIdentity(self) {
  const chosen = await toastIdentity.resolveToastIdentity(self.options, { log: debug });
  self.toastID = chosen.id;

  if (toastIdentity.requiresLocalImages(self.toastID) && !self.options.notification_advanced.iconPrefetch) {
    self.options.notification_advanced.iconPrefetch = true;
    debug.warn('[Toast] desktop app id: forcing iconPrefetch so toasts keep their achievement icon');
  }
}

var app = {
  isRecording: false,
  cache: [],
  options: {},
  watcher: [],
  tick: 0,
  toastID: toastIdentity.DEFAULT_TOAST_AUMID,
  starting: false,
  restartPending: false,
  start: async function () {
    // Serialize settings reloads so concurrent starts cannot leak watchers.
    if (this.starting) {
      this.restartPending = true;
      debug.log('settings reload requested while starting > coalescing into the current pass');
      return;
    }
    this.starting = true;
    try {
      let self = this;
      self.cache = [];
      // Rebuild the watcher list after closing the previous one.
      self.watcher = [];

      debug.log('Achievement Watchdog starting ...');
      const net = require('net');
      const PIPE_NAME = '\\\\.\\pipe\\AchievementWatchdogPipe';

      // The pipe survives settings reloads and must be opened only once.
      if (!self.pipeServer) {
        self.pipeServer = net.createServer(() => {});
        self.pipeServer.on('error', (err) => debug.error(`[pipe] ${err}`));
        self.pipeServer.listen(PIPE_NAME, () => {
          console.log('Watchdog process running, pipe open');
        });
      }
      processPriority
        .set('normal')
        .then(() => {
          debug.log('Process priority set to NORMAL (background daemon)');
        })
        .catch((err) => {
          debug.error(`Fail to set process priority: ${err && err.message ? err.message : err}`);
        });

      debug.log('Loading Options ...');
      self.options = await settings.load(cfg_file.option);
      // Windows toasts resolve their sound from the same overlay settings as the in-game
      // overlay (Son / Son aléatoire / Volume); refresh on every settings reload too.
      notify.setOverlayOptions(self.options.overlay || {});
    // Whether an unlock may be marked urgent, i.e. allowed on screen while Do Not Disturb is on.
    // Refreshed on every settings reload, like the sound options above.
    require('./notification/transport/toast.js').setUrgentUnlocks(self.options.notification_toast?.urgent === true);
      self.cfgOptionPath = cfg_file.option; // used to locate the per-game progress-mute store
      debug.log(self.options);

      RegisterOverlayHotkey((self.options.overlay && self.options.overlay.hotkey) || 'Ctrl+Shift+K');
      syncOverlayController();

      if ((await isWinRTAvailable()) === true && self.options.notification_transport.winRT === true) {
        debug.log('[Toast] will use WinRT');
      } else {
        debug.warn('[Toast] will use PowerShell (WinRT unavailable or disabled)');
        // #46: when WinRT isn't used, powertoast shells out to PowerShell — if PowerShell isn't on
        // PATH (a reported cause of silently-missing toasts) nothing appears. Probe it and surface a
        // clear, actionable error instead of failing silently.
        execFile(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { windowsHide: true }, (err) => {
          if (err)
            debug.error(
              '[Toast] PowerShell is not reachable — PowerShell fallback toasts will NOT appear. ' +
                'Fix: enable WinRT in Settings, or repair Windows PowerShell at ' +
                'C:\\Windows\\System32\\WindowsPowerShell\\v1.0. (issue #46)'
            );
        });
      }

      applyToastIdentity(self).catch((err) => debug.error(`[Toast] identity resolution failed: ${err}`));

      try {
        self.watcher[0] = watch(cfg_file.option, function (evt, name) {
          if (evt === 'update') {
            debug.log('option file change detected -> reloading');
            self.closeWatchers();
            self.start();
          }
        });
        self.watcher[0].on('error', (err) => debug.error(`[watch:options] ${err}`));
      } catch (err) {
        debug.warn('No option file > settings live reloading disabled');
      }

      let i = 1;
      for (let folder of await monitor.getFolders(cfg_file.userDir)) {
        try {
          if (fs.existsSync(folder.dir)) {
            self.watch(i, folder.dir, folder.options);
            i = i + 1;
          }
        } catch (err) {
          debug.log(err);
        }
      }

      // ShadPS4 (PS4 emulator) live trophy toasts — isolated from the Steam watch path above. Re-run
      // on each settings reload (start() tears down its previous watchers first). toastID is read live
      // since it resolves asynchronously after start().
      try {
        await shadps4Watch.start({ options: self.options, getToastID: () => self.toastID, notify });
      } catch (err) {
        debug.error(`[shadps4] ${err}`);
      }

      // EA Desktop live achievement toasts: parse EA's rotating verbose log and diff against a local
      // baseline, independent from the Steam save-file watcher.
      try {
        await eaWatch.start({ options: self.options, getToastID: () => self.toastID, notify });
      } catch (err) {
        debug.error(`[ea] ${err}`);
      }

      // Xenia (Xbox 360 emulator) live achievement toasts — watches each title's own GPD under the
      // user's saved folders (cfg/userdir.db) and diffs against a baseline, like shadps4Watch.
      try {
        await xeniaWatch.start({ options: self.options, getToastID: () => self.toastID, notify });
      } catch (err) {
        debug.error(`[xenia] ${err}`);
      }

      // GOG Galaxy official live achievement toasts — watches each game's gameplay.db (SQLite,
      // rewritten by Galaxy the moment an achievement pops) and diffs against a baseline.
      try {
        await gogWatch.start({ options: self.options, getToastID: () => self.toastID, notify });
      } catch (err) {
        debug.error(`[gog] ${err}`);
      }

      // Ubisoft Connect official live achievement toasts — watches the client's spool files
      // (protobuf unlock records appended on the spot) and diffs against a baseline.
      try {
        await ubisoftWatch.start({ options: self.options, getToastID: () => self.toastID, notify });
      } catch (err) {
        debug.error(`[ubisoft] ${err}`);
      }
    } catch (err) {
      debug.error(err);
      instance.unlock();
      process.exit();
    } finally {
      this.starting = false;
    }
    if (this.restartPending) {
      this.restartPending = false;
      this.closeWatchers();
      await this.start();
    }
  },
  // Close every watcher this pass opened. node-watch tolerates closing an already-closed watcher,
  // and holes cannot occur (self.watch assigns before the caller advances its index).
  closeWatchers: function () {
    for (const watcher of this.watcher) {
      try {
        if (watcher) watcher.close();
      } catch (err) {
        debug.error(`[watch] close failed: ${err && err.message ? err.message : err}`);
      }
    }
  },
  watch: function (i, dir, options) {
    let self = this;
    debug.log(`Monitoring ach change in "${dir}" ...`);

    self.watcher[i] = watch(dir, { recursive: options.recursive, filter: options.filter }, async function (evt, name) {
      try {
        if (evt !== 'update') return;

        const currentTime = Date.now();
        const fileLastModified = fs.statSync(name).mtimeMs || 0;
        if (currentTime - fileLastModified > 1000) return;

        let filePath = path.parse(name);
        if (options.file && !options.file.some((file) => file == filePath.base)) return;

        debug.log('achievement file change detected');

        if (moment().diff(moment(self.tick)) <= self.options.notification_advanced.tick) throw 'Spamming protection is enabled > SKIPPING';
        self.tick = moment().valueOf();

        let appID;
        if (options.socialClub) {
          // Goldberg SocialClub folders are named after the GAME, not an AppID, so the only link
          // back to a library entry is the game index the app writes. That entry also carries the
          // Steam release the title resolved to, which is what actually has a schema and store art
          // — the namespaced "socialclub-<slug>" id would fail every Steam lookup (issue #9).
          const indexed = findIndexedSocialClubGame(dir, filePath.dir);
          if (!indexed) {
            throw 'Unable to find Goldberg SocialClub game for this save folder — run a library refresh so Achievement Watcher can map it';
          }
          const steamAppId = String(indexed.steamappid || '').trim();
          if (!/^\d+$/.test(steamAppId)) {
            throw `Goldberg SocialClub game "${indexed.name}" has no resolved Steam release — cannot load its achievement schema`;
          }
          debug.log(`[socialclub] save folder -> ${indexed.name} (${indexed.appid} -> Steam ${steamAppId})`);
          appID = steamAppId;
        } else {
          try {
            appID = options.appid
              ? options.appid
              : filePath.dir.replace(/(\\stats$)|(\\SteamEmu$)|(\\SteamEmu\\UserStats$)/gi, '').match(/([0-9]+$)/g)[0];
          } catch (err) {
            throw "Unable to find game's appID";
          }
        }

        if (dir.includes('NemirtingasGalaxyEmu')) {
          appID = await self.steamAppIdForGogId(appID);
        }

        if (options.uplayR2) {
          const mapped = uplayR2.steamAppIdForUplayId(appID);
          if (!mapped) throw `Unknown Ubisoft product id ${appID} — run a library refresh so Achievement Watcher can map it`;
          debug.log(`[uplay-r2] product id ${appID} -> Steam appid ${mapped}`);
          appID = mapped;
        }

        let game = runningGames.find((g) => String(g.appid) === appID) || (await self.load(appID));
        if (game.achievement === undefined) {
          let g = await self.load(appID);
          game.achievement = g.achievement;
        }

        let isRunning = false;

        if (options.disableCheckIfProcessIsRunning === true) {
          isRunning = true;
        } else if (self.options.notification_advanced.checkIfProcessIsRunning) {
          if (runningGames.some((g) => String(g.appid) === appID)) {
            // The playtime monitor already detected this appid as running, via a robust
            // appid-based match that tolerates a process name differing from the index
            // binary (e.g. tlou-ii.exe vs the stored tlou-ii-l.exe). Trust it instead of
            // re-checking a possibly-wrong binary with tasklist, which would otherwise
            // wrongly suppress the unlock notification for those games.
            isRunning = true;
            debug.log('Game already tracked as running by the playtime monitor. Assuming process is running');
          } else if (await isFullscreenAppRunning()) {
            isRunning = true;
            debug.log('Fullscreen application detected on primary display. Assuming process is running');
          } else if (game.binary) {
            isRunning = await tasklist.isProcessRunning(game.binary).catch((err) => {
              debug.error(err);
              debug.warn('Assuming process is NOT running');
              return false;
            });

            if (!isRunning) {
              debug.log("Trying with '-Win64-Shipping' (Unreal Engine Game) ...");
              isRunning = await tasklist.isProcessRunning(game.binary.replace('.exe', '-Win64-Shipping.exe')).catch((err) => {
                debug.error(err);
                debug.warn('Assuming process is NOT running');
                return false;
              });
            }
          } else {
            debug.warn(`Warning! Missing "${game.name}" (${game.appid}) binary name > Overriding user choice to check if process is running`);
            isRunning = true;
          }
        } else {
          isRunning = true;
        }

        if (isRunning) {
          // Let the game finish writing the save file before reading it (node-watch has no
          // awaitWriteFinish). parseWithRetry below still guards the residual race.
          await waitForFileStable(name);

          let achievements = await parseWithRetry(() => monitor.parse(name), {
            onError: (err, attempt) => {
              debug.warn(`Achievement parse attempt ${attempt + 1} failed for "${name}": ${err.message || err}`);
            },
          });
          if (options.uplayR2) {
            const remapped = uplayR2.remapObjectiveIds(achievements, game.achievement && game.achievement.list);
            if (remapped > 0) debug.log(`[uplay-r2] mapped ${remapped} objective id(s) onto the game's achievement names`);
          }
          const progressSchema = findLocalProgressSchema(appID, game);
          const mappedStats = mapStatProgressEntries(achievements, progressSchema);
          if (mappedStats > 0) debug.log(`Mapped ${mappedStats} stat progress entr${mappedStats === 1 ? 'y' : 'ies'} through local GBE schema`);

          if (achievements.length > 0) {
            let cache = await track.load(appID);

            // Global unlock % per achievement, used to flag a toast as "rare" (<10% of players).
            // Fetched at most once per game per watchdog session (memoized on the cached schema
            // object); shares the renderer's sidecar cache so it's usually already on disk.
            if (!game.__rarityMap) {
              game.__rarityMap = await rarity.getRarityMap(appID).catch(() => new Map());
            }
            const rarityMap = game.__rarityMap;

            // Boot-seed / anti-avalanche. The first time we ever observe a game there is no persisted
            // baseline, so a pre-existing save full of already-unlocked achievements can avalanche.
            // Surface the latest few unlocks, then record the full current state as the baseline; every
            // later unlock is diffed against this baseline and notifies normally.
            const preUnlocked = achievements.filter((a) => a.Achieved);
            const seedOnly = (!Array.isArray(cache) || cache.length === 0) && preUnlocked.length > 1;
            const seedNotifyLimit = 3;
            const seedNotifyNames = new Set(
              seedOnly
                ? preUnlocked
                    .slice()
                    .sort((a, b) => Number(b.UnlockTime || 0) - Number(a.UnlockTime || 0))
                    .slice(0, seedNotifyLimit)
                    .map((a) => String(a.name || '').toUpperCase())
                : []
            );
            if (seedOnly)
              debug.log(
                `Boot-seed: first observation of ${appID} (${preUnlocked.length} pre-unlocked) > notifying latest ${seedNotifyNames.size}, then seeding baseline`
              );

            // Platinum (100% completion) detection. Snapshot the prior unlock count so we only fire
            // when *this* scan flips the game from incomplete to fully unlocked, and only when a real
            // unlock notification fired this scan (guards against firing on first load of old saves).
            const platinumTotal = Array.isArray(game.achievement.list) ? game.achievement.list.length : 0;
            const schemaIndex = buildSchemaIndex(game.achievement.list, {
              includeCrc: achievements.some((achievement) => achievement && achievement.crc),
            });
            const previousIndex = buildPreviousAchievementIndex(cache);
            const platinumPrevUnlocked = previousIndex.unlockedCount;
            let platinumNewUnlock = false;
            let platinumIcon = null;

            let j = 0;
            for (let i in achievements) {
              if (Object.prototype.hasOwnProperty.call(achievements, i)) {
                try {
                  let ach = findSchemaAchievement(schemaIndex, achievements[i]);
                  if (!ach) throw 'ACH_NOT_FOUND_IN_SCHEMA';

                  if (achievements[i].crc) {
                    achievements[i].name = ach.name;
                    delete achievements[i].crc;
                  }

                  let previous = previousIndex.byName.get(ach.name) || {
                    Achieved: false,
                    CurProgress: 0,
                    MaxProgress: 0,
                    UnlockTime: 0,
                  };

                  if (!previous.Achieved && achievements[i].Achieved) {
                    if (!achievements[i].UnlockTime || achievements[i].UnlockTime == 0) achievements[i].UnlockTime = moment().unix();
                    const seedPreview = seedOnly && seedNotifyNames.has(String(achievements[i].name || '').toUpperCase());
                    if (seedOnly && !seedPreview) continue; // baseline seeding: record the unlock, suppress older toasts
                    let elapsedTime = moment().diff(moment.unix(achievements[i].UnlockTime), 'seconds');
                    if (
                      seedPreview ||
                      options.disableCheckTimestamp ||
                      (elapsedTime >= 0 && elapsedTime <= self.options.notification_advanced.timeTreshold)
                    ) {
                      debug.log('Unlocked:' + ach.displayName);

                      // Belt-and-suspenders against duplicate toasts: a node-watch double-fire or an
                      // emulator that rewrites the save twice can race the per-game cache (track.save)
                      // so two scans diff against the same baseline and both fire. Drop the exact repeat
                      // here, independent of file/cache write timing (the global tick gate is coarser).
                      if (!notificationDedup.shouldNotify({ appid: game.appid, achievementName: ach.name })) {
                        debug.log('Duplicate unlock event suppressed (dedup):' + ach.displayName);
                        continue;
                      }

                      try {
                        if (self.options.action.target) {
                          debug.log(`Action: ${self.options.action.target}`);
                          if (fs.existsSync(self.options.action.target)) {
                            spawnDetached(
                              spawn,
                              self.options.action.target,
                              [],
                              {
                                cwd: self.options.action.cwd || path.parse(self.options.action.target).dir,
                                stdio: 'ignore',
                                detached: true,
                                windowsHide: self.options.action.hide ?? true,
                                env: {
                                  ...process.env,
                                  AW_APPID: appID.toString(),
                                  AW_GAME: game.name.toString(),
                                  AW_ACHIEVEMENT: ach.name.toString(),
                                  AW_DISPLAYNAME: ach.displayName.toString(),
                                  AW_DESCRIPTION: ach.description?.toString() || '',
                                  AW_ICON: ach.icon?.toString() || '',
                                  AW_TIME: achievements[i].UnlockTime.toString(),
                                },
                              },
                              (err) =>
                                debug.error(
                                  `[action] Failed to start "${self.options.action.target}": ${err && err.message ? err.message : err}`
                                )
                            );
                          } else {
                            debug.warn('Action target missing');
                          }
                        } else {
                          debug.log('No action set');
                        }
                      } catch (err) {
                        debug.error(`Action failed: ${err}`);
                      }

                      // Use the same one-decimal rounding and <=10% cutoff as the achievement menu,
                      // then forward the percentage so overlay presets can apply the matching tier.
                      const rarePct = rarityMap.get(ach.name);
                      const rounded = Math.round(rarePct * 10) / 10;
                      const isRare = Number.isFinite(rounded) && rounded >= 0 && rounded <= 10;
                      const rarityLabel = notifyStrings.interpolate(
                        notifyStrings.forLang(self.options.achievement.lang).rare,
                        { percent: rounded }
                      );
                      const attribution = isRare ? `${game.name} · ${rarityLabel}` : game.name;

                      await notify(
                        {
                          source: game.source,
                          appid: game.appid,
                          gameDisplayName: game.name,
                          achievementName: ach.name,
                          achievementDisplayName: ach.displayName,
                          achievementDescription: ach.description,
                          rarityPercent: isRare ? rounded : null,
                          icon: ach.icon,
                          gameIcon: steamLibraryImage(game.steamappid || game.appid),
                          image: steamHeaderImage(game.steamappid || game.appid),
                          time: achievements[i].UnlockTime,
                          delay: j,
                        },
                        {
                          notify: self.options.notification.notify,
                          lang: self.options.achievement.lang,
                          transport: {
                            toast: app.options.notification_transport.mode !== 'overlay',
                            websocket: self.options.notification_transport.websocket || app.options.notification_transport.mode !== 'toast',
                            overlay:
                              app.options.notification_transport.mode === 'overlay' || app.options.notification_transport.mode === 'both',
                          },
                          toast: {
                            appid: self.toastID,
                            winrt: self.options.notification_transport.winRT,
                            balloonFallback: self.options.notification_transport.balloon,
                            customAudio: self.options.notification_toast.customToastAudio,
                            volume: notificationVolumePercent(self.options),
                            imageIntegration: '0',
                            group: self.options.notification_toast.groupToast,
                            attribution: attribution,
                          },
                          prefetch: self.options.notification_advanced.iconPrefetch,
                          rumble: self.options.notification.rumble,
                          souvenir: self.options.souvenir || null,
                        }
                      );

                      j += 1;
                      platinumNewUnlock = true;
                      platinumIcon = ach.icon;
                    } else {
                      debug.warn('Outatime:' + ach.displayName);
                    }
                  } else if (previous.Achieved && achievements[i].Achieved) {
                    debug.log('Already unlocked:' + ach.displayName);
                    if (previous.UnlockTime > 0 && previous.UnlockTime != achievements[i].UnlockTime)
                      achievements[i].UnlockTime = previous.UnlockTime;
                  } else if (!achievements[i].Achieved && achievements[i].MaxProgress > 0 && +previous.CurProgress < +achievements[i].CurProgress) {
                    debug.log('Progress update:' + ach.displayName);
                    if (!seedOnly && self.options.notification.notifyOnProgress && !progressMute.isMuted(game.appid, self.cfgOptionPath))
                      await notify(
                        {
                          appid: game.appid,
                          gameDisplayName: game.name,
                          achievementName: ach.name,
                          achievementDisplayName: ach.displayName,
                          achievementDescription: ach.description,
                          icon: ach.icongray,
                          gameIcon: steamLibraryImage(game.steamappid || game.appid),
                          image: steamHeaderImage(game.steamappid || game.appid),
                          progress: {
                            // Float stat counters (e.g. distance) can carry long tails
                            // (3.3333333…); cap at 2 decimals for every transport at the source.
                            current: Math.round(Number(achievements[i].CurProgress) * 100) / 100,
                            max: Math.round(Number(achievements[i].MaxProgress) * 100) / 100,
                          },
                        },
                        {
                          notify: self.options.notification.notify,
                          lang: self.options.achievement.lang,
                          transport: {
                            toast: app.options.notification_transport.mode !== 'overlay',
                            websocket: self.options.notification_transport.websocket || app.options.notification_transport.mode !== 'toast',
                            overlay:
                              app.options.notification_transport.mode === 'overlay' || app.options.notification_transport.mode === 'both',
                          },
                          toast: {
                            appid: self.toastID,
                            winrt: self.options.notification_transport.winRT,
                            balloonFallback: self.options.notification_transport.balloon,
                            customAudio: '0',
                            volume: notificationVolumePercent(self.options),
                            imageIntegration: '0',
                            group: self.options.notification_toast.groupToast,
                            attribution: game.name,
                          },
                          prefetch: self.options.notification_advanced.iconPrefetch,
                          rumble: false,
                        }
                      );
                  }
                } catch (err) {
                  if (err === 'ACH_NOT_FOUND_IN_SCHEMA') {
                    debug.warn(
                      `${
                        achievements[i].crc ? `${achievements[i].crc} (CRC32)` : `${achievements[i].name}`
                      } not found in game schema data ?! ... Achievement was probably deleted or renamed over time > SKIPPING`
                    );
                  } else {
                    debug.error(`Unexpected Error for achievement "${achievements[i].name}": ${err}`);
                  }
                }
              }
            }
            try {
              await track.save(appID, achievements);
            } catch (err) {
              debug.error(`[track] failed to persist baseline for ${appID}: ${err.message || err} — keeping the in-memory baseline for this session`);
            }

            // Fire a dedicated Platinum toast when this scan flips the game to 100%.
            const platinumNowUnlocked = achievements.filter((a) => a.Achieved == 1).length;
            if (
              platinumNewUnlock &&
              platinumTotal > 0 &&
              platinumPrevUnlocked < platinumTotal &&
              platinumNowUnlocked >= platinumTotal &&
              self.options.notification.platinum !== false
            ) {
              debug.log(`Platinum (100%): ${game.name}`);
              const wdStrings = notifyStrings.forLang(self.options.achievement.lang);
              const platinumLabel = wdStrings.platinumTitle;
              const platinumDesc = wdStrings.platinumDesc;
              await notify(
                {
                  source: game.source,
                  appid: game.appid,
                  notificationType: 'platinum',
                  gameDisplayName: game.name,
                  achievementDisplayName: game.name,
                  achievementDescription: platinumDesc,
                  icon: platinumIcon || undefined,
                  gameIcon: steamLibraryImage(game.steamappid || game.appid),
                  image: steamHeaderImage(game.steamappid || game.appid),
                  time: moment().unix(),
                },
                {
                  notify: self.options.notification.notify,
                  lang: self.options.achievement.lang,
                  transport: {
                    toast: app.options.notification_transport.mode !== 'overlay',
                    websocket: self.options.notification_transport.websocket || app.options.notification_transport.mode !== 'toast',
                    overlay:
                      app.options.notification_transport.mode === 'overlay' || app.options.notification_transport.mode === 'both',
                  },
                  toast: {
                    appid: self.toastID,
                    winrt: self.options.notification_transport.winRT,
                    balloonFallback: self.options.notification_transport.balloon,
                    customAudio: self.options.notification_toast.customToastAudio,
                    volume: notificationVolumePercent(self.options),
                    imageIntegration: '1',
                    group: self.options.notification_toast.groupToast,
                    attribution: `${game.name} · ${platinumLabel}`,
                  },
                  prefetch: self.options.notification_advanced.iconPrefetch,
                  rumble: self.options.notification.rumble,
                }
              );
            }
          }
        } else {
          debug.warn(`game's process "${game.binary}" not running`);
        }
      } catch (err) {
        debug.warn(err);
      }
    });
    self.watcher[i].on('error', (err) => debug.error(`[watch:${dir}] ${err}`));
  },
  load: async function (appID) {
    try {
      let self = this;

      debug.log(`loading steam schema for ${appID}`);

      let search = self.cache.find((game) => game.appid == appID);
      let game;

      if (search) {
        game = search;
        debug.log('from memory cache');
      } else {
        // Namespaced appids (e.g. Goldberg SocialClub's "socialclub-<slug>") can't be looked up on
        // Steam directly. The game index carries the resolved Steam release; load that schema and
        // re-key the game to its namespaced appid so track/dedup stay consistent with the library.
        const indexed = findIndexedGame(appID);
        const steamAppId =
          !/^[0-9]+$/.test(String(appID)) && indexed && /^[0-9]+$/.test(String(indexed.steamappid || ''))
            ? String(indexed.steamappid)
            : String(appID);
        game = await steam.loadSteamData(steamAppId, self.options.achievement.lang, self.options.steam.apiKey);
        if (steamAppId !== String(appID)) {
          game.appid = String(appID);
          if (indexed && indexed.steamappid) game.steamappid = indexed.steamappid;
        }
        self.cache.push(game);
        debug.log('from file cache or remote');
      }

      return mergeIndexedGameMetadata(game, appID);
    } catch (err) {
      throw err;
    }
  },
  steamAppIdForGogId: async function (appID) {
    try {
      const cacheFile = path.join(userDataDir(), 'steam_cache', 'gog.db');
      let cache = [];

      if (fs.existsSync(cacheFile)) {
        cache = JSON.parse(fs.readFileSync(cacheFile, { encoding: 'utf8' }));
      }
      let cached = cache.find((g) => g.gogid === appID);
      if (cached) return cached.steamid;
      const url = `https://gamesdb.gog.com/platforms/gog/external_releases/${appID}`;
      let gameinfo = await request.getJson(url);
      if (gameinfo) {
        let steamid = gameinfo.game.releases.find((r) => r.platform_id === 'steam').external_id;
        if (steamid) return steamid;
      }
    } catch (err) {
      throw err;
    }
  },
  steamAppIdForEpicId: async function (appID) {
    try {
      const cacheFile = path.join(userDataDir(), 'steam_cache', 'epic.db');
      let cache = [];

      if (fs.existsSync(cacheFile)) {
        cache = JSON.parse(fs.readFileSync(cacheFile, { encoding: 'utf8' }));
      }
      let cached = cache.find((g) => g.gogid === appID);
      if (cached) return cached.steamid;
    } catch (err) {
      throw err;
    }
  },
};

(async () => {
  try {
    await instance.lock();

    // Start WQL before other COM clients initialize security.
    const playtimeMonitorReady = playtimeMonitor
      .init()
      .then((monitor) => {
        debug.log('Playtime monitoring activated');
        playtimeMonitorEmitter = monitor;
        if (playtimeIndexReloadQueued) {
          playtimeIndexReloadQueued = false;
          monitor.reloadGameIndex().catch((err) => {
            debug.warn(`[Playtime] queued gameIndex reload failed => ${err}`);
          });
        }

        monitor.on('disable-overlay', () => {
          runningAppid = null;
          // Only ask for a close when an overlay is actually up: the request used to be sent on
          // every game exit, and an unsolicited close reaching the app with nothing open made it
          // open the overlay on the desktop instead (issue #19).
          const wasOpen = overlayOpened;
          overlayOpened = false;
          if (wasOpen) {
            SpawnOverlayNotification([`--wintype=overlay`, `--appid=0`, `--description=close`]);
            overlayControllerService?.notifyOverlayPresentationChanged(false, 'game-exited');
          }
        });

        monitor.on('enable-overlay', (appid) => {
          runningAppid = appid;
        });

        monitor.on('notify', async ([game, playedSeconds]) => {
          // Launch event emits [game]; the stop event emits [game, playedSeconds] (a number, possibly 0).
          const isExit = playedSeconds != null;
          if (isExit) {
            let gameIndex = runningGames.findIndex((g) => g.appid === game.appid);
            if (gameIndex !== -1) runningGames.splice(gameIndex, 1);
            stopXboxPolling(game);
          } else {
            runningGames.push(game);
            if (String(game.source || '') === 'Xbox PC') startXboxPolling(game);
          }
          forwardGameActivity();
          if (app.options.notification.playtime) {
            // Localize the playtime text here (the monitor stays language-agnostic and emits raw seconds).
            const wdStrings = notifyStrings.forLang(app.options.achievement.lang);
            const hdLang = notifyStrings.humanizeLocale(app.options.achievement.lang);
            let description;
            if (isExit) {
              const humanized =
                playedSeconds < 60
                  ? humanizeDuration(playedSeconds * 1000, { language: hdLang, units: ['s'], round: true })
                  : humanizeDuration(playedSeconds * 1000, {
                      language: hdLang,
                      units: ['h', 'm'],
                      round: true,
                    });
              description = notifyStrings.interpolate(wdStrings.playedFor, { duration: humanized });
            } else {
              description = wdStrings.trackingPlaytime;
            }
            notify(
              {
                notificationType: 'playtime',
                appid: game.appid,
                gameDisplayName: game.name,
                achievementDisplayName: game.name || wdStrings.playtime,
                achievementDescription: description,
                icon: game.icon
                  ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${game.appid}/${game.icon}.jpg`
                  : undefined,
                gameIcon: steamLibraryImage(game.steamappid || game.appid),
                image: steamHeaderImage(game.steamappid || game.appid),
                silent: true, // playtime overlay notifications never play a sound
              },
              {
                notify: app.options.notification.notify,
                lang: app.options.achievement.lang,
                transport: {
                  toast: app.options.notification_transport.mode !== 'overlay',
                  websocket: app.options.notification_transport.mode !== 'toast',
                  overlay: app.options.notification_transport.mode === 'overlay' || app.options.notification_transport.mode === 'both',
                },
                toast: {
                  appid: app.toastID,
                  winrt: app.options.notification_transport.winRT,
                  balloonFallback: app.options.notification_transport.balloon,
                  customAudio: '0',
                  imageIntegration: '1',
                  group: app.options.notification_toast.groupToast,
                  attribution: 'Achievement Watcher',
                },
                prefetch: app.options.notification_advanced.iconPrefetch,
                rumble: false,
              }
            );
          }
        });

        // Sync games already running when the monitor starts without fake launch notifications.
        const activeGames = typeof monitor.getActiveGames === 'function' ? monitor.getActiveGames() : [];
        const active = describeActiveGames(activeGames);
        if (active.games.length > 0) {
          runningGames = active.games;
          runningAppid = active.overlayGame.appid;
          if (active.xboxGame) startXboxPolling(active.xboxGame);
          debug.log(`[Process trail] synchronized ${active.games.length} already-running game(s)`);
        }
        forwardGameActivity();
      })
      .catch((err) => {
        debug.error(err);
      });

    await playtimeMonitorReady;

    app.start().catch((err) => {
      debug.log(err);
    });

    try {
      websocket();
    } catch (err) {
      debug.error(err);
    }
  } catch (err) {
    debug.error(err);
    process.exit();
  }
})();
