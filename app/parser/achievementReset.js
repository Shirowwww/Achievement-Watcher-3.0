'use strict';

/*
  Per-game achievement reset: put a game back to zero unlocks so it can earn them again, and be able
  to undo it.

  Nothing is ever destroyed in place without a copy. Every file the reset is about to touch - the
  emulator save, AW Next's own unlock baseline, this game's manual overrides - is copied into
  <userData>/backups/achievements/<appid>/<timestamp>/ with a manifest first; restore() copies them
  back to the exact paths they came from.

  Three things have to be cleared together, or the reset only looks like it worked:

    the emulator save     what the game itself reads. Cleared per format (util/achievementResetTargets.js).
    AW Next's baseline    steam_cache/data/<appid>.db, the Watchdog's record of what was already
                          unlocked. Left in place, re-earning an achievement is diffed against a
                          baseline that already has it, so nothing is ever notified again.
    manual overrides      cfg/manual-unlocks.json, which would keep re-marking the same achievements
                          as unlocked on the next render whatever the save says.

  Which folders belong to a game comes from the scan (`game.dataPaths`), not from the source label -
  the same reasoning Game Health uses, and the only thing that stays correct for a merged card whose
  unlocks come from two different emulators.
*/

const fs = require('fs');
const path = require('path');
const targets = require(path.join(__dirname, '..', 'util', 'achievementResetTargets.js'));
const manualUnlock = require(path.join(__dirname, 'manualUnlock.js'));
const shadps4 = require(path.join(__dirname, 'shadps4.js'));
const xenia = require(path.join(__dirname, 'xenia.js'));

// A save folder is a save folder, not a game install: a handful of levels and files is all it holds.
// The bounds stop a mis-resolved path (a whole library root) from walking a disk.
const MAX_DEPTH = 4;
const MAX_FILES = 500;

let userDataPath = null;

function setUserDataPath(p) {
  if (p) userDataPath = p;
}

function backupRoot() {
  return path.join(userDataPath || '', 'backups', 'achievements');
}

function gameBackupRoot(appid) {
  // Appids can be namespaced ("socialclub-<slug>"), so keep the folder name filesystem-safe.
  return path.join(backupRoot(), String(appid).replace(/[^A-Za-z0-9._-]+/g, '_'));
}

function baselineFile(appid) {
  return path.join(userDataPath || '', 'steam_cache', 'data', `${appid}.db`);
}

function statSafe(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

// Every file below `root` that a reset would act on. `root` may be a file (Xenia records the .gpd
// itself) or a folder (every other source records the folder its save lives in).
function collectTargets(root, source, out, depth = 0) {
  if (out.length >= MAX_FILES) return out;
  const stats = statSafe(root);
  if (!stats) return out;

  if (stats.isFile()) {
    const action = targets.resetActionFor(path.basename(root));
    if (action) out.push({ path: root, action, source, size: stats.size });
    return out;
  }
  if (!stats.isDirectory() || depth >= MAX_DEPTH) return out;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectTargets(full, source, out, depth + 1);
    else if (entry.isFile()) {
      const action = targets.resetActionFor(entry.name);
      if (action) out.push({ path: full, action, source, size: statSafe(full)?.size || 0 });
    }
  }
  return out;
}

/*
  What a reset of this game would do, without doing any of it. The renderer shows this before asking
  for confirmation, so the user approves the actual file list rather than a promise.
*/
function plan(game) {
  const appid = game && game.appid != null ? String(game.appid) : '';
  const { resettable, blocked } = targets.classifySources(
    Array.isArray(game && game.dataPaths) && game.dataPaths.length
      ? game.dataPaths
      : game && game.dataPath
        ? [{ source: game.source, path: game.dataPath }]
        : []
  );

  const files = [];
  const seen = new Set();
  for (const entry of resettable) {
    for (const target of collectTargets(entry.path, entry.source, [])) {
      const key = target.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(target);
    }
  }

  const baseline = statSafe(baselineFile(appid)) ? baselineFile(appid) : null;
  const manualEntries = (() => {
    const file = manualUnlock.sidecarFile();
    if (!file) return 0;
    const map = manualUnlock.readMap(file);
    const entries = map[manualUnlock.gameKey(appid, game && game.source)];
    return entries ? Object.keys(entries).length : 0;
  })();

  return {
    appid,
    name: (game && game.name) || '',
    source: (game && game.source) || '',
    files,
    blocked,
    baseline,
    manualEntries,
    // Nothing to act on is not a failure - it is a game that has never recorded an unlock here.
    supported: files.length > 0 || !!baseline || manualEntries > 0,
  };
}

