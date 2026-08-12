'use strict';

const toast = require('../../util/powertoast');
const soundPlayer = require('../../util/soundPlayer.js');
const { mediaPlayerVolume } = require('../../util/notificationVolume.js');
const notifyStrings = require('../../util/notifyStrings.js');

const TOAST_QUEUE_SOUND_DELAY_MS = 5000;

// Stored once because every toast uses the same urgency setting.
let urgentUnlocks = false;
function setUrgentUnlocks(enabled) {
  urgentUnlocks = enabled === true;
}

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

// Keep float counters readable without changing integers.
function formatProgressValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 100) / 100);
}

// Use encoded path segments because powertoast inserts the URI into toast XML.
function buildActivation(message) {
  const scheme = String(process.env.AW_TOAST_PROTOCOL || '').trim();
  if (!scheme || message.appid == null || message.appid === '') return null;
  const segments = [encodeURIComponent(String(message.appid))];
  if (message.achievementName) segments.push(encodeURIComponent(String(message.achievementName)));
  return { launch: `${scheme}://game/${segments.join('/')}`, type: 'protocol' };
}

// Build one powertoast payload. Exported for contract tests.
function buildToastNotification(message, options) {
  const strings = notifyStrings.forLang(
    String((options && (options.lang || (options.toast && options.toast.lang))) || 'english')
  );
  const type = String((message && message.notificationType) || '').toLowerCase();

  // Keep the localized title and achievement details separate.
  let title = message.achievementDisplayName;
  let body = message.achievementDescription;
  if (type === 'platinum') {
    title = strings.platinumTitle || title;
    body = [message.gameDisplayName, message.achievementDescription].filter(Boolean).join('\n');
  } else if (type === 'achievement' || type === '') {
    title = strings.achievementUnlocked || title;
    body = [message.achievementDisplayName, message.achievementDescription].filter(Boolean).join('\n');
  }

  // A configured file is played by soundPlayer; otherwise Windows supplies the sound.
  const soundFile = (options && options.toast && options.toast.soundFile) || '';
  const hasCustomSound = !!soundFile;
  let notification = {
    // powertoast calls this field `aumid`.
    aumid: options.toast.appid,
    // powertoast expects Unix seconds here.
    time: message.time,
    title,
    message: body,
    // Playtime prefers the high-res library art; Steam's clienticon (message.icon) is 32×32 and
    // renders blurry when Windows scales it into the toast. Other toasts keep the achievement icon.
    icon: type === 'playtime' ? message.gameIcon || message.icon : message.icon,
    // Silence the native toast when soundPlayer handles audio or the user muted it.
    silent: hasCustomSound || options.toast.customAudio === '0' ? true : false,
    audio: hasCustomSound ? null : options.toast.customAudio === '2' ? 'ms-winsoundevent:Notification.Achievement' : null,
    // Keep achievement artwork square.
    cropIcon: false,
  };

  notification.uniqueID = message.achievementName ? `${message.appid}:${message.achievementName}` : `${message.appid}`;

  // Urgent applies only to unlocks and is opt-in.
  if (urgentUnlocks && message.notificationType !== 'playtime' && message.notificationType !== 'progress') {
    notification.scenario = 'urgent';
  }

  // Protocol activation lets the main process open the selected game.
  const activation = buildActivation(message);
  if (activation) notification.activation = activation;

  if (options.toast.attribution) notification.attribution = options.toast.attribution;

  // Playtime always uses the game header as its hero image.
  const imageIntegration = type === 'playtime' ? '1' : options.toast.imageIntegration;
  if (imageIntegration != '0' && message.image) {
    if (imageIntegration == '1') {
      notification.heroImg = message.image;
    } else if (options.toast.imageIntegration == '2') {
      notification.inlineImg = message.image;
    }
  }

  // powertoast requires non-empty string ids and titles for grouping.
  if (options.toast.group) {
    const groupId = String(message.appid ?? '').trim();
    const groupTitle = String(message.gameDisplayName ?? '').trim();
    if (groupId && groupTitle) notification.group = { id: groupId, title: groupTitle };
  }

  if (options.toast.winrt === false) notification.disableWinRT = true;

  const progress = normalizeProgress(message.progress);
  if (progress) {
    notification.progress = {
      value: progress.percent,
      status: `${formatProgressValue(progress.current)}/${formatProgressValue(progress.max)}`,
    };
  }

  return { notification, soundFile };
}

module.exports = async (message, options) => {
  const { notification, soundFile } = buildToastNotification(message, options);
  await toast(notification);

  if (soundFile) {
    const queueDelay = Math.max(0, Number(message.delay) || 0) * TOAST_QUEUE_SOUND_DELAY_MS;
    // PowerShell caps toast volume at 100%.
    const volume = mediaPlayerVolume(options.toast.volume);
    soundPlayer.play(soundFile, { delayMs: queueDelay, volume }).catch((e) => {
      const debug = require('../../util/log.js');
      debug.log(`Error playing toast sound:  ${e}`);
    });
  }
};

module.exports.buildToastNotification = buildToastNotification;
module.exports.buildActivation = buildActivation;
module.exports.setUrgentUnlocks = setUrgentUnlocks;
