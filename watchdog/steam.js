'use strict';

const path = require('path');
const debug = require('./util/log.js');
const urlParser = require('url');
const fs = require('fs');
const request = require('request-zero');
const steamLang = require('./steam.json');
const htmlParser = require('node-html-parser');

// Coerce a possibly non-string schema name into a usable display title (issue #54): handles a plain
// string, a { name } wrapper, a localized { english, … } map (prefers english), a number, and falls
// back to the appid so a toast never shows "[object Object]". Mirrors normalizeGameName in the
// renderer's parser/achievements.js (kept local since the watchdog is a separate process).
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

module.exports.loadSteamData = async (appID, lang, key, binary = null) => {
  if (!steamLang.some((language) => language.api === lang)) {
    throw 'Unsupported API language code';
  }

  const cache = path.join(process.env['APPDATA'], 'Achievement Watcher/steam_cache/schema', lang);

  try {
    let filePath = path.join(`${cache}`, `${appID}.db`);
    let result;

    if (fs.existsSync(filePath)) {
      result = JSON.parse(fs.readFileSync(filePath));
    } else {
      if (key) {
        result = await getSteamData(appID, lang, key);
        result.binary = binary;
      } else {
        result = await getSteamDataFromSRV(appID, lang);
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    }

    if (result && typeof result.name !== 'string') result.name = normalizeName(result.name, appID);
    return result;
  } catch (err) {
    throw `Could not load Steam data for ${appID} - ${lang}: ${err}`;
  }
};

module.exports.fetchIcon = async (url, appID) => {
  try {
    const cache = path.join(process.env['APPDATA'], `Achievement Watcher/steam_cache/icon/${appID}`);

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

function getSteamDataFromSRV(appID, lang) {
  const url = `https://api.xan105.com/steam/ach/${appID}?lang=${lang}`;

  return new Promise((resolve, reject) => {
    request
      .getJson(url)
      .then((data) => {
        if (data.error) {
          return reject(data.error);
        } else if (data.data) {
          return resolve(data.data);
        } else {
          return reject('Unexpected Error');
        }
      })
      .catch((err) => {
        return reject(err);
      });
  });
}

async function getSteamData(appID, lang, key) {
  // IPlayerService/GetGameAchievements (not the legacy ISteamUserStats/GetSchemaForGame) so hidden
  // achievements keep their real description — same root-cause fix as the renderer (#57). Mapped to
  // the {name, displayName, hidden, description, icon, icongray} shape the rest of the watchdog uses.
  const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?key=${key}&appid=${appID}&language=${lang}`;

  const data = await request.getJson(url);

  const list = data && data.response && data.response.achievements;
  if (!Array.isArray(list) || list.length === 0) throw "Schema doesn't have any achievement";
  const achievements = list.map((a) => ({
    name: a.internal_name,
    defaultvalue: 0,
    displayName: a.localized_name,
    hidden: a.hidden ? 1 : 0,
    description: a.localized_desc || '',
    icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appID}/${a.icon}`,
    icongray: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appID}/${a.icon_gray}`,
  }));
  let store = await getDataFromSteamStore(+appID);
  const result = {
    name: await findInAppList(+appID),
    appid: appID,
    binary: null,
    img: {
      header: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/header.jpg`,
      background: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/page_bg_generated_v6b.jpg`,
      portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${appID}/library_600x900.jpg`,
      icon: store.icon
        ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appID}/${store.icon}.jpg`
        : 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/480/winner.jpg',
    },
    achievement: {
      total: achievements.length,
      list: achievements,
    },
  };

  return result;
}

async function findInAppList(appID) {
  if (!appID || !(Number.isInteger(appID) && appID > 0)) throw 'ERR_INVALID_APPID';

  const cache = path.join(process.env['APPDATA'], 'Achievement Watcher/steam_cache/schema');
  const filepath = path.join(cache, 'appList.json');

  try {
    const list = JSON.parse(fs.readFileSync(filepath));
    const app = list.find((app) => app.appid === appID);
    if (!app) throw 'ERR_NAME_NOT_FOUND';
    return app.name;
  } catch {
    const url = 'http://api.steampowered.com/ISteamApps/GetAppList/v0002/?format=json';

    const data = await request.getJson(url, { timeout: 4000 });

    let list = data.applist.apps;
    list.sort((a, b) => b.appid - a.appid); //recent first

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(list, null, 2));

    const app = list.find((app) => app.appid === appID);
    if (!app) throw 'ERR_NAME_NOT_FOUND';
    return app.name;
  }
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
