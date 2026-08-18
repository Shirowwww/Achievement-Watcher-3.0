'use strict';

const path = require('path');
const glob = require('fast-glob');
const normalize = require('normalize-path');
const ini = require('../util/ini');
const omit = require('lodash.omit');
const moment = require('moment');
const request = require('request-zero');
const urlParser = require('url');
const { readRegistryStringAndExpand, regKeyExists, readRegistryInteger, readRegistryString, listRegistryAllSubkeys } = require('../util/reg');
const appPath = path.join(__dirname, '../');
const steamID = require(path.join(appPath, 'util/steamID.js'));
const fuzzyAppid = require(path.join(appPath, 'util/fuzzyAppid.js'));
const { ipcInvoke } = require(path.join(appPath, 'util/ipcInvoke.js'));
const steamLanguages = require(path.join(appPath, 'locale/steam.json'));
const sse = require(path.join(appPath, 'parser/sse.js'));
const htmlParser = require('node-html-parser');
const fs = require('fs');
const saveRoots = require(path.join(appPath, 'parser/saveRoots.js'));
const uplayR2 = require(path.join(appPath, 'parser/uplayR2.js'));
const emuIni = require(path.join(appPath, 'util/emuIni.js'));
const { userDataDir } = require(path.join(appPath, 'util/userDataPath.js'));
const { mergeTranslatedAchievements } = require('./achievementTranslations.js');
const steamSchemaFetch = require(path.join(appPath, 'util/steamSchemaFetch.js'));

let listReady = true;
// Set when the app-list download fails, so it is attempted once per session and not once per appid.
let appListRefreshFailed = false;
let steamUsersList;
let appidListMap = new Map();
let debug;
let cacheRoot;
const storeDataInFlight = new Map();
const iconFetchInFlight = new Map();
const workingLinkCache = new Map();
const appSearchCache = new Map();
const TENOKE_SCHEMA_FILE = 'tenoke.ini';
module.exports.setUserDataPath = (p) => {
  cacheRoot = p;
};

