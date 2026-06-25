'use strict';

const path = require('path');
const yaml = require('js-yaml');
const glob = require('fast-glob');
const zip = require('adm-zip');
const fs = require('fs');
const { listRegistryAllSubkeys, readRegistryString, readRegistryInteger } = require('../util/reg');
const request = require('request-zero');
const steamLanguages = require(path.join(__dirname, '../locale/steam.json'));

let debug;
module.exports.initDebug = ({ isDev, userDataPath }) => {
  // Was `remote.getCurrentWindow().isDev` — but `remote` is not imported here, so this threw the
  // moment it ran. It never actually ran (achievements.initDebug forgot to call us), which left
  // `debug` undefined and made every `debug.log(...)` throw "Cannot read property 'log' of
  // undefined", skipping every UPLAY* game. Use the passed-in flag, like the other parsers.
  debug = new (require('@xan105/log'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/uplay.log'),
  });
};

module.exports.scan = async () => {
  //LumaPlay
  let result = [];
  try {
    let users = listRegistryAllSubkeys('HKCU', 'SOFTWARE/LumaPlay');
    if (!users) throw 'LumaPlay no user found';

    for (let user of users) {
      try {
        let appidList = listRegistryAllSubkeys('HKCU', `SOFTWARE/LumaPlay/${user}`);
        if (!appidList) throw `No achievements found for LumaPlay user: ${user}`;

        for (let appid of appidList) {
          result.push({
            appid: `UPLAY${appid}`,
            source: 'Lumaplay',
            data: {
              type: 'lumaplay',
              root: 'HKCU',
              path: `SOFTWARE/LumaPlay/${user}/${appid}/Achievements`,
            },
          });
        }
      } catch (err) {
        debug.log(err);
      }
    }
    return result;
    //TODO: continue this
    const { ipcRenderer } = require('electron');
    const cacheFile = path.join(cacheRoot, 'steam_cache', 'uplay.db');
    //uplay game ids: https://github.com/Haoose/UPLAY_GAME_ID
    let cache = [];
    let update_cache = false;

    if (fs.existsSync(cacheFile)) {
      cache = JSON.parse(fs.readFileSync(cacheFile, { encoding: 'utf8' }));
    }

    let search = [path.join(process.env['APPDATA'], 'Goldberg UplayEmu Saves')];
    for (let dir of await glob(search, { onlyDirectories: true, absolute: true })) {
      let game = {
        appid: path.parse(dir).name,
        source: 'uplay',
        data: {
          type: 'file',
          path: dir,
        },
      };
      let steamid;
      let cached = cache.find((g) => g.gogid === game.appid);
      if (cached) {
        steamid = cached.steamid;
      } else {
        steamid = ipcRenderer.sendSync('get-steam-appid-from-title', { title });
        cache.push({ epicid: game.appid, steamid });
        if (gameinfo) {
          steamid = gameinfo.game.releases.find((r) => r.platform_id === 'steam').external_id;
          if (steamid) {
            cache.push({ gogid: game.appid, steamid });
            update_cache = true;
          }
        }
      }
      if (steamid) {
        game.appid = steamid || game.appid;
        data.push(game);
      }
    }
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    if (update_cache) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

    return data;
  } catch (err) {
    throw err;
  }
};

// Set of Ubisoft Connect appids that are actually INSTALLED (have an Installs registry key with an
// InstallDir), as opposed to merely owned/seen (which is what scanLegit() enumerates from the
// achievements cache). Memoized for the session — registry rarely changes mid-run, and this is hit
// once per uPlay game during a scan. Used to drive the "show installed only" filter.
let _installedUplayAppids = null;
module.exports.getInstalledAppids = () => {
  if (_installedUplayAppids) return _installedUplayAppids;
  try {
    const subs = listRegistryAllSubkeys('HKLM', 'SOFTWARE/WOW6432Node/Ubisoft/Launcher/Installs');
    _installedUplayAppids = new Set((subs || []).map((s) => String(s)));
  } catch (err) {
    _installedUplayAppids = new Set();
  }
  return _installedUplayAppids;
};

// True when a uPlay appid (with or without the "UPLAY" prefix) is installed per the registry.
module.exports.isInstalled = (appid) => {
  const id = String(appid).replace(/^UPLAY/i, '');
  return module.exports.getInstalledAppids().has(id);
};

