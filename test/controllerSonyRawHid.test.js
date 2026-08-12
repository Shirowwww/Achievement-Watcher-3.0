'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  isSonyRawHidSnapshot,
  mergeSonyRawHidStandardState,
  XINPUT_BUTTONS,
} = require('../watchdog/console/controller/controller-input-manager.js');

test('isSonyRawHidSnapshot identifies a DualShock/DualSense by profile id or Sony vendor id', () => {
  assert.equal(isSonyRawHidSnapshot({ profileId: 'sony-ds4' }), true);
  assert.equal(isSonyRawHidSnapshot({ profileId: 'sony-dualsense' }), true);
  assert.equal(isSonyRawHidSnapshot({ family: 'SONY-DS4' }), true, 'case-insensitive');
  assert.equal(isSonyRawHidSnapshot({ vid: 0x054c }), true, 'Sony USB vendor id');
  assert.equal(isSonyRawHidSnapshot({ vid: '0x054c' }), true, 'vendor id as a string');
  assert.equal(isSonyRawHidSnapshot({ profileId: 'switch-pro' }), false);
  assert.equal(isSonyRawHidSnapshot({ vid: 0x057e }), false, 'Nintendo vendor id');
  assert.equal(isSonyRawHidSnapshot(null), false);
  assert.equal(isSonyRawHidSnapshot(undefined), false);
});

test('mergeSonyRawHidStandardState ORs buttons/systemButtons and keeps the larger packet number', () => {
  const base = {
    packetNumber: 5,
    buttons: XINPUT_BUTTONS.A,
    systemButtons: 0,
    leftTrigger: 0,
    rightTrigger: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'xinput:0',
  };
  const rawHid = {
    packetNumber: 9,
    buttons: XINPUT_BUTTONS.B,
    systemButtons: 0x1,
    leftTrigger: 0,
    rightTrigger: 0,
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'rawhid:vid=054c',
  };
  const merged = mergeSonyRawHidStandardState(base, rawHid, { profileId: 'sony-ds4' });
  assert.equal(merged.packetNumber, 9);
  assert.equal(merged.buttons, (XINPUT_BUTTONS.A | XINPUT_BUTTONS.B) >>> 0);
  assert.equal(merged.systemButtons, 0x1);
  assert.equal(merged.deviceKey, 'xinput:0', 'base device key wins when present');
});

test('mergeSonyRawHidStandardState prefers the raw-HID stick when the base reading has drifted to near-zero', () => {
  // This is the DS4-specific correction: XInput/GameInput sometimes reports a resting/near-zero
  // stick for a DS4 while the raw HID report shows real deflection — prefer the raw HID reading.
  const base = {
    leftStickX: 0.02,
    leftStickY: -0.01,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'xinput:0',
  };
  const rawHid = {
    leftStickX: 0.6,
    leftStickY: 0.4,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'rawhid:vid=054c',
  };
  const merged = mergeSonyRawHidStandardState(base, rawHid, { profileId: 'sony-ds4' });
  assert.equal(merged.leftStickX, 0.6);
  assert.equal(merged.leftStickY, 0.4);
});

test('mergeSonyRawHidStandardState does not apply the DS4 stick-preference bias for a non-DS4 profile', () => {
  // preferSonyDs4Raw only activates for profileId === 'sony-ds4' (chooseStickPair's default path
  // just prefers whichever reading is non-trivial), so a DualSense (or unspecified) profile keeps
  // the base backend's stick reading here since it is already above the analog-fallback threshold.
  const base = {
    leftStickX: 0.5,
    leftStickY: 0.5,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'xinput:0',
  };
  const rawHid = {
    leftStickX: 0.9,
    leftStickY: 0.9,
    rightStickX: 0,
    rightStickY: 0,
    deviceKey: 'rawhid:vid=054c',
  };
  const merged = mergeSonyRawHidStandardState(base, rawHid, { profileId: 'sony-dualsense' });
  assert.equal(merged.leftStickX, 0.5);
  assert.equal(merged.leftStickY, 0.5);
});

test('mergeSonyRawHidStandardState returns the other state unchanged when one side is missing', () => {
  const base = { buttons: XINPUT_BUTTONS.A, deviceKey: 'xinput:0' };
  assert.equal(mergeSonyRawHidStandardState(base, null), base);
  assert.equal(mergeSonyRawHidStandardState(null, base), base);
  assert.equal(mergeSonyRawHidStandardState(null, null), null);
});
