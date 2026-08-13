'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const labels = require('../../app/util/controllerLabels.js');

test('normalizes the controller layout to the supported set', () => {
  assert.equal(labels.normalizeControllerLayout('xbox'), 'xbox');
  assert.equal(labels.normalizeControllerLayout('playstation'), 'playstation');
  assert.equal(labels.normalizeControllerLayout('switch'), 'switch');
  assert.equal(labels.normalizeControllerLayout(''), 'auto');
  assert.equal(labels.normalizeControllerLayout('dreamcast'), 'auto');
});

test('maps canonical buttons to the selected platform vocabulary', () => {
  assert.equal(labels.buttonLabel('xbox', 'LEFT_SHOULDER'), 'LB');
  assert.equal(labels.buttonLabel('playstation', 'LEFT_SHOULDER'), 'L1');
  assert.equal(labels.buttonLabel('switch', 'LEFT_SHOULDER'), 'L');
  assert.equal(labels.buttonLabel('playstation', 'A'), 'Cross');
  assert.equal(labels.buttonLabel('switch', 'A'), 'B');
  assert.equal(labels.buttonLabel('xbox', 'BACK'), 'Back');
  assert.equal(labels.buttonLabel('playstation', 'BACK'), 'Share');
  assert.equal(labels.buttonLabel('switch', 'START'), '+');
});

test('localizes button names when a locale is provided', () => {
  assert.equal(labels.buttonLabel('playstation', 'X', [], 'french'), 'Carré');
  assert.equal(labels.buttonLabel('playstation', 'BACK', [], 'fr'), 'Share');
  assert.equal(labels.buttonLabel('playstation', 'Y', [], 'german'), 'Dreieck');
  assert.equal(labels.bindingLabel('playstation', 'BACK+X', [], 'french'), 'Share + Carré');
  assert.equal(labels.buttonLabel('xbox', 'DPAD_UP', [], 'french'), 'Haut');
  assert.equal(labels.buttonLabel('playstation', 'DPAD_DOWN', [], 'german'), 'Unten');
  assert.equal(labels.bindingLabel('playstation', 'DPAD_UP+DPAD_RIGHT', [], 'french'), 'Haut + Droite');
  assert.equal(labels.buttonLabel('playstation', 'X', [], 'english'), 'Square');
});

test('formats a binding with the platform names', () => {
  assert.equal(labels.bindingLabel('xbox', 'LEFT_SHOULDER+X'), 'LB + X');
  assert.equal(labels.bindingLabel('playstation', 'LEFT_SHOULDER+X'), 'L1 + Square');
  assert.equal(labels.bindingLabel('switch', 'BACK+START'), '− + +');
  assert.equal(labels.bindingLabel('xbox', 'LEFT_SHOULDER+X+LEFT_THUMB'), 'LB + X + L3');
});

test('auto layout follows an identifiable connected gamepad', () => {
  const fakeGamepad = (id) => [{ id }];
  assert.equal(labels.resolveControllerLayout('auto', fakeGamepad('DualSense Wireless Controller')), 'playstation');
  assert.equal(labels.resolveControllerLayout('auto', fakeGamepad('Pro Controller')), 'switch');
  assert.equal(labels.resolveControllerLayout('auto', fakeGamepad('Xbox 360 Controller')), 'xbox');
  assert.equal(labels.resolveControllerLayout('auto', []), 'xbox');
});

test('Share + Square (BACK + X) is recognised by the standard Gamepad API mapping', () => {
  const makeGamepad = () => ({
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  });
  const gamepad = makeGamepad();
  gamepad.buttons[8].pressed = true; // BACK / Share
  gamepad.buttons[2].pressed = true; // X / Square
  assert.equal(labels.comboPressed(gamepad, ['BACK', 'X']), true);
  assert.equal(labels.comboPressed(gamepad, ['Y', 'X']), false, 'both bound buttons must be pressed');
  gamepad.buttons[2].pressed = false;
  assert.equal(labels.comboPressed(gamepad, ['BACK', 'X']), false);
});

test('normalizes bindings and drops invalid values', () => {
  assert.deepEqual(labels.normalizeControllerBinding('LEFT_SHOULDER+X'), ['LEFT_SHOULDER', 'X']);
  assert.deepEqual(labels.normalizeControllerBinding('A+B+X'), ['A', 'B', 'X']);
  assert.deepEqual(
    labels.normalizeControllerBinding('Y+DPAD_UP+LEFT_SHOULDER', { allowedButtons: labels.MODE_ALLOWED }),
    ['Y', 'DPAD_UP', 'LEFT_SHOULDER']
  );
  assert.deepEqual(labels.normalizeControllerBinding('A+A+ZZZ'), ['A']);
  assert.equal(labels.normalizeControllerBinding('ZZZ', { allowSingle: true }), null);
  assert.equal(labels.normalizeControllerBinding('A+B+X+Y', { allowSingle: true }), null);
});
