'use strict';

const path = require('path');
const ini = require('./util/ini');
const parentFind = require('./util/findUp');
const omit = require('lodash.omit');
const fs = require('./util/fsAsync');
const sse = require('./sse.js');
const { scanRootOnce } = require('./util/rootCascade.js');
const { SOCIALCLUB_ACHIEVEMENT_FILES } = require('./util/socialClub.js');

// A user-added folder belongs to the Goldberg SocialClub emulator when the SocialClub root is on
// its path — the root itself, a <Game> folder, or a <Game>\<hex profile> folder. Guessing from the
// folder's shape instead would be wrong: a plain numeric Steam AppID folder such as "1546990" is
// also valid hexadecimal, and would be watched with the wrong parser (issue #9).
const SOCIALCLUB_ROOT_RE = /^goldberg\s*social\s*club\s*emu\s*saves$/i;
function isSocialClubWatchPath(dirPath) {
  return String(dirPath || '')
    .split(/[\\/]+/)
    .some((segment) => SOCIALCLUB_ROOT_RE.test(segment));
}

// regodit is ESM-only (koffi) since v2; load it lazily via dynamic import (cached by Node's module
// registry). We deliberately use the synchronous API, not `regodit/promises`: under the pinned
// koffi 3.x the async DWORD write segfaults (0xC0000005) and kills the Watchdog. The sync calls
// on the same DLL are unaffected, and the reads here run once per startup.
let regeditPromise = null;
const loadRegedit = () => regeditPromise || (regeditPromise = import('regodit'));

const files = {
  achievement: [
      'achievements.ini',
      'achievements.json',
      'achiev.ini',
      'stats.ini',
      'Achievements.Bin',
      'achieve.dat',
      'Achievements.ini',
      'stats.bin',
      'user_stats.ini',
      'stats.json',
  ],
  steamEmu: ['ALI213.ini', 'valve.ini', 'hlm.ini', 'ds.ini', 'steam_api.ini', 'SteamConfig.ini', 'tenoke.ini', 'UniverseLAN.ini'],
};

