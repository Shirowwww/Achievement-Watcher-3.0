'use strict';

const path = require('path');
const fs = require('fs');
const toast = require('./transport/toast.js');
const balloon = require('../util/powerballoon');
const fetch = require('./prefetch.js');
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

// regodit & xinput-ffi are ESM-only (koffi) since their v2+ majors; load them lazily via dynamic
// import (cached by Node's module registry) so this CommonJS module graph stays intact. regodit's
// async API moved to the `regodit/promises` subpath and its functions were renamed PascalCase ->
// camelCase. Controller rumble stays best-effort: a load failure (no XInput runtime, headless
// session, etc.) must never take down the toast path, so we swallow it and disable rumble.
let regeditPromise = null;
const loadRegedit = () => regeditPromise || (regeditPromise = import('regodit/promises'));

let xinputPromise = null;
const loadXinput = () =>
  xinputPromise ||
  (xinputPromise = import('xinput-ffi').catch((err) => {
    debug.warn(`[rumble] xinput-ffi unavailable, rumble disabled: ${err.message || err}`);
    return null;
  }));

// Overlay sound settings (Son / Son aléatoire / Volume) shared by every notify() caller. The
// watchdog sets this once options.ini is loaded (and on each settings reload), so console
// watchers don't each have to forward the overlay block.
let defaultOverlay = null;
function setOverlayOptions(overlay) {
  defaultOverlay = overlay || null;
}

module.exports = async (message, option = {}) => {
  try {
    // A playtime card is about the game, not an unlocked achievement. Force its title from the
    // dedicated game field so no generic/localized achievement label can leak into this toast.
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
        cropIcon: option.toast.cropIcon || false,
        attribution: option.toast.attribution || null,
      },
      prefetch: option.prefetch != null ? option.prefetch : true,
      rumble: option.rumble != null ? option.rumble : true,
      souvenir: option.souvenir || null,
    };

    // Windows toasts use the same sound the user configured for overlay notifications: the
    // picked file (or a fresh random pick when enabled), played at the configured volume.
    // Playtime cards stay silent, matching the overlay. When no sound is configured, the
    // toast keeps its native Windows sound behavior.
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

      // Windows accepts a toast while a game is in full screen (or presentation mode, or quiet
      // hours) but never pops it on screen — it goes straight to the notification centre, which is
      // why achievement toasts looked lost in-game while playtime toasts, fired after the game
      // exited, always showed up (issue #18). Nothing here can override that OS policy, so this
      // only records WHY a toast was invisible; the state query runs detached so it never delays
      // the notification itself.
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

      // Overlay transport: spawn the styled in-game overlay notification ourselves so it shows even
      // when the main app is closed (Watchdog runs in the background). The spawned `--wintype=notification`
      // process reads the user's overlay preset/position/scale/sound from options.ini and renders on top
      // of the game; if the main app is already open, the single-instance lock forwards the args to it
      // instead (no duplicate). Done before prefetch so the icon stays a URL — the app resolves it from
      // the same on-disk cache the Watchdog prefetches into.
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

        if (options.transport.toast && options.toast.imageIntegration != '0' && message.image) {
          message.image = await fetch(message.image, message.appid);
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
          const duration =
            +(await regedit.regQueryIntegerValue('HKCU', 'Control Panel/Accessibility', 'MessageDuration').catch(() => {
              return null;
            })) || 5;
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
