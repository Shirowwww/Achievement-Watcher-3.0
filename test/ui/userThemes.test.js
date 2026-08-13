'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const userThemes = require('../../app/util/userThemes.js');

test('lists only .css themes from the user themes folder, sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-themes-'));
  fs.mkdirSync(path.join(dir, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'themes', 'zelda.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'themes', 'aero.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'themes', 'notes.txt'), 'x');
  const list = userThemes.listUserThemes(dir);
  assert.deepEqual(list.map((t) => t.name), ['aero', 'zelda']);
  assert.ok(list[0].file.endsWith('aero.css'));
  assert.equal(userThemes.readThemeFile(list[1].file), 'body{}');
});

test('value encoding round-trips and built-ins stay null', () => {
  assert.equal(userThemes.parseValue(userThemes.valueFor('My Theme')), 'My Theme');
  assert.equal(userThemes.parseValue('default'), null);
  assert.equal(userThemes.parseValue('user:'), null); // empty name is invalid, treated as built-in
  assert.equal(userThemes.parseValue('USER:OLED'), 'OLED');
});

test('missing folder returns an empty list and empty css', () => {
  assert.deepEqual(userThemes.listUserThemes(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-empty-'))), []);
  assert.equal(userThemes.readThemeFile('C:/definitely/missing.css'), '');
});
