'use strict';

const path = require('path');

// Folder selections come from the renderer, while discovery reads the persisted folder lists. Keep
// the comparison in one small, platform-stable helper so trailing slashes and drive-letter casing do
// not turn the same Windows directory into two different scan roots.
function directoryKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let normalized = path.win32.normalize(raw);
  const root = path.win32.parse(normalized).root;
  if (normalized !== root) normalized = normalized.replace(/[\\/]+$/, '');
  return normalized.toLowerCase();
}

function uniqueDirectories(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const directory = String(value || '').trim();
    const key = directoryKey(directory);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(directory);
  }
  return result;
}

function normalizeScanScope(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    userDirs: uniqueDirectories(value.userDirs),
    libraryDirs: uniqueDirectories(value.libraryDirs),
  };
}

function selectedDirectories(scope) {
  if (!scope) return [];
  return uniqueDirectories([...(scope.userDirs || []), ...(scope.libraryDirs || [])]);
}

function filterSelectedDirectories(values, selected, getPath = (value) => value) {
  if (!Array.isArray(selected)) return Array.isArray(values) ? values : [];
  const selectedKeys = new Set(selected.map(directoryKey).filter(Boolean));
  return (Array.isArray(values) ? values : []).filter((value) => selectedKeys.has(directoryKey(getPath(value))));
}

function pathIsWithinSelectedDirectories(value, scope) {
  const candidate = directoryKey(value);
  if (!candidate) return false;
  return selectedDirectories(scope).some((directory) => {
    const root = directoryKey(directory);
    const prefix = root.endsWith('\\') ? root : `${root}\\`;
    return candidate === root || candidate.startsWith(prefix);
  });
}

function cacheValue(scope) {
  if (!scope) return null;
  return {
    userDirs: (scope.userDirs || []).map(directoryKey),
    libraryDirs: (scope.libraryDirs || []).map(directoryKey),
  };
}

module.exports = {
  cacheValue,
  directoryKey,
  filterSelectedDirectories,
  normalizeScanScope,
  pathIsWithinSelectedDirectories,
  selectedDirectories,
};
