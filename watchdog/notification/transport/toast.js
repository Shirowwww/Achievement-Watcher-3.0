'use strict';

const toast = require('powertoast');
const soundPlayer = require('../../util/soundPlayer.js');

const TOAST_QUEUE_SOUND_DELAY_MS = 5000;

function normalizeProgress(progress) {
  if (!progress) return null;
  const max = Number(progress.max);
  if (!Number.isFinite(max) || max <= 1) return null;
  const currentRaw = Number(progress.current);
  const current = Math.max(0, Math.min(max, Number.isFinite(currentRaw) ? currentRaw : 0));
  return {
    current,
    max,
    percent: Math.max(0, Math.min(100, Math.floor((current / max) * 100))),
  };
}

module.exports = async (message, options) => {
  // customAudio: '0' muted | '1' system default toast sound | '2' custom audio file.
  // Only '2' needs a file we play ourselves; '1' is far more reliable as the toast's own native
  // sound than shelling a WAV path through sound-play (the previous code silenced the toast for
  // BOTH '1' and '2' — `customAudio == '0' || soundFile` is `(... ) ? true : false` — so any
  // configured sound left the toast silent and depended entirely on a sound-play call that can
  // fail quietly, which is why notifications were effectively muted, #34).
  let soundFile;
  if (options.toast.customAudio === '2') {
    let toastAudio = require('../../util/toastAudio.js');
    soundFile = toastAudio.getCustom();
  }
  let notification = {
    appID: options.toast.appid,
    timeStamp: message.time,
    title: message.achievementDisplayName,
    message: message.achievementDescription,
    // Playtime's `icon` is Steam's tiny img_icon_url (low-res, looks like an exe icon); prefer the
    // higher-res gameIcon (Steam library art) and fall back to it only when that's unavailable.
    icon: message.notificationType === 'playtime' ? message.gameIcon || message.icon : message.icon,
    // Silence the toast only when muted, or when we have our own custom file to play.
    silent: options.toast.customAudio === '0' || (options.toast.customAudio === '2' && !!soundFile) ? true : false,
    // '1' and '2'-without-a-file fall back to a built-in notification sound.
    audio: options.toast.customAudio === '2' && !soundFile ? 'ms-winsoundevent:Notification.Achievement' : null,
    cropIcon: options.toast.cropIcon,
  };

  if (message.achievementName) {
    notification.uniqueID = `${message.appid}:${message.achievementName}`;
    notification.onClick = `ach:--appid ${message.appid} --name '${message.achievementName}'`;
  } else {
    notification.uniqueID = `${message.appid}`;
  }

  if (options.toast.attribution) notification.attribution = options.toast.attribution;

  if (options.toast.imageIntegration != '0' && message.image) {
    if (options.toast.imageIntegration == '1') {
      notification.headerImg = message.image;
    } else if (options.toast.imageIntegration == '2') {
      notification.footerImg = message.image;
    }
  }

  if (options.toast.group) notification.group = { id: message.appid, title: message.gameDisplayName };

  if (options.toast.winrt === false) notification.disableWinRT = true;

  const progress = normalizeProgress(message.progress);
  if (progress) {
    notification.progress = {
      percent: progress.percent,
      footer: `${progress.current}/${progress.max}`,
    };
  }
  await toast(notification);

  if (soundFile) {
    const queueDelay = Math.max(0, Number(message.delay) || 0) * TOAST_QUEUE_SOUND_DELAY_MS;
    soundPlayer.play(soundFile, { delayMs: queueDelay }).catch((e) => {
      const debug = require('../../util/log.js');
      debug.log(`Error playing toast sound:  ${e}`);
    });
  }
};
