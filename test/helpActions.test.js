'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'view', 'app.html'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'locale', 'loader.js'), 'utf8');
const settingsUi = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
const localeDir = path.join(root, 'app', 'locale', 'lang');

test('help shortcuts use the localized navigation labels and the normal settings navigation', () => {
  const actions = [
    ['folder', 'help-action-folder'],
    ['source', 'help-action-source'],
    ['notification', 'help-action-notification'],
  ];

  for (const [view, id] of actions) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-help-view="${view}"`));
    assert.match(loader, new RegExp(`bindHelpAction\\('${id}', template\\.settings\\.sideMenu\\.${view}\\)`));
  }
  assert.match(settingsUi, /\$\('#settings \[data-help-view\]'\)[\s\S]*#settingNav li\[data-view='/);
});

test('every bundled locale supplies the labels reused by help shortcuts', () => {
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const key of ['folder', 'source', 'notification']) {
      assert.ok(String(locale.settings?.sideMenu?.[key] || '').trim(), `${file}: missing sideMenu.${key}`);
    }
  }
});
