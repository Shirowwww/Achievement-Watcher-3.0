'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xboxPc = require('../xboxPc.js');

test('normalize helpers accept decimal and hex ids', () => {
  assert.equal(xboxPc.normalizeTitleId('2476'), '2476');
  assert.equal(xboxPc.normalizeTitleId('0x9AC'), '2476');
  assert.equal(xboxPc.normalizeXuid('1234567890123456'), '1234567890123456');
  assert.equal(xboxPc.normalizeXuid('nope'), '');
});

test('buildSnapshot maps achievements to {id: state}', () => {
  const snapshot = xboxPc.buildSnapshot([
    { id: 'a', progression: { state: 'Achieved', timeUnlocked: 1700000000 } },
    { id: 'b', progression: { state: 'NotStarted' }, rarity: { currentPercentage: 4.2 } },
  ]);
  assert.deepEqual(snapshot.a, { earned: true, earned_time: 1700000000 });
  assert.deepEqual(snapshot.b, { earned: false });
});

test('diffSnapshots reports only new unlocks and change flags', () => {
  const prev = { a: { earned: true, earned_time: 1 }, b: { earned: false } };
  const next = { a: { earned: true, earned_time: 1 }, b: { earned: true, earned_time: 2 }, c: { earned: true, earned_time: 3 } };
  const diff = xboxPc.diffSnapshots(prev, next);
  assert.deepEqual(diff.newUnlocked.sort(), ['b', 'c']);
  assert.equal(diff.changed, true);
  assert.deepEqual(xboxPc.diffSnapshots(prev, prev).newUnlocked, []);
  assert.equal(xboxPc.diffSnapshots(prev, prev).changed, false);
});

test('auth file round-trips through the shared AES cipher', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-xauth-'));
  const auth = { xuid: '123', uhs: 'u', xstsToken: 't', clientId: 'c', refreshToken: 'r' };
  const original = process.env['APPDATA'];
  process.env['APPDATA'] = dir;
  try {
    xboxPc.saveAuth(auth);
    const loaded = xboxPc.loadAuth();
    assert.equal(loaded.xuid, '123');
    assert.equal(loaded.xstsToken, 't');
  } finally {
    if (original === undefined) delete process.env['APPDATA'];
    else process.env['APPDATA'] = original;
  }
});

test('state cache read/write round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-xstate-'));
  const original = process.env['APPDATA'];
  process.env['APPDATA'] = dir;
  try {
    xboxPc.writeState('2476', { a: { earned: true } });
    assert.deepEqual(xboxPc.readState('2476'), { a: { earned: true } });
    assert.deepEqual(xboxPc.readState('missing'), {});
  } finally {
    if (original === undefined) delete process.env['APPDATA'];
    else process.env['APPDATA'] = original;
  }
});
