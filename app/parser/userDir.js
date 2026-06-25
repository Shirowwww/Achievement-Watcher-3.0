'use strict';

const path = require('path');
const appPath = path.join(__dirname, '../');
const ini = require('@xan105/ini');
const parentFind = require('find-up');
const glob = require('fast-glob');
const fs = require('fs');
const listDrive = require(path.join(appPath, 'util/listDrive.js'));
const { readRegistryStringAndExpand } = require('../util/reg');

let file;

module.exports.setUserDataPath = async (p) => {
  file = path.join(p, 'cfg/userdir.db');
};

const steam_emu_cfg_file_supported = [
  'ALI213.ini',
  'valve.ini',
  'hlm.ini',
  'ds.ini',
  'steam_api.ini',
  'SteamConfig.ini',
  'tenoke.ini',
  'UniverseLAN.ini',
];

// Quarantine a corrupted config file (rename to <file>.corrupt-<timestamp>) so its raw bytes are
// preserved for manual recovery while a clean default is written in its place.
function quarantineCorruptConfig(f, err) {
  try {
    const backup = `${f}.corrupt-${Date.now()}`;
    fs.renameSync(f, backup);
    console.warn(`[userDir] corrupt config ${f} (${err.message}); quarantined to ${backup}, resetting`);
  } catch (e) {
    try { fs.unlinkSync(f); } catch {}
    console.warn(`[userDir] corrupt config ${f} (${err.message}); could not quarantine (${e.message}), overwriting`);
  }
}

module.exports.get = async () => {
  try {
    if (!fs.existsSync(file)) {
      await this.save([]);
      return [];
    }
    const raw = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (parseErr) {
      // Genuine corruption (e.g. a write interrupted by a crash/power loss). A transient I/O lock
      // throws before JSON.parse and is handled by the outer catch — so we never quarantine a good
      // file just because antivirus/the indexer held it open for a moment.
      quarantineCorruptConfig(file, parseErr);
      try { await this.save([]); } catch {}
      return [];
    }
  } catch (err) {
    // I/O error (file locked, permission issue, …) — degrade to empty without destroying the file.
    console.warn(`[userDir] could not read ${file}: ${err.message}`);
    return [];
  }
};

module.exports.save = async (data) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    throw err;
  }
};

