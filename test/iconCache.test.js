'use strict';

// Standalone validation of the icon-cache LRU selector. Run: node test/iconCache.test.js

const path = require('path');
const assert = require('assert');
const { selectStaleIconFolders } = require(path.join(__dirname, '..', 'app', 'util', 'iconCache.js'));

// Under the cap -> delete nothing.
assert.deepStrictEqual(selectStaleIconFolders([{ dir: 'a', size: 10, atimeMs: 1 }], 100), []);
assert.deepStrictEqual(selectStaleIconFolders([], 100), []);

// Over the cap -> evict oldest-accessed first until at/under the cap.
const f = [
  { dir: 'old', size: 60, atimeMs: 1 },
  { dir: 'mid', size: 30, atimeMs: 2 },
  { dir: 'new', size: 30, atimeMs: 3 },
]; // total 120
assert.deepStrictEqual(selectStaleIconFolders(f, 100), ['old']); // 120-60=60 <= 100, stop
assert.deepStrictEqual(selectStaleIconFolders(f, 50), ['old', 'mid']); // 60>50 -> 30 <= 50, stop
assert.deepStrictEqual(selectStaleIconFolders(f, 0).sort(), ['mid', 'new', 'old']); // evict all

// Eviction order follows atime, not array order.
const g = [
  { dir: 'recent', size: 100, atimeMs: 9 },
  { dir: 'ancient', size: 100, atimeMs: 1 },
];
assert.deepStrictEqual(selectStaleIconFolders(g, 100), ['ancient']);

console.log('iconCache.test.js: all assertions passed');
