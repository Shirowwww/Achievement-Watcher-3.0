'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'app', 'view', 'app.html'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'locale', 'loader.js'), 'utf8');
const settingsUi = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
const localeDir = path.join(root, 'app', 'locale', 'lang');

test('help stays focused instead of duplicating the settings sidebar', () => {
  assert.doesNotMatch(html, /data-help-view=|help-action-/);
  assert.doesNotMatch(loader, /bindHelpAction|help-links-title/);
  assert.doesNotMatch(settingsUi, /\$\('#settings \[data-help-view\]'\)/);
  assert.match(html, /id="help-config-list"/, 'the Generated configs panel must exist');
  assert.match(loader, /bindHelpList\('help-config-list', help\.config\)/);
  assert.match(html, /<script src="\.\.\/ui\/help\.js"/, 'the dynamic help module must be loaded by the settings page');
  assert.match(html, /id="help-search-input"[^>]*aria-controls="help-grid"/, 'help search must name its result region');
  assert.match(html, /id="help-no-results"[^>]*role="status"/, 'empty search results must be announced');
  for (const [id, key] of [
    ['help-setup-title', 'setupTitle'],
    ['help-topics-title', 'topicsTitle'],
    ['help-no-results', 'noResults'],
  ]) {
    assert.match(loader, new RegExp(`bindHelpText\\('${id}', help\\.${key}\\)`));
  }
  assert.match(loader, /help\.searchPlaceholder/);
});

test('every bundled locale supplies the help interface labels', () => {
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const key of ['setupTitle', 'topicsTitle', 'searchPlaceholder', 'noResults']) {
      assert.ok(String(locale.settings?.help?.[key] || '').trim(), `${file}: missing help.${key}`);
    }
  }
});

test('all 11 Help topics are populated, rendered and localized', () => {
  const helpModule = require('../../app/ui/help.js');
  assert.strictEqual(Object.keys(helpModule.HELP_LISTS).length, 11);
  for (const [id, key] of Object.entries(helpModule.HELP_LISTS)) {
    assert.match(html, new RegExp(`id="${id}"`), `${key}: missing DOM list`);
    assert.match(loader, new RegExp(`bindHelpList\\('${id}', help\\.${key}\\)`), `${key}: missing locale binding`);
    for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
      const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
      assert.ok(Array.isArray(locale.settings.help[key]) && locale.settings.help[key].length >= 2, `${file}: incomplete help.${key}`);
    }
  }
});

test('Help facts stay aligned with the current implementation', () => {
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  const settingsDefaults = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8');
  const mainProcess = fs.readFileSync(path.join(root, 'app', 'electron', 'init.js'), 'utf8');
  const steamParser = fs.readFileSync(path.join(root, 'app', 'parser', 'steam.js'), 'utf8');
  const userThemes = fs.readFileSync(path.join(root, 'app', 'util', 'userThemes.js'), 'utf8');

  assert.match(settingsDefaults, /BACK\+START\+LEFT_SHOULDER/);
  assert.match(settingsDefaults, /LEFT_SHOULDER\+X/);
  assert.match(settingsDefaults, /LEFT_SHOULDER\+RIGHT_SHOULDER/);
  assert.match(mainProcess, /CommandOrControl\+Alt\+Shift\+Up/);
  assert.match(mainProcess, /CommandOrControl\+Alt\+Shift\+5/);
  assert.match(mainProcess, /CommandOrControl\+Alt\+Shift\+C/);
  assert.match(steamParser, /DESC_RECHECK_MS = 3 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(userThemes, /path\.join\(String\(userDataPath \|\| ''\), 'themes'\)/);

  assert.match(english.settings.help.controller.join(' '), /Back \+ Start \+ LB[\s\S]*LB \+ X[\s\S]*LB \+ RB/);
  assert.match(english.settings.help.shortcuts.join(' '), /Ctrl\+Alt\+Shift\+Arrows[\s\S]*Ctrl\+Alt\+Shift\+1–5[\s\S]*Ctrl\+Alt\+Shift\+C/);
  assert.match(english.settings.help.tips.join(' '), /within 3 days/);
  assert.match(english.settings.help.themes.join(' '), /<userData>\\themes/);
  assert.doesNotMatch(JSON.stringify(english.settings.help), /ColdClient|Launch\.bat|launch helpers/i);
  assert.doesNotMatch(html, /option_mode|option_createLaunchBat/);
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
  assert.match(english.settings.help.controller[0], /Back \+ Start \+ LB/);
  assert.match(french.settings.help.controller[0], /Select \+ Start \+ LB/);
});
