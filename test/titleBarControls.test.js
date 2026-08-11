'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', 'app');

test('title-bar keeps the original Font Awesome controls and IPC actions', () => {
  const source = fs.readFileSync(path.join(appDir, 'components/titleBar/titleBar.js'), 'utf8');
  const css = fs.readFileSync(path.join(appDir, 'resources/css/titlebar.css'), 'utf8');

  assert.match(source, /id="btn-close"[^>]*><i class="fas fa-times"><\/i>/);
  assert.match(source, /id="btn-maximize"[^>]*><i class="far fa-window-maximize"><\/i>/);
  assert.match(source, /id="btn-minimize"[^>]*><i class="far fa-window-minimize"><\/i>/);
  assert.match(source, /id="btn-settings"[^>]*><i class="fas fa-cog"><\/i>/);
  assert.match(source, /id="window-controls"/);
  assert.match(css, /ul > li#btn-close:hover/);
  assert.match(css, /ul > li#btn-settings:hover i/);
  assert.match(css, /max-width: calc\(100% - 180px\)/);
  assert.match(css, /ul#window-controls\s*\{\s*display: flex;\s*width: 180px;/);
  assert.match(source, /invoke\('win-close'\)/);
  assert.match(source, /invoke\('win-maximize'\)/);
  assert.match(source, /invoke\('win-minimize'\)/);
  assert.match(source, /CustomEvent\('open-settings'\)/);
});
