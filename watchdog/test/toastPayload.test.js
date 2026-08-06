'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildToastNotification } = require(path.join(__dirname, '..', 'notification', 'transport', 'toast.js'));
const toastIdentity = require(path.join(__dirname, '..', 'util', 'toastIdentity.js'));

// A toast click can only reach an unpackaged desktop app through a registered URI scheme, which the
// main process passes down in AW_TOAST_PROTOCOL. Set it for the payload tests.
process.env.AW_TOAST_PROTOCOL = 'achievement-watcher';
const notificationTest = require(path.join(__dirname, '..', 'notification-test.js'));
const powertoast = require(path.join(__dirname, '..', 'util', 'powertoast.js'));

function toastOptions(overrides = {}) {
  return {
    transport: { toast: true },
    toast: {
      appid: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      winrt: true,
      customAudio: '1',
      cropIcon: true,
      ...overrides,
    },
  };
}

test('achievement toast payload carries the intended AUMID under the key powertoast reads', () => {
  const { notification } = buildToastNotification(
    {
      appid: 480,
      achievementName: 'ACH_WIN',
      achievementDisplayName: 'Winner',
      achievementDescription: 'Win one game.',
      icon: 'https://example.com/icon.jpg',
      time: 123456,
    },
    toastOptions()
  );

  assert.strictEqual(notification.aumid, 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp');
  assert.ok(!('appID' in notification), 'the legacy appID key must not be sent to powertoast');
  assert.strictEqual(notification.uniqueID, '480:ACH_WIN');
  assert.strictEqual(notification.title, 'Achievement Unlocked');
  assert.strictEqual(notification.message, 'Winner\nWin one game.');
  assert.strictEqual(notification.icon, 'https://example.com/icon.jpg');
  assert.strictEqual(notification.time, 123456);
  assert.ok(!('timeStamp' in notification), 'the unsupported timeStamp key must not be sent to powertoast');
  assert.deepEqual(notification.activation, {
    launch: 'achievement-watcher://game/480/ACH_WIN',
    type: 'protocol',
  });
  assert.ok(!('onClick' in notification), 'the dead onClick option must not be sent to powertoast');
});

test('winrt=false is forwarded as disableWinRT on the payload', () => {
  const { notification } = buildToastNotification(
    { appid: 480, achievementDisplayName: 'X', achievementDescription: '' },
    toastOptions({ winrt: false })
  );
  assert.strictEqual(notification.disableWinRT, true);
});

test('playtime payload prefers the high-res game icon', () => {
  const { notification } = buildToastNotification(
    {
      notificationType: 'playtime',
      appid: 480,
      gameDisplayName: 'Spacewar',
      achievementDisplayName: 'Spacewar',
      achievementDescription: 'You played for 12m',
      icon: 'https://example.com/tiny.jpg',
      gameIcon: 'https://example.com/library.jpg',
      image: 'https://example.com/header.jpg',
    },
    toastOptions({ imageIntegration: '1' })
  );
  assert.strictEqual(notification.icon, 'https://example.com/library.jpg');
  assert.strictEqual(notification.heroImg, 'https://example.com/header.jpg');
  assert.ok(!('headerImg' in notification), 'the unsupported headerImg key must not be sent to powertoast');
});

test('inline image and progress payload use the keys powertoast actually renders', () => {
  const { notification } = buildToastNotification(
    {
      appid: 480,
      gameDisplayName: 'Spacewar',
      achievementName: 'ACH_PROGRESS',
      achievementDisplayName: 'Far Traveler',
      achievementDescription: 'Keep going',
      icon: 'https://example.com/icon.jpg',
      image: 'https://example.com/header.jpg',
      progress: { current: 3, max: 10 },
    },
    toastOptions({ imageIntegration: '2' })
  );
  assert.strictEqual(notification.inlineImg, 'https://example.com/header.jpg');
  assert.ok(!('footerImg' in notification), 'the unsupported footerImg key must not be sent to powertoast');
  assert.deepEqual(notification.progress, { value: 30, status: '3/10' });
});

test('the payload renders a valid toast XML (hero image, progress, protocol activation)', async () => {
  const { toXmlString } = await import('powertoast');
  const { notification } = buildToastNotification(
    {
      appid: 480,
      gameDisplayName: 'Spacewar',
      achievementName: 'ACH_XML',
      achievementDisplayName: 'XML Check',
      achievementDescription: 'Rendered',
      icon: 'https://example.com/icon.jpg',
      image: 'https://example.com/header.jpg',
      progress: { current: 3, max: 10 },
      time: 123456,
    },
    toastOptions({ imageIntegration: '1' })
  );

  const xml = toXmlString(notification);
  assert.match(xml, /<toast /);
  assert.match(xml, /<image placement="hero"/);
  assert.match(xml, /<progress value="0\.30" status="3\/10"/);
  assert.match(xml, /activationType="protocol"/);
  assert.match(xml, /launch="achievement-watcher:\/\/game\/480\/ACH_XML"/);
  // powertoast inlines `launch` into the XML verbatim, so the URI must contain nothing that breaks
  // an attribute — a raw "&" from a query string would make Windows discard the whole toast.
  assert.ok(!/launch="[^"]*[&<>]/.test(xml), 'the activation URI must be XML-attribute safe');
  assert.match(xml, /displayTimestamp="1970-01-02/);
});

test('applyToastAppSettings honours the user AUMID override and the WinRT flag', async () => {
  const payload = { aumid: toastIdentity.DEFAULT_TOAST_AUMID, title: 'T' };
  const options = {
    notification_transport: { winRT: false },
    notification_advanced: { appID: 'CustomApp_12345678!Custom' },
  };
  await notificationTest.applyToastAppSettings(payload, options);
  assert.strictEqual(payload.aumid, 'CustomApp_12345678!Custom');
  assert.strictEqual(payload.disableWinRT, true);
});

test('no activation is emitted when no URI scheme is registered', () => {
  const previous = process.env.AW_TOAST_PROTOCOL;
  process.env.AW_TOAST_PROTOCOL = '';
  try {
    const { notification } = buildToastNotification(
      { appid: 480, achievementName: 'ACH_WIN', achievementDisplayName: 'W', achievementDescription: '' },
      toastOptions()
    );
    // Better no activation at all than a launch string Windows resolves to nothing.
    assert.ok(!('activation' in notification));
    assert.strictEqual(notification.uniqueID, '480:ACH_WIN');
  } finally {
    process.env.AW_TOAST_PROTOCOL = previous;
  }
});

test('the app own identity is preferred over the dead Xbox default, and is checked for existence', async () => {
  // Windows 11 no longer ships the classic Xbox app the old default named, so an id must never be
  // trusted on format alone (issue #8).
  const candidates = toastIdentity.toastIdentityCandidates(
    { notification_advanced: { appID: '' } },
    { AW_AUMID: 'io.github.shirowwww.achievement.watcher' }
  );
  assert.strictEqual(candidates[0].id, 'io.github.shirowwww.achievement.watcher');
  assert.strictEqual(candidates[candidates.length - 1].id, toastIdentity.DEFAULT_TOAST_AUMID);

  // A desktop (non-packaged) identity cannot load http(s) toast images, so icons must be prefetched.
  assert.strictEqual(toastIdentity.requiresLocalImages('io.github.shirowwww.achievement.watcher'), true);
  assert.strictEqual(toastIdentity.requiresLocalImages(toastIdentity.DEFAULT_TOAST_AUMID), false);
});

test('test buttons build the same payload contract as real toasts', () => {
  const options = {
    achievement: { lang: 'english' },
    notification_transport: { winRT: true },
    notification_toast: { customToastAudio: '1', groupToast: false },
    overlay: { notificationVolume: '100' },
  };

  const [message, toastOptions] = notificationTest.testMessageAndOptions('toast', options);
  assert.strictEqual(message.achievementName, 'TOAST_TEST');
  assert.strictEqual(toastOptions.toast.imageIntegration, '0');
  assert.strictEqual(toastOptions.toast.cropIcon, true);
  assert.strictEqual(toastOptions.toast.attribution, 'Hollow Knight');

  const [, playtimeOptions] = notificationTest.testMessageAndOptions('playtime', options);
  assert.strictEqual(playtimeOptions.toast.imageIntegration, '1');
  assert.strictEqual(playtimeOptions.toast.customAudio, '0');

  const [, progressOptions] = notificationTest.testMessageAndOptions('progress', options);
  assert.strictEqual(progressOptions.toast.imageIntegration, '0');
  assert.strictEqual(progressOptions.toast.attribution, 'Hollow Knight');
});

test('powertoast wrapper maps a legacy appID key to aumid as a safety net', () => {
  const normalized = powertoast.normalizeToastOptions({ appID: 'LegacyApp_12345678!App', uniqueID: 'X' });
  assert.strictEqual(normalized.aumid, 'LegacyApp_12345678!App');
  assert.ok(!('appID' in normalized), 'the legacy key must not reach powertoast');
  assert.strictEqual(normalized.uniqueID, 'X');

  const untouched = powertoast.normalizeToastOptions({ aumid: 'GoodApp_12345678!App' });
  assert.strictEqual(untouched.aumid, 'GoodApp_12345678!App');
});
