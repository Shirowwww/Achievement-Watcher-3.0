'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const toastTransport = require(path.join(__dirname, '..', 'notification', 'transport', 'toast.js'));
const { buildToastNotification } = toastTransport;
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
  assert.strictEqual(notification.cropIcon, false, 'achievement artwork must remain square');
  assert.strictEqual(notification.time, 123456);
  assert.ok(!('timeStamp' in notification), 'the unsupported timeStamp key must not be sent to powertoast');
  assert.deepEqual(notification.activation, {
    launch: 'achievement-watcher://game/480/ACH_WIN',
    type: 'protocol',
  });
  assert.ok(!('onClick' in notification), 'the dead onClick option must not be sent to powertoast');
});

// powertoast accepts `group` only when both fields are non-empty STRINGS. Given anything else its
// option parser stores a null group and then dereferences it, throwing
// "Cannot read properties of null (reading 'activation')" before the toast is ever shown — and both
// callers fall back to a tray balloon, so the failure looked like a delivered notification that
// simply never appeared (issue #18). A numeric appid alone was enough to trigger it.
test('a grouped toast never hands powertoast a group it will reject', async () => {
  const numeric = buildToastNotification(
    { appid: 367520, achievementName: 'TOAST_TEST', achievementDisplayName: 'X', achievementDescription: 'y', gameDisplayName: 'Hollow Knight' },
    toastOptions({ group: true })
  ).notification;
  assert.deepStrictEqual(numeric.group, { id: '367520', title: 'Hollow Knight' });
  assert.strictEqual(typeof numeric.group.id, 'string');

  // No name to group under: drop the grouping, never the notification.
  const unnamed = buildToastNotification(
    { appid: 480, achievementName: 'A', achievementDisplayName: 'X', achievementDescription: 'y', gameDisplayName: '' },
    toastOptions({ group: true })
  ).notification;
  assert.ok(!('group' in unnamed), 'an empty game name must not produce a group powertoast rejects');

  // The contract that actually matters: powertoast must accept the payload we build.
  const { Toast } = await import('powertoast');
  assert.doesNotThrow(() => new Toast({ aumid: 'x', title: 't', message: 'm', group: numeric.group }));
  assert.throws(
    () => new Toast({ aumid: 'x', title: 't', message: 'm', group: { id: 367520, title: 'Hollow Knight' } }),
    'a numeric group id must still be rejected by powertoast — this test is the reason we coerce it'
  );
});

// Windows will not show a toast while Do Not Disturb is on unless it is marked urgent, which is why
// an in-game unlock can go unseen (issue #18). Opt-in, and pointedly not for the notifications that
// are not worth breaking a focused session for.
test('urgent unlocks are marked only when enabled, render correctly, and never apply to playtime or progress', async () => {
  const build = (message) => {
    const { notification } = buildToastNotification(message, toastOptions());
    return notification.scenario;
  };
  const unlock = { appid: 480, achievementName: 'A', achievementDisplayName: 'X', achievementDescription: 'y' };

  toastTransport.setUrgentUnlocks(false);
  assert.strictEqual(build(unlock), undefined, 'off by default, no scenario is emitted');

  toastTransport.setUrgentUnlocks(true);
  assert.strictEqual(build(unlock), 'urgent');
  assert.strictEqual(build({ ...unlock, notificationType: 'platinum' }), 'urgent');
  assert.strictEqual(build({ ...unlock, notificationType: 'playtime' }), undefined);
  assert.strictEqual(build({ ...unlock, notificationType: 'progress' }), undefined);

  // This is the payload Windows receives. Keeping the XML assertion here catches a future
  // powertoast change that accepts the JS option but drops the urgent scenario when rendering.
  const { toXmlString } = await import('powertoast');
  const { notification } = buildToastNotification(unlock, toastOptions());
  assert.match(toXmlString(notification), /scenario="urgent"/);

  // powertoast validates the scenario against its own list; an unknown one is silently dropped,
  // which would make this setting a no-op without anything failing.
  toastTransport.setUrgentUnlocks(false);
});

test('winrt=false is forwarded as disableWinRT on the payload', () => {
  const { notification } = buildToastNotification(
    { appid: 480, achievementDisplayName: 'X', achievementDescription: '' },
    toastOptions({ winrt: false })
  );
  assert.strictEqual(notification.disableWinRT, true);
});

