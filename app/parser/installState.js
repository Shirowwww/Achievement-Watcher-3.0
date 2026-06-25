'use strict';

/*
  Single source of truth for "is this game actually installed?" — used to drive the
  "show installed only" toggle in the game list.

  Dependency-free (no fs / no Electron) so it can be unit-tested in isolation. The caller
  resolves the disk signals (gameDir + exe, exeList entry) and passes booleans in.

  isInstalled({ dataType, hasResolvedExe, hasExeListExe, trustedInstalled }) -> boolean

  A game counts as installed when ANY of:
    (A) it comes from a source whose entries are always real installs: a legit Steam library
        entry (steamAPI) or an RPCS3 emulator game folder, OR
    (B) the caller proved it installed by other means (trustedInstalled) — e.g. a legit Ubisoft
        Connect game found in the launcher's Installs registry, OR
    (C) we have on-disk proof: a resolved install folder with a valid game exe, or a still-living
        configured launch exe (exeList) for it.

  Everything else has no proof and is treated as a "phantom" -> not installed. Note: the gog/epic
  parsers scan Nemirtingas EMULATOR save folders (not the real GOG/Epic launchers), so source name
  is NOT a trust signal — those go through the on-disk proof path like any other emulator save.
*/

// Sources whose every entry is, by construction, a real on-disk install.
const TRUSTED_TYPES = new Set(['steamapi', 'rpcs3', 'xenia']);

function isInstalled({ dataType, hasResolvedExe, hasExeListExe, trustedInstalled } = {}) {
  const type = String(dataType || '').toLowerCase();

  if (TRUSTED_TYPES.has(type)) return true;
  if (trustedInstalled) return true;

  return !!hasResolvedExe || !!hasExeListExe;
}

module.exports = { isInstalled, TRUSTED_TYPES };
