'use strict';

const path = require('path');
const appPath = path.join(__dirname, '../');
const ini = require('../util/ini');
const parentFind = require('../util/findUp');
const glob = require('fast-glob');
const fs = require('fs');
const { readRegistryStringAndExpand } = require('../util/reg');
const saveRoots = require(path.join(appPath, 'parser/saveRoots.js'));

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
  // CODEX/RUNE and the CPY variant. Their default save root (%PUBLIC%\Documents\Steam\<SOURCE>) is
  // already scanned, but a PORTABLE release never writes there: it keeps that same tree inside the
  // game folder instead, so nothing was discovered and the game was absent from the library
  // entirely - no card, no 0% entry, indistinguishable from a game that was never installed.
  'steam_emu.ini',
  'cpy.ini',
];

// Scene-emulator save roots, relative to the folder holding the emulator config. A portable release
// keeps the same layout it would otherwise write to %PUBLIC%\Documents\Steam, so these are the
// shapes actually seen on disk, most specific first.
const PORTABLE_SCENE_SAVE_DIRS = [
  path.join('Steam', 'RUNE'),
  path.join('Steam', 'CODEX'),
  path.join('Steam', 'CPY'),
  path.join('Documents', 'Steam', 'RUNE'),
  path.join('Documents', 'Steam', 'CODEX'),
  'RUNE',
  'CODEX',
  'SteamEmu',
  'Saves',
  'Save',
];

// The unlock-state files steam.getAchievementsFromFile() knows how to read. Used to tell a real save
// folder from a folder that merely happens to be named right.
const SCENE_SAVE_FILES = ['achievements.ini', 'achievements.json', 'Achievements.ini', 'stats.ini', 'achiev.ini', 'user_stats.ini'];

