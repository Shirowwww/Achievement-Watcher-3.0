'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const localeDir = path.join(__dirname, '..', 'app', 'locale', 'lang');

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

test('all bundled locales have the complete English key set', () => {
  const files = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json')).sort();
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  const expected = leafPaths(english).sort();
  const newLabels = [
    'achievementSearchPlaceholder',
    'settings.general.theme.name',
    'settings.general.theme.description',
    'settings.notification.test.rare',
    'settings.notification.option.overlayPresetRare',
    'settings.notification.option.overlayPresetPlatinum',
    'settings.advanced.blacklistEmpty',
    'settings.advanced.blacklistRestore',
    'onboarding.invalidFolder',
  ];

  assert.strictEqual(files.length, 18);
  for (const file of files) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    assert.deepStrictEqual(leafPaths(locale).sort(), expected, `${file} must match the English locale keys`);
    for (const label of newLabels) {
      assert.ok(String(valueAt(locale, label) || '').trim(), `${file}: ${label} must be translated`);
    }
  }
});
