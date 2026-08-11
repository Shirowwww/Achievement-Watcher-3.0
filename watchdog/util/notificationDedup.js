'use strict';

// Suppress duplicate achievement events while save writes race each other.

const DEDUPE_MS = 1500;
const recent = new Map();

function buildKey({ appid, achievementName } = {}) {
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const key = `${norm(appid)}::${norm(achievementName)}`;
  return key === '::' ? '' : key;
}

function prune(now) {
  for (const [key, ts] of recent) {
    if (now - ts > DEDUPE_MS) recent.delete(key);
  }
}

// Return true for the first key in the window; fail open for empty keys.
function shouldNotify(parts, now = Date.now()) {
  const key = buildKey(parts);
  if (!key) return true;
  prune(now);
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
}

module.exports = { shouldNotify, buildKey, DEDUPE_MS };
