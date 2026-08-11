'use strict';

// Return a filesystem path for achievement data, or '' for registry-backed sources.

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
