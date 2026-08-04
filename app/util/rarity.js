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
// Uses the Fetch API provided by the supported Electron/Node runtime.

const fs = require('fs');
const path = require('path');
const { resolveEpicArtifactIdentity } = require('./epicIdentity.js');

const CACHE_DIR = path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'steam_cache', 'rarity');
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — global unlock % drifts slowly, no need to refetch per view
const DEFAULT_TIMEOUT_MS = 8000;

const RARITY_SOURCES = Object.freeze({
  steam: 'steam-global-achievement-percentages',
  epic: 'epic-public-achievement-percentages',
  gog: 'gog-gameplay-achievement-percentages',
  exophase: 'exophase',
});

// Sources whose native id is NOT a Steam AppID and whose rarity sidecar is seeded locally
// (Ubisoft official bridge, GOG/Epic official, Lumaplay, EA). They must never be handed to the
// Steam global-percentages endpoint: a namespaced or native id would just burn a failing request
// and the caller keeps whatever its own sidecar already knows.
const CACHE_ONLY_SOURCES = new Set([
  'epic-official',
  'gog-official',
  'GOG Galaxy',
  'Ubisoft Connect',
  'uplay',
  'uPlay',
  'Lumaplay',
  'ea',
  'Xbox PC',
]);

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
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
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

// `appid` here is parser/epic.js's NemirtingasEpicEmu artifact id (a hex string), not the Epic
// productId the public achievements endpoint expects — resolve the real productId (catalogItemId)
// via egdata.app first so legacy Epic-emu installs get real rarity instead of a near-always-empty
// lookup against the wrong id. Falls back to the raw id when resolution fails (unchanged behavior).
async function fetchEpicRarityByArtifactId(appid, options = {}) {
  let productId = appid;
  try {
    const identity = await resolveEpicArtifactIdentity(appid);
    if (identity?.catalogItemId) productId = identity.catalogItemId;
  } catch {
    /* identity lookup is best-effort — fall back to the raw id below */
  }
  return fetchEpicGlobalAchievementPercentages(productId, options);
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

function platformFromSource(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('rpcs3')) return 'rpcs3';
  if (s.includes('shadps4')) return 'shadps4';
  if (s.includes('xenia')) return 'xenia';
  return '';
}

function fetchForSource(appid, source, options) {
  const platform = platformFromSource(source);
  if (platform) {
    // Emulator rarity comes from Exophase (global unlock % per trophy/achievement). It needs the
    // game name for slug lookup and the schema list to map awards back to achievement ids.
    if (!options.gameName || !Array.isArray(options.achievements)) return Promise.resolve([]);
    return require(path.join(__dirname, '../parser/exophase.js')).fetchExophaseRarity({
      gameName: options.gameName,
      platform,
      achievements: options.achievements,
    });
  }
  if (source === 'epic') return fetchEpicRarityByArtifactId(appid, options);
  if (source === 'gog') return fetchGogGlobalAchievementPercentages(appid, options);
  if (CACHE_ONLY_SOURCES.has(source)) return Promise.resolve([]);
  return fetchSteamGlobalAchievementPercentages(appid, options);
}

// Steam apinames for Ubisoft ports are usually "Ach_<id>"/"ACH_<id>" or "<something>_<id>"; strip
// down to the trailing number so they can be matched to the native numeric ids used by the
// Ubisoft archive/LumaPlay schemas.
function normalizeSteamBridgeName(name) {
  let result = String(name || '').trim();
  const ach = result.match(/Ach_(.+)$/i);
  if (ach && ach[1]) result = ach[1];
  const trailing = result.match(/^(.*)_(\d+)$/);
  if (trailing && trailing[1] && /[A-Za-z]/.test(trailing[1])) result = trailing[2];
  return result;
}

// Fetch Steam global percentages for a Steam release and re-key them onto the caller's native
// achievement ids (the shared Steam↔Ubisoft bridge). Returns [{name, percent}] where `name` is the
// caller's own id, or [] when nothing maps (or the ids are not numeric-friendly).
async function fetchSteamBridgeEntries(steamAppId, names, options = {}) {
  if (!/^\d+$/.test(String(steamAppId || '').trim())) return [];
  const list = Array.isArray(names) ? names : [];
  if (list.length === 0) return [];
  const steamEntries = await fetchSteamGlobalAchievementPercentages(steamAppId, options);
  if (!Array.isArray(steamEntries) || steamEntries.length === 0) return [];
  const byNormalized = new Map(steamEntries.map((e) => [normalizeSteamBridgeName(e.name), e.percent]));
  const out = [];
  for (const name of list) {
    const key = String(name == null ? '' : name).trim();
    if (!key || !byNormalized.has(key)) continue;
    out.push({ name: key, percent: byNormalized.get(key) });
  }
  return out;
}

