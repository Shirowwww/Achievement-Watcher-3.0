'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { iconResultToFileUrl } = require(path.join(__dirname, '..', '..', 'app', 'util', 'iconUrl.js'));

test('a cached local file becomes a file:// URL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-iconurl-'));
  const file = path.join(dir, 'header.jpg');
  fs.writeFileSync(file, 'x');
  try {
    assert.equal(iconResultToFileUrl(file), pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the fetchIcon failure sentinel is reported as a miss, not a file URL', () => {
  // fetchIcon() returns the URL it was handed when it could not download the art. Wrapping that in
  // pathToFileURL() produced file:///…/app/https:/cdn…/header.jpg — truthy, and never equal to the
  // requested URL, so callers read the miss as a success: the portrait<->header fallback never ran
  // and "Use another Steam AppID…" persisted the broken value into cfg/covers.db.
  const url = 'https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg';
  assert.equal(iconResultToFileUrl(url), null);

  const mangled = pathToFileURL(url).href;
  assert.notEqual(mangled, url, 'guards the premise: pathToFileURL mangles rather than rejects an http URL');
});

test('other schemes are misses too', () => {
  assert.equal(iconResultToFileUrl('http://example.com/a.png'), null);
  assert.equal(iconResultToFileUrl('file:///C:/already/a/url.png'), null);
});

test('a local path that no longer exists is a miss', () => {
  assert.equal(iconResultToFileUrl(path.join(os.tmpdir(), 'aw-iconurl-does-not-exist', 'nope.png')), null);
});

test('nullish and non-string input never throw', () => {
  for (const value of [null, undefined, '', 0, 42, {}, []]) {
    assert.equal(iconResultToFileUrl(value), null);
  }
});
