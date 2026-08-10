'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'view', 'app.html'), 'utf8');
const settingsUi = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
const parser = fs.readFileSync(path.join(root, 'app', 'parser', 'achievements.js'), 'utf8');

test('folder settings expose an explicit selected-folder rescan with reversible selection controls', () => {
  for (const id of ['folder-rescan-list', 'folder-rescan-select-all', 'folder-rescan-select-none', 'folder-rescan-run']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(settingsUi, /await saveCurrentFolderLists\(\);[\s\S]*await app\.onStart\(\{ scanScope: scope \}\)/);
  assert.match(settingsUi, /folderRescanBusy = false;/);
});

test('a selected rescan limits discovery while preserving unrelated tiles and keeps a distinct cache key', () => {
  assert.match(parser, /async function discover\(source, steamAccFilter, scope = null\)/);
  assert.match(parser, /scope: scanScope\.cacheValue\(scanScope\.normalizeScanScope\(option\.scanScope\)\)/);
  assert.match(parser, /if \(scope\) \{[\s\S]*scope\.libraryDirs[\s\S]*return roots;/);
  assert.match(appUi, /const previousGames = activeScanScope \? gameList\.slice\(\) : \[\]/);
  assert.match(appUi, /!gameTouchesScanScope\(game, activeScanScope\)/);
});
