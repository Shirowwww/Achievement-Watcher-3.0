'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gameindex-'));
const userData = path.join(tmp, 'userData');
fs.mkdirSync(path.join(userData, 'cfg'), { recursive: true });

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@electron/remote') {
    return { app: { getPath: () => userData } };
  }
  return originalLoad.apply(this, arguments);
};

const gameIndex = require('../../app/parser/gameIndex.js');
Module._load = originalLoad;

function readRows() {
  const file = path.join(userData, 'cfg', 'gameIndex.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('a metadata-only seed keeps the executable the generic seed already detected', () => {
  gameIndex.upsert({
    appid: 'uplay-971',
    name: 'Far Cry 4',
    binary: 'FarCry4.exe',
    icon: 'hash',
    source: 'Ubisoft Connect',
  });
  gameIndex.upsert({
    appid: 'uplay-971',
    name: 'Far Cry 4',
    binary: '',
    icon: 'hash',
    source: 'Ubisoft Connect',
    steamappid: '220240',
    uplayId: '971',
  });

  const row = readRows().find((g) => g.appid === 'uplay-971');
  assert.equal(row.binary, 'FarCry4.exe');
  assert.equal(row.steamappid, '220240');
  assert.equal(row.uplayId, '971');
});

test('an unchanged upsert does not rewrite the index file', () => {
  const file = path.join(userData, 'cfg', 'gameIndex.json');
  const before = fs.statSync(file).mtimeNs;
  gameIndex.upsert({
    appid: 'uplay-971',
    name: 'Far Cry 4',
    binary: 'FarCry4.exe',
    icon: 'hash',
    source: 'Ubisoft Connect',
    steamappid: '220240',
    uplayId: '971',
  });
  assert.equal(fs.statSync(file).mtimeNs, before);
});

test('a real binary change still updates the entry', () => {
  gameIndex.upsert({ appid: 'uplay-971', name: 'Far Cry 4', binary: 'FarCry4New.exe' });
  const row = readRows().find((g) => g.appid === 'uplay-971');
  assert.equal(row.binary, 'FarCry4New.exe');
});