module.exports.scanLegit = async (onlyInstalled = false) => {
  //Uplay /*Unused function; As of writing there is no way to get legit user ach unlocked data*/
  try {
    const uplayPath = readRegistryString('HKLM', 'Software/WOW6432Node/Ubisoft/Launcher', 'InstallDir');
    if (!uplayPath) throw 'Uplay Path not found';

    let data = [];

    if (onlyInstalled) {
      let installedList = listRegistryAllSubkeys('HKLM', 'SOFTWARE/WOW6432Node/Ubisoft/Launcher/Installs');
      if (!installedList) throw 'Uplay has no game installed';

      for (let appid of installedList) {
        data.push({
          appid: `UPLAY${appid}`,
          source: 'uPlay',
          data: {
            type: 'uplay',
          },
        });
      }
    } else {
      const ach_cache = path.join(uplayPath, 'cache/achievements');
      let list = (await glob('([0-9]+)_*', { cwd: ach_cache, onlyFiles: true, absolute: false })).map((filename) => {
        let col = filename.split('_');

        return {
          appid: col[0],
          index: col[1].replace('.zip', ''),
        };
      });

      for (let game of list) {
        data.push({
          appid: `UPLAY${game.appid}`,
          source: 'uPlay',
          data: {
            type: 'uplay',
          },
        });
      }
    }

    return data;
  } catch (err) {
    throw err;
  }
};

module.exports.getGameData = async (appid, lang) => {
  try {
    appid = appid.replace('UPLAY', '');

    const cacheFile = path.join(remote.app.getPath('userData'), 'uplay_cache/schema', `${appid}.db`);

    let schema;

    if (fs.existsSync(cacheFile)) {
      schema = JSON.parse(fs.readFileSync(cacheFile));
    } else {
      try {
        // request-zero's socket timeout (request.cjs) calls req.destroy() with no error argument,
        // which per Node's http docs does NOT emit 'error' on the request. So a stalled connection
        // (server accepts but never responds, e.g. an uncached/newly-released appid like AC Shadows)
        // leaves this promise neither resolved nor rejected forever, hanging the whole game list
        // (makeList awaits every game via Promise.all). Race it against our own timeout so a stuck
        // server always falls through to the local-cache fallback below instead of freezing the UI.
        schema = await withTimeout(getUplayDataFromSRV(appid), 15000, `Timed out fetching UPLAY${appid} schema from server`);
      } catch (err) {
        debug.log(`Failed to get schema from server for UPLAY${appid}; Trying to generate from local Uplay installation ...`);

        let uplayPath = readRegistryString('HKLM', 'Software/WOW6432Node/Ubisoft/Launcher', 'InstallDir');
        if (!uplayPath) throw "Uplay not found : can't generate schema if uplay is not installed.";
        schema = await generateSchemaFromLocalCache(appid, uplayPath);
        try {
          await withTimeout(shareCache(schema), 15000, `Timed out sharing UPLAY${appid} cache to server`);
        } catch (err) {
          debug.log(`Failed to share UPLAY${appid} cache to server => ${err}`);
        }
      }
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      // fs.writeFile (callback API) throws synchronously without a callback; use the promise API
      // so the .catch() is valid — otherwise this threw and the uPlay game failed its first load.
      fs.promises.writeFile(cacheFile, JSON.stringify(schema, null, 2)).catch((err) => {});
    }

    //Lang Loading
    if (schema.achievement.list[`${lang}`]) {
      schema.achievement.list = schema.achievement.list[`${lang}`]; //load only user lang
    } else {
      schema.achievement.list = schema.achievement.list['english']; //default to english if the game has not that lang
    }

    return schema;
  } catch (err) {
    throw err;
  }
};

module.exports.getAchievementsFromLumaPlay = (root, key) => {
  try {
    let result = listRegistryAllValues(root, key);
    if (!result) throw 'No achievement found in registry';

    return result.map((name) => {
      return {
        id: name.replace('ACH_', ''),
        Achieved: parseInt(readRegistryInteger(root, key, name)),
      };
    });
  } catch (err) {
    throw err;
  }
};

