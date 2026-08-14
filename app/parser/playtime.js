'use strict';

const { readRegistryInteger, writeRegistryDword } = require('../util/reg');

// Read side of the playtime counters the Watchdog writes in watchdog/playtime/track.js — the two
// must name the same registry key. Counters recorded under the older "Achievement Watcher" and
// "Achievement Watcher 3.0" namespaces are copied here once by migratePlaytimeRegistry().
const PLAYTIME_KEY = 'Software/Achievement Watcher Next/Playtime/Steam/';

module.exports = async (appID) => {
  const current = +readRegistryInteger('HKCU', PLAYTIME_KEY + appID, 'total') || 0;
  const last = +readRegistryInteger('HKCU', PLAYTIME_KEY + appID, 'last') || 0;
  return { playtime: current, lastplayed: last };
};

// Synchronous "last played" unix timestamp (0 if untracked). Used when building the game list so a
// "recently played" sort has its value available on the tile at creation time. Registry reads are
// in-process (registry-js) and cheap; guarded so a missing key can never break the list build.
module.exports.lastPlayedSync = (appID) => {
  try {
    return +readRegistryInteger('HKCU', PLAYTIME_KEY + appID, 'last') || 0;
  } catch {
    return 0;
  }
};

module.exports.reset = async (appID) => {
  const path = `${PLAYTIME_KEY}${appID}`;
  await writeRegistryDword('HKCU', path, 'total', 0);
  await writeRegistryDword('HKCU', path, 'last', 0);
};
