'use strict';

// Per-game manual override for which emulator family the context menu offers: 'steam' (GBE Fork)
// or 'ubisoft' (Uplay R2). uplayR2.isUbisoftGame() guesses from on-disk markers, which can be wrong
// for a Ubisoft title repacked with both a steam_api dll and leftover Ubisoft engine files (e.g. a
// Steam-store Ubisoft remaster) — this lets the user force the correct tool from the right-click
// menu instead of fighting the heuristic. A small JSON map living next to options.ini
// (<userData>/cfg/emulatorSourceOverride.json), read/written only by the renderer's context menu.

const fs = require('fs');
const path = require('path');

let cfgDir = null;
module.exports.setUserDataPath = (p) => {
  if (p) cfgDir = path.join(p, 'cfg');
};

function file() {
  return path.join(cfgDir || '', 'emulatorSourceOverride.json');
}

function read() {
  try {
    const obj = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function write(map) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(map), 'utf8');
  } catch {
    /* best-effort: a failed write just leaves the previous state */
  }
}

// Returns 'steam' | 'ubisoft' | null (null = no override, fall back to auto-detection).
module.exports.get = (appid) => {
  const value = read()[String(appid)];
  return value === 'steam' || value === 'ubisoft' ? value : null;
};

// value: 'steam' | 'ubisoft' forces that source; anything else (e.g. null for "Automatic") clears it.
module.exports.set = (appid, value) => {
  const map = read();
  const key = String(appid);
  if (value === 'steam' || value === 'ubisoft') map[key] = value;
  else delete map[key];
  write(map);
};