module.exports.initDebug = ({ isDev, userDataPath }) => {
  this.setUserDataPath(userDataPath);
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

module.exports.scan = async (additionalSearch = []) => {
  try {
    let search = saveRoots.defaultSteamScanRoots(additionalSearch);

    search = search.map((dir) => {
      return normalize(dir) + '/([0-9]+)';
    });

    let data = [];
    for (let dir of await glob(search, { onlyDirectories: true, absolute: true })) {
      let game = {
        appid: path.parse(dir).name,
        data: {
          type: 'file',
          path: dir,
        },
      };

      const dirKey = String(dir).replace(/\\/g, '/');
      const dirKeyLower = dirKey.toLowerCase();
      if (dirKeyLower.includes('codex')) {
        game.source = 'Codex';
      } else if (dirKeyLower.includes('rune')) {
        game.source = 'Rune';
      } else if (dirKeyLower.includes('onlinefix')) {
        game.source = 'OnlineFix';
      } else if (dirKeyLower.includes('goldberg uplayemu')) {
        // "Goldberg UplayEmu Saves" folders are named with the Ubisoft product id, not a Steam AppID -
        // asking Steam about them burned a 30s timeout per game and re-triggered full refreshes.
        // Translate the id via uplay-steam.json and skip folders with no Steam counterpart.
        const mapping = uplayR2.resolveSteamMapping({ appid: `UPLAY${game.appid}` });
        if (!mapping) {
          // scan() can run before initDebug() (the watchdog seeds its index straight from it).
          if (debug) debug.log(`[uplay-r2] ignoring save folder '${dir}' - no Steam equivalent for Ubisoft product id ${game.appid}`);
          continue;
        }
        game.data.type = 'uplayR2';
        game.data.uplayId = String(game.appid);
        game.data.uplayR2 = true;
        game.data.system = 'uplay';
        game.appid = String(mapping.steam_appid);
        game.name = mapping.steam_name;
        game.source = 'Goldberg Uplay';
      } else if (dirKeyLower.includes('goldberg') || dirKeyLower.includes('gse')) {
        game.source = 'Goldberg';
      } else if (dirKeyLower.includes('empress')) {
        game.source = 'Goldberg (EMPRESS)';
        game.data.path = path.join(game.data.path, 'remote', game.appid);
      } else if (dirKeyLower.includes('skidrow')) {
        game.source = 'Skidrow';
      } else if (dirKeyLower.includes('smartsteamemu')) {
        game.source = 'SmartSteamEmu';
      } else if (dirKeyLower.includes('programdata/steam')) {
        game.source = 'Reloaded - 3DM';
      } else if (dirKeyLower.includes('creamapi')) {
        game.source = 'CreamAPI';
      } else if (dirKeyLower.includes('steam')) {
        game.source = 'Steam';
      } else {
        // A custom watched folder (issue #12) that doesn't match any known emulator/scene layout by
        // name still holds a real numeric-AppID save folder - leaving source unset let the game object
        // downstream carry an undefined source instead of a readable label.
        game.source = 'Steam-emulator';
      }

      data.push(game);
    }
    return data;
  } catch (err) {
    throw err;
  }
};

module.exports.scanLegit = async (listingType = 0, steamAccFilter = '0') => {
  try {
    let data = [];

    if (regKeyExists('HKCU', 'Software/Valve/Steam') && listingType > 0) {
      let steamPath = await getSteamPath();
      let publicUsers = await getSteamUsers(steamPath);
      if (steamAccFilter !== '0' && publicUsers.find((p) => p.user === steamAccFilter))
        publicUsers = publicUsers.filter((u) => u.user === steamAccFilter);

      let steamCache = path.join(steamPath, 'appcache/stats');
      let list = (await glob('UserGameStats_*([0-9])_*([0-9]).bin', { cwd: steamCache, onlyFiles: true, absolute: false })).map((filename) => {
        let matches = filename.match(/([0-9]+)/g);
        return {
          userID: matches[0],
          appID: matches[1],
        };
      });

      for (let stats of list) {
        // Steam's own per-game registry flag: 1 when the game is on disk, missing/0 when it is
        // merely owned. Capture it for every entry so "owned" mode never makes the installed
        // filter trust a game that isn't actually installed (e.g. Assassin's Creed Mirage).
        const installedFlag = readRegistryInteger('HKCU', `Software/Valve/Steam/Apps/${stats.appID}`, 'Installed') === 1;
        const isInstalled = listingType == 1 ? installedFlag : true;

        let user = publicUsers.find((user) => user.user == stats.userID);

        if (user && isInstalled) {
          data.push({
            appid: stats.appID,
            source: `Steam (${user.name})`,
            data: {
              type: 'steamAPI',
              userID: user,
              cachePath: steamCache,
              installed: installedFlag,
            },
          });
        }
      }
    } else {
      throw 'Legit Steam not found or disabled.';
    }

    return data;
  } catch (err) {
    throw err;
  }
};

module.exports.getCachedData = (cfg) => {
  if (!steamLanguages.some((language) => language.api === cfg.lang)) {
    throw 'Unsupported API language code';
  }

  const cache = path.join(cacheRoot, 'steam_cache/schema', cfg.lang);
  let result;
  try {
    let filePath = path.join(`${cache}`, `${cfg.appID}.db`);
    if (fs.existsSync(filePath)) {
      result = JSON.parse(fs.readFileSync(filePath));
    }
  } catch (err) {
    if (err.code) throw `Could not load Steam data: ${err.code} - ${err.message}`;
    else throw `Could not load Steam data: ${err}`;
  }
  return result;
};

module.exports.saveGameToCache = async (cfg) => {
  const cache = path.join(cacheRoot, 'steam_cache/schema', cfg.lang);
  const filePath = path.join(`${cache}`, `${cfg.appid}.db`);

  const result = {
    name: cfg.name,
    appid: cfg.appid,
    binary: null,
    img: {
      header: cfg.header,
      background: cfg.background,
      portrait: cfg.portrait,
      icon: cfg.icon,
    },
    achievement: {
      total: cfg.achievements.length,
      list: cfg.achievements,
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
};

/*
  A cached schema whose name resolved but whose achievement list is empty is ambiguous: the game
  may genuinely have none (UNDERTALE), or the entry was written by a fetch that reached the store
  page but not the schema. getCachedData has no TTL and getGameData only tests `name`, so the
  second case used to freeze forever - and every scan then paid a full local-schema walk to
  compensate. Re-check such an entry at most once per window; the check is stamped on the record
  so a genuinely achievement-less game costs one lookup per window, not one per scan.
*/
const EMPTY_SCHEMA_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

module.exports.isStaleEmptySchema = (cached, now = Date.now()) => {
  if (!cached || !cached.name) return false;
  const list = cached.achievement && cached.achievement.list;
  if (!Array.isArray(list) || list.length > 0) return false;
  const at = Number(cached.emptyCheckedAt);
  return !(Number.isFinite(at) && at > 0 && now - at < EMPTY_SCHEMA_RECHECK_MS);
};

// Cache definitive Steam misses briefly; never cache a network outage.
const NEGATIVE_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
let _negativeCache = null;

function negativeCacheFile() {
  return cacheRoot ? path.join(cacheRoot, 'steam_cache', 'unresolved.json') : '';
}

function loadNegativeCache() {
  if (_negativeCache) return _negativeCache;
  _negativeCache = new Map();
  try {
    const file = negativeCacheFile();
    if (file && fs.existsSync(file)) {
      for (const [key, at] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) || {})) {
        if (Date.now() - Number(at) < NEGATIVE_CACHE_TTL_MS) _negativeCache.set(key, Number(at));
      }
    }
  } catch {
    /* A corrupt cache is equivalent to an empty cache. */
  }
  return _negativeCache;
}

function isKnownUnresolved(appID) {
  return loadNegativeCache().has(String(appID));
}

function rememberUnresolved(appID) {
  const cache = loadNegativeCache();
  cache.set(String(appID), Date.now());
  try {
    const file = negativeCacheFile();
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* The in-memory copy remains usable. */
  }
}

// A miss is meaningful only when the app list was available.
module.exports.shouldRememberUnresolved = ({ hasResult, inAppList, appListLoaded } = {}) =>
  !hasResult && !inAppList && !!appListLoaded;

// Drop the memo for one appid (or all of them) so a manual retry really re-checks Steam.
module.exports.forgetUnresolved = (appID) => {
  const cache = loadNegativeCache();
  if (appID == null) cache.clear();
  else cache.delete(String(appID));
  try {
    const file = negativeCacheFile();
    if (file) fs.writeFileSync(file, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* Best effort. */
  }
};

// Merges a fresh fetch into the cached list (matched by apiName): patches blank fields and appends
// achievements missing from `list`. Mutates in place; never removes an entry, so a short/failed
// fetch can't delete unlocked history.
module.exports.reconcileAchievementList = (list, fresh) => {
  if (!Array.isArray(list) || !Array.isArray(fresh) || fresh.length === 0) return { changed: false, addedCount: 0 };
  let changed = false;
  const freshByName = new Map(fresh.filter((a) => a && a.name != null).map((a) => [String(a.name).toUpperCase(), a]));
  for (const ach of list) {
    const f = freshByName.get(String(ach.name).toUpperCase());
    if (!f) continue;
    if ((!ach.description || String(ach.description).trim() === '') && f.description) {
      ach.description = f.description;
      changed = true;
    }
    if ((!ach.displayName || String(ach.displayName).trim() === '') && f.displayName) {
      ach.displayName = f.displayName;
      changed = true;
    }
    if (ach.hidden == null && f.hidden != null) {
      ach.hidden = f.hidden;
      changed = true;
    }
  }
  const knownNames = new Set(list.filter((a) => a && a.name != null).map((a) => String(a.name).toUpperCase()));
  const added = [];
  for (const achievement of fresh) {
    if (!achievement || achievement.name == null) continue;
    const key = String(achievement.name).toUpperCase();
    if (knownNames.has(key)) continue;
    knownNames.add(key);
    added.push(achievement);
  }
  if (added.length) {
    list.push(...added);
    changed = true;
  }
  return { changed, addedCount: added.length };
};

module.exports.getGameData = async (cfg) => {
  if (!steamLanguages.some((language) => language.api === cfg.lang)) {
    throw 'Unsupported API language code';
  }
  let result;
  let needSaving = false;
  const fastStart = cfg.fastStart === true;
  const cache = path.join(cacheRoot, 'steam_cache/schema', cfg.lang);
  let filePath = path.join(`${cache}`, `${cfg.appID}.db`);

  try {
    result = this.getCachedData(cfg);
    // Ambiguous empty entry (see isStaleEmptySchema): fall through to the fetch path below, but
    // keep the record so a failed re-check can hand it back untouched.
    const staleEmpty = module.exports.isStaleEmptySchema(result) ? result : undefined;
    if (staleEmpty) result = undefined;
    if ((!result || !result.name) && isKnownUnresolved(cfg.appID)) {
      debug.log(`[${cfg.appID}] skipped: known to have no Steam data (cached miss)`);
      return staleEmpty;
    }
    if (!result || !result.name) {
      // A brand-new appid may not be in the GetAppList dump yet; getProductInfo/store still resolve
      // it, so only give up when the fetch comes back empty AND the id was never listed.
      let inAppList = false;
      try {
        inAppList = await findInAppList(+cfg.appID);
        result = await getSteamDataFromSRV(cfg.appID, cfg.lang);
      } catch (err) {
        // Offline, every one of these lookups throws. This is a re-check of an entry we already
        // have, so a throw must not be able to lose it - otherwise one offline scan drops every
        // re-checked game at once. With nothing cached, the original error path is untouched.
        if (!staleEmpty) throw err;
        debug.log(`[${cfg.appID}] empty-schema re-check could not run, keeping the cached entry: ${err.code || err}`);
        return staleEmpty;
      }
      // findInAppList() resolves the canonical store name (app-list dump, or the per-appid `name`
      // IPC when the dump is missing). It is an INDEPENDENT lookup from the product-info call
      // inside getSteamDataFromSRV, so when that one comes back nameless the name is very often
      // already in hand - and throwing it away is what left a card titled with its bare appid while
      // its artwork (built from the appid alone) rendered fine (issue #34).
      const listedName = typeof inAppList === 'string' && inAppList.trim() ? inAppList.trim() : '';
      if (result && !result.name && listedName) {
        result.name = listedName;
        debug.log(`[${cfg.appID}] product info returned no name; using the app-list name "${listedName}"`);
      }

      if ((!result || !result.name) && staleEmpty) {
        // The re-check came back empty-handed (offline, rate-limited, store 404). Hand back the
        // record we already had and leave it unstamped: nothing was verified, so the next scan
        // is free to try again. Dropping it here would empty the list on every offline scan.
        return staleEmpty;
      }
      if ((!result || !result.name) && !inAppList) {
        // Only a miss against a list we actually have says anything about this appid (see the
        // negative-cache comment above); offline, everything misses.
        if (module.exports.shouldRememberUnresolved({ hasResult: !!(result && result.name), inAppList, appListLoaded: appListUsable() })) {
          rememberUnresolved(cfg.appID);
        }
        throw `Error trying to load steam data for ${cfg.appID}`;
      }
      needSaving = true;
    }

    if (staleEmpty && Array.isArray(result?.achievement?.list) && result.achievement.list.length === 0) {
      // Verified: this game really has no achievements. Keep the entry we already had - its
      // artwork may have been resolved over several runs - and stamp the check onto it.
      result = staleEmpty;
      result.emptyCheckedAt = Date.now();
      needSaving = true;
    }

    // Self-repair: patch blank fields and pick up achievements a game update added (Steam gives no
    // change notification). Runs every 3 days, or immediately if forced from Settings > Advanced.
    const DESC_RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
    const triedRecently = !cfg.forceRecheck && result && result.descBackfilledAt && Date.now() - result.descBackfilledAt < DESC_RECHECK_MS;
    if ((!fastStart || cfg.forceRecheck) && result && result.achievement && Array.isArray(result.achievement.list) && !triedRecently) {
      try {
        const fresh = await getSchemaAchievements(cfg);
        const { addedCount } = module.exports.reconcileAchievementList(result.achievement.list, fresh);
        if (addedCount) {
          result.achievement.total = result.achievement.list.length;
          debug.log(`[${cfg.appID}] picked up ${addedCount} new achievement(s) from a game update`);
        }
      } catch (err) {
        debug.log(`Could not refresh schema descriptions [${cfg.appID}]: ${err.code ? `${err.code} - ${err.message}` : err}`);
      }
      result.descBackfilledAt = Date.now(); // remember the attempt even when nothing improved
      needSaving = true;
    }

    needSaving = needSaving || (!fastStart && (await GetMissingData(result, cfg.showHidden, cfg.lang, cfg.steamSettings)));
    if (needSaving) {
      // A record with no name is not a schema, it is a failed lookup wearing one. Writing it would
      // serve a nameless entry from cache on the next scan (and JSON.stringify(undefined) writes the
      // literal "undefined", which only reads back as a corrupt cache). Keep it in memory for this
      // scan and let the next one retry the fetch (issue #34).
      if (result && result.name) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
      } else {
        debug.log(`[${cfg.appID}] not caching a schema with no name - the next scan will retry the lookup`);
      }
    }
    return result;
  } catch (err) {
    if (err.code) debug.log(`Could not load Steam data [${cfg.appID}]: ${err.code} - ${err.message}${err.url ? ' url=' + err.url : ''}`);
    else debug.log(`Could not load Steam data [${cfg.appID}]: ${err}`);
  }
};

module.exports.getAchievementsFromFile = async (filePath) => {
  try {
    const files = [
      'achievements.ini',
      'achievements.json',
      'stats.json',
      'achiev.ini',
      'stats.ini',
      'Achievements.Bin',
      'achieve.dat',
      'Achievements.ini',
      'stats/achievements.ini',
      'stats.bin',
      'stats/CreamAPI.Achievements.cfg',
      'SteamEmu/UserStats/achiev.ini',
      'user_stats.ini',
    ];

    const filter = ['SteamAchievements', 'Steam64', 'Steam'];

    let local;
    let matchedFile;
    for (let file of files) {
      try {
        if (path.parse(file).ext == '.json') {
          local = JSON.parse(fs.readFileSync(path.join(filePath, file), 'utf8'));
        } else if (file === 'stats.bin') {
          local = sse.parse(fs.readFileSync(path.join(filePath, file)));
        } else {
          local = ini.parse(fs.readFileSync(path.join(filePath, file), 'utf8'));
        }
        matchedFile = file;
        break;
      } catch (e) {}
    }
    if (!local) throw `No achievement file found in '${filePath}'`;

    let result = {};

    if (local.AchievementsUnlockTimes && local.Achievements) {
      //hoodlum DARKSiDERS

      for (let i in local.Achievements) {
        if (Object.prototype.hasOwnProperty.call(local.Achievements, i)) {
          if (local.Achievements[i] == 1) {
            result[`${i}`] = { Achieved: '1', UnlockTime: local.AchievementsUnlockTimes[i] || null };
          }
        }
      }
    } else if (local.State && local.Time) {
      //3DM

      for (let i in local.State) {
        if (Object.prototype.hasOwnProperty.call(local.State, i)) {
          if (local.State[i] == '0101') {
            result[i] = {
              Achieved: '1',
              UnlockTime: new DataView(new Uint8Array(Buffer.from(local.Time[i].toString(), 'hex')).buffer).getUint32(0, true) || null,
            };
          }
        }
      }
    } else if (local.ACHIEVEMENTS) {
      // TENOKE: cross-reference the sibling [STATS] section (raw stat values) by the achievement's own
      // key, since achievements.js can't see it once this function returns. Section casing varies, so
      // match it case-insensitively.
      const statsSectionKey = Object.keys(local).find((k) => String(k).toLowerCase() === 'stats');
      const statsSection = statsSectionKey && typeof local[statsSectionKey] === 'object' ? local[statsSectionKey] : {};
      const tenokeStatValues = {};
      for (let s in statsSection) {
        if (!Object.prototype.hasOwnProperty.call(statsSection, s)) continue;
        const statKey = s.replace(/^"|"$/g, '');
        const statNum = Number(String(statsSection[s]).replace(/,\s*$/, ''));
        if (statKey && Number.isFinite(statNum)) tenokeStatValues[statKey] = statNum;
      }

      for (let i in local.ACHIEVEMENTS) {
        if (!Object.prototype.hasOwnProperty.call(local.ACHIEVEMENTS, i)) continue;
        const key = i.replace(/^"|"$/g, '');
        const raw = local.ACHIEVEMENTS[i]; // e.g. "{unlocked=true, time=1712253396}"
        const unlockedMatch = /unlocked\s*=\s*(true|false)/i.exec(raw);
        const timeMatch = /time\s*=\s*(\d+)/i.exec(raw);
        // Older Tenoke saves can store progress inline on the achievement entry itself. Only trust
        // the value when it is a finite number (a malformed tail like "12.5.3" must not become NaN
        // in the baseline - it would poison progress notifications for the rest of the session).
        const progressMatch = /(?:progress|value)\s*=\s*([\d.]+)/i.exec(raw);
        const progressNum = progressMatch ? Number(progressMatch[1]) : NaN;

        const unlocked = unlockedMatch ? unlockedMatch[1].toLowerCase() === 'true' : false;
        const time = timeMatch ? Number(timeMatch[1]) : 0;

        result[key] = {
          Achieved: unlocked ? '1' : '0',
          UnlockTime: time,
        };
        if (Number.isFinite(progressNum)) {
          result[key].CurProgress = progressNum;
        } else if (key in tenokeStatValues) {
          result[key].CurProgress = tenokeStatValues[key];
        }
      }
    } else {
      result = omit(local.ACHIEVE_DATA || local, filter);
    }

    for (let i in result) {
      if (Object.prototype.hasOwnProperty.call(result, i)) {
        if (result[i].State) {
          //RLD!
          try {
            //uint32 little endian
            result[i].State = new DataView(new Uint8Array(Buffer.from(result[i].State.toString(), 'hex')).buffer).getUint32(0, true);
            result[i].CurProgress = new DataView(new Uint8Array(Buffer.from(result[i].CurProgress.toString(), 'hex')).buffer).getUint32(0, true);
            result[i].MaxProgress = new DataView(new Uint8Array(Buffer.from(result[i].MaxProgress.toString(), 'hex')).buffer).getUint32(0, true);
            result[i].Time = new DataView(new Uint8Array(Buffer.from(result[i].Time.toString(), 'hex')).buffer).getUint32(0, true);
          } catch (e) {}
        } else if (result[i].unlocktime && result[i].unlocktime.length === 7) {
          //creamAPI
          result[i].unlocktime = +result[i].unlocktime * 1000; //cf: https://cs.rin.ru/forum/viewtopic.php?p=2074273#p2074273 | timestamp is invalid/incomplete
        }
      }
    }

    // Merge sibling Stats.ini values for progress-type achievements.
    if (matchedFile && /achievements\.ini$/i.test(matchedFile)) {
      for (const statsName of ['Stats.ini', 'stats.ini']) {
        const statsPath = path.join(filePath, path.dirname(matchedFile), statsName);
        let statsSize = -1;
        try {
          statsSize = fs.statSync(statsPath).size;
        } catch {
          continue; // doesn't exist under this casing - try the next candidate
        }
        if (statsSize === 0) break; // present but empty: nothing to merge, not an error
        try {
          const doc = emuIni.parseIni(fs.readFileSync(statsPath, 'utf8'));
          const values = emuIni.readIniSectionValues(doc, 'Stats');
          const resultKeys = new Set(Object.keys(result).map((k) => String(k).toUpperCase()));
          const rawStatKeys = [];
          for (const [name, raw] of Object.entries(values)) {
            // readIniSectionValues lower-cases stat names while achievement keys keep the repack's
            // original casing, so the shadow guard must be case-insensitive.
            if (resultKeys.has(String(name).toUpperCase())) continue; // never shadow a real achievement entry
            const num = Number(raw);
            if (Number.isFinite(num)) {
              result[name] = num;
              rawStatKeys.push(name);
            }
          }
          // These are raw stat values, not achievement records - they only exist so
          // statProgress.js's applyLocalStatProgress can resolve progress-type achievements via the
          // local GBE schema's operand1. Tag them non-enumerable so achievements.js can strip them
          // out of `root` after that mapping runs, instead of the achievement-matching loop trying
          // (and failing) to match a schema entry literally named e.g. "stat_1".
          if (rawStatKeys.length > 0) {
            Object.defineProperty(result, '__rawStatKeys', { value: rawStatKeys, enumerable: false, configurable: true });
          }
        } catch (e) {}
        break;
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};

module.exports.getAchievementsFromAPI = async (cfg) => {
  try {
    let result;

    let cache = {
      local: path.join(cacheRoot, 'steam_cache/user', cfg.user.user, `${cfg.appID}.db`),
      steam: path.join(`${cfg.path}`, `UserGameStats_${cfg.user.user}_${cfg.appID}.bin`),
    };

    let time = {
      local: 0,
      steam: 0,
    };

    if (fs.existsSync(cache.local)) {
      let local = fs.statSync(cache.local);
      if (Object.keys(local).length > 0) time.local = moment(local.mtime).valueOf();
    }

    let steamStats = fs.statSync(cache.steam);
    if (Object.keys(steamStats).length > 0) {
      time.steam = moment(steamStats.mtime).valueOf();
    } else {
      throw 'No Steam cache file found';
    }

    if (time.steam > time.local) {
      // Local-first: the freshly rewritten bin IS the state we're after - parse it together with
      // the sibling UserGameStatsSchema bin (statId/bit mapping) instead of asking the network.
      // Works offline/keyless and also carries achievement progress. Only when the schema bin is
      // absent/unreadable does the old WebAPI/steamcommunity round-trip run.
      const steamOfficial = require('./steamOfficial.js');
      result = steamOfficial.readLocalUserStats({ statsDir: cfg.path, appid: cfg.appID, accountId: cfg.user.user });
      if (result) {
        debug.log(`[${cfg.appID}] user stats read locally from appcache (${result.filter((r) => r.achieved).length} unlocked)`);
      } else {
        result = await getSteamUserStatsFromSRV(cfg.user.id, cfg.appID);
      }
      fs.mkdirSync(path.dirname(cache.local), { recursive: true });
      fs.writeFileSync(cache.local, JSON.stringify(result, null, 2));
    } else {
      result = JSON.parse(fs.readFileSync(cache.local));
    }

    return result;
  } catch (err) {
    if (err.code) throw `Could not load Steam User Stats: ${err.code} - ${err.message}`;
    else throw `Could not load Steam User Stats: ${err}`;
  }
};

const getSteamPath = (module.exports.getSteamPath = async () => {
  /*
       Some SteamEmu change HKCU/Software/Valve/Steam/SteamPath to the game's dir
       Fallback to Software/WOW6432Node/Valve/Steam/InstallPath in this case
       NB: Steam client correct the key on startup
     */

  const regHives = [
    { root: 'HKCU', key: 'Software/Valve/Steam', name: 'SteamPath' },
    { root: 'HKLM', key: 'Software/WOW6432Node/Valve/Steam', name: 'InstallPath' },
  ];

  let steamPath;

  for (let regHive of regHives) {
    steamPath = readRegistryString(regHive.root, regHive.key, regHive.name);
    if (steamPath) {
      if (fs.existsSync(path.join(steamPath, 'steam.exe'))) {
        break;
      }
    }
  }

  if (!steamPath) throw 'Steam Path not found';
  return steamPath;
});

// ---- installed-games map (libraryfolders.vdf + appmanifest_*.acf) --------------------------------

// A Steam install's folder is authoritative: appmanifest_<appid>.acf names the installdir, and
// libraryfolders.vdf names every library root. This powers the launch panel - a legit Steam game
// now gets a real gameDir (and therefore exe detection) instead of asking the user to browse for
// the executable manually.
function unescapeSteamVdf(value) {
  return String(value || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseSteamLibraryFoldersVdf(text) {
  const roots = [];
  const re = /^\s*"path"\s+"([^"]+)"/gm;
  let m = null;
  while ((m = re.exec(String(text || '')))) roots.push(unescapeSteamVdf(m[1]));
  return roots;
}

function parseSteamAppManifestAcf(text) {
  const out = { appid: '', name: '', installDir: '' };
  const re = /^\s*"(appid|name|installdir)"\s+"([^"]*)"/gm;
  let m = null;
  while ((m = re.exec(String(text || '')))) {
    if (m[1] === 'appid') out.appid = unescapeSteamVdf(m[2]);
    else if (m[1] === 'name') out.name = unescapeSteamVdf(m[2]);
    else if (m[1] === 'installdir') out.installDir = unescapeSteamVdf(m[2]);
  }
  return out;
}

// Map of appid -> { name, gameDir } for every app with an appmanifest on disk. Rebuilt on each
// scan (a handful of small ACF files) so newly installed Steam games are picked up immediately.
module.exports.scanLocalInstalls = async () => {
  let steamPath;
  try {
    steamPath = await getSteamPath();
  } catch {
    return new Map();
  }
  if (!steamPath || !fs.existsSync(path.join(steamPath, 'steam.exe'))) return new Map();

  const libraryFile = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');

  const roots = [path.join(steamPath, 'steamapps')];
  try {
    if (fs.existsSync(libraryFile)) {
      roots.push(...parseSteamLibraryFoldersVdf(fs.readFileSync(libraryFile, 'utf8')).map((r) => path.join(r, 'steamapps')));
    }
  } catch {
    /* unreadable library file - the main steamapps root still works */
  }

  const installs = new Map();
  const seen = new Set();
  for (const root of roots) {
    let files = [];
    try {
      files = fs.readdirSync(root).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const manifest = parseSteamAppManifestAcf(fs.readFileSync(path.join(root, file), 'utf8'));
        const appid = String(manifest.appid || '').trim();
        if (!/^\d+$/.test(appid) || seen.has(appid)) continue;
        const installDir = String(manifest.installDir || '').trim();
        if (!installDir) continue;
        seen.add(appid);
        installs.set(appid, {
          name: String(manifest.name || '').trim(),
          gameDir: path.join(root, 'common', installDir),
        });
      } catch {
        /* skip one corrupt manifest */
      }
    }
  }

  return installs;
};

const getSteamUsers = (module.exports.getSteamUsers = async (steamPath) => {
  let result = [];

  let users = listRegistryAllSubkeys('HKCU', 'Software/Valve/Steam/Users');
  if (!users || users.length == 0) users = await glob('*([0-9])', { cwd: path.join(steamPath, 'userdata'), onlyDirectories: true, absolute: false });

  if (users.length == 0) throw 'No Steam User ID found';

  result = await Promise.all(
    users.map(async (user) => {
      const id = steamID.to64(user);
      const data = await steamID.whoIs(id);
      if (data.privacyState === 'public') {
        debug.log(`${user} - ${id} (${data.steamID}) is public`);
        return {
          user,
          id,
          name: data.steamID,
          profile: data,
        };
      } else {
        debug.log(`${user} - ${id} (${data.steamID}) is not public`);
        return null;
      }
    })
  );
  // filter out nulls
  result = result.filter(Boolean);
  if (result.length === 0) throw 'Public profile: none.';
  return result;
});

const getSteamUsersList = (module.exports.getSteamUsersList = async () => {
  if (steamUsersList) return steamUsersList;
  if (!regKeyExists('HKCU', 'Software/Valve/Steam')) return [];
  try {
    let steamPath = await getSteamPath();
    let publicUsers = await getSteamUsers(steamPath);
    steamUsersList = publicUsers;
    return publicUsers;
  } catch (e) {
    return [];
  }
});

async function getSteamUserStatsFromSRV(user, appID) {
  const { ipcRenderer } = require('electron');
  const result = await ipcRenderer.invoke('get-steam-data', { appid: appID, user, type: 'user' });
  return result;
}

/*
  Resolve a game's library portrait: product info first, then SteamDB's hashed store_item_assets
  path, then the SteamGridDB community grids.

  This lives in one place because the two callers must agree. The chain used to be inline in
  getSteamDataFromSRV, which only ever runs on a cache MISS; the repair path for an already-cached
  schema (GetMissingData) re-asked product info and nothing else. A game whose cover was missing on
  the one scan that first resolved it therefore kept a blank tile forever, even when SteamGridDB had
  artwork for it all along.

  A truthy non-http value is a fetch-icon token the renderer resolves itself - it is returned
  untouched, never treated as a missing cover.
*/
async function resolvePortrait({ appid, name, portrait, invoke }) {
  // ipcInvoke, not ipcRenderer: GetMissingData also runs from the main process, where ipcRenderer is
  // undefined and a direct call would throw out of this function instead of falling through.
  const send = invoke || ipcInvoke;
  if (!name && !appid) return portrait || null;

  if (portrait && /^https?:\/\//i.test(portrait)) {
    // Verify a guessable CDN url actually downloads: modern titles live under hashed
    // store_item_assets paths, so a dead url would leave the tile blank while SteamDB knows better.
    try {
      const local = await send('fetch-icon', portrait, appid).catch(() => null);
      if (!local || local === portrait) portrait = null;
    } catch {
      return portrait; // keep the product-info url; the renderer will retry it
    }
  }

  if (!portrait) portrait = (await send('get-steamdb-cover', appid).catch(() => null)) || null;
  // The appid lets SteamGridDB answer by identity; the name is only the fallback handle for a game
  // that has no Steam appid at all.
  if (!portrait) portrait = (await send('get-steamgriddb-cover', name, appid).catch(() => null)) || null;
  return portrait || null;
}

module.exports.resolvePortrait = resolvePortrait;

async function getSteamDataFromSRV(appID, lang) {
  const langObj = steamLanguages.find((language) => language.api === lang);
  const { ipcRenderer } = require('electron');
  // Product info and achievements are independent: fetch them in parallel so the keyless HTTP
  // chain (official endpoint / SteamHunters JSON) never waits behind the anonymous Steam login.
  const [resultRaw, steamhunters] = await Promise.all([
    ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'common', lang: langObj }),
    ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'steamhunters', lang }),
  ]);
  const result = resultRaw || {};

  // The supplemental fetchers can legitimately come back empty (obscure title, scrape failed,
  // site unreachable). Default to [] instead of dereferencing `.achievements` on the result, or
  // the whole load throws and the game silently vanishes from the list - same failure as #56.
  let achievements = result.isGame && Array.isArray(steamhunters?.achievements) ? steamhunters.achievements : [];

  // SteamCommunity translations are only needed when the primary source is English-only
  // (SteamHunters JSON or the browser scrape). The official endpoint is already localized.
  const needsTranslations =
    result.isGame &&
    lang !== 'english' &&
    result.translated &&
    steamhunters?.source !== 'official' &&
    steamhunters?.source !== 'steamcommunity';
  const steamcommunity = needsTranslations
    ? await ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'steamcommunity', lang: langObj })
    : null;
  const translatedAchievements = Array.isArray(steamcommunity?.achievements) ? steamcommunity.achievements : [];

  mergeTranslatedAchievements(achievements, translatedAchievements);

  // SteamHunters groups tag DLC/update achievements by apiName (e.g. "The Witcher 3: Hearts of
  // Stone"). Only worth asking when this is a real game with achievements, so non-games and
  // zero-achievement titles never cost an extra SteamHunters request. Best-effort: untagged
  // entries are left untouched and a failure never fails the load.
  let groupsResult = { ok: false, groups: [] };
  if (result.isGame && achievements.length > 0) {
    groupsResult = await ipcRenderer
      .invoke('get-steam-data', { appid: appID, type: 'steamgroups' })
      .catch(() => ({ ok: false, groups: [] }));
  }
  if (Array.isArray(groupsResult.groups) && groupsResult.groups.length) {
    achievements = steamSchemaFetch.applySteamHuntersGroups(achievements, groupsResult.groups);
  }

  // Product info often carries no library capsule at all (brand-new appids above all). See
  // resolvePortrait for the recovery chain and why it is shared with the cached-schema repair.
  const portrait = await resolvePortrait({ appid: appID, name: result.name, portrait: result.portrait });

  return {
    name: result.name,
    appid: appID,
    binary: null,
    img: {
      header: result.header || 'header',
      background: result.background || 'page_bg_generated_v6b',
      // Never fall back to the literal "portrait" placeholder: it is truthy, so the portrait view
      // would prefer it over the real header and render a blank tile. Null lets the grid use the
      // header (or the alternate fallback) instead.
      portrait: portrait || null,
      icon: result.icon,
    },
    achievement: {
      total: achievements.length,
      list: achievements,
    },
  };
}

