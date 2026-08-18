'use strict';

const path = require('path');
const fs = require('fs');
const { preserveCachedOverrides } = require('./coverStore.js');

// Explicit allowlist of userData-relative folders that hold nothing but re-fetchable/re-downloadable
// content: every one of them is rebuilt automatically (from Steam/GOG/Epic/SteamDB/SteamGridDB APIs,
// or a GitHub release download) the next time it is needed. Mirrors the safety classification already
// used by util/migrateUserData.js (MIGRATION_PLAN), which is the authoritative source of truth for
// which userData folders are disposable caches versus irreplaceable local state.
//
// Deliberately NOT here, and never add without re-reading migrateUserData.js first:
//   cache/uplayR2   - user-seeded Uplay R2 loader dll; no public download source, cannot be refetched
//   backups         - GBE restore points; local safety net, not derived from anything external
//   cfg, covers, presets, theme-images, epic_tokens.enc, lockfile - settings and user-authored content
const SAFE_CACHE_DIRS = [
  'steam_cache', // Steam/GOG/Epic/SteamDB/SteamGridDB schema, icon, cover and rarity cache
  'uplay_cache', // Ubisoft Connect schema + icon cache
  'cache/gse_fork', // downloaded GBE Fork (Detanup01/gbe_fork) steam_api dlls
  'cache/gse_emu_config', // downloaded generate_emu_config tool (alex47exe/gse_fork_tools)
  'cache/steamless', // downloaded Steamless (atom0s/Steamless)
  'cache/crackfiles', // downloaded crackfiles.json (KoriaPolis/CrakFiles)
  'cache/api_check_bypass', // downloaded Steam-API-Check-Bypass proxy dlls
];

// Removes every folder in the allowlist that exists under userDataDir. Returns the list of
// userData-relative paths that actually existed and were removed (an empty list means there was
// nothing to clear). A missing individual folder is not an error - most users have never touched
// every source, so most of this list is normally absent.
async function clearSafeCaches(userDataDir) {
  // Older builds stored downloaded custom-cover selections inside steam_cache while covers.db kept
  // a permanent reference to them. Promote those files to the durable covers/ folder before the
  // cache is removed. If a copy unexpectedly fails, abort before deleting any app cache.
  preserveCachedOverrides(userDataDir);
  const cleared = [];
  for (const rel of SAFE_CACHE_DIRS) {
    const full = path.join(userDataDir, rel);
    let existed = false;
    try {
      await fs.promises.access(full);
      existed = true;
    } catch {
      existed = false;
    }
    if (!existed) continue;
    await fs.promises.rm(full, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    cleared.push(rel);
  }
  return cleared;
}

module.exports = { SAFE_CACHE_DIRS, clearSafeCaches };
