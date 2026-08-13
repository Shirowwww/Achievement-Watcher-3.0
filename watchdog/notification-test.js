'use strict';

const path = require('path');
const toast = require('./util/powertoast');
const balloon = require('./util/powerballoon');
const toastIdentity = require('./util/toastIdentity.js');
const prefetch = require('./notification/prefetch.js');
const settings = require('./settings.js');
const soundPlayer = require('./util/soundPlayer.js');
const { mediaPlayerVolume } = require('./util/notificationVolume.js');
const { buildToastNotification } = require('./notification/transport/toast.js');
const notificationSound = require('./util/notificationSound.js');
const notifyStrings = require('./util/notifyStrings.js');

// Load the optional rumble dependency only when needed.
let xinputPromise = null;
const loadXinput = () => xinputPromise || (xinputPromise = import('xinput-ffi').catch(() => null));

const cfg_file = path.join(require('./util/userData.js').userDataDir(), 'cfg', 'options.ini');

const TEST_APPID = 367520;
const TEST_GAME = 'Hollow Knight';
// Use square artwork for the Windows app-logo slot.
const TEST_ACHIEVEMENT_ICON = 'https://shared.fastly.steamstatic.com/community_assets/images/apps/367520/6d15e62c48ba57d23e72b8f24fb775a44223cb8f.jpg';
const TEST_GAME_ICON = 'https://shared.fastly.steamstatic.com/community_assets/images/apps/367520/f6ab055c2366237200b1a31cccbd6cf81e436d72.jpg';
const TEST_HEADER = 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg';
let preparePromise = null;

// Start the cold Windows/AUMID and artwork work when Watchdog starts, not on the user's first click.
async function prepare() {
  if (preparePromise) return preparePromise;
  preparePromise = (async () => {
    const options = await settings.load(cfg_file);
    const identity = await toastIdentity.resolveToastIdentity(options, { log: require('./util/log.js') });
    if (toastIdentity.requiresLocalImages(identity.id)) {
      await Promise.allSettled([
        prefetch(TEST_ACHIEVEMENT_ICON, TEST_APPID),
        prefetch(TEST_GAME_ICON, TEST_APPID),
        prefetch(TEST_HEADER, TEST_APPID),
      ]);
    }
    return identity;
  })();
  return preparePromise;
}

// Use the same AUMID and WinRT options as real toasts.
async function applyToastAppSettings(payload, options, identity = null) {
  const chosen = identity || (await toastIdentity.resolveToastIdentity(options, { log: require('./util/log.js') }));
  payload.aumid = chosen.id;
  if (options.notification_transport.winRT === false) payload.disableWinRT = true;
  return payload;
}

// Cache artwork first because desktop AUMIDs require local image paths.
async function prefetchDesktopToastArtwork(message, aumid) {
  if (!toastIdentity.requiresLocalImages(aumid)) return;

  const cachedByUrl = new Map();
  for (const field of ['icon', 'gameIcon', 'image']) {
    const source = message[field];
    if (!source) continue;
    if (!cachedByUrl.has(source)) cachedByUrl.set(source, await prefetch(source, message.appid));
    message[field] = cachedByUrl.get(source);
  }
}

