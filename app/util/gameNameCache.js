'use strict';

// Offline appid → game-name lookup over a local JSON dump, with an in-memory cache revalidated by
// file mtime+size so repeated lookups never re-read or re-parse an unchanged file.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/local-game-name-cache.js — MIT-licensed;
// see NOTICE.md. Adapted to Achievement Watcher: instead of bundling upstream's 7.9 MB
// assets/steamdb.json snapshot, the fallback source is the GetAppList dump the app already
// maintains at steam_cache/schema/appList.json (identical [{appid, name}] shape, refreshed every
// 3 days by the renderer, see steam.js findInAppList). An optional user-provided cfg/steamdb.json
// (same shape) takes precedence when present. The uplay-steam mapping half of the upstream module
// belongs to the Ubisoft-official integration (PORTING-PLAN §2.7/§2.9) and is not ported here.
//
// Limitation inherited from upstream: revalidation keys on mtime+size, so a same-size rewrite
// within the mtime granularity is not detected — fine for these slow-moving dumps.

const fs = require('fs');
const path = require('path');

const CACHE_BASE = path.join(process.env['APPDATA'] || '', 'Achievement Watcher');

// filePath -> { mtimeMs, size, value, index }
const jsonArrayCache = new Map();

// Read a JSON array file through the mtime+size revalidated cache. Returns [] for a missing,
// unreadable or non-array file. The returned array must be treated as immutable by callers.
function loadJsonArrayCached(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const stat = fs.statSync(filePath);
    const cacheKey = path.resolve(filePath);
    const cached = jsonArrayCache.get(cacheKey);
    if (cached && cached.mtimeMs === Number(stat.mtimeMs || 0) && cached.size === Number(stat.size || 0)) {
      return cached.value;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const value = Array.isArray(parsed) ? parsed : [];
    jsonArrayCache.set(cacheKey, {
      mtimeMs: Number(stat.mtimeMs || 0),
      size: Number(stat.size || 0),
      value,
      index: null, // built lazily on first lookup, invalidated with the entry
    });
    return value;
  } catch {
    return [];
  }
}

function resolveSteamDbRuntimePath(opts = {}) {
  const explicit = String(opts.runtimePath || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(CACHE_BASE, 'cfg', 'steamdb.json');
}

function resolveAppListFallbackPath(opts = {}) {
  const explicit = String(opts.fallbackPath || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(CACHE_BASE, 'steam_cache', 'schema', 'appList.json');
}

function pickSourcePath(opts) {
  const runtime = resolveSteamDbRuntimePath(opts);
  if (fs.existsSync(runtime)) return runtime;
  const fallback = resolveAppListFallbackPath(opts);
  if (fs.existsSync(fallback)) return fallback;
  return '';
}

// appid -> name Map derived from a loaded dump; cached on the same entry as the rows so it lives
// and dies with the mtime+size revalidation (upstream scans linearly; our appList has ~250k rows).
function getNameIndex(filePath) {
  const rows = loadJsonArrayCached(filePath);
  if (rows.length === 0) return null;
  const entry = jsonArrayCache.get(path.resolve(filePath));
  if (!entry) return null;
  if (!entry.index) {
    entry.index = new Map();
    for (const row of rows) {
      const id = String(row?.appid ?? '').trim();
      const name = String(row?.name ?? '').trim();
      if (id && name && !entry.index.has(id)) entry.index.set(id, name);
    }
  }
  return entry.index;
}

// Instant, offline appid → name lookup. Returns the name or null (never throws).
// opts: { runtimePath?, fallbackPath? } — explicit paths, mainly for tests.
function lookupSteamDbName(appid, opts = {}) {
  const id = String(appid ?? '').trim();
  if (!id) return null;
  const source = pickSourcePath(opts);
  if (!source) return null;
  const index = getNameIndex(source);
  return (index && index.get(id)) || null;
}

module.exports = {
  loadJsonArrayCached,
  lookupSteamDbName,
};
