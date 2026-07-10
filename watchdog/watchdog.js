'use strict';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  debug?.error?.(`Uncaught exception: ${err}`); // safe optional chaining if debug isn’t loaded yet
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason);
  debug?.error?.(`Unhandled promise rejection: ${reason}`);
});

const debug = require('./util/log.js');
const instance = new (require('single-instance'))('Achievement Watchdog');
const os = require('os');
const { spawn, execFile } = require('child_process');
const path = require('path');
const watch = require('node-watch');
const tasklist = require('win-tasklist');
const moment = require('moment');
const websocket = require('./websocket.js');
const processPriority = require('./util/priority.js');
const fs = require('fs');
const request = require('request-zero');
const settings = require('./settings.js');
const monitor = require('./monitor.js');
const parseWithRetry = require('./util/parseWithRetry.js');
const waitForFileStable = require('./util/waitForFileStable.js');
const notificationDedup = require('./util/notificationDedup.js');
const progressMute = require('./util/progressMute.js');
const rarity = require('./util/rarity.js');
const steam = require('./steam.js');
const track = require('./track.js');
const { mapStatProgressEntries } = require('./util/statProgress.js');
const { notificationVolumePercent } = require('./util/notificationVolume.js');
const playtimeMonitor = require('./playtime/monitor.js');
const notify = require('./notification/toaster.js');
const shadps4Watch = require('./console/shadps4Watch.js');
const xeniaWatch = require('./console/xeniaWatch.js');
const eaWatch = require('./console/eaWatch.js');
const { crc32 } = require('crc');
const { isWinRTAvailable } = require('powertoast');
const { isFullscreenAppRunning } = require('./queryUserNotificationState.js');
const GlobalHotkey = require('./util/globalHotkey.js');
const humanizeDuration = require('humanize-duration');
const { resolvePowerShell } = require('./util/powershell.js');
const startApps = require('./util/startApps.js');

const cfg_file = {
  option: path.join(process.env['APPDATA'], 'Achievement Watcher/cfg', 'options.ini'),
  userDir: path.join(process.env['APPDATA'], 'Achievement Watcher/cfg', 'userdir.db'),
};

const appRoot = path.join(__dirname, '../');

let isDev = process.env.NODE_ENV === 'development';
let runningAppid;
let overlayOpened = false;
const overlayHotkey = new GlobalHotkey({ debug });
let runningGames = [];
const localProgressSchemaCache = new Map();

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
  const root = path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'Cache', 'gse_emu_config');
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
  candidates.push(path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'Cache', 'gse_emu_config', 'latest', 'generate_emu_config', '_OUTPUT', String(appID), 'steam_settings', 'achievements.json'));

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

function findIndexedGame(appID) {
  const files = [
    path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'steam_cache', 'schema', 'gameIndex.json'),
    path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'cfg', 'gameIndex.json'),
  ];
  let indexed;
  for (const file of files) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(list)) continue;
      const found = list.find((game) => String(game && game.appid) === String(appID));
      if (found) indexed = found;
    } catch {
      /* game index files are optional */
    }
  }
  return indexed;
}

function mergeIndexedGameMetadata(game, appID) {
  const indexed = findIndexedGame(appID);
  if (!indexed || !game) return game;
  if (!game.binary && indexed.binary) game.binary = indexed.binary;
  if (!game.icon && indexed.icon) game.icon = indexed.icon;
  if (!game.name && indexed.name) game.name = indexed.name;
  return game;
}

function steamHeaderImage(appid) {
  return appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` : undefined;
}

function steamLibraryImage(appid) {
  return appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg` : undefined;
}

function RegisterOverlayHotkey(hotkey) {
  overlayHotkey.register(hotkey, () => {
      if (runningAppid) {
        SpawnOverlayNotification([`--wintype=overlay`, `--appid=${runningAppid}`, `--description=${overlayOpened ? 'close' : 'open'}`]);
        overlayOpened = !overlayOpened;
      }
  });
}

