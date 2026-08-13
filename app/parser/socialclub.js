'use strict';

// Read Goldberg SocialClub saves under <GameName>/<profile-id>.
// The parser uses stable socialclub-* ids and maps known titles to Steam metadata.

const path = require('path');
const fs = require('fs');
const glob = require('fast-glob');

const appPath = __dirname;
const steam = require(path.join(appPath, 'steam.js'));

let debug = { log() {}, warn() {}, error() {} };

module.exports.initDebug = ({ isDev, userDataPath }) => {
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

const ROOT_NAME_RE = /^goldberg\s*social\s*club\s*emu\s*saves$/i;
// Profile folders are emulator-generated hex ids (e.g. 0F74F4C4). Cap the length and exclude
// long all-digit ids (SteamID64 / appid-like folders) so the SocialClub check never claims an
// unrelated numeric save root.
const HEX_PROFILE_RE = /^[0-9a-fA-F]{6,12}$/;

// Achievement file names shared with the Steam emulator pipeline (steam.getAchievementsFromFile).
const ACHIEVEMENT_FILE_GLOB = [
  'achievements.ini',
  'achievements.json',
  'achiev.ini',
  'stats.ini',
  'Achievements.Bin',
  'achieve.dat',
  'achievement.dat',
  'achievements.dat',
  'accomplishments.json',
  'accomplishments.dat',
  'awards.json',
  'awards.dat',
  'Achievements.ini',
  'stats.bin',
  'user_stats.ini',
  'stats.json',
  'stats/achievements.ini',
  'SteamEmu/UserStats/achiev.ini',
];

// Files the Goldberg SocialClub Emulator writes into each profile folder (confirmed from the
// emulator's own strings): the profile settings blob and the game's Rockstar save files
// (SGTA50000 for GTA V, SRDR* for RDR2, etc.). Their presence identifies a real SocialClub game
// folder even before any readable achievement file exists.
const ROCKSTAR_PROFILE_MARKERS = ['cfg.dat', 'local_save.txt', 'pc_settings.bin', 'settings.xml', 'profile.dat', 'players.dat'];
const ROCKSTAR_SAVE_FILE_RE = /^(SGTA|SRDR|CGTA|GTAV|RDR|GTASA|GTAVC|GTA3|PGTA)[0-9A-Za-z_]*$/i;

// Offline name → Steam appid for the Rockstar titles the SocialClub emulator is actually used with.
// The fuzzy Steam app-list lookup is the fallback for anything not listed here.
const ROCKSTAR_STEAM_APPIDS = new Map([
  ['gta v', 271590],
  ['grand theft auto v', 271590],
  ['gta iv', 12210],
  ['gta 4', 12210],
  ['grand theft auto iv', 12210],
  ['gta iii', 12100],
  ['grand theft auto iii', 12100],
  ['gta san andreas', 12120],
  ['grand theft auto san andreas', 12120],
  ['gta vice city', 12110],
  ['grand theft auto vice city', 12110],
  ['gta vice city definitive edition', 1546990],
  ['grand theft auto vice city definitive edition', 1546990],
  ['gta san andreas definitive edition', 1546980],
  ['grand theft auto san andreas definitive edition', 1546980],
  ['gta iii definitive edition', 1547000],
  ['grand theft auto iii definitive edition', 1547000],
  ['grand theft auto the trilogy definitive edition', 1546970],
  ['red dead redemption 2', 1174180],
  ['rdr2', 1174180],
  ['max payne 3', 204100],
  ['la noire', 110800],
  ['l.a. noire', 110800],
  ['bully', 12200],
  ['bully scholarship edition', 12200],
]);

function defaultRoot() {
  return process.env['APPDATA'] ? path.join(process.env['APPDATA'], 'Goldberg SocialClub Emu Saves') : '';
}

function isSocialClubRootName(dir) {
  return ROOT_NAME_RE.test(path.basename(String(dir || '')));
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanGameName(name) {
  const value = String(name || '').trim();
  if (!value || value.startsWith('.')) return '';
  return value;
}

function socialClubAppId(gameName) {
  const slug = normalizeNameKey(gameName).replace(/\s+/g, '-');
  return `socialclub-${slug || 'unknown'}`;
}

async function resolveSteamAppId(gameName) {
  const key = normalizeNameKey(gameName);
  if (ROCKSTAR_STEAM_APPIDS.has(key)) return ROCKSTAR_STEAM_APPIDS.get(key);
  if (steam && typeof steam.findAppidByName === 'function') {
    try {
      const sid = await steam.findAppidByName(gameName);
      if (sid) return Number(sid);
    } catch {
      /* fuzzy lookup is best-effort */
    }
  }
  return null;
}

async function folderHasAchievementData(gameDir) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  try {
    const found = await glob(ACHIEVEMENT_FILE_GLOB.map((f) => `**/${f}`), {
      cwd: gameDir,
      onlyFiles: true,
      deep: 4,
      suppressErrors: true,
    });
    return found.length > 0;
  } catch {
    return false;
  }
}

function folderHasRockstarProfileData(gameDir) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(gameDir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && ROCKSTAR_PROFILE_MARKERS.includes(String(e.name).toLowerCase()))) return true;
  if (entries.some((e) => e.isFile() && ROCKSTAR_SAVE_FILE_RE.test(e.name))) return true;
  const settingsDir = entries.find((e) => e.isDirectory() && String(e.name).toLowerCase() === 'settings');
  if (settingsDir) {
    try {
      const settingsEntries = fs.readdirSync(path.join(gameDir, settingsDir.name), { withFileTypes: true });
      if (settingsEntries.some((f) => f.isFile() && String(f.name).toLowerCase() === 'cfg.dat')) return true;
    } catch {
      /* unreadable settings folder is not a hard proof */
    }
  }
  return entries.some((e) => e.isDirectory() && /^SAVE$/i.test(e.name));
}

