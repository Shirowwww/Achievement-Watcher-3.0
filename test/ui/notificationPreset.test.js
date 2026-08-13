'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sourcePlatform, resolvePreset } = require('../../app/util/notificationPreset.js');

const presets = {
  main: 'Default',
  rare: 'Rare',
  platinum: 'Platinum',
  xenia: 'Xenia',
  rpcs3: 'RPCS3',
  shadps4: 'ShadPS4',
};

test('sourcePlatform recognizes emulator source labels', () => {
  assert.equal(sourcePlatform('RPCS3 Emulator'), 'rpcs3');
  assert.equal(sourcePlatform('ShadPS4 Emulator'), 'shadps4');
  assert.equal(sourcePlatform('Xenia Emulator'), 'xenia');
  assert.equal(sourcePlatform('GBE Fork'), null);
  assert.equal(sourcePlatform(''), null);
});

test('platform preset applies to its source', () => {
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator' }), 'RPCS3');
  assert.equal(resolvePreset({ presets, source: 'Xenia Emulator' }), 'Xenia');
  assert.equal(resolvePreset({ presets, source: 'ShadPS4 Emulator' }), 'ShadPS4');
  assert.equal(resolvePreset({ presets, source: 'Steam (user)' }), 'Default');
});

test('rare and platinum overrides win over the platform preset', () => {
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator', notificationType: 'platinum' }), 'Platinum');
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator', rarityPercent: 5 }), 'Rare');
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator', rarityPercent: 12 }), 'RPCS3');
  assert.equal(resolvePreset({ presets, source: 'Xenia Emulator', rarityPercent: 8, notificationType: 'playtime' }), 'Xenia');
});

test('missing platform override falls back to main', () => {
  assert.equal(resolvePreset({ presets: { main: 'Default' }, source: 'Xenia Emulator' }), 'Default');
  assert.equal(resolvePreset({}), 'Shirow');
});
