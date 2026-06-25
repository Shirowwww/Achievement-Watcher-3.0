'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHotkey } = require('../util/globalHotkey.js');

test('parseHotkey converts the default overlay shortcut', () => {
  assert.deepEqual(parseHotkey('Ctrl+Shift+O'), { modifiers: 0x4000 | 0x0002 | 0x0004, keyCode: 0x4f });
});

test('parseHotkey supports Windows, function and navigation keys', () => {
  assert.deepEqual(parseHotkey('Win + F12'), { modifiers: 0x4000 | 0x0008, keyCode: 0x7b });
  assert.deepEqual(parseHotkey('Alt + ArrowUp'), { modifiers: 0x4000 | 0x0001, keyCode: 0x26 });
});

test('parseHotkey rejects missing or multiple primary keys', () => {
  assert.throws(() => parseHotkey('Ctrl+Shift'), /no non-modifier key/);
  assert.throws(() => parseHotkey('Ctrl+A+B'), /exactly one non-modifier key/);
});
