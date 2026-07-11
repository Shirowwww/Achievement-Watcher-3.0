'use strict';

const os = require('os');
const path = require('path');
const toast = require('./util/powertoast');
const balloon = require('./util/powerballoon');
const startApps = require('./util/startApps.js');
const settings = require('./settings.js');
const soundPlayer = require('./util/soundPlayer.js');
const { mediaPlayerVolume } = require('./util/notificationVolume.js');

// xinput-ffi is ESM-only (koffi) since v2; load it lazily via dynamic import (cached by Node) only
// when the test toast actually rumbles. Best-effort: a load failure (no XInput runtime) is swallowed.
let xinputPromise = null;
const loadXinput = () => xinputPromise || (xinputPromise = import('xinput-ffi').catch(() => null));

const cfg_file = path.join(process.env['APPDATA'], 'Achievement Watcher/cfg', 'options.ini');

let winRT;
try {
  winRT = {
    xml: require('@nodert-win10-rs4/windows.data.xml.dom'),
    notifications: require('@nodert-win10-rs4/windows.ui.notifications'),
  };
  if (!winRT.xml || !winRT.notifications) winRT = null;
} catch {}

module.exports.toast = async () => {
  try {
    const options = await settings.load(cfg_file);

    const hasXboxOverlay = await startApps.has({ id: 'GamingOverlay' });
    const win_ver = os.release().split('.');

    let message;
    if (!winRT || (winRT && options.notification_transport.winRT === false)) {
      message = 'PowerShell';
    } else {
      message = 'WinRT';
    }

    // See toast.js: only '2' (custom file) needs sound-play; '1' uses the toast's own native sound.
    let soundFile;
    if (options.notification_toast.customToastAudio === '2') {
      let toastAudio = require(path.join(__dirname, './util/toastAudio.js'));
      soundFile = toastAudio.getCustom();
    }
    let payload = {
      appID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      uniqueID: 'TOAST_TEST',
      title: 'Achievement Watcher',
      message: options.notification.showDesc ? `${message}\nHello World` : `${message}`,
      icon: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg',
      attribution: 'Achievement',
      silent: options.notification_toast.customToastAudio === '0' || (options.notification_toast.customToastAudio === '2' && !!soundFile) ? true : false,
      audio: options.notification_toast.customToastAudio === '2' && !soundFile ? 'ms-winsoundevent:Notification.Achievement' : null,
    };

    if (options.notification_toast.groupToast) payload.group = { id: 'TOAST_TEST_GROUP', title: 'Achievement Watcher' };

    if (options.notification_transport.winRT === false) options.disableWinRT = true;

    if (options.notification_advanced.appID && options.notification_advanced.appID !== '') {
      payload.appID = options.notification_advanced.appID;
    } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
      payload.appID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
    } else if (hasXboxOverlay === true) {
      payload.appID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
    }

    try {
      await toast(payload);
      if (soundFile) {
        // Same volume handling as the real toast transport: user's 0–200% setting, clamped to 100%.
        const volume = mediaPlayerVolume(options.overlay && options.overlay.notificationVolume);
        soundPlayer.play(soundFile, { volume }).catch((e) => {
          const debug = require('./util/log.js');
          debug.log(`Error playing toast sound:  ${e}`);
        });
      }
    } catch (err) {
      if (options.notification_transport.balloon) {
        try {
          await balloon({
            title: payload.title,
            message: options.notification.showDesc ? 'Balloon Fallback\nHello World' : 'Balloon Fallback',
            ico: './notification/icon/icon.ico',
          });
        } catch (err) {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (options.notification.rumble) {
      const xinput = await loadXinput();
      if (xinput) xinput.rumble().catch(() => {});
    }
  } catch (err) {
    throw err;
  }
};

// Mirrors the rare-achievement toast watchdog.js fires (rarity attribution "Rare · X%") so the
// test button reflects real rendering. The percentage is random within the tiers presets style
// (gold <3%, silver <6%, bronze ≤10%), rounded to one decimal like the real path.
module.exports.rare = async () => {
  try {
    const options = await settings.load(cfg_file);

    const hasXboxOverlay = await startApps.has({ id: 'GamingOverlay' });
    const win_ver = os.release().split('.');

    const tiers = [
      { min: 0.1, max: 2.9 },
      { min: 3.0, max: 5.9 },
      { min: 6.0, max: 10.0 },
    ];
    const tier = tiers[Math.floor(Math.random() * tiers.length)];
    const rarePct = Math.round((tier.min + Math.random() * (tier.max - tier.min)) * 10) / 10;
    const rareFr = (options.achievement.lang || '').toLowerCase().startsWith('fr');

    // See toast.js: only '2' (custom file) needs sound-play; '1' uses the toast's own native sound.
    let soundFile;
    if (options.notification_toast.customToastAudio === '2') {
      let toastAudio = require(path.join(__dirname, './util/toastAudio.js'));
      soundFile = toastAudio.getCustom();
    }
    let payload = {
      appID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      uniqueID: 'RARE_TEST',
      title: rareFr ? 'Succès rare' : 'Rare Achievement',
      message: rareFr ? `Seulement ${rarePct} % des joueurs l'ont débloqué.` : `Only ${rarePct}% of players unlocked this.`,
      icon: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg',
      attribution: rareFr ? `Rare · ${rarePct} %` : `Rare · ${rarePct}%`,
      cropIcon: true,
      silent: options.notification_toast.customToastAudio === '0' || (options.notification_toast.customToastAudio === '2' && !!soundFile) ? true : false,
      audio: options.notification_toast.customToastAudio === '2' && !soundFile ? 'ms-winsoundevent:Notification.Achievement' : null,
    };

    if (options.notification_toast.groupToast) payload.group = { id: 'RARE_TEST_GROUP', title: 'Achievement Watcher' };

    if (options.notification_advanced.appID && options.notification_advanced.appID !== '') {
      payload.appID = options.notification_advanced.appID;
    } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
      payload.appID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
    } else if (hasXboxOverlay === true) {
      payload.appID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
    }

    if (options.notification_transport.winRT === false) payload.disableWinRT = true;

    try {
      await toast(payload);
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
          title: payload.title,
          message: payload.message,
          ico: './notification/icon/icon.ico',
        });
      } else {
        throw err;
      }
    }

    if (options.notification.rumble) {
      const xinput = await loadXinput();
      if (xinput) xinput.rumble().catch(() => {});
    }
  } catch (err) {
    throw err;
  }
};