function looksLikeProfileDir(dir) {
  const base = path.basename(String(dir || ''));
  return HEX_PROFILE_RE.test(base) && !/^\d{12,}$/.test(base);
}

// A hex-named profile folder that holds nothing at all (issue #11 — "GTA_DEF\0F74F4C4\", both levels
// empty) is not evidence of a real SocialClub game: the emulator only creates that folder shape once
// it has actually written something into it. Bounded depth keeps this cheap for a deep, populated tree.
function isDirEmptyDeep(dir, depth = 3) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  if (entries.length === 0) return true;
  if (depth <= 0) return false;
  return entries.every((e) => (e.isFile() ? false : e.isDirectory() ? isDirEmptyDeep(path.join(dir, e.name), depth - 1) : true));
}

function looksLikeGameFolder(dir) {
  const entries = safeReaddir(dir);
  return entries.some((e) => e.isDirectory() && looksLikeProfileDir(e.name) && !isDirEmptyDeep(path.join(dir, e.name)));
}

function looksLikeSocialClubGameFolder(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  if (looksLikeGameFolder(dir)) return true;
  if (folderHasRockstarProfileData(dir)) return true;
  return hasAchievementFileDirect(dir);
}

function hasAchievementFileDirect(dir) {
  const names = new Set(safeReaddir(dir).filter((e) => e.isFile()).map((e) => e.name.toLowerCase()));
  return ACHIEVEMENT_FILE_GLOB.some((f) => names.has(String(f).toLowerCase()));
}

// Accept the SocialClub root, a game folder, or a profile folder — conservatively OUTSIDE the root:
// hex-looking subfolders alone are not proof (Steam emu roots are full of numeric AppIDs that also
// match), so hard Rockstar profile evidence is required.
function isSocialClubPath(dir) {
  if (!dir) return false;
  const resolved = path.resolve(String(dir));
  const underRoot = resolved.split(/[\\/]+/).some((part) => ROOT_NAME_RE.test(part));
  if (underRoot) {
    try {
      return fs.statSync(resolved).isDirectory();
    } catch {
      // The root itself or a future game folder directly under it is still a valid target before
      // it exists; deeper non-existent paths (e.g. a file under a game folder) are not.
      return isSocialClubRootName(resolved) || isSocialClubRootName(path.dirname(resolved));
    }
  }
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return false;
  } catch {
    return false;
  }
  return folderHasRockstarProfileData(resolved);
}

async function scan(dir) {
  const result = [];
  if (!dir || !fs.existsSync(dir)) return result;
  // Never scan an unrelated save root as if it were Goldberg SocialClub — e.g. SmartSteamEmu,
  // CODEX or OnlineFix would otherwise surface the folder itself as a fake game entry.
  if (!isSocialClubPath(dir)) return result;

  const gameRoots = [];
  if (isSocialClubRootName(dir)) {
    for (const ent of safeReaddir(dir)) {
      if (!ent.isDirectory()) continue;
      // The emulator keeps its own global settings next to the game folders ("settings/"), which
      // is not a game — never surface it as an entry.
      if (String(ent.name).toLowerCase() === 'settings') continue;
      const gameDir = path.join(dir, ent.name);
      if (looksLikeSocialClubGameFolder(gameDir)) gameRoots.push(gameDir);
    }
  } else if (looksLikeProfileDir(dir)) {
    const parent = path.dirname(dir);
    if (parent && parent !== dir) gameRoots.push(parent);
  } else if (looksLikeSocialClubGameFolder(dir)) {
    gameRoots.push(dir);
  } else if ((await folderHasAchievementData(dir)) || folderHasRockstarProfileData(dir)) {
    gameRoots.push(dir);
  }

  for (const gameDir of gameRoots) {
    const gameName = cleanGameName(path.basename(gameDir));
    if (!gameName || isSocialClubRootName(gameDir) || looksLikeProfileDir(gameDir)) continue;
    const hasAchievements = await folderHasAchievementData(gameDir);
    if (!hasAchievements && !folderHasRockstarProfileData(gameDir) && !looksLikeGameFolder(gameDir)) continue;
    result.push({
      appid: socialClubAppId(gameName),
      name: gameName,
      source: 'Goldberg SocialClub',
      data: {
        type: 'socialclub',
        path: gameDir,
        gameName,
      },
    });
    if (!hasAchievements) {
      debug.log(
        `[socialclub] ${gameName}: valid SocialClub profile folder but no readable achievement file — ` +
          'achievements for this Rockstar title may be embedded in its proprietary save files, which no local tracker can decode yet'
      );
    }
    debug.log(`[socialclub] ${gameName} -> ${result[result.length - 1].appid}`);
  }
  return result;
}

