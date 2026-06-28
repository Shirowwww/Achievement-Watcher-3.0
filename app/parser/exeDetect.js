'use strict';

/*
  Single source of truth for "which .exe in this game folder is the game?".

  Used by:
    - app/parser/achievements.js  -> seeds the watchdog gameIndex (playtime tracking)
    - app/app.js                  -> resolves the launch target for the Play/Config buttons

  detect(gameDir, gameName, { dllPaths, taken, takenGameDirs }) -> { name, full, size, score } | null

  Strategy: recursively collect every plausible .exe (bounded depth, skipping redist/meta folders and
  hard-excluded utilities), score each by how well its filename matches the game name + its size + a
  bonus for sitting next to the Steam-emulator dll, minus penalties for launcher/loader-style helpers,
  then return the best candidate that isn't already claimed by another game (anti-collision).

  Dependency-free (fs/path only) so it can be unit-tested without Electron.
*/

const fs = require('fs');
const path = require('path');

// Hard-exclude: never a game executable (installers, redists, crash handlers, …).
const EXE_EXCLUDE = [
  /^unins/i,
  /crash/i, // CrashReportClient.exe, UnityCrashHandler64.exe
  /reporter/i,
  /bugreport/i,
  /^setup/i,
  /^install/i,
  /^vcredist/i,
  /^ue[0-9]_?prereq/i,
  /^dxsetup/i,
  /^directx/i,
  /^dotnet/i,
  /^oalinst/i,
  /^7za?$/i,
  /saveconverter/i, // Jackbox per-pack save tool
  /utility/i, // e.g. JackboxUtility.exe — companion tools, not the game
  /decompressor/i,
  /\bcli\b/i, // command-line tools (wabbajack-cli, lootcli, …)
];

// Soft-penalty: usually-not-the-game helpers that occasionally are. Penalize, don't exclude.
const SOFT_PENALTY = [
  /loader/i,
  /launcher/i,
  /selector/i,
  /rapidcrc/i,
  /(^|[^a-z])crc([^a-z]|$)/i,
  /benchmark/i,
  /richpresence/i,
  /crashpad/i,
  /helper/i,
];

// Directories never worth descending into.
const META_DIRS = /^(_?CommonRedist|_?Redist|redist|DirectX|dx|dotnet|prerequisites|prereq|Installers)$/i;

const MAX_DEPTH = 5;

// Scoring weights — name match dominates size so a strong name beats a bigger unrelated exe,
// while size still breaks ties between similarly-named candidates.
const W_NAME = 100;
const W_SIZE = 10;
const BONUS_DLL_DIR = 15; // exe sits next to the steam_api dll -> strong signal
const BONUS_ROOT_DLL_DIR = 20; // root exe + root steam_api wins over nested helper dlls
const BONUS_ROOT_EXE_WITH_NESTED_DLL = 18; // root exe + nested steam_api belongs to the same install
const PENALTY_SOFT = 30;
const PENALTY_DEPTH = 2;
const PENALTY_SHADOWED_L_SUFFIX = 5; // foo-l.exe next to foo.exe is usually a launcher/helper variant

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// 0..1 similarity between a game name and an exe basename (extension already stripped).
function nameSimilarity(gameName, exeBase) {
  const g = normalize(gameName);
  const e = normalize(exeBase);
  if (!g || !e) return 0;
  if (g === e) return 1;
  if (g.includes(e) || e.includes(g)) return 0.85;
  const gameTokens = new Set(tokenize(gameName));
  const exeTokens = tokenize(exeBase);
  if (gameTokens.size === 0 || exeTokens.length === 0) return 0;
  let hits = 0;
  for (const t of exeTokens) if (gameTokens.has(t)) hits++;
  if (hits === 0) return 0;
  return 0.6 * (hits / Math.max(gameTokens.size, exeTokens.length));
}

function collectCandidates(gameDir) {
  const candidates = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.toLowerCase() === 'steam_settings') continue;
        if (META_DIRS.test(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.exe')) {
        if (EXE_EXCLUDE.some((r) => r.test(e.name))) continue;
        const full = path.join(dir, e.name);
        let size;
        try {
          size = fs.statSync(full).size;
        } catch {
          continue;
        }
        candidates.push({ name: e.name, full, size, depth, dir });
      }
    }
  };
  walk(gameDir, 0);
  return candidates;
}

