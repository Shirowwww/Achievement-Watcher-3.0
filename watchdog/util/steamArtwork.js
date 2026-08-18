'use strict';

/*
  Resolve Steam game artwork for notifications: prefer the resolved URLs the app caches during scans
  (schema, store, SteamDB covers), falling back to the predictable legacy CDN URLs.
*/

const fs = require('fs');
const path = require('path');
const { userDataDir } = require('./userData.js');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isImageUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) && /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(value);
}

// The app seeds `store.portrait` with a guessable path that 404s for modern titles; never treat
// that placeholder as a resolved asset.
function isKnownPlaceholder(value) {
  return typeof value === 'string' && /\/portrait\.png(?:$|[?#])/i.test(value);
}

// Predictable `/steam/apps/<id>/…` URLs 404 on newer titles whose real assets live under hashed
// store_item_assets paths. A resolved/custom URL (anything else) is always preferred as-is.
function isPredictableLegacySteamUrl(value) {
  return (
    typeof value === 'string' &&
    /\/steam\/apps\/\d+\/(?:header|library_600x900|library_capsule)\.(?:jpe?g|png)/i.test(value)
  );
}

// A real, non-placeholder image URL - worth using, but may still be a legacy-shaped guess.
function isUsableArt(value) {
  return isImageUrl(value) && !isKnownPlaceholder(value);
}

// Usable *and* not a legacy-shaped guess likely to 404 on modern titles - the best tier.
function isResolvedArt(value) {
  return isUsableArt(value) && !isPredictableLegacySteamUrl(value);
}

// Keyed by resolved file path so tests using temp roots never see stale cached art, and so a game
// re-scanned mid-session (new schema/store/cover json written) picks up the change on its next read.
const jsonFileCache = new Map();

function readJsonCached(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const key = path.resolve(filePath);
  const cached = jsonFileCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
  const data = readJson(filePath);
  jsonFileCache.set(key, { mtimeMs: stat.mtimeMs, data });
  return data;
}

// The app normally caches the english schema, but a fresh install may only have the user's
// language. Search any language directory so the resolved header/portrait is still found.
function findSchemaArtFile(root, appid) {
  const schemaRoot = path.join(root, 'steam_cache', 'schema');
  const english = path.join(schemaRoot, 'english', `${appid}.db`);
  if (fs.existsSync(english)) return english;
  try {
    const dirs = fs.readdirSync(schemaRoot, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const candidate = path.join(schemaRoot, dir.name, `${appid}.db`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* schema dir is optional */
  }
  return null;
}

function cachedSchemaArt(appid, root) {
  const file = findSchemaArtFile(root, appid);
  if (!file) return null;
  const data = readJsonCached(file);
  return data && typeof data.img === 'object' && data.img ? data.img : null;
}

function cachedStoreArt(appid, root) {
  return readJsonCached(path.join(root, 'steam_cache', 'store', `${appid}.json`));
}

function cachedSteamDbPortrait(appid, root) {
  const single = readJsonCached(path.join(root, 'steam_cache', 'steamdb_cover', `${appid}.json`));
  if (single && isImageUrl(single.url)) return single.url;

  const list = readJsonCached(path.join(root, 'steam_cache', 'steamdb_covers', `${appid}.json`));
  if (list && Array.isArray(list.urls)) {
    const urls = list.urls.filter(isImageUrl);
    return (
      urls.find((url) => /library_600x900/i.test(url)) ||
      urls.find((url) => /library_capsule/i.test(url)) ||
      urls[0] ||
      null
    );
  }
  return null;
}

function normalizedAppid(appid) {
  const id = String(appid == null ? '' : appid).trim();
  return /^\d+$/.test(id) ? id : '';
}

function steamHeaderImage(appid, options = {}) {
  const id = normalizedAppid(appid);
  if (!id) return undefined;
  const root = options.userDataRoot || userDataDir();

  const schemaImg = cachedSchemaArt(id, root);
  const schemaHeader = schemaImg && isUsableArt(schemaImg.header) ? schemaImg.header : null;
  if (schemaHeader && isResolvedArt(schemaHeader)) return schemaHeader;

  const store = cachedStoreArt(id, root);
  if (store && isResolvedArt(store.header)) return store.header;
  if (schemaHeader) return schemaHeader;
  if (store && isUsableArt(store.header)) return store.header;

  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
}

function steamLibraryImage(appid, options = {}) {
  const id = normalizedAppid(appid);
  if (!id) return undefined;
  const root = options.userDataRoot || userDataDir();

  const schemaImg = cachedSchemaArt(id, root);
  const schemaPortrait = schemaImg && isUsableArt(schemaImg.portrait) ? schemaImg.portrait : null;
  if (schemaPortrait && isResolvedArt(schemaPortrait)) return schemaPortrait;

  const steamdb = cachedSteamDbPortrait(id, root);
  if (steamdb) return steamdb;
  if (schemaPortrait) return schemaPortrait;

  const store = cachedStoreArt(id, root);
  if (store && isResolvedArt(store.portrait)) return store.portrait;

  // Modern titles put their real (hashed) store assets under store_item_assets. When no portrait
  // has been resolved yet, the landscape header is still far sharper than Steam's 32×32 clienticon.
  if (store && isResolvedArt(store.header)) return store.header;

  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
}

module.exports = { steamHeaderImage, steamLibraryImage };
