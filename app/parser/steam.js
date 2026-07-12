'use strict';

//const axios = require('axios');
//const cheerio = require('cheerio');
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
const steamLanguages = require(path.join(appPath, 'locale/steam.json'));
const sse = require(path.join(appPath, 'parser/sse.js'));
const htmlParser = require('node-html-parser');
const fs = require('fs');
const saveRoots = require(path.join(appPath, 'parser/saveRoots.js'));

let listReady = true;
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
        let isInstalled = true;
        if (listingType == 1)
          isInstalled = readRegistryInteger('HKCU', `Software/Valve/Steam/Apps/${stats.appID}`, 'Installed') === 1;

        let user = publicUsers.find((user) => user.user == stats.userID);

        if (user && isInstalled) {
          data.push({
            appid: stats.appID,
            source: `Steam (${user.name})`,
            data: {
              type: 'steamAPI',
              userID: user,
              cachePath: steamCache,
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

module.exports.getGameData = async (cfg) => {
  if (!steamLanguages.some((language) => language.api === cfg.lang)) {
    throw 'Unsupported API language code';
  }
  let result;
  let needSaving = false;
  const cache = path.join(cacheRoot, 'steam_cache/schema', cfg.lang);
  let filePath = path.join(`${cache}`, `${cfg.appID}.db`);

  try {
    result = this.getCachedData(cfg);
    if (!result || !result.name) {
      if (!(await findInAppList(+cfg.appID))) throw `Error trying to load steam data for ${cfg.appID}`;
      if (cfg.key) {
        result = await getSteamData(cfg);
      } else {
        result = await getSteamDataFromSRV(cfg.appID, cfg.lang);
      }
      needSaving = true;
    }

    // Stale-cache description repair. A schema cached before #57 (or during the keyless/scrape era)
    // can carry blank descriptions for visible achievements, and — before the switch to
    // IPlayerService/GetGameAchievements — hidden ones too (the legacy GetSchemaForGame always blanked
    // those as a spoiler guard). Once a Web API key is available the schema is authoritative, but the
    // cache is never re-fetched once it has a name — so those games kept showing "…" forever. Re-pull
    // just the schema once to fill the gaps, and stamp the attempt so titles whose descriptions are
    // genuinely unavailable don't refetch on every scan.
    const DESC_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
    const triedRecently = result && result.descBackfilledAt && Date.now() - result.descBackfilledAt < DESC_RECHECK_MS;
    const hasBlankVisibleDesc =
      result &&
      result.achievement &&
      Array.isArray(result.achievement.list) &&
      result.achievement.list.some((ac) => ac.hidden != 1 && (!ac.description || String(ac.description).trim() === ''));
    // Hidden descriptions are backfilled regardless of the "show hidden" setting: the detail view now
    // lets the user reveal any hidden achievement's description in place (click to reveal), so the real
    // text must be present even when hidden achievements are masked by default.
    const hasBlankHiddenDesc =
      result &&
      result.achievement &&
      Array.isArray(result.achievement.list) &&
      result.achievement.list.some((ac) => ac.hidden == 1 && (!ac.description || String(ac.description).trim() === ''));
    if (cfg.key && (hasBlankVisibleDesc || hasBlankHiddenDesc) && !triedRecently) {
      try {
        const fresh = await getSchemaAchievements(cfg);
        const freshByName = new Map(fresh.filter((a) => a && a.name != null).map((a) => [String(a.name).toUpperCase(), a]));
        for (const ach of result.achievement.list) {
          const f = freshByName.get(String(ach.name).toUpperCase());
          if (!f) continue;
          if ((!ach.description || String(ach.description).trim() === '') && f.description) ach.description = f.description;
          if ((!ach.displayName || String(ach.displayName).trim() === '') && f.displayName) ach.displayName = f.displayName;
          if (ach.hidden == null && f.hidden != null) ach.hidden = f.hidden;
        }
      } catch (err) {
        debug.log(`Could not refresh schema descriptions [${cfg.appID}]: ${err.code ? `${err.code} - ${err.message}` : err}`);
      }
      result.descBackfilledAt = Date.now(); // remember the attempt even when nothing improved
      needSaving = true;
    }

    needSaving = needSaving || (await GetMissingData(result, cfg.showHidden, cfg.lang));
    if (needSaving) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
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
    for (let file of files) {
      try {
        if (path.parse(file).ext == '.json') {
          local = JSON.parse(fs.readFileSync(path.join(filePath, file), 'utf8'));
        } else if (file === 'stats.bin') {
          local = sse.parse(fs.readFileSync(path.join(filePath, file)));
        } else {
          local = ini.parse(fs.readFileSync(path.join(filePath, file), 'utf8'));
        }
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
      //TENOKE
      for (let i in local.ACHIEVEMENTS) {
        if (!Object.prototype.hasOwnProperty.call(local.ACHIEVEMENTS, i)) continue;
        const key = i.replace(/^"|"$/g, '');
        const raw = local.ACHIEVEMENTS[i]; // e.g. "{unlocked=true, time=1712253396}"
        const unlockedMatch = /unlocked\s*=\s*(true|false)/i.exec(raw);
        const timeMatch = /time\s*=\s*(\d+)/i.exec(raw);

        const unlocked = unlockedMatch ? unlockedMatch[1].toLowerCase() === 'true' : false;
        const time = timeMatch ? Number(timeMatch[1]) : 0;

        result[key] = {
          Achieved: unlocked ? '1' : '0',
          UnlockTime: time,
        };
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
      if (cfg.key) {
        result = await getSteamUserStats(cfg);
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

async function getSteamUserStats(cfg) {
  const url = `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${cfg.appID}&key=${cfg.key}&steamid=${cfg.user.id}`;

  try {
    let result = await request.getJson(url);
    return result.playerstats.achievements;
  } catch (err) {
    throw err;
  }
}

async function getSteamDataFromSRV(appID, lang) {
  const langObj = steamLanguages.find((language) => language.api === lang);
  const { ipcRenderer } = require('electron');
  const result =
    (await ipcRenderer.invoke('get-steam-data', {
      appid: appID,
      type: 'common',
      lang: langObj,
    })) || {};

  // The supplemental scrapers can legitimately come back empty (obscure title, scrape failed,
  // site unreachable). Default to [] instead of dereferencing `.achievements` on the result, or
  // the whole load throws and the game silently vanishes from the list — same failure as #56.
  const steamhunters = result.isGame ? await ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'steamhunters' }) : null;
  const achievements = Array.isArray(steamhunters?.achievements) ? steamhunters.achievements : [];

  const steamcommunity =
    !result.isGame || lang == 'english' || !result.translated
      ? null
      : await ipcRenderer.invoke('get-steam-data', { appid: appID, type: 'steamcommunity', lang: langObj });
  const translatedAchievements = Array.isArray(steamcommunity?.achievements) ? steamcommunity.achievements : [];

  for (let ach of translatedAchievements) {
    let match = achievements.find((a) => a.icon === ach.img || a.icongray === ach.img);
    if (match) {
      match.description = ach.description;
      match.displayName = ach.title;
    }
  }

  return {
    name: result.name,
    appid: appID,
    binary: null,
    img: {
      header: result.header || 'header',
      background: result.background || 'page_bg_generated_v6b',
      portrait: result.portrait || 'portrait',
      icon: result.icon,
    },
    achievement: {
      total: achievements.length,
      list: achievements,
    },
  };
}

// IPlayerService/GetGameAchievements gives real descriptions for hidden achievements too, unlike
// the legacy ISteamUserStats/GetSchemaForGame (which always blanks them as a spoiler guard, key or
// no key — the root cause of hidden achievements being permanently stuck on "…", #57). Mapped here
// to the same {name, defaultvalue, displayName, hidden, description, icon, icongray} shape
// GetSchemaForGame's achievement list used, so it's a drop-in replacement for every caller below.
async function getGameAchievementsFromWebAPI(cfg) {
  const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?key=${cfg.key}&appid=${cfg.appID}&language=${cfg.lang}`;
  const data = await request.getJson(url);
  const list = data && data.response && data.response.achievements;
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    name: a.internal_name,
    defaultvalue: 0,
    displayName: a.localized_name,
    hidden: a.hidden ? 1 : 0,
    description: a.localized_desc || '',
    icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${cfg.appID}/${a.icon}`,
    icongray: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${cfg.appID}/${a.icon_gray}`,
  }));
}

async function getSteamData(cfg) {
  const schema = { achievements: await getGameAchievementsFromWebAPI(cfg) };
  // A game with zero achievements (e.g. UNDERTALE, appid 391540) is still a real, installed game
  // worth listing — don't throw it away here (that silently dropped such games when a Web API key was
  // set). Return it with an empty achievement list, mirroring getSteamDataFromSRV; makeList() decides
  // whether a 0-achievement game is shown (installed) or skipped (phantom).

  const store = await getDataFromSteamStore(+cfg.appID);
  let portrait_options = [
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${cfg.appID}/portrait.png`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${cfg.appID}/library_600x900.jpg`,
  ];
  if (store.portrait) portrait_options.push(store.portrait);
  portrait_options.push(null);

  const result = {
    name: store.name || (await findInAppList(+cfg.appID)),
    appid: cfg.appID,
    binary: null,
    img: {
      header: `https://cdn.akamai.steamstatic.com/steam/apps/${cfg.appID}/header.jpg`,
      background: `https://cdn.akamai.steamstatic.com/steam/apps/${cfg.appID}/page_bg_generated_v6b.jpg`,
      portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${cfg.appID}/library_600x900.jpg`,
      icon: store.icon ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${cfg.appID}/${store.icon}.jpg` : null,
    },
    achievement: {
      total: schema.achievements.length,
      list: schema.achievements,
    },
  };

  try {
    if ((await fetchIcon(result.img.header, result.appid)) === result.img.header) {
      result.img.header = store.header;
    }
    if ((await fetchIcon(result.img.background, result.appid)) === result.img.background) {
      result.img.background = store.background;
    }
    while (portrait_options.length > 0) {
      if ((await fetchIcon(result.img.portrait, result.appid)) !== result.img.portrait) {
        break;
      }
      result.img.portrait = portrait_options.shift();
    }
  } catch (err) {
    console.log(err);
  }
  return result;
}

// Lean, schema-only fetch: just the authoritative achievement list (no Steam store page, no icon
// downloads). Used to backfill blank descriptions/displayNames into a schema that was cached during
// the keyless/scrape era, without paying for the full getSteamData() round-trip.
async function getSchemaAchievements(cfg) {
  return getGameAchievementsFromWebAPI(cfg);
}

async function getDataFromSteamStore(appID) {
  if (!appID || !(Number.isInteger(appID) && appID > 0)) throw 'ERR_INVALID_APPID';

  const root = cacheRoot || path.join(process.env['APPDATA'] || '', 'Achievement Watcher');
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

    // Extract from inline style
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

// Fetch the list of DLC appids + names for a base game from the public Steam storefront API, so the
// GBE Fork repair can write a complete [app::dlcs] list (the enumeration APIs only return DLCs that
// are spelled out by id=name — unlock_all alone isn't enough for games that *list* their DLCs).
//
// Two requests, then cached on disk for 14 days so the per-scan auto-repair never re-hits the store
// for the same game (the storefront API rate-limits ~200 req / 5 min per IP):
//   1. appdetails?appids=<base>          -> data.dlc = [ids]
//   2. appdetails?appids=<ids>&filters=basic -> each id's data.name (chunked to keep URLs sane)
// Returns [{ appid: <number>, name: <string> }] (possibly empty). Never throws — DLC config is a
// best-effort extra, so a store outage degrades to "unlock_all=1 with no list" rather than failing.
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
    /* corrupt cache — refetch */
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
      // Use a cached copy if it exists and is < 3 days old.
      // NB: this used to call fs.readdirSync() on a *file* path, which throws ENOTDIR; the throw
      // escaped findInAppList(), left listReady stuck at false and froze every subsequent
      // uncached-game lookup on the `while (!listReady)` spin above (a big part of issue #53).
      if (fs.existsSync(filepath) && Date.now() - fs.statSync(filepath).mtimeMs < 60 * 60 * 1000 * 24 * 3) {
        try {
          list = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        } catch {
          list = undefined; // corrupt/partial cache -> fall through and re-download
        }
      }
      if (!Array.isArray(list) || list.length === 0) {
        try {
          const url = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/?format=json';
          const data = await request.getJson(url, { timeout: 40000 });
          list = data.applist.apps;
          fs.mkdirSync(path.dirname(filepath), { recursive: true });
          fs.writeFileSync(filepath, JSON.stringify(list, null, 2));
        } catch (err) {
          // Steam's app-list endpoint is intermittently unreachable / rate-limited (observed as a
          // 404 even while every other Steam API works). A failed refresh must NOT abort the whole
          // game load: fall back to any existing cached copy even if it is older than the 3-day
          // freshness window. A stale list still resolves every long-existing appid; brand-new
          // appids fall through to the get-steam-data name lookup below.
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
    /* list unavailable — callers can fall back to direct Steam search */
  }
}

// Reverse lookup: resolve a game NAME to a Steam appid via the cached GetAppList map. Used to borrow
// real store art (header/icon) for installed games we found on disk but that carry no appid of their
// own. Exact normalized-name match only, to avoid attaching the wrong game's art. Returns appid|null.
// Resolve a single AppID from a (possibly messy) folder/game name. Cleans repack/scene/version noise
// and accepts an exact or strong token match, but never a low-confidence fuzzy guess — the result is
// written to steam_appid.txt, so a wrong auto-pick would corrupt the install's identity. Use
// findAppidCandidatesByName for an interactive picker that includes fuzzy hits. (Upgraded from the old
// exact-normalized-equality match, which missed every "<Game> [FitGirl Repack]" / "(GOG)" folder.)
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

function findFileByName(dir, filename, maxDepth = 6) {
  if (!dir || !fs.existsSync(dir)) return null;
  const wanted = filename.toLowerCase();
  const walk = (current, depth) => {
    if (depth > maxDepth) return null;
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
  return walk(dir, 0);
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

module.exports.getLocalAchievementSchema = (gameDir, appid, lang = 'english') => {
  const tenoke = findFileByName(gameDir, TENOKE_SCHEMA_FILE);
  if (!tenoke) return [];
  return getTenokeSchemaFromFile(tenoke, appid, lang);
};

// Ranked AppID candidates for a name, best first: [{ appid, name, score, tier }]. Includes fuzzy
// (typo-tolerant) matches — meant for a confirm/pick dialog, not silent auto-application.
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
async function GetMissingData(data, showHidden, lang) {
  let updated = false;
  try {
    const { ipcRenderer } = require('electron');
    let updatedImgs, updatedDesc;
    if (Object.values(data.img).some((im) => !im)) {
      updated = true;
      updatedImgs = await ipcRenderer.invoke('get-steam-data', { appid: data.appid, type: 'common' });
      data.img.header = data.img.header || updatedImgs.header || 'header';
      data.img.background = data.img.background || updatedImgs.background || 'page_bg_generated_v6b';
      data.img.portrait = data.img.portrait || updatedImgs.portrait || 'portrait';
      data.img.icon = data.img.icon || updatedImgs.icon;
    }
    // Backfill blank achievement descriptions from the supplemental source. That lookup isn't free
    // (a key-less user pays for a puppeteer scrape), so once we've tried we stamp the schema and skip
    // it for a week — otherwise a game whose descriptions are simply unavailable triggers a fresh
    // attempt on every scan, a big contributor to the slow-load complaints (#53).
    // A key user's schema now comes from IPlayerService/GetGameAchievements (#57), which — unlike the
    // legacy GetSchemaForGame — already includes real text for hidden achievements, so a fresh fetch
    // needs no backfill. This branch exists for caches written before that fix (stale blank hidden
    // descriptions) and for key-less users, whose only source is the community scrape.
    const DESC_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
    const triedRecently = data.descBackfilledAt && Date.now() - data.descBackfilledAt < DESC_RECHECK_MS;
    const hasBlankVisible = data.achievement.list.some((ac) => ac.hidden != 1 && (!ac.description || String(ac.description).trim() === ''));
    const hasBlankHidden = data.achievement.list.some((ac) => ac.hidden == 1 && (!ac.description || String(ac.description).trim() === ''));
    if (!triedRecently && (hasBlankVisible || hasBlankHidden)) {
      updatedDesc = await ipcRenderer.invoke('get-steam-data', { appid: data.appid, type: 'steamhunters' });
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
          // older cache) as blank too — otherwise `!ach.description` is false for " " and the real text
          // never replaces it, leaving the achievement stuck on the UI's "..." fallback forever.
          if ((!ach.description || String(ach.description).trim() === '') && (map.has(ach.displayName) || map.has(ach.name))) {
            ach.description = map.get(ach.displayName) || map.get(ach.name);
          }
        }
      }
      // Exophase fallback for whatever SteamHunters still left blank. Unlike SteamHunters it also
      // serves the schema's own language, so a localized schema gets localized text. Matching is by
      // displayName only (localized title first, english title second) — never by list position, so
      // a miss can't attach another achievement's description. Runs inside the same weekly
      // descBackfilledAt stamp as the SteamHunters attempt, so it adds no recurring cost.
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
  // `url.startsWith`/`path.parse(null)` throw — that surfaced as a noisy "Error occurred in handler
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
    const cache = path.join(process.env['APPDATA'], `Achievement Watcher/steam_cache/icon/${appID}`);
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
