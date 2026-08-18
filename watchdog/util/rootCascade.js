'use strict';

/*
 * Root detection cascade for the Watchdog: classify a folder from file signatures and return
 * monitor-style watch entries. Discovery only - it never generates configs or writes preferences.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const ini = require('./ini');

const ACHIEVEMENT_FILES = [
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
];

const STRICT_ROOT_PROFILES = [
  { key: 'steam-codex', suffix: ['steam', 'codex'] },
  { key: 'steam-rld', suffix: ['steam', 'rld!'] },
  { key: 'empress', suffix: ['empress'] },
  { key: 'goldberg-steam', suffix: ['goldberg steamemu saves'] },
  { key: 'gse', suffix: ['gse saves'] },
  { key: 'goldberg-uplay', suffix: ['goldberg uplayemu saves'] },
  { key: 'anadius-lsx', suffix: ['anadius', 'lsx emu', 'achievement_watcher'] },
];

function getInvalidAutoAppIdReason(name) {
  const value = String(name || '').trim();
  if (!value) return 'empty';
  if (!/^[0-9a-fA-F]+$/.test(value)) return '';
  if (value.length === 1) return 'single-character-id';
  if (/^0+$/.test(value)) return 'zero-only-id';
  if (/^0{4,}/.test(value)) return 'leading-zero-padding';
  return '';
}

function isAppIdName(name) {
  const value = String(name || '').trim();
  return /^[0-9a-fA-F]+$/.test(value) && !getInvalidAutoAppIdReason(value);
}

function shouldIgnoreDiscoveredId(id) {
  const value = String(id || '').trim();
  if (!value) return true;
  // SteamID64 (user id), not a game appid
  if (/^7656\d{13}$/.test(value)) return true;
  // Numeric IDs longer than 11 digits are unlikely to be game appids
  if (/^\d{12,}$/.test(value)) return true;
  // Short hex with letters (e.g. 0F74F) is likely noise
  if (value.length < 6 && /[a-f]/i.test(value)) return true;
  return false;
}

function splitPathLower(inputPath) {
  return String(inputPath || '')
    .replace(/[\\/]+/g, path.sep)
    .toLowerCase()
    .split(path.sep)
    .filter(Boolean);
}

function isShadPs4RuntimePath(inputPath) {
  return splitPathLower(inputPath).includes('shadps4');
}

function matchesPathSuffix(pathParts, suffixParts) {
  if (!Array.isArray(pathParts) || !Array.isArray(suffixParts)) return false;
  if (!suffixParts.length || pathParts.length < suffixParts.length) return false;
  const offset = pathParts.length - suffixParts.length;
  for (let i = 0; i < suffixParts.length; i += 1) {
    if (pathParts[offset + i] !== suffixParts[i]) return false;
  }
  return true;
}

function getStrictRootProfile(rootPath) {
  const parts = splitPathLower(rootPath);
  for (const profile of STRICT_ROOT_PROFILES) {
    if (matchesPathSuffix(parts, profile.suffix)) return profile;
  }
  return null;
}

function getRelativeSegmentsFromRoot(rootPath, targetPath) {
  if (!rootPath || !targetPath) return [];
  let rel = '';
  try {
    rel = path.relative(rootPath, targetPath);
  } catch {
    return [];
  }
  if (!rel || rel === '.') return [];
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
  return rel.split(/[\\/]+/).filter(Boolean);
}

function parseStrictRootAppId(rootPath, targetPath) {
  const segments = getRelativeSegmentsFromRoot(rootPath, targetPath);
  if (!segments.length) return null;
  const first = segments[0];
  return isAppIdName(first) ? first : null;
}

function isPathInsideRoot(rootPath, targetPath) {
  if (!rootPath || !targetPath) return false;
  let rel = '';
  try {
    rel = path.relative(rootPath, targetPath);
  } catch {
    return false;
  }
  if (!rel || rel === '.') return true;
  return (
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

function normalizeRoot(inputRoot) {
  let root = inputRoot;
  try {
    root = fs.realpathSync(inputRoot);
  } catch {
    /* keep original */
  }
  if (isAppIdName(path.basename(root))) root = path.dirname(root);
  return root;
}

