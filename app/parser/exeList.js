'use strict';

const { app } = process.type === 'browser' ? require('electron') : require('@electron/remote');
const path = require('path');
const fs = require('fs');

// This module was never wired to the app logger, yet the code referenced a free `debug` identifier.
// Reading an undeclared variable throws a ReferenceError, which silently broke add()/get()/save().
// A self-contained no-op sink keeps the original log calls harmless.
let debug = { log() {}, error() {}, warn() {} };

const file = path.join(app.getPath('userData'), 'cfg/exeList.db');

module.exports.list = getCurrentList;

async function getCurrentList() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      await module.exports.save([]);
      return [];
    } else {
      throw err;
    }
  }
}

module.exports.get = async (appid) => {
  let defaultCfg = { appid, exe: '', args: '' };
  try {
    let currentList = await getCurrentList();
    let found = currentList.find((app) => String(app.appid) === String(appid));
    return found ? found : defaultCfg;
  } catch (err) {
    debug.log(err);
    return defaultCfg;
  }
};

module.exports.save = async (data) => {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    debug.log(err);
  }
};

module.exports.add = async (app) => {
  try {
    debug.log(`Adding ${app.appid} to exeList ...`);
    let currentList = await getCurrentList();
    // Note: no collision guard here on purpose — `add` also serves the manual file-picker, and the
    // user is allowed to choose any exe. Auto-detection avoids duplicates by passing `taken` to
    // exeDetect, and reconcile() repairs duplicates left over from corrupt/old data at scan time.
    let existingEntry = currentList.find((ap) => String(ap.appid) === String(app.appid));
    if (existingEntry) {
      existingEntry.exe = app.exe;
      existingEntry.args = app.args;
      debug.log(`${app.appid} already on the list, updating path and launch args ...`);
    } else {
      currentList.push(app);
    }
    await this.save(currentList);
    debug.log('Done.');
  } catch (err) {
    debug.log(err);
  }
};

/*
  Reconcile the stored launch list against the currently-installed games (the renderer gameList).

  For every stored entry:
    - drop a dead exe path (file no longer exists) so it can be re-detected;
    - resolve collisions: when one exe is shared by several appids, keep it on the game whose name
      best matches the binary and clear it from the others;
    - re-detect a now-empty exe when we know the game's install folder (gameDir), respecting the
      anti-collision rule (never reuse an exe or game folder already taken by another appid).

  games: [{ appid, name, gameDir }] — best-effort; entries without a gameDir are left for the user
  to configure manually. Returns the number of entries changed.
*/
module.exports.reconcile = async (games) => {
  const goldberg = require(path.join(__dirname, 'goldberg.js'));
  const exeDetect = require(path.join(__dirname, 'exeDetect.js'));
  let changed = 0;
  try {
    const list = await getCurrentList();
    if (list.length === 0) return 0;

    const byAppid = new Map((games || []).map((g) => [String(g.appid), g]));

    // 1) Drop dead exe paths.
    for (const e of list) {
      if (e.exe && e.exe !== '' && !fs.existsSync(e.exe)) {
        e.exe = '';
        changed++;
      }
    }

    // 1b) Drop an exe that lives inside ANOTHER game's install folder. This clears stale wrong
    // auto-detects from older builds (e.g. "Forza Horizon 5" pointing at an exe inside the
    // "Forza Horizon 6" folder) that survive the dead-path and collision checks because the file
    // exists and is otherwise unique.
    const claimed = (games || [])
      .filter((g) => g.gameDir)
      .map((g) => ({ dir: path.resolve(g.gameDir).toLowerCase(), appid: String(g.appid) }));
    for (const e of list) {
      if (!e.exe) continue;
      const exeLower = path.resolve(e.exe).toLowerCase();
      const owner = claimed.find((c) => exeLower === c.dir || exeLower.startsWith(c.dir + path.sep));
      if (owner && owner.appid !== String(e.appid)) {
        e.exe = '';
        changed++;
      }
    }

    // 2) Resolve collisions — group by lowercased exe path.
    const groups = new Map();
    for (const e of list) {
      if (!e.exe) continue;
      const key = e.exe.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const [, entries] of groups) {
      if (entries.length < 2) continue;
      const base = path.basename(entries[0].exe).replace(/\.exe$/i, '');
      let best = entries[0];
      let bestScore = -1;
      for (const e of entries) {
        const g = byAppid.get(String(e.appid));
        const score = g ? exeDetect.nameSimilarity(g.name, base) : 0;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      for (const e of entries) {
        if (e !== best) {
          e.exe = '';
          changed++;
        }
      }
    }

    // 2b) Resolve folder collisions too: one install folder must not keep several auto-assigned
    // executables across different appids. Keep the entry whose game name best matches its exe.
    const folderGroups = new Map();
    for (const e of list) {
      if (!e.exe) continue;
      const g = byAppid.get(String(e.appid));
      if (!g || !g.gameDir) continue;
      const dirKey = path.resolve(g.gameDir).toLowerCase();
      const exeLower = path.resolve(e.exe).toLowerCase();
      if (exeLower !== dirKey && !exeLower.startsWith(dirKey + path.sep)) continue;
      if (!folderGroups.has(dirKey)) folderGroups.set(dirKey, []);
      folderGroups.get(dirKey).push(e);
    }
    for (const [, entries] of folderGroups) {
      if (entries.length < 2) continue;
      let best = entries[0];
      let bestScore = -1;
      for (const e of entries) {
        const g = byAppid.get(String(e.appid));
        const base = path.basename(e.exe).replace(/\.exe$/i, '');
        const score = g ? exeDetect.nameSimilarity(g.name, base) : 0;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      for (const e of entries) {
        if (e !== best) {
          e.exe = '';
          changed++;
        }
      }
    }

    // 3) Re-detect empty entries when we know the install folder.
    const taken = new Set(list.filter((e) => e.exe).map((e) => e.exe.toLowerCase()));
    const takenGameDirs = new Set();
    for (const e of list) {
      if (!e.exe) continue;
      const g = byAppid.get(String(e.appid));
      if (!g || !g.gameDir) continue;
      const dirKey = path.resolve(g.gameDir).toLowerCase();
      const exeLower = path.resolve(e.exe).toLowerCase();
      if (exeLower === dirKey || exeLower.startsWith(dirKey + path.sep)) takenGameDirs.add(dirKey);
    }
    for (const e of list) {
      if (e.exe) continue;
      const g = byAppid.get(String(e.appid));
      if (!g || !g.gameDir) continue;
      const gameDirKey = path.resolve(g.gameDir).toLowerCase();
      if (takenGameDirs.has(gameDirKey)) continue;
      const emu = goldberg.detectEmulator(g.gameDir);
      const res = exeDetect.detect(g.gameDir, g.name, { dllPaths: emu.dll, taken, takenGameDirs });
      if (res && !taken.has(res.full.toLowerCase())) {
        e.exe = res.full;
        taken.add(res.full.toLowerCase());
        takenGameDirs.add(gameDirKey);
        changed++;
      }
    }

    if (changed > 0) await this.save(list);
  } catch (err) {
    debug.log(err);
  }
  return changed;
};
