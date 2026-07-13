'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// Pure binding logic of the ported native-controller input manager (no koffi/hardware needed).
const {
  normalizeControllerBinding,
  matchesControllerBinding,
  normalizeControllerButtonName,
  normalizeBackendPreference,
  XINPUT_BUTTONS,
  DEFAULT_OVERLAY_CONTROLLER_TOGGLE_BINDING,
} = require('../watchdog/console/controller/controller-input-manager.js');

test('normalizeControllerButtonName accepts known names case-insensitively and rejects junk', () => {
  assert.equal(normalizeControllerButtonName('start'), 'START');
  assert.equal(normalizeControllerButtonName(' Back '), 'BACK');
  assert.equal(normalizeControllerButtonName('GUIDE'), 'GUIDE');
  assert.equal(normalizeControllerButtonName('NOPE'), null);
});

test('normalizeControllerBinding parses "BACK+START" into a canonical, order-normalized array', () => {
  assert.deepEqual(normalizeControllerBinding('START+BACK'), ['BACK', 'START']);
  assert.deepEqual(normalizeControllerBinding(['LEFT_SHOULDER', 'RIGHT_SHOULDER']), ['LEFT_SHOULDER', 'RIGHT_SHOULDER']);
});

test('normalizeControllerBinding de-duplicates and drops unknown buttons', () => {
  assert.deepEqual(normalizeControllerBinding('A+A+ZZZ'), ['A']);
});

test('normalizeControllerBinding falls back to the default when the value is unusable', () => {
  assert.deepEqual(
    normalizeControllerBinding('ZZZ', { defaultBinding: DEFAULT_OVERLAY_CONTROLLER_TOGGLE_BINDING }),
    ['BACK', 'START']
  );
});

test('matchesControllerBinding is true only when every bound button is pressed', () => {
  const both = XINPUT_BUTTONS.BACK | XINPUT_BUTTONS.START;
  assert.equal(matchesControllerBinding({ buttons: both }, ['BACK', 'START']), true);
  assert.equal(matchesControllerBinding({ buttons: XINPUT_BUTTONS.BACK }, ['BACK', 'START']), false);
  assert.equal(matchesControllerBinding({ buttons: XINPUT_BUTTONS.A }, ['A']), true);
});

test('matchesControllerBinding reads the GUIDE (system) button from systemButtons', () => {
  assert.equal(matchesControllerBinding({ buttons: 0, systemButtons: 0x1 }, ['GUIDE']), true);
  assert.equal(matchesControllerBinding({ buttons: 0, systemButtons: 0 }, ['GUIDE']), false);
});

test('normalizeBackendPreference clamps to the known set', () => {
  assert.equal(normalizeBackendPreference('XInput'), 'xinput');
  assert.equal(normalizeBackendPreference('gameinput'), 'gameinput');
  assert.equal(normalizeBackendPreference('whatever'), 'auto');
  assert.equal(normalizeBackendPreference(''), 'auto');
});