async function generateSchemaFromLocalCache(appid, uplayPath) {
  try {
    let id, index;

    try {
      id = await availableID.get(uplayPath, appid);
      index = await indexDB.get(uplayPath, id.index);
    } catch (e) {
      debug.log(e);
      throw `${appid} not found in Uplay local cache`;
    }

    debug.log(`${index.name} - ${id.appid}`);

    const cache = path.join(remote.app.getPath('userData'), 'uplay_cache/img/', `${id.appid}`);

    let archive = new zip(id.archive);
    let archiveEntries = archive.getEntries();

    if (!archiveEntries.some((entry) => entry.entryName === 'achievements.dat')) throw 'Unexpected archive content';

    let game = {
      name: index.name,
      appid: `UPLAY${id.appid}`,
      system: 'uplay',
      img: {
        header: null,
        background: null,
        icon: null,
      },
      game_lang: [],
      achievement: {
        total: 0,
        list: {},
      },
    };

    for (let entry of archiveEntries) {
      try {
        if (entry.entryName.match(/^\d+.*$/) !== null) {
          archive.extractEntryTo(entry.entryName, cache, true, true);
        } else if (entry.entryName.match(/([a-z]+-[A-Z]+)_loc.txt/) !== null) {
          let isoCode = entry.entryName.match(/([a-z]+-[A-Z]+)/)[0];

          debug.log(`Parsing ${entry.entryName}`);

          let lang = steamLanguages.find((lang) => isoCode == lang.iso);
          if (!lang) lang = steamLanguages.find((lang) => isoCode.includes(lang.webapi));
          if (!lang) throw `Unsupported lang: isoCode`;

          debug.log(`Bind to steam lang: ${lang.webapi}`);

          if (game.achievement.list.hasOwnProperty(lang.api)) throw `Ach list for ${lang.api} has already been set ! (Discarding ${isoCode})`;

          let content = archive.readAsText(entry.entryName).trim().split(/\r?\n/).filter((l) => l.length > 0);

          game.achievement.list[`${lang.api}`] = content.map((line) => {
            let col = line.split('\t');

            return {
              name: col[0],
              displayName: col[1],
              description: col[2],
              icon: path.join(cache, `${col[0]}.png`).replace(/\\/g, '/'),
              icongray: path.join(cache, `${col[0]}.png`).replace(/\\/g, '/'),
            };
          });

          game.game_lang.push(lang);
        }
      } catch (err) {
        debug.log(err);
      }
    }

    game.achievement.total = game.achievement.list.english.length;

    try {
      let dest = path.join(`${cache}`, `background${path.parse(index.background).ext}`);
      fs.copyFileSync(path.join(uplayPath, 'cache/assets', `${index.background}`), dest);
      game.img.background = dest.replace(/\\/g, '/');
    } catch (e) {
      debug.log(e);
    }

    try {
      let dest = path.join(`${cache}`, `header${path.parse(index.header).ext}`);
      fs.copyFileSync(path.join(uplayPath, 'cache/assets', `${index.header}`), dest);
      game.img.header = dest.replace(/\\/g, '/');
    } catch (e) {
      debug.log(e);
    }

    try {
      let dest = path.join(`${cache}`, `icon${path.parse(index.icon).ext}`);
      fs.copyFileSync(path.join(uplayPath, 'data/games', `${index.icon}`), dest);
      game.img.icon = dest.replace(/\\/g, '/');
    } catch (e) {
      debug.log(e);
    }

    return game;
  } catch (err) {
    debug.log(err);
    throw `Failed to generate schema for UPLAY${appid} => ${err}`;
  }
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function getUplayDataFromSRV(appID, lang = null) {
  const url = lang ? `https://api.xan105.com/uplay/ach/${appID}?lang=${lang}` : `https://api.xan105.com/uplay/ach/${appID}`;

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

async function shareCache(schema) {
  const url = 'https://api.xan105.com/uplay/share/';

  try {
    let appid = schema.appid.replace('UPLAY', '');

    const cache = path.join(remote.app.getPath('userData'), 'uplay_cache/img/', `${appid}`);

    let archive = new zip();
    archive.addFile('schema.json', Buffer.from(JSON.stringify(schema)));
    archive.addLocalFolder(cache);

    debug.log(`Sharing ${schema.name} - ${appid}`);
    await request.upload(url, archive.toBuffer(), {
      headers: { 'x-hello': 'Y*Xsv+k77_Vz*tLW' },
      fieldname: 'eXVeFUuMuaDnFXww',
      filename: `${schema.name} - ${appid}.zip`,
    });
  } catch (err) {
    debug.log(err);
    throw err;
  }
}

/* =========================================== */

let indexDB = {
  cache: null,
  make: async function (uplayPath) {
    try {
      const file = path.join(uplayPath, 'cache/configuration/configurations');

      if (!fs.existsSync(file)) {
        throw 'No Uplay Configurations file found';
      }

      debug.log(`Parsing ${file}\n========`);

      const filter = [
        /[^\u0020-\u007E\n\r\t]/g, // remove (most) unwanted char
        /^.*#.*$/gm, // remove bad formated comment #
        /^(?!.*(\:)).*$/gm, // remove yaml line without descriptor pair ( xxx : yyy )
      ];

      let raw = fs.readFileSync(file, 'utf8');

      let data = raw.replace(filter[0], '').split('version: 2.0');
      data.shift(); //skip binary garbage before first "version: 2.0" split

      let result = [];

      for (let i in data) {
        if (Object.prototype.hasOwnProperty.call(data, i)) {
          try {
            let doc = yaml.load(data[i].replace(filter[1], '').replace(filter[2], ''));

            let game = {
              index: null,
              name: null,
              background: null,
              header: null,
              icon: null,
            };

            try {
              game.name = doc.root.installer.game_identifier;
              if (!game.name) throw 'Unvalid name';
            } catch (err) {
              try {
                game.name = doc.localizations['default'].l1;
                if (!game.name) throw 'Unvalid name';
              } catch (err) {
                try {
                  game.name = doc.root.name;
                  if (!game.name) throw 'Unvalid name';
                } catch (err) {
                  throw `Entry ${i} has no name !`;
                }
              }
            }

            try {
              if (doc.root.uplay.achievements) {
                game.index = doc.root.uplay.achievements.replace('.zip', '');
                try {
                  game.background = doc.root.background_image;
                  game.header = doc.root.logo_image;
                  game.icon = doc.root.icon_image;

                  if (!game.background || game.background == 'BACKGROUNDIMAGE') game.background = doc.localizations['default'].BACKGROUNDIMAGE;
                  if (!game.header || game.header == 'LOGOIMAGE') game.header = doc.localizations['default'].LOGOIMAGE;
                  if (!game.icon || game.icon == 'ICONIMAGE') game.icon = doc.localizations['default'].ICONIMAGE;
                } catch (err) {
                  debug.log(`${game.name} has no img anchor`);
                }
                result.push(game);
              }
            } catch (err) {
              debug.log(`${game.name} has no achievements anchor`);
            }
          } catch (err) {
            if (err.name === 'YAMLException') {
              debug.log('--- YAML error at entry ' + i + ' ---');
              debug.log(err.reason);
              debug.log(err.mark);
              debug.log(err.message);
              debug.log('--- YAML ---');
            } else {
              debug.log(err);
            }
          }
        }
      } //loop
      debug.log(`end of Parsing\n==============`);
      return result;
    } catch (err) {
      debug.log(err);
    }
  },
  get: async function (uplayPath, index = null) {
    try {
      if (!this.cache) {
        this.cache = await this.make(uplayPath);
      }

      if (index) {
        return this.cache.find((game) => game.index == index);
      } else {
        return this.cache;
      }
    } catch (err) {
      throw err;
    }
  },
};

let availableID = {
  cache: null,
  make: async function (uplayPath) {
    try {
      const dir = path.join(uplayPath, 'cache/achievements');

      let list = (await glob('([0-9]+)_*', { cwd: dir, onlyFiles: true, absolute: false })).map((filename) => {
        let col = filename.split('_');

        return {
          appid: col[0],
          index: col[1].replace('.zip', ''),
          archive: path.join(dir, filename),
        };
      });

      return list;
    } catch (err) {
      throw err;
    }
  },
  get: async function (uplayPath, appid = null) {
    try {
      if (!this.cache) {
        this.cache = await this.make(uplayPath);
      }

      if (appid) {
        return this.cache.find((id) => id.appid == appid);
      } else {
        return this.cache;
      }
    } catch (err) {
      throw err;
    }
  },
};
