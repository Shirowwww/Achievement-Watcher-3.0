'use strict';

// Watchdog-side reader/fetcher for achievement rarity (global unlock %). Shares the exact same sidecar
// cache file as the renderer's app/util/rarity.js (steam_cache/rarity/<appid>.json), so whichever
// process fetches first warms the cache for the other instead of both hitting the network. Used to
// mark an unlock toast as "rare" when fewer than 10% of players have the achievement.

const fs = require('fs');
const path = require('path');
const request = require('request-zero');

const CACHE_DIR = path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'steam_cache', 'rarity');
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // matches app/util/rarity.js
const SOURCE = 'steam-global-achievement-percentages';

function cacheFile(appid) {
  return path.join(CACHE_DIR, `${appid}.json`);
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function readPayload(appid) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(appid), 'utf8'));
  } catch {
    return null;
  }
}

function payloadToMap(payload) {
  const map = new Map();
  const rows = payload && Array.isArray(payload.achievements) ? payload.achievements : [];
  for (const row of rows) {
    const name = row && row.name != null ? String(row.name).trim() : '';
    const percent = clampPercent(row && row.percent);
    if (name && percent !== null) map.set(name, percent);
  }
  return map;
}

// Synchronous, no freshness gate — instant lookup for the toast hot path.
function readRarityMap(appid) {
  return payloadToMap(readPayload(appid));
}

function writeCache(appid, entries) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload = {
      appid: String(appid),
      source: SOURCE,
      updatedAt: new Date().toISOString(),
      achievements: Array.isArray(entries) ? entries : [],
    };
    fs.writeFileSync(cacheFile(appid), JSON.stringify(payload), 'utf8');
  } catch {
    /* best-effort: a cache write failure must never break a toast */
  }
}

async function fetchSteamGlobal(appid) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${encodeURIComponent(
    appid
  )}&format=json`;
  const data = await request.getJson(url, { timeout: 8000 });
  const rows =
    data && data.achievementpercentages && Array.isArray(data.achievementpercentages.achievements)
      ? data.achievementpercentages.achievements
      : [];
  const out = [];
  for (const row of rows) {
    const name = row && row.name != null ? String(row.name).trim() : '';
    const percent = clampPercent(row && row.percent);
    if (name && percent !== null) out.push({ name, percent });
  }
  return out;
}

// Return a Map<achievementName, percent>. Hits the network only when the sidecar is missing or older
// than ttlMs; on any failure falls back to whatever is cached (possibly empty). Never throws — rarity
// is a non-essential enrichment of the toast.
async function getRarityMap(appid, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const payload = readPayload(appid);
  const age = payload && payload.updatedAt ? Date.now() - Date.parse(payload.updatedAt) : Infinity;
  const fresh = payload && age < ttlMs && Array.isArray(payload.achievements) && payload.achievements.length > 0;
  if (fresh) return payloadToMap(payload);

  try {
    const entries = await fetchSteamGlobal(appid);
    if (entries.length > 0) {
      writeCache(appid, entries);
      return payloadToMap({ achievements: entries });
    }
  } catch {
    /* fall through to stale cache */
  }
  return payloadToMap(payload);
}

module.exports = { readRarityMap, getRarityMap, cacheFile };
