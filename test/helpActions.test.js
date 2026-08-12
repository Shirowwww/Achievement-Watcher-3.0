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

test('controller help text shows localized button names and no stale window-mode bindings', () => {
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  const french = JSON.parse(fs.readFileSync(path.join(localeDir, 'french.json'), 'utf8'));

  for (const locale of [english, french]) {
    const helpText =
      locale.settings.help.controller.join(' ') +
      ' ' +
      locale.settings.help.overlay.join(' ') +
      ' ' +
      locale.overlay.controllerHint;
    assert.doesNotMatch(helpText, /RB\+Y|window move\/resize|Contrôle de la fenêtre/, 'removed window mode must not be documented');
  }

  assert.match(english.settings.help.controller[0], /Back \+ Start/);
  assert.match(french.settings.help.controller[0], /Select \+ Start/);
  assert.match(french.overlay.controllerHint, /Select \+ Start/);
});
