'use strict';

/*
  Uplay R2 emulator-DLL installer — the Ubisoft counterpart of gbeInstaller.js.

  Unlike GBE Fork (downloaded from Detanup01/gbe_fork's GitHub releases), the working
  achievement-persisting "demde" build of Goldberg Uplay R2 has no stable public/versioned download —
  it's forum-distributed. So there is no network step here: the user seeds cacheDir ONCE with the 4
  loader dll files from their own copy, and this module reads that cache and drops the matching-name
  dll into a game's install folder — replacing whatever loader stub is already there and keeping a
  one-time .bak of the original, same rule gbeInstaller.installDlls follows for steam_api(64).dll.

  This module is renderer-side only (fs); it never throws for "cache not seeded yet" — callers check
  `seeded` and show setup instructions instead of failing.
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
  Install the cached dll(s) into one or more directories. In each dir, every loader dll basename
  already present (from EMU_DLL_NAMES) is replaced by the matching cached file, backing up the
  original as <name>.bak the first time only. When a dir has none of the known basenames yet and
  writeIfMissing is set, that basename is written fresh (default 'uplay_r2_loader64.dll').

  dllDirs         array of absolute directory paths (where the cracked game's loader stub lives)
  dlls            result of ensureEmulatorDlls()
  writeIfMissing  basename to drop into dirs that have no loader dll yet (default: 'uplay_r2_loader64.dll')
  log             optional logger

  Returns { installed, backedUp, perDir: [{ dir, wrote: [...], backedUp: [...] }] }.
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
