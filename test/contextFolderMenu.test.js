'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('the game context Folders menu keeps only common locations in compact submenus', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const start = source.indexOf('const gameForDir = list.find((g) => g.appid == appid);');
  const end = source.indexOf('// Catalog links use the mapped Steam appid', start);
  const folderSection = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'the folder-menu section must be identifiable');
  assert.match(folderSection, /const dataPaths = \(gameForDir\?\.dataPaths\?\.length/);
  assert.match(folderSection, /label: t\('achievement-data-folders'/);
  assert.match(folderSection, /submenu: dataMenu/);
  assert.match(folderSection, /copy-achievement-data-path/);
  assert.doesNotMatch(folderSection, /ubisoftFolderMenu|ubisoft-files/);
  assert.match(folderSection, /const cacheMenu = new Menu\(\)/);
  assert.match(folderSection, /submenu: cacheMenu/);
  assert.equal((folderSection.match(/folderMenu\.append\(/g) || []).length, 3, 'the parent menu stays limited to installation, achievement data, and cache groups');
});

test('folder actions and selective-rescan labels are present in every bundled locale', () => {
  const localeDir = path.join(__dirname, '..', 'app', 'locale', 'lang');
  const dialogKeys = [
    'achievement-data-folders',
    'cache-folders',
    'rescan-selected-folders',
    'rescan-selected-help',
    'rescan-select-all',
    'rescan-select-none',
    'rescan-no-folders',
    'rescan-no-selection',
    'rescan-started',
    'rescan-complete',
    'rescan-failed',
  ];

  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const key of dialogKeys) {
      assert.ok(String(locale.dialogs?.[key] || '').trim(), `${file}: missing dialogs.${key}`);
    }
    assert.ok(String(locale.settings?.notification?.option?.urgent?.name || '').trim(), `${file}: missing priority notification name`);
    assert.ok(String(locale.settings?.notification?.option?.urgent?.description || '').trim(), `${file}: missing priority notification description`);
  }
});
