'use strict';

/*
  Manages the user-override game index (cfg/gameIndex.json) that the watchdog playtime monitor
  reads at startup to match running processes to game appids.

  Shape of an entry: { appid: string, name: string, binary: string, icon: string }
    - binary is the executable filename (no path, e.g. "GameName.exe"), matched case-insensitively
    - icon is the Steam CDN icon hash (filename without extension)

  The watchdog also reads a larger system cache at steam_cache/schema/gameIndex.json;
  this module only manages the smaller per-user override that seeds auto-detected installs.
*/

const { app } = process.type === 'browser' ? require('electron') : require('@electron/remote');
const path = require('path');
const fs = require('fs');

function userFile() {
  return path.join(app.getPath('userData'), 'cfg/gameIndex.json');
}

function readList() {
  try {
    return JSON.parse(fs.readFileSync(userFile(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Return true if this appid already appears in the user override.
module.exports.has = (appid) => {
  try {
    return readList().some((g) => String(g.appid) === String(appid));
  } catch {
    return false;
  }
};

// Insert or update the entry for this appid. If it already exists, refresh binary/name/icon when the
// detected binary changed (so re-detection after a reinstall/move is picked up); otherwise append.
// Silently no-ops on any I/O error so a failure here never blocks the achievement scan.
module.exports.upsert = (entry) => {
  try {
    const list = readList();
    const appid = String(entry.appid);
    const next = {
      appid,
      name: String(entry.name || ''),
      binary: String(entry.binary || ''),
      icon: String(entry.icon || ''),
    };
    const existing = list.find((g) => String(g.appid) === appid);
    if (existing) {
      if (existing.binary === next.binary && existing.name === next.name && existing.icon === next.icon) return;
      existing.binary = next.binary;
      existing.name = next.name;
      existing.icon = next.icon;
    } else {
      list.push(next);
    }
    const file = userFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  } catch {
    /* non-fatal — playtime seeding is best-effort */
  }
};

// Back-compat alias.
module.exports.add = module.exports.upsert;

// Resolve duplicate binary assignments: when two or more appids map to the SAME binary filename, keep
// the entry whose game name best matches the binary and drop the rest. Clears stale cross-game seeds
// (e.g. "Forza Horizon 5" and "Forza Horizon 6" both pointing at forzahorizon6.exe, which would make
// the watchdog attribute playtime to the wrong game). Returns the number of entries removed.
module.exports.reconcile = (games) => {
  try {
    const exeDetect = require(path.join(__dirname, 'exeDetect.js'));
    let list = readList();
    if (list.length < 2) return 0;
    const nameByAppid = new Map((games || []).map((g) => [String(g.appid), g.name]));

    const groups = new Map();
    for (const e of list) {
      const key = String(e.binary || '').toLowerCase();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const drop = new Set();
    for (const [, entries] of groups) {
      if (entries.length < 2) continue;
      const base = String(entries[0].binary).replace(/\.exe$/i, '');
      let best = entries[0];
      let bestScore = -1;
      for (const e of entries) {
        const nm = nameByAppid.get(String(e.appid)) || e.name || '';
        const s = exeDetect.nameSimilarity(nm, base);
        if (s > bestScore) {
          bestScore = s;
          best = e;
        }
      }
      for (const e of entries) if (e !== best) drop.add(e);
    }
    if (drop.size === 0) return 0;
    list = list.filter((e) => !drop.has(e));
    const file = userFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
    return drop.size;
  } catch {
    return 0;
  }
};
