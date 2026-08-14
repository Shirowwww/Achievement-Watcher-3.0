'use strict';

const path = require('path');
const ini = require('./util/ini');
const osLocale = require('./util/osLocale');
const fs = require('./util/fsAsync');
const steamLang = require('./steam.json');

// Complete partial options.ini sections before validating their values.
const REQUIRED_OBJECT_SECTIONS = [
  'general',
  'achievement',
  'overlay',
  'achievement_source',
  'notification',
  'notification_toast',
  'notification_transport',
  'notification_advanced',
  'souvenir',
  'controller',
  'action',
];

const CONTROLLER_BUTTONS = new Set([
  'BACK',
  'START',
  'GUIDE',
  'A',
  'B',
  'X',
  'Y',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
]);

const CONTROLLER_TOGGLE_ALLOWED = new Set([
  'BACK',
  'START',
  'GUIDE',
  'A',
  'B',
  'X',
  'Y',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
]);

const CONTROLLER_MODE_ALLOWED = new Set([
  'BACK',
  'START',
  'A',
  'B',
  'X',
  'Y',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
]);

function normalizeControllerBindingSetting(value, allowedButtons, fallback) {
  // An unknown/disallowed button anywhere rejects the whole binding (strict=false -> fallback), but
  // a repeated valid button is just deduplicated, not rejected — matching app/settings.js's
  // normalizeControllerBindingSetting() (backed by controllerLabels.normalizeControllerBinding()).
  // The two used to disagree here: the app would save "A+A" as the single-button binding "A", but
  // the watchdog would reject that same on-disk value and silently fall back to the hardcoded
  // default, so the setting shown as saved was not what the watchdog actually enforced.
  const seen = new Set();
  const out = [];
  let strict = true;
  for (const raw of String(value || '').split('+')) {
    const name = String(raw || '').trim().toUpperCase();
    if (!CONTROLLER_BUTTONS.has(name) || !allowedButtons.has(name)) {
      strict = false;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return strict && out.length >= 1 && out.length <= 3 ? out.join('+') : fallback;
}

function normalizeSectionObjects(options) {
  let changed = false;
  for (const section of REQUIRED_OBJECT_SECTIONS) {
    const value = options[section];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      options[section] = {};
      changed = true;
    }
  }
  return changed;
}

module.exports.load = async (cfg_file) => {
  let options = {};

  try {
    let fixFile = false;

    options = ini.parse(await fs.readFile(cfg_file, 'utf8'));
    if (normalizeSectionObjects(options)) fixFile = true;

    // A readable pre-onboarding config is an upgraded profile, not a new install.
    if (typeof options.general.onboardingCompleted !== 'boolean') {
      options.general.onboardingCompleted = true;
      fixFile = true;
    }

    if (!steamLang.some((lang) => lang.api == options.achievement.lang)) {
      try {
        let locale = await osLocale();
        locale = locale.replace('_', '-');

        let lang = steamLang.find((lang) => lang.iso == locale);
        if (!lang) {
          lang = steamLang.find((lang) => lang.webapi.startsWith(locale.slice(0, 2)));
        }

        options.achievement.lang = lang.api;
      } catch (err) {
        options.achievement.lang = 'english';
      }
      fixFile = true;
    }

    if (typeof options.achievement.thumbnailPortrait !== 'boolean') {
      options.achievement.thumbnailPortrait = false;
      fixFile = true;
    }

    if (typeof options.achievement.showHidden !== 'boolean') {
      options.achievement.showHidden = false;
      fixFile = true;
    }

    if (typeof options.achievement.mergeDuplicate !== 'boolean') {
      options.achievement.mergeDuplicate = true;
      fixFile = true;
    }

    if (typeof options.achievement.timeMergeRecentFirst !== 'boolean') {
      options.achievement.timeMergeRecentFirst = false;
      fixFile = true;
    }

    if (typeof options.achievement.hideZero !== 'boolean') {
      options.achievement.hideZero = false;
      fixFile = true;
    }

    // Apply overlay defaults used by hotkeys and notification sounds.
    if (typeof options.overlay.hotkey !== 'string' || !options.overlay.hotkey) {
      options.overlay.hotkey = 'Ctrl+Shift+K';
      fixFile = true;
    }
    if (typeof options.overlay.notificationSound !== 'string') {
      options.overlay.notificationSound = '';
      fixFile = true;
    }
    if (typeof options.overlay.randomSound !== 'boolean') {
      options.overlay.randomSound = false;
      fixFile = true;
    }
    if (!Number.isFinite(Number(options.overlay.notificationVolume))) {
      options.overlay.notificationVolume = 100;
      fixFile = true;
    } else {
      options.overlay.notificationVolume = Math.max(0, Math.min(200, Number(options.overlay.notificationVolume)));
    }

    // Source settings.

    if (options.achievement_source.legitSteam != 0 && options.achievement_source.legitSteam != 1 && options.achievement_source.legitSteam != 2) {
      options.achievement_source.legitSteam = 0;
      fixFile = true;
    }

    if (typeof options.achievement_source.steamEmu !== 'boolean') {
      options.achievement_source.steamEmu = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.socialClub !== 'boolean') {
      options.achievement_source.socialClub = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.greenLuma !== 'boolean') {
      options.achievement_source.greenLuma = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.rpcs3 !== 'boolean') {
      options.achievement_source.rpcs3 = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.shadps4 !== 'boolean') {
      options.achievement_source.shadps4 = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.xenia !== 'boolean') {
      options.achievement_source.xenia = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.lumaPlay !== 'boolean') {
      options.achievement_source.lumaPlay = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.gog !== 'boolean') {
      options.achievement_source.gog = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.gogOfficial !== 'boolean') {
      options.achievement_source.gogOfficial = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.ubisoftOfficial !== 'boolean') {
      options.achievement_source.ubisoftOfficial = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.epic !== 'boolean') {
      options.achievement_source.epic = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.epicOfficial !== 'boolean') {
      options.achievement_source.epicOfficial = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.ea !== 'boolean') {
      options.achievement_source.ea = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.xboxPc !== 'boolean') {
      options.achievement_source.xboxPc = true;
      fixFile = true;
    }

    if (typeof options.achievement_source.importCache !== 'boolean') {
      options.achievement_source.importCache = true;
      fixFile = true;
    }

    //Notification

    if (typeof options.notification.notify !== 'boolean') {
      options.notification.notify = true;
      fixFile = true;
    }

    if (typeof options.notification.rumble !== 'boolean') {
      options.notification.rumble = true;
      fixFile = true;
    }

    if (typeof options.notification.notifyOnProgress !== 'boolean') {
      options.notification.notifyOnProgress = true;
      fixFile = true;
    }

    if (typeof options.notification.playtime !== 'boolean') {
      options.notification.playtime = options.general.onboardingCompleted !== true;
      fixFile = true;
    }

    if (typeof options.notification.platinum !== 'boolean') {
      options.notification.platinum = true;
      fixFile = true;
    }

    //Toast

    if (
      options.notification_toast.customToastAudio != '0' &&
      options.notification_toast.customToastAudio != '1' &&
      options.notification_toast.customToastAudio != '2'
    ) {
      options.notification_toast.customToastAudio = '1';
      fixFile = true;
    }
    if (options.notification_toast.toastSouvenir != null) {
      delete options.notification_toast.toastSouvenir; // souvenir feature removed
      fixFile = true;
    }

    if (typeof options.notification_toast.groupToast !== 'boolean') {
      options.notification_toast.groupToast = false;
      fixFile = true;
    }

    if (typeof options.notification_toast.urgent !== 'boolean') {
      options.notification_toast.urgent = false;
      fixFile = true;
    }

    //Transport

    // Drop legacy display-transport flags from old configs. NOTE: `mode` is intentionally kept —
    // it is the (re-introduced) notification delivery mode (toast/overlay/both) and must persist
    // across restarts; it is validated/defaulted a few lines below. Deleting it here used to reset
    // the user's choice back to 'toast' on every watchdog settings load.
    if (
      options.notification_transport.chromium != null ||
      options.notification_transport.toast != null ||
      options.notification_transport.gntp != null
    ) {
      delete options.notification_transport.chromium;
      delete options.notification_transport.toast;
      delete options.notification_transport.gntp;
      fixFile = true;
    }

    if (typeof options.notification_transport.winRT !== 'boolean') {
      options.notification_transport.winRT = true;
      fixFile = true;
    }

    if (typeof options.notification_transport.balloon !== 'boolean') {
      options.notification_transport.balloon = true;
      fixFile = true;
    }

    if (typeof options.notification_transport.websocket !== 'boolean') {
      options.notification_transport.websocket = true;
      fixFile = true;
    }

    // 'auto' lets notification/transportPolicy.js pick the overlay or a Windows notification per
    // event from what it can observe; the other three are the user pinning one behaviour.
    if (!['auto', 'toast', 'overlay', 'both'].includes(options.notification_transport.mode)) {
      options.notification_transport.mode = 'auto';
      fixFile = true;
    }
    if (options.notification_transport.overlay !== undefined) {
      delete options.notification_transport.overlay;
      fixFile = true;
    }

    //Advanced

    if (isNaN(options.notification_advanced.timeTreshold)) {
      options.notification_advanced.timeTreshold = 10;
      fixFile = true;
    }

    if (isNaN(options.notification_advanced.tick)) {
      options.notification_advanced.tick = 600;
      fixFile = true;
    }

    if (typeof options.notification_advanced.checkIfProcessIsRunning !== 'boolean') {
      options.notification_advanced.checkIfProcessIsRunning = true;
      fixFile = true;
    }

    if (typeof options.notification_advanced.iconPrefetch !== 'boolean') {
      options.notification_advanced.iconPrefetch = true;
      fixFile = true;
    }

    //Souvenir — drop the stale flat keys (OBS video stays removed); keep the simple screenshot section.
    if (options.souvenir_screenshot != null || options.souvenir_video != null) {
      delete options.souvenir_screenshot;
      delete options.souvenir_video;
      fixFile = true;
    }
    if (typeof options.souvenir.screenshot !== 'boolean') {
      options.souvenir.screenshot = false;
      fixFile = true;
    }
    if (typeof options.souvenir.dir !== 'string') {
      options.souvenir.dir = '';
      fixFile = true;
    }
    if ('combineNotif' in options.souvenir) {
      delete options.souvenir.combineNotif; // simplified: capture always includes whatever is on screen
      fixFile = true;
    }

    //Controller (native → overlay control, Tier 4). Opt-in; the koffi/HID stack loads only when enabled.
    // Bindings are stored as "BUTTON+BUTTON+BUTTON" strings (one to three buttons).
    if (typeof options.controller.enabled !== 'boolean') {
      options.controller.enabled = false;
      fixFile = true;
    }
    if (typeof options.controller.appNavigation !== 'boolean') {
      options.controller.appNavigation = true;
      fixFile = true;
    }
    if (!['auto', 'xinput', 'gameinput'].includes(options.controller.backend)) {
      options.controller.backend = 'auto';
      fixFile = true;
    }
    if (!['auto', 'xbox', 'playstation', 'switch'].includes(options.controller.layout)) {
      options.controller.layout = 'auto';
      fixFile = true;
    }
    const toggleBinding = normalizeControllerBindingSetting(
      options.controller.toggleBinding,
      CONTROLLER_TOGGLE_ALLOWED,
      'BACK+START+LEFT_SHOULDER'
    );
    if (toggleBinding !== options.controller.toggleBinding) {
      options.controller.toggleBinding = toggleBinding;
      fixFile = true;
    }
    const uiModeBinding = normalizeControllerBindingSetting(
      options.controller.uiModeBinding,
      CONTROLLER_MODE_ALLOWED,
      'LEFT_SHOULDER+X'
    );
    if (uiModeBinding !== options.controller.uiModeBinding) {
      options.controller.uiModeBinding = uiModeBinding;
      fixFile = true;
    }
    const controlModeBinding = normalizeControllerBindingSetting(
      options.controller.controlModeBinding,
      CONTROLLER_MODE_ALLOWED,
      'LEFT_SHOULDER+RIGHT_SHOULDER'
    );
    if (controlModeBinding !== options.controller.controlModeBinding) {
      options.controller.controlModeBinding = controlModeBinding;
      fixFile = true;
    }
    if ('windowModeBinding' in options.controller) {
      delete options.controller.windowModeBinding;
      fixFile = true;
    }
    if (typeof options.controller.focusOverlay !== 'boolean') {
      options.controller.focusOverlay = false;
      fixFile = true;
    }
    if (typeof options.controller.sendEscapeOnControllerOpen !== 'boolean') {
      options.controller.sendEscapeOnControllerOpen = false;
      fixFile = true;
    }
    if (typeof options.controller.debugLogging !== 'boolean') {
      options.controller.debugLogging = false;
      fixFile = true;
    }

    //Action
    if (typeof options.action.target !== 'string') {
      options.action.target = '';
      fixFile = true;
    }

    if (typeof options.action.cwd !== 'string') {
      options.action.cwd = '';
      fixFile = true;
    }

    if (typeof options.action.hide !== 'boolean') {
      options.action.hide = true;
      fixFile = true;
    }

    if (!options.steam || typeof options.steam !== 'object' || Array.isArray(options.steam)) options.steam = {};
    if (Object.prototype.hasOwnProperty.call(options.steam, 'apiKey')) {
      delete options.steam.apiKey;
      fixFile = true;
    }

    if (fixFile) await fs.writeFile(cfg_file, ini.stringify(options), 'utf8').catch(() => {});
  } catch (err) {
    options = {
      achievement: {
        thumbnailPortrait: false,
        showHidden: false,
        mergeDuplicate: true,
        timeMergeRecentFirst: false,
        hideZero: false,
      },
      overlay: {
        hotkey: 'Ctrl+Shift+K',
        notificationSound: '',
        randomSound: false,
        notificationVolume: 100,
      },
      achievement_source: {
        legitSteam: 0,
        steamEmu: true,
        socialClub: true,
        greenLuma: true,
        rpcs3: true,
        shadps4: true,
        xenia: true,
        lumaPlay: true,
        gog: true,
        gogOfficial: true,
        ubisoftOfficial: true,
        epic: true,
        epicOfficial: true,
        ea: true,
        xboxPc: true,
        importCache: true,
      },
      notification: {
        notify: true,
        rumble: true,
        notifyOnProgress: true,
        playtime: true,
        platinum: true,
      },
      notification_toast: {
        customToastAudio: '1',
        groupToast: false,
        urgent: false,
      },
      notification_transport: {
        winRT: true,
        balloon: true,
        websocket: true,
        mode: 'auto',
      },
      notification_advanced: {
        timeTreshold: 10,
        tick: 600,
        checkIfProcessIsRunning: true,
        iconPrefetch: true,
      },
      souvenir: {
        screenshot: false,
        dir: '',
      },
      controller: {
        enabled: false,
        appNavigation: true,
        backend: 'auto',
        layout: 'auto',
        toggleBinding: 'BACK+START+LEFT_SHOULDER',
        uiModeBinding: 'LEFT_SHOULDER+X',
        controlModeBinding: 'LEFT_SHOULDER+RIGHT_SHOULDER',
        focusOverlay: false,
        sendEscapeOnControllerOpen: false,
        debugLogging: false,
      },
      action: {
        target: '',
        cwd: '',
        hide: true,
      },
      steam: {},
    };

    try {
      let locale = await osLocale();
      locale = locale.replace('_', '-');

      let lang = steamLang.find((lang) => lang.iso == locale);
      if (!lang) {
        lang = steamLang.find((lang) => lang.webapi.startsWith(locale.slice(0, 2)));
      }

      options.achievement.lang = lang.api;
    } catch (err) {
      options.achievement.lang = 'english';
    }

    await fs.writeFile(cfg_file, ini.stringify(options), 'utf8').catch(() => {});
  }

  return options;
};
