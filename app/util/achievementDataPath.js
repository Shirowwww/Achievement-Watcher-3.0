'use strict';

// Where an entry's achievement data was actually read from.
//
// Every parser records that location on the scanned record as `data.path` — the emulator save
// folder, the trophy directory, the Ubisoft spool folder, ... It is the single most useful piece of
// diagnostic information about a library entry (it says which source produced the card), but it was
// only ever visible in the logs, so users had to guess among the watched roots to find it (issue
// #21). Surfacing it is a one-line lookup; deciding whether it is a folder a file manager can open
// is what needs care, hence this helper.
//
// Two sources keep a REGISTRY key there instead of a filesystem path (GreenLuma and LumaPlay store
// unlock state under HKCU), and opening those in Explorer would land the user in an unrelated
// folder — worse than offering nothing. They are filtered out here.

// Windows-shaped absolute paths ("C:\…", "C:/…", "\\server\share") plus POSIX ones, checked without
// path.isAbsolute so the answer does not depend on which platform the code happens to run on.
function isFilesystemPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/');
}

function resolveAchievementDataPath(data) {
  const raw = String((data && data.path) || '').trim();
  return isFilesystemPath(raw) ? raw : '';
}

module.exports = { resolveAchievementDataPath, isFilesystemPath };