// Build the same payload used by real unlocks.
function testMessageAndOptions(kind, options) {
  const strings = notifyStrings.forLang(options.achievement.lang);
  const baseToast = {
    appid: toastIdentity.DEFAULT_TOAST_AUMID, // placeholder; applyToastAppSettings resolves the real one
    winrt: options.notification_transport.winRT,
    customAudio: options.notification_toast.customToastAudio,
    volume: mediaPlayerVolume(options.overlay && options.overlay.notificationVolume),
    // Only playtime/platinum use the game header.
    imageIntegration: kind === 'playtime' || kind === 'platinum' ? '1' : '0',
    group: options.notification_toast.groupToast,
  };

  const common = {
    appid: TEST_APPID,
    gameDisplayName: TEST_GAME,
    gameIcon: TEST_GAME_ICON,
    image: TEST_HEADER,
    // powertoast expects Unix seconds.
    time: Math.floor(Date.now() / 1000),
  };

  switch (kind) {
    case 'rare': {
      const tiers = [
        { min: 0.1, max: 2.9 },
        { min: 3.0, max: 5.9 },
        { min: 6.0, max: 10.0 },
      ];
      const tier = tiers[Math.floor(Math.random() * tiers.length)];
      const rarePct = Math.round((tier.min + Math.random() * (tier.max - tier.min)) * 10) / 10;
      baseToast.attribution = `${TEST_GAME} · ${notifyStrings.interpolate(strings.rare, { percent: rarePct })}`;
      return [
        {
          ...common,
          achievementName: 'RARE_TEST',
          achievementDisplayName: strings.rareAchievement,
          achievementDescription: notifyStrings.interpolate(strings.rareDescription, { percent: rarePct }),
          icon: TEST_ACHIEVEMENT_ICON,
          rarityPercent: rarePct,
        },
        { toast: baseToast },
      ];
    }
    case 'progress':
      baseToast.customAudio = '0';
      baseToast.attribution = TEST_GAME;
      return [
        {
          ...common,
          achievementName: 'PROGRESS_TEST',
          achievementDisplayName: 'Far Traveler',
          achievementDescription: 'Travel 1000 light-years in a single game.',
          icon: TEST_ACHIEVEMENT_ICON,
          progress: { current: 3, max: 10 },
        },
        { toast: baseToast },
      ];
    case 'playtime':
      baseToast.customAudio = '0';
      baseToast.attribution = 'Achievement Watcher';
      return [
        {
          ...common,
          notificationType: 'playtime',
          achievementDisplayName: TEST_GAME,
          achievementDescription: '0h 42m',
          icon: TEST_GAME_ICON,
          silent: true,
        },
        { toast: baseToast },
      ];
    case 'platinum':
      baseToast.attribution = `${TEST_GAME} · ${strings.platinumTitle}`;
      return [
        {
          ...common,
          notificationType: 'platinum',
          achievementDisplayName: TEST_GAME,
          achievementDescription: strings.platinumDesc,
          icon: TEST_ACHIEVEMENT_ICON,
        },
        { toast: baseToast },
      ];
    case 'toast':
    default:
      baseToast.attribution = TEST_GAME;
      return [
        {
          ...common,
          achievementName: 'TOAST_TEST',
          achievementDisplayName: strings.testAchievement,
          achievementDescription: strings.testDescription,
          icon: TEST_ACHIEVEMENT_ICON,
        },
        { toast: baseToast },
      ];
  }
}

async function runTest(kind, { rumble = true } = {}) {
  try {
    const options = await settings.load(cfg_file);
    const [message, toastOptions] = testMessageAndOptions(kind, options);
    toastOptions.toast.lang = options.achievement && options.achievement.lang ? options.achievement.lang : 'english';
    // Test toasts honor the configured overlay sound (Son / Son aléatoire), like real ones.
    if (!message.silent) {
      const ov = options.overlay || {};
      toastOptions.toast.soundFile =
        ov.randomSound === true
          ? notificationSound.pickRandomSound() || notificationSound.resolveSoundFile(ov.notificationSound)
          : notificationSound.resolveSoundFile(ov.notificationSound);
    }
    // The test runs in the Watchdog process but reloads options itself, so it has to apply the
    // urgency preference too — otherwise the button would not exercise what a real unlock does.
    require('./notification/transport/toast.js').setUrgentUnlocks(options.notification_toast?.urgent === true);
    await prepare();
    // Settings may have changed since background preparation. Identity resolution is now cheap
    // because the expensive Start-menu enumeration is cached for the Watchdog process.
    const identity = await toastIdentity.resolveToastIdentity(options, { log: require('./util/log.js') });
    await prefetchDesktopToastArtwork(message, identity.id);
    const { notification, soundFile } = buildToastNotification(message, toastOptions);
    await applyToastAppSettings(notification, options, identity);

    try {
      await toast(notification);
      if (soundFile) {
        const volume = mediaPlayerVolume(options.overlay && options.overlay.notificationVolume);
        soundPlayer.play(soundFile, { volume }).catch((e) => {
          const debug = require('./util/log.js');
          debug.log(`Error playing toast sound:  ${e}`);
        });
      }
    } catch (err) {
      // The balloon fallback made a failing toast look like a working one: the test resolved, the
      // Settings dialog reported success, the pad still rumbled, and the only visible difference
      // was that no toast appeared — which is precisely how issue #18 was reported. Say what broke.
      require('./util/log.js').warn(`[Toast] failed, falling back to a tray balloon: ${err && (err.message || err)}`);
      if (options.notification_transport.balloon) {
        await balloon({
          title: notification.title,
          message: notification.message || notifyStrings.forLang(options.achievement.lang).achievementUnlocked || 'Achievement unlocked !',
          ico: './notification/icon/icon.ico',
        });
      } else {
        throw err;
      }
    }

    if (rumble && options.notification.rumble) {
      const xinput = await loadXinput();
      if (xinput) xinput.rumble().catch(() => {});
    }
  } catch (err) {
    throw err;
  }
}

module.exports.toast = () => runTest('toast');
module.exports.rare = () => runTest('rare');
module.exports.progress = () => runTest('progress', { rumble: false });
module.exports.playtime = () => runTest('playtime', { rumble: false });
module.exports.platinum = () => runTest('platinum');
module.exports.prepare = prepare;
module.exports.applyToastAppSettings = applyToastAppSettings;
module.exports.testMessageAndOptions = testMessageAndOptions;
