'use strict';

const path = require('path');
const fs = require('./util/fsAsync');

let cacheDir = path.join(process.env['APPDATA'], 'Achievement Watcher', 'steam_cache', 'data');

// In-memory baselines. track.save() can still fail for reasons other than a missing directory
// (permissions, disk full, antivirus lock, ...). If the next scan then re-reads a stale or missing
// .db, the diff engine treats the game as a first observation again and re-notifies the boot-seed
// block. Keeping the latest snapshot in memory makes the baseline stable for this process even when
// disk persistence fails.
const memoryCache = new Map();

// Serialize writes per appid: emulators can rewrite the same save through several watched paths in
// quick succession, and two concurrent writes to the same .db could interleave and corrupt it.
const writeQueues = new Map();

// Test/embedding hook: point the cache at a temp dir. Clears the in-memory baseline so each test
// starts clean.
module.exports.setCacheDir = (dir) => {
  cacheDir = dir;
  memoryCache.clear();
};

module.exports.load = async (appID) => {
  // The in-memory baseline is always at least as fresh as the file: prefer it when present.
  if (memoryCache.has(appID)) return memoryCache.get(appID).slice();

  try {
    const parsed = JSON.parse(await fs.readFile(path.join(cacheDir, `${appID}.db`), 'utf8'));
    const normalized = Array.isArray(parsed) ? parsed : [];
    memoryCache.set(appID, normalized);
    return normalized.slice();
  } catch {
    return [];
  }
};

module.exports.save = async (appID, achievements) => {
  const normalized = Array.isArray(achievements) ? achievements : [];
  memoryCache.set(appID, normalized);

  const filePath = path.join(cacheDir, `${appID}.db`);
  const previous = writeQueues.get(appID) || Promise.resolve();
  const pending = previous.then(() => persist(filePath, normalized));
  // Keep the queue alive even when a write fails, so later saves still serialize.
  const tracked = pending.catch(() => {});
  writeQueues.set(appID, tracked);
  tracked.finally(() => {
    if (writeQueues.get(appID) === tracked) writeQueues.delete(appID);
  });
  await pending;
};

async function persist(filePath, achievements) {
  // The cache directory may not exist yet on a fresh install: create it (and any missing parents)
  // before the first write. Without this, writeFile throws ENOENT and the baseline never persists,
  // so every later save-file change is treated as a first observation again.
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const data = JSON.stringify(achievements);
  const tmpPath = `${filePath}.tmp`;

  // Write to a sibling temp file then rename, so a crash, power loss or concurrent reader can never
  // observe a truncated .db. A corrupted baseline would otherwise read back as [] and re-trigger the
  // boot-seed notifications.
  await fs.writeFile(tmpPath, data, 'utf8');

  // Windows refuses to replace a file that another process has open for reading (EPERM) — and the
  // renderer reads these .db files. Retry briefly, then fall back to an in-place write, which Windows
  // does allow. The in-memory baseline still covers the session if even that fails.
  try {
    await renameWithRetry(tmpPath, filePath);
  } catch {
    await fs.writeFile(filePath, data, 'utf8');
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function renameWithRetry(tmpPath, filePath, attempts = 3, delayMs = 25) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(tmpPath, filePath);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
