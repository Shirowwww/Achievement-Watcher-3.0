'use strict';

// Per-appid cover-art overrides. A small JSON map { "<appid>": "<file:// or http(s) url>" } stored in
// cfg/covers.db. When an entry exists it takes precedence over the normal Steam/emulator cover, so a
// user can fix a mis-matched cracked game (wrong AppID), point at a local image, or force a redownload.
// Pure fs/JSON — no Electron — so it is usable from the renderer and unit-testable headless.

const fs = require('fs');
const path = require('path');

let storeFile = null;
let cachePath = null;
let cacheStamp = null;
let cacheMap = null;

function stamp(stat) {
  return stat ? `${stat.mtimeNs || BigInt(Math.round(stat.mtimeMs * 1000000))}:${stat.size}` : null;
}

function defaultFile() {
  return path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'cfg', 'covers.db');
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
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const next = map && typeof map === 'object' ? map : {};
  fs.writeFileSync(f, JSON.stringify(next, null, 2), 'utf8');
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

module.exports = { setStoreFile, defaultFile, readAll, writeAll, get, set, remove };
