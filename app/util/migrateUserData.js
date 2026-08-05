'use strict';

const fs = require('fs');
const path = require('path');
const { legacyUserDataDir } = require('./userDataPath.js');

const MARKER_REL = path.join('cfg', 'migrated-from-legacy.json');
const SETTINGS_REL = path.join('cfg', 'options.ini');
const LEGACY_PLAYTIME_ROOT = 'Software/Achievement Watcher/Playtime/Steam';
const PLAYTIME_ROOT = 'Software/Achievement Watcher 3.0/Playtime/Steam';

// What actually belongs to Achievement Watcher inside the legacy directory, and how to move it.
//
// The legacy folder is NOT only AW data: because 1.6.8 and 3.x are Electron apps, Chromium keeps its
// whole profile there too (`Cache/Cache_Data`, `Code Cache`, `GPUCache`, `Local Storage`, `Network`,
// `Partitions`, `Preferences`, …). Those are regenerated on first launch and copying them would both
// waste gigabytes and carry a stale profile from another Electron version into the new home, so they
// are simply not listed here. `logs/` is skipped for the same reason (the new directory starts its
// own log set). `Media/`, `Source/` and `view/` are re-copied from the installed resources on every
// launch (see copyAppDataAssets in electron/init.js), so they never need importing either.
//
//   mode 'copy' → a real byte copy. Used for the small, MUTABLE payload: 3.x rewrites these files in
//                 place, and a shared inode would write straight back into 1.6.8's configuration.
//   mode 'link' → a hard link (same NTFS volume), falling back to a copy. Used for the large
//                 WRITE-ONCE payload: caches of downloaded tools, extracted icons and GBE backups.
//                 A real copy here is ~1.8 GB on a well-used install — enough to look like a frozen
//                 first launch and to double disk usage. Hard links are metadata-only, and because
//                 NTFS only frees a file when its LAST link disappears, the data still survives the
//                 1.6.8 uninstaller deleting the legacy folder — which is the entire point of #6.
const MIGRATION_PLAN = [
  { rel: 'cfg', mode: 'copy' },
  { rel: 'themes', mode: 'copy' },
  { rel: 'sounds', mode: 'copy' },
  { rel: 'steam_cache', mode: 'link' },
  { rel: 'uplay_cache', mode: 'link' },
  { rel: 'backups', mode: 'link' }, // GBE restore points, indexed by cfg/gbe-backups.db
  // AW's own tool caches. NOTE: on Windows `cache` and Chromium's `Cache` are the SAME directory
  // (case-insensitive), so these have to be named one by one instead of taking the folder whole.
  { rel: 'cache/gse_fork', mode: 'link' },
  { rel: 'cache/gse_emu_config', mode: 'link' },
  { rel: 'cache/steamless', mode: 'link' },
  { rel: 'cache/crackfiles', mode: 'link' },
  { rel: 'cache/api_check_bypass', mode: 'link' },
  { rel: 'cache/uplayR2', mode: 'link' }, // user-seeded: no public download source, cannot be refetched
];

// Loose files at the root of the legacy directory that hold real state.
const MIGRATION_FILES = [
  { rel: 'epic_tokens.enc', mode: 'copy' },
  { rel: '.updaterId', mode: 'copy' },
];

function warn(message) {
  try {
    console.warn(`[migrate-userdata] ${message}`);
  } catch {
    /* no logger available this early in the main process */
  }
}

function placeFile(from, to, mode) {
  if (mode === 'link') {
    try {
      fs.linkSync(from, to);
      return;
    } catch (err) {
      // Different volume, a filesystem without hard links, or the link count limit: fall through to
      // a plain copy so the import still completes.
      if (!err || !['EXDEV', 'EPERM', 'EMLINK', 'ENOSYS', 'EACCES'].includes(err.code)) throw err;
    }
  }
  fs.copyFileSync(from, to);
}

// Recursive placement that never aborts the whole import because one entry is locked (a log stream
// still open by a running 1.6.8 instance, an antivirus scan) or transiently unreadable. Returns the
// number of files placed so the caller can log something meaningful.
function placeTree(src, dst, mode) {
  let placed = 0;
  fs.mkdirSync(dst, { recursive: true });
  let entries = [];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (err) {
    warn(`skipped ${src}: ${(err && err.message) || err}`);
    return placed;
  }
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    try {
      if (entry.isDirectory()) {
        placed += placeTree(from, to, mode);
      } else if (entry.isFile()) {
        if (!fs.existsSync(to)) placeFile(from, to, mode);
        placed += 1;
      }
      // Symlinks/junctions are deliberately ignored: nothing AW writes uses them, and following one
      // could walk out of the legacy directory entirely.
    } catch (err) {
      warn(`skipped ${from}: ${(err && err.message) || err}`);
    }
  }
  return placed;
}

