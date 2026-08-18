'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const tasklist = require('../util/tasklist');
const Timer = require('./timer.js');
const TimeTrack = require('./track.js');
const { findByReadingContentOfKnownConfigfilesIn } = require('./steam_appid_find.js');
const { loadSteamData } = require('../steam.js');
const { buildBinaryIndex, buildSeededSessions, getBinaryMatches, snapshotActiveGames } = require('./seed.js');
const { createPollingProcessMonitor } = require('./pollingProcessMonitor.js');
const { userDataDir } = require('../util/userData.js');

const debug = new (require('../util/logger'))({
  console: true,
  file: path.join(userDataDir(), 'logs/playtime.log'),
});

const appdataPath = process.env['APPDATA'];
// filter.json is optional; missing it means no extra process filters.
let blacklist;
try {
  blacklist = require('./filter.json');
} catch {
  blacklist = { ignore: [], mute: [] };
}
if (!blacklist || typeof blacklist !== 'object') blacklist = {};
if (!Array.isArray(blacklist.ignore)) blacklist.ignore = [];
if (!Array.isArray(blacklist.mute)) blacklist.mute = [];
let gameIndex;
let gameIndexByBinary;
let appidByDirCache;
// A long-running daemon sees an unbounded number of distinct process directories, so the
// directory -> appid memo is capped and evicts in insertion order. It only exists to avoid
// repeating the recursive config-file glob; losing an old entry costs one extra scan.
const APPID_BY_DIR_CACHE_MAX = 512;
function rememberAppidForDir(dirKey, appid) {
  if (appidByDirCache.size >= APPID_BY_DIR_CACHE_MAX) {
    const oldest = appidByDirCache.keys().next();
    if (!oldest.done) appidByDirCache.delete(oldest.value);
  }
  appidByDirCache.set(dirKey, appid);
}
let ignoredAppidsCache = { mtimeMs: null, set: new Set() };

const systemTempDir = os.tmpdir() || process.env['TEMP'] || process.env['TMP'];
const userExclusionFile = path.join(userDataDir(), 'cfg/exclusion.db');
const builtinIgnoredAppids = new Set([
  '480', // Space War
  '753', // Steam Config
  '250820', // SteamVR
  '228980', // Steamworks Common Redistributables
  '431960', // Wallpaper Engine
]);
const wallpaperProcessNames = new Set(['wallpaperui.exe', 'wallpaper32.exe', 'wallpaper64.exe', 'wallpaperservice32.exe', 'winrtutil32.exe', 'winrtutil64.exe']);

// Join a path under an environment root, tolerating an unset variable. The mute list below is built
// at module load, so a missing SystemRoot used to throw before the module even finished loading -
// path.join() rejects undefined - and take the whole playtime monitor down with it.
function envPath(variable, ...segments) {
  const root = process.env[variable];
  return root ? path.join(root, ...segments) : '';
}

const filter = {
  ignore: blacklist.ignore, //WMI WQL FILTER
  mute: {
    dir: [
      systemTempDir,
      process.env['USERPROFILE'],
      process.env['APPDATA'],
      path.join(__dirname, '../..'),
      process.env['LOCALAPPDATA'],
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      envPath('SystemRoot', 'System32'),
      envPath('SystemRoot', 'SysWOW64'),
      envPath('SystemRoot'),
    ],
    file: blacklist.mute,
  },
};

function normalizeAppid(appid) {
  return String(appid || '').trim();
}