// Mirrors the achievement-progress toast watchdog.js fires on notifyOnProgress (silent, no
// attribution, percent progress bar) so the test button reflects real rendering.
module.exports.progress = async () => {
  try {
    const options = await settings.load(cfg_file);

    const hasXboxOverlay = await startApps.has({ id: 'GamingOverlay' });
    const win_ver = os.release().split('.');

    let payload = {
      appID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      uniqueID: 'PROGRESS_TEST',
      title: 'Far Traveler',
      message: 'Travel 1000 light-years in a single game.',
      icon: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg',
      cropIcon: true,
      silent: true,
      progress: { percent: 30, footer: '3/10' },
    };

    if (options.notification_advanced.appID && options.notification_advanced.appID !== '') {
      payload.appID = options.notification_advanced.appID;
    } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
      payload.appID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
    } else if (hasXboxOverlay === true) {
      payload.appID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
    }

    if (options.notification_transport.winRT === false) payload.disableWinRT = true;

    try {
      await toast(payload);
    } catch (err) {
      if (options.notification_transport.balloon) {
        await balloon({
          title: payload.title,
          message: `[ 3/10 ]\n${payload.message}`,
          ico: './notification/icon/icon.ico',
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    throw err;
  }
};

// Mirrors the playtime toast watchdog.js fires (silent, hero/header image, "Achievement Watcher"
// attribution) so the test button reflects real rendering.
module.exports.playtime = async () => {
  try {
    const options = await settings.load(cfg_file);

    const hasXboxOverlay = await startApps.has({ id: 'GamingOverlay' });
    const win_ver = os.release().split('.');

    let payload = {
      appID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      uniqueID: 'PLAYTIME_TEST',
      title: 'Hollow Knight',
      message: '0h 42m',
      icon: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg',
      headerImg: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg',
      attribution: 'Achievement Watcher',
      cropIcon: true,
      silent: true,
    };

    if (options.notification_advanced.appID && options.notification_advanced.appID !== '') {
      payload.appID = options.notification_advanced.appID;
    } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
      payload.appID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
    } else if (hasXboxOverlay === true) {
      payload.appID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
    }

    if (options.notification_transport.winRT === false) payload.disableWinRT = true;

    try {
      await toast(payload);
    } catch (err) {
      if (options.notification_transport.balloon) {
        await balloon({
          title: payload.title,
          message: payload.message,
          ico: './notification/icon/icon.ico',
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    throw err;
  }
};

// Mirrors the platinum toast watchdog.js fires when a game hits 100% (hero/header image,
// "Platinum" attribution) so the test button reflects real rendering.
module.exports.platinum = async () => {
  try {
    const options = await settings.load(cfg_file);

    const hasXboxOverlay = await startApps.has({ id: 'GamingOverlay' });
    const win_ver = os.release().split('.');

    const platinumFr = (options.achievement.lang || '').toLowerCase().startsWith('fr');

    let payload = {
      appID: 'Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp',
      uniqueID: 'PLATINUM_TEST',
      title: 'Hollow Knight',
      message: platinumFr ? 'Trophée platine débloqué — 100 % complété !' : 'Platinum unlocked — 100% completed!',
      icon: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_184x69.jpg',
      headerImg: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg',
      attribution: platinumFr ? 'Trophée Platine' : 'Platinum',
      cropIcon: true,
      silent: true,
    };

    if (options.notification_advanced.appID && options.notification_advanced.appID !== '') {
      payload.appID = options.notification_advanced.appID;
    } else if (win_ver[0] == '6' && (win_ver[1] == '3' || win_ver[1] == '2')) {
      payload.appID = 'microsoft.XboxLIVEGames_8wekyb3d8bbwe!Microsoft.XboxLIVEGames';
    } else if (hasXboxOverlay === true) {
      payload.appID = 'Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App';
    }

    if (options.notification_transport.winRT === false) payload.disableWinRT = true;

    try {
      await toast(payload);
    } catch (err) {
      if (options.notification_transport.balloon) {
        await balloon({
          title: payload.title,
          message: payload.message,
          ico: './notification/icon/icon.ico',
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    throw err;
  }
};
