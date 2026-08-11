'use strict';

const path = require('path');
const fs = require('fs');
const glob = require('fast-glob');
const request = require('request-zero');

let cacheRoot;
let debug;
module.exports.initDebug = ({ isDev, userDataPath }) => {
  module.exports.setUserDataPath(userDataPath);
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

module.exports.setUserDataPath = (p) => {
  cacheRoot = p;
};

// A broken optional cache must not block the GOG scan.
function readGogMappingCache(cacheFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, { encoding: 'utf8' }));
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === 'object') : [];
  } catch {
    return [];
  }
}

function mappingByGogId(cache) {
  const byGogId = new Map();
  for (const entry of Array.isArray(cache) ? cache : []) {
    const gogid = String(entry?.gogid || '').trim();
    if (gogid && !byGogId.has(gogid)) byGogId.set(gogid, entry);
  }
  return byGogId;
}

module.exports.getCachedData = async (cfg) => {
  const cacheFile = path.join(cacheRoot, 'steam_cache', 'gog.db');
  const cache = readGogMappingCache(cacheFile);
  const cached = mappingByGogId(cache).get(String(cfg.appID));
  if (!cached) return;

  const schemaCache = path.join(cacheRoot, 'steam_cache/schema', cfg.lang);
  let result;
  try {
    const filePath = path.join(schemaCache, `${cached.steamid}.db`);

    if (fs.existsSync(filePath)) {
      result = JSON.parse(fs.readFileSync(filePath));
    }
  } catch (err) {
    if (err.code) throw `Could not load GOG data: ${err.code} - ${err.message}`;
    else throw `Could not load GOG data: ${err}`;
  }
  return result;
};

module.exports.scan = async (dir) => {
  const cacheFile = path.join(cacheRoot, 'steam_cache', 'gog.db');
  const data = [];
  const cache = readGogMappingCache(cacheFile);
  let updateCache = false;
  const cachedByGogId = mappingByGogId(cache);

  try {
    for (const dir of await glob(path.join(process.env['APPDATA'], 'NemirtingasGalaxyEmu', '*/*/').replace(/\\/g, '/'), {
      onlyDirectories: true,
      absolute: true,
    })) {
      let game = {
        appid: path.parse(dir).name,
        source: 'gog',
        data: {
          type: 'file',
          path: dir,
        },
      };
      let steamid;
      const cached = cachedByGogId.get(String(game.appid));
      if (cached) {
        steamid = cached.steamid;
      } else {
        try {
          const url = `https://gamesdb.gog.com/platforms/gog/external_releases/${game.appid}`;
          const gameinfo = await request.getJson(url);
          const releases = Array.isArray(gameinfo?.game?.releases) ? gameinfo.game.releases : [];
          const steamRelease = releases.find((release) => String(release?.platform_id || '').toLowerCase() === 'steam');
          steamid = steamRelease?.external_id;
          if (steamid) {
            const entry = { gogid: game.appid, steamid };
            cache.push(entry);
            cachedByGogId.set(String(game.appid), entry);
            updateCache = true;
          }
        } catch {}
      }
      if (steamid) {
        game.appid = steamid;
        data.push(game);
      }
    }
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    if (updateCache) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    return data;
  } catch (err) {
    throw err;
  }
};

module.exports._internal = { readGogMappingCache, mappingByGogId };
