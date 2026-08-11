'use strict';

const { crc32 } = require('crc');

function normalizeApiName(value) {
  return String(value == null ? '' : value).toUpperCase();
}

function savedApiName(entry, fallback) {
  return entry.id || entry.apiname || entry.name || entry.AchievementId || fallback;
}

// One save can contain hundreds of achievement records. Keep Array.find's first-match semantics,
// but construct the schema lookup once for the whole save instead of rescanning it per record.
function buildAchievementSchemaIndex(entries, { includeCrc = false } = {}) {
  const byApiName = new Map();
  const crcEntries = [];

  for (const achievement of Array.isArray(entries) ? entries : []) {
    if (!achievement || achievement.name == null) continue;
    const name = achievement.name;
    const normalized = normalizeApiName(name);
    if (!byApiName.has(normalized)) byApiName.set(normalized, achievement);
    if (includeCrc) crcEntries.push({ checksum: crc32(name).toString(16), achievement });
  }

  return { byApiName, crcEntries };
}

function findAchievementInSchema(index, savedEntry, fallback) {
  if (!index) return undefined;

  if (savedEntry && savedEntry.crc) {
    return index.crcEntries.find(({ checksum }) => savedEntry.crc.includes(checksum))?.achievement;
  }

  return index.byApiName.get(normalizeApiName(savedApiName(savedEntry || {}, fallback)));
}

module.exports = {
  buildAchievementSchemaIndex,
  findAchievementInSchema,
  savedApiName,
};
