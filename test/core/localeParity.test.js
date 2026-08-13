'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const localeDir = path.join(__dirname, '..', '..', 'app', 'locale', 'lang');

function leafKeys(value, prefix = '', keys = new Set()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leafKeys(child, prefix ? `${prefix}.${key}` : key, keys);
    }
  } else {
    keys.add(prefix);
  }
  return keys;
}

test('every bundled locale has the same translation keys as English', () => {
  const english = leafKeys(JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8')));
  const localeFiles = fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'));

  for (const file of localeFiles) {
    const keys = leafKeys(JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')));
    assert.deepEqual([...keys].sort(), [...english].sort(), `${file} is missing or adds translation keys`);
  }
});
