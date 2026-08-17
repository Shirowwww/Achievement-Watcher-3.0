'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { legacyUserDataDir, aw3UserDataDir } = require('./userDataPath.js');

const MARKER_REL = path.join('cfg', 'migrated-from-legacy.json');
const AW3_MARKER_REL = path.join('cfg', 'migrated-from-aw3.json');
const SOUVENIR_MARKER_REL = path.join('cfg', 'migrated-souvenirs.json');
// Screenshot souvenirs never carried a version in their folder name, so the pre-rename default is
// just "Achievement Watcher" under Pictures.
const AW3_SOUVENIR_DIR_NAME = 'Achievement Watcher';
const SOUVENIR_DIR_NAME = 'Achievement Watcher Next';
const SETTINGS_REL = path.join('cfg', 'options.ini');
const LEGACY_PLAYTIME_ROOT = 'Software/Achievement Watcher/Playtime/Steam';
const AW3_PLAYTIME_ROOT = 'Software/Achievement Watcher 3.0/Playtime/Steam';
const PLAYTIME_ROOT = 'Software/Achievement Watcher Next/Playtime/Steam';

// Import AW data without copying Chromium's profile.
// Mutable files are copied; large write-once caches use hard links when possible.
const MIGRATION_PLAN = [
  { rel: 'cfg', mode: 'copy' },
  { rel: 'themes', mode: 'copy' },
  { rel: 'sounds', mode: 'copy' },
  { rel: 'covers', mode: 'copy' }, // user-selected cover artwork; not reproducible cache data
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

// The 3.0 -> AW Next hop reads a folder AW itself wrote, so it carries everything the 1.6.8 plan
// does plus the directories that only ever existed in 3.x. Chromium's own profile (Local State,
// Network, GPUCache, blob_storage, Code Cache, DIPS, Dawn*, Session/Local Storage, Shared*) is
// deliberately left behind: it is regenerated on first launch and copying it moves stale absolute
// paths into the new profile. Media/, Source/ and view/ are app resources that checkResources()
// restores by itself.
//
// `theme-images` and `backups` are the reason the big ones are linked rather than copied: together
// they run to hundreds of megabytes on a real install, and both are write-once, so hard links make
// the import instant and free while leaving the 3.0 folder fully intact.
const AW3_MIGRATION_PLAN = [
  { rel: 'cfg', mode: 'copy' },
  { rel: 'themes', mode: 'copy' },
  { rel: 'sounds', mode: 'copy' },
  { rel: 'presets', mode: 'copy' }, // includes the user's own presets under "Users Presets"
  { rel: 'covers', mode: 'copy' },
  { rel: 'theme-images', mode: 'link' }, // custom-theme source images; not reproducible
  { rel: 'steam_cache', mode: 'link' },
  { rel: 'uplay_cache', mode: 'link' },
  { rel: 'backups', mode: 'link' },
  { rel: 'logs', mode: 'link' }, // keeps diagnostic history across the rename
  { rel: 'cache/gse_fork', mode: 'link' },
  { rel: 'cache/gse_emu_config', mode: 'link' },
  { rel: 'cache/steamless', mode: 'link' },
  { rel: 'cache/crackfiles', mode: 'link' },
  { rel: 'cache/api_check_bypass', mode: 'link' },
  { rel: 'cache/uplayR2', mode: 'link' },
];

const AW3_MIGRATION_FILES = [
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

// Copy playtime counters forward into the AW Next registry namespace. Values already present in the
// destination win, so re-running this can never roll a counter backwards.
function migratePlaytimeRegistry(fromRoot = LEGACY_PLAYTIME_ROOT) {
  try {
    const reg = require('./reg.js');
    const appids = reg.listRegistryAllSubkeys('HKCU', fromRoot);
    for (const appid of appids || []) {
      const oldKey = `${fromRoot}/${appid}`;
      const newKey = `${PLAYTIME_ROOT}/${appid}`;
      if (reg.readRegistryInteger('HKCU', newKey, 'total') != null) continue;
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

// One import hop. Never deletes the source, never overwrites a file that already exists in the
// destination (so an interrupted run resumes and a second run is a no-op), and never lets a single
// unreadable entry abort the rest — placeTree() logs and moves on.
function importUserData({ source, target: rawTarget, plan, files, markerRel, label }) {
  const target = String(rawTarget || '').trim();
  if (!source || !target) return null;
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) return null;
  if (!fs.existsSync(source)) return null;

  try {
    if (isAlreadyInitialized(target)) return null;
    fs.mkdirSync(target, { recursive: true });

    let placed = 0;
    for (const { rel, mode } of plan) {
      const from = path.join(source, rel);
      try {
        if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
      } catch {
        continue;
      }
      placed += placeTree(from, path.join(target, rel), mode);
    }
    for (const { rel, mode } of files) {
      const from = path.join(source, rel);
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

    const marker = path.join(target, markerRel);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      JSON.stringify({ migratedFrom: source, files: placed, at: new Date().toISOString() }, null, 2),
      'utf8'
    );

    warn(`imported ${placed} file(s) from ${source}`);
    return source;
  } catch (err) {
    // Non-fatal: a failed import must not brick first launch — AW Next starts with a fresh config
    // and the source folder is still intact for a manual copy. Log it so it reaches the main log.
    warn(`${label} import failed: ${(err && err.message) || err}`);
    return null;
  }
}

/** Import legacy 1.6.8 user data once without deleting the source directory. */
function migrateLegacyUserData(newUserDataDir, options = {}) {
  const source = options.legacyDir || legacyUserDataDir();
  const imported = importUserData({
    source,
    target: newUserDataDir,
    plan: MIGRATION_PLAN,
    files: MIGRATION_FILES,
    markerRel: MARKER_REL,
    label: 'legacy',
  });
  if (imported && !options.skipRegistry) migratePlaytimeRegistry(LEGACY_PLAYTIME_ROOT);
  return imported;
}

/**
 * Import an existing "Achievement Watcher 3.0" data folder into the AW Next one.
 * Runs before the 1.6.8 import: once this succeeds the target has cfg/options.ini, so the older
 * hop sees an initialized directory and correctly does nothing.
 */
function migrateAw3UserData(newUserDataDir, options = {}) {
  const source = options.aw3Dir || aw3UserDataDir();
  const imported = importUserData({
    source,
    target: newUserDataDir,
    plan: AW3_MIGRATION_PLAN,
    files: AW3_MIGRATION_FILES,
    markerRel: AW3_MARKER_REL,
    label: 'aw3',
  });
  if (imported && !options.skipRegistry) migratePlaytimeRegistry(AW3_PLAYTIME_ROOT);
  return imported;
}

/**
 * Point the GBE restore-point index at the copies that now live in this data folder.
 *
 * `backups/` is migrated like everything else, so each restore point exists here — but the index
 * records an absolute `backupDir`, and importing a file does not rewrite what is inside it. Every
 * entry therefore kept naming the folder it came from. That reads as working, because the old
 * folder is still on disk: right up until it is not. The uninstaller removes
 * `%APPDATA%\Achievement Watcher 3.0` outright, and it is the obvious thing to delete by hand once
 * AW Next has taken over — either one silently turns every "restore backup" button into a dead path.
 *
 * Only entries whose backup is actually present here are rewritten, so an entry pointing somewhere
 * this cannot vouch for is left exactly as it was rather than repointed at nothing.
 */
function retargetBackupIndex(userDataDir, options = {}) {
  const indexFile = path.join(userDataDir, 'cfg', 'gbe-backups.db');
  const backupRoot = options.backupRoot || path.join(userDataDir, 'backups', 'gbe');
  try {
    if (!fs.existsSync(indexFile)) return 0;
    const entries = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (!Array.isArray(entries)) return 0;

    let changed = 0;
    for (const entry of entries) {
      const current = entry && typeof entry.backupDir === 'string' ? entry.backupDir : '';
      if (!current) continue;
      // Already ours: nothing to do, and this keeps re-runs free.
      if (path.resolve(current).toLowerCase().startsWith(path.resolve(backupRoot).toLowerCase())) continue;
      const moved = path.join(backupRoot, path.basename(current));
      if (!fs.existsSync(moved)) continue;
      entry.backupDir = moved;
      changed += 1;
    }

    if (changed > 0) {
      fs.writeFileSync(indexFile, JSON.stringify(entries, null, 2), 'utf8');
      warn(`repointed ${changed} GBE restore point(s) at this data folder`);
    }
    return changed;
  } catch (err) {
    // Best-effort: a restore point that cannot be repointed still works while its source folder is
    // there, and a broken index must never stop the app from starting.
    warn(`could not repoint the GBE restore points: ${(err && err.message) || err}`);
    return 0;
  }
}

// Read `[souvenir] dir` straight out of options.ini. A hand-rolled reader keeps the ini package and
// the whole settings module out of the first few lines of the main process, where this runs.
function configuredSouvenirDir(userDataDir) {
  try {
    const text = fs.readFileSync(path.join(userDataDir, SETTINGS_REL), 'utf8');
    const section = text.split(/^\[/m).find((part) => part.startsWith('souvenir]'));
    if (!section) return '';
    const line = section.split(/\r?\n/).find((l) => /^\s*dir\s*=/.test(l));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch {
    return '';
  }
}

/**
 * Point screenshot souvenirs at the AW Next default folder, carrying the existing shots across.
 *
 * Only the *default* location is ever touched. A user who chose their own souvenir folder keeps it
 * exactly where it is — that path is theirs, and silently relocating someone's screenshots would be
 * the one genuinely destructive thing this file could do. Shots are hard-linked, so both folders
 * show them and no disk space is used twice.
 */
function migrateSouvenirFolder(userDataDir, options = {}) {
  const home = options.homeDir || os.homedir();
  if (!home) return null;
  if (configuredSouvenirDir(userDataDir)) return null; // user-chosen path: leave it alone

  const from = options.fromDir || path.join(home, 'Pictures', AW3_SOUVENIR_DIR_NAME);
  const to = options.toDir || path.join(home, 'Pictures', SOUVENIR_DIR_NAME);
  const marker = path.join(userDataDir, SOUVENIR_MARKER_REL);

  try {
    if (fs.existsSync(marker)) return null;
    if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return null;
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) return null;

    const placed = placeTree(from, to, 'link');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ migratedFrom: from, files: placed, at: new Date().toISOString() }, null, 2), 'utf8');
    warn(`linked ${placed} souvenir(s) from ${from}`);
    return from;
  } catch (err) {
    warn(`souvenir migration failed: ${(err && err.message) || err}`);
    return null;
  }
}

module.exports = {
  migrateLegacyUserData,
  migrateAw3UserData,
  migrateSouvenirFolder,
  retargetBackupIndex,
  configuredSouvenirDir,
  SOUVENIR_DIR_NAME,
  AW3_SOUVENIR_DIR_NAME,
  SOUVENIR_MARKER_REL,
  migratePlaytimeRegistry,
  isAlreadyInitialized,
  MIGRATION_PLAN,
  MIGRATION_FILES,
  AW3_MIGRATION_PLAN,
  AW3_MIGRATION_FILES,
  MARKER_REL,
  AW3_MARKER_REL,
  LEGACY_PLAYTIME_ROOT,
  AW3_PLAYTIME_ROOT,
  PLAYTIME_ROOT,
};