test('playtime payload uses its square game logo and always promotes its header image', () => {
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
    // Playtime is a session card: it gets a hero header even if ordinary toast images are off.
    toastOptions({ imageIntegration: '0' })
  );
  assert.strictEqual(notification.icon, 'https://example.com/library.jpg');
  assert.strictEqual(notification.cropIcon, false);
  assert.strictEqual(notification.heroImg, 'https://example.com/header.jpg');
  assert.ok(!('headerImg' in notification), 'the unsupported headerImg key must not be sent to powertoast');

  const fallback = buildToastNotification(
    {
      notificationType: 'playtime',
      appid: 480,
      achievementDisplayName: 'Spacewar',
      achievementDescription: 'You played for 12m',
      gameIcon: 'https://example.com/library.jpg',
    },
    toastOptions({ imageIntegration: '0' })
  ).notification;
  assert.strictEqual(fallback.icon, 'https://example.com/library.jpg', 'missing game logos keep a best-effort fallback');
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
  assert.match(xml, /hint-crop="none"/);
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
    {}
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
  assert.strictEqual(toastOptions.toast.cropIcon, undefined);
  assert.strictEqual(toastOptions.toast.attribution, 'Hollow Knight');

  const [, playtimeOptions] = notificationTest.testMessageAndOptions('playtime', options);
  assert.strictEqual(playtimeOptions.toast.imageIntegration, '1');
  assert.strictEqual(playtimeOptions.toast.customAudio, '0');

  const [, progressOptions] = notificationTest.testMessageAndOptions('progress', options);
  assert.strictEqual(progressOptions.toast.imageIntegration, '0');
  assert.strictEqual(progressOptions.toast.attribution, 'Hollow Knight');
});

test('a test fired from a game previews that game, not the built-in sample', () => {
  const options = {
    achievement: { lang: 'english' },
    notification_transport: { winRT: true },
    notification_toast: { customToastAudio: '1', groupToast: false },
    overlay: { notificationVolume: '100' },
  };
  const game = {
    appid: 1091500,
    name: 'Cyberpunk 2077',
    icon: 'https://example.invalid/cp2077-icon.jpg',
    image: 'https://example.invalid/cp2077-header.jpg',
  };

  const [message, toastOptions] = notificationTest.testMessageAndOptions('toast', options, game);
  assert.strictEqual(message.appid, 1091500);
  assert.strictEqual(message.gameDisplayName, 'Cyberpunk 2077');
  assert.strictEqual(message.gameIcon, game.icon);
  assert.strictEqual(message.image, game.image);
  assert.strictEqual(toastOptions.toast.attribution, 'Cyberpunk 2077');
  // No per-achievement art exists for a preview, so the game's own icon is used rather than an
  // unrelated game's badge.
  assert.strictEqual(message.icon, game.icon);

  // Playtime puts the game name in the title slot and uses the library art.
  const [playtime] = notificationTest.testMessageAndOptions('playtime', options, game);
  assert.strictEqual(playtime.achievementDisplayName, 'Cyberpunk 2077');
  assert.strictEqual(playtime.icon, game.icon);

  // A partial payload still resolves: only the supplied fields override the sample.
  const [partial] = notificationTest.testMessageAndOptions('toast', options, { name: 'Undertale' });
  assert.strictEqual(partial.gameDisplayName, 'Undertale');
  assert.strictEqual(partial.appid, 367520, 'the sample appid stands in when none is given');

  // And omitting the game entirely keeps the previous behaviour exactly.
  const [sample] = notificationTest.testMessageAndOptions('toast', options);
  assert.strictEqual(sample.gameDisplayName, 'Hollow Knight');
});

test('powertoast wrapper maps a legacy appID key to aumid as a safety net', () => {
  const normalized = powertoast.normalizeToastOptions({ appID: 'LegacyApp_12345678!App', uniqueID: 'X' });
  assert.strictEqual(normalized.aumid, 'LegacyApp_12345678!App');
  assert.ok(!('appID' in normalized), 'the legacy key must not reach powertoast');
  assert.strictEqual(normalized.uniqueID, 'X');

  const untouched = powertoast.normalizeToastOptions({ aumid: 'GoodApp_12345678!App' });
  assert.strictEqual(untouched.aumid, 'GoodApp_12345678!App');
});