// Cache-aware bridge lookup: same sidecar/TTL semantics as getRarityEntries, but keyed on the
// caller's cacheId (e.g. "uplay-8006") with entries already translated onto the native ids. Used by
// the detail view and by the Ubisoft official parser's seed so both share one code path.
async function getSteamBridgeRarity(cacheId, steamAppId, names, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const cached = readRarityCache(cacheId);
  const fresh = cached && Date.now() - cached.updatedAt < ttlMs && cached.entries.length > 0;
  if (fresh && !options.forceRefresh) return cached.entries;
  try {
    const entries = await fetchSteamBridgeEntries(steamAppId, names, options);
    if (entries.length > 0) {
      writeRarityCache(cacheId, entries, 'steam');
      return entries;
    }
  } catch {
    /* network failed — fall through to stale cache below */
  }
  return cached ? cached.entries : [];
}

// Decide how (and whether) a game's detail view gets global unlock percentages. Every source that
// can be reconciled back to Steam gets the same Steam community column as a native Steam game:
//   - Uplay R2 keeps the Steam AppID directly and its schema already uses Steam API names;
//   - official Ubisoft Connect / Lumaplay use a namespaced appid + native numeric ids, so they go
//     through the Steam↔id bridge cache (seeded by the parser, refreshed by the renderer);
//   - Epic installs with a known Steam release borrow the Steam percentages.
// Sources without a Steam counterpart keep their own rarity (Epic/GOG/console emulators) and EA
// (which has none) resolves to null (the column stays hidden).
function resolveGameRarityContext(game, options = {}) {
  if (!game || !game.achievement || !Array.isArray(game.achievement.list)) return null;
  const system = String(game.system || '').toLowerCase();
  const appid = String(game.appid == null ? '' : game.appid);
  const steamappid = String(game.steamappid == null ? '' : game.steamappid);
  const source = String(game.source || '');
  const emulatorSources = options.emulatorSources || new Set();

  if (source === 'Xbox PC') return { kind: 'xbox' };
  if (emulatorSources.has(source)) return { kind: 'emulator', source };

  // Official Ubisoft Connect / Lumaplay: namespaced appid ("uplay-…"/"UPLAY…") whose schema names
  // are native numeric ids — the Steam percentages live in the bridge cache keyed on this appid.
  if (system === 'uplay' && !/^\d+$/.test(appid) && /^\d+$/.test(steamappid)) {
    return {
      kind: 'steam-bridge',
      cacheId: game.appid,
      steamAppId: game.steamappid,
      names: game.achievement.list.map((a) => a && a.name),
    };
  }

  // Goldberg Uplay R2 already carries the Steam AppID and its schema uses Steam API names.
  if (system === 'uplay' && /^\d+$/.test(appid)) {
    return { kind: 'steam', appid };
  }

  // Legacy Epic installs mapped to a Steam release use Steam percentages, like their Steam siblings.
  if (source === 'epic' && /^\d+$/.test(steamappid)) {
    return { kind: 'steam', appid: steamappid };
  }

  // Sources that seed their own rarity sidecar (Epic/GOG official + legacy). Checked before the
  // generic Steam-family branch because a GOG product id is numeric too.
  if (source === 'GOG Galaxy' || source === 'epic-official' || source === 'epic' || source === 'gog') {
    return { kind: 'native', appid: game.appid, source };
  }

  // Steam-family sources (legit Steam + Steam emulators): the appid is a real Steam AppID.
  if (!system && /^\d+$/.test(appid)) {
    return { kind: 'steam', appid };
  }

  return null;
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
  normalizeSteamBridgeName,
  fetchEpicRarityByArtifactId,
  fetchSteamGlobalAchievementPercentages,
  fetchEpicGlobalAchievementPercentages,
  fetchGogGlobalAchievementPercentages,
  fetchSteamBridgeEntries,
  cacheFilePath,
  readRarityCache,
  readRarityCacheEntries,
  writeRarityCache,
  getRarityEntries,
  getSteamBridgeRarity,
  resolveGameRarityContext,
};
