'use strict';

const fs = require('fs');
const path = require('path');

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

// Generated blur/veil copies, named "<layer>-<stem>-blur-<n>.png" / "-veilblur-<n>.png" by
// stylizeThemeLayers. They are derived output, never a candidate to adopt as a layer source.
const DERIVED_NAME = /-(?:blur|veilblur)-[\d.]+\.png$/i;

/*
  An already-stored file holding exactly the source's bytes, whatever layer first imported it.

  Store paths were previously keyed "<layer>-<stem><ext>", so the same wallpaper picked for several
  layers was copied once per layer, and the dedupe check only ever compared against the name the
  current layer would use. One 7.3 MB image observed that way occupied 193 MB across layers and
  re-imports. Nothing deletes from theme-images, so two layers can safely share one file.

  Size is the cheap reject before any file is read.
*/
function findByContent(dir, source) {
  let sourceSize;
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile()) return null;
    sourceSize = stat.size;
  } catch {
    return null;
  }

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const name of names) {
    if (DERIVED_NAME.test(name)) continue;
    const candidate = path.join(dir, name);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.size !== sourceSize) continue;
    } catch {
      continue;
    }
    if (sameContent(source, candidate)) return candidate;
  }
  return null;
}

module.exports = { sameContent, isDerivedUpToDate, findByContent };
