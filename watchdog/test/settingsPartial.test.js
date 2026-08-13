'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../settings.js');
const ini = require('../util/ini.js');
const fsAsync = require('../util/fsAsync.js');

test('a partial options.ini is completed without replacing valid or unknown sections', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-partial-settings-'));
  const file = path.join(dir, 'options.ini');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const originalWriteFile = fsAsync.writeFile;
  let writeCount = 0;
  fsAsync.writeFile = async (...args) => {
    writeCount += 1;
    return originalWriteFile(...args);
  };
  t.after(() => {
    fsAsync.writeFile = originalWriteFile;
  });

  fs.writeFileSync(
    file,
    [
      '[achievement]',
      'lang = french',
      'showHidden = true',
      'mergeDuplicate = false',
      '',
      '[notification]',
      'notify = false',
      '',
      '[notification_transport]',
      'mode = both',
      'winRT = false',
      '',
      '[custom_extension]',
      'keep = untouched',
    ].join('\n'),
    'utf8'
  );

  const loaded = await settings.load(file);

  assert.equal(loaded.achievement.lang, 'french');
  assert.equal(loaded.achievement.showHidden, true);
  assert.equal(loaded.achievement.mergeDuplicate, false);
  assert.equal(loaded.notification.notify, false);
  assert.equal(loaded.notification_transport.mode, 'both');
  assert.equal(loaded.notification_transport.winRT, false);
  assert.equal(loaded.action.target, '', 'missing required sections receive only their defaults');
  assert.equal(loaded.controller.enabled, false);
  assert.equal(loaded.custom_extension.keep, 'untouched');
  assert.equal(loaded.general.onboardingCompleted, true, 'a readable legacy config is an upgrade, not a fresh install');
  assert.equal(loaded.notification.playtime, false, 'legacy profiles do not silently opt into playtime');

  const persisted = ini.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.achievement.lang, 'french');
  assert.equal(persisted.notification.notify, false);
  assert.equal(persisted.notification_transport.mode, 'both');
  assert.equal(persisted.custom_extension.keep, 'untouched', 'unknown sections survive the repair write');

  const writesAfterRepair = writeCount;
  await settings.load(file);
  assert.equal(writeCount, writesAfterRepair, 'an omitted optional Steam section does not cause a reload-write loop');
});

test('malformed required sections are repaired individually without dropping extensions', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-malformed-settings-'));
  const file = path.join(dir, 'options.ini');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(
    file,
    [
      'overlay = malformed',
      'notification_transport[] = malformed',
      '',
      '[achievement]',
      'lang = english',
      '',
      '[custom_extension]',
      'keep = untouched',
    ].join('\n'),
    'utf8'
  );

  const loaded = await settings.load(file);
  const persisted = ini.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(loaded.overlay.hotkey, 'Ctrl+Shift+K');
  assert.equal(loaded.notification_transport.mode, 'overlay');
  assert.equal(loaded.custom_extension.keep, 'untouched');
  assert.equal(Array.isArray(persisted.notification_transport), false);
  assert.equal(persisted.custom_extension.keep, 'untouched');
});

test('the removed Steam API key is erased during settings migration', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-keyless-settings-'));
  const file = path.join(dir, 'options.ini');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(file, '[achievement]\nlang = english\n\n[steam]\nmain = 0\napiKey = legacy-secret\n', 'utf8');
  const loaded = await settings.load(file);
  const persisted = ini.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(Object.hasOwn(loaded.steam, 'apiKey'), false);
  assert.equal(Object.hasOwn(persisted.steam, 'apiKey'), false);
  assert.equal(persisted.steam.main, '0');
});
