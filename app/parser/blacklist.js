'use strict';

const path = require('path');
const request = require('request-zero');
const fs = require('fs');
const { crc32 } = require('crc');

let debug;
let exclusionFile;
const builtinExclude = [
  480, //Space War
  753, //Steam Config
  250820, //SteamVR
  228980, //Steamworks Common Redistributables
  431960, //Wallpaper Engine (background utility; subprocesses should never count as game time)
];
module.exports.initDebug = ({ isDev, userDataPath }) => {
  exclusionFile = path.join(userDataPath, 'cfg/exclusion.db');
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/blacklist.log'),
  });
};

module.exports.get = async () => {
  const url = 'https://api.xan105.com/steam/getBogusList';
  //TODO: replace this url with the full apilist of dlc/music/demo/etc

  let exclude = [
    ...builtinExclude,
  ];

  try {
    let srvExclusion = (await request.getJson(url)).data;
    debug.log('blacklist from srv:');
    debug.log(srvExclusion);
    exclude = [...new Set([...exclude, ...srvExclusion])];
  } catch (err) {
    //Do nothing
  }

  try {
    let userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
    exclude = [...new Set([...exclude, ...userExclusion])];
  } catch (err) {
    //Do nothing
  }

  return exclude;
};

// Human-readable names for user-blacklisted appids, kept in a sidecar so exclusion.db stays a plain
// id array (back-compat with every existing install). Best-effort only — a missing name renders as
// the bare appid in the Settings manager.
const namesFile = () => path.join(path.dirname(exclusionFile), 'exclusion-names.json');

function readNames() {
  try {
    const parsed = JSON.parse(fs.readFileSync(namesFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeNames(names) {
  try {
    fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
    fs.writeFileSync(namesFile(), JSON.stringify(names, null, 2), 'utf8');
  } catch (e) {
    /* names are cosmetic — never fail the caller */
  }
}

module.exports.reset = async () => {
  fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
  fs.writeFileSync(exclusionFile, JSON.stringify([], null, 2), 'utf8');
  writeNames({});
};

// The app's own index of every game it has seen (cfg/gameIndex.json). This is the only local source
// that covers non-Steam ids — `local-…`, Uplay, Xbox — which is exactly what the blacklist is full
// of, and it already carries the display name the library showed.
function lookupGameIndexName(cfgDir, id) {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(cfgDir, 'gameIndex.json'), 'utf8'));
    if (!Array.isArray(rows)) return '';
    const hit = rows.find((row) => row && String(row.appid ?? '').trim() === id && String(row.name ?? '').trim());
    return hit ? String(hit.name).trim() : '';
  } catch {
    return '';
  }
}

/*
  Unconfigured installs get a synthetic `local-<crc32 of the install folder>` id, so a hidden entry can
  be found again by recomputing the hash over the scanned roots (bounded by depth/node budget).
*/
const LOCAL_ID_MAX_DEPTH = 4; // matches the scanner's own walk limit
const LOCAL_ID_MAX_DIRS = 6000; // safety valve for a pathological root (a huge Desktop tree)

function localInstallRoots(cfgDir) {
  const roots = [];
  const add = (dir) => {
    const value = String(dir || '').trim();
    if (value && !roots.some((r) => r.toLowerCase() === value.toLowerCase())) roots.push(value);
  };
  try {
    const configured = JSON.parse(fs.readFileSync(path.join(cfgDir, 'librarydirs.db'), 'utf8'));
    if (Array.isArray(configured)) configured.forEach(add);
  } catch {
    /* no library folders configured yet */
  }
  // The roots achievements.js adds automatically on every scan, so a game in the default library
  // folders or on the Desktop resolves even when the user never added them by hand.
  add('C:\\Games');
  add('C:\\Jeux');
  if (process.env.USERPROFILE) add(path.join(process.env.USERPROFILE, 'Desktop'));
  if (process.env.PUBLIC) add(path.join(process.env.PUBLIC, 'Desktop'));
  return roots;
}

function localIdFor(dir) {
  return 'local-' + (crc32(String(dir).toLowerCase()) >>> 0).toString(16);
}

/*
  id -> folder name for every folder under the scan roots, built at most once per process (keyed by
  cfg dir so a test using a temp userData is never served another one's map). One walk answers every
  id, including the ones with no match: without it, an entry whose folder is gone would re-walk the
  disks on every render, forever, precisely because it can never be resolved and cached.
*/
const localInstallIndexCache = new Map();

function localInstallIndex(cfgDir) {
  const cacheKey = path.resolve(cfgDir);
  const cached = localInstallIndexCache.get(cacheKey);
  if (cached) return cached;

  const index = new Map();
  let budget = LOCAL_ID_MAX_DIRS;

  const walk = (dir, depth) => {
    if (depth > LOCAL_ID_MAX_DEPTH || budget <= 0) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable/missing root — just skip it
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (--budget <= 0) return;
      const full = path.join(dir, entry.name);
      if (!index.has(localIdFor(full))) index.set(localIdFor(full), entry.name);
      walk(full, depth + 1);
    }
  };

  for (const root of localInstallRoots(cfgDir)) {
    if (!index.has(localIdFor(root))) index.set(localIdFor(root), path.basename(root));
    walk(root, 1);
  }
  localInstallIndexCache.set(cacheKey, index);
  return index;
}

function resolveLocalInstallName(cfgDir, id) {
  if (!/^local-[0-9a-f]{1,8}$/i.test(id)) return '';
  return localInstallIndex(cfgDir).get(String(id).toLowerCase()) || '';
}

