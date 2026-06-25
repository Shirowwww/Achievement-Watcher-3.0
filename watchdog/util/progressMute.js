'use strict';

// Read-only view of the per-game progress-mute store the app writes (<cfg>/progressMute.json, next to
// options.ini). Cached ~2s so toggling in the app takes effect without restarting the Watchdog, but a
// progress event never pays a disk read more than once every couple of seconds.

const fs = require('fs');
const path = require('path');

let cache = { at: 0, set: new Set() };

// optionPath is the loaded options.ini path; the mute file lives in the same cfg folder.
module.exports.isMuted = (appid, optionPath) => {
  if (!appid || !optionPath) return false;
  const now = Date.now();
  if (now - cache.at > 2000) {
    cache.at = now;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(path.dirname(optionPath), 'progressMute.json'), 'utf8'));
      cache.set = new Set((Array.isArray(arr) ? arr : []).map(String));
    } catch {
      cache.set = new Set();
    }
  }
  return cache.set.has(String(appid));
};