module.exports.find = async () => {
  const ignore = ['System Volume Information', '$Recycle.Bin', '$RECYCLE.BIN', 'Recovery', 'MSOCache'];

  try {
    const search = steam_emu_cfg_file_supported
      .filter((el) => el !== 'steam_api.ini') //cause a lot of false positive
      .concat(['rpcs3.exe', 'shadPS4.exe', 'shadps4.exe', 'xenia.exe', 'xenia_canary.exe']) //emulator binaries
      .map((el) => {
        return '**/' + el;
      }); //glob pattern
    const drives = await listDrive();

    let result = [];

    for (let drive of drives) {
      for (let filepath of await glob(search, { cwd: drive, ignore: ignore, onlyFiles: true, absolute: true, suppressErrors: true })) {
        result.push(path.parse(filepath).dir);
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};

module.exports.check = async (dirpath) => {
  try {
    let result = false;

    const accepted_files = steam_emu_cfg_file_supported.concat(['rpcs3.exe', 'shadPS4.exe', 'shadps4.exe', 'xenia.exe', 'xenia_canary.exe']);

    //check for appID folder(s)
    let scan = await glob('([0-9]+)', { cwd: dirpath, onlyDirectories: true });
    if (scan.length > 0) return (result = true);

    //check for accepted_files
    scan = await glob('*.{ini,exe}', { cwd: dirpath, onlyFiles: true });
    for (let file of scan) if (accepted_files.some((filename) => filename === file)) return (result = true);

    return result;
  } catch (err) {
    throw err;
  }
};

module.exports.scan = async (dir) => {
  let result = [];

  try {
    let info;
    for (var file of steam_emu_cfg_file_supported) {
      try {
        info = ini.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        break;
      } catch (e) {}
    }
    if (!info) return result;

    /*
      parentFind:
        Most of the time the cfg/dll pair is next to the game binary and thus UserDataFolder folder should be there as well; 
        Otherwise walk up parent directories and try to find the folder.
    */

    if ((file === 'ALI213.ini' || file === 'valve.ini' || file === 'SteamConfig.ini') && info.Settings) {
      //ALI213

      if (info.Settings.AppID && info.Settings.PlayerName && info.Settings.SaveType == 0) {
        let dirpath = await parentFind(
          async (directory) => {
            let has = await parentFind.exists(path.join(directory, `Profile/${info.Settings.PlayerName}/Stats`));
            return has && directory;
          },
          { cwd: dir, type: 'directory' }
        );

        if (dirpath) {
          result.push({
            appid: info.Settings.AppID,
            source: 'ALI213',
            data: {
              type: 'file',
              path: path.join(dirpath, `Profile/${info.Settings.PlayerName}/Stats`),
            },
          });
        }
      } else if (info.Settings.AppID && info.Settings.PlayerName && info.Settings.SaveType == 1) {
        const mydocs = readRegistryStringAndExpand('HKCU', 'Software/Microsoft/Windows/CurrentVersion/Explorer/User Shell Folders', 'Personal');
        if (mydocs) {
          result.push({
            appid: info.Settings.AppID,
            source: 'ALI213',
            data: {
              type: 'file',
              path: path.join(mydocs, `VALVE/${info.Settings.AppID}/${info.Settings.PlayerName}/Stats`),
            },
          });
        }
      } else if (info.Settings.AppID && !info.Settings.SaveType) {
        let dirpath = await parentFind(
          async (directory) => {
            let has = await parentFind.exists(path.join(directory, 'Profile/Stats'));
            return has && directory;
          },
          { cwd: dir, type: 'directory' }
        );

        if (dirpath) {
          result.push({
            appid: info.Settings.AppID,
            source: 'ALI213',
            data: {
              type: 'file',
              path: path.join(dirpath, 'Profile/Stats'),
            },
          });
        }
      }
    } else if ((file === 'ds.ini' || file === 'hlm.ini' || file === 'steam_api.ini') && info.GameSettings) {
      //Hoodlum - DARKSiDERS - Skidrow(since end of 2019 ?)

      if (info.GameSettings.UserDataFolder === '.' && info.GameSettings.AppId) {
        let dirpath = await parentFind(
          async (directory) => {
            let has = await parentFind.exists(path.join(directory, 'SteamEmu/UserStats'));
            return has && directory;
          },
          { cwd: dir, type: 'directory' }
        );

        if (dirpath) {
          result.push({
            appid: info.GameSettings.AppId,
            source: file === 'ds.ini' ? 'DARKSiDERS' : file === 'hlm.ini' ? 'Hoodlum' : 'Skidrow',
            data: {
              type: 'file',
              path: path.join(dirpath, 'SteamEmu/UserStats'),
            },
          });
        } else {
          dirpath = await parentFind(
            async (directory) => {
              let has = await parentFind.exists(path.join(directory, 'SteamEmu'));
              return has && directory;
            },
            { cwd: dir, type: 'directory' }
          );

          if (dirpath) {
            result.push({
              appid: info.GameSettings.AppId,
              source: file === 'ds.ini' ? 'DARKSiDERS' : file === 'hlm.ini' ? 'Hoodlum' : 'Skidrow',
              data: {
                type: 'file',
                path: path.join(dirpath, 'SteamEmu'),
              },
            });
          } else if (file === 'hlm.ini') {
            //Hoodlum using ALI213 like emu (before ~ september 2019 ?)
            //User reported that setting it to mydocs has no effect. But should be double confirmed.
            //Seems to be using defaults: playerName VALVE and saveType 0

            dirpath = await parentFind(
              async (directory) => {
                let has = await parentFind.exists(path.join(directory, 'Profile/VALVE/Stats'));
                return has && directory;
              },
              { cwd: dir, type: 'directory' }
            );

            if (dirpath) {
              result.push({
                appid: info.GameSettings.AppId,
                source: 'Hoodlum',
                data: {
                  type: 'file',
                  path: path.join(dirpath, 'Profile/VALVE/Stats'),
                },
              });
            }
          }
        }
      } else if (
        info.GameSettings.UserDataFolder === 'mydocs' &&
        info.GameSettings.AppId &&
        info.GameSettings.UserName &&
        info.GameSettings.UserName !== ''
      ) {
        const mydocs = readRegistryStringAndExpand('HKCU', 'Software/Microsoft/Windows/CurrentVersion/Explorer/User Shell Folders', 'Personal');
        if (mydocs) {
          let dirpath = path.join(mydocs, info.GameSettings.UserName, info.GameSettings.AppId, 'SteamEmu');

          result.push({
            appid: info.GameSettings.AppId,
            source: file === 'ds.ini' ? 'DARKSiDERS' : file === 'hlm.ini' ? 'Hoodlum' : 'Skidrow',
            data: {
              type: 'file',
              path: (await ffs.exists(path.join(dirpath, 'UserStats'))) ? path.join(dirpath, 'UserStats') : dirpath,
            },
          });
        }
      }
    } else if (file === 'steam_api.ini' && info.Settings) {
      //Catherine

      if (info.Settings.AppId && info.Settings.SteamID) {
        let dirpath = await parentFind(
          async (directory) => {
            let has = await parentFind.exists(path.join(directory, `SteamProfile/${info.Settings.SteamID}`));
            return has && directory;
          },
          { cwd: dir, type: 'directory' }
        );

        if (dirpath) {
          result.push({
            appid: info.Settings.AppId,
            data: {
              type: 'file',
              path: path.join(dirpath, `SteamProfile/${info.Settings.SteamID}`),
            },
          });
        }
      }
    } else if (file === 'tenoke.ini') {
      if (info.TENOKE && info.TENOKE.id) {
        let steamDataDir = path.join(dir, 'SteamData');
        if (!fs.existsSync(steamDataDir)) {
          // Unreal Engine titles keep tenoke.ini at the game root but the SteamData folder nested
          // deeper (e.g. <game>/<Name>/Binaries/Win64/SteamData) — locate it instead of assuming
          // it sits next to the cfg (issue #12). Bounded depth keeps the search cheap.
          const found = await glob('**/SteamData', { cwd: dir, onlyDirectories: true, absolute: true, deep: 6, suppressErrors: true });
          if (found.length > 0) steamDataDir = found[0];
        }
        result.push({
          appid: info.TENOKE.id.split('#')[0].trim(),
          data: { type: 'file', path: steamDataDir },
        });
      }
    } else if (file === 'UniverseLAN.ini') {
      if (info.GameSettings && info.GameSettings.AppID)
        result.push({ appid: info.GameSettings.AppID, data: { type: 'file', path: path.join(dir, 'UniverseLANData') } });
    }
  } catch (err) {
    /*Do nothing*/
    console.warn(err);
  }

  return result;
};
