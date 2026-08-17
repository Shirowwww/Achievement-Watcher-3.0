'use strict';

// <userData>/theme-images grew without bound: re-picking a background copied it again under " (n)",
// and every theme-editor autosave re-ran the blur pipeline over it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const themeImages = require('../../app/util/themeImages.js');

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-theme-images-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('sameContent matches byte-identical copies and rejects different bytes', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const copy = path.join(dir, 'copy.png');
    const other = path.join(dir, 'other.png');
    fs.writeFileSync(a, Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(copy, Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(other, Buffer.from([1, 2, 3, 5]));

    assert.equal(themeImages.sameContent(a, copy), true);
    assert.equal(themeImages.sameContent(a, other), false);
  });
});

test('sameContent rejects same-size-different-bytes and never throws on a missing file', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    fs.writeFileSync(a, Buffer.from([9, 9]));
    assert.equal(themeImages.sameContent(a, path.join(dir, 'nope.png')), false);
    assert.equal(themeImages.sameContent(path.join(dir, 'nope.png'), a), false);
    // A directory is not a reusable copy.
    assert.equal(themeImages.sameContent(a, dir), false);
  });
});

test('a derived copy is current until its source changes', () => {
  withTmp((dir) => {
    const source = path.join(dir, 'bg.png');
    const derived = path.join(dir, 'bg-blur-8.png');
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(derived, 'blurred');
    assert.equal(themeImages.isDerivedUpToDate(source, derived), true);

    // Re-picking a newer image under the same name must invalidate the generated copy.
    const later = fs.statSync(derived).mtimeMs + 5000;
    fs.utimesSync(source, later / 1000, later / 1000);
    assert.equal(themeImages.isDerivedUpToDate(source, derived), false);
  });
});

test('a missing derived copy is never treated as current', () => {
  withTmp((dir) => {
    const source = path.join(dir, 'bg.png');
    fs.writeFileSync(source, 'source');
    assert.equal(themeImages.isDerivedUpToDate(source, path.join(dir, 'absent.png')), false);
  });
});
