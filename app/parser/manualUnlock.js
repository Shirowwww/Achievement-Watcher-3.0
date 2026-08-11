'use strict';

/*
  Manual achievement unlocks.

  Some saves don't carry unlock state for every achievement (or the schema does not match the save),
  so the app lets the user mark an achievement as manually unlocked. The override lives in a small
  sidecar (`cfg/manual-unlocks.json`) keyed by `appid::source` then achievement name — it never
  touches the game's own save files.

  The module is renderer-friendly (synchronous fs, no Electron dependency when a path is injected)
  so the pure logic stays unit-testable.
*/

const fs = require('fs');
const path = require('path');

let userDataPath = null;

function setUserDataPath(p) {
  userDataPath = p;
}

function sidecarFile() {
  if (userDataPath) return path.join(userDataPath, 'cfg/manual-unlocks.json');
  try {
    const { app } = require('@electron/remote');
    return path.join(app.getPath('userData'), 'cfg/manual-unlocks.json');
  } catch {
    return null;
  }
}

function gameKey(appid, source) {
  return `${String(appid == null ? '' : appid)}::${String(source || '')}`;
}

function readMap(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(filePath, map) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(map, null, 2), 'utf8');
}

function getEntriesForGame(map, appid, source) {
  const entries = map && map[gameKey(appid, source)];
  return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {};
}

// Merge manual entries into a loaded game object (mutates in place for renderer simplicity and
// returns the number of achievements that changed). Achievements that were already unlocked by the
// real save keep their original timestamp; manual ones get `manual: true` so the UI can clear them.
function applyToGame(game, map, appid, source) {
  if (!game || !game.achievement || !Array.isArray(game.achievement.list)) return 0;
  const entries = getEntriesForGame(map, appid, source);
  const names = Object.keys(entries);
  const hasOverrides = names.length > 0;

  let changed = 0;
  for (const achievement of game.achievement.list) {
    if (!achievement || achievement.name == null) continue;
    const key = String(achievement.name);
    const entry = entries[key];
    if (hasOverrides && entry && typeof entry === 'object') {
      if (!achievement.Achieved) {
        achievement.Achieved = true;
        // Remember that the unlock exists only because of this override, so clearing it can take
        // the unlock back. Without it, `manual` alone cannot say whether the real save had it too.
        achievement.manualForced = true;
        changed++;
      }
      if (!achievement.UnlockTime && Number(entry.earned_time) > 0) {
        achievement.UnlockTime = Number(entry.earned_time);
      } else if (!achievement.UnlockTime) {
        achievement.UnlockTime = Number(entry.earned_time) || Math.floor(Date.now() / 1000);
      }
      if (!achievement.manual) {
        achievement.manual = true;
        changed++;
      }
    } else if (achievement.manual) {
      // Override cleared — drop the marker, and take the unlock back when the override is what
      // created it. The real save's own unlock state is left alone: only a forced one is undone.
      delete achievement.manual;
      if (achievement.manualForced) {
        achievement.Achieved = false;
        delete achievement.manualForced;
      }
      changed++;
    }
  }

  // Keep the header counters consistent with what is displayed.
  if (hasOverrides || changed > 0) {
    game.achievement.unlocked = game.achievement.list.filter((a) => a && a.Achieved).length;
  }
  return changed;
}

// Mark (or clear) a single manual unlock. Returns { map, changed } so callers can persist.
function update(map, appid, source, name, action, now = Math.floor(Date.now() / 1000)) {
  const key = gameKey(appid, source);
  const entries = getEntriesForGame(map, appid, source);
  const normalizedName = String(name == null ? '' : name);
  if (!normalizedName) return { map, changed: false };

  let changed = false;
  if (action === 'mark-unlocked') {
    if (!entries[normalizedName]) {
      entries[normalizedName] = { earned_time: Number(now) || Math.floor(Date.now() / 1000), manual: true };
      changed = true;
    } else if (!entries[normalizedName].manual) {
      entries[normalizedName].manual = true;
      changed = true;
    }
  } else if (action === 'clear-manual') {
    if (entries[normalizedName] && entries[normalizedName].manual) {
      delete entries[normalizedName];
      changed = true;
    }
  }

  if (Object.keys(entries).length === 0) {
    delete map[key];
  } else {
    map[key] = entries;
  }
  return { map, changed };
}

// Convenience for the renderer: read sidecar, apply to game, return the map (empty on failure).
function loadAndApplyToGame(game, appid, source) {
  const file = sidecarFile();
  const map = file ? readMap(file) : {};
  applyToGame(game, map, appid, source);
  return map;
}

// Convenience for the renderer: mark/clear + persist + return the updated map.
function saveUpdate(appid, source, name, action) {
  const file = sidecarFile();
  if (!file) return { map: {}, changed: false };
  const map = readMap(file);
  const result = update(map, appid, source, name, action);
  if (result.changed) writeMap(file, result.map);
  return result;
}

module.exports = {
  setUserDataPath,
  sidecarFile,
  gameKey,
  readMap,
  writeMap,
  applyToGame,
  update,
  loadAndApplyToGame,
  saveUpdate,
};
