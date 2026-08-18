'use strict';

/*
  Recognise official launcher installs (Steam, Ubisoft Connect, GOG Galaxy, Epic, Microsoft Store) by
  their on-disk markers so the broad "Unconfigured" scan skips them - they are already listed by the
  official sources. A cracked Uplay R2 install keeps launcher markers but also ships its loader DLL,
  which is what tells the two apart; the Steam case uses the same idea with the steam_api dll.
*/

const fs = require('fs');
const path = require('path');

const GOG_GAME_FILE = /^goggame-\d+\.(?:info|id)$/i;
const STEAM_API_DLL = /^steam_api(?:64)?\.dll$/i;

/*
  Strings a Goldberg / GSE / SmartSteamEmu build reads at runtime. Neither Valve's steam_api dll nor
  an emulated one carries version-resource metadata, so the file name and the folder it sits in prove
  nothing - these markers are what actually tells a replaced dll from the original.
*/
const EMULATED_DLL_MARKERS = ['steam_settings', 'Goldberg', 'GSE Saves', 'SmartSteamEmu', 'ColdClientLoader'];
const MARKER_OVERLAP = Math.max(...EMULATED_DLL_MARKERS.map((m) => m.length)) - 1;

function listEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// Read the dll in chunks: a GSE build is over 10 MB and there is no reason to hold one in memory.
// Chunks overlap by the longest marker so a hit that straddles a boundary is still found.
function dllIsEmulated(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const chunk = Buffer.alloc(Math.min(size, 256 * 1024));
    let position = 0;
    let carry = '';
    while (position < size) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, position);
      if (read <= 0) break;
      const text = carry + chunk.toString('latin1', 0, read);
      if (EMULATED_DLL_MARKERS.some((marker) => text.includes(marker))) return true;
      carry = text.slice(-MARKER_OVERLAP);
      position += read;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

// Shallow on purpose: the dll sits next to the binary (`bin/win64`, `Game_Data/Plugins/x86_64`), and
// this only has to answer "was this Steam install tampered with", not map the whole tree.
function hasEmulatedSteamApi(gameDir, depth = 0) {
  const entries = listEntries(gameDir);
  if (!entries) return false;
  for (const entry of entries) {
    if (entry.isFile() && STEAM_API_DLL.test(entry.name) && dllIsEmulated(path.join(gameDir, entry.name))) return true;
  }
  if (depth >= 3) return false;
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.toLowerCase() !== 'steam_settings' && hasEmulatedSteamApi(path.join(gameDir, entry.name), depth + 1)) return true;
  }
  return false;
}

/*
  Games Steam itself installed, keyed by their `installdir`, for one `steamapps` folder. The folder's
  own mtime changes whenever a manifest is added or removed, so it is enough to key the cache on.
*/
const manifestCache = new Map();

function steamManagedNames(steamapps) {
  const key = steamapps.toLowerCase();
  let stamp;
  try {
    stamp = String(fs.statSync(steamapps).mtimeMs);
  } catch {
    return null;
  }
  const cached = manifestCache.get(key);
  if (cached && cached.stamp === stamp) return cached.names;

  const names = new Map();
  let files;
  try {
    files = fs.readdirSync(steamapps).filter((name) => /^appmanifest_\d+\.acf$/i.test(name));
  } catch {
    return null;
  }
  for (const file of files) {
    try {
      const manifest = fs.readFileSync(path.join(steamapps, file), 'utf8');
      const installDir = /"installdir"\s+"([^"]+)"/i.exec(manifest);
      if (installDir) names.set(installDir[1].trim().toLowerCase(), (/(\d+)/.exec(file) || [])[1]);
    } catch {
      /* skip one unreadable manifest */
    }
  }
  manifestCache.set(key, { stamp, names });
  return names;
}

/*
  The appid of the game Steam installed in this folder, or null.

  A Steam install is not recognisable from its contents: every Steam game ships steam_api64.dll and
  many (every Source game, for one) ship steam_appid.txt - exactly the two markers the emulator scan
  keys on, which is why Garry's Mod turned up as a cracked install. The authority is Steam's own
  appmanifest: it names the `steamapps/common` folder it owns.
*/
function steamLibraryAppid(gameDir) {
  let current = path.resolve(gameDir);
  // Accept a folder nested inside the install (`common/GarrysMod/bin/win64`), not just its root.
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(current);
    if (!parent || parent === current) return null;
    if (path.basename(parent).toLowerCase() === 'common') {
      const steamapps = path.dirname(parent);
      if (path.basename(steamapps).toLowerCase() !== 'steamapps') return null;
      const names = steamManagedNames(steamapps);
      return (names && names.get(path.basename(current).toLowerCase())) || null;
    }
    current = parent;
  }
  return null;
}

// True when the folder is owned by an official launcher (and therefore must not be offered as an
// unconfigured/local game, nor promoted as a Uplay R2 emulated install).
function isOfficialLauncherInstall(gameDir) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  const entries = listEntries(gameDir);
  if (!entries) return false;

  const names = new Set(entries.map((e) => e.name));

  // Steam owns this folder per its own manifest. Same shape as the Ubisoft case below: a game
  // cracked in place keeps the manifest but runs on a replaced steam_api dll, so keep that one.
  if (steamLibraryAppid(gameDir) && !hasEmulatedSteamApi(gameDir)) return true;

  // Ubisoft Connect legit installs carry launcher markers but never the emulator's loader dlls.
  // Only pay for the loader walk (bounded depth) when the markers are actually present.
  const hasUplayMarker =
    names.has('uplay_install.state') || names.has('uplay_install.manifest') || names.has('upc.cfg');
  if (hasUplayMarker) {
    try {
      const loader = require('./uplayR2.js').detectEmulator(gameDir);
      if (loader.dll.length > 0) return false; // real Uplay R2 emulated install - keep it
    } catch {
      /* if the loader detector fails, treat it as legit rather than risk a false positive */
    }
    return true;
  }

  if (entries.some((e) => e.isFile() && GOG_GAME_FILE.test(e.name))) return true;
  if (entries.some((e) => e.isDirectory() && e.name.toLowerCase() === '.egstore')) return true;
  if (names.has('AppxManifest.xml')) return true;

  return false;
}

module.exports = { isOfficialLauncherInstall, steamLibraryAppid, hasEmulatedSteamApi };
