'use strict';

const path = require('path');
const fs = require('./util/fsAsync');

let cacheDir = path.join(require('./util/userData.js').userDataDir(), 'steam_cache', 'data');

// Keep an in-memory baseline when disk persistence fails.
const memoryCache = new Map();

// Serialize writes per appid.
const writeQueues = new Map();

function cacheKey(appID) {
  return String(appID);
}

function cacheFilePath(appID) {
  return path.join(cacheDir, `${cacheKey(appID)}.db`);
}

// Test hook for an isolated cache.
module.exports.setCacheDir = (dir) => {
  cacheDir = dir;
  memoryCache.clear();
  writeQueues.clear();
};

/*
  Drop a game's baseline, in memory and on disk.

  The app deletes the .db itself when it resets a game's achievements, but this process keeps the
  same baseline in `memoryCache` for as long as it runs — and that copy is what the next unlock is
  diffed against. Without this the achievement is re-earned, matched against a baseline that still
  has it, and reported as "already unlocked": the reset would silently cost the user every future
  notification for that game until the monitor restarts.
*/
module.exports.forget = async (appID) => {
  const key = cacheKey(appID);
  memoryCache.delete(key);
  // Let an in-flight save finish first, or it would write the baseline straight back.
  const pending = writeQueues.get(key);
  if (pending) await pending.catch(() => {});
  await fs.unlink(cacheFilePath(key)).catch(() => {});
};

module.exports.load = async (appID) => {
  const key = cacheKey(appID);
  // Prefer the in-memory baseline when available.
  if (memoryCache.has(key)) return snapshotOf(memoryCache.get(key));

  try {
    const parsed = JSON.parse(await fs.readFile(cacheFilePath(key), 'utf8'));
    const normalized = Array.isArray(parsed) ? parsed : [];
    memoryCache.set(key, normalized);
    return snapshotOf(normalized);
  } catch {
    return [];
  }
};

module.exports.save = async (appID, achievements) => {
  if (!Array.isArray(achievements)) {
    throw new TypeError('track.save requires an achievements array');
  }
  // Snapshot before storing so callers cannot mutate the baseline.
  const key = cacheKey(appID);
  const normalized = snapshotOf(achievements);
  memoryCache.set(key, normalized);

  const filePath = cacheFilePath(key);
  const previous = writeQueues.get(key) || Promise.resolve();
  const pending = previous.then(() => persist(filePath, normalized));
  // Keep later saves serializable after a failure.
  const tracked = pending.catch(() => {});
  writeQueues.set(key, tracked);
  tracked.finally(() => {
    if (writeQueues.get(key) === tracked) writeQueues.delete(key);
  });
  await pending;
};

function snapshotOf(entries) {
  return entries.map((entry) => ({ ...entry }));
}

async function persist(filePath, achievements) {
  // Create the cache directory on first use.
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const data = JSON.stringify(achievements);
  const tmpPath = `${filePath}.tmp`;

  // Write a sibling temp file, then rename it atomically.
  try {
    await fs.writeFile(tmpPath, data, 'utf8');
  } catch (err) {
    // Remove partial temp files.
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }

  // Retry Windows rename races, then fall back to an in-place write.
  try {
    await renameWithRetry(tmpPath, filePath);
  } catch {
    try {
      await fs.writeFile(filePath, data, 'utf8');
    } finally {
      // Remove any leftover temp file.
      await fs.unlink(tmpPath).catch(() => {});
    }
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
