'use strict';

/*
  Recognise official launcher installs (Ubisoft Connect, GOG Galaxy, Epic, Microsoft Store) by their
  on-disk markers so the broad "Unconfigured" scan skips them — they are already listed by the official
  sources. A cracked Uplay R2 install keeps launcher markers but also ships its loader DLL, which is
  what tells the two apart.
*/

const fs = require('fs');
const path = require('path');

const GOG_GAME_FILE = /^goggame-\d+\.(?:info|id)$/i;

function listEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// True when the folder is owned by an official launcher (and therefore must not be offered as an
// unconfigured/local game, nor promoted as a Uplay R2 emulated install).
function isOfficialLauncherInstall(gameDir) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  const entries = listEntries(gameDir);
  if (!entries) return false;

  const names = new Set(entries.map((e) => e.name));

  // Ubisoft Connect legit installs carry launcher markers but never the emulator's loader dlls.
  // Only pay for the loader walk (bounded depth) when the markers are actually present.
  const hasUplayMarker =
    names.has('uplay_install.state') || names.has('uplay_install.manifest') || names.has('upc.cfg');
  if (hasUplayMarker) {
    try {
      const loader = require('./uplayR2.js').detectEmulator(gameDir);
      if (loader.dll.length > 0) return false; // real Uplay R2 emulated install — keep it
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

module.exports = { isOfficialLauncherInstall };