// Forget the cached folder map — the scan roots changed (a library folder was added or removed), so
// an id that could not be resolved before may be resolvable now.
module.exports.forgetLocalInstallIndex = () => localInstallIndexCache.clear();

// Per-game Steam schema caches the app writes for every game it displays
// (steam_cache/schema/<lang>/<appid>.db, shaped { name, appid, … }). A game you blacklisted is by
// definition a game the app had already listed, so its schema is almost always sitting right here —
// unlike the 250k-row appList dump, which only exists once GetAppList has answered at least once.
function lookupSchemaCacheName(userDataDir, id) {
  const schemaRoot = path.join(userDataDir, 'steam_cache', 'schema');
  let langs;
  try {
    langs = fs.readdirSync(schemaRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return '';
  }
  for (const lang of langs) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(schemaRoot, lang, `${id}.db`), 'utf8'));
      const name = String((parsed && parsed.name) || '').trim();
      if (name) return name;
    } catch {
      /* missing/corrupt entry for this language — try the next one */
    }
  }
  return '';
}

// Best-effort offline name resolution for entries whose name was never stored (blacklisted before
// the sidecar existed, or added from a context where the title wasn't known). Everything is
// resolved relative to THIS install's userData (dirname(exclusionFile) === cfg/) rather than the
// hardcoded APPDATA default, so portable/relocated installs and tests stay consistent.
function resolveNameOffline(appid) {
  const id = String(appid ?? '').trim();
  if (!id) return '';
  const cfgDir = path.dirname(exclusionFile);
  const userDataDir = path.join(cfgDir, '..');
  try {
    const indexed = lookupGameIndexName(cfgDir, id);
    if (indexed) return indexed;
    const cached = lookupSchemaCacheName(userDataDir, id);
    if (cached) return cached;
    const local = resolveLocalInstallName(cfgDir, id);
    if (local) return local;
    if (!/^\d+$/.test(id)) return ''; // only Steam appids appear in the dumps below
    const gameNameCache = require(path.join(__dirname, '../util/gameNameCache.js'));
    return (
      gameNameCache.lookupSteamDbName(id, {
        runtimePath: path.join(cfgDir, 'steamdb.json'),
        fallbackPath: path.join(userDataDir, 'steam_cache', 'schema', 'appList.json'),
      }) || ''
    );
  } catch {
    return '';
  }
}

// Record a name resolved outside this module (the Settings manager falls back to an online Steam
// lookup for ids no local source knows), so the next render is instant and works offline.
module.exports.setName = async (appid, name) => {
  const id = String(appid ?? '').trim();
  const label = String(name || '').trim();
  if (!id || !label) return false;
  const names = readNames();
  if (names[id] === label) return false;
  names[id] = label;
  writeNames(names);
  return true;
};

// User exclusions only (what the Settings blacklist manager shows) — the builtin/server lists are
// not the user's to edit. Missing names are backfilled offline and, once resolved, written back to
// the sidecar so the next render is instant.
module.exports.getUserDetailed = async () => {
  let userExclusion;
  try {
    userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
  } catch (e) {
    userExclusion = [];
  }
  const names = readNames();
  let backfilled = false;
  const detailed = (Array.isArray(userExclusion) ? userExclusion : []).map((appid) => {
    let name = names[String(appid)] || '';
    if (!name) {
      name = resolveNameOffline(appid);
      if (name) {
        names[String(appid)] = name;
        backfilled = true;
      }
    }
    return { appid, name };
  });
  if (backfilled) writeNames(names);
  return detailed;
};

module.exports.remove = async (appid) => {
  let userExclusion;
  try {
    userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
  } catch (e) {
    userExclusion = [];
  }
  const next = (Array.isArray(userExclusion) ? userExclusion : []).filter((id) => String(id) !== String(appid));
  fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
  fs.writeFileSync(exclusionFile, JSON.stringify(next, null, 2), 'utf8');
  const names = readNames();
  if (names[String(appid)] != null) {
    delete names[String(appid)];
    writeNames(names);
  }
  debug.log(`Un-blacklisted ${appid}.`);
};

module.exports.add = async (appid, name) => {
  try {
    debug.log(`Blacklisting ${appid} ...`);

    let userExclusion;

    try {
      userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
    } catch (e) {
      userExclusion = [];
    }

    if (!userExclusion.some((id) => String(id) === String(appid))) {
      userExclusion.push(appid);
      fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
      fs.writeFileSync(exclusionFile, JSON.stringify(userExclusion, null, 2), 'utf8');
      debug.log('Done.');
    } else {
      debug.log('Already blacklisted.');
    }
    // Capture the title BEFORE dropping the game from gameIndex below — that index is the only
    // local record of a non-Steam id's name, so resolving afterwards would always come up empty and
    // the entry would be stuck rendering as a bare id in the Settings manager forever.
    const resolved = String(name || '').trim() || resolveNameOffline(appid);
    if (resolved) {
      const names = readNames();
      names[String(appid)] = resolved;
      writeNames(names);
    }
    try {
      const gameIndex = require(path.join(__dirname, 'gameIndex.js'));
      const removed = gameIndex.remove(appid);
      if (removed > 0) debug.log(`Removed ${removed} tracking entr${removed === 1 ? 'y' : 'ies'} from gameIndex.`);
    } catch (err) {
      debug.log(err);
    }
  } catch (err) {
    throw err;
  }
};

module.exports.builtin = builtinExclude.slice();
