'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lazyRequire } = require('../util/lazyRequire.js');

// The daemon defers its network/scraping/archive dependencies, so the proxy has to survive every
// call shape those modules are used with - a plain call, a method call, and destructuring.

test('nothing is loaded until the module is touched', () => {
  const id = require.resolve('node-html-parser');
  delete require.cache[id];
  const html = lazyRequire('node-html-parser');
  assert.equal(require.cache[id], undefined, 'wrapping must not load the module');

  assert.equal(html.parse('<p id="x">hi</p>').querySelector('#x').text, 'hi');
  assert.ok(require.cache[id], 'first access must load the module');
});

test('a callable module stays callable and keeps its properties', async () => {
  const glob = lazyRequire('fast-glob');
  const files = await glob(['*.json'], { cwd: __dirname + '/..', onlyFiles: true });
  assert.ok(files.includes('package.json'));

  const request = lazyRequire('request-zero');
  assert.equal(typeof request, 'function');
  assert.equal(typeof request.getJson, 'function');
  assert.equal(typeof request.download, 'function');
});

test('methods keep their module as receiver and destructuring works', () => {
  const crc = lazyRequire('crc');
  const { crc32 } = crc;
  assert.equal(crc.crc32('ACH_1').toString(16), crc32('ACH_1').toString(16));
});

test('the module is required once and reused', () => {
  const id = require.resolve('crc');
  delete require.cache[id];

  const crc = lazyRequire('crc');
  crc.crc32('a');
  const loaded = require.cache[id];
  crc.crc32('b');

  assert.equal(require.cache[id], loaded, 'a second access must not re-require');
});
