'use strict';

// Per-game progress-notification mute store. A small JSON array of appids living next to options.ini
// (<userData>/cfg/progressMute.json). The renderer toggles it from the game context menu; the Watchdog
// reads the same file (watchdog/util/progressMute.js) when deciding whether to fire a progress toast.

const fs = require('fs');
const path = require('path');

let cfgDir = null;
module.exports.setUserDataPath = (p) => {
  if (p) cfgDir = path.join(p, 'cfg');
};

function file() {
  return path.join(cfgDir || '', 'progressMute.json');
}

function read() {
  try {
    const a = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return new Set((Array.isArray(a) ? a : []).map(String));
  } catch {
    return new Set();
  }
}

module.exports.isMuted = (appid) => read().has(String(appid));

module.exports.toggle = (appid) => {
  const set = read();
  const key = String(appid);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify([...set]), 'utf8');
  } catch {
    /* best-effort: a failed write just leaves the previous state */
  }
  return set.has(key);
};