function SpawnOverlayNotification(args) {
  // When the monitor runs as a child of the Electron main process (it is spawned with an 'ipc' stdio
  // channel), forward the window args over IPC so main renders the overlay/notification inside the
  // resident tray daemon — no separate Electron process, no single-instance forwarding. main feeds
  // these straight into its existing parseArgs() dispatch (--wintype=overlay|notification ...).
  // Falls back to the legacy detached spawn when run standalone (e.g. `node watchdog.js` in dev).
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
    spawn(electronPath, ['.', ...args], {
      cwd: path.join(appRoot, '../app'),
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    const execPath = path.join(appRoot, 'Achievement Watcher.exe'); // adjust for build path
    spawn(execPath, args, {
      detached: true,
      stdio: ['ignore', process.stdout, process.stderr],
    }).unref();
    debug.log(execPath);
  }
}
module.exports = { SpawnOverlayNotification };

var app = {
  isRecording: false,
  cache: [],
  options: {},
  watcher: [],
  tick: 0,
  toastID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
  start: async function () {
    try {
      let self = this;
      self.cache = [];

      debug.log('Achievement Watchdog starting ...');
      const net = require('net');
      const PIPE_NAME = '\\\\.\\pipe\\AchievementWatchdogPipe';

      // The options.ini watcher re-invokes start() on every settings change; only open the named pipe
      // once. A second listen() on the already-bound pipe throws EADDRINUSE (previously surfaced via
      // the global uncaughtException handler) and leaks a server handle on each reload. Guard it, and
      // attach an error handler so a stray pipe error can never crash the watchdog.
      if (!self.pipeServer) {
        self.pipeServer = net.createServer(() => {});
        self.pipeServer.on('error', (err) => debug.error(`[pipe] ${err}`));
        self.pipeServer.listen(PIPE_NAME, () => {
          console.log('Watchdog process running, pipe open');
        });
      }
      processPriority
        .set('high priority')
        .then(() => {
          debug.log('Process priority set to HIGH');
        })
        .catch((err) => {
          debug.error('Fail to set process priority to HIGH');
        });

      debug.log('Loading Options ...');
      self.options = await settings.load(cfg_file.option);
      self.cfgOptionPath = cfg_file.option; // used to locate the per-game progress-mute store
      debug.log(self.options);

      RegisterOverlayHotkey(self.options.overlay.hotkey);

      if (isWinRTAvailable() === true && self.options.notification_transport.winRT === true) {
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

      startApps
        .has({ id: 'GamingOverlay' })
        .then((hasXboxOverlay) => {
          let win_ver = os.release().split('.');

          if (self.options.notification_advanced.appID && self.options.notification_advanced.appID !== '') {
            self.toastID = self.options.notification_advanced.appID;
          } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
            self.toastID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
          } else if (hasXboxOverlay === true) {
            self.toastID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
          }

          debug.log(`[Toast] will use appid: "${self.toastID}"`);
        })
        .then(() => {
          return startApps.isValidAUMID(self.toastID);
        })
        .then((res) => {
          if (!res) {
            debug.warn('[Toast] which is not a valid AUMID !');
            if (!self.options.notification_advanced.iconPrefetch) {
              self.options.notification_advanced.iconPrefetch = true;
              debug.warn('[Toast] Forcing iconPrefetch to true so you will have achievement icon');
            }
          } else {
            debug.log('[Toast] which is a valid AUMID');
          }
        })
        .catch(() => {});

      try {
        self.watcher[0] = watch(cfg_file.option, function (evt, name) {
          if (evt === 'update') {
            debug.log('option file change detected -> reloading');
            self.watcher.forEach((watcher) => watcher.close());
            self.start();
          }
        });
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
    } catch (err) {
      debug.error(err);
      instance.unlock();
      process.exit();
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
        if (!options.file.some((file) => file == filePath.base)) return;

        debug.log('achievement file change detected');

        if (moment().diff(moment(self.tick)) <= self.options.notification_advanced.tick) throw 'Spamming protection is enabled > SKIPPING';
        self.tick = moment().valueOf();

        let appID;
        try {
          appID = options.appid
            ? options.appid
            : filePath.dir.replace(/(\\stats$)|(\\SteamEmu$)|(\\SteamEmu\\UserStats$)/gi, '').match(/([0-9]+$)/g)[0];
        } catch (err) {
          throw "Unable to find game's appID";
        }

        if (dir.includes('NemirtingasGalaxyEmu')) {
          appID = await self.steamAppIdForGogId(appID);
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
            const platinumPrevUnlocked = cache.filter((a) => a.Achieved == 1).length;
            let platinumNewUnlock = false;
            let platinumIcon = null;

            let j = 0;
            for (let i in achievements) {
              if (Object.prototype.hasOwnProperty.call(achievements, i)) {
                try {
                  let ach = game.achievement.list.find((achievement) => {
                    if (achievements[i].crc) {
                      return achievements[i].crc.includes(crc32(achievement.name).toString(16)); //(SSE) crc module removes leading 0 when dealing with anything below 0x1000 -.-'
                    } else {
                      return achievement.name == achievements[i].name || achievement.name.toUpperCase() == achievements[i].name.toUpperCase(); //uppercase == uppercase : cdx xcom chimera (apiname doesn't match case with steam schema)
                    }
                  });
                  if (!ach) throw 'ACH_NOT_FOUND_IN_SCHEMA';

                  if (achievements[i].crc) {
                    achievements[i].name = ach.name;
                    delete achievements[i].crc;
                  }

                  let previous = cache.find((achievement) => achievement.name === ach.name) || {
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
                            const exec = spawn(self.options.action.target, {
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
                            });
                            exec.unref();
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
                      const rareFr = (self.options.achievement.lang || '').toLowerCase().startsWith('fr');
                      const rounded = Math.round(rarePct * 10) / 10;
                      const isRare = Number.isFinite(rounded) && rounded >= 0 && rounded <= 10;
                      const attribution = isRare ? (rareFr ? `Rare · ${rounded} %` : `Rare · ${rounded}%`) : rareFr ? 'Succès' : 'Achievement';

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
                          gameIcon: steamLibraryImage(game.appid),
                          image: steamHeaderImage(game.appid),
                          time: achievements[i].UnlockTime,
                          delay: j,
                        },
                        {
                          notify: self.options.notification.notify,
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
                            cropIcon: true,
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
                          gameIcon: steamLibraryImage(game.appid),
                          image: steamHeaderImage(game.appid),
                          progress: {
                            // Float stat counters (e.g. distance) can carry long tails
                            // (3.3333333…); cap at 2 decimals for every transport at the source.
                            current: Math.round(Number(achievements[i].CurProgress) * 100) / 100,
                            max: Math.round(Number(achievements[i].MaxProgress) * 100) / 100,
                          },
                        },
                        {
                          notify: self.options.notification.notify,
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
                            imageIntegration: '1',
                            group: self.options.notification_toast.groupToast,
                            cropIcon: true,
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
            await track.save(appID, achievements);

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
              const platinumFr = (self.options.achievement.lang || '').toLowerCase().startsWith('fr');
              const platinumLabel = platinumFr ? 'Trophée Platine' : 'Platinum';
              const platinumDesc = platinumFr ? 'Trophée platine débloqué — 100 % complété !' : 'Platinum unlocked — 100% completed!';
              await notify(
                {
                  source: game.source,
                  appid: game.appid,
                  notificationType: 'platinum',
                  gameDisplayName: game.name,
                  achievementDisplayName: game.name,
                  achievementDescription: platinumDesc,
                  icon: platinumIcon || undefined,
                  gameIcon: steamLibraryImage(game.appid),
                  image: steamHeaderImage(game.appid),
                  time: moment().unix(),
                },
                {
                  notify: self.options.notification.notify,
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
                    cropIcon: true,
                    attribution: platinumLabel,
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
        game = await steam.loadSteamData(appID, self.options.achievement.lang, self.options.steam.apiKey);
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
      const cacheFile = path.join(process.env['APPDATA'], 'Achievement Watcher', 'steam_cache', 'gog.db');
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
      const cacheFile = path.join(process.env['APPDATA'], 'Achievement Watcher', 'steam_cache', 'epic.db');
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

    app.start().catch((err) => {
      debug.log(err);
    });

    try {
      websocket();
    } catch (err) {
      debug.error(err);
    }

    playtimeMonitor
      .init()
      .then((monitor) => {
        debug.log('Playtime monitoring activated');

        monitor.on('disable-overlay', () => {
          runningAppid = null;
          SpawnOverlayNotification([`--wintype=overlay`, `--appid=0`]);
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
          } else {
            runningGames.push(game);
          }
          if (app.options.notification.playtime) {
            // Localize the playtime text here (the monitor stays language-agnostic and emits raw seconds).
            const fr = (app.options.achievement.lang || '').toLowerCase().startsWith('fr');
            let description;
            if (isExit) {
              const humanized =
                playedSeconds < 60
                  ? humanizeDuration(playedSeconds * 1000, { language: fr ? 'fr' : 'en', units: ['s'], round: true })
                  : humanizeDuration(playedSeconds * 1000, {
                      language: fr ? 'fr' : 'en',
                      conjunction: fr ? ' et ' : ' and ',
                      units: ['h', 'm'],
                      round: true,
                    });
              description = fr ? `Vous avez joué pendant ${humanized}` : `You played for ${humanized}`;
            } else {
              description = fr ? 'Suivi du temps de jeu en cours' : 'Tracking playtime';
            }
            notify(
              {
                notificationType: 'playtime',
                appid: game.appid,
                gameDisplayName: game.name,
                achievementDisplayName: game.name || (fr ? 'Temps de jeu' : 'Playtime'),
                achievementDescription: description,
                icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${game.appid}/${game.icon}.jpg`,
                gameIcon: steamLibraryImage(game.appid),
                image: steamHeaderImage(game.appid),
                silent: true, // playtime overlay notifications never play a sound
              },
              {
                notify: app.options.notification.notify,
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
                  cropIcon: true,
                  attribution: 'Achievement Watcher',
                },
                prefetch: app.options.notification_advanced.iconPrefetch,
                rumble: false,
              }
            );
          }
        });
      })
      .catch((err) => {
        debug.error(err);
      });
  } catch (err) {
    debug.error(err);
    process.exit();
  }
})();