// Copy playtime counters from the legacy 1.6.8 registry namespace into the 3.0 namespace, so the
// legacy uninstaller (which removes the old app key) can no longer erase 3.x playtime data either.
function migratePlaytimeRegistry() {
  try {
    const reg = require('./reg.js');
    const appids = reg.listRegistryAllSubkeys('HKCU', LEGACY_PLAYTIME_ROOT);
    for (const appid of appids || []) {
      const oldKey = `${LEGACY_PLAYTIME_ROOT}/${appid}`;
      const newKey = `${PLAYTIME_ROOT}/${appid}`;
      const total = reg.readRegistryInteger('HKCU', oldKey, 'total');
      const last = reg.readRegistryInteger('HKCU', oldKey, 'last');
      if (total != null) reg.writeRegistryDword('HKCU', newKey, 'total', total);
      if (last != null) reg.writeRegistryDword('HKCU', newKey, 'last', last);
    }
  } catch {
    /* registry migration is best-effort; playtime simply starts fresh if it fails */
  }
}

// The new directory can already exist without ever having been migrated: the Watchdog and the
// loggers create `<userData>\logs` as soon as they write their first line. So "already initialized"
// has to mean "has AW configuration or a migration marker", never "is non-empty" — otherwise a
// single stray log file would silently block the import forever.
function isAlreadyInitialized(target) {
  return fs.existsSync(path.join(target, MARKER_REL)) || fs.existsSync(path.join(target, SETTINGS_REL));
}

/**
 * One-time import of the legacy `%APPDATA%\Achievement Watcher` directory into the 3.0 directory.
 *
 * The original 1.6.8 app and this 3.x fork used to share the same folder, and 1.6.8's uninstaller
 * deletes it — silently destroying 3.x configuration (issue #6). From now on 3.x lives in its own
 * directory; the first launch after an upgrade imports the legacy data (never moves or deletes it)
 * and records a marker so a later 1.6.8 uninstall cannot touch 3.x data.
 *
 * Returns the legacy path when a migration happened, otherwise null.
 */
function migrateLegacyUserData(newUserDataDir, options = {}) {
  const legacy = options.legacyDir || legacyUserDataDir();
  const target = String(newUserDataDir || '').trim();
  if (!legacy || !target) return null;
  if (path.resolve(legacy).toLowerCase() === path.resolve(target).toLowerCase()) return null;
  if (!fs.existsSync(legacy)) return null;

  try {
    if (isAlreadyInitialized(target)) return null;
    fs.mkdirSync(target, { recursive: true });

    let placed = 0;
    for (const { rel, mode } of MIGRATION_PLAN) {
      const from = path.join(legacy, rel);
      try {
        if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
      } catch {
        continue;
      }
      placed += placeTree(from, path.join(target, rel), mode);
    }
    for (const { rel, mode } of MIGRATION_FILES) {
      const from = path.join(legacy, rel);
      const to = path.join(target, rel);
      try {
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        placeFile(from, to, mode);
        placed += 1;
      } catch (err) {
        warn(`skipped ${from}: ${(err && err.message) || err}`);
      }
    }

    const marker = path.join(target, MARKER_REL);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      JSON.stringify({ migratedFrom: legacy, files: placed, at: new Date().toISOString() }, null, 2),
      'utf8'
    );

    if (!options.skipRegistry) migratePlaytimeRegistry();
    warn(`imported ${placed} file(s) from ${legacy}`);
    return legacy;
  } catch (err) {
    // Non-fatal: a failed import must not brick first launch — 3.x starts with a fresh config and
    // the legacy folder is still intact for a manual copy. Log it so it shows up in the main log.
    warn(`legacy import failed: ${(err && err.message) || err}`);
    return null;
  }
}

module.exports = {
  migrateLegacyUserData,
  migratePlaytimeRegistry,
  isAlreadyInitialized,
  MIGRATION_PLAN,
  MIGRATION_FILES,
  MARKER_REL,
  LEGACY_PLAYTIME_ROOT,
  PLAYTIME_ROOT,
};
