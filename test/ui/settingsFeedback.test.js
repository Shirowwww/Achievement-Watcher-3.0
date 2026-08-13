'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));

const appDir = path.join(__dirname, '..', '..', 'app');
const html = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
const css = fs.readFileSync(path.join(appDir, 'resources', 'css', 'app.css'), 'utf8');
const root = htmlParser.parse(html);

test('maintenance feedback is accessible and automatically dismissed', () => {
  for (const id of ['clear-update-cache-result', 'force-achievement-recheck-result']) {
    const status = root.querySelector(`#${id}`);
    assert.ok(status, `#${id} must exist`);
    assert.strictEqual(status.getAttribute('role'), 'status');
    assert.strictEqual(status.getAttribute('aria-live'), 'polite');
    assert.strictEqual(status.getAttribute('aria-hidden'), 'true');
  }

  assert.match(settingsJs, /function setTransientStatus\(/, 'maintenance actions must share the timed status helper');
  assert.match(settingsJs, /visibleFor[\s\S]*setTimeout/, 'the helper must schedule dismissal');
  assert.match(settingsJs, /result\.text\(''\)[\s\S]*aria-hidden', 'true'/, 'dismissal must clear and hide the live region');
  assert.match(settingsJs, /force-recheck-started[\s\S]*sticky: true/, 'the progress message must stay visible while the scan is running');
  assert.match(css, /\.diag-line\.is-hiding/, 'dismissal must fade instead of disappearing abruptly');
});

test('the achievement recheck action uses an icon shipped with the bundled Font Awesome', () => {
  const row = root.querySelector('#force-achievement-recheck').closest('li');
  assert.ok(row.querySelectorAll('.fa-sync-alt').length >= 2, 'the row and its button must show the sync icon');
  assert.strictEqual(row.querySelectorAll('.fa-rotate').length, 0, 'fa-rotate is not an icon in the bundled Font Awesome version');

  const fontAwesome = fs.readFileSync(path.join(appDir, 'resources', 'css', 'fontawesome.css'), 'utf8');
  assert.match(fontAwesome, /\.fa-sync-alt:before/, 'the replacement icon must exist in the bundled stylesheet');
});

test('settings and its tabs use lightweight entrance animations', () => {
  assert.match(settingsJs, /settingsModal\.addClass\('is-opening'\)/);
  assert.match(settingsJs, /settings-view-opening/);
  assert.match(css, /@keyframes settings-modal-panel-in/);
  assert.match(css, /@keyframes settings-view-reveal/);
  assert.match(css, /settings-section\.is-opening/);
  assert.match(css, /prefers-reduced-motion: reduce/, 'animations must respect reduced-motion preferences');
});
