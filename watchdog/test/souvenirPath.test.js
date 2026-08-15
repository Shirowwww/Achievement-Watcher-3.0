'use strict';

/*
  Where a souvenir screenshot is written. Both halves fail silently when they are wrong - a name
  Windows refuses loses the screenshot, and a colliding name replaces one that already exists -
  so the rules are pinned here rather than left to the next unlock to discover.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { _sanitize: sanitize, _uniquePath: uniquePath } = require('../notification/souvenir.js');

test('names Windows would refuse are made safe instead of lost', () => {
  // Reserved device names are rejected whatever the extension.
  for (const reserved of ['NUL', 'CON', 'PRN', 'AUX', 'COM1', 'LPT9', 'nul', 'Com1']) {
    assert.equal(sanitize(reserved), reserved + '_', reserved);
  }
  // ...but only on their own: a title that merely contains one is fine.
  assert.equal(sanitize('NULL'), 'NULL');
  assert.equal(sanitize('CONTROL'), 'CONTROL');

  // Windows drops trailing dots and spaces from the name it creates.
  assert.equal(sanitize('Sam & Max '), 'Sam & Max');
  assert.equal(sanitize('Mr. Do.'), 'Mr. Do');
  assert.equal(sanitize('...'), 'Unknown');

  // Illegal characters, and control characters, go.
  assert.equal(sanitize('Assassin\'s Creed: Black Flag'), 'Assassin\'s Creed Black Flag');
  assert.equal(sanitize('a/b\\c<d>e|f?g*h"i'), 'abcdefghi');
  assert.equal(sanitize('game' + String.fromCharCode(7) + ' title' + String.fromCharCode(31)), 'game title');

  // Legal punctuation is kept - the point is to stay recognizable, not to strip everything.
  assert.equal(sanitize('Mr. Do!'), 'Mr. Do!');
  assert.equal(sanitize('The Last of Us™ Part II Remastered'), 'The Last of Us™ Part II Remastered');

  // Nothing usable left, or nothing given.
  for (const empty of ['', '   ', null, undefined, '<<<>>>']) assert.equal(sanitize(empty), 'Unknown');

  // Long titles stay within the path budget.
  assert.equal(sanitize('x'.repeat(400)).length, 100);
});

test('a second unlock in the same second does not replace the first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-souvenir-'));
  try {
    const base = '2026-08-15 22-04-11 - Arsenal';

    const first = uniquePath(dir, base);
    assert.equal(path.basename(first), base + '.png');
    fs.writeFileSync(first, 'first');

    const second = uniquePath(dir, base);
    assert.equal(path.basename(second), base + ' (2).png');
    fs.writeFileSync(second, 'second');

    assert.equal(path.basename(uniquePath(dir, base)), base + ' (3).png');
    // The earlier shots are still there, untouched.
    assert.equal(fs.readFileSync(first, 'utf8'), 'first');
    assert.equal(fs.readFileSync(second, 'utf8'), 'second');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
