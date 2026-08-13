'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const localeDir = path.join(__dirname, '..', '..', 'app', 'locale', 'lang');

function leafPaths(value, prefix = '', output = []) {
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) leafPaths(child, current, output);
    else output.push(current);
  }
  return output;
}

function valueAt(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current && current[key], value);
}

function stringLeaves(value, prefix = '', output = []) {
  if (typeof value === 'string') {
    output.push([prefix, value]);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => stringLeaves(child, `${prefix}[${index}]`, output));
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      stringLeaves(child, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

test('all bundled locales have the complete English key set', () => {
  const files = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json')).sort();
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  const expected = leafPaths(english).sort();
  const newLabels = [
    'achievementSearchPlaceholder',
    'settings.general.theme.name',
    'settings.general.theme.description',
    'settings.general.controller.escape.name',
    'settings.general.controller.escape.description',
    'settings.notification.test.rare',
    'settings.notification.option.overlayPresetRare',
    'settings.notification.option.overlayPresetPlatinum',
    'settings.advanced.blacklistEmpty',
    'settings.advanced.blacklistRestore',
    'onboarding.invalidFolder',
    'settings.general.theme.customTitle',
    'settings.general.theme.resetAll',
    'settings.emulator.loginPlaceholder',
    'settings.advanced.checkUpdates',
    'settings.notification.option.customiser.previewTitle',
    'settings.search.clear',
    'overlay.settingsUseTheme',
    'overlay.clear',
    'overlay.close',
    'overlay.closeOverlay',
    'dialogs.setupLooksValid',
    'dialogs.failedToSetAvatar',
    'watchdog.achievementUnlocked',
    'watchdog.rare',
  ];

  assert.strictEqual(files.length, 18);
  for (const file of files) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    assert.deepStrictEqual(leafPaths(locale).sort(), expected, `${file} must match the English locale keys`);
    for (const key of expected) {
      const value = valueAt(locale, key);
      assert.notStrictEqual(value, undefined, `${file}: ${key} must be defined`);
      if (typeof value === 'string') assert.ok(value.trim(), `${file}: ${key} must be translated`);
    }
    for (const label of newLabels) {
      assert.ok(String(valueAt(locale, label) || '').trim(), `${file}: ${label} must be translated`);
    }
  }
});

test('the Help panel is translated instead of silently copying English prose', () => {
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  const reference = new Map(stringLeaves(english.settings.help));
  const files = fs.readdirSync(localeDir)
    .filter((file) => file.endsWith('.json') && file !== 'english.json')
    .sort();

  for (const file of files) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    const copied = stringLeaves(locale.settings.help)
      .filter(([key, value]) => reference.get(key) === value)
      .map(([key]) => key);
    assert.deepStrictEqual(copied, [], `${file}: Help text copied verbatim from English at ${copied.join(', ')}`);
  }
});

test('every template.* path referenced by the locale loader exists in the locale files', () => {
  const loaderSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'locale', 'loader.js'), 'utf8');
  const refs = new Set();
  const re = /\btemplate\.([A-Za-z0-9_.]+)/g;
  let match;
  while ((match = re.exec(loaderSrc))) refs.add(match[1]);
  assert.ok(refs.size > 50, 'the loader must reference a meaningful set of template paths');
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  for (const ref of refs) {
    assert.notStrictEqual(valueAt(english, ref), undefined, `template.${ref} must exist in english.json`);
  }
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const ref of refs) {
      const value = valueAt(locale, ref);
      assert.notStrictEqual(value, undefined, `${file}: template.${ref} must exist`);
      if (typeof value === 'string') assert.ok(value.trim(), `${file}: template.${ref} must be translated`);
    }
  }
});

test('locale-backed menu and status labels have no embedded English fallbacks', () => {
  const sources = [
    path.join(__dirname, '..', '..', 'app', 'app.js'),
    path.join(__dirname, '..', '..', 'app', 'ui', 'game.js'),
    path.join(__dirname, '..', '..', 'app', 'ui', 'settings.js'),
  ].map((file) => fs.readFileSync(file, 'utf8'));

  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /attr\(['"]data-(?:ctx|lang|configured|fallback|running|done|empty|restore|err|ok|fail)[^'"\r\n]*['"]\)\s*\|\|\s*(?:['"`])[^'"`\r\n]+(?:['"`])/,
      'a localized data attribute must not fall back to a hard-coded label'
    );
  }
});

test('native menus and dialogs do not bypass the locale layer', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');
  const loaderSource = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'locale', 'loader.js'), 'utf8');

  assert.doesNotMatch(appSource, /buttons:\s*\[\s*['"]/, 'native dialog buttons must resolve through t()');
  assert.doesNotMatch(mainSource, /label:\s*['"]Reload['"]/, 'standard debug menu actions must use a localized Electron role');
  assert.doesNotMatch(mainSource, /showErrorBox\(\s*['"]/, 'startup errors must resolve through t()');
  assert.doesNotMatch(loaderSource, /nav-group-help[^\r\n]*\|\|\s*['"]Help['"]/, 'Help navigation must use its locale value');
});

test('every t() key used in the app resolves under dialogs in every bundled locale', () => {
  function walk(dir, out = []) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(js|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const appDir = path.join(__dirname, '..', '..', 'app');
  const keys = new Set();
  const re = /\bt\(\s*['"]([^'"]+)['"]/g;
  for (const file of walk(appDir)) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = re.exec(source))) keys.add(match[1]);
  }
  assert.ok(keys.size > 100, 'the app must use a meaningful set of t() keys');

  const files = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    const dialogs = locale.dialogs || {};
    for (const key of keys) {
      assert.ok(String(dialogs[key] || '').trim(), `${file}: dialogs.${key} must be translated`);
    }
  }
});
