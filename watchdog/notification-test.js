'use strict';

const path = require('path');
const toast = require('./util/powertoast');
const balloon = require('./util/powerballoon');
const toastIdentity = require('./util/toastIdentity.js');
const settings = require('./settings.js');
const soundPlayer = require('./util/soundPlayer.js');
const { mediaPlayerVolume } = require('./util/notificationVolume.js');
const { buildToastNotification } = require('./notification/transport/toast.js');

// xinput-ffi is ESM-only (koffi) since v2; load it lazily via dynamic import (cached by Node) only
// when the test toast actually rumbles. Best-effort: a load failure (no XInput runtime) is swallowed.
let xinputPromise = null;
const loadXinput = () => xinputPromise || (xinputPromise = import('xinput-ffi').catch(() => null));

const cfg_file = path.join(require('./util/userData.js').userDataDir(), 'cfg', 'options.ini');

const TEST_APPID = 367520;
const TEST_GAME = 'Hollow Knight';
const TEST_ICON = 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg';
const TEST_HEADER = 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg';

// Resolve the AUMID through the SAME code path as a real unlock (util/toastIdentity.js), and
// forward the WinRT-off flag the way powertoast expects it (on the payload, consumed by
// util/powertoast.js into show()). Sharing the resolver is the point: a test button that picks its
// app id differently from the Watchdog can pass while real toasts stay invisible — which is exactly
// how issue #8 stayed hidden.
async function applyToastAppSettings(payload, options) {
  const chosen = await toastIdentity.resolveToastIdentity(options, { log: require('./util/log.js') });
  payload.aumid = chosen.id;
  if (options.notification_transport.winRT === false) payload.disableWinRT = true;
  return payload;
}

// Build the exact message + toast options the Watchdog uses for each notification kind, so the
// Settings test buttons exercise the same builder (and therefore the same payload) as real unlocks.
function testMessageAndOptions(kind, options) {
  const fr = (options.achievement.lang || '').toLowerCase().startsWith('fr');
  const baseToast = {
    appid: toastIdentity.DEFAULT_TOAST_AUMID, // placeholder; applyToastAppSettings resolves the real one
    winrt: options.notification_transport.winRT,
    customAudio: options.notification_toast.customToastAudio,
    volume: mediaPlayerVolume(options.overlay && options.overlay.notificationVolume),
    // Achievements/progress stay clean (no hero image); playtime/platinum use the game header.
    imageIntegration: kind === 'playtime' || kind === 'platinum' ? '1' : '0',
    group: options.notification_toast.groupToast,
    cropIcon: true,
  };

  const common = {
    appid: TEST_APPID,
    gameDisplayName: TEST_GAME,
    gameIcon: TEST_HEADER,
    image: TEST_HEADER,
    // powertoast's `time` is a Unix timestamp in SECONDS (it multiplies by 1000 for
    // displayTimestamp); passing milliseconds dated the test toast to the year 55000.
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
      baseToast.attribution = `${TEST_GAME} · ${fr ? `Rare ${rarePct} %` : `Rare ${rarePct}%`}`;
      return [
        {
          ...common,
          achievementName: 'RARE_TEST',
          achievementDisplayName: fr ? 'Succès rare' : 'Rare Achievement',
          achievementDescription: fr
            ? `Seulement ${rarePct} % des joueurs l'ont débloqué.`
            : `Only ${rarePct}% of players unlocked this.`,
          icon: TEST_ICON,
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
          icon: TEST_ICON,
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
          icon: TEST_ICON,
          silent: true,
        },
        { toast: baseToast },
      ];
    case 'platinum':
      baseToast.attribution = `${TEST_GAME} · ${fr ? 'Trophée Platine' : 'Platinum'}`;
      return [
        {
          ...common,
          notificationType: 'platinum',
          achievementDisplayName: TEST_GAME,
          achievementDescription: fr ? 'Trophée platine débloqué — 100 % complété !' : 'Platinum unlocked — 100% completed!',
          icon: TEST_ICON,
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
          achievementDisplayName: fr ? 'Succès de test' : 'Test Achievement',
          achievementDescription: fr
            ? 'Ceci est une notification de test depuis Achievement Watcher.'
            : 'This is a test notification from Achievement Watcher.',
          icon: TEST_ICON,
        },
        { toast: baseToast },
      ];
  }
}

async function runTest(kind, { rumble = true } = {}) {
  try {
    const options = await settings.load(cfg_file);
    const [message, toastOptions] = testMessageAndOptions(kind, options);
    const { notification, soundFile } = buildToastNotification(message, toastOptions);
    await applyToastAppSettings(notification, options);

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
      if (options.notification_transport.balloon) {
        await balloon({
          title: notification.title,
          message: notification.message || 'Achievement unlocked !',
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
module.exports.applyToastAppSettings = applyToastAppSettings;
module.exports.testMessageAndOptions = testMessageAndOptions;