function hasSceneSaveFile(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return SCENE_SAVE_FILES.some((name) => {
    try {
      return fs.statSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

/*
  Where a portable CODEX/RUNE release keeps its unlock state, for `appid`.

  `dir` is the folder holding steam_emu.ini / cpy.ini. Every known layout is probed with the appid
  folder appended and again without it, and a candidate only wins if it actually holds one of the
  save files the Steam parser can read. `%PUBLIC%\Documents\Steam\<SOURCE>\<appid>` is checked last so
  a normally-installed copy still resolves through this path.

  Returns { path, source } for the folder found, or null.
*/
function findSceneSaveDir(dir, appid) {
  if (!dir || !appid) return null;
  const candidates = [];
  const push = (base, source) => {
    if (!base) return;
    candidates.push({ path: path.join(base, String(appid)), source });
    candidates.push({ path: base, source });
  };
  for (const relative of PORTABLE_SCENE_SAVE_DIRS) {
    push(path.join(dir, relative), /rune/i.test(relative) ? 'Rune' : /codex/i.test(relative) ? 'Codex' : 'Steam-emulator');
  }
  push(dir, 'Steam-emulator');
  for (const root of saveRoots.defaultSteamEmuSaveRoots({ existingOnly: true })) {
    push(root, /rune/i.test(root) ? 'Rune' : /codex/i.test(root) ? 'Codex' : 'Steam-emulator');
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const key = path.resolve(candidate.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (hasSceneSaveFile(candidate.path)) return candidate;
  }
  return null;
}

function isProbableAppIdFolderName(name) {
  const value = String(name || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(value)) return false;
  if (/^7656\d{13}$/.test(value)) return false; // SteamID64 user folder, not a game appid.
  if (/^\d{12,}$/.test(value)) return false;
  if (value.length < 6 && /[a-f]/i.test(value)) return false;
  return true;
}

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
  return (await module.exports.getEntries()).filter((entry) => entry.enabled !== false);
};

module.exports.getEntries = async () => {
  try {
    if (!fs.existsSync(file)) {
      await this.save([]);
      return [];
    }
    const raw = fs.readFileSync(file, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => (typeof entry === 'string' ? { path: entry, notify: true, origin: 'manual', enabled: true } : { ...entry, notify: true }))
        .map((entry) => ({ ...entry, origin: entry.origin === 'auto' ? 'auto' : 'manual', enabled: entry.enabled !== false }))
        .filter((entry) => entry.path);
    } catch (parseErr) {
      // Genuine corruption (e.g. a write interrupted by a crash/power loss). A transient I/O lock
      // throws before JSON.parse and is handled by the outer catch - so we never quarantine a good
      // file just because antivirus/the indexer held it open for a moment.
      quarantineCorruptConfig(file, parseErr);
      try { await this.save([]); } catch {}
      return [];
    }
  } catch (err) {
    // I/O error (file locked, permission issue, …) - degrade to empty without destroying the file.
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
  return (await module.exports.findEntries()).map((entry) => entry.path);
};

module.exports.findEntries = async () => {
  try {
    const result = [];
    const addDetected = (dir, detector) => {
      if (!dir) return;
      const key = path.normalize(String(dir)).toLowerCase();
      if (result.some((item) => path.normalize(item.path).toLowerCase() === key)) return;
      result.push({ path: dir, notify: true, origin: 'auto', enabled: true, detector });
    };
    for (const dir of saveRoots.defaultSteamEmuSaveRoots({ existingOnly: true, expandProgramDataSteam: true })) {
      addDetected(dir, 'Known achievement-data location');
    }

    // Console-emulator data has a few stable per-user locations. Portable emulator binaries are
    // searched only inside already recognised game libraries, never across an entire drive.
    for (const dir of [
      process.env.APPDATA && path.join(process.env.APPDATA, 'rpcs3'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'shadPS4'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'xenia'),
    ]) {
      try {
        if (dir && fs.statSync(dir).isDirectory()) addDetected(dir, 'Known emulator data location');
      } catch {}
    }
    const search = ['rpcs3.exe', 'shadPS4.exe', 'shadps4.exe', 'xenia.exe', 'xenia_canary.exe'].map((name) => `**/${name}`);
    for (const root of await saveRoots.discoverLibraryRoots()) {
      for (const filepath of await glob(search, { cwd: root, deep: 3, onlyFiles: true, absolute: true, suppressErrors: true })) {
        addDetected(path.parse(filepath).dir, 'Supported emulator in detected library');
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

    // Goldberg SocialClub Emu Saves keeps game folders named after the game (GTA V, RDR2, …) with
    // hex profile subfolders - there is no numeric AppID and no emulator .ini to match. Accept the
    // root, a game folder or a profile folder explicitly (issue #9).
    const socialclub = require('./socialclub.js');
    if (socialclub.isSocialClubPath(dirpath)) return (result = true);

    //check for appID folder(s). Some emulators use hex ids; reject obvious user-id/noise folders.
    let scan = await glob('*', { cwd: dirpath, onlyDirectories: true, deep: 1, suppressErrors: true });
    if (scan.some(isProbableAppIdFolderName)) return (result = true);

    // Accept parent community roots like Public\Documents\Steam when the real appid folders are inside
    // RUNE/CODEX. Users commonly add the parent from guides, while AW scans the concrete child source.
    const expandedRoots = saveRoots.expandKnownSteamSourceRoots(dirpath).filter((root) => path.resolve(root) !== path.resolve(dirpath));
    for (const root of expandedRoots) {
      const nested = await glob('*', { cwd: root, onlyDirectories: true, deep: 1, suppressErrors: true });
      if (nested.some(isProbableAppIdFolderName)) return (result = true);
    }

    scan = await glob('*.{ini,exe}', { cwd: dirpath, onlyFiles: true });
    for (let file of scan) if (accepted_files.some((filename) => filename === file)) return (result = true);

    // Some GOG/UniverseLAN and repack layouts keep the config below the selected game root
    // (for example <Game>/Engine/Binaries/.../UniverseLAN.ini). Accept that root, then scan()
    // will resolve the real config folder at low depth.
    scan = await glob(steam_emu_cfg_file_supported.map((name) => `**/${name}`), { cwd: dirpath, onlyFiles: true, deep: 4, suppressErrors: true });
    if (scan.length > 0) return (result = true);

    return result;
  } catch (err) {
    throw err;
  }
};

/*
  Emulator configs kept below the selected folder: one per game under a library root, or a repack
  that buries its config a few levels down (<Game>/Engine/Binaries/.../UniverseLAN.ini). Each config
  folder is scanned as if the user had picked it directly.
*/
async function scanBelow(dir) {
  const nested = await glob(steam_emu_cfg_file_supported.map((name) => `**/${name}`), {
    cwd: dir,
    onlyFiles: true,
    absolute: true,
    deep: 4,
    suppressErrors: true,
  });
  const result = [];
  const seen = new Set([path.resolve(dir).toLowerCase()]);
  for (const filepath of nested) {
    // fast-glob returns posix separators even on Windows, and this path is handed on as the game
    // folder: resolve it so every record carries a native path.
    const cfgDir = path.resolve(path.parse(filepath).dir);
    const key = cfgDir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(...(await module.exports.scan(cfgDir)));
  }
  return result;
}

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
    /*
      No emulator config at the top of the selected folder. That is the ordinary case when the user
      adds their games LIBRARY rather than one game folder - and check() accepts such a folder
      precisely because of the configs sitting below it, so scan() has to look in the same place.
      Returning empty here is what left a portable release with no library entry at all (issue #32):
      the folder was accepted, then read as holding nothing.
    */
    if (!info) return await scanBelow(dir);

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
          // deeper (e.g. <game>/<Name>/Binaries/Win64/SteamData) - locate it instead of assuming
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
    } else if (file === 'steam_emu.ini' || file === 'cpy.ini') {
      /*
        CODEX / RUNE / CPY. Section and key casing vary between builds and between the releases of a
        single group, so the appid is read case-insensitively from whatever section carries it rather
        than from one hard-coded path (issue #32).
      */
      let appid = '';
      for (const section of Object.values(info || {})) {
        if (!section || typeof section !== 'object') continue;
        for (const [key, value] of Object.entries(section)) {
          if (!/^app_?id$/i.test(key)) continue;
          const digits = String(value).match(/\d+/);
          if (digits) {
            appid = digits[0];
            break;
          }
        }
        if (appid) break;
      }
      if (appid) {
        const found = findSceneSaveDir(dir, appid);
        /*
          A game with no save folder yet is still added, pointing at the layout this release would
          write to. steam.getAchievementsFromFile() treats a missing file as a plain 0% game, so the
          card appears with its full achievement list all locked - which is the whole point: a
          missing card is indistinguishable from a game that was never installed and tells the user
          nothing, while a 0% card says "found, nothing unlocked yet" and starts being watched.
        */
        const fallback = path.join(dir, 'Steam', 'RUNE', appid);
        result.push({
          appid,
          source: found ? found.source : 'Steam-emulator',
          data: { type: 'file', path: found ? found.path : fallback, gameDir: dir },
        });
      }
    }

    if (result.length === 0) result.push(...(await scanBelow(dir)));
  } catch (err) {
    /*Do nothing*/
    console.warn(err);
  }

  return result;
};

// Exposed so the library scan can point a scene-emulator game at the folder its release actually
// writes to, instead of the %APPDATA% root that only the Goldberg family uses.
module.exports.findSceneSaveDir = findSceneSaveDir;