/*
  Find the most likely game executable inside gameDir.

  opts.dllPaths : full paths to the detected steam_api dll(s) — candidates in the same folder get a bonus.
  opts.taken    : iterable/Set of full exe paths already assigned to OTHER games — never returned (no
                  duplicate auto-association). If every candidate is taken, returns null.
  opts.takenGameDirs : iterable/Set of install folders already assigned to OTHER games — never returns
                  a second exe from the same game folder.
*/
function detect(gameDir, gameName, opts = {}) {
  if (!gameDir || !fs.existsSync(gameDir)) return null;

  // Lowercased for case-insensitive (Windows) collision checks.
  const taken = new Set([...(opts.taken || [])].map((p) => String(p).toLowerCase()));
  const rootDir = path.resolve(gameDir).toLowerCase();
  const takenGameDirs = new Set([...(opts.takenGameDirs || [])].map((p) => path.resolve(String(p)).toLowerCase()));
  if (takenGameDirs.has(rootDir)) return null;
  const dllDirs = new Set();
  for (const dll of opts.dllPaths || []) {
    try {
      dllDirs.add(path.resolve(path.dirname(dll)).toLowerCase());
    } catch {
      /* ignore */
    }
  }

  const candidates = collectCandidates(gameDir);
  if (candidates.length === 0) return null;

  // Some repacks keep the real game's exe and steam_api64.dll at the install root, while helper
  // tools/sub-builds below it also carry their own steam_api.dll. In that layout the nested dlls are
  // weaker evidence than the root pair; otherwise a larger helper exe can outscore the real game.
  const hasRootDll = dllDirs.has(rootDir);
  const hasRootExe = candidates.some((c) => path.resolve(c.dir).toLowerCase() === rootDir);
  const preferRootDll = hasRootDll && hasRootExe;
  const hasNestedDll = [...dllDirs].some((dir) => dir !== rootDir && dir.startsWith(rootDir + path.sep));

  const maxSize = Math.max(...candidates.map((c) => c.size), 1);
  const basesInSameDir = new Set(candidates.map((c) => `${path.resolve(c.dir).toLowerCase()}|${c.name.replace(/\.exe$/i, '').toLowerCase()}`));
  for (const c of candidates) {
    const base = c.name.replace(/\.exe$/i, '');
    const sim = nameSimilarity(gameName, base);
    const sizeFactor = c.size / maxSize;
    const candidateDir = path.resolve(c.dir).toLowerCase();
    let soft = SOFT_PENALTY.some((r) => r.test(c.name)) ? PENALTY_SOFT : 0;
    if (/-l$/i.test(base) && basesInSameDir.has(`${candidateDir}|${base.replace(/-l$/i, '')}`)) {
      soft += PENALTY_SHADOWED_L_SUFFIX;
    }
    let dllBonus = 0;
    if (dllDirs.has(candidateDir)) {
      dllBonus = preferRootDll
        ? (candidateDir === rootDir ? BONUS_DLL_DIR + BONUS_ROOT_DLL_DIR : 0)
        : BONUS_DLL_DIR;
    }
    if (!hasRootDll && hasNestedDll && candidateDir === rootDir) {
      dllBonus = Math.max(dllBonus, BONUS_ROOT_EXE_WITH_NESTED_DLL);
    }
    c.score = sim * W_NAME + sizeFactor * W_SIZE + dllBonus - soft - c.depth * PENALTY_DEPTH;
  }
  candidates.sort((a, b) => b.score - a.score || a.depth - b.depth || b.size - a.size);

  for (const c of candidates) {
    if (!taken.has(c.full.toLowerCase())) {
      return { name: c.name, full: c.full, size: c.size, score: c.score };
    }
  }
  return null;
}

// Minimum name similarity for a folder to be accepted as a game's install dir (name-based fallback
// used when there is no steam_settings/steam_appid.txt to identify the folder authoritatively).
const FOLDER_MATCH_THRESHOLD = 0.6;

// Pick the folder whose name best matches gameName, or null if none clears the threshold.
// folders: [{ dir, name }]. Used to resolve an install dir for non-Goldberg games (GOG/standalone)
// so exe detection can run for them too.
function bestFolderMatch(gameName, folders) {
  if (!gameName || !Array.isArray(folders)) return null;
  let bestDir = null;
  let bestScore = -1;
  for (const f of folders) {
    const s = nameSimilarity(gameName, f.name);
    if (s >= FOLDER_MATCH_THRESHOLD && s > bestScore) {
      bestScore = s;
      bestDir = f.dir;
    }
  }
  return bestDir;
}

// Does this folder DIRECTLY contain a real (non-utility, non-launcher) game .exe? Used to decide
// whether a folder is a "game folder" when scanning for unconfigured installs (no recursion — the
// recursive detect() is used afterwards to pick the actual exe of an emitted game).
function shallowGameExe(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.exe')) continue;
    if (EXE_EXCLUDE.some((r) => r.test(e.name))) continue;
    if (SOFT_PENALTY.some((r) => r.test(e.name))) continue; // skip launcher/loader-style exes
    return e.name;
  }
  return null;
}

module.exports = { detect, shallowGameExe, nameSimilarity, bestFolderMatch, FOLDER_MATCH_THRESHOLD, EXE_EXCLUDE, SOFT_PENALTY };
