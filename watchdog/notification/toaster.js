'use strict';

const path = require('path');
const fs = require('fs');
const toast = require('./transport/toast.js');
const balloon = require('../util/powerballoon');
const fetch = require('./prefetch.js');
const { makeSquareIcon } = require('../util/squareIcon.js');
const notificationSound = require('../util/notificationSound.js');
const { broadcast } = require('../websocket.js');
const { arePopupsSuppressed } = require('../queryUserNotificationState.js');

const debug = require('../util/log.js');

function normalizeProgress(progress) {
  if (!progress) return null;
  const max = Number(progress.max);
  if (!Number.isFinite(max) || max <= 1) return null;
  const currentRaw = Number(progress.current);
  const current = Math.max(0, Math.min(max, Number.isFinite(currentRaw) ? currentRaw : 0));
  const percent = Math.max(0, Math.min(100, Math.floor((current / max) * 100)));
  return { current, max, percent };
}

// Load ESM-only controller dependencies lazily; rumble remains best effort. regodit is loaded
// through its synchronous API only — the `regodit/promises` subpath segfaults (0xC0000005) under
// the pinned koffi 3.x when writing DWORDs, so the Watchdog must never import it.
let regeditPromise = null;
const loadRegedit = () => regeditPromise || (regeditPromise = import('regodit'));

let xinputPromise = null;
const loadXinput = () =>
  xinputPromise ||
  (xinputPromise = import('xinput-ffi').catch((err) => {
    debug.warn(`[rumble] xinput-ffi unavailable, rumble disabled: ${err.message || err}`);
    return null;
  }));

// Sound settings shared by all notification sources.
let defaultOverlay = null;
function setOverlayOptions(overlay) {
  defaultOverlay = overlay || null;
}

