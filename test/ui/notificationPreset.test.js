'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sourcePlatform, resolvePreset, legacyPresetAlias, DEFAULT_PRESET } = require('../../app/util/notificationPreset.js');

const presets = {
  main: 'Default',
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

/*
  There is no per-type preset any more: a rare unlock and a 100% completion are states the chosen
  preset paints itself, so the platform preset must win for every kind of notification.
*/
test('the platform preset applies whatever kind of notification it is', () => {
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator', notificationType: 'platinum' }), 'RPCS3');
  assert.equal(resolvePreset({ presets, source: 'RPCS3 Emulator', rarityPercent: 5 }), 'RPCS3');
  assert.equal(resolvePreset({ presets, source: 'Xenia Emulator', rarityPercent: 8, notificationType: 'playtime' }), 'Xenia');
});

test('missing platform override falls back to main', () => {
  assert.equal(resolvePreset({ presets: { main: 'Default' }, source: 'Xenia Emulator' }), 'Default');
  assert.equal(resolvePreset({}), DEFAULT_PRESET);
});

/*
  Every bundled preset that was removed in the redesign has to name the one that replaced it, and
  that replacement has to be a preset that actually ships - otherwise a config carrying the old name
  resolves to nothing and the user silently lands on the default instead of the look they picked.
*/
test('every removed bundled preset maps to one that ships', () => {
  const fs = require('fs');
  const path = require('path');
  const presets = path.join(__dirname, '..', '..', 'app', 'presets');
  // Both libraries: a renamed community preset resolves exactly like a renamed default one.
  const bundled = new Set([...fs.readdirSync(path.join(presets, 'Default Presets')), ...fs.readdirSync(path.join(presets, 'Users Presets'))]);
  const { LEGACY_PRESET_ALIASES } = require('../../app/util/notificationPreset.js');

  assert.ok(bundled.has(DEFAULT_PRESET), `the default preset "${DEFAULT_PRESET}" must be bundled`);
  for (const [removed, replacement] of Object.entries(LEGACY_PRESET_ALIASES)) {
    assert.ok(bundled.has(replacement), `"${removed}" maps to "${replacement}", which is not bundled`);
    assert.ok(!bundled.has(removed), `"${removed}" is listed as removed but still ships`);
  }
});

/*
  A preset named after a platform keeps that name. Renaming Steam to something clever makes the one
  preset a user goes looking for by name unfindable, so these are pinned.
*/
test('platform presets keep the platform name', () => {
  const fs = require('fs');
  const path = require('path');
  const bundled = new Set(fs.readdirSync(path.join(__dirname, '..', '..', 'app', 'presets', 'Default Presets')));
  for (const name of ['Steam', 'Epic Games', 'PlayStation', 'Xbox']) {
    assert.ok(bundled.has(name), `the "${name}" preset must ship under that name`);
  }
});

test('legacyPresetAlias only answers for names that were removed', () => {
  assert.equal(legacyPresetAlias('Shirow'), DEFAULT_PRESET);
  assert.equal(legacyPresetAlias('Xbox 360'), 'Xbox');
  assert.equal(legacyPresetAlias('PS5 enhanced'), 'PlayStation');
  assert.equal(legacyPresetAlias('mudoss'), 'Outline');
  assert.equal(legacyPresetAlias(DEFAULT_PRESET), '');
  assert.equal(legacyPresetAlias('something a user made'), '');
  assert.equal(legacyPresetAlias(''), '');
  assert.equal(legacyPresetAlias(null), '');
  // Inherited Object members must not read as aliases.
  assert.equal(legacyPresetAlias('constructor'), '');
  assert.equal(legacyPresetAlias('toString'), '');
});
