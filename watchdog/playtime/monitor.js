'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('request-zero');
const EventEmitter = require('emittery');
const tasklist = require('win-tasklist');
const Timer = require('./timer.js');
const TimeTrack = require('./track.js');
const { findByReadingContentOfKnownConfigfilesIn } = require('./steam_appid_find.js');
const { loadSteamData } = require('../steam.js');

const debug = new (require('@xan105/log'))({
  console: true,
  file: path.join(process.env['APPDATA'], 'Achievement Watcher/logs/playtime.log'),
});

const appdataPath = process.env['APPDATA'];
// filter.json is an optional, machine-local process blacklist (gitignored, not shipped, and nothing
// generates it). On a fresh install/clone it is absent — a hard require() here threw MODULE_NOT_FOUND,
// crashing the monitor on boot and crash-looping it, which silently killed playtime tracking,
// game-launch detection and live notifications. Fall back to empty lists so the monitor always starts;
// the lists are only a noise-reduction optimisation, not required for correctness.
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
let savedConfigs;

const systemTempDir = os.tmpdir() || process.env['TEMP'] || process.env['TMP'];

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
      path.join(process.env['SystemRoot'], 'System32'),
      path.join(process.env['SystemRoot'], 'SysWOW64'),
      path.join(process.env['SystemRoot']),
    ],
    file: blacklist.mute,
  },
};

// Case-insensitive match of a running process name against a game's stored binary, tolerating the
// Unreal Engine "<name>-Win64-Shipping.exe" variant. Returns false for entries with a missing/empty
// binary so a malformed index entry can never silently cross-track a process that belongs to another
// game (issue #36), and never throws on a null binary.
function binaryMatchesProcess(binary, process) {
  if (typeof binary !== 'string') return false;
  const b = binary.trim().toLowerCase();
  if (!b) return false;
  const p = String(process || '').toLowerCase();
  if (!p) return false;
  return b === p || b.replace('.exe', '-win64-shipping.exe') === p;
}

