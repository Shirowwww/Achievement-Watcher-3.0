'use strict';

/*
  Distinguish launcher-managed (legit/official) game installs from emulated or unconfigured ones.

  The "Unconfigured" scan matches on "this folder contains a game .exe", which is intentionally
  broad — that is how bare cracks get found. But a legit install from Ubisoft Connect, GOG Galaxy,
  Epic Games or the Microsoft Store ALSO matches that rule, and surfacing those as "Unconfigured"
  produces duplicates (the official sources already list them) and offers useless repairs. This
  module recognises the official launchers by their on-disk markers, so those folders are skipped
  no matter where they live (custom library roots included).

  Markers:
    - Ubisoft Connect : uplay_install.state / uplay_install.manifest / upc.cfg, WITHOUT a Uplay R2
      loader dll. A cracked Uplay R2 install keeps the launcher markers AND ships the loader, so the
      loader is what tells the two apart.
    - GOG Galaxy       : goggame-<id>.info / goggame-<id>.id files.
    - Epic Games       : a .egstore metadata folder inside the install.
    - Microsoft Store  : AppxManifest.xml (MSIX package root).
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
