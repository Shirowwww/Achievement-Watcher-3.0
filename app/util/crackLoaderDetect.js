'use strict';

/*
  Detect a game folder that is already made to work by a crack loader AW must not touch.

  Some loaders (OnlineFix.me is the confirmed case) hook the game's *existing* steam_api(64).dll in
  place instead of replacing it, and run their own Steamworks/EOS emulation layer on top. AW's
  automatic emulator fix used to have no way to tell that apart from a genuinely unconfigured Goldberg
  candidate, so it would swap that steam_api(64).dll for a GBE Fork build and break the loader's hook —
  the game would then fail its own ownership/EOS handshake at the next launch (e.g. OnlineFix's
  "Steamworks Fix Activation" prompt, or an EOS_Connect_CreateDeviceId failure), even though it worked
  fine before AW touched it.

  This is a read-only, top-level-only marker check (loaders drop their files next to the game exe, not
  buried in a nested engine folder) — pure and cheap enough to call on every automatic-fix decision.
*/

const fs = require('fs');

// One entry per known loader: `markers` are exact, case-insensitive basenames looked for directly in
// the game folder. Extend this list if another loader turns out to need the same protection.
const KNOWN_CRACK_LOADERS = [
  { name: 'OnlineFix', markers: ['onlinefix64.dll', 'onlinefix32.dll', 'onlinefix.dll', 'onlinefix.ini'] },
];

/*
  Return { name } for the first known crack loader whose marker file(s) exist directly in `gameDir`, or
  null if none match (including when gameDir is missing/unreadable). Only looks at the top level: a
  marker nested in a Data/Plugins subfolder is not this loader's own drop point and would false-positive
  on games that merely reference the string in an asset.
*/
function detectWorkingCrackLoader(gameDir) {
  if (!gameDir) return null;
  let entries;
  try {
    entries = fs.readdirSync(gameDir);
  } catch {
    return null;
  }
  const present = new Set(entries.map((e) => e.toLowerCase()));
  for (const loader of KNOWN_CRACK_LOADERS) {
    if (loader.markers.some((marker) => present.has(marker))) return { name: loader.name };
  }
  return null;
}

function hasWorkingCrackLoader(gameDir) {
  return !!detectWorkingCrackLoader(gameDir);
}

module.exports = { detectWorkingCrackLoader, hasWorkingCrackLoader };
