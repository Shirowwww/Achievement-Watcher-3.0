'use strict';

const path = require('path');
const ini = require('./util/ini');
const osLocale = require('./util/osLocale');
const fs = require('./util/fsAsync');
const steamLang = require('./steam.json');
const aes = require('./util/aes.js');

module.exports.load = async (cfg_file) => {
  let options = {};

  try {
    let fixFile = false;

    options = ini.parse(await fs.readFile(cfg_file, 'utf8'));

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

    //Source

    if (options.achievement_source.legitSteam != 0 && options.achievement_source.legitSteam != 1 && options.achievement_source.legitSteam != 2) {
      options.achievement_source.legitSteam = 0;
      fixFile = true;
    }

    if (typeof options.achievement_source.steamEmu !== 'boolean') {
      options.achievement_source.steamEmu = true;
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

    if (typeof options.achievement_source.ea !== 'boolean') {
      options.achievement_source.ea = true;
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
      options.notification.playtime = false;
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

    if (!['toast', 'overlay', 'both'].includes(options.notification_transport.mode)) {
      options.notification_transport.mode = 'toast';
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
    if (!options.souvenir || typeof options.souvenir !== 'object') options.souvenir = {};
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

    //Steam Key

    let steamKey;
    if (options.steam) {
      if (options.steam.apiKey) {
        if (options.steam.apiKey.includes(':')) {
          steamKey = aes.decrypt(options.steam.apiKey);
        } else {
          fixFile = true;
        }
      }
    } else {
      options.steam = {};
    }

    if (fixFile) await fs.writeFile(cfg_file, ini.stringify(options), 'utf8').catch(() => {});

    if (steamKey) options.steam.apiKey = steamKey;
  } catch (err) {
    options = {
      achievement: {
        thumbnailPortrait: false,
        showHidden: false,
        mergeDuplicate: true,
        timeMergeRecentFirst: false,
        hideZero: false,
      },
      achievement_source: {
        legitSteam: 0,
        steamEmu: true,
        greenLuma: true,
        rpcs3: true,
        lumaPlay: false,
        gog: true,
        gogOfficial: true,
        ubisoftOfficial: true,
        epic: true,
        ea: true,
        importCache: true,
      },
      notification: {
        notify: true,
        rumble: true,
        notifyOnProgress: true,
        playtime: false,
        platinum: true,
      },
      notification_toast: {
        customToastAudio: '1',
        groupToast: false,
      },
      notification_transport: {
        winRT: true,
        balloon: true,
        websocket: true,
        mode: 'toast',
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
