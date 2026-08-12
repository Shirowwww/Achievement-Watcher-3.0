'use strict';

/*
  Detect folders already handled by a crack loader AW must not touch: loaders like OnlineFix hook the
  existing steam_api(64).dll in place, so swapping in GBE Fork would break their handshake. Read-only,
  top-level marker check, cheap enough for every auto-fix decision.
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
