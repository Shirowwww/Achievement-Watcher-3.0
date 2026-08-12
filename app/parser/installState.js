'use strict';

/*
  Source of truth for "is this game actually installed?" — drives the "show installed only" toggle.
  Dependency-free; the caller passes disk signals in. A game counts as installed when its source is
  always a real install, the caller proved it, or we have on-disk proof. gog/epic scan emulator save
  folders, so they always need on-disk proof.
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
