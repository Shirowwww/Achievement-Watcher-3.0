'use strict';

const toast = require('../../util/powertoast');
const soundPlayer = require('../../util/soundPlayer.js');
const { mediaPlayerVolume } = require('../../util/notificationVolume.js');
const notifyStrings = require('../../util/notifyStrings.js');

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

// Float stat counters (e.g. distance driven) can carry long tails (3.3333333…); cap what the
// footer prints at 2 decimals, leaving integers untouched.
function formatProgressValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 100) / 100);
}

// URI a toast click hands back to the app. Empty when the main process could not register the
// scheme (dev run, locked-down HKCU) — in that case the toast simply carries no activation, which
// is honest: emitting one that resolves nowhere is how "click does nothing" bugs are born.
//
// The identifiers go in PATH SEGMENTS, not a query string: powertoast injects `launch` into the
// toast XML verbatim, so a query string's "&" would produce malformed XML and Windows would reject
// the whole notification. Percent-encoding each segment keeps the value safe as an XML attribute.
function buildActivation(message) {
  const scheme = String(process.env.AW_TOAST_PROTOCOL || '').trim();
  if (!scheme || message.appid == null || message.appid === '') return null;
  const segments = [encodeURIComponent(String(message.appid))];
  if (message.achievementName) segments.push(encodeURIComponent(String(message.achievementName)));
  return { launch: `${scheme}://game/${segments.join('/')}`, type: 'protocol' };
}