// Ignore process paths listed in the optional mute filter.
function isMutedByPath(filepath, dirs) {
  if (!filepath) return false;
  // Normalize Windows paths even when tests run on another host.
  const norm = (p) => String(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  const file = norm(filepath);
  const lastSeparator = file.lastIndexOf('/');
  const dir = lastSeparator < 0 ? '' : file.slice(0, lastSeparator);
  return (Array.isArray(dirs) ? dirs : []).some((dirpath) => {
    if (!dirpath) return false;
    const root = norm(dirpath);
    return root !== '' && (dir === root || dir.startsWith(root + '/'));
  });
}

function getIgnoredAppids() {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(userExclusionFile).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (ignoredAppidsCache.mtimeMs === mtimeMs) return ignoredAppidsCache.set;

  const ignored = new Set(builtinIgnoredAppids);
  try {
    const user = JSON.parse(fs.readFileSync(userExclusionFile, 'utf8'));
    if (Array.isArray(user)) {
      for (const appid of user) ignored.add(normalizeAppid(appid));
    }
  } catch {
    // Optional user file; built-ins still apply.
  }
  ignoredAppidsCache = { mtimeMs, set: ignored };
  return ignored;
}

function isIgnoredAppid(appid) {
  const key = normalizeAppid(appid);
  return key !== '' && getIgnoredAppids().has(key);
}

function isWallpaperEngineProcess(process, filepath) {
  const proc = String(process || '').toLowerCase();
  const file = String(filepath || '').toLowerCase();
  return wallpaperProcessNames.has(proc) || file.includes('\\wallpaper_engine\\') || file.includes('/wallpaper_engine/');
}

// Keep process-name matching indexed, but evaluate user exclusions and demo filtering for every
// event. Both can change while the Watchdog is running, so putting either condition in the index
// would make a previously correct match stale.
function getTrackableGameMatches(binaryIndex, process, isIgnored = isIgnoredAppid) {
  return getBinaryMatches(binaryIndex, process).filter((game) => !isIgnored(game.appid) && !String(game.name || '').toLowerCase().includes('demo'));
}

function shouldMuteProcessPath(filepath, dirs, indexedMatches) {
  if (!isMutedByPath(filepath, dirs)) return false;
  // Profile folders remain muted for unknown processes, but an explicitly indexed manual game is
  // authoritative. This covers portable games and emulators stored on Desktop or in AppData.
  return !(indexedMatches || []).some((game) => String(game && game.source || '').toLowerCase() === 'manual');
}

async function init() {
  const emitter = new EventEmitter();

  let nowPlaying = [];
  // Expose startup sessions without replaying launch notifications.
  emitter.getActiveGames = () => snapshotActiveGames(nowPlaying);
  // The app re-seeds cfg/gameIndex.json after a library scan (e.g. a freshly installed non-Steam
  // game); reloading here lets the monitor track it without a full Watchdog restart.
  emitter.reloadGameIndex = async () => {
    const next = await getGameIndex();
    // A transient read failure can surface as an empty list while the Watchdog's own auto-detect is
    // writing the same file; never replace a working index with an empty one.
    if (next.length === 0 && gameIndex && gameIndex.length > 0) {
      debug.warn('[Playtime] gameIndex reload returned an empty index; keeping the current one');
      return gameIndex.length;
    }
    gameIndex = next;
    gameIndexByBinary = buildBinaryIndex(next);
    debug.log(`[Playtime] gameIndex reloaded ! ${next.length} game(s)`);
    return next.length;
  };
  appidByDirCache = new Map();
  gameIndex = await getGameIndex();
  gameIndexByBinary = buildBinaryIndex(gameIndex);

  // Seed unambiguous games that were already running at startup.
  let snapshot = [];
  try {
    snapshot = await tasklist.list();
  } catch (err) {
    debug.warn(`[Process trail] process snapshot failed => ${err}`);
  }
  for (const playing of buildSeededSessions({ gameIndex, processes: snapshot, now: Date.now(), createTimer: () => new Timer() })) {
    nowPlaying.push(playing);
    debug.log(`[Process trail] tracking already-running ${playing.name}(${playing.appid}) pid=${[...playing.pids].join(',')}`);
  }

  let processMonitor;
  if (process.env.AW_PROCESS_MONITOR === 'wql') {
    const WQL = await import('wql-process-monitor');
    processMonitor = await WQL.subscribe({
      bin: { filter: filter.ignore, whitelist: false },
    });
    debug.log('[Process trail] using native WQL monitor');
  } else {
    processMonitor = createPollingProcessMonitor({
      list: tasklist.list,
      initialProcesses: snapshot,
      // Resolved per creation event only. Without it the polling monitor has no image path at all,
      // so the "more than one game shares this binary" disambiguation and the mute-by-directory
      // filter below could never fire - they were WQL-only until this was wired up.
      resolvePath: tasklist.getProcessPath,
      onError: (err) => debug.warn(`[Process trail] process poll failed => ${err}`),
      shouldObserve: ({ process }) => {
        const name = process.toLowerCase();
        return !filter.ignore.some((bin) => bin.toLowerCase() === name);
      },
    });
    debug.log(
      `[Process trail] using polling monitor over ${tasklist.usingNativeSnapshot() ? 'the native process snapshot' : 'tasklist.exe (native snapshot unavailable)'}`
    );
  }

  processMonitor.on('creation', async ([process, pid, filepath]) => {
    const games = getTrackableGameMatches(gameIndexByBinary, process);
    // Apply path and process filters.
    if (isWallpaperEngineProcess(process, filepath)) return;
    if (filepath && shouldMuteProcessPath(filepath, filter.mute.dir, games)) return;
    if (filter.mute.file.some((bin) => bin.toLowerCase() === process.toLowerCase())) return;

    let game;

    if (games.length === 1) {
      //single hit
      game = games[0];
    } else {
      // More than one entry is always worth logging; an unmatched process is expected (most running
      // processes are not games) and is not logged to avoid filling playtime.log on a busy machine.
      if (games.length > 1) {
        debug.log(`More than 1 entry for "${process}"`);
      }
      if (!filepath) return;
      const gameDir = path.parse(filepath).dir;
      try {
        const dirKey = gameDir.toLowerCase();
        let appid;
        if (appidByDirCache.has(dirKey)) {
          appid = appidByDirCache.get(dirKey);
        } else {
          // findByReadingContentOfKnownConfigfilesIn() globs the whole game tree, so it must run at
          // most once per directory: cache the miss as well, otherwise every relaunch of the same
          // non-game binary re-walks it. Both outcomes count towards the cache cap.
          debug.log(`Try to find appid from a cfg file in "${gameDir}"`);
          appid = await findByReadingContentOfKnownConfigfilesIn(gameDir).catch(() => null);
          rememberAppidForDir(dirKey, appid);
        }
        if (!appid) return;
        debug.log(`Found appid: ${appid}`);
        if (isIgnoredAppid(appid)) {
          debug.log(`Ignoring blacklisted appid ${appid} for "${process}"`);
          return;
        }
        //double check that the appid is not on gameIndex:
        game = gameIndex.find((g) => g.appid === appid);
        if (!game) {
          const settings = require('../settings.js');
          const options = await settings.load(path.join(userDataDir(), 'cfg', 'options.ini'));
          const lang = options.achievement.lang;
          let d = await loadSteamData(appid, lang, process);
          // Not every app has a Steam "clienticon" (e.g. brand-new releases) - d.img.icon can be
          // undefined; guard it the same way achievements.js does instead of throwing here.
          const iconHash = d.img && d.img.icon ? String(d.img.icon).split('/').pop().split('.')[0] : '';
          game = { appid, binary: process, icon: iconHash, name: d.name };
          addToGameIndex(game);
        }
      } catch (err) {
        debug.warn(err);
      }
    }

    if (!game) return;
    if (isIgnoredAppid(game.appid)) {
      debug.log(`Ignoring blacklisted appid ${game.appid} for "${process}"`);
      return;
    }
    debug.log(`DB Hit for ${game.name}(${game.appid}) ["${filepath || process}"]`);
    // Track child processes in one session so the timer starts and stops once.
    const alreadyPlaying = nowPlaying.find((g) => g.appid === game.appid);
    if (alreadyPlaying) {
      alreadyPlaying.pids.add(pid);
      debug.log(`Tracking additional process "${process}"(${pid}) for ${game.name}`);
    } else {
      const playing = Object.assign(game, {
        pids: new Set([pid]),
        timer: new Timer(),
        exePath: filepath || '',
        gameDir: filepath ? path.parse(filepath).dir : '',
      });
      debug.log(playing);

      nowPlaying.push(playing);
      emitter.emit('enable-overlay', game.appid);
      emitter.emit('notify', [game]);
    }
  });

  processMonitor.on('deletion', ([process, pid]) => {
    // PID is authoritative; process names may differ at exit.
    const game = nowPlaying.find((g) => g.pids.has(pid));

    if (!game) return;

    game.pids.delete(pid);
    if (game.pids.size > 0) return; //other processes of this game are still running

    debug.log(`Stop playing ${game.name}(${game.appid})`);
    game.timer.stop();
    const playedtime = game.timer.played;

    let index = nowPlaying.indexOf(game);
    if (index !== -1) {
      nowPlaying.splice(index, 1);
    } //remove from nowPlaying

    debug.log('playtime: ' + Math.floor(playedtime / 60) + 'min');

    TimeTrack(game.appid, playedtime).catch((err) => {
      debug.error(err);
    });
    emitter.emit('disable-overlay');
    // Emit the raw played seconds; the watchdog formats & localizes the notification text.
    emitter.emit('notify', [game, playedtime]);
  });

  return emitter;
}

async function addToGameIndex(game) {
  if (isIgnoredAppid(game.appid)) return;
  let userOverride;
  try {
    userOverride = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'cfg', 'gameIndex.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') userOverride = [];
  }
  if (userOverride.find((g) => g.appid === game.appid)) return;
  userOverride.push(game);
  fs.writeFileSync(path.join(userDataDir(), 'cfg', 'gameIndex.json'), JSON.stringify(userOverride), 'utf8');
  gameIndex.push(game);
  gameIndexByBinary = buildBinaryIndex(gameIndex);
  debug.log(`Added ${game.name} to GameIndex.json`);
}

