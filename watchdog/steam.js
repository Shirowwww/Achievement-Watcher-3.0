'use strict';

const path = require('path');
const debug = require('./util/log.js');
const urlParser = require('url');
const fs = require('fs');
const { lazyRequire } = require('./util/lazyRequire.js');
// Network and scraping only: an idle daemon never reaches either.
const request = lazyRequire('request-zero');
const steamLang = require('./steam.json');
const htmlParser = lazyRequire('node-html-parser');
const { userDataDir } = require('./util/userData.js');

// The shared schema mappers live in the app folder. In a packaged build the app code is inside
// resources/app.asar and the unpacked copies are at resources/app.asar.unpacked (see
// electron-builder.yml asarUnpack); in dev the plain app folder is next to the watchdog.
function sharedAppModulePath(rel) {
  const resources = process.resourcesPath;
  const unpacked = resources ? path.join(resources, 'app.asar.unpacked', rel) : '';
  if (unpacked && fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, '..', 'app', rel);
}

const steamSchemaFetch = require(sharedAppModulePath('util/steamSchemaFetch.js'));
const { mergeTranslatedAchievements } = require(sharedAppModulePath('parser/achievementTranslations.js'));

// Plain-HTTP fetches for the keyless schema chain (official Steam endpoint, then SteamHunters'
// public JSON API). SteamHunters serves its JSON to browser-like clients, so keep a real UA.
const STEAM_FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const STEAM_KEYLESS_TIMEOUT_MS = 10000;

// Normalize schema names so notifications never show "[object Object]".
function normalizeName(name, appID) {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    if (typeof name.name === 'string' && name.name.trim()) return name.name;
    if (typeof name.english === 'string' && name.english.trim()) return name.english;
    const first = Object.values(name).find((v) => typeof v === 'string' && v.trim());
    if (first) return first;
  }
  if (typeof name === 'number') return String(name);
  return String(appID);
}

module.exports.loadSteamData = async (appID, lang, binary = null) => {
  if (!steamLang.some((language) => language.api === lang)) {
    throw 'Unsupported API language code';
  }

  const cache = path.join(userDataDir(), 'steam_cache/schema', lang);

  try {
    let filePath = path.join(`${cache}`, `${appID}.db`);
    let result;

    if (fs.existsSync(filePath)) {
      result = JSON.parse(fs.readFileSync(filePath));
    } else {
      result = await getSteamDataFromSRV(appID, lang);
      result.binary = binary;
      // A temporary store outage can leave us with a usable schema but only the numeric appid as
      // a title. Use it for this notification, but do not make that degraded name permanent.
      if (result.name !== String(appID)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
      }
    }

    if (result && typeof result.name !== 'string') result.name = normalizeName(result.name, appID);
    return result;
  } catch (err) {
    throw `Could not load Steam data for ${appID} - ${lang}: ${err}`;
  }
};

module.exports.fetchIcon = async (url, appID) => {
  try {
    const cache = path.join(userDataDir(), `steam_cache/icon/${appID}`);

    const filename = path.parse(urlParser.parse(url).pathname).base;

    let filePath = path.join(cache, filename);

    if (fs.existsSync(filePath)) {
      return filePath;
    } else {
      return (await request.download(url, cache)).path;
    }
  } catch (err) {
    return url;
  }
};

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Official endpoint, no key. Returns mapped achievements (possibly []) or null on transport error.
async function getOfficialSchemaKeyless(appID, lang) {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid=${appID}&language=${lang}`;
    const json = await fetchJson(url, { signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS) });
    return steamSchemaFetch.mapOfficialAchievements(json && json.response, appID);
  } catch (err) {
    debug.warn(`[watchdog] keyless GetGameAchievements failed for ${appID}: ${err.code || err.message || err}`);
    return null;
  }
}

// SteamHunters public JSON API (English names/descriptions + global rarity). Returns the raw list
// so the caller can enrich it with SteamCommunity icons/hidden before mapping; [] is valid ("no
// achievements") and null means the request failed.
async function fetchSteamHuntersJson(appID) {
  try {
    const url = `https://steamhunters.com/api/apps/${appID}/achievements`;
    const json = await fetchJson(url, {
      headers: { 'User-Agent': STEAM_FETCH_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS),
    });
    return Array.isArray(json) ? json : null;
  } catch (err) {
    debug.warn(`[watchdog] SteamHunters JSON failed for ${appID}: ${err.code || err.message || err}`);
    return null;
  }
}

