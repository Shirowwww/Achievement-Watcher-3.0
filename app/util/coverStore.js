'use strict';

// Per-appid cover-art overrides. A small JSON map { "<appid>": "<file:// or http(s) url>" } stored in
// cfg/covers.db. When an entry exists it takes precedence over the normal Steam/emulator cover, so a
// user can fix a mis-matched cracked game (wrong AppID), point at a local image, or force a redownload.
// Pure fs/JSON - no Electron - so it is usable from the renderer and unit-testable headless.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { userDataDir } = require('./userDataPath.js');
const { imageSize } = require('./imageSize.js');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

let storeFile = null;
let cachePath = null;
let cacheStamp = null;
let cacheMap = null;

function stamp(stat) {
  return stat ? `${stat.mtimeNs || BigInt(Math.round(stat.mtimeMs * 1000000))}:${stat.size}` : null;
}

function defaultFile() {
  return path.join(userDataDir(), 'cfg', 'covers.db');
}

function setStoreFile(p) {
  storeFile = p || null;
  cachePath = null;
  cacheStamp = null;
  cacheMap = null;
}

function file() {
  return storeFile || defaultFile();
}

function localPathFromUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^file:/i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(text) ? text : null;
}

function coverIdFor(appid) {
  return String(appid || '').replace(/[^\w.-]/g, '_');
}

function isOrientation(value) {
  return value === 'portrait' || value === 'landscape';
}

// A stored entry is either a legacy plain URL (applies to every orientation, pre-dating this
// distinction) or an { portrait, landscape } object. Resolve to the string a caller can use.
function valueForOrientation(entry, orientation) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry;
  if (!isOrientation(orientation)) return entry.landscape || entry.portrait || null;
  return entry[orientation] || null;
}

/*
  The stored filename carries a digest of the image itself.

  It used to be just `<appid>.<ext>`, so choosing a second cover for the same game overwrote the
  first one at the same path - and the value handed to CSS was that same file:// URL both times.
  Chromium keys its decoded-image cache on the URL, so the tile kept painting the previous picture
  and choosing a cover looked like it did nothing at all. Including the digest means different
  bytes are a different URL, which is what makes the new cover appear; identical bytes reuse the
  file, so re-picking the same art is not a second copy on disk.
*/
function safeCoverName(appid, sourcePath, digest) {
  const id = coverIdFor(appid);
  if (!id) return null;
  const sourceExtension = path.extname(String(sourcePath || '')).toLowerCase();
  const extension = IMAGE_EXTENSIONS.has(sourceExtension) ? sourceExtension : '.png';
  return digest ? `${id}-${digest}${extension}` : `${id}${extension}`;
}

