'use strict';

// Deterministic content fingerprint of a folder tree: SHA-256 over sorted relative paths + file
// contents, rendered as "<prefix>-<hex16>". Two folders with identical content always produce the
// same version string, and any file added/removed/renamed/edited changes it — unlike mtime-based
// checks, which miss in-place rewrites and false-positive on touch. Use it to decide whether a
// derived cache (generated schema, setup attempt, migrated assets) is still current.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/content-version.js — MIT-licensed; see
// NOTICE.md. Pure crypto/fs, no dependencies.
//
// NB: this reads every file under rootDir — cheap for config-sized folders (steam_settings,
// presets), not meant for game install dirs.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function toPortableRelativePath(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).split(path.sep).join('/');
}

function sortDirentsByName(dirents) {
  return [...dirents].sort((left, right) => left.name.localeCompare(right.name));
}

function updateHashForDirectory(hash, rootDir, currentDir) {
  const dirents = sortDirentsByName(fs.readdirSync(currentDir, { withFileTypes: true }));

  for (const dirent of dirents) {
    const fullPath = path.join(currentDir, dirent.name);
    const relativePath = toPortableRelativePath(rootDir, fullPath);

    if (dirent.isDirectory()) {
      hash.update(`d:${relativePath}\0`, 'utf8');
      updateHashForDirectory(hash, rootDir, fullPath);
      continue;
    }

    if (dirent.isFile()) {
      hash.update(`f:${relativePath}\0`, 'utf8');
      hash.update(fs.readFileSync(fullPath));
      hash.update('\0', 'utf8');
      continue;
    }

    if (dirent.isSymbolicLink()) {
      hash.update(`l:${relativePath}\0`, 'utf8');
    }
  }
}

function computeFolderContentVersion(rootDir, { prefix = 'content' } = {}) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return `${prefix}-missing`;
  }

  const hash = crypto.createHash('sha256');
  hash.update(`${prefix}\0`, 'utf8');
  updateHashForDirectory(hash, rootDir, rootDir);
  return `${prefix}-${hash.digest('hex').slice(0, 16)}`;
}

module.exports = {
  computeFolderContentVersion,
};
