'use strict';

// Per-appid cover-art overrides. A small JSON map { "<appid>": "<file:// or http(s) url>" } stored in
// cfg/covers.db. When an entry exists it takes precedence over the normal Steam/emulator cover, so a
// user can fix a mis-matched cracked game (wrong AppID), point at a local image, or force a redownload.
// Pure fs/JSON — no Electron — so it is usable from the renderer and unit-testable headless.

const fs = require('fs');
const path = require('path');

let storeFile = null;

function defaultFile() {
  return path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'cfg', 'covers.db');
}

function setStoreFile(p) {
  storeFile = p || null;
}

function file() {
  return storeFile || defaultFile();
}

function readAll() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(map || {}, null, 2), 'utf8');
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