async function getSteamCommunityRows(appID, lang) {
  try {
    const url = `https://steamcommunity.com/stats/${appID}/achievements?l=${encodeURIComponent(lang)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': STEAM_FETCH_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'birthtime=662716801; wants_mature_content=1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rows = steamSchemaFetch.parseSteamCommunityRows(await res.text());
    return rows.length > 0 ? rows : null;
  } catch (err) {
    debug.warn(`[watchdog] SteamCommunity page failed for ${appID}: ${err.code || err.message || err}`);
    return null;
  }
}

// Same icon-hash -> apiName index as app/electron/init.js, shared on disk (both use the same
// steam_cache/apinames/<appID>.json), so whichever side resolves first helps the other's fallback.
function apiNameIndexPath(appID) {
  return path.join(userDataDir(), 'steam_cache/apinames', `${appID}.json`);
}

function loadApiNameIndex(appID) {
  try {
    return JSON.parse(fs.readFileSync(apiNameIndexPath(appID), 'utf8'));
  } catch {
    return null;
  }
}

function rememberApiNameIndex(appID, achievements) {
  try {
    const fresh = steamSchemaFetch.buildApiNameIndex(achievements);
    if (Object.keys(fresh).length === 0) return;
    const merged = { ...(loadApiNameIndex(appID) || {}), ...fresh };
    const file = apiNameIndexPath(appID);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged));
  } catch (err) {
    debug.warn(`[watchdog] could not persist the apiName index for ${appID}: ${err.message || err}`);
  }
}

async function getAchievementsKeyless(appID, lang) {
  const official = await getOfficialSchemaKeyless(appID, lang);
  if (official !== null) {
    // [] is a valid "zero achievements" answer, null means failure; only index a non-empty list.
    if (official.length) rememberApiNameIndex(appID, official);
    return official;
  }
  const sh = await fetchSteamHuntersJson(appID);
  if (sh !== null) {
    if (sh.length === 0) return [];
    // SteamHunters titles are English-only: icons/hidden come from the English page (title match),
    // then the localized page is overlaid by icon hash for non-English languages.
    const achievements = steamSchemaFetch.mapSteamHuntersJson(sh);
    const englishRows = await getSteamCommunityRows(appID, 'english');
    const merged = englishRows
      ? steamSchemaFetch.mergeSteamHuntersWithCommunity(sh, englishRows)
      : achievements;
    if (lang !== 'english') {
      const localizedRows = await getSteamCommunityRows(appID, lang);
      if (localizedRows) mergeTranslatedAchievements(merged, localizedRows);
    }
    rememberApiNameIndex(appID, merged);
    return merged;
  }
  const rows = await getSteamCommunityRows(appID, lang);
  if (rows) {
    const degraded = steamSchemaFetch.mapSteamCommunityRows(rows);
    const apiNames = loadApiNameIndex(appID);
    return apiNames ? steamSchemaFetch.applyApiNameIndex(degraded, apiNames) : degraded;
  }
  return null;
}

// Resolve the store name/icon used by the playtime monitor and notifications. appdetails JSON is
// keyless and reliable; the HTML page parser remains as a fallback.
async function getStoreDetails(appID) {
  let name = '';
  let icon = null;
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appID}&cc=us&l=en`;
    const json = await fetchJson(url, { signal: AbortSignal.timeout(STEAM_KEYLESS_TIMEOUT_MS) });
    const data = json && json[appID] && json[appID].data;
    if (data && data.name) name = data.name;
    if (data && data.client_icon) icon = data.client_icon;
  } catch (err) {
    debug.warn(`[watchdog] store appdetails failed for ${appID}: ${err.code || err.message || err}`);
  }
  // appdetails does not expose the client icon hash; the store page parser still does.
  if (!name || !icon) {
    const store = await getDataFromSteamStore(+appID);
    if (!name && store.name) name = store.name;
    if (!icon && store.icon) icon = store.icon;
  }
  return { name, icon };
}

async function getSteamDataFromSRV(appID, lang) {
  const [achievements, store] = await Promise.all([
    getAchievementsKeyless(appID, lang),
    getStoreDetails(+appID),
  ]);
  // Do not cache a transport outage as a verified zero-achievement schema forever.
  if (achievements === null) throw new Error('No Steam achievement source was reachable');
  return {
    name: store.name || String(appID),
    appid: appID,
    binary: null,
    img: {
      header: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/header.jpg`,
      background: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/page_bg_generated_v6b.jpg`,
      portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/library_600x900.jpg`,
      icon: store.icon
        ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appID}/${store.icon}.jpg`
        : null,
    },
    achievement: {
      total: achievements.length,
      list: achievements,
    },
  };
}

async function getDataFromSteamStore(appID) {
  if (!appID || !(Number.isInteger(appID) && appID > 0)) throw 'ERR_INVALID_APPID';

  const url = `https://store.steampowered.com/app/${appID}`;

  try {
    const { body } = await request(url, {
      headers: {
        Cookie: 'birthtime=662716801; wants_mature_content=1; path=/; domain=store.steampowered.com', //Bypass age check and mature filter
        'Accept-Language': 'en-US;q=1.0', //force result to english
      },
    });

    const html = htmlParser.parse(body);

    const result = {
      name: html.querySelector('.apphub_AppName').innerHTML,
      icon: html
        .querySelector('.apphub_AppIcon img')
        .attributes.src.match(/([^\\\/\:\*\?\"\<\>\|])+$/)[0]
        .replace('.jpg', ''),
    };

    return result;
  } catch (err) {
    debug.warn(err);
    return {};
  }
}

// Exposed for unit tests.
module.exports._internal = {
  mapOfficialAchievements: steamSchemaFetch.mapOfficialAchievements,
  mapSteamHuntersJson: steamSchemaFetch.mapSteamHuntersJson,
  parseSteamCommunityRows: steamSchemaFetch.parseSteamCommunityRows,
  mergeSteamHuntersWithCommunity: steamSchemaFetch.mergeSteamHuntersWithCommunity,
  mergeTranslatedAchievements,
  toRarityPercent: steamSchemaFetch.toRarityPercent,
  getAchievementsKeyless,
};