function createTimeSlicer(sliceMs = 0) {
  let lastYieldAt = Date.now();
  return async () => {
    if (!sliceMs || sliceMs <= 0) return;
    const now = Date.now();
    if (now - lastYieldAt >= sliceMs) {
      lastYieldAt = now;
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

async function walkTree(root, visitor, options = {}) {
  const maxDepth = Math.max(0, Number(options.maxDepth) || 0);
  const shouldSkipPath =
    typeof options.shouldSkipPath === 'function'
      ? options.shouldSkipPath
      : () => false;
  const yieldIfNeeded =
    typeof options.yieldIfNeeded === 'function'
      ? options.yieldIfNeeded
      : async () => {};

  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || shouldSkipPath(current.dir)) continue;
    let entries;
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(current.dir, ent.name);
      if (shouldSkipPath(full)) continue;
      const isDir = ent.isDirectory();
      const keep = await visitor(full, ent, current.depth, isDir);
      if (keep === false) continue;
      if (isDir && current.depth < maxDepth) {
        stack.push({ dir: full, depth: current.depth + 1 });
      }
      await yieldIfNeeded();
    }
  }
}

async function discoverAppIdsUnder(root, options = {}) {
  const out = new Map();
  await walkTree(
    root,
    (full, ent, depth, isDir) => {
      if (!isDir) return false;
      if (!isAppIdName(ent.name) || shouldIgnoreDiscoveredId(ent.name)) {
        return depth < (Number(options.maxDepth) || 6);
      }
      out.set(ent.name, full);
      // Keep descending like the source: an AppID folder can contain
      // additional AppID folders (for example nested emulator saves).
      return true;
    },
    options,
  );
  return out;
}

async function discoverImmediateAppIdsUnder(root, options = {}) {
  const out = new Map();
  if (typeof options.shouldSkipPath === 'function' && options.shouldSkipPath(root)) {
    return out;
  }
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(root, ent.name);
    if (typeof options.shouldSkipPath === 'function' && options.shouldSkipPath(candidate)) {
      continue;
    }
    if (!isAppIdName(ent.name) || shouldIgnoreDiscoveredId(ent.name)) continue;
    out.set(ent.name, candidate);
    if (typeof options.yieldIfNeeded === 'function') await options.yieldIfNeeded();
  }
  return out;
}

async function discoverGpdFilesUnder(root, options = {}) {
  const found = [];
  await walkTree(
    root,
    (full) => {
      if (String(full).toLowerCase().endsWith('.gpd')) found.push(full);
      return true;
    },
    options,
  );
  return found;
}

async function discoverRpcs3TrophyDirsUnder(root, options = {}) {
  const found = [];
  await walkTree(
    root,
    async (full) => {
      if (!fs.existsSync(full)) return true;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        return true;
      }
      if (!stat.isDirectory()) return true;
      if (
        fs.existsSync(path.join(full, 'TROPCONF.SFM')) &&
        fs.existsSync(path.join(full, 'TROPUSR.DAT'))
      ) {
        found.push(full);
        return false;
      }
      return true;
    },
    options,
  );
  return found;
}

async function discoverPs4TrophyDirsUnder(root, options = {}) {
  const found = [];
  await walkTree(
    root,
    (full, ent, depth, isDir) => {
      if (!isDir) return true;
      if (String(ent.name).toLowerCase() === 'trophy00') {
        const parent = path.dirname(full);
        if (
          path.basename(parent).toLowerCase() === 'trophyfiles' &&
          fs.existsSync(path.join(full, 'Xml', 'TROP.XML'))
        ) {
          found.push(full);
          return false;
        }
      }
      return true;
    },
    options,
  );
  return found;
}

async function discoverModernPs4TrophySetsUnder(root, options = {}) {
  const out = [];
  const trophyRoot = path.join(root, 'trophy');
  let entries;
  try {
    entries = await fsp.readdir(trophyRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!/^NP[A-Z0-9_]+$/i.test(ent.name)) continue;
    const schemaDir = path.join(trophyRoot, ent.name);
    if (!fs.existsSync(path.join(schemaDir, 'Xml', 'TROP.XML'))) continue;
    out.push({
      npcommid: ent.name,
      schemaDir,
      root,
    });
  }
  return out;
}

