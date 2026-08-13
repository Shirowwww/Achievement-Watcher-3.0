'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { isSafeExternalUrl, openExternalSafe } = require(path.join(__dirname, '..', '..', 'app', 'util', 'externalLink.js'));

test('web links are accepted', () => {
  for (const url of [
    'https://pixeldrain.com/u/abc123',
    'http://example.com/file.zip',
    'HTTPS://EXAMPLE.COM/A',
    'https://example.com/a?b=c#d',
  ]) {
    assert.equal(isSafeExternalUrl(url), true, url);
  }
});

test('a remote catalog cannot make the app launch another scheme', () => {
  // fixes[].href / source_crack[] come from the CrakFiles catalog over the network, and
  // shell.openExternal() launches whatever handler Windows registered for the scheme.
  for (const url of [
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x&crumb=location:\\\\attacker\\share',
    'file:///C:/Windows/System32/calc.exe',
    '\\\\attacker\\share\\payload.exe',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'steam://uninstall/440', // app-built URLs bypass this guard on purpose; catalog data never gets one
  ]) {
    assert.equal(isSafeExternalUrl(url), false, url);
  }
});

test('malformed and nullish values are rejected without throwing', () => {
  for (const url of [null, undefined, '', '   ', 'not a url', 42, {}, []]) {
    assert.equal(isSafeExternalUrl(url), false, String(url));
  }
});

test('openExternalSafe forwards a web link exactly once', () => {
  const opened = [];
  const shell = { openExternal: (u) => opened.push(u) };
  assert.equal(openExternalSafe(shell, 'https://example.com/a', () => assert.fail('should not reject')), true);
  assert.deepEqual(opened, ['https://example.com/a']);
});

test('openExternalSafe reports a rejected link instead of opening it', () => {
  const opened = [];
  const rejected = [];
  const shell = {
    openExternal: (u) => {
      opened.push(u);
      throw new Error('must not be called');
    },
  };
  assert.equal(openExternalSafe(shell, 'ms-msdt:/id PCWDiagnostic', (u) => rejected.push(u)), false);
  assert.deepEqual(opened, []);
  assert.deepEqual(rejected, ['ms-msdt:/id PCWDiagnostic']);
});

test('a rejected link without a callback still does not open or throw', () => {
  const shell = { openExternal: () => assert.fail('must not be called') };
  assert.doesNotThrow(() => assert.equal(openExternalSafe(shell, 'file:///C:/x.exe'), false));
});

test('an openExternal rejection is swallowed rather than surfacing as unhandled', () => {
  const shell = { openExternal: () => Promise.reject(new Error('no handler')) };
  assert.equal(openExternalSafe(shell, 'https://example.com'), true);
});

test('every CrakFiles catalog link in the renderer goes through the guard', () => {
  // The catalog is remote, so these must not reach shell.openExternal directly again.
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8');
  for (const bad of [
    'openExternal(fix.href)',
    'openExternal(src)',
    'openExternal(href)',
  ]) {
    assert.ok(!source.includes(bad), `${bad} must go through openCatalogLink()`);
  }
  assert.ok(source.includes('openCatalogLink(fix.href)'));
});
