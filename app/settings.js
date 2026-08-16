'use strict';

const appPath = __dirname;
const path = require('path');
const ini = require('./util/ini');
const fs = require('fs');
const os = require('os');
const aes = require(path.join(appPath, 'util/aes.js'));
const uiLanguages = require(path.join(appPath, 'locale/uiLanguages.js'));
const controllerLabels = require(path.join(appPath, 'util/controllerLabels.js'));

function normalizeControllerBindingSetting(value, allowedButtons, fallback) {
  const parsed = controllerLabels.normalizeControllerBinding(value, {
    allowSingle: true,
    maxButtons: 3,
    allowedButtons,
  });
  const rawParts = String(value || '').split('+').filter(Boolean);
  const strict = rawParts.every((part) => {
    const name = controllerLabels.normalizeButtonName(part);
    return name && allowedButtons.includes(name);
  });
  return parsed && parsed.length && strict ? parsed.join('+') : fallback;
}

let filename;
module.exports.setUserDataPath = (p) => {
  if (p) filename = path.join(p, 'cfg/options.ini');
};

module.exports.load = () => {
  let options;
  try {
    options = ini.parse(fs.readFileSync(filename, 'utf8'));

    if (!options.steam || typeof options.steam !== 'object' || Array.isArray(options.steam)) options.steam = {};
    // Steam schemas are fully keyless now. Do not keep a removed credential alive in memory or
    // write it back the next time another setting is saved.
    delete options.steam.apiKey;

    if (!uiLanguages.has(options.achievement.lang)) {
      try {
        let locale = navigator.language || navigator.userLanguage || 'en';
        options.achievement.lang = uiLanguages.bestForLocale(locale).api;
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

    // "Later" on an update prompt. Without these the answer was forgotten immediately and the
    // hourly re-check asked again, every hour, for as long as the tray daemon stayed running.
    // Version + deadline, so a postpone expires on its own and never hides a NEWER release.
    if (typeof options.general.updatePostponedVersion !== 'string') {
      options.general.updatePostponedVersion = '';
    }
    if (typeof options.general.updatePostponedUntil !== 'number' || !Number.isFinite(options.general.updatePostponedUntil)) {
      options.general.updatePostponedUntil = Number(options.general.updatePostponedUntil) || 0;
    }

    if (typeof options.general.onboardingCompleted !== 'boolean') {
      // Reaching this branch means a settings file already existed. Treat it as an upgraded
      // profile; only the missing-file defaults below should launch first-run onboarding.
      options.general.onboardingCompleted = true;
    }
    // Simple / Advanced interface mode (util/interfaceMode.js). Purely how much of the UI is shown —
    // it changes no parser, no watchdog behaviour and no achievement tracking.
    //
    // Migration is deliberate: a profile that already finished onboarding predates this setting, and
    // silently dropping it into Simple would hide the emulator, controller and diagnostics tabs from
    // someone who has been using them. Those installs get Advanced — nothing disappears on upgrade.
    // A profile still in onboarding gets '' and is asked to choose, with neither option preselected.
    if (options.general.interfaceMode !== 'simple' && options.general.interfaceMode !== 'advanced') {
      options.general.interfaceMode = options.general.onboardingCompleted === true ? 'advanced' : '';
    }
    if (typeof options.general.startWithWindows !== 'boolean') {
      options.general.startWithWindows = true;
    }
    if (typeof options.general.disableHardwareAccel !== 'boolean') {
      options.general.disableHardwareAccel = false;
    }
    if (typeof options.general.closeToTray !== 'boolean') {
      options.general.closeToTray = true;
    }
    // Right-click uninstall menu on game tiles (Settings > General). Default ON:
    // the feature is discoverable out of the box, and every action still asks for
    // confirmation before touching anything.
    if (typeof options.general.uninstallContextMenu !== 'boolean') {
      options.general.uninstallContextMenu = true;
    }
    // App color theme (Settings > General) — built-in variants applied via <html data-theme="...">,
    // plus the layer-based Custom theme ("custom") and user themes from <userData>\themes
    // (stored as "user:<name>").
    if (
      typeof options.general.theme !== 'string' ||
      (!['default', 'oled', 'dracula', 'graphite', 'nord', 'gruvbox', 'tokyonight', 'catppuccin', 'rosepine', 'synthwave', 'everforest', 'cyberpunk', 'ember', 'ocean', 'hacker', 'burgundy', 'champagne', 'custom'].includes(options.general.theme) &&
        !/^user:.+$/i.test(options.general.theme))
    ) {
      options.general.theme = 'default';
    }

    // overlay = the in-game achievement overlay (Ctrl+Shift+K). Notifications are Windows toasts
    // now, so the old per-notification look settings (position/preset/scale/duration) are gone.
    // Legacy configs saved while the old buggy default was Ctrl+Shift+O are migrated back to K.
    if (typeof options.overlay.hotkey !== 'string') {
      options.overlay.hotkey = 'Ctrl+Shift+K';
    } else if (options.overlay.hotkey === 'Ctrl+Shift+O') {
      options.overlay.hotkey = 'Ctrl+Shift+K';
    }
    // Overlay (in-game) notification look — re-introduced as an OPTIONAL transport. The overlay
    // is now the default delivery mode (with the AW Next preset).
    // A saved name that no longer names a preset is NOT rewritten here: resolvePresetFolder() maps
    // a removed bundled preset onto the one that replaced it only after failing to find the name
    // itself, so a user preset of the same name still wins.
    if (typeof options.overlay.notificationPreset !== 'string') {
      options.overlay.notificationPreset = 'AW Next';
    }
    // Optional per-type preset overrides ('' = use notificationPreset): rare unlocks (≤10%) and
    // the platinum/100% popup can each render with their own preset (e.g. Xbox Series Rare/Platinum).
    if (typeof options.overlay.notificationPresetXenia !== 'string') {
      options.overlay.notificationPresetXenia = '';
    }
    if (typeof options.overlay.notificationPresetRpcs3 !== 'string') {
      options.overlay.notificationPresetRpcs3 = '';
    }
    if (typeof options.overlay.notificationPresetShadps4 !== 'string') {
      options.overlay.notificationPresetShadps4 = '';
    }
    if (typeof options.overlay.notificationPosition !== 'string') {
      options.overlay.notificationPosition = 'center-bottom';
    }
    // INI values come back as strings (the compatibility parser only type-coerces booleans), so numbers must be
    // parsed with Number() before validating — a typeof 'number' check would otherwise reset a valid
    // persisted value to its default on every reload.
    {
      const scl = Number(options.overlay.notificationScale);
      options.overlay.notificationScale = Number.isFinite(scl) && scl > 0 ? scl : 1;
    }
    if (typeof options.overlay.notificationSound !== 'string') {
      options.overlay.notificationSound = '';
    }
    // Randomize the overlay notification sound from the merged bundled+user sound list.
    if (typeof options.overlay.randomSound !== 'boolean') {
      options.overlay.randomSound = false;
    }
    // Notification sound volume (percent, 0–200). Overlay audio can boost above 100%; the
    // PowerShell player used for custom toast sounds clamps that part to 100%.
    {
      const vol = Number(options.overlay.notificationVolume);
      options.overlay.notificationVolume = Number.isFinite(vol) ? Math.max(0, Math.min(200, vol)) : 100;
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

    // Native controller → overlay control (Tier 4). Opt-in: loads the koffi/HID stack in the Watchdog
    // only when enabled. Bindings are stored as "BUTTON+BUTTON+BUTTON" strings the watchdog parses.
    if (!options.controller || typeof options.controller !== 'object') options.controller = {};
    if (typeof options.controller.enabled !== 'boolean') {
      options.controller.enabled = false;
    }
    if (typeof options.controller.appNavigation !== 'boolean') {
      options.controller.appNavigation = true;
    }
    if (!['auto', 'xinput', 'gameinput'].includes(options.controller.backend)) {
      options.controller.backend = 'auto';
    }
    options.controller.layout = controllerLabels.normalizeControllerLayout(options.controller.layout);
    options.controller.toggleBinding = normalizeControllerBindingSetting(
      options.controller.toggleBinding,
      controllerLabels.TOGGLE_ALLOWED,
      'BACK+START+LEFT_SHOULDER'
    );
    options.controller.uiModeBinding = normalizeControllerBindingSetting(
      options.controller.uiModeBinding,
      controllerLabels.MODE_ALLOWED,
      'LEFT_SHOULDER+X'
    );
    options.controller.controlModeBinding = normalizeControllerBindingSetting(
      options.controller.controlModeBinding,
      controllerLabels.MODE_ALLOWED,
      'LEFT_SHOULDER+RIGHT_SHOULDER'
    );
    delete options.controller.windowModeBinding;
    if (typeof options.controller.focusOverlay !== 'boolean') {
      options.controller.focusOverlay = false;
    }
    if (typeof options.controller.sendEscapeOnControllerOpen !== 'boolean') {
      options.controller.sendEscapeOnControllerOpen = false;
    }
    if (typeof options.controller.debugLogging !== 'boolean') {
      options.controller.debugLogging = false;
    }

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

    if (typeof options.achievement_source.socialClub !== 'boolean') {
      options.achievement_source.socialClub = true;
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

    if (typeof options.achievement_source.gogOfficial !== 'boolean') {
      options.achievement_source.gogOfficial = true;
    }

    if (typeof options.achievement_source.ubisoftOfficial !== 'boolean') {
      options.achievement_source.ubisoftOfficial = true;
    }

    if (typeof options.achievement_source.epic !== 'boolean') {
      options.achievement_source.epic = true;
    }

    if (typeof options.achievement_source.epicOfficial !== 'boolean') {
      options.achievement_source.epicOfficial = true;
    }

    if (typeof options.achievement_source.ea !== 'boolean') {
      options.achievement_source.ea = true;
    }

    if (typeof options.achievement_source.xboxPc !== 'boolean') {
      options.achievement_source.xboxPc = true;
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
      // Enable playtime on a new profile without changing the preference of upgraded profiles.
      options.notification.playtime = options.general.onboardingCompleted !== true;
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

    if (typeof options.notification_toast.urgent !== 'boolean') {
      options.notification_toast.urgent = false;
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

    // Notification delivery mode: 'auto' (the Watchdog picks per event — see
    // watchdog/notification/transportPolicy.js), 'toast' (Windows toast), 'overlay' (in-game
    // HTML/CSS preset), or 'both'. A saved choice is never rewritten; only an unset or corrupt one
    // lands on 'auto'.
    if (!['auto', 'toast', 'overlay', 'both'].includes(options.notification_transport.mode)) {
      options.notification_transport.mode = 'auto';
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

    // Emulator Steam-login password — AES-encrypted on disk.
    if (options.emulator && typeof options.emulator.loginPassword === 'string' && options.emulator.loginPassword.includes(':')) {
      try {
        options.emulator.loginPassword = aes.decrypt(options.emulator.loginPassword);
      } catch {
        options.emulator.loginPassword = '';
      }
    }

  } catch (err) {
    console.log(`failed to load settings: ${err}`);
    options = {
      general: {
        username: os.userInfo().username || 'User',
        skippedVersion: 'none',
        updatePostponedVersion: '',
        updatePostponedUntil: 0,
        onboardingCompleted: false,
        interfaceMode: '', // '' until onboarding asks; 'simple' | 'advanced' afterwards
        startWithWindows: true,
        disableHardwareAccel: false,
        closeToTray: true,
        uninstallContextMenu: true,
        theme: 'default',
      },
      overlay: {
        hotkey: 'Ctrl+Shift+K',
        notificationPreset: 'AW Next',
        notificationPresetXenia: '',
        notificationPresetRpcs3: '',
        notificationPresetShadps4: '',
        notificationPosition: 'center-bottom',
        notificationScale: 1,
        notificationSound: '',
        randomSound: false,
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
        loginPassword: '', // optional Steam login password — AES-encrypted on disk
        steamId: '', // optional account_steamid override for configs.user.ini ('' = let GBE pick)
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
      options.achievement.lang = uiLanguages.bestForLocale(locale).api;
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
      delete options.steam.apiKey;

    } catch (err) {
      return reject(err);
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, ini.stringify(options), 'utf8');
    // Tell the main process to reload its cached config. The daemon loads options.ini once at startup
    // and otherwise keeps the in-memory copy. This module
    // is also require()d by the main process itself (where ipcRenderer is absent), so guard the send.
    try {
      const { ipcRenderer } = require('electron');
      if (ipcRenderer) ipcRenderer.send('config-saved');
    } catch {}
    return resolve();
  });
};