// Every cover file this game has ever had, including the pre-digest `<appid>.<ext>` spelling.
function coverFilesFor(root, appid) {
  const id = coverIdFor(appid);
  if (!id) return [];
  const dir = path.join(root, 'covers');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?:-[a-f0-9]+)?\\.[a-z0-9]+$`, 'i');
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => pattern.test(name))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

// Drop the copies this game no longer points at. Called only after the new selection is recorded,
// so an interrupted run leaves a stale file rather than a cover with nothing behind it. Portrait and
// landscape can each hold their own local file, so every currently-referenced path must be kept -
// pruning against just the one just written would delete the other orientation's pick out from
// under it.
function pruneOldCovers(root, appid, keepPaths) {
  const keep = new Set(keepPaths.map((p) => path.resolve(p).toLowerCase()));
  for (const file of coverFilesFor(root, appid)) {
    if (keep.has(path.resolve(file).toLowerCase())) continue;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* a locked leftover is harmless; it is simply no longer referenced */
    }
  }
}

// Every local file this game's stored entry (legacy string or per-orientation object) still points
// at, so a prune after writing one orientation never touches the other's file.
function keepPathsForEntry(entry) {
  const values = typeof entry === 'string' ? [entry] : entry && typeof entry === 'object' ? [entry.portrait, entry.landscape] : [];
  return values.map(localPathFromUrl).filter(Boolean);
}

function writeMapToFile(targetFile, map) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(map, null, 2), 'utf8');
}

function readAll() {
  const f = file();
  try {
    const stat = fs.statSync(f, { bigint: true });
    const nextStamp = stamp(stat);
    if (cacheMap && cachePath === f && cacheStamp === nextStamp) return { ...cacheMap };
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    cachePath = f;
    cacheStamp = nextStamp;
    cacheMap = data && typeof data === 'object' ? data : {};
    return { ...cacheMap };
  } catch {
    cachePath = f;
    cacheStamp = null;
    cacheMap = {};
    return {};
  }
}

function writeAll(map) {
  const f = file();
  const next = map && typeof map === 'object' ? map : {};
  writeMapToFile(f, next);
  cachePath = f;
  try {
    cacheStamp = stamp(fs.statSync(f, { bigint: true }));
  } catch {
    cacheStamp = null;
  }
  cacheMap = { ...next };
}

// `orientation` ('portrait' | 'landscape') is optional. Omitted, this is the legacy single-value
// API: get returns whatever is stored regardless of shape, set/remove act on the whole entry.
function get(appid, orientation) {
  return valueForOrientation(readAll()[String(appid)] ?? null, orientation);
}

function set(appid, coverUrl, orientation) {
  if (!appid || !coverUrl) return;
  const map = readAll();
  const id = String(appid);
  if (!isOrientation(orientation)) {
    map[id] = String(coverUrl);
  } else {
    const existing = map[id];
    const next = existing && typeof existing === 'object' ? { ...existing } : {};
    if (typeof existing === 'string') {
      // A pre-existing legacy pick applied to both orientations; keep it for the one not being
      // changed now instead of dropping it.
      next[orientation === 'portrait' ? 'landscape' : 'portrait'] = existing;
    }
    next[orientation] = String(coverUrl);
    map[id] = next;
  }
  writeAll(map);
}

function remove(appid, orientation) {
  const map = readAll();
  const id = String(appid);
  if (!Object.prototype.hasOwnProperty.call(map, id)) return;
  const entry = map[id];
  if (!isOrientation(orientation) || typeof entry === 'string') {
    delete map[id];
  } else {
    const next = { ...entry };
    delete next[orientation];
    if (next.portrait || next.landscape) map[id] = next;
    else delete map[id];
  }
  writeAll(map);
}

// A selected cover is user state, even when its original bytes came from a downloadable cache.
// Copy local/cache-backed selections into userData/covers before recording them so clearing
// steam_cache cannot leave covers.db pointing at a deleted file. Remote URLs are safe to retain as
// URLs when the download failed; they can be requested again by Chromium on the next render.
function persist(appid, coverUrl, root = userDataDir(), orientation) {
  if (!appid || !coverUrl) return null;
  const value = String(coverUrl);
  const source = localPathFromUrl(value);
  let stored = value;
  let destination = null;
  if (source) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
    const bytes = fs.readFileSync(source);
    const digest = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
    const name = safeCoverName(appid, source, digest);
    if (!name) return null;
    destination = path.join(root, 'covers', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (path.resolve(source).toLowerCase() !== path.resolve(destination).toLowerCase() && !fs.existsSync(destination)) {
      fs.writeFileSync(destination, bytes);
    }
    stored = pathToFileURL(destination).href;
  }
  set(appid, stored, orientation);
  // Record first, then tidy: the entry above is what makes the new file(s) the ones in use. Keep
  // every orientation's current file, not just the one just written.
  if (destination) pruneOldCovers(root, appid, keepPathsForEntry(readAll()[String(appid)]));
  return stored;
}

/*
  Which tile shape an image was made for, from its own pixels.

  Store art comes in two unmistakable shapes - a header is about 2:1, a portrait grid 2:3 - so the
  ratio is the answer, not a guess. Anything close to square (a fan-made square cover, an icon) is
  deliberately left unclassified: it suits both shapes about equally badly, and forcing it into one
  would silently drop it from the other.
*/
function orientationOfImage(file) {
  const size = file ? imageSize(file) : null;
  if (!size) return null;
  const ratio = size.width / size.height;
  if (ratio <= 0.9) return 'portrait';
  if (ratio >= 1.1) return 'landscape';
  return null;
}

/*
  Bind every legacy plain-string entry to the orientation its image actually has.

  Before covers were stored per orientation a pick was one URL for the game, so switching the grid
  to the other shape kept painting it: a 920x430 header cropped into a portrait tile, or a 600x900
  grid letterboxed into a landscape one. Splitting the two is only half the fix - the entries already
  on disk have to be told apart as well, and the file itself is the only record of which shape the
  user picked. Entries that cannot be measured (a remote URL, a deleted file, a square image) keep
  applying to both, exactly as before.

  Returns the appids it changed.
*/
function splitLegacyByShape() {
  const map = readAll();
  const changed = [];
  for (const [appid, entry] of Object.entries(map)) {
    if (typeof entry !== 'string') continue;
    const orientation = orientationOfImage(localPathFromUrl(entry));
    if (!orientation) continue;
    map[appid] = { [orientation]: entry };
    changed.push(appid);
  }
  if (changed.length > 0) writeAll(map);
  return changed;
}

function isUsable(coverUrl) {
  const local = localPathFromUrl(coverUrl);
  if (!local) return /^https?:\/\//i.test(String(coverUrl || ''));
  try {
    return fs.statSync(local).isFile();
  } catch {
    return false;
  }
}

// SteamGridDB grid URLs use the content hash as their filename. Older AW builds kept only the
// downloaded cache path, but that basename is enough to reconstruct the exact remote selection
// after the cache was already deleted. Do not guess generic names such as header.jpg: an alternate
// Steam AppID is no longer present in that old path, so guessing could silently select wrong art.
function recoverRemote(coverUrl) {
  const local = localPathFromUrl(coverUrl);
  if (!local) return null;
  const basename = path.basename(local);
  if (!/^[a-f0-9]{32}\.(?:jpe?g|png|webp)$/i.test(basename)) return null;
  return `https://cdn2.steamgriddb.com/grid/${basename}`;
}

function pathIsWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Upgrade overrides created by older builds before deleting steam_cache. This runs in the main
// process, so it reads/writes the requested user-data tree directly instead of relying on this
// module's renderer-side store override/cache.
function preserveCachedOverrides(root = userDataDir()) {
  const targetFile = path.join(root, 'cfg', 'covers.db');
  let map;
  try {
    map = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  } catch {
    return [];
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];

  const cacheRoot = path.join(root, 'steam_cache');
  const preserved = new Set();

  // Copy one cache-backed value into durable storage, returning its new file:// URL, or null if
  // this value doesn't need preserving. Named with a digest so a portrait and a landscape pick for
  // the same appid never collide on the same destination filename.
  const preserveValue = (appid, value) => {
    const source = localPathFromUrl(value);
    if (!source || !pathIsWithin(source, cacheRoot)) return null;
    try {
      if (!fs.statSync(source).isFile()) return null;
      const bytes = fs.readFileSync(source);
      const digest = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
      const name = safeCoverName(appid, source, digest);
      if (!name) return null;
      const destination = path.join(root, 'covers', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes);
      preserved.add(String(appid));
      return pathToFileURL(destination).href;
    } catch (err) {
      throw new Error(`Could not preserve custom cover for ${appid}: ${err.message || err}`);
    }
  };

  for (const [appid, entry] of Object.entries(map)) {
    if (typeof entry === 'string') {
      const upgraded = preserveValue(appid, entry);
      if (upgraded) map[appid] = upgraded;
      continue;
    }
    if (entry && typeof entry === 'object') {
      for (const orientation of ['portrait', 'landscape']) {
        const upgraded = preserveValue(appid, entry[orientation]);
        if (upgraded) entry[orientation] = upgraded;
      }
    }
  }
  if (preserved.size) writeMapToFile(targetFile, map);
  return [...preserved];
}

module.exports = {
  setStoreFile,
  defaultFile,
  readAll,
  writeAll,
  get,
  set,
  remove,
  persist,
  isUsable,
  recoverRemote,
  preserveCachedOverrides,
  valueForOrientation,
  orientationOfImage,
  splitLegacyByShape,
};
