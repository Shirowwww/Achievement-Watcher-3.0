'use strict';

function normalizeNotificationVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(200, number)) : 100;
}

function notificationVolumePercent(options) {
  return normalizeNotificationVolume(options && options.overlay && options.overlay.notificationVolume);
}

function mediaPlayerVolume(value) {
  return Math.min(1, normalizeNotificationVolume(value) / 100);
}

module.exports = { normalizeNotificationVolume, notificationVolumePercent, mediaPlayerVolume };
