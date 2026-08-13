'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const init = fs.readFileSync(path.join(root, 'app', 'electron', 'init.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app', 'resources', 'css', 'app.css'), 'utf8');

test('custom notification placement follows its saved display instead of the cursor display', () => {
  assert.match(init, /function notificationPlacementArea\(customAnchor = null\)/);
  assert.match(init, /getDisplayNearestPoint\(\{[\s\S]*?customAnchor\.x[\s\S]*?customAnchor\.y/);
  assert.match(init, /savedDisplay\.bounds/);
  assert.match(init, /const customAnchor = position === 'custom' \? readOverlayBounds\(\)\.notif : null/);
  assert.match(init, /notificationPlacementArea\(customAnchor\)/);
  assert.match(init, /margin: position === 'custom' \? 0 : undefined/);
});

test('Windows repositioning persists on move and real custom popups keep exact bounds', () => {
  assert.match(init, /notif\.on\('move',[\s\S]*?setTimeout\(persistNotificationPosition, 80\)/);
  assert.match(init, /notif\.on\('close',[\s\S]*?persistNotificationPosition\(\)/);
  assert.match(init, /notif\.on\('will-move',[\s\S]*?event\.preventDefault\(\)[\s\S]*?setBounds\(lockedCustomBounds, false\)/);
  assert.match(init, /notif\.on\('show',[\s\S]*?setBounds\(lockedCustomBounds, false\)/);
  assert.match(init, /notif\.on\('move',[\s\S]*?getBounds\(\)[\s\S]*?setBounds\(lockedCustomBounds, false\)/);
  assert.doesNotMatch(init, /notif\.on\('moved'/);
});

test('selected-folder scan button uses the compact secondary surface', () => {
  assert.match(css, /#settings \.folder-rescan-actions #folder-rescan-run\s*\{[\s\S]*?box-shadow:\s*none/);
});
