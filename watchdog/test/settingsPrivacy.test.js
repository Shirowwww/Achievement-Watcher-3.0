'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the Watchdog never writes the complete settings object to diagnostics', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'watchdog.js'), 'utf8');
  assert.doesNotMatch(source, /debug\.log\s*\(\s*self\.options\s*\)/);
  assert.match(source, /debug\.log\s*\(\s*['"]Options loaded['"]\s*\)/);
});
