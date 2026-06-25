'use strict';

const { readRegistryInteger, writeRegistryDword } = require('../util/reg');

module.exports = async (appID) => {
  const current = +readRegistryInteger('HKCU', 'Software/Achievement Watcher/Playtime/Steam/' + appID, 'total') || 0;
  const last = +readRegistryInteger('HKCU', 'Software/Achievement Watcher/Playtime/Steam/' + appID, 'last') || 0;
  return { playtime: current, lastplayed: last };
};

// Synchronous "last played" unix timestamp (0 if untracked). Used when building the game list so a
// "recently played" sort has its value available on the tile at creation time. Registry reads are
// in-process (registry-js) and cheap; guarded so a missing key can never break the list build.
module.exports.lastPlayedSync = (appID) => {
  try {
    return +readRegistryInteger('HKCU', 'Software/Achievement Watcher/Playtime/Steam/' + appID, 'last') || 0;
  } catch {
    return 0;
  }
};

module.exports.reset = async (appID) => {
  const path = `Software/Achievement Watcher/Playtime/Steam/${appID}`;
  await writeRegistryDword('HKCU', path, 'total', 0);
  await writeRegistryDword('HKCU', path, 'last', 0);
};
