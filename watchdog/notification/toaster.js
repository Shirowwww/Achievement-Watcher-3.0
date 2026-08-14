'use strict';

const path = require('path');
const fs = require('fs');
const toast = require('./transport/toast.js');
const balloon = require('../util/powerballoon');
const fetch = require('./prefetch.js');
const { makeSquareIcon } = require('../util/squareIcon.js');
const notificationSound = require('../util/notificationSound.js');
const { broadcast } = require('../websocket.js');
const { arePopupsSuppressed, isOverlayLikelyHidden } = require('../queryUserNotificationState.js');
const transportPolicy = require('./transportPolicy.js');
const transportMemory = require('../util/transportMemory.js');
const overlayAck = require('./overlayAck.js');

const debug = require('../util/log.js');

// A render outcome reported after the fact is what keeps Automatic honest: the popup either loaded
// or it did not, and the next notification is planned from that instead of from a send call that
// returned. A failure parks Automatic on toasts for the cooldown, a success clears it immediately.
overlayAck.onResult(({ ok, stage, reason }) => {
  if (stage !== 'accepted' && stage !== 'rendered') return;
  if (ok) {
    transportPolicy.recordOverlaySuccess();
    return;
  }
  debug.warn(`[notify] the overlay could not show this notification (${stage}: ${reason || 'no reason given'}) — falling back to Windows notifications`);
  transportPolicy.recordOverlayFailure();
});

// 'ipc' means the resident app renders the popup and reports the outcome; anything else is a
// detached spawn whose result this process cannot observe.
function resolveOverlayHost() {
  return typeof process.send === 'function' && process.connected ? 'ipc' : 'spawn';
}

// Only Automatic pays for the live signals: the forced modes do not act on them.
async function collectSignals(mode, appid) {
  const signals = { overlayHost: resolveOverlayHost(), overlayHidden: null, remembered: null };
  if (mode !== 'auto' || signals.overlayHost !== 'ipc') return signals;
  signals.overlayHidden = await isOverlayLikelyHidden().catch(() => null);
  signals.remembered = transportMemory.forGame(appid);
  return signals;
}

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

    // One decision per notification, taken here and nowhere else. Every caller passes the configured
    // mode; which transports run, and whether a fallback is even permitted, is settled before a
    // single byte is sent, so no later step can add a second notification for the same event.
    const mode = transportPolicy.normalizeMode(option.transport && option.transport.mode);
    const signals = await collectSignals(mode, message.appid);
    const plan = transportPolicy.planDelivery({
      mode,
      websocket: option.transport && option.transport.websocket,
      signals,
    });
    // A toast may still have to be built after the overlay reports a definite failure, so everything
    // its payload needs is prepared whenever one is possible — not only when one is planned.
    const toastPossible = plan.toast || plan.fallbackToToast;

    const options = {
      notify: option.notify != null ? option.notify : true,
      transport: plan,
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
      if (plan.websocket) {
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

      // Spawn the styled overlay; the main process handles it when already running.
      let overlayAckId = null;
      if (plan.overlay) {
        debug.log(`Overlay notification (spawn) — ${plan.reason}`);
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
          // Ask for an acknowledgement only when one can come back (the app renders it over IPC) and
          // only when this notification is allowed a fallback — an untracked id would otherwise sit
          // in the registry until its TTL for no purpose.
          if (signals.overlayHost === 'ipc' && plan.fallbackToToast) {
            overlayAckId = overlayAck.nextId();
            overlayAck.track(overlayAckId, { appid: message.appid });
            overlayArgs.push(`--notifyId=${overlayAckId}`);
          }
          watchdog.SpawnOverlayNotification(overlayArgs);
        } catch (err) {
          debug.error(err);
          // The request never left this process, so the overlay definitely showed nothing.
          if (overlayAckId) overlayAck.report(overlayAckId, { stage: 'accepted', ok: false, reason: 'spawn-failed' });
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
          toastPossible &&
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
      if (toastPossible && message.notificationType === 'playtime') {
        const squareSource = message.gameIcon || message.image;
        const isLocal =
          typeof squareSource === 'string' &&
          (squareSource.startsWith('file:///') || (!/^https?:\/\//i.test(squareSource) && fs.existsSync(squareSource)));
        if (isLocal) {
          const square = await makeSquareIcon(squareSource, message.appid).catch(() => null);
          if (square) message.gameIcon = square;
        }
      }

      /*
        The fallback decision, made once, in the only place that knows whether a notification has
        already gone out. `overlayAckId` exists only when a fallback was authorized at planning time,
        so this can add a toast to an overlay that reported failure but can never add one beside an
        overlay that worked, and never beside a toast that was already planned.

        A missing answer is deliberately NOT a fallback: it means this process cannot tell whether a
        popup appeared, and showing a second notification on a guess is exactly the duplicate the
        user would see. It is recorded against the overlay so the NEXT notification changes transport.
      */
      let deliverToast = plan.toast;
      // An overlay this process cannot get a report about (no IPC channel) is recorded as such
      // rather than as a success it has no way of knowing about.
      let outcome = plan.overlay && !plan.toast && !overlayAckId ? 'unknown' : 'delivered';
      if (!deliverToast && overlayAckId) {
        const ack = await overlayAck.wait(overlayAckId);
        if (ack === overlayAck.RESULT.REJECTED) {
          debug.warn('Overlay reported it could not display this notification > falling back to a Windows notification');
          deliverToast = true;
          outcome = 'fallback';
        } else if (ack === overlayAck.RESULT.UNKNOWN) {
          debug.warn('No overlay delivery report — not duplicating this notification; the next one will use Windows notifications');
          outcome = 'unknown';
          transportPolicy.recordOverlayFailure();
        }
      }

      if (deliverToast) {
        debug.log('Toast notification');
        try {
          await toast(message, options);
        } catch (err) {
          debug.error(err);
          outcome = 'failed';
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
              // A tray balloon is a degraded notification, not a lost one.
              outcome = 'fallback';
            } catch (err) {
              debug.error(err);
            }
          }
        }

        // Windows quietly files a toast in the notification centre while a game or Do Not Disturb is
        // on screen. Say so, since from the user's side that is indistinguishable from a lost one.
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

      // What actually delivered, for this game. Playtime fires as the game closes, when nothing is
      // covering the screen any more, so it would teach the wrong lesson about in-game delivery.
      if (message.notificationType !== 'playtime') {
        transportMemory.remember(message.appid, {
          transport: plan.overlay && plan.toast ? 'both' : deliverToast ? 'toast' : 'overlay',
          reason: plan.reason,
          outcome,
        });
      }

      if (options.rumble) {
        const xinput = await loadXinput();
        if (xinput) {
          if (!deliverToast) message.delay = 0;
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
