'use strict';

// Per-appid cover-art overrides. A small JSON map { "<appid>": "<file:// or http(s) url>" } stored in
// cfg/covers.db. When an entry exists it takes precedence over the normal Steam/emulator cover, so a
// user can fix a mis-matched cracked game (wrong AppID), point at a local image, or force a redownload.
// Pure fs/JSON — no Electron — so it is usable from the renderer and unit-testable headless.

const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { userDataDir } = require('./userDataPath.js');

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

function safeCoverName(appid, sourcePath) {
  const id = String(appid || '').replace(/[^\w.-]/g, '_');
  if (!id) return null;
  const sourceExtension = path.extname(String(sourcePath || '')).toLowerCase();
  const extension = IMAGE_EXTENSIONS.has(sourceExtension) ? sourceExtension : '.png';
  return `${id}${extension}`;
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

function get(appid) {
  return readAll()[String(appid)] || null;
}

function set(appid, coverUrl) {
  if (!appid || !coverUrl) return;
  const map = readAll();
  map[String(appid)] = String(coverUrl);
  writeAll(map);
}

function remove(appid) {
  const map = readAll();
  if (Object.prototype.hasOwnProperty.call(map, String(appid))) {
    delete map[String(appid)];
    writeAll(map);
  }
}

// A selected cover is user state, even when its original bytes came from a downloadable cache.
// Copy local/cache-backed selections into userData/covers before recording them so clearing
// steam_cache cannot leave covers.db pointing at a deleted file. Remote URLs are safe to retain as
// URLs when the download failed; they can be requested again by Chromium on the next render.
function persist(appid, coverUrl, root = userDataDir()) {
  if (!appid || !coverUrl) return null;
  const value = String(coverUrl);
  const source = localPathFromUrl(value);
  let stored = value;
  if (source) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
    const name = safeCoverName(appid, source);
    if (!name) return null;
    const destination = path.join(root, 'covers', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (path.resolve(source).toLowerCase() !== path.resolve(destination).toLowerCase()) {
      fs.copyFileSync(source, destination);
    }
    stored = pathToFileURL(destination).href;
  }
  set(appid, stored);
  return stored;
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
  const preserved = [];
  for (const [appid, value] of Object.entries(map)) {
    const source = localPathFromUrl(value);
    if (!source || !pathIsWithin(source, cacheRoot)) continue;
    try {
      if (!fs.statSync(source).isFile()) continue;
      const name = safeCoverName(appid, source);
      if (!name) continue;
      const destination = path.join(root, 'covers', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      map[appid] = pathToFileURL(destination).href;
      preserved.push(String(appid));
    } catch (err) {
      throw new Error(`Could not preserve custom cover for ${appid}: ${err.message || err}`);
    }
  }
  if (preserved.length) writeMapToFile(targetFile, map);
  return preserved;
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
};
