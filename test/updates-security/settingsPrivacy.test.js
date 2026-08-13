'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ini = require('../../app/util/ini');
const settings = require('../../app/settings');

test('the app drops the removed Steam API key without resetting a config missing [steam]', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-app-settings-privacy-'));
  const file = path.join(directory, 'cfg', 'options.ini');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  settings.setUserDataPath(directory);

  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    settings.load();
  } finally {
    console.log = originalConsoleLog;
  }
  const original = ini.parse(fs.readFileSync(file, 'utf8'));
  original.general.username = 'Keep Me';
  delete original.steam;
  fs.writeFileSync(file, ini.stringify(original), 'utf8');

  const withoutSteam = settings.load();
  assert.equal(withoutSteam.general.username, 'Keep Me');
  assert.deepEqual(withoutSteam.steam, { main: '0' });

  withoutSteam.steam.apiKey = 'legacy-secret';
  fs.writeFileSync(file, ini.stringify(withoutSteam), 'utf8');
  const loaded = settings.load();
  assert.equal(Object.hasOwn(loaded.steam, 'apiKey'), false);

  await settings.save(loaded);
  const persisted = ini.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.hasOwn(persisted.steam, 'apiKey'), false);
});

test('Watchdog port cleanup uses argument-safe process launches', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');
  assert.doesNotMatch(source, /\bexecSync\s*\(/);
  assert.match(source, /execFileSync\s*\(\s*['"]taskkill\.exe['"]\s*,\s*\[['"]\/F['"],\s*['"]\/PID['"],\s*pid\]/);
});
