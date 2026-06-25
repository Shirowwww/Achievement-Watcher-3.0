'use strict';

// Precise per-achievement notification de-duplication (ported from reference-Achievements'
// recentAchievementNotificationKeys / buildKey / prune).
//
// Why this exists on top of the existing global `tick` gate in watchdog.js:
//   - node-watch can emit two 'update' events for a single save write, and some emulators rewrite
//     their save file twice in quick succession.
//   - The diff engine normally absorbs that: it persists the per-game cache (track.save) after each
//     scan, so a second scan sees the achievement as already-unlocked and does not re-fire. But when
//     two events land close enough that the second scan's track.load() runs BEFORE the first scan's
//     track.save() completes, both scans read the old baseline and both fire the same toast.
//   - The global `tick` gate guards this only coarsely (it throttles *all* processing for a window),
//     and is bypassed entirely when the user lowers/disables it.
//
// This keeps a short-lived in-memory set of recently-notified (appid + achievement) keys and drops
// exact repeats within DEDUPE_MS — independent of file/cache write timing. It is a belt-and-suspenders
// guard, not a replacement for the diff engine.

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

// Returns true the first time a key is seen within the window (caller should notify), false for a
// duplicate (caller should skip). An empty/unkeyable input always returns true (fail-open).
function shouldNotify(parts, now = Date.now()) {
  const key = buildKey(parts);
  if (!key) return true;
  prune(now);
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
}

module.exports = { shouldNotify, buildKey, DEDUPE_MS };
