'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('renderer-side controller polling follows the main tray-window visibility signal', () => {
  const init = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'ui', 'controller.js'), 'utf8');

  // The handlers also drive the idle renderer release (see backgroundFootprint.test.js), so match
  // the contract - show reports visible, hide reports hidden - rather than a one-line body.
  assert.match(init, /MainWin\.on\('show',[\s\S]{0,200}?sendMainWindowVisibility\(true\)/);
  assert.match(init, /MainWin\.on\('hide',[\s\S]{0,200}?sendMainWindowVisibility\(false\)/);
  assert.match(init, /did-finish-load', \(\) => sendMainWindowVisibility\(MainWin\.isVisible\(\)\)/);
  assert.match(source, /let mainWindowVisible = false;/);
  assert.match(source, /main-window-visibility/);
  assert.match(source, /return isAppControllerEnabled\(\) && mainWindowVisible && document\.visibilityState === 'visible';/);
  assert.match(source, /isAppControllerEnabled\(\)/);
  assert.match(source, /controller-settings-changed/);
  assert.match(source, /appNavigation/);
  assert.match(source, /if \(pollFrame !== null\) cancelAnimationFrame\(pollFrame\);/);
  assert.match(source, /if \(pollFrame !== null \|\| !canPoll\(\)\) return;/);
});
