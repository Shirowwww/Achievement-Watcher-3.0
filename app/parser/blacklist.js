'use strict';

const path = require('path');
const request = require('request-zero');
const fs = require('fs');

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

// Best-effort offline name resolution for entries whose name was never stored (blacklisted before
// the sidecar existed, or added from a context where the title wasn't known). Steam appids resolve
// against the local appList dump; non-Steam ids (e.g. UPLAY…) simply stay unresolved.
function resolveNameOffline(appid) {
  const id = String(appid ?? '').trim();
  if (!id || !/^\d+$/.test(id)) return '';
  try {
    const gameNameCache = require(path.join(__dirname, '../util/gameNameCache.js'));
    // Resolve the dumps relative to THIS install's userData (dirname(exclusionFile) === cfg/), not
    // the hardcoded APPDATA default — keeps portable/relocated installs and tests consistent.
    const cfgDir = path.dirname(exclusionFile);
    return (
      gameNameCache.lookupSteamDbName(id, {
        runtimePath: path.join(cfgDir, 'steamdb.json'),
        fallbackPath: path.join(cfgDir, '..', 'steam_cache', 'schema', 'appList.json'),
      }) || ''
    );
  } catch {
    return '';
  }
}

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
    if (name) {
      const names = readNames();
      names[String(appid)] = String(name);
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
