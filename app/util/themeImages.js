'use strict';

const fs = require('fs');

// Helpers for <userData>/theme-images: the Custom theme's per-layer backgrounds and their
// generated blur/veil copies.

// Whether two files hold the same bytes. Size is the cheap reject.
function sameContent(a, b) {
  try {
    const left = fs.statSync(a);
    const right = fs.statSync(b);
    if (!left.isFile() || !right.isFile() || left.size !== right.size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

// Whether a generated copy is still current. Its filename already encodes the effect parameters,
// so only the source's mtime can invalidate it.
function isDerivedUpToDate(source, derived) {
  try {
    return fs.statSync(derived).mtimeMs >= fs.statSync(source).mtimeMs;
  } catch {
    return false;
  }
}

module.exports = { sameContent, isDerivedUpToDate };
