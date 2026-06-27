'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const startApps = require('../util/startApps.js');

test('isValidAUMID accepts normal UWP app ids', () => {
  assert.equal(startApps.isValidAUMID('Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App'), true);
});

test('isValidAUMID rejects malformed app ids', () => {
  assert.equal(startApps.isValidAUMID('Microsoft.XboxGamingOverlay'), false);
  assert.equal(startApps.isValidAUMID('bad id_with-space!App'), false);
  assert.equal(startApps.isValidAUMID(null), false);
});