async function init() {
  const emitter = new EventEmitter();

  // wql-process-monitor is ESM-only (koffi) since v2 — load it via dynamic import (Node caches it).
  const WQL = await import('wql-process-monitor');

  let nowPlaying = [];
  gameIndex = await getGameIndex();
  await getSavedConfigs();

  // createEventSink() is auto-invoked by subscribe() since v2, so we no longer call it explicitly.
  // The built-in "Windows noise"/"usual program locations" filters were removed in v2; we intentionally
  // never used them anyway (filterWindowsNoise/filterUsualProgramLocations were both false) because
  // elevated processes — scene releases are usually UAC-elevated out of the box — must still be caught.
  // We only exclude known OS/background noise by process name via bin.filter (filter.ignore).
  // cf: https://github.com/xan105/node-processMonitor/issues/2
  const processMonitor = await WQL.subscribe({
    bin: { filter: filter.ignore, whitelist: false },
  });

  processMonitor.on('creation', async ([process, pid, filepath]) => {
    //Mute event
    if (!filepath) return;
    if (filter.mute.dir.some((dirpath) => path.parse(filepath).dir.toLowerCase().startsWith(dirpath.toLowerCase()))) return;
    if (filter.mute.file.some((bin) => bin.toLowerCase() === process.toLowerCase())) return;

    const games = gameIndex.filter(
      (game) => binaryMatchesProcess(game.binary, process) && !String(game.name || '').toLowerCase().includes('demo')
    );

    let game;

    if (games.length === 1) {
      //single hit
      game = games[0];
    } else {
      //more than one entry or it's a new game
      debug.log(games.length > 1 ? `More than 1 entry for "${process}"` : `No entry found for ${process}`);
      const gameDir = path.parse(filepath).dir;
      debug.log(`Try to find appid from a cfg file in "${gameDir}"`);
      try {
        const appid = await findByReadingContentOfKnownConfigfilesIn(gameDir);
        debug.log(`Found appid: ${appid}`);
        //double check that the appid is not on gameIndex:
        game = gameIndex.find((g) => g.appid === appid);
        if (!game) {
          const settings = require('../settings.js');
          const options = await settings.load(path.join(appdataPath, 'Achievement Watcher/cfg', 'options.ini'));
          const lang = options.achievement.lang;
          const apikey = options.steam.apiKey;
          let d = await loadSteamData(appid, lang, apikey, process);
          game = { appid, binary: process, icon: d.img.icon.split('/').pop().split('.')[0], name: d.name };
          addToGameIndex(game);
        }
      } catch (err) {
        debug.warn(err);
      }
    }

    if (!game) return;
    debug.log(`DB Hit for ${game.name}(${game.appid}) ["${filepath}"]`);
    //TODO: get launched game and add it to exeList
    //TODO: check for game updates?

    //RunningAppID is not that reliable and this intefere with Greenluma; Commenting out for now
    /*const runningAppID = await regedit.promises.RegQueryIntegerValue("HKCU","SOFTWARE/Valve/Steam", "RunningAppID") || 0;
    if (+runningAppID == game.appid){
      debug.warn("RunningAppID found! Checking if Steam is running...");
      const isSteamRunning = await tasklist.isProcessRunning("steam.exe").catch((err) => { return false });
      if (isSteamRunning){
        debug.warn("Ignoring game launched by Steam");
        return;
      }
    }*/

    //A game can spawn several processes (e.g. TLOU II runs crs-video.exe for the
    //intro alongside the main tlou-ii.exe). Track them as a Set of pids on a single
    //session so the timer starts once and only ends when every process is gone,
    //rather than restarting/duplicating the session per extra process.
    const alreadyPlaying = nowPlaying.find((g) => g.appid === game.appid);
    if (alreadyPlaying) {
      alreadyPlaying.pids.add(pid);
      debug.log(`Tracking additional process "${process}"(${pid}) for ${game.name}`);
    } else {
      const playing = Object.assign(game, {
        pids: new Set([pid]),
        timer: new Timer(),
      });
      debug.log(playing);

      nowPlaying.push(playing);
      emitter.emit('enable-overlay', game.appid);
      emitter.emit('notify', [game]);
    }
  });

  processMonitor.on('deletion', ([process, pid]) => {
    //Match on pid alone: it already uniquely identifies a process we chose to track in
    //nowPlaying, so re-checking the stored binary here is both redundant and harmful.
    //Many games run under a process name that differs from their gameIndex entry (e.g.
    //tlou-ii.exe vs the stored tlou-ii-l.exe); the old binary check never matched on exit,
    //so the timer never stopped and playtime was never recorded.
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
  let userOverride;
  try {
    userOverride = JSON.parse(fs.readFileSync(path.join(appdataPath, 'Achievement Watcher/cfg', 'gameIndex.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') userOverride = [];
  }
  if (userOverride.find((g) => g.appid === game.appid)) return;
  userOverride.push(game);
  fs.writeFileSync(path.join(appdataPath, 'Achievement Watcher/cfg', 'gameIndex.json'), JSON.stringify(userOverride), 'utf8');
  gameIndex.push(game);
  debug.log(`Added ${game.name} to GameIndex.json`);
}

async function getGameIndex() {
  //Temporary esm in cjs load | REPLACE ME when using ESM !
  //Warning @xan105/is targets >= node16 but should be fine.
  const { shouldArrayOfObjWithProperties } = (await import('@xan105/is')).assert;

  const filePath = {
    cache: path.join(process.env['APPDATA'], 'Achievement Watcher/steam_cache/schema', 'gameIndex.json'),
    user: path.join(process.env['APPDATA'], 'Achievement Watcher/cfg', 'gameIndex.json'),
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
  return mergeArrayOfObj(gameIndex, userOverride, 'appid');
}

async function getSavedConfigs() {
  const filepath = path.join(process.env['APPDATA'], 'Achievement Watcher/cfg', 'exeList.json');

  try {
    if (fs.existsSync(filepath)) {
      savedConfigs = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      return;
    }
  } catch (e) {
    debug.log(e);
  }
  savedConfigs = [];
}

module.exports = { init };
