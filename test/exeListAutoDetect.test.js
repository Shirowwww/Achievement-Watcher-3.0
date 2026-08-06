'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-exelist-'));
fs.mkdirSync(path.join(userData, 'cfg'), { recursive: true });

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron' || request === '@electron/remote') {
    return { app: { getPath: () => userData } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const exeList = require('../app/parser/exeList.js');

function writeBytes(file, size = 128) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

function tmpGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-list-${name}-`));
}

test('reconcile pre-fills confident installs and creates empty entries for ambiguous ones', async () => {
  const confidentDir = tmpGame('confident');
  writeBytes(path.join(confidentDir, 'OnlyGame.exe'));

  const ambiguousDir = tmpGame('ambiguous');
  writeBytes(path.join(ambiguousDir, 'Foo.exe'));
  writeBytes(path.join(ambiguousDir, 'Bar.exe'));

  const changed = await exeList.reconcile([
    { appid: '1001', name: 'Only Game', gameDir: confidentDir },
    { appid: '1002', name: 'Ambiguous Game', gameDir: ambiguousDir },
  ]);
  assert.ok(changed >= 2);

  const list = await exeList.list();
  const confident = list.find((e) => String(e.appid) === '1001');
  const ambiguous = list.find((e) => String(e.appid) === '1002');
  assert.ok(confident);
  assert.strictEqual(confident.exe, path.join(confidentDir, 'OnlyGame.exe'));
  assert.ok(ambiguous);
  assert.strictEqual(ambiguous.exe, '');
});

test('reconcile trusts a launcher-provided exe even without a gameDir', async () => {
  const exePath = path.join(tmpGame('authoritative'), 'LauncherKnown.exe');
  writeBytes(exePath);

  await exeList.reconcile([
    { appid: '2001', name: 'Epic Game', exe: exePath, exeConfident: true },
  ]);

  const list = await exeList.list();
  const entry = list.find((e) => String(e.appid) === '2001');
  assert.ok(entry);
  assert.strictEqual(entry.exe, exePath);
});

test('reconcile never overwrites a manually configured exe', async () => {
  const manualExe = path.join(tmpGame('manual'), 'ManualChoice.exe');
  writeBytes(manualExe);
  await exeList.add({ appid: '3001', exe: manualExe, args: '-windowed' });

  const detectedDir = tmpGame('detected');
  writeBytes(path.join(detectedDir, 'AutoDetected.exe'));

  await exeList.reconcile([
    { appid: '3001', name: 'Manual Game', gameDir: detectedDir },
  ]);

  const list = await exeList.list();
  const entry = list.find((e) => String(e.appid) === '3001');
  assert.ok(entry);
  assert.strictEqual(entry.exe, manualExe);
  assert.strictEqual(entry.args, '-windowed');
});