// Merge unlock state from every profile folder under the game. A profile only lists the entries it
// has, so union by achievement key: unlocked if any profile unlocked it, earliest unlock time wins.
function mergeAchievementMaps(maps) {
  const merged = new Map();
  for (const map of maps || []) {
    for (const [key, entry] of Object.entries(map || {})) {
      const value = entry && typeof entry === 'object' ? entry : {};
      const norm = String(key).toUpperCase();
      const prev = merged.get(norm);
      const entryUnlocked =
        !!value.Achieved ||
        !!value.achieved ||
        value.State == 1 ||
        !!value.HaveAchieved ||
        !!value.Unlocked ||
        !!value.unlocked ||
        !!value.earned ||
        value === '1';
      const entryTime = value.UnlockTime || value.unlocktime || value.unlock_time || value.earned_time || value.HaveAchievedTime || value.Time || 0;
      if (!prev) {
        merged.set(norm, { ...value, Achieved: entryUnlocked ? 1 : 0, UnlockTime: entryTime });
        continue;
      }
      const achieved = entryUnlocked || !!prev.Achieved;
      const unlockTime =
        entryTime && prev.UnlockTime ? Math.min(Number(entryTime) || 0, Number(prev.UnlockTime) || 0) : entryTime || prev.UnlockTime || 0;
      merged.set(norm, {
        ...prev,
        ...value,
        Achieved: achieved ? 1 : 0,
        UnlockTime: unlockTime,
      });
    }
  }
  return Object.fromEntries(merged);
}

async function getAchievements(appid) {
  const gameDir = appid && appid.data && appid.data.path;
  if (!gameDir || !fs.existsSync(gameDir)) return {};

  const maps = [];
  try {
    const folders = await glob('**/', { cwd: gameDir, onlyDirectories: true, deep: 4, suppressErrors: true });
    const candidates = [gameDir, ...folders.map((f) => path.join(gameDir, f))];
    for (const folder of candidates) {
      try {
        const parsed = await steam.getAchievementsFromFile(folder);
        if (parsed && Object.keys(parsed).length > 0) maps.push(parsed);
      } catch {
        /* folder without a supported achievement file */
      }
    }
  } catch (err) {
    debug.warn(`[socialclub] ${appid && appid.appid} achievement scan failed => ${err}`);
  }
  return mergeAchievementMaps(maps);
}

async function getGameData(appid, lang, option = {}) {
  const gameName =
    (appid && appid.data && appid.data.gameName) ||
    (appid && appid.name) ||
    (appid && appid.data && appid.data.path ? path.basename(appid.data.path) : '') ||
    'Unknown';
  const steamAppId = await resolveSteamAppId(gameName);

  let game = null;
  if (steamAppId) {
    try {
      game = await steam.getGameData({
        appID: steamAppId,
        lang,
      });
    } catch (err) {
      debug.log(`[socialclub] could not load Steam schema for ${gameName} (${steamAppId}) => ${err}`);
    }
  }

  if (!game || !game.name) {
    return {
      appid: appid.appid,
      name: gameName,
      steamappid: steamAppId || undefined,
      source: 'Goldberg SocialClub',
      img: {},
      achievement: { total: 0, unlocked: 0, list: [] },
      installed: true,
      socialClub: true,
    };
  }

  game.appid = appid.appid;
  game.name = game.name || gameName;
  game.steamappid = steamAppId;
  game.source = 'Goldberg SocialClub';
  game.socialClub = true;
  game.installed = true;
  return game;
}

module.exports = {
  initDebug: module.exports.initDebug,
  defaultRoot,
  isSocialClubPath,
  scan,
  getAchievements,
  getGameData,
  _internal: {
    isSocialClubRootName,
    looksLikeGameFolder,
    looksLikeProfileDir,
    socialClubAppId,
    resolveSteamAppId,
    mergeAchievementMaps,
    normalizeNameKey,
  },
};
