'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeNotificationVolume,
  notificationVolumePercent,
  mediaPlayerVolume,
} = require('../util/notificationVolume.js');

test('notification volume keeps 0-200 percent values and clamps invalid ranges', () => {
  assert.equal(normalizeNotificationVolume(0), 0);
  assert.equal(normalizeNotificationVolume('125'), 125);
  assert.equal(normalizeNotificationVolume(-20), 0);
  assert.equal(normalizeNotificationVolume(250), 200);
  assert.equal(normalizeNotificationVolume('invalid'), 100);
});

test('notification volume reads options without turning mute into 100 percent', () => {
  assert.equal(notificationVolumePercent({ overlay: { notificationVolume: 0 } }), 0);
  assert.equal(notificationVolumePercent({ overlay: { notificationVolume: 175 } }), 175);
  assert.equal(notificationVolumePercent({}), 100);
});

test('PowerShell MediaPlayer volume caps boosts at 100 percent', () => {
  assert.equal(mediaPlayerVolume(0), 0);
  assert.equal(mediaPlayerVolume(75), 0.75);
  assert.equal(mediaPlayerVolume(200), 1);
});
