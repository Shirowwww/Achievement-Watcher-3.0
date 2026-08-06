'use strict';

/*
  Single source of truth for "is this game actually installed?" — used to drive the
  "show installed only" toggle in the game list.

  Dependency-free (no fs / no Electron) so it can be unit-tested in isolation. The caller
  resolves the disk signals (gameDir + exe, exeList entry) and passes booleans in.

  isInstalled({ dataType, hasResolvedExe, hasExeListExe, trustedInstalled }) -> boolean

  A game counts as installed when ANY of:
    (A) it comes from a source whose entries are always real installs: an RPCS3/Xenia emulator
        game folder or a Social Club profile folder. A legit Steam entry (steamAPI) is NOT in
        this set: scanLegit lists OWNED games too, so the caller must pass the per-game Steam
        registry "Installed" flag as trustedInstalled, OR
    (B) the caller proved it installed by other means (trustedInstalled) — e.g. a legit Ubisoft
        Connect game found in the launcher's Installs registry, OR
    (C) we have on-disk proof: a resolved install folder with a valid game exe, or a still-living
        configured launch exe (exeList) for it.

  Everything else has no proof and is treated as a "phantom" -> not installed. Note: the gog/epic
  parsers scan Nemirtingas EMULATOR save folders (not the real GOG/Epic launchers), so source name
  is NOT a trust signal — those go through the on-disk proof path like any other emulator save.
*/

// Sources whose every entry is, by construction, a real on-disk install. steamAPI is deliberately
// absent: its scan lists owned games as well as installed ones, so install proof comes from the
// per-game Steam registry flag (passed as trustedInstalled by the caller).
const TRUSTED_TYPES = new Set(['rpcs3', 'xenia', 'socialclub']);

function isInstalled({ dataType, hasResolvedExe, hasExeListExe, trustedInstalled } = {}) {
  const type = String(dataType || '').toLowerCase();

  if (TRUSTED_TYPES.has(type)) return true;
  if (trustedInstalled) return true;

  return !!hasResolvedExe || !!hasExeListExe;
}

module.exports = { isInstalled, TRUSTED_TYPES };