function backupIdFor(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

// Backup names stay readable and collision-free: 0001_achievements.json, 0002_achievements.json.
function backupNameFor(index, original) {
  return `${String(index + 1).padStart(4, '0')}_${path.basename(original)}`;
}

function applyClear(target) {
  if (target.action === targets.ACTION.CLEAR_SHADPS4_XML) {
    const { text, cleared } = shadps4.clearTrophyXml(fs.readFileSync(target.path, 'utf8'));
    fs.writeFileSync(target.path, text, 'utf8');
    return cleared;
  }
  if (target.action === targets.ACTION.CLEAR_XENIA_GPD) {
    const { buffer, cleared } = xenia.clearGpdBuffer(fs.readFileSync(target.path));
    fs.writeFileSync(target.path, buffer);
    return cleared;
  }
  fs.unlinkSync(target.path);
  return 0;
}

/*
  Run a plan. Copies first, then writes: a file that could not be backed up is skipped rather than
  reset, so a full backup always exists for everything that was actually touched.
*/
function run(resetPlan, { now = new Date() } = {}) {
  const backupId = backupIdFor(now);
  const dir = path.join(gameBackupRoot(resetPlan.appid), backupId);
  const filesDir = path.join(dir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const manifest = {
    appid: resetPlan.appid,
    name: resetPlan.name,
    source: resetPlan.source,
    at: now.toISOString(),
    files: [],
    manualUnlocks: null,
  };
  const errors = [];
  let cleared = 0;

  const queue = resetPlan.files.slice();
  // AW Next's own baseline goes through the same backup/restore path as a game save - it is not a
  // game source, so it carries no source label.
  if (resetPlan.baseline) queue.push({ path: resetPlan.baseline, action: targets.ACTION.DELETE, kind: 'baseline' });

  queue.forEach((target, index) => {
    const stored = backupNameFor(index, target.path);
    try {
      fs.copyFileSync(target.path, path.join(filesDir, stored));
    } catch (err) {
      // No copy, no write. Losing progress because a backup failed is the one outcome to avoid.
      errors.push({ path: target.path, stage: 'backup', message: err.message || String(err) });
      return;
    }
    try {
      cleared += applyClear(target);
      manifest.files.push({ original: target.path, stored, action: target.action, source: target.source || '' });
    } catch (err) {
      errors.push({ path: target.path, stage: 'reset', message: err.message || String(err) });
    }
  });

  // Manual overrides live in a shared sidecar, so only this game's entries are removed - and they
  // are kept in the manifest rather than backing up the whole file, which would take another game's
  // later overrides down with it on restore.
  const sidecar = manualUnlock.sidecarFile();
  if (sidecar && resetPlan.manualEntries > 0) {
    try {
      const map = manualUnlock.readMap(sidecar);
      const { map: updated, removed } = manualUnlock.clearGame(map, resetPlan.appid, resetPlan.source);
      if (removed) {
        manifest.manualUnlocks = { source: resetPlan.source || '', entries: removed };
        manualUnlock.writeMap(sidecar, updated);
      }
    } catch (err) {
      errors.push({ path: sidecar, stage: 'manual-unlocks', message: err.message || String(err) });
    }
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { backupId, backupDir: dir, files: manifest.files.length, cleared, errors };
}

// Newest first: the restore a user wants is almost always the reset they just did.
function listBackups(appid) {
  const root = gameBackupRoot(appid);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8'));
      backups.push({
        id: entry.name,
        at: manifest.at || '',
        name: manifest.name || '',
        files: Array.isArray(manifest.files) ? manifest.files.length : 0,
        manualUnlocks: manifest.manualUnlocks ? Object.keys(manifest.manualUnlocks.entries || {}).length : 0,
        path: path.join(root, entry.name),
      });
    } catch {
      /* a directory without a readable manifest is not a restorable backup */
    }
  }
  return backups.sort((left, right) => String(right.id).localeCompare(String(left.id)));
}

/*
  Put a backup back. Files return to the exact paths they were taken from - including AW Next's
  baseline, so restoring does not turn the restored unlocks into a burst of new notifications.
*/
function restore(appid, backupId) {
  const dir = path.join(gameBackupRoot(appid), String(backupId));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const errors = [];
  let restored = 0;

  for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
    try {
      fs.mkdirSync(path.dirname(entry.original), { recursive: true });
      fs.copyFileSync(path.join(dir, 'files', entry.stored), entry.original);
      restored += 1;
    } catch (err) {
      errors.push({ path: entry.original, message: err.message || String(err) });
    }
  }

  if (manifest.manualUnlocks && manifest.manualUnlocks.entries) {
    const sidecar = manualUnlock.sidecarFile();
    if (sidecar) {
      try {
        const map = manualUnlock.readMap(sidecar);
        map[manualUnlock.gameKey(appid, manifest.manualUnlocks.source)] = manifest.manualUnlocks.entries;
        manualUnlock.writeMap(sidecar, map);
      } catch (err) {
        errors.push({ path: sidecar, message: err.message || String(err) });
      }
    }
  }

  return { restored, errors, manifest };
}

module.exports = {
  setUserDataPath,
  plan,
  run,
  listBackups,
  restore,
  backupRoot,
  gameBackupRoot,
  baselineFile,
  _internal: { collectTargets, backupIdFor, backupNameFor },
};