async function findGogInfoAppId(root, options = {}) {
  const pattern = /^goggame-(\d+)\.info$/i;
  const found = [];
  await walkTree(
    root,
    (full, ent) => {
      if (ent.isFile() && pattern.test(ent.name)) found.push(full);
      return true;
    },
    options,
  );

  const pickLaunchMetadata = (parsed, baseDir) => {
    const tasks = Array.isArray(parsed && parsed.playTasks) ? parsed.playTasks : [];
    const ranked = tasks
      .map((task, index) => {
        const taskPath = String((task && task.path) || '').trim();
        if (!taskPath || !/\.exe$/i.test(taskPath)) return null;
        let score = 100;
        if (task.isPrimary === true) score += 50;
        if (String(task.category || '').toLowerCase() === 'game') score += 25;
        if (String(task.type || '').toLowerCase() === 'filetask') score += 10;
        return { task, index, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = ranked[0] && ranked[0].task;
    const taskPath = String((selected && selected.path) || '').trim();
    if (!taskPath) return null;
    return {
      executable: path.isAbsolute(taskPath) ? taskPath : path.join(baseDir, taskPath),
      arguments: '',
      process_name: path.win32.basename(taskPath.replace(/\//g, '\\')),
    };
  };

  const entries = [];
  for (const file of found) {
    try {
      const match = path.basename(file).match(pattern);
      const fromName = match && match[1] ? match[1] : '';
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      const fromJson =
        parsed.gameId ??
        parsed.gameID ??
        parsed.game_id ??
        parsed.GameId ??
        parsed.GameID;
      const rootFromJson =
        parsed.rootGameId ??
        parsed.rootgameid ??
        parsed.root_game_id ??
        parsed.RootGameId ??
        parsed.RootGameID ??
        parsed.Rootgameid;
      const gameId = /^[0-9a-fA-F]+$/.test(String(fromJson || ''))
        ? String(fromJson)
        : fromName;
      const rootGameId = /^[0-9a-fA-F]+$/.test(String(rootFromJson || ''))
        ? String(rootFromJson)
        : '';
      if (gameId && /^[0-9a-fA-F]+$/.test(gameId)) {
        entries.push({
          gameId,
          rootGameId: rootGameId || gameId,
          name: String(parsed.name || '').trim(),
          file,
          launchMetadata: pickLaunchMetadata(parsed, path.dirname(file)),
        });
      }
    } catch {
      /* ignore unparsable gog .info */
    }
  }
  if (!entries.length) return null;
  const baseEntry =
    entries.find((entry) => entry.rootGameId === entry.gameId) ||
    entries.find((entry) => !!entry.rootGameId) ||
    entries[0];
  return {
    appid: baseEntry.rootGameId || baseEntry.gameId,
    baseDir: path.dirname(baseEntry.file),
    name: baseEntry.name || null,
    launchMetadata: baseEntry.launchMetadata || null,
  };
}

async function findUniverseLanAppId(root, options = {}) {
  const iniName = 'UniverseLAN.ini';
  const found = [];
  await walkTree(
    root,
    (full, ent) => {
      if (ent.isFile() && ent.name.toLowerCase() === iniName.toLowerCase()) {
        found.push(full);
      }
      return true;
    },
    options,
  );
  for (const file of found) {
    try {
      const buf = await fsp.readFile(file);
      const tryParse = (str) => {
        try {
          const parsed = ini.parse(str);
          const val = String(parsed && parsed.GameSettings && parsed.GameSettings.AppID || '').trim();
          return /^\d+$/.test(val) ? val : '';
        } catch {
          return '';
        }
      };
      const appid =
        tryParse(buf.toString('utf8')) || tryParse(buf.toString('utf16le'));
      if (appid) return { appid, baseDir: path.dirname(file) };
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function findTenokeAppId(root, options = {}) {
  const found = [];
  await walkTree(
    root,
    (full, ent) => {
      if (ent.isFile() && ent.name.toLowerCase() === 'tenoke.ini') {
        found.push(full);
      }
      return true;
    },
    options,
  );
  for (const file of found) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const match = raw.match(/^\s*id\s*=\s*(\d+)/im);
      if (match && match[1]) return { appid: match[1], baseDir: path.dirname(file) };
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function discoverNemirtingasEpicAppIds(root, options = {}) {
  const info = (() => {
    const normalized = String(root).replace(/[\\/]+/g, path.sep);
    const lower = normalized.toLowerCase();
    const parts = lower.split(path.sep);
    const idx = parts.lastIndexOf('nemirtingasepicemu');
    if (idx === -1) return null;
    const rawParts = normalized.split(path.sep);
    return {
      base: rawParts.slice(0, idx + 1).join(path.sep),
      sub: rawParts.slice(idx + 1),
    };
  })();
  if (!info) return null;
  const out = new Map();
  const scanUserDir = async (userDir) => {
    if (typeof options.shouldSkipPath === 'function' && options.shouldSkipPath(userDir)) return;
    let entries;
    try {
      entries = await fsp.readdir(userDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!isAppIdName(ent.name) || shouldIgnoreDiscoveredId(ent.name)) continue;
      const candidate = path.join(userDir, ent.name);
      if (typeof options.shouldSkipPath === 'function' && options.shouldSkipPath(candidate)) {
        continue;
      }
      out.set(ent.name, candidate);
    }
  };
  if (!info.sub.length) {
    let userDirs;
    try {
      userDirs = await fsp.readdir(info.base, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const ent of userDirs) {
      if (ent.isDirectory()) await scanUserDir(path.join(info.base, ent.name));
    }
    return out;
  }
  await scanUserDir(path.join(info.base, info.sub[0]));
  return out;
}

function listSchemaBins(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (ent) => ent.isFile() && /^UserGameStatsSchema_\d+\.bin$/i.test(ent.name),
      )
      .map((ent) => path.join(dir, ent.name));
  } catch {
    return [];
  }
}

function isSteamStatsRoot(dir) {
  const parts = splitPathLower(dir);
  return matchesPathSuffix(parts, ['steam', 'appcache', 'stats']);
}

function hasEaVerboseLogs(root) {
  try {
    return (
      fs.existsSync(path.join(root, 'EADesktopVerbose.log')) ||
      fs.existsSync(path.join(root, 'EADesktopVerbose.bak'))
    );
  } catch {
    return false;
  }
}

function hasUbisoftSpoolFiles(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .some(
        (ent) =>
          ent.isDirectory() &&
          fs
            .readdirSync(path.join(root, ent.name), { withFileTypes: true })
            .some((file) => file.isFile() && /^\d+\.spool$/i.test(file.name)),
      );
  } catch {
    return false;
  }
}

function hasGogGameplayDbs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .some((ent) => {
        if (!ent.isDirectory()) return false;
        const gameplay = path.join(root, ent.name, 'Gameplay');
        try {
          return fs
            .readdirSync(gameplay, { withFileTypes: true })
            .some(
              (user) =>
                user.isDirectory() &&
                fs.existsSync(path.join(gameplay, user.name, 'gameplay.db')),
            );
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}

/*
 * scanRootOnce(rootPath, opts)
 *
 * Returns { platform, mode, entries, signals }.
 * entries are monitor-style watch entries:
 *   { dir, options: { recursive, filter, file, appid, emu, ... } }
 */
async function scanRootOnce(rootPath, opts = {}) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return { platform: null, mode: 'missing', entries: [], signals: [] };
  }
  const shouldSkipPath =
    typeof opts.shouldSkipPath === 'function' ? opts.shouldSkipPath : () => false;
  const yieldIfNeeded =
    typeof opts.yieldIfNeeded === 'function'
      ? opts.yieldIfNeeded
      : createTimeSlicer(opts.timeSliceMs || 0);
  const maxDepth = Math.max(0, Number(opts.maxDepth) || 6);
  const scanBase = normalizeRoot(rootPath);
  const strictRootProfile = getStrictRootProfile(scanBase);
  const walkOptions = { maxDepth, shouldSkipPath, yieldIfNeeded };

  const signals = [];
  if (strictRootProfile) {
    const discovered = await discoverImmediateAppIdsUnder(scanBase, {
      shouldSkipPath,
      yieldIfNeeded,
    });
    const entries = Array.from(discovered.entries()).map(([appid, dir]) => ({
      dir,
      options: {
        appid,
        recursive: false,
        file: ACHIEVEMENT_FILES,
        source: strictRootProfile.key,
      },
    }));
    return {
      platform: 'steam-emu',
      mode: 'strict',
      entries,
      signals: entries.length ? ['strict-appids'] : [],
    };
  }

  // 1. Xenia .gpd
  const gpdFiles = await discoverGpdFilesUnder(scanBase, walkOptions);
  if (gpdFiles.length) {
    return {
      platform: 'xenia',
      mode: 'cascade',
      signals: ['xenia-gpd'],
      entries: gpdFiles.map((gpdPath) => ({
        dir: path.dirname(gpdPath),
        options: {
          appid: path.basename(gpdPath, path.extname(gpdPath)),
          recursive: false,
          file: [path.basename(gpdPath)],
          emu: 'xenia',
        },
      })),
    };
  }

  // 2. RPCS3 trophy dirs
  const rpcs3TrophyDirs = await discoverRpcs3TrophyDirsUnder(scanBase, walkOptions);
  if (rpcs3TrophyDirs.length) {
    return {
      platform: 'rpcs3',
      mode: 'cascade',
      signals: ['rpcs3-trophy'],
      entries: rpcs3TrophyDirs.map((trophyDir) => ({
        dir: trophyDir,
        options: {
          appid: path.basename(trophyDir),
          recursive: false,
          file: ['TROPUSR.DAT', 'TROPCONF.SFM'],
          emu: 'rpcs3',
        },
      })),
    };
  }

  // 3. shadPS4 modern trophy sets (the console watcher already handles these;
  // this pass only classifies the root so the UI can flag it).
  const modernPs4Sets = await discoverModernPs4TrophySetsUnder(scanBase, walkOptions);
  if (modernPs4Sets.length) {
    return {
      platform: 'shadps4',
      mode: 'cascade',
      signals: ['ps4-trophy'],
      entries: modernPs4Sets.map((set) => ({
        dir: set.schemaDir,
        options: { emu: 'shadps4', npcommid: set.npcommid, recursive: false },
      })),
    };
  }

  // 4. shadPS4 legacy layout
  const ps4TrophyDirs = await discoverPs4TrophyDirsUnder(scanBase, walkOptions);
  if (ps4TrophyDirs.length) {
    return {
      platform: 'shadps4',
      mode: 'cascade',
      signals: ['ps4-trophy'],
      entries: ps4TrophyDirs.map((trophyDir) => ({
        dir: trophyDir,
        options: {
          appid: path.basename(path.dirname(path.dirname(trophyDir))),
          recursive: false,
          file: ['TROP.XML'],
          emu: 'shadps4',
        },
      })),
    };
  }

  // 5. Steam official appcache stats
  let steamStatsRoot = scanBase;
  if (!isSteamStatsRoot(scanBase)) {
    const parts = splitPathLower(scanBase);
    if (
      parts.includes('steam') &&
      fs.existsSync(path.join(scanBase, 'appcache', 'stats'))
    ) {
      steamStatsRoot = path.join(scanBase, 'appcache', 'stats');
    }
  }
  const schemaBins = listSchemaBins(steamStatsRoot);
  if (schemaBins.length) {
    return {
      platform: 'steam-official',
      mode: 'cascade',
      signals: ['steam-official-bin'],
      entries: schemaBins.map((binPath) => {
        const match = path.basename(binPath).match(/^UserGameStatsSchema_(\d+)\.bin$/i);
        return {
          dir: steamStatsRoot,
          options: {
            appid: match && match[1] ? match[1] : '',
            recursive: false,
            file: ['UserGameStatsSchema_' + (match && match[1] ? match[1] : '') + '.bin'],
            emu: 'steam-official',
          },
        };
      }),
    };
  }

  // 6. EA Desktop verbose log (console/eaWatch.js owns the live parsing)
  if (hasEaVerboseLogs(scanBase)) {
    return {
      platform: 'ea-official',
      mode: 'cascade',
      signals: ['ea-verbose-log'],
      entries: [],
    };
  }

  // 7. Ubisoft Connect spool (console/ubisoftWatch.js owns the live parsing)
  if (hasUbisoftSpoolFiles(scanBase)) {
    return {
      platform: 'ubisoft-official',
      mode: 'cascade',
      signals: ['ubisoft-spool'],
      entries: [],
    };
  }

  // 8. GOG Galaxy Applications (console/gogWatch.js owns the live parsing)
  if (hasGogGameplayDbs(scanBase)) {
    return {
      platform: 'gog-official',
      mode: 'cascade',
      signals: ['gog-gameplay-db'],
      entries: [],
    };
  }

  // 9. GOG classic .info
  const gogInfo = await findGogInfoAppId(scanBase, walkOptions).catch(() => null);
  if (gogInfo) {
    return {
      platform: 'gog',
      mode: 'cascade',
      signals: ['gog-info'],
      entries: [
        {
          dir: gogInfo.baseDir,
          options: {
            appid: gogInfo.appid,
            recursive: false,
            file: ACHIEVEMENT_FILES,
            emu: 'gog',
            name: gogInfo.name || undefined,
            launchMetadata: gogInfo.launchMetadata || undefined,
          },
        },
      ],
    };
  }

  // 10. Nemirtingas Epic Emu
  const nemirtingas = await discoverNemirtingasEpicAppIds(scanBase, walkOptions);
  if (nemirtingas && nemirtingas.size) {
    return {
      platform: 'epic-emu',
      mode: 'cascade',
      signals: ['nemirtingas-epic'],
      entries: Array.from(nemirtingas.entries()).map(([appid, dir]) => ({
        dir,
        options: {
          appid,
          recursive: true,
          file: ['achievements.json'],
          emu: 'nemirtingas-epic',
        },
      })),
    };
  }

  // 11. Generic numeric AppID folders
  const discovered = await discoverAppIdsUnder(scanBase, walkOptions);
  const discoveredIds = Array.from(discovered.keys()).filter(
    (id) => !shouldIgnoreDiscoveredId(id),
  );
  if (discoveredIds.length) {
    return {
      platform: 'steam-emu',
      mode: 'cascade',
      signals: ['numeric-appids'],
      entries: discoveredIds.map((appid) => ({
        dir: discovered.get(appid),
        options: {
          appid,
          recursive: false,
          file: ACHIEVEMENT_FILES,
        },
      })),
    };
  }

  // 12. Tenoke
  const tenoke = await findTenokeAppId(scanBase, walkOptions).catch(() => null);
  if (tenoke) {
    return {
      platform: 'tenoke',
      mode: 'cascade',
      signals: ['tenoke-ini'],
      entries: [
        {
          dir: tenoke.baseDir,
          options: {
            appid: tenoke.appid,
            recursive: true,
            file: ['user_stats.ini'],
            emu: 'tenoke',
          },
        },
      ],
    };
  }

  // 13. UniverseLAN
  const universeLan = await findUniverseLanAppId(scanBase, walkOptions).catch(() => null);
  if (universeLan) {
    return {
      platform: 'universe-lan',
      mode: 'cascade',
      signals: ['universe-lan'],
      entries: [
        {
          dir: path.join(universeLan.baseDir, 'UniverseLANData'),
          options: {
            appid: universeLan.appid,
            recursive: false,
            file: ['Achievements.ini'],
            emu: 'universe-lan',
          },
        },
      ],
    };
  }

  return { platform: null, mode: 'none', entries: [], signals };
}

module.exports = {
  ACHIEVEMENT_FILES,
  STRICT_ROOT_PROFILES,
  createTimeSlicer,
  discoverAppIdsUnder,
  discoverGpdFilesUnder,
  discoverImmediateAppIdsUnder,
  discoverModernPs4TrophySetsUnder,
  discoverNemirtingasEpicAppIds,
  discoverPs4TrophyDirsUnder,
  discoverRpcs3TrophyDirsUnder,
  findGogInfoAppId,
  findTenokeAppId,
  findUniverseLanAppId,
  getStrictRootProfile,
  isAppIdName,
  isPathInsideRoot,
  isShadPs4RuntimePath,
  normalizeRoot,
  parseStrictRootAppId,
  scanRootOnce,
  shouldIgnoreDiscoveredId,
};
