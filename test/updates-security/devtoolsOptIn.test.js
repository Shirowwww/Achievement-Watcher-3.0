'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('development DevTools are opened only when explicitly requested', () => {
  const init = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');

  assert.match(init, /process\.env\.AW_OPEN_DEVTOOLS/);
  const guardedCalls = init.match(/if \(openDevTools\) \w+\.webContents\.openDevTools\(\{ mode: 'undocked' \}\);/g) || [];
  assert.strictEqual(guardedCalls.length, 2, 'the main window and the overlay must both require opt-in');
});
