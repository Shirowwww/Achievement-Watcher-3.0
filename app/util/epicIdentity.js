'use strict';

// Resolve NemirtingasEpicEmu artifact ids through egdata.app.
// The result supplies the namespace and title used by the official Epic parser.

const EGDATA_API_BASE = 'https://api.egdata.app';
const POSITIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // resolved identities rarely change
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // retry misses (offline, transient 5xx) sooner
const MAX_CACHE_ENTRIES = 512;

const identityCache = new Map();

function cleanId(value) {
  return String(value || '').trim();
}

function normalizePlatformList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const platform = String(value || '').trim();
  return platform ? [platform] : [];
}

// An asset with no platform tag at all is assumed Windows (most PC-crack artifact ids are).
function isWindowsAsset(asset) {
  const platforms = normalizePlatformList(asset?.platform || asset?.platforms);
  return platforms.length === 0 || platforms.some((p) => p.toLowerCase() === 'windows');
}

function unwrapPayload(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.data && typeof value.data === 'object') return value.data;
  if (value.asset && typeof value.asset === 'object') return value.asset;
  if (value.item && typeof value.item === 'object') return value.item;
  return value;
}

function pickDisplayName(item) {
  const candidates = [item?.title, item?.displayName, item?.name, item?.productName];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
}

async function egdataGet(pathname, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${EGDATA_API_BASE}${pathname}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Achievement-Watcher' },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveEpicArtifactIdentityUncached(sourceId, options) {
  const id = cleanId(sourceId);
  if (!/^[0-9a-fA-F]+$/.test(id)) return null; // artifact ids are always hex

  const assetRes = await egdataGet(`/assets/${encodeURIComponent(id)}`, options);
  if (assetRes.status === 404) return null;
  if (assetRes.status >= 400) throw new Error(`EGData asset lookup ${assetRes.status}`);

  const asset = unwrapPayload(assetRes.data);
  if (!asset || !isWindowsAsset(asset)) return null;

  const artifactId = cleanId(asset.artifactId || asset.appId || asset.appName);
  const internalAssetId = cleanId(asset._id || asset.id);
  // Guard against egdata serving an unrelated asset for a malformed/ambiguous id.
  if (!artifactId || (artifactId.toLowerCase() !== id.toLowerCase() && internalAssetId.toLowerCase() !== id.toLowerCase())) {
    return null;
  }

  const catalogItemId = cleanId(asset.itemId || asset.catalogItemId || asset.catalog_item_id);
  let namespace = cleanId(asset.namespace || asset.catalogNamespace || asset.catalog_namespace);
  let displayName = '';

  if (catalogItemId) {
    try {
      const itemRes = await egdataGet(`/items/${encodeURIComponent(catalogItemId)}`, options);
      if (itemRes.status >= 200 && itemRes.status < 300) {
        const item = unwrapPayload(itemRes.data);
        displayName = pickDisplayName(item);
        if (!namespace) namespace = cleanId(item?.namespace || item?.catalogNamespace || item?.catalog_namespace);
      }
    } catch {
      /* the asset lookup alone is still useful (namespace/artifactId) - displayName is best-effort */
    }
  }

  return { sourceId: id, artifactId, catalogItemId, namespace, displayName };
}

// Resolves + caches (positive/negative TTL, bounded LRU-ish eviction). Concurrent callers for the
// same id share one in-flight request instead of firing duplicate lookups.
async function resolveEpicArtifactIdentity(sourceId, options = {}) {
  const id = cleanId(sourceId);
  if (!id) return null;

  const key = id.toLowerCase();
  const cached = identityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) identityCache.delete(key);

  const cacheEntry = { expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS, promise: null };
  const pending = resolveEpicArtifactIdentityUncached(id, options).catch((err) => {
    identityCache.delete(key);
    throw err;
  });
  cacheEntry.promise = pending.then((identity) => {
    cacheEntry.expiresAt = Date.now() + (identity ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS);
    return identity;
  });
  identityCache.set(key, cacheEntry);
  while (identityCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = identityCache.keys().next().value;
    if (!oldestKey) break;
    identityCache.delete(oldestKey);
  }
  return cacheEntry.promise;
}

function clearEpicIdentityCache() {
  identityCache.clear();
}

module.exports = { resolveEpicArtifactIdentity, clearEpicIdentityCache };