// Build the powertoast option object for one notification. Exported as a pure function so the
// payload contract (aumid, uniqueID, …) is unit-testable without shelling out to PowerShell.
function buildToastNotification(message, options) {
  const strings = notifyStrings.forLang(
    String((options && (options.lang || (options.toast && options.toast.lang))) || 'english')
  );
  const type = String((message && message.notificationType) || '').toLowerCase();

  // Prettier, more informative layout than a bare achievement-name title:
  //   Achievement Unlocked            <- localized title (platinum keeps its own title)
  //   <achievement name>              <- body line 1
  //   <description>                   <- body line 2
  //   <game name> · Rare x%           <- attribution
  let title = message.achievementDisplayName;
  let body = message.achievementDescription;
  if (type === 'platinum') {
    title = strings.platinumTitle || title;
    body = [message.gameDisplayName, message.achievementDescription].filter(Boolean).join('\n');
  } else if (type === 'achievement' || type === '') {
    title = strings.achievementUnlocked || title;
    body = [message.achievementDisplayName, message.achievementDescription].filter(Boolean).join('\n');
  }

  // customAudio: '0' muted | '1' system default toast sound | '2' custom audio file.
  // Only '2' needs a file we play ourselves; '1' is far more reliable as the toast's own native
  // sound than shelling a WAV path through sound-play (the previous code silenced the toast for
  // BOTH '1' and '2' — `customAudio == '0' || soundFile` is `(... ) ? true : false` — so any
  // configured sound left the toast silent and depended entirely on a sound-play call that can
  // fail quietly, which is why notifications were effectively muted, #34).
  // '2' is no longer reachable from the UI (superseded by the sound picker in
  // notificationSounds.js, which plays through soundPlayer directly) and its old Windows-registry
  // lookup (util/toastAudio.js) is gone — leave soundFile unset so the existing fallback below
  // plays the built-in achievement sound instead of throwing on a missing module.
  // Configured notification sound (Settings > Notifications > Son / Son aléatoire), resolved
  // by toaster.js. When present, the toast itself is silenced and the file is played at the
  // configured volume; otherwise the toast uses its native Windows sound behavior.
  const soundFile = (options && options.toast && options.toast.soundFile) || '';
  const hasCustomSound = !!soundFile;
  let notification = {
    // powertoast expects `aumid`, not `appID`. The old key was silently ignored, so every toast was
    // posted under powertoast's own default — the Microsoft Store's identity — instead of the app id
    // this transport had carefully selected. Combined with that selected id being the classic Xbox
    // app, which Windows 11 no longer ships, nothing was ever displayed while every call still
    // resolved successfully: "the rumble fires but no toast appears" (issue #8). See
    // util/toastIdentity.js for the identity selection itself.
    aumid: options.toast.appid,
    // powertoast reads `time` (Unix seconds) for displayTimestamp; the old `timeStamp` key was
    // silently ignored, so every toast fell back to "now" instead of the unlock time.
    time: message.time,
    title,
    message: body,
    // Playtime's `icon` is Steam's tiny img_icon_url (low-res, looks like an exe icon); prefer the
    // higher-res gameIcon (Steam library art) and fall back to it only when that's unavailable.
    icon: message.notificationType === 'playtime' ? message.gameIcon || message.icon : message.icon,
    // Silence the toast when we play the configured sound ourselves, or when muted.
    silent: hasCustomSound || options.toast.customAudio === '0' ? true : false,
    // '2'-without-a-file falls back to a built-in notification sound.
    audio: hasCustomSound ? null : options.toast.customAudio === '2' ? 'ms-winsoundevent:Notification.Achievement' : null,
    cropIcon: options.toast.cropIcon,
  };

  notification.uniqueID = message.achievementName ? `${message.appid}:${message.achievementName}` : `${message.appid}`;

  // powertoast has no `onClick` option — clicks are configured through `activation`. Foreground
  // activation is not usable here: it requires a COM toast-activator bound to our AUMID, which an
  // unpackaged desktop app does not get for free, so the click would do nothing at all. Protocol
  // activation just ShellExecutes the URI, which the main process registers on every launch and
  // turns into "open this game" (see parseToastActivation in electron/init.js).
  const activation = buildActivation(message);
  if (activation) notification.activation = activation;

  if (options.toast.attribution) notification.attribution = options.toast.attribution;

  if (options.toast.imageIntegration != '0' && message.image) {
    if (options.toast.imageIntegration == '1') {
      // powertoast renders a hero image through `heroImg`; the old `headerImg` key was silently
      // dropped from the XML, so playtime/platinum toasts never showed their game art.
      notification.heroImg = message.image;
    } else if (options.toast.imageIntegration == '2') {
      notification.inlineImg = message.image;
    }
  }

  // Grouping is best-effort, and powertoast validates it strictly: `group` is accepted only when
  // BOTH id and title are non-empty strings. Anything else makes its option parser store a null
  // group and then dereference it — `Cannot read properties of null (reading 'activation')` — which
  // throws before the toast is ever shown. A numeric appid (the Settings test passes 367520 as a
  // number) or a game with no resolved name was therefore enough to silently swallow the whole
  // notification, which is the "nothing is displayed" half of issue #18. Coerce the id, and drop
  // the grouping rather than the toast when there is no title to group under.
  if (options.toast.group) {
    const groupId = String(message.appid ?? '').trim();
    const groupTitle = String(message.gameDisplayName ?? '').trim();
    if (groupId && groupTitle) notification.group = { id: groupId, title: groupTitle };
  }

  if (options.toast.winrt === false) notification.disableWinRT = true;

  const progress = normalizeProgress(message.progress);
  if (progress) {
    notification.progress = {
      // powertoast expects value 0–100 plus a status line; the previous {percent, footer} shape
      // made every progress toast render an indeterminate bar with an empty status.
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
    // Honor the user's notification volume (0–200%). The PowerShell MediaPlayer caps at 1.0, so a
    // >100% boost only applies to overlay popups; here it clamps to full volume.
    const volume = mediaPlayerVolume(options.toast.volume);
    soundPlayer.play(soundFile, { delayMs: queueDelay, volume }).catch((e) => {
      const debug = require('../../util/log.js');
      debug.log(`Error playing toast sound:  ${e}`);
    });
  }
};

module.exports.buildToastNotification = buildToastNotification;
module.exports.buildActivation = buildActivation;