// IPlayerService/GetGameAchievements gives real descriptions for hidden achievements too, unlike
// the legacy ISteamUserStats/GetSchemaForGame (which always blanks them as a spoiler guard). Mapped
// here to the same {name, defaultvalue, displayName, hidden, description, icon, icongray} shape
// GetSchemaForGame's achievement list used, so it's a drop-in replacement for every caller below.
async function getGameAchievementsFromWebAPI(cfg) {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid=${cfg.appID}&language=${cfg.lang}`;
    const data = await request.getJson(url);
    return steamSchemaFetch.mapOfficialAchievements(data && data.response, cfg.appID);
  } catch (err) {
    debug.log(`[${cfg.appID}] keyless GetGameAchievements failed (${err.code || err.message || err})`);
    return []; // keep the game visible; the local-schema backfill can still fill the list
  }
}

// Lean, schema-only fetch: just the authoritative achievement list (no Steam store page, no icon
// downloads). Used to backfill blank descriptions/displayNames into a stale cached schema without
// paying for the full getSteamDataFromSRV() round-trip.
async function getSchemaAchievements(cfg) {
  // In the renderer, reuse the main process's complete official -> SteamHunters ->
  // SteamCommunity -> browser chain. Plain-Node tests have no ipcRenderer and keep the direct,
  // browser-free endpoint below.
  try {
    const { ipcRenderer } = require('electron');
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      const result = await ipcRenderer.invoke('get-steam-data', {
        appid: cfg.appID,
        type: 'steamhunters',
        lang: cfg.lang,
      });
      return result && Array.isArray(result.achievements) ? result.achievements : [];
    }
  } catch {
    /* Standalone tests use the direct request below. */
  }
  return getGameAchievementsFromWebAPI(cfg);
}

async function getDataFromSteamStore(appID) {
  if (!appID || !(Number.isInteger(appID) && appID > 0)) throw 'ERR_INVALID_APPID';

  const root = cacheRoot || userDataDir();
  const cacheFile = path.join(root, 'steam_cache/store', `${appID}.json`);
  const TTL = 7 * 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < TTL) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && typeof cached === 'object') return cached;
    }
  } catch {
    /* stale/corrupt cache -> refetch */
  }
  if (storeDataInFlight.has(appID)) return storeDataInFlight.get(appID);

  const url = `https://store.steampowered.com/app/${appID}`;

  const pending = (async () => {
    try {
    const { body } = await request(url, {
      headers: {
        Cookie: 'birthtime=662716801; wants_mature_content=1; path=/; domain=store.steampowered.com', //Bypass age check and mature filter
        'Accept-Language': 'en-US;q=1.0', //force result to english
      },
    });

    const html = htmlParser.parse(body);

    const bgDiv = html.querySelector('.game_page_background.game');
    let background = null;

    if (bgDiv) {
      const styleAttr = bgDiv.getAttribute('style') || '';
      const match = styleAttr.match(/url\(\s*(['"])?(.*?)\1\s*\)/i);
      if (match && match[2]) {
        background = match[2].trim().split('?')[0];
      }
    }

    const result = {
      name: html.querySelector('.apphub_AppName').innerHTML,
      icon: html
        .querySelector('.apphub_AppIcon img')
        .attributes.src.match(/([^\\\/\:\*\?\"\<\>\|])+$/)[0]
        .replace('.jpg', ''),
      header:
        html.querySelector('meta[property="og:image"]')?.attributes.content.split('?')[0] ||
        html.querySelector('.game_header_image_full')?.attributes.src.split('?')[0] ||
        null,
      portrait: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appID}/portrait.png`,
      background,
    };

    return result;
    } catch {
      return {};
    }
  })();
  storeDataInFlight.set(appID, pending);
  try {
    const result = await pending;
    if (result && Object.keys(result).length > 0) {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
      } catch {
        /* cache write failure is non-fatal */
      }
    }
    return result;
  } finally {
    storeDataInFlight.delete(appID);
  }
}

// Fetch and cache DLC names for GBE repair; a store failure is non-fatal.
const getDLCList = (module.exports.getDLCList = async (appID) => {
  const id = parseInt(appID, 10);
  if (!Number.isInteger(id) || id <= 0) return [];

  const cacheFile = path.join(cacheRoot, 'steam_cache/dlc', `${id}.json`);
  const TTL = 14 * 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < TTL) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached.dlcs)) return cached.dlcs;
    }
  } catch {
    /* corrupt cache - refetch */
  }

  const writeCache = (dlcs) => {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ time: Date.now(), dlcs }, null, 2));
    } catch {
      /* cache write failure is non-fatal */
    }
    return dlcs;
  };

  try {
    const base = await request.getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`, { timeout: 20000 });
    const ids = (base && base[id] && base[id].success && base[id].data && Array.isArray(base[id].data.dlc) ? base[id].data.dlc : [])
      .map((d) => parseInt(d, 10))
      .filter((d) => Number.isInteger(d) && d > 0);
    if (ids.length === 0) return writeCache([]);

    const names = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const detail = await request.getJson(
          `https://store.steampowered.com/api/appdetails?appids=${chunk.join(',')}&filters=basic&l=english`,
          { timeout: 20000 }
        );
        for (const did of chunk) {
          const entry = detail && detail[did];
          if (entry && entry.success && entry.data && entry.data.name) names.set(did, String(entry.data.name).trim());
        }
      } catch {
        /* this chunk's names stay blank -> fall back to a generic label below */
      }
    }

    const dlcs = ids.map((did) => ({ appid: did, name: names.get(did) || `DLC ${did}` }));
    if (debug) debug.log(`[${id}] resolved ${dlcs.length} DLC(s) from the Steam store`);
    return writeCache(dlcs);
  } catch (err) {
    if (debug) debug.log(`[${id}] DLC list fetch failed => ${err}`);
    return [];
  }
});

async function findInAppList(appID) {
  if (!appID || !(Number.isInteger(appID) && appID > 0)) throw 'ERR_INVALID_APPID';

  const { ipcRenderer } = require('electron');
  const cache = path.join(cacheRoot, 'steam_cache/schema');
  const filepath = path.join(cache, 'appList.json');

  while (!listReady) await new Promise((r) => setTimeout(r, 50));
  if (appidListMap.size === 0) {
    listReady = false;
    try {
      let list;
      // Use a cached copy if it exists and is < 3 days old. Anything thrown here escapes
      // findInAppList() and leaves listReady false, freezing every later lookup (issue #53).
      if (fs.existsSync(filepath) && Date.now() - fs.statSync(filepath).mtimeMs < 60 * 60 * 1000 * 24 * 3) {
        try {
          list = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        } catch {
          list = undefined; // corrupt/partial cache -> fall through and re-download
        }
      }
      if ((!Array.isArray(list) || list.length === 0) && !appListRefreshFailed) {
        try {
          const url = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/?format=json';
          const data = await request.getJson(url, { timeout: 40000 });
          list = data.applist.apps;
          fs.mkdirSync(path.dirname(filepath), { recursive: true });
          fs.writeFileSync(filepath, JSON.stringify(list, null, 2));
        } catch (err) {
          // Steam retired ISteamApps/GetAppList: it answers 404 with "Method 'GetAppList' not found
          // in interface 'ISteamApps'", and the method is gone from GetSupportedAPIList. The
          // keyless replacement is the app search in searchAppsByName(), which findAppidByName()
          // already falls back to, and appid -> name still resolves through get-steam-data below.
          //
          // A failed refresh must NOT abort the whole game load: fall back to any existing cached
          // copy even if it is older than the 3-day freshness window. A stale list still resolves
          // every long-existing appid.
          //
          // Once per session: with no cached copy the map stays empty, so without this flag every
          // single appid re-ran the request - one dead round trip per game on a library scan, which
          // is what made the first scan after clearing the cache drag.
          appListRefreshFailed = true;
          debug.log(`GetAppList refresh failed (${err.code || err}); falling back to cached appList if present`);
          if (fs.existsSync(filepath)) {
            try {
              list = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
            } catch {
              list = undefined;
            }
          }
        }
      }
      if (Array.isArray(list) && list.length > 0) {
        appidListMap = new Map(list.map((a) => [a.appid, a]));
      }
    } finally {
      listReady = true; // always release the lock, even on a network/parse failure
    }
  }

  const app = appidListMap.get(appID);
  if (app) return app.name;
  const name = await ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'name' });
  return name;
  throw 'ERR_NAME_NOT_FOUND';
}

// Resolve an AppID back to its canonical store name (app-list cache first, then the store data
// IPC). Returns '' when neither path is reachable; callers keep their own fallback name.
const getAppNameByAppid = (module.exports.getAppNameByAppid = async (appid) => {
  try {
    const name = await findInAppList(Number(appid));
    return name && String(name).trim() ? String(name).trim() : '';
  } catch {
    return '';
  }
});

// Did the Steam app-list actually load? When it did not (offline, endpoint down and no cached copy
// yet) EVERY appid misses it, so a miss carries no information and must not be cached as a negative.
function appListUsable() {
  return appidListMap.size > 0;
}

async function searchAppsByName(name) {
  const term = String(name || '').trim();
  if (!term) return [];
  const key = term.toLowerCase();
  if (appSearchCache.has(key)) return appSearchCache.get(key);

  const pending = (async () => {
    const url = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(term)}`;
    const data = await request.getJson(url, { timeout: 20000 });
    if (!Array.isArray(data)) return [];
    return data
      .map((app) => ({
        appid: /^[0-9]+$/.test(String(app.appid || '')) ? Number(app.appid) : app.appid,
        name: app.name,
        icon: app.icon,
        logo: app.logo,
      }))
      .filter((app) => app.appid && app.name);
  })();

  appSearchCache.set(key, pending);
  try {
    return await pending;
  } catch (err) {
    if (debug) debug.log(`Steam app search failed for "${term}" (${err.code || err})`);
    appSearchCache.delete(key);
    return [];
  }
}

async function loadAppListBestEffort() {
  try {
    await findInAppList(753); // ensures appidListMap is loaded (Steam/Spacewar always resolves)
  } catch {
    /* list unavailable - callers can fall back to direct Steam search */
  }
}

// Resolve a messy install name to a confident Steam appid without guessing.
module.exports.findAppidByName = async (name) => {
  if (!name) return null;
  await loadAppListBestEffort();

  if (appidListMap.size > 0) {
    const hit = fuzzyAppid.bestConfidentAppid(name, appidListMap.values());
    if (hit) return hit;
  }

  // GetAppList is not guaranteed to be reachable anymore and stale cached copies miss brand-new
  // releases. Fall back to Steam's lightweight app search, then apply the same confident matcher.
  const apps = await searchAppsByName(name);
  return fuzzyAppid.bestConfidentAppid(name, apps);
};

function stripIniValue(value) {
  return String(value == null ? '' : value)
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^"|"$/g, '');
}

function localizedTenokeValue(local, key, lang) {
  let item = local && local[key];
  if (!item && local) item = key.split('.').reduce((value, part) => value && value[part], local);
  if (!item || typeof item !== 'object') return '';
  const language = String(lang || 'english').toLowerCase();
  return stripIniValue(item[language] || item.english || Object.values(item).find((v) => v != null) || '');
}

/*
  Locating a local schema means walking an entire game install (depth 6, synchronous) - 0.3-2.1s on
  a large install, and it blocks the renderer's event loop while it runs, so makeList's worker pool
  serializes behind it and every game in the batch ends up reporting the whole batch time. Two
  guards keep that cost off the per-scan path: probe the handful of places emulators actually drop
  these files before walking anything, and memoize the outcome - including "not here", which is the
  expensive answer - so a rescan costs one stat per install instead of one full walk.
*/
const LOCATE_MISS_TTL_MS = 10 * 60 * 1000;
const SCHEMA_WALK_MAX_DEPTH = 6;
const _locateCache = new Map();

// The directories an emulator actually drops a schema in, nearest first.
function schemaCandidateDirs(dir) {
  const dirs = [dir, path.join(dir, 'steam_settings'), path.join(dir, 'SteamData')];
  let top;
  try {
    top = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of top) {
    // Unity keeps the emulator dll - and whatever it dumped beside it - under <Game>_Data/Plugins.
    if (!entry.isDirectory() || !/_Data$/i.test(entry.name)) continue;
    const plugins = path.join(dir, entry.name, 'Plugins');
    dirs.push(plugins);
    for (const arch of ['x86_64', 'x86', 'x64']) {
      dirs.push(path.join(plugins, arch));
      dirs.push(path.join(plugins, arch, 'steam_settings'));
    }
  }
  return dirs;
}

// `candidates` lets a caller probing several filenames list the install root once instead of per file.
function probeFileByName(dir, filename, candidates) {
  if (!dir) return null;
  for (const candidate of candidates || schemaCandidateDirs(dir)) {
    const full = path.join(candidate, filename);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* Not in this spot - try the next one. */
    }
  }
  return null;
}

// Drop remembered locations (misses included) so a schema the app just wrote, or a manual refresh,
// is picked up at once instead of waiting out LOCATE_MISS_TTL_MS.
module.exports.forgetLocalSchemaLocations = (dir) => {
  if (dir == null) {
    _locateCache.clear();
    return;
  }
  const prefix = `${dir}\u0000`;
  for (const key of _locateCache.keys()) if (key.startsWith(prefix)) _locateCache.delete(key);
};

// `probed` is the caller's own probeFileByName result, so the probe is not repeated here; pass
// `undefined` when the caller has not probed at all.
function findFileByName(dir, filename, probed) {
  if (!dir || !fs.existsSync(dir)) return null;
  const key = `${dir}\u0000${filename}`;
  const memo = _locateCache.get(key);
  if (memo) {
    // A remembered hit is revalidated with a single stat; a remembered miss expires, so a file that
    // appears later is still found - just not at the price of a walk on every scan in between.
    if (memo.path) {
      if (fs.existsSync(memo.path)) return memo.path;
    } else if (Date.now() - memo.at < LOCATE_MISS_TTL_MS) {
      return null;
    }
    _locateCache.delete(key);
  }
  const wanted = filename.toLowerCase();
  const walk = (current, depth) => {
    if (depth > SCHEMA_WALK_MAX_DEPTH) return null;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return full;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const hit = walk(path.join(current, entry.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  const found = (probed === undefined ? probeFileByName(dir, filename) : probed) || walk(dir, 0);
  _locateCache.set(key, { path: found, at: Date.now() });
  return found;
}

function getTenokeSchemaFromFile(file, appid, lang = 'english') {
  let local;
  try {
    local = ini.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const tenokeAppid = stripIniValue(local.TENOKE && local.TENOKE.id).match(/^[0-9]+/)?.[0];
  if (appid != null && tenokeAppid && String(tenokeAppid) !== String(appid)) return [];

  const prefix = 'ACHIEVEMENTS.';
  const nestedAchievements = local.ACHIEVEMENTS && typeof local.ACHIEVEMENTS === 'object' ? local.ACHIEVEMENTS : null;
  const names = nestedAchievements
    ? Object.keys(nestedAchievements).filter((name) => nestedAchievements[name] && typeof nestedAchievements[name] === 'object')
    : Object.keys(local)
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('.'))
        .map((key) => key.slice(prefix.length));

  return names.map((name) => {
    const base = `${prefix}${name}`;
    const entry = (nestedAchievements && nestedAchievements[name]) || local[base] || {};
    const icon = stripIniValue(entry.icon);
    const icongray = stripIniValue(entry.icon_gray || entry.icongray);
    const hidden = stripIniValue(entry.hidden) === '1' ? 1 : 0;
    const maxProgress = Number(stripIniValue(entry.progress_max || entry.max_progress || '0'));
    const achievement = {
      name,
      default_value: 0,
      displayName: localizedTenokeValue(local, `${base}.name`, lang) || name,
      hidden,
      description: localizedTenokeValue(local, `${base}.desc`, lang) || '',
      icon: icon && tenokeAppid ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${tenokeAppid}/${icon}` : '',
      icongray: icongray && tenokeAppid ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${tenokeAppid}/${icongray}` : '',
    };
    if (Number.isFinite(maxProgress) && maxProgress > 0) achievement.max_progress = maxProgress;
    return achievement;
  });
}

// A Goldberg/GBE-Fork achievements.json field can be a plain string or a localized object
// ({english, french, …}); resolve to the requested language, then English, then any value.
function pickLocalized(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value[lang] || value.english || Object.values(value).find((v) => typeof v === 'string') || '';
  return String(value);
}

// Read a Goldberg / GBE-Fork steam_settings/achievements.json (the emulator's own SCHEMA) into AW's
// schema shape. This is the offline schema a cracked game already ships, so brand-new titles that
// aren't on SteamHunters yet (and keyless setups with no Web API schema) still show their real
// achievement names/descriptions/icons instead of an empty list. Icons follow the same community-CDN
// pattern as the rest of the pipeline (basename of whatever the emu recorded).
function getGoldbergSchemaFromFile(file, appid, lang = 'english') {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const cdn = (icon) => {
    const base = icon ? path.basename(String(icon).split('?')[0]) : '';
    return base && appid ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${base}` : '';
  };
  return parsed
    .filter((entry) => entry && entry.name != null)
    .map((entry) => {
      const achievement = {
        name: String(entry.name),
        default_value: 0,
        displayName: pickLocalized(entry.displayName, lang) || String(entry.name),
        hidden: String(entry.hidden) === '1' || entry.hidden === 1 ? 1 : 0,
        description: pickLocalized(entry.description, lang) || '',
        icon: cdn(entry.icon),
        icongray: cdn(entry.icongray || entry.icon_gray),
      };
      const maxProgress = Number(entry?.progress?.max_progress || entry?.progress?.value?.operand1 || 0);
      if (Number.isFinite(maxProgress) && maxProgress > 0) achievement.max_progress = maxProgress;
      return achievement;
    });
}

module.exports.getLocalAchievementSchema = (gameDir, appid, lang = 'english') => {
  /*
    Probe the known emulator locations for BOTH layouts before walking anything. tenoke.ini is
    the rarer file, so looking for it first used to force a full walk of every non-TENOKE
    install just to prove its absence - the single most expensive thing a scan did. Both files
    are probed across the same directories, so TENOKE still wins wherever the two sit together,
    which is the only layout that exists in practice (both land beside the emulator dll).
  */
  const candidates = gameDir ? schemaCandidateDirs(gameDir) : [];
  const probedTenoke = probeFileByName(gameDir, TENOKE_SCHEMA_FILE, candidates);
  if (probedTenoke) {
    const schema = getTenokeSchemaFromFile(probedTenoke, appid, lang);
    if (schema.length > 0) return schema;
  }
  const probedGoldberg = probeFileByName(gameDir, 'achievements.json', candidates);
  if (probedGoldberg) {
    const schema = getGoldbergSchemaFromFile(probedGoldberg, appid, lang);
    if (schema.length > 0) return schema;
  }

  // Unusual layout: fall back to the walk, whose result - hit or miss - is memoized. The probes
  // above are handed down so neither is repeated.
  const tenoke = findFileByName(gameDir, TENOKE_SCHEMA_FILE, probedTenoke);
  if (tenoke) {
    const schema = getTenokeSchemaFromFile(tenoke, appid, lang);
    if (schema.length > 0) return schema;
  }
  // Fall back to the emulator's own schema dump (Goldberg / GBE Fork) - present on cracked installs.
  const goldberg = findFileByName(gameDir, 'achievements.json', probedGoldberg);
  if (goldberg) return getGoldbergSchemaFromFile(goldberg, appid, lang);
  return [];
};

// Ranked AppID candidates for a name, best first: [{ appid, name, score, tier }]. Includes fuzzy
// (typo-tolerant) matches - meant for a confirm/pick dialog, not silent auto-application.
module.exports.findAppidCandidatesByName = async (name, limit = 6) => {
  if (!name) return [];
  await loadAppListBestEffort();

  const apps = appidListMap.size > 0 ? Array.from(appidListMap.values()) : [];
  for (const app of await searchAppsByName(name)) {
    if (!apps.some((candidate) => String(candidate.appid) === String(app.appid))) apps.push(app);
  }
  if (apps.length === 0) return [];
  return fuzzyAppid.rankAppidCandidates(name, apps, { limit });
};

const cdnProviders = [
  'https://cdn.akamai.steamstatic.com/steam/apps/',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/',
  'https://media.steampowered.com/steam/apps/',
  'https://steamcdn-a.akamaihd.net/steam/apps/',
  'https://shared.fastly.steamstatic.com/steam/apps/',
  'https://shared.fastly.steamstatic.com/community_assets/images/apps/',
  'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/',
  'https://steampipe.akamaized.net/steam/apps/',
  'https://google2.cdn.steampipe.steamcontent.com/steam/apps/',
  'https://steamcdn-a.akamaihd.net/steam/apps/',
  'https://media.steampowered.com/steam/apps/',
];
async function findWorkingLink(appid, basename) {
  const key = `${appid}:${basename}`;
  if (workingLinkCache.has(key)) return workingLinkCache.get(key);
  for (const ext of ['.jpg', '.png']) {
    for (const cdn of cdnProviders) {
      const url = `${cdn}${appid}/${basename}${ext}`;
      try {
        const res = await request(url, { method: 'HEAD' });
        if (res.code === 200) {
          const contentType = res.headers['content-type'];
          if (contentType) {
            workingLinkCache.set(key, url);
            return url;
          }
        }
      } catch (e) {}
    }
  }
  workingLinkCache.set(key, null);
  return null;
}

// `showHidden` is accepted for call-site compatibility but no longer gates hidden-description
// backfill: the detail view reveals hidden descriptions on click regardless of the setting, so the
// real text must always be fetched.
async function GetMissingData(data, showHidden, lang, steamSettings) {
  let updated = false;
  try {
    const { ipcRenderer } = require('electron');
    let updatedImgs, updatedDesc;
    if (Object.values(data.img).some((im) => !im)) {
      updated = true;
      // Local-first: a GBE/Goldberg install often ships the store's own library-asset metadata in
      // steam_settings/steam_misc/app_info/app_product_info.json. Resolve the real cover/header
      // from that dump before the network lookup - it is authoritative for the install and still
      // works for delisted games whose store page is gone.
      if (steamSettings) {
        try {
          const steamAssets = require('../util/steamAssets.js');
          for (const [purpose, key] of [
            ['portrait', 'portrait'],
            ['header', 'header'],
          ]) {
            if (data.img[key]) continue;
            const local = steamAssets.resolveSteamProductAssetUrls({ appid: data.appid, configPath: steamSettings, purpose, language: lang });
            if (local.ok) data.img[key] = local.urls[0];
          }
        } catch (err) {
          debug.log(`[${data.appid}] local product-info asset lookup failed: ${err.message || err}`);
        }
      }
      if (Object.values(data.img).some((im) => !im)) {
        updatedImgs = await ipcRenderer.invoke('get-steam-data', { appid: data.appid, type: 'common' });
        data.img.header = data.img.header || updatedImgs.header || 'header';
        data.img.background = data.img.background || updatedImgs.background || 'page_bg_generated_v6b';
        data.img.portrait = data.img.portrait || updatedImgs.portrait || null;
        data.img.icon = data.img.icon || updatedImgs.icon;
      }

      /*
        Still no portrait: run the same SteamDB -> SteamGridDB chain the first fetch uses. Product
        info alone is not enough - it has no cover at all for plenty of titles, which is why the
        tile stayed blank on every later scan even though SteamGridDB had artwork.

        Stamped on the same three-day cadence as the description backfill, so a game that genuinely
        has no cover anywhere costs one lookup every three days rather than one per scan.
      */
      const PORTRAIT_RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
      const portraitTriedRecently = data.portraitCheckedAt && Date.now() - data.portraitCheckedAt < PORTRAIT_RECHECK_MS;
      if (!data.img.portrait && data.name && !portraitTriedRecently) {
        data.img.portrait = await resolvePortrait({ appid: data.appid, name: data.name, portrait: null });
        data.portraitCheckedAt = Date.now(); // remember the attempt even when nothing was found
        if (data.img.portrait) debug.log(`[${data.appid}] recovered a library cover for "${data.name}"`);
      }
    }
    // Backfill blank descriptions every 3 days; key-based schemas already include hidden text.
    const DESC_RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
    const triedRecently = data.descBackfilledAt && Date.now() - data.descBackfilledAt < DESC_RECHECK_MS;
    const hasBlankVisible = data.achievement.list.some((ac) => ac.hidden != 1 && (!ac.description || String(ac.description).trim() === ''));
    const hasBlankHidden = data.achievement.list.some((ac) => ac.hidden == 1 && (!ac.description || String(ac.description).trim() === ''));
    if (!triedRecently && (hasBlankVisible || hasBlankHidden)) {
      updatedDesc = await ipcRenderer.invoke('get-steam-data', { appid: data.appid, type: 'steamhunters', lang });
      // For obscure titles the supplemental lookup can return nothing, leaving `achievements`
      // undefined. Guard against it so a missing response never throws and drops the game (#56).
      const supplemental = updatedDesc && Array.isArray(updatedDesc.achievements) ? updatedDesc.achievements : [];
      if (supplemental.length) {
        // The scraper itself falls back to a single space for achievements it doesn't know either
        // (init.js, `item.description || ' '`); drop those here so we don't merge in a value that's
        // truthy-but-blank, which would otherwise (a) survive the UI's `description || '...'` fallback
        // as a stray space and (b) permanently mark the achievement "filled", blocking future retries.
        const map = new Map(
          supplemental.filter((item) => item.description && String(item.description).trim() !== '').map((item) => [item.name, item.description])
        );
        for (let ach of data.achievement.list) {
          // Treat a whitespace-only description (e.g. the scraper's single-space fallback baked into an
          // older cache) as blank too - otherwise `!ach.description` is false for " " and the real text
          // never replaces it, leaving the achievement stuck on the UI's "..." fallback forever.
          if ((!ach.description || String(ach.description).trim() === '') && (map.has(ach.displayName) || map.has(ach.name))) {
            ach.description = map.get(ach.displayName) || map.get(ach.name);
          }
        }
      }
      // Exophase fallback for whatever SteamHunters still left blank. Unlike SteamHunters it also
      // serves the schema's own language, so a localized schema gets localized text. Matching is by
      // displayName only (localized title first, english title second) - never by list position, so
      // a miss can't attach another achievement's description. Runs inside the same weekly
      // three-day descBackfilledAt stamp as the SteamHunters attempt, so it adds no recurring cost.
      const stillBlank = data.achievement.list.some((ac) => !ac.description || String(ac.description).trim() === '');
      if (stillBlank && data.name) {
        try {
          const exophase = require('./exophase.js');
          const langKey = lang && exophase.EXOPHASE_LANG_MAP[lang] ? lang : 'english';
          const res = await exophase.fetchExophaseAchievementsMultiLang({
            platform: 'steam',
            title: data.name,
            langKeys: [langKey],
          });
          const norm = (s) => String(s || '').trim().toLowerCase();
          const byTitle = new Map();
          for (const item of res.items) {
            const desc = item.descriptions[langKey] || item.descriptions.english;
            if (!desc || String(desc).trim() === '') continue;
            for (const title of [item.titles[langKey], item.titles.english]) {
              if (title) byTitle.set(norm(title), desc);
            }
          }
          for (const ach of data.achievement.list) {
            if (ach.description && String(ach.description).trim() !== '') continue;
            const desc = byTitle.get(norm(ach.displayName));
            if (desc) ach.description = desc;
          }
        } catch (err) {
          debug.log(`[${data.appid}] exophase description fallback failed: ${err.code || err.message || err}`);
        }
      }
      data.descBackfilledAt = Date.now(); // remember the attempt (even when nothing improved) and persist it
      updated = true;
    }
  } catch (e) {
    debug.log(e);
  }
  return updated;
}

const fetchIcon = (module.exports.fetchIcon = async (url, appID) => {
  // Some games have no icon/background/portrait URL (null in the schema). Bail out instead of letting
  // `url.startsWith`/`path.parse(null)` throw - that surfaced as a noisy "Error occurred in handler
  // for 'fetch-icon': Cannot read property 'startsWith' of null" on every scan with such a game.
  if (!url || typeof url !== 'string') return null;
  // Local file paths (e.g. Uplay schemas store absolute Windows paths like "C:/..."):
  // new URL('C:/...') parses without throwing (protocol: 'c:') so the network branch below
  // attempts an HTTP HEAD that stalls via the request-zero req.destroy()-without-error bug,
  // leaving every achievement icon promise permanently pending. Short-circuit here instead.
  if (!url.startsWith('http') && fs.existsSync(url)) return url;
  const inFlightKey = `${appID}:${url}`;
  if (iconFetchInFlight.has(inFlightKey)) return iconFetchInFlight.get(inFlightKey);
  const pending = (async () => {
  let validUrl;
  let filePath;
  try {
    const cache = path.join(userDataDir(), `steam_cache/icon/${appID}`);
    let filename = path.parse(url).base;
    filePath = path.join(cache, filename);
    if (fs.existsSync(filePath)) return filePath;
    let exts = ['.jpg', '.png'];
    if (!url.endsWith('.jpg') && !url.endsWith('.png'))
      for (let ext of exts) {
        filePath = path.join(cache, filename + ext);
        if (fs.existsSync(filePath)) return filePath;
      }
    //legacy url are full urls, check if they are still valid
    let isValid = false;
    validUrl = url;
    try {
      new URL(url);
      const res = await request(url, { method: 'HEAD' });
      isValid = res.code !== 200 ? false : true;
      isValid = isValid ? res.headers['content-type'] : isValid;
    } catch (e) {}

    if (!isValid)
      validUrl = await findWorkingLink(
        appID,
        url.startsWith('http')
          ? url
              .split('/')
              .pop()
              .split('?')[0]
              .replace(/\.[^.]+$/, '')
          : url.endsWith('.jpg') || url.endsWith('.png')
          ? url.slice(0, url.length - 4)
          : url
      );

    filename = path.parse(urlParser.parse(validUrl).pathname).base;

    filePath = path.join(cache, filename);

    if (fs.existsSync(filePath)) {
      return filePath;
    } else {
      return (await request.download(validUrl, cache, { validateFileSize: false })).path;
    }
  } catch (err) {
    if (err.code === 'ESIZEMISMATCH') {
      try {
        const res = await fetch(validUrl);
        if (!res.ok) return validUrl;
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        return filePath;
      } catch (e) {
        return validUrl;
      }
    }
    return url;
  }
  })();
  iconFetchInFlight.set(inFlightKey, pending);
  try {
    return await pending;
  } finally {
    iconFetchInFlight.delete(inFlightKey);
  }
});