async function getGameIndex() {
  //Temporary esm in cjs load | REPLACE ME when using ESM !
  //Warning @xan105/is targets >= node16 but should be fine.
  const { shouldArrayOfObjWithProperties } = (await import('@xan105/is')).assert;

  const filePath = {
    cache: path.join(userDataDir(), 'steam_cache/schema', 'gameIndex.json'),
    user: path.join(userDataDir(), 'cfg', 'gameIndex.json'),
  };

  let gameIndex = [],
    userOverride = [];

  try {
    if (fs.existsSync(filePath.cache)) {
      gameIndex = JSON.parse(fs.readFileSync(filePath.cache, 'utf8'));
    }
    if (gameIndex) debug.log(`[Playtime] gameIndex loaded ! ${gameIndex.length} game(s)`);
  } catch (err) {
    debug.error(err);
    gameIndex = [];
  }

  try {
    userOverride = JSON.parse(fs.readFileSync(filePath.user, 'utf8'));
    //shouldArrayOfObjWithProperties(userOverride, ['appid', 'name', 'binary', 'icon']);
    debug.log(`[Playtime] user gameIndex loaded ! ${userOverride.length} override(s)`);
  } catch (err) {
    if (err) if (err.code !== 'ENOENT') debug.error(err);
    userOverride = [];
  }

  //Merge (assign) arrB in arrA using prop as unique key
  const mergeArrayOfObj = (arrA, arrB, prop) => arrA.filter((a) => !arrB.find((b) => a[prop] === b[prop])).concat(arrB);
  return mergeArrayOfObj(gameIndex, userOverride, 'appid').filter((game) => !isIgnoredAppid(game.appid));
}

module.exports = { init, isMutedByPath, shouldMuteProcessPath, getTrackableGameMatches };