module.exports.getFolders = async (userDir_file) => {
  let configuredDirs = [];
  try {
    const parsed = JSON.parse(await fs.readFile(userDir_file, 'utf8'));
    if (Array.isArray(parsed)) configuredDirs = parsed;
  } catch {
    configuredDirs = [];
  }
  let steamEmu = [
    {
      dir: path.join(process.env['Public'], 'Documents/Steam/CODEX'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
    {
      dir: path.join(process.env['Public'], 'Documents/Steam/RUNE'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
    {
      dir: path.join(process.env['Public'], 'Documents/Steam/RLD!'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[2], files.achievement[4], files.achievement[6]] },
    },
    {
      dir: path.join(process.env['Public'], 'Documents/OnlineFix'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'Steam/CODEX'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'Steam/RLD!'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[2], files.achievement[4], files.achievement[6]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'Goldberg SteamEmu Saves'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[1], files.achievement[9], files.achievement[0]] }, //keeping "achievements.ini" [0] for backward compatibility with custom goldberg emu build
    },
    {
      dir: path.join(process.env['APPDATA'], 'GSE Saves'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[1], files.achievement[9], files.achievement[0]] }, //keeping "achievements.ini" [0] for backward compatibility with custom goldberg emu build
    },
    {
      // Goldberg SocialClub Emu Saves: <GameName>\<hex profile>\… The profile folder carries the
      // game's save/achievement files; the game name is resolved back to the app's SocialClub entry
      // through the game index (watchdog.js handles options.socialClub).
      dir: path.join(process.env['APPDATA'], 'Goldberg SocialClub Emu Saves'),
      // The directory layout is <GameName>\<hex profile>\…, so unlike the Steam emulator roots the
      // filter must accept game-name folders as well as profile folders — a numeric-AppID filter
      // would never match anything here. `file` is restricted to the achievement files the parser
      // can actually read: Rockstar's own save blobs are written constantly during play and nothing
      // can decode them, so watching them would only wake the monitor for nothing (issue #9).
      options: { recursive: true, filter: () => true, file: SOCIALCLUB_ACHIEVEMENT_FILES, socialClub: true },
    },
    {
      // Goldberg Uplay R2. Folders here are named with the UBISOFT product id, not a Steam AppID,
      // so watchdog.js maps it through the gameIndex `uplayId` pair before loading the game and
      // re-keys the objective ids onto the schema's api-names. Without this entry a Ubisoft unlock
      // never fired a live notification at all — it only showed up on the next manual refresh.
      dir: path.join(process.env['APPDATA'], 'Goldberg UplayEmu Saves'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[1]], uplayR2: true },
    },
    {
      dir: path.join(process.env['APPDATA'], 'EMPRESS'),
      options: { recursive: true, filter: /([0-9]+)\\remote\\([0-9]+)/, file: [files.achievement[1]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'CreamAPI'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
    {
      dir: path.join(process.env['Public'], 'Documents/EMPRESS'),
      options: { recursive: true, filter: /([0-9]+)\\remote\\([0-9]+)/, file: [files.achievement[1]] },
    },
    {
      dir: path.join(process.env['PROGRAMDATA'], 'Steam'),
      options: {
        disableCheckIfProcessIsRunning: true,
        disableCheckTimestamp: true,
        recursive: true,
        filter: /([0-9]+)\\stats/,
        file: [files.achievement[0]],
      },
      //3DM doesn't need override (disableCheckIfProcessIsRunning,disableCheckTimestamp) ...
    },
    {
      dir: path.join(process.env['LOCALAPPDATA'], 'SKIDROW'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[5]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'SmartSteamEmu'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[7]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'NemirtingasEpicEmu', '*/*/'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[1]] },
    },
    {
      dir: path.join(process.env['APPDATA'], 'NemirtingasGalaxyEmu', '*/*/'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[1]] },
    },
    {
      dir: path.join(process.env['LOCALAPPDATA'], 'anadius', 'LSX emu', 'achievement_watcher'),
      options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[0]] },
    },
  ];

  try {
    const regedit = await loadRegedit();
    const mydocs = regedit.regQueryStringValueAndExpand(
      'HKCU',
      'Software/Microsoft/Windows/CurrentVersion/Explorer/User Shell Folders',
      'Personal'
    );
    if (mydocs) {
      steamEmu = steamEmu.concat([
        {
          dir: path.join(mydocs, 'SKIDROW'),
          options: { recursive: true, filter: /([0-9]+)/, file: [files.achievement[5]] },
        },
      ]);
    }

    for (let dir of configuredDirs) {
      if (dir && dir.notify == true && dir.enabled !== false) {
        try {
          let info;
          for (var file of files.steamEmu) {
            try {
              info = ini.parse(await fs.readFile(path.join(dir.path, file), 'utf8'));
              break;
            } catch (e) {}
          }
          if (info) {
            if ((file === files.steamEmu[0] || file === files.steamEmu[1] || file === files.steamEmu[5]) && info.Settings) {
              //ALI213
              if (info.Settings.AppID && info.Settings.PlayerName && info.Settings.SaveType == 0) {
                let dirpath = await parentFind(
                  async (directory) => {
                    let has = await parentFind.exists(path.join(directory, `Profile/${info.Settings.PlayerName}/Stats`));
                    return has && directory;
                  },
                  { cwd: dir.path, type: 'directory' }
                );

                if (dirpath)
                  steamEmu.push({
                    dir: path.join(dirpath, `Profile/${info.Settings.PlayerName}/Stats`),
                    options: { appid: info.Settings.AppID, recursive: false, file: [files.achievement[4]] },
                  });
              } else if (info.Settings.AppID && info.Settings.PlayerName && info.Settings.SaveType == 1) {
                if (mydocs)
                  steamEmu.push({
                    dir: path.join(mydocs, `VALVE/${info.Settings.AppID}/${info.Settings.PlayerName}/Stats`),
                    options: { appid: info.Settings.AppID, recursive: false, file: [files.achievement[4]] },
                  });
              } else if (info.Settings.AppID && !info.Settings.SaveType) {
                let dirpath = await parentFind(
                  async (directory) => {
                    let has = await parentFind.exists(path.join(directory, 'Profile/Stats'));
                    return has && directory;
                  },
                  { cwd: dir.path, type: 'directory' }
                );

                if (dirpath)
                  steamEmu.push({
                    dir: path.join(dirpath, 'Profile/Stats'),
                    options: { appid: info.Settings.AppID, recursive: false, file: [files.achievement[4]] },
                  });
              }
            } else if ((file === files.steamEmu[3] || file === files.steamEmu[2] || file === files.steamEmu[4]) && info.GameSettings) {
              //Hoodlum - DARKSiDERS - Skidrow(since end of 2019 ?)

              if (info.GameSettings.UserDataFolder === '.' && info.GameSettings.AppId) {
                let dirpath = await parentFind(
                  async (directory) => {
                    let has = await parentFind.exists(path.join(directory, 'SteamEmu/UserStats'));
                    return has && directory;
                  },
                  { cwd: dir.path, type: 'directory' }
                );

                if (dirpath) {
                  steamEmu.push({
                    dir: path.join(dirpath, 'SteamEmu/UserStats'),
                    options: { appid: info.GameSettings.AppId, recursive: false, file: [files.achievement[2]] },
                  });
                } else {
                  dirpath = await parentFind(
                    async (directory) => {
                      let has = await parentFind.exists(path.join(directory, 'SteamEmu'));
                      return has && directory;
                    },
                    { cwd: dir.path, type: 'directory' }
                  );

                  if (dirpath) {
                    steamEmu.push({
                      dir: path.join(dirpath, 'SteamEmu'),
                      options: { appid: info.GameSettings.AppId, recursive: false, file: [files.achievement[3]] },
                    });
                  } else if (file === files.steamEmu[2]) {
                    //Hoodlum using ALI213 like emu (before ~ september 2019 ?)
                    //User reported that setting it to mydocs has no effect. But should be double confirmed.
                    //Seems to be using defaults: playerName VALVE and saveType 0
                    //Write ach data only on game exit ?

                    dirpath = await parentFind(
                      async (directory) => {
                        let has = await parentFind.exists(path.join(directory, 'Profile/VALVE/Stats'));
                        return has && directory;
                      },
                      { cwd: dir.path, type: 'directory' }
                    );

                    if (dirpath) {
                      steamEmu.push({
                        dir: path.join(dirpath, 'Profile/VALVE/Stats'),
                        options: {
                          appid: info.GameSettings.AppId,
                          disableCheckIfProcessIsRunning: true,
                          disableCheckTimestamp: true,
                          recursive: false,
                          file: [files.achievement[4]],
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
                if (mydocs) {
                  let dirpath = path.join(mydocs, info.GameSettings.UserName, info.GameSettings.AppId, 'SteamEmu');

                  if (await fs.exists(path.join(dirpath, 'UserStats/achiev.ini'))) {
                    steamEmu.push({
                      dir: path.join(dirpath, 'UserStats'),
                      options: { appid: info.GameSettings.AppId, recursive: false, file: [files.achievement[2]] },
                    });
                  } else {
                    steamEmu.push({
                      dir: dirpath,
                      options: { appid: info.GameSettings.AppId, recursive: false, file: [files.achievement[3]] },
                    });
                  }
                }
              }
            } else if (file === files.steamEmu[4] && info.Settings) {
              //Catherine
              if (info.Settings.AppId && info.Settings.SteamID) {
                let dirpath = await parentFind(
                  async (directory) => {
                    let has = await parentFind.exists(path.join(directory, `SteamProfile/${info.Settings.SteamID}`));
                    return has && directory;
                  },
                  { cwd: dir.path, type: 'directory' }
                );

                if (dirpath)
                  steamEmu.push({
                    dir: path.join(dirpath, `SteamProfile/${info.Settings.SteamID}`),
                    options: { appid: info.Settings.AppId, recursive: false, file: [files.achievement[6]] },
                  });
              }
            } else if (file === files.steamEmu[6]) {
              //TENOKE
              steamEmu.push({
                dir: path.join(dir.path, 'SteamData'),
                options: { appid: info.TENOKE.id.split('#')[0].trim(), recursive: false, file: [files.achievement[8]] },
              });
            } else if (file === files.steamEmu[7]) {
              //UniverseLAN
              steamEmu.push({
                dir: path.join(dir.path, 'UniverseLANData'),
                options: { appid: info.GameSettings.AppID, recursive: false, file: [files.achievement[6]] },
              });
            }
          } else if (isSocialClubWatchPath(dir.path)) {
            steamEmu.push({
              dir: dir.path,
              options: { recursive: true, filter: () => true, file: SOCIALCLUB_ACHIEVEMENT_FILES, socialClub: true },
            });
          } else {
            // Folders that do not match a known emulator config are classified
            // by file signature. Only platforms without a dedicated live
            // watcher are added here (GOG .info, UniverseLAN); the generic
            // numeric fallback stays for everything else.
            const cascade = await scanRootOnce(dir.path).catch(() => null);
            const extra = cascade && cascade.entries
              ? cascade.entries.filter((entry) => {
                  const emu = String(entry && entry.options && entry.options.emu || '');
                  return emu === 'gog' || emu === 'universe-lan';
                })
              : [];
            if (extra.length) {
              for (const entry of extra) steamEmu.push(entry);
            } else {
              steamEmu.push({ dir: dir.path, options: { recursive: true, filter: /([0-9]+)/, file: files.achievement } });
            }
          }
        } catch (err) {
          /*Do nothing*/
        }
      }
    }
  } catch (err) {
    /*Do nothing*/
  }

  const disabled = configuredDirs
    .filter((entry) => entry && entry.enabled === false && entry.path)
    .map((entry) => path.resolve(String(entry.path)).toLowerCase());
  if (!disabled.length) return steamEmu;
  return steamEmu.filter((entry) => {
    const candidate = path.resolve(String(entry && entry.dir || '')).toLowerCase();
    return !disabled.some((root) => candidate === root || candidate.startsWith(root + path.sep));
  });
};

module.exports.parse = async (filePath) => {
  try {
    const filter = ['SteamAchievements', 'Steam64', 'Steam'];

    let local;
    let file = path.parse(filePath);
    if (file.ext == '.json') {
      local = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } else if (file.base == 'stats.bin') {
      local = sse.parse(await fs.readFile(filePath));
    } else {
      local = ini.parse(await fs.readFile(filePath, 'utf8'));
    }

    if (local.AchievementsUnlockTimes && local.Achievements) {
      //hoodlum
      let convert = {};
      for (let i in local.Achievements) {
        if (Object.prototype.hasOwnProperty.call(local.Achievements, i)) {
          if (local.Achievements[i] == 1) {
            convert[`${i}`] = { Achieved: '1', UnlockTime: local.AchievementsUnlockTimes[i] || null };
          }
        }
      }
      local = convert;
    } else if (local.State && local.Time) {
      //3DM
      let convert = {};
      for (let i in local.State) {
        if (Object.prototype.hasOwnProperty.call(local.State, i)) {
          if (local.State[i] == '0101') {
            convert[`${i}`] = {
              Achieved: '1',
              UnlockTime: new DataView(new Uint8Array(Buffer.from(local.Time[i].toString(), 'hex')).buffer).getUint32(0, true) || null,
            };
          }
        }
      }
      local = convert;
    } else if (local.ACHIEVEMENTS) {
      //TENOKE
      let convert = {};
      for (let i in local.ACHIEVEMENTS) {
        if (!Object.prototype.hasOwnProperty.call(local.ACHIEVEMENTS, i)) continue;
        const key = i.replace(/^"|"$/g, '');
        const raw = local.ACHIEVEMENTS[i]; // e.g. "{unlocked=true, time=1712253396}"
        const unlockedMatch = /unlocked\s*=\s*(true|false)/i.exec(raw);
        const timeMatch = /time\s*=\s*(\d+)/i.exec(raw);

        const unlocked = unlockedMatch ? unlockedMatch[1].toLowerCase() === 'true' : false;
        const time = timeMatch ? Number(timeMatch[1]) : 0;

        convert[`${key}`] = {
          Achieved: unlocked ? '1' : '0',
          UnlockTime: time,
        };
      }
      local = convert;
    } else {
      local = omit(local.ACHIEVE_DATA || local, filter);
    }

    let achievements = [];

    for (let achievement in local) {
      if (Object.prototype.hasOwnProperty.call(local, achievement)) {
        try {
          if (local[achievement].State) {
            //RLD!
            //uint32 little endian
            local[achievement].State = new DataView(new Uint8Array(Buffer.from(local[achievement].State.toString(), 'hex')).buffer).getUint32(
              0,
              true
            );
            local[achievement].CurProgress = new DataView(
              new Uint8Array(Buffer.from(local[achievement].CurProgress.toString(), 'hex')).buffer
            ).getUint32(0, true);
            local[achievement].MaxProgress = new DataView(
              new Uint8Array(Buffer.from(local[achievement].MaxProgress.toString(), 'hex')).buffer
            ).getUint32(0, true);
            local[achievement].Time = new DataView(new Uint8Array(Buffer.from(local[achievement].Time.toString(), 'hex')).buffer).getUint32(0, true);
          }

          let result = {
            name: local[achievement].id || local[achievement].apiname || local[achievement].name || local[achievement].AchievementId || achievement,
            Achieved:
              local[achievement].Achieved == 1 ||
              local[achievement].achieved == 1 ||
              local[achievement].State == 1 ||
              local[achievement].HaveAchieved == 1 ||
              local[achievement].Unlocked == 1 ||
              local[achievement].unlocked == 1 ||
              local[achievement].earned ||
              local[achievement] === '1'
                ? true
                : false,
            CurProgress: local[achievement].CurProgress || local[achievement].progress || local[achievement].value || local[achievement].Value || 0,
            MaxProgress: local[achievement].MaxProgress || local[achievement].max_progress || 0,
            UnlockTime:
              local[achievement].UnlockTime ||
              local[achievement].unlocktime ||
              local[achievement].unlock_time ||
              local[achievement].HaveAchievedTime ||
              local[achievement].HaveHaveAchievedTime ||
              local[achievement].Time ||
              local[achievement].earned_time ||
              0,
          };

          if (
            (!result.Achieved && result.MaxProgress != 0 && result.CurProgress != 0 && result.MaxProgress == result.CurProgress) ||
            (result.UnlockTime && +result.UnlockTime !== '0')
          ) {
            //CODEX Gears5 (09/2019)  && Gears tactics (05/2020) && Nemirtingas Galaxy/Epic Emu
            result.Achieved = true;
          }

          if (local[achievement].crc) {
            result.crc = local[achievement].crc;
          }

          achievements.push(result);
        } catch (e) {}
      }
    }

    achievements.sort((a, b) => {
      return b.UnlockTime - a.UnlockTime;
    });

    return achievements;
  } catch (err) {
    throw err;
  }
};
