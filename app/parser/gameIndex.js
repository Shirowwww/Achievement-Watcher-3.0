'use strict';

/*
  Manages the user-override game index (cfg/gameIndex.json) that the watchdog playtime monitor reads
  at startup to match running processes to appids. Entry shape: { appid, name, binary, icon, source?,
  steamappid?, uplayId?, iconUrl?, headerUrl?, portraitUrl? }. source drives per-platform presets;
  steamappid/uplayId let the watchdog attribute namespaced SocialClub / Uplay R2 games to their
  Steam data, while the resolved artwork fields keep synthetic/manual appids away from invalid
  Steam-CDN URLs.
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

// The stored entry for one appid, or null. Game Health reports which binary the watchdog will
// actually match this game on, which `has` alone cannot answer.
module.exports.get = (appid) => {
  try {
    return readList().find((g) => String(g.appid) === String(appid)) || null;
  } catch {
    return null;
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
      source: String(entry.source || ''),
      steamappid: String(entry.steamappid || ''),
      uplayId: String(entry.uplayId || ''),
      iconUrl: String(entry.iconUrl || ''),
      headerUrl: String(entry.headerUrl || ''),
      portraitUrl: String(entry.portraitUrl || ''),
    };
    if (!next.steamappid) delete next.steamappid;
    if (!next.uplayId) delete next.uplayId;
    if (!next.iconUrl) delete next.iconUrl;
    if (!next.headerUrl) delete next.headerUrl;
    if (!next.portraitUrl) delete next.portraitUrl;
    const existing = list.find((g) => String(g.appid) === appid);
    if (existing) {
      // Metadata-only seeds (e.g. the Ubisoft Connect row that carries uplayId/steamappid) must
      // never wipe fields the generic exe-detection seed already filled.
      const changed =
        (next.binary && existing.binary !== next.binary) ||
        (next.name && existing.name !== next.name) ||
        (next.icon && existing.icon !== next.icon) ||
        (next.source && String(existing.source || '') !== next.source) ||
        (next.steamappid && String(existing.steamappid || '') !== next.steamappid) ||
        (next.uplayId && String(existing.uplayId || '') !== next.uplayId) ||
        (next.iconUrl && String(existing.iconUrl || '') !== next.iconUrl) ||
        (next.headerUrl && String(existing.headerUrl || '') !== next.headerUrl) ||
        (next.portraitUrl && String(existing.portraitUrl || '') !== next.portraitUrl);
      if (!changed) return;
      if (next.binary) existing.binary = next.binary;
      if (next.name) existing.name = next.name;
      if (next.icon) existing.icon = next.icon;
      if (next.source) existing.source = next.source;
      if (next.steamappid) existing.steamappid = next.steamappid;
      if (next.uplayId) existing.uplayId = next.uplayId;
      if (next.iconUrl) existing.iconUrl = next.iconUrl;
      if (next.headerUrl) existing.headerUrl = next.headerUrl;
      if (next.portraitUrl) existing.portraitUrl = next.portraitUrl;
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

module.exports.remove = (appid) => {
  try {
    const key = String(appid);
    const list = readList();
    const next = list.filter((g) => String(g.appid) !== key);
    const removed = list.length - next.length;
    if (removed === 0) return 0;
    const file = userFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return removed;
  } catch {
    return 0;
  }
};

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
