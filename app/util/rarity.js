'use strict';

// Generalized achievement-rarity aggregation (ported from reference-Achievements/achievement-rarity.js).
//
// "Rarity" = the global unlock percentage of an achievement across all players. The renderer already
// fetched this live from Steam/Epic on every game view (app/ui/game.js getGlobalStat), but it was
// never persisted: each visit paid a fresh network round-trip and the panel showed nothing offline.
// This module is the shared, persisted layer:
//   - one fetcher per platform (Steam global %, Epic public %, GOG gameplay %),
//   - a normalized {name, percent} shape regardless of source,
//   - a per-appid sidecar cache (steam_cache/rarity/<appid>.json) with a TTL so repeat views and
//     offline launches render instantly and the network is only hit when the cache is stale.
//
// Uses node-fetch (already an app dependency) rather than axios to avoid a new dependency.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CACHE_DIR = path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'steam_cache', 'rarity');
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — global unlock % drifts slowly, no need to refetch per view
const DEFAULT_TIMEOUT_MS = 8000;

const RARITY_SOURCES = Object.freeze({
  steam: 'steam-global-achievement-percentages',
  epic: 'epic-public-achievement-percentages',
  gog: 'gog-gameplay-achievement-percentages',
});

// Clamp anything the APIs hand back to a sane 0–100 number, tolerating "12,3" style decimals.
function normalizeRarityPercent(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
  }
  return null;
}

async function getJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers } = {}) {
  // node-fetch v2 honors a native `timeout` (ms), so no AbortController is needed — keeps this working
  // regardless of the host Node version exposing a global AbortController.
  const res = await fetch(url, { timeout: timeoutMs, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- platform fetchers: each resolves to [{ name, percent }] keyed by the achievement apiname ----

async function fetchSteamGlobalAchievementPercentages(appid, options = {}) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${encodeURIComponent(
    appid
  )}&format=json`;
  const data = await getJson(url, options);
  const rows = Array.isArray(data?.achievementpercentages?.achievements) ? data.achievementpercentages.achievements : [];
  const out = [];
  for (const row of rows) {
    const name = row?.name != null ? String(row.name).trim() : '';
    const percent = normalizeRarityPercent(row?.percent);
    if (name && percent !== null) out.push({ name, percent });
  }
  return out;
}

async function fetchEpicGlobalAchievementPercentages(productId, options = {}) {
  const locale = String(options.locale || 'en-us').trim() || 'en-us';
  const url = `https://api.epicgames.dev/epic/achievements/v1/public/achievements/product/${encodeURIComponent(
    productId
  )}/locale/${encodeURIComponent(locale)}?includeAchievements=true`;
  const data = await getJson(url, options);
  const rows = Array.isArray(data?.achievements) ? data.achievements : [];
  const out = [];
  for (const row of rows) {
    const ach = row?.achievement || row || {};
    const name = ach?.name != null ? String(ach.name).trim() : ach?.id != null ? String(ach.id).trim() : '';
    const percent = normalizeRarityPercent(ach?.rarity?.percent ?? row?.rarity?.percent);
    if (name && percent !== null) out.push({ name, percent });
  }
  return out;
}

// GOG gameplay % requires a logged-in user id + access token (the desktop client's). When those are
// not available the caller simply gets an empty set — rarity is a non-essential enrichment.
async function fetchGogGlobalAchievementPercentages(productId, options = {}) {
  const userId = String(options.userId || '').trim();
  const accessToken = String(options.accessToken || '').trim();
  if (!productId || !userId || !accessToken) return [];
  const url = `https://gameplay.gog.com/clients/${encodeURIComponent(productId)}/users/${encodeURIComponent(
    userId
  )}/achievements`;
  const data = await getJson(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': String(options.lang || 'en-US') },
  });
  const rows = Array.isArray(data?.items) ? data.items : [];
  const out = [];
  for (const row of rows) {
    const name =
      row?.achievement_key != null
        ? String(row.achievement_key).trim()
        : row?.achievement_id != null
        ? String(row.achievement_id).trim()
        : '';
    const percent = normalizeRarityPercent(row?.rarity);
    if (name && percent !== null) out.push({ name, percent });
  }
  return out;
}

function fetchForSource(appid, source, options) {
  if (source === 'epic') return fetchEpicGlobalAchievementPercentages(appid, options);
  if (source === 'gog') return fetchGogGlobalAchievementPercentages(appid, options);
  return fetchSteamGlobalAchievementPercentages(appid, options);
}

function sourceTag(source) {
  return RARITY_SOURCES[source] || RARITY_SOURCES.steam;
}

// ---- per-appid sidecar cache ----

function cacheFilePath(appid) {
  return path.join(CACHE_DIR, `${appid}.json`);
}

// Synchronous read of whatever is on disk (no freshness gate) — used for the instant first paint so a
// repeat/offline view never flashes an unranked list while the network refresh is in flight.
function readRarityCacheEntries(appid) {
  try {
    const payload = JSON.parse(fs.readFileSync(cacheFilePath(appid), 'utf8'));
    return Array.isArray(payload?.achievements) ? payload.achievements : [];
  } catch {
    return [];
  }
}

function readRarityCache(appid) {
  try {
    const payload = JSON.parse(fs.readFileSync(cacheFilePath(appid), 'utf8'));
    return {
      entries: Array.isArray(payload?.achievements) ? payload.achievements : [],
      source: typeof payload?.source === 'string' ? payload.source : RARITY_SOURCES.steam,
      updatedAt: Date.parse(payload?.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeRarityCache(appid, entries, source) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload = {
      appid: String(appid),
      source: sourceTag(source),
      updatedAt: new Date().toISOString(),
      achievements: Array.isArray(entries) ? entries : [],
    };
    fs.writeFileSync(cacheFilePath(appid), JSON.stringify(payload), 'utf8');
  } catch {
    /* cache is best-effort; a write failure must never break the rarity render */
  }
}

// High-level entry point: return [{name, percent}] for an appid, hitting the network only when the
// sidecar cache is missing or older than ttlMs. On a network failure, fall back to stale cache so the
// panel still shows the last-known rarity (offline-friendly). Never throws.
async function getRarityEntries(appid, source = 'steam', options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const cached = readRarityCache(appid);
  const fresh = cached && Date.now() - cached.updatedAt < ttlMs && cached.entries.length > 0;
  if (fresh && !options.forceRefresh) return cached.entries;

  try {
    const entries = await fetchForSource(appid, source, options);
    if (entries.length > 0) {
      writeRarityCache(appid, entries, source);
      return entries;
    }
  } catch {
    /* network failed — fall through to stale cache below */
  }
  return cached ? cached.entries : [];
}

module.exports = {
  RARITY_SOURCES,
  normalizeRarityPercent,
  fetchSteamGlobalAchievementPercentages,
  fetchEpicGlobalAchievementPercentages,
  fetchGogGlobalAchievementPercentages,
  cacheFilePath,
  readRarityCache,
  readRarityCacheEntries,
  writeRarityCache,
  getRarityEntries,
};
