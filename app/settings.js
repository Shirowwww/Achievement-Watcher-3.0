'use strict';

const appPath = __dirname;
const path = require('path');
const ini = require('@xan105/ini');
const fs = require('fs');
const os = require('os');
const aes = require(path.join(appPath, 'util/aes.js'));
const steamLanguages = require(path.join(appPath, 'locale/steam.json'));

let filename;
module.exports.setUserDataPath = (p) => {
  if (p) filename = path.join(p, 'cfg/options.ini');
};

module.exports.load = () => {
  let options;
  console.log('Loading settings');
  try {
    options = ini.parse(fs.readFileSync(filename, 'utf8'));

    if (!steamLanguages.some((lang) => lang.api == options.achievement.lang)) {
      try {
        let locale = navigator.language || navigator.userLanguage || 'en';
        options.achievement.lang = steamLanguages.find((lang) => lang.webapi == locale).api;
      } catch (err) {
        options.achievement.lang = 'english';
      }
    }

    if (typeof options.username !== 'string' && typeof options.general.username !== 'string') {
      options.general.username = options.username || options.general.username || os.userInfo().username || 'User';
    }

    if (typeof options.general.skippedVersion !== 'string') {
      options.general.skippedVersion = 'none';
    }

    if (typeof options.general.onboardingCompleted !== 'boolean') {
      options.general.onboardingCompleted = false;
    }
    if (typeof options.general.startWithWindows !== 'boolean') {
      options.general.startWithWindows = true;
    }
    if (typeof options.general.disableHardwareAccel !== 'boolean') {
      options.general.disableHardwareAccel = false;
    }

    // overlay = the in-game achievement overlay (Ctrl+Shift+O). Notifications are Windows toasts
    // now, so the old per-notification look settings (position/preset/scale/duration) are gone.
    if (typeof options.overlay.hotkey !== 'string') {
      options.overlay.hotkey = 'Ctrl+Shift+O';
    }
    // Overlay (in-game) notification look — re-introduced as an OPTIONAL transport (toasts stay default).
    if (typeof options.overlay.notificationPreset !== 'string') {
      options.overlay.notificationPreset = 'Default';
    }
    if (options.overlay.notificationPreset === 'Raposo') {
      options.overlay.notificationPreset = 'Shirow';
    }
    if (typeof options.overlay.notificationPosition !== 'string') {
      options.overlay.notificationPosition = 'center-bottom';
    }
    // INI values come back as strings (@xan105/ini only type-coerces booleans), so numbers must be
    // parsed with Number() before validating — a typeof 'number' check would otherwise reset a valid
    // persisted value to its default on every reload.
    {
      const scl = Number(options.overlay.notificationScale);
      options.overlay.notificationScale = Number.isFinite(scl) && scl > 0 ? scl : 1;
    }
    if (typeof options.overlay.notificationSound !== 'string') {
      options.overlay.notificationSound = '';
    }
    // Overlay-notification sound volume (percent, 0–200). Toast sound is system-controlled and unaffected.
    {
      const vol = Number(options.overlay.notificationVolume);
      options.overlay.notificationVolume = Number.isFinite(vol) && vol >= 0 ? vol : 100;
    }
    // Overlay-notification on-screen duration: 'auto' (preset self-closes) or a number of seconds (force-close cap).
    {
      const dur = Number(options.overlay.notificationDuration);
      options.overlay.notificationDuration = Number.isFinite(dur) && dur > 0 ? dur : 'auto';
    }
    delete options.overlay.position;
    delete options.overlay.progressPosition;
    delete options.overlay.playtimePosition;
    delete options.overlay.preset;
    delete options.overlay.scale;
    delete options.overlay.duration;

    if (typeof options.achievement.thumbnailPortrait !== 'boolean') {
      options.achievement.thumbnailPortrait = false;
    }

    if (typeof options.achievement.showHidden !== 'boolean') {
      options.achievement.showHidden = false;
    }

    if (typeof options.achievement.mergeDuplicate !== 'boolean') {
      options.achievement.mergeDuplicate = true;
    }

    if (typeof options.achievement.timeMergeRecentFirst !== 'boolean') {
      options.achievement.timeMergeRecentFirst = false;
    }

    if (typeof options.achievement.hideZero !== 'boolean') {
      options.achievement.hideZero = false;
    }

    if (typeof options.achievement.goldbergDownloadIcons !== 'boolean') {
      options.achievement.goldbergDownloadIcons = false;
    }

    //Source

    if (options.achievement_source.legitSteam != 0 && options.achievement_source.legitSteam != 1 && options.achievement_source.legitSteam != 2) {
      options.achievement_source.legitSteam = 0;
    }

    if (typeof options.achievement_source.steamEmu !== 'boolean') {
      options.achievement_source.steamEmu = true;
    }

    if (typeof options.achievement_source.greenLuma !== 'boolean') {
      options.achievement_source.greenLuma = true;
    }

    if (typeof options.achievement_source.rpcs3 !== 'boolean') {
      options.achievement_source.rpcs3 = true;
    }

    if (typeof options.achievement_source.shadps4 !== 'boolean') {
      options.achievement_source.shadps4 = true;
    }

    if (typeof options.achievement_source.xenia !== 'boolean') {
      options.achievement_source.xenia = true;
    }

    if (typeof options.achievement_source.lumaPlay !== 'boolean') {
      options.achievement_source.lumaPlay = true;
    }

    if (typeof options.achievement_source.gog !== 'boolean') {
      options.achievement_source.gog = true;
    }

    if (typeof options.achievement_source.epic !== 'boolean') {
      options.achievement_source.epic = true;
    }

    if (typeof options.achievement_source.ea !== 'boolean') {
      options.achievement_source.ea = true;
    }

    if (typeof options.achievement_source.importCache !== 'boolean') {
      options.achievement_source.importCache = true;
    }

    //Emulator (GBE Fork setup) — new section, may be absent in older configs.
    if (!options.emulator || typeof options.emulator !== 'object') options.emulator = {};
    if (typeof options.emulator.autoApplyNewGames !== 'boolean') {
      // Migrate the short-lived General-tab key; installs without either key default to OFF — the
      // automatic full setup (DLL swap) is opt-in, so AW never touches game files unprompted.
      options.emulator.autoApplyNewGames =
        typeof options.achievement.autoApplyNewGames === 'boolean' ? options.achievement.autoApplyNewGames : false;
    }
    // ColdClient was removed: AW always applies the emulator standalone (DLL swap). Normalize any
    // stale stored 'coldclient' value back to the single supported mode.
    options.emulator.mode = 'regular';
    if (typeof options.emulator.steamlessAutoUnpack !== 'boolean') options.emulator.steamlessAutoUnpack = false;
    if (typeof options.emulator.steamlessExperimental !== 'boolean') options.emulator.steamlessExperimental = false;
    if (typeof options.emulator.autoApplyCrackFix !== 'boolean') options.emulator.autoApplyCrackFix = false;
    if (options.emulator.steamSettingsMode !== 'simple' && options.emulator.steamSettingsMode !== 'advanced') options.emulator.steamSettingsMode = 'simple';
    if (typeof options.emulator.createLaunchBat !== 'boolean') options.emulator.createLaunchBat = true;
    if (typeof options.emulator.apiCheckBypass !== 'boolean') options.emulator.apiCheckBypass = false;
    if (typeof options.emulator.checkUpdates !== 'boolean') options.emulator.checkUpdates = true;
    if (options.emulator.login !== 'anonymous' && options.emulator.login !== 'steam') options.emulator.login = 'anonymous';
    if (typeof options.emulator.loginAccountName !== 'string') options.emulator.loginAccountName = '';
    if (typeof options.emulator.loginPassword !== 'string') options.emulator.loginPassword = '';
    if (typeof options.emulator.steamId !== 'string') options.emulator.steamId = '';

    //Notification

    if (typeof options.notification.notify !== 'boolean') {
      options.notification.notify = true;
    }

    if (typeof options.notification.rumble !== 'boolean') {
      options.notification.rumble = true;
    }

    if (typeof options.notification.notifyOnProgress !== 'boolean') {
      options.notification.notifyOnProgress = true;
    }

    if (typeof options.notification.playtime !== 'boolean') {
      options.notification.playtime = false;
    }

    if (typeof options.notification.platinum !== 'boolean') {
      options.notification.platinum = true;
    }

    //Toast

    if (
      options.notification_toast.customToastAudio != '0' &&
      options.notification_toast.customToastAudio != '1' &&
      options.notification_toast.customToastAudio != '2'
    ) {
      options.notification_toast.customToastAudio = '1';
    }
    delete options.notification_toast.toastSouvenir; // souvenir feature removed

    if (typeof options.notification_toast.groupToast !== 'boolean') {
      options.notification_toast.groupToast = false;
    }

    //Transport

    // Drop legacy display-transport flags so the file stays clean. NOTE: `mode` is intentionally
    // NOT dropped here — it is the (re-introduced) notification delivery mode and must persist
    // across restarts; it is validated/defaulted a few lines below.
    delete options.notification_transport.chromium;
    delete options.notification_transport.toast;
    delete options.notification_transport.gntp;

    // WinRT (faster native toast) and balloon (toast fallback) are internal auto-details of the
    // toast path — not surfaced in the UI but still honored by the toaster.
    if (typeof options.notification_transport.winRT !== 'boolean') {
      options.notification_transport.winRT = true;
    }

    if (typeof options.notification_transport.balloon !== 'boolean') {
      options.notification_transport.balloon = true;
    }

    // Websocket broadcast to external clients — independent of the chosen display mode.
    if (typeof options.notification_transport.websocket !== 'boolean') {
      options.notification_transport.websocket = true;
    }

    // Notification delivery mode: 'toast' (Windows toast), 'overlay' (in-game HTML/CSS preset), or 'both'.
    if (!['toast', 'overlay', 'both'].includes(options.notification_transport.mode)) {
      options.notification_transport.mode = 'toast';
    }
    delete options.notification_transport.overlay;

    //Advanced

    if (isNaN(options.notification_advanced.timeTreshold)) {
      options.notification_advanced.timeTreshold = 10;
    }

    if (isNaN(options.notification_advanced.tick)) {
      options.notification_advanced.tick = 600;
    }

    if (typeof options.notification_advanced.checkIfProcessIsRunning !== 'boolean') {
      options.notification_advanced.checkIfProcessIsRunning = true;
    }

    if (typeof options.notification_advanced.iconPrefetch !== 'boolean') {
      options.notification_advanced.iconPrefetch = true;
    }

    if (typeof options.steam.main !== 'string') {
      options.steam.main = '0';
    }

    //Souvenir — drop the stale flat keys (OBS video stays removed); keep the simple screenshot section.
    delete options.souvenir_screenshot;
    delete options.souvenir_video;
    if (!options.souvenir || typeof options.souvenir !== 'object') options.souvenir = {};
    if (typeof options.souvenir.screenshot !== 'boolean') options.souvenir.screenshot = false;
    if (typeof options.souvenir.dir !== 'string') options.souvenir.dir = '';
    delete options.souvenir.combineNotif; // simplified: capture always includes whatever is on screen

    //Action
    if (typeof options.action.target !== 'string') {
      options.action.target = '';
    }

    if (typeof options.action.cwd !== 'string') {
      options.action.cwd = '';
    }

    if (typeof options.action.hide !== 'boolean') {
      options.action.hide = true;
    }

    // Emulator Steam-login password — AES-encrypted on disk like the Steam Web API key.
    if (options.emulator && typeof options.emulator.loginPassword === 'string' && options.emulator.loginPassword.includes(':')) {
      try {
        options.emulator.loginPassword = aes.decrypt(options.emulator.loginPassword);
      } catch {
        options.emulator.loginPassword = '';
      }
    }

    //Steam Key

    if (options.steam) {
      if (options.steam.apiKey) {
        if (options.steam.apiKey.includes(':')) {
          options.steam.apiKey = aes.decrypt(options.steam.apiKey);
        }
      }
    } else {
      options.steam = {};
    }
  } catch (err) {
    console.log(`failed to load settings: ${err}`);
    options = {
      general: {
        username: os.userInfo().username || 'User',
        skippedVersion: 'none',
        onboardingCompleted: false,
        startWithWindows: true,
        disableHardwareAccel: false,
      },
      overlay: {
        hotkey: 'Ctrl+Shift+O',
        notificationPreset: 'Default',
        notificationPosition: 'center-bottom',
        notificationScale: 1,
        notificationSound: '',
        notificationVolume: 100,
        notificationDuration: 'auto',
      },
      achievement: {
        thumbnailPortrait: false,
        showHidden: false,
        mergeDuplicate: true,
        timeMergeRecentFirst: false,
        hideZero: false,
        goldbergDownloadIcons: false,
      },
      achievement_source: {
        legitSteam: 0,
        steamEmu: true,
        greenLuma: true,
        rpcs3: true,
        shadps4: true,
        xenia: true,
        lumaPlay: false,
        gog: true,
        epic: true,
        ea: true,
        importCache: true,
      },
      emulator: {
        autoApplyNewGames: false, // opt-in: one-shot full setup for newly detected unconfigured emulated games (off = never touch game files unprompted)
        mode: 'regular', // standalone DLL swap — the only mode (ColdClient was removed)
        steamlessAutoUnpack: false, // run Steamless on the game exe before patching
        steamlessExperimental: false, // pass --realign for heavily-protected exes
        autoApplyCrackFix: false, // opt-in: try a confident CrakFiles community-crack match (confident name only, backed-up, idempotent) — off by default since it downloads/overwrites game files
        steamSettingsMode: 'simple', // 'simple' (AW fetch: DLC + achievements) | 'advanced' (generate_emu_config: + depots/languages)
        createLaunchBat: true, // legacy, unused (ColdClient removed) — kept so saved configs round-trip
        apiCheckBypass: false, // opt-in: drop SteamAutoCrack's Steam API ownership-check bypass proxy (winmm.dll) for games that re-check the original DLL/exe after the swap
        checkUpdates: true, // force a same-day GBE Fork release re-check before applying
        login: 'anonymous', // 'anonymous' | 'steam' (generate_emu_config richer data — throwaway account!)
        loginAccountName: '', // optional Steam login username (throwaway account)
        loginPassword: '', // optional Steam login password — AES-encrypted on disk (like steam.apiKey)
        steamId: '', // optional account_steamid override for configs.user.ini ('' = let GBE pick)
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
      steam: { main: '0' },
    };

    try {
      let locale = navigator.language || navigator.userLanguage || 'en';
      options.achievement.lang = steamLanguages.find((lang) => lang.webapi == locale).api;
    } catch (err) {
      options.achievement.lang = 'english';
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, ini.stringify(options), 'utf8');
  }

  return options;
};

module.exports.save = (config) => {
  return new Promise((resolve, reject) => {
    let options;
    try {
      options = JSON.parse(JSON.stringify(config)); //deep object copy to prevent modifying reference; We want to encrypt key to file but keep it decrypted in memory.

      // Encrypt the emulator Steam-login password before it touches disk (kept plaintext in memory).
      if (options.emulator && typeof options.emulator.loginPassword === 'string' && options.emulator.loginPassword.length > 0) {
        options.emulator.loginPassword = aes.encrypt(config.emulator.loginPassword);
      }

      if (!options.steam) options.steam = {};
      if (typeof options.steam.apiKey === 'string' && options.steam.apiKey.length > 0) {
        // A key was provided -> store it encrypted.
        options.steam.apiKey = aes.encrypt(config.steam.apiKey);
      } else if (options.steam.apiKey === '') {
        // Explicit clear (empty string) -> drop it from the saved file.
        delete options.steam.apiKey;
      } else {
        // Key not provided by this (possibly partial) save -> preserve whatever is already on disk.
        // This prevents a background/partial settings write from silently wiping the user's API key
        // (which then degrades the whole app to slow/unreliable scraping with no indication why).
        try {
          const existing = ini.parse(fs.readFileSync(filename, 'utf8'));
          if (existing && existing.steam && existing.steam.apiKey) options.steam.apiKey = existing.steam.apiKey;
        } catch {}
      }
    } catch (err) {
      return reject(err);
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, ini.stringify(options), 'utf8');
    // Tell the main process to reload its cached config. The daemon loads options.ini once at startup
    // and otherwise keeps the in-memory copy, so a Steam Web API key entered during onboarding (or in
    // Settings) would not reach the main-process data paths — the key-driven fast schema fetch, the
    // background emulator auto-fix, overlay/notification lookups — until the next restart. This module
    // is also require()d by the main process itself (where ipcRenderer is absent), so guard the send.
    try {
      const { ipcRenderer } = require('electron');
      if (ipcRenderer) ipcRenderer.send('config-saved');
    } catch {}
    return resolve();
  });
};