module.exports = async (message, option = {}) => {
  try {
    // Playtime uses the game title, not an achievement label.
    if (message.notificationType === 'playtime' && message.gameDisplayName) {
      message.achievementDisplayName = message.gameDisplayName;
    }

    const options = {
      notify: option.notify != null ? option.notify : true,
      transport: {
        toast: option.transport.toast != null ? option.transport.toast : true,
        websocket: option.transport.websocket || false,
        overlay: option.transport.overlay || false,
      },
      toast: {
        appid: option.toast.appid,
        lang: option.lang || 'english',
        winrt: option.toast.winrt != null ? option.toast.winrt : true,
        balloonFallback: option.toast.balloonFallback || false,
        customAudio: option.toast.customAudio || '1',
        volume: option.toast.volume != null ? option.toast.volume : 100,
        imageIntegration: option.toast.imageIntegration || '0',
        group: option.toast.group || false,
        attribution: option.toast.attribution || null,
      },
      prefetch: option.prefetch != null ? option.prefetch : true,
      rumble: option.rumble != null ? option.rumble : true,
      souvenir: option.souvenir || null,
    };

    // Reuse the configured sound; playtime cards stay silent.
    const overlay = option.overlay || defaultOverlay || {};
    options.toast.soundFile = message.silent
      ? ''
      : overlay.randomSound === true
        ? notificationSound.pickRandomSound() || notificationSound.resolveSoundFile(overlay.notificationSound)
        : notificationSound.resolveSoundFile(overlay.notificationSound);

    if (options.notify) {
      if (options.transport.websocket) {
        debug.log('Websocket broadcast');

        let notification = {
          appID: message.appid,
          game: message.gameDisplayName,
          achievement: message.achievementName,
          displayName: message.achievementDisplayName,
          description: message.achievementDescription,
          rarityPercent: message.rarityPercent,
          icon: message.icon,
          time: message.time,
        };

        const progress = normalizeProgress(message.progress);
        if (progress) notification.progress = progress;

        broadcast(notification);
      }

      // Log when Windows will route the toast to the notification centre.
      if (options.transport.toast) {
        arePopupsSuppressed()
          .then((suppressed) => {
            if (suppressed) {
              debug.warn(
                'Windows is suppressing notification popups (full screen / presentation / quiet hours) — this toast went straight to the notification centre. ' +
                  'Turn off the automatic "do not disturb" rules in Windows notification settings, or use the in-game overlay transport.'
              );
            }
          })
          .catch((err) => debug.warn(`Could not read the user notification state: ${err.message || err}`));
      }

      // Spawn the styled overlay; the main process handles it when already running.
      if (options.transport.overlay) {
        debug.log('Overlay notification (spawn)');
        try {
          const watchdog = require('../watchdog.js');
          const progress = normalizeProgress(message.progress);
          const notificationType = message.notificationType || (progress ? 'progress' : 'achievement');
          const overlayArgs = [
            '--wintype=notification',
            `--appid=${message.appid || ''}`,
            `--notificationType=${notificationType}`,
            `--gameDisplayName=${message.gameDisplayName || ''}`,
            `--displayName=${message.achievementDisplayName || ''}`,
            `--description=${message.achievementDescription || ''}`,
            `--icon=${message.icon || ''}`,
          ];
          if (message.gameIcon) overlayArgs.push(`--gameIcon=${message.gameIcon}`);
          if (message.image) overlayArgs.push(`--image=${message.image}`);
          if (message.source) overlayArgs.push(`--source=${message.source}`);
          if (progress) {
            overlayArgs.push(`--progressCurrent=${progress.current}`);
            overlayArgs.push(`--progressMax=${progress.max}`);
            overlayArgs.push(`--progressPercent=${progress.percent}`);
          }
          if (message.rarityPercent != null && message.rarityPercent !== '' && Number.isFinite(Number(message.rarityPercent))) {
            overlayArgs.push(`--rarityPercent=${Number(message.rarityPercent)}`);
          }
          // Some notifications (e.g. playtime) must never play the overlay sound.
          if (message.silent) overlayArgs.push('--silent=1');
          watchdog.SpawnOverlayNotification(overlayArgs);
        } catch (err) {
          debug.error(err);
        }
      }

      // Souvenir screenshot — achievement unlocks only (never progress/playtime). Non-blocking; a short
      // delay lets the on-screen toast or overlay popup appear so it's included in the shot. Saved under
      // <dir>/<game>/<date> - <achievement>.png.
      if (options.souvenir && options.souvenir.screenshot && !message.silent && !message.progress) {
        setTimeout(() => {
          require('./souvenir.js')
            .capture({ game: message.gameDisplayName, achievement: message.achievementDisplayName, dir: options.souvenir.dir })
            .catch(() => {});
        }, 800);
      }

      if (options.prefetch) {
        debug.log(`Prefetching...`);
        if (message.icon) {
          message.icon = await fetch(message.icon, message.appid);
        }

        if (message.gameIcon) {
          message.gameIcon = await fetch(message.gameIcon, message.appid);
        }

        // The transport always gives playtime cards their game header as a hero image, even when
        // ordinary achievement images are disabled. Desktop AUMIDs cannot render remote artwork,
        // so cache it before Powertoast builds the Windows payload.
        if (
          options.transport.toast &&
          (message.notificationType === 'playtime' || options.toast.imageIntegration != '0') &&
          message.image
        ) {
          message.image = await fetch(message.image, message.appid);
        }
      }

      // The toast's app-logo slot is square. Steam library art is portrait/landscape, so center-
      // crop a high-res local copy for playtime cards; overlay/websocket keep the original art.
      // Only local sources are cropped — forcing a download when the user disabled prefetch would
      // add latency/offline failures for no benefit on the square requirement.
      if (options.transport.toast && message.notificationType === 'playtime') {
        const squareSource = message.gameIcon || message.image;
        const isLocal =
          typeof squareSource === 'string' &&
          (squareSource.startsWith('file:///') || (!/^https?:\/\//i.test(squareSource) && fs.existsSync(squareSource)));
        if (isLocal) {
          const square = await makeSquareIcon(squareSource, message.appid).catch(() => null);
          if (square) message.gameIcon = square;
        }
      }

      if (options.transport.toast) {
        debug.log('Toast notification');
        try {
          await toast(message, options);
        } catch (err) {
          debug.error(err);
          if (options.toast.balloonFallback) {
            debug.warn('Fallback to balloon-tooltip');
            try {
              const fallbackStrings = require('../util/notifyStrings.js').forLang(options.toast.lang || 'english');
              let notification = {
                title: message.achievementDisplayName,
                message: message.achievementDescription || fallbackStrings.achievementUnlocked || 'Achievement unlocked !', //description can not be empty for a balloon
                ico: path.resolve('./notification/icon/icon.ico'),
              };

              const progress = normalizeProgress(message.progress);
              if (progress) notification.message = `[ ${progress.current}/${progress.max} ]\n${message.achievementDescription}`;

              await balloon(notification);
            } catch (err) {
              debug.error(err);
            }
          }
        }
      } else {
        debug.log('Toast notification is disabled > SKIPPING');
      }

      if (options.rumble) {
        const xinput = await loadXinput();
        if (xinput) {
          if (!options.transport.toast) message.delay = 0;
          const regedit = await loadRegedit();
          let duration = 5;
          try {
            duration = +regedit.regQueryIntegerValue('HKCU', 'Control Panel/Accessibility', 'MessageDuration') || 5;
          } catch {}
          setTimeout(function () {
            debug.log('XInput Rumble');
            xinput.rumble({ forceStateWhileRumble: true }).catch((err) => {
              debug.warn(err);
            });
          }, duration * 1000 * message.delay || 0);
        }
      }
    }
  } catch (err) {
    debug.log(err);
  }
};

module.exports.setOverlayOptions = setOverlayOptions;
