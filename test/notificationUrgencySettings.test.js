'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const settings = require('../app/settings.js');
const ini = require('../app/util/ini.js');

test('priority notifications default off and persist as a toast setting', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-urgent-settings-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  settings.setUserDataPath(userData);
  // A fresh profile intentionally falls through settings.load()'s default-materialization path.
  // That path logs the missing file for the desktop app, but it is expected in this isolated test.
  const log = console.log;
  let config;
  try {
    console.log = () => {};
    config = settings.load();
  } finally {
    console.log = log;
  }
  assert.equal(config.notification_toast.urgent, false, 'priority notifications must remain opt-in');

  config.notification_toast.urgent = true;
  await settings.save(config);

  const saved = ini.parse(fs.readFileSync(path.join(userData, 'cfg', 'options.ini'), 'utf8'));
  assert.equal(saved.notification_toast.urgent, true);
  assert.equal(saved.notification.urgent, undefined, 'the control must not leak into the common notification section');
});

test('the priority control is the last common notification row and has a locale binding', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'view', 'app.html'), 'utf8');
  const list = html.match(/<ul id="options-notify-common">([\s\S]*?)<\/ul>/);
  assert.ok(list, 'common notification list must exist');

  const rows = [...list[1].matchAll(/<li\b[\s\S]*?<\/li>/g)];
  assert.equal(rows.length, 7, 'priority must be appended without shifting existing positional rows');
  assert.match(rows[6][0], /id="option_urgent"/);
  assert.match(rows[6][0], /fa-exclamation-circle/);
  assert.match(rows[6][0], /<option value="false" selected><\/option>/);
  assert.match(rows[6][0], /<option value="true"><\/option>/);

  const loader = fs.readFileSync(path.join(__dirname, '..', 'app', 'locale', 'loader.js'), 'utf8');
  assert.match(loader, /li:nth-child\(7\)[\s\S]*template\.settings\.notification\.option\.urgent\.name/);
  assert.match(loader, /li:nth-child\(7\)[\s\S]*template\.settings\.notification\.option\.urgent\.description/);
});
