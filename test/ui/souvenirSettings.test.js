'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const appDir = path.join(root, 'app');
const htmlParser = require(path.join(appDir, 'node_modules', 'node-html-parser'));

const html = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
const loader = fs.readFileSync(path.join(appDir, 'locale', 'loader.js'), 'utf8');
const settingsUi = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
const localeDir = path.join(appDir, 'locale', 'lang');

test('the souvenir section offers both picking the folder and opening it', () => {
  const list = htmlParser.parse(html).querySelector('#options-notify-souvenir');
  assert.ok(list, 'the souvenir settings list must exist');

  const picker = list.querySelector('#btn-souvenir-dir');
  const open = list.querySelector('#btn-souvenir-open');
  assert.ok(picker, 'the folder picker must stay: the destination has to remain changeable');
  assert.ok(open, 'a way to open the screenshots folder must exist');

  // Same row, so the path on the picker is right next to the button that opens it.
  assert.equal(picker.parentNode.getAttribute('id'), open.parentNode.getAttribute('id'));
  assert.ok(picker.querySelector('#souvenir-dir-display'), 'the picker must keep showing the current path');
  assert.ok(open.querySelector('#souvenir-open-label'), 'the open button needs a span for its translation');

  // The section stays about where screenshots go - no exposure, tone mapping or colour controls.
  assert.doesNotMatch(list.toString(), /hdr|tone|nits|colou?r space|gamma/i);
});

test('opening the folder is wired up and translated', () => {
  assert.match(loader, /\$\('#souvenir-open-label'\)\.text\(clear\(opt\.souvenirOpenDir\)\)/);
  assert.match(settingsUi, /\$\('#btn-souvenir-open'\)\.click/);
  // The folder only exists once a screenshot has been saved, so the click has to create it first.
  assert.match(settingsUi, /mkdirSync\(dir, \{ recursive: true \}\)[\s\S]{0,120}openPath\(dir\)/);

  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    assert.ok(
      String(locale.settings?.notification?.option?.souvenirOpenDir || '').trim(),
      `${file}: missing settings.notification.option.souvenirOpenDir`
    );
  }
});
