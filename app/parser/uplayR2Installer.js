'use strict';

/*
  Uplay R2 emulator-DLL installer — the Ubisoft counterpart of gbeInstaller.js. The demde build has no
  stable download, so the user seeds cacheDir once; this module then drops the matching loader dll into
  game folders with a one-time .bak. Never throws for an unseeded cache — callers check `seeded`.
*/

const fs = require('fs');
const path = require('path');
const { EMU_DLL_NAMES } = require('./uplayR2.js');

const noopLog = { log() {}, error() {} };

// Read the user-seeded cache folder for the 4 known loader dll basenames. Never touches the network.
// Returns { dir, seeded, files: { '<basename>': absolutePath | null } }.
function ensureEmulatorDlls({ cacheDir } = {}) {
  if (!cacheDir) throw new Error('ensureEmulatorDlls: cacheDir is required');
  fs.mkdirSync(cacheDir, { recursive: true });

  const files = {};
  let seeded = false;
  for (const name of EMU_DLL_NAMES) {
    const p = path.join(cacheDir, name);
    if (fs.existsSync(p)) {
      files[name] = p;
      seeded = true;
    } else {
      files[name] = null;
    }
  }
  return { dir: cacheDir, seeded, files };
}

/*
  Install the cached loader dll(s) into one or more dirs, backing up replaced originals as <name>.bak
  once. writeIfMissing drops a basename into dirs that have none. Returns { installed, backedUp, perDir }.
*/
function installDlls({ dllDirs, dlls, writeIfMissing = 'uplay_r2_loader64.dll', log = noopLog } = {}) {
  if (!dlls || !dlls.seeded) throw new Error('installDlls: the Uplay R2 dll cache is not seeded yet');
  const dirs = (Array.isArray(dllDirs) ? dllDirs : [dllDirs]).filter(Boolean);
  if (dirs.length === 0) throw new Error('installDlls: no target directories');

  const summary = { installed: 0, backedUp: 0, perDir: [] };

  for (const dir of dirs) {
    const entry = { dir, wrote: [], backedUp: [] };
    fs.mkdirSync(dir, { recursive: true });

    const present = EMU_DLL_NAMES.filter((name) => fs.existsSync(path.join(dir, name)));
    const targets = present.length > 0 ? [...present] : writeIfMissing ? [writeIfMissing] : [];

    for (const name of targets) {
      const src = dlls.files[name];
      if (!src) continue; // this basename isn't in the seeded cache
      const dest = path.join(dir, name);
      if (fs.existsSync(dest)) {
        const bak = `${dest}.bak`;
        if (!fs.existsSync(bak)) {
          try {
            fs.copyFileSync(dest, bak);
            entry.backedUp.push(name);
            summary.backedUp++;
          } catch (e) {
            log.error(`[uplayR2] could not back up ${dest} => ${e}`);
          }
        }
      }
      fs.copyFileSync(src, dest);
      entry.wrote.push(name);
      summary.installed++;
    }
    summary.perDir.push(entry);
  }
  return summary;
}

module.exports = { ensureEmulatorDlls, installDlls };
