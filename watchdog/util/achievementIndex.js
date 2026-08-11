'use strict';

const { crc32 } = require('crc');

function normalizeName(value) {
  return String(value == null ? '' : value).toUpperCase();
}

// The watchdog diff runs once for every parsed save update. Building these indexes once per scan
// avoids walking the whole schema and prior cache for every achievement while keeping Array.find's
// original "first matching entry wins" behaviour for duplicate names.
function buildSchemaIndex(entries, { includeCrc = false } = {}) {
  const byName = new Map();
  const crcEntries = [];

  for (const achievement of Array.isArray(entries) ? entries : []) {
    if (!achievement || achievement.name == null) continue;
    const name = String(achievement.name);
    const normalized = normalizeName(name);
    if (!byName.has(normalized)) byName.set(normalized, achievement);
    if (includeCrc) crcEntries.push({ checksum: crc32(name).toString(16), achievement });
  }

  return { byName, crcEntries };
}

function findSchemaAchievement(index, parsedAchievement) {
  if (!index || !parsedAchievement) return undefined;

  if (parsedAchievement.crc) {
    const crc = parsedAchievement.crc;
    return index.crcEntries.find(({ checksum }) => crc.includes(checksum))?.achievement;
  }

  return index.byName.get(normalizeName(parsedAchievement.name));
}

function buildPreviousAchievementIndex(entries) {
  const byName = new Map();
  let unlockedCount = 0;

  for (const achievement of Array.isArray(entries) ? entries : []) {
    if (!achievement) continue;
    if (achievement.Achieved == 1) unlockedCount += 1;
    // Array.find returned the first duplicate, so keep the first map entry as well.
    if (!byName.has(achievement.name)) byName.set(achievement.name, achievement);
  }

  return { byName, unlockedCount };
}

module.exports = {
  buildSchemaIndex,
  findSchemaAchievement,
  buildPreviousAchievementIndex,
};
