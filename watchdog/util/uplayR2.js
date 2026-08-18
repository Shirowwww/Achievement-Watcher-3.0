'use strict';

/*
  Watchdog-side helpers for Goldberg Uplay R2 saves: the emulator saves under the Ubisoft product id
  with bare objective keys, so the app records the uplayId/steamappid pair on the shared gameIndex.json
  entry and this module matches unlocks against the loaded schema. Dependency-free (fs/path only).
*/

const fs = require('fs');
const path = require('path');
const { userDataDir } = require('./userData.js');

function gameIndexFiles() {
  const root = userDataDir();
  return [
    path.join(root, 'steam_cache', 'schema', 'gameIndex.json'),
    path.join(root, 'cfg', 'gameIndex.json'),
  ];
}

/*
  Resolve a Ubisoft product id to the Steam AppID the app mapped it to.

  Returns '' when the app has not scanned this game yet. The caller must treat that as "skip", never
  as "use the Ubisoft id" - feeding a product id to the Steam pipeline is what used to stall the
  library scan for 30s a game.
*/
function steamAppIdForUplayId(uplayId, { files = gameIndexFiles() } = {}) {
  const key = String(uplayId || '');
  if (!key) return '';
  for (const file of files) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(list)) continue;
      const found = list.find((game) => game && String(game.uplayId || '') === key);
      if (found && found.appid) return String(found.appid);
    } catch {
      /* game index files are optional */
    }
  }
  return '';
}

/*
  Rewrite Uplay R2 objective ids onto the schema's Steam api-names, in place.

  The api-name for a supported game always ends in the objective id (the app only maps games where
  that holds for every achievement), so matching on the trailing digits is exact rather than a guess.
  Entries that already match the schema are left untouched, which covers the prefixed keys a newer
  loader writes. Returns the number of entries rewritten.
*/
function remapObjectiveIds(achievements, schemaList) {
  const list = Array.isArray(schemaList) ? schemaList : [];
  const entries = Array.isArray(achievements) ? achievements : [];
  if (list.length === 0 || entries.length === 0) return 0;

  const known = new Set(list.map((a) => String((a && a.name) || '').toUpperCase()));
  const byDigits = new Map();
  for (const a of list) {
    const digits = String((a && a.name) || '').match(/(\d+)$/);
    if (digits && !byDigits.has(digits[1])) byDigits.set(digits[1], a.name);
  }

  let remapped = 0;
  for (const entry of entries) {
    const name = String((entry && entry.name) || '');
    if (!name || known.has(name.toUpperCase()) || !/^\d+$/.test(name)) continue;
    const resolved = byDigits.get(name);
    if (!resolved) continue;
    entry.name = resolved;
    remapped++;
  }
  return remapped;
}

module.exports = { gameIndexFiles, steamAppIdForUplayId, remapObjectiveIds };
