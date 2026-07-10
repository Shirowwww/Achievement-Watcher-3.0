'use strict';

const remote = require('@electron/remote');
const path = require('path');
// app.js is loaded immediately after this file as a classic script and declares `const fs` in the
// same global lexical scope. Keep a settings-specific name here or Chromium rejects all of app.js.
const settingsFs = require('fs');

const appPath = remote.app.getAppPath();
const { escapeHtml } = require(path.join(appPath, 'util/escapeHtml.js'));
let listeningHotkey = false;
let keysDown = new Set();
let keys = '';
let holdingKeysCheck = null;
// Notifications tab auto-saves on every change once the form is populated; this guard prevents
// the initial `.val(...).change()` population from triggering a save storm / saving stale values.
let settingsReady = false;
let notifAutosaveTimer = null;
const SETTINGS_SAVE_TIMEOUT_MS = 30000;

function withSettingsTimeout(promise, label, timeoutMs = SETTINGS_SAVE_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

(function ($, window, document) {
  $(function () {
    function forceShowOnboardingDom() {
      $('#settings .box').hide();
      $('#settings').hide();
      if ($('title-bar')[0]) $('title-bar')[0].inSettings = false;
      try {
        const langs = require(path.join(appPath, 'locale/uiLanguages.js'));
        const current = app.config?.achievement?.lang || 'english';
        const selector = $('#onboard-language');
        if (selector.length && selector.children().length === 0) {
          for (const language of langs.all()) {
            selector.append(
              $('<option>')
                .attr('value', language.api)
                .attr('title', language.displayName)
                .text(language.native || language.displayName)
            );
          }
        }
        if (selector.length) selector.val(langs.has(current) ? current : 'english');
      } catch (err) {
        debug.log(`fallback onboarding language fill failed: ${err}`);
      }
      $('#onboarding').attr('aria-hidden', 'false').show();
      $('.onboarding-step').removeClass('active');
      $(".onboarding-step[data-step='0']").addClass('active');
      $('.onboarding-steps button').removeClass('active');
      $(".onboarding-steps button[data-step='0']").addClass('active');
      $('#onboarding-prev').prop('disabled', true);
    }

    function requestOnboardingOpen() {
      window.__awPendingOnboardingOpen = true;
      if (typeof window.openAchievementWatcherOnboarding === 'function') {
        window.__awPendingOnboardingOpen = false;
        window.openAchievementWatcherOnboarding(true);
        setTimeout(() => {
          if (!$('#onboarding').is(':visible')) forceShowOnboardingDom();
        }, 0);
        return;
      }
      window.dispatchEvent(new CustomEvent('aw-open-onboarding', { detail: { force: true } }));
      setTimeout(() => {
        if (typeof window.openAchievementWatcherOnboarding === 'function') {
          window.__awPendingOnboardingOpen = false;
          window.openAchievementWatcherOnboarding(true);
        } else {
          debug.log('onboarding open requested before onboarding module was ready');
        }
        if (!$('#onboarding').is(':visible')) forceShowOnboardingDom();
      }, 80);
    }

    function normalizeKey(e) {
      const key = e.key;
      if (key === ' ') return 'Space';
      if (key === 'Control') return 'Ctrl';
      if (key === 'Meta') return 'Cmd';
      return key.length === 1 ? key.toUpperCase() : key;
    }

    function updateEmulatorUi() {
      const advanced = $('#option_steamSettingsMode').val() === 'advanced';
      const steamLogin = advanced && $('#option_login').val() === 'steam';
      const steamless = $('#option_steamlessAutoUnpack').val() === 'true';

      $('#option_login').closest('li').toggleClass('is-inactive', !advanced).attr('aria-disabled', String(!advanced));
      $('#option_steamlessExperimental').closest('li').toggleClass('is-inactive', !steamless).attr('aria-disabled', String(!steamless));
      $('#emulator-login').toggleClass('is-visible', steamLogin).attr('aria-hidden', String(!steamLogin));

      $('#options-emulator2 select').each(function () {
        $(this).closest('li').toggleClass('is-on', $(this).val() === 'true').toggleClass('is-off', $(this).val() === 'false');
      });
    }

    $('#btn-onboarding-open')
      .off('click.awOnboardingOpen')
      .on('click.awOnboardingOpen', function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestOnboardingOpen();
      });

    const captureOnboardingOpen = (event) => {
        const target = event.target && event.target.closest ? event.target.closest('#btn-onboarding-open, .onboarding-settings-row .action-right') : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestOnboardingOpen();
    };
    document.addEventListener('pointerdown', captureOnboardingOpen, true);
    document.addEventListener('mousedown', captureOnboardingOpen, true);

    $('title-bar').on('open-settings', function () {
      this.inSettings = true;
      settingsReady = false; // suppress auto-save while we populate the form below
      listeningHotkey = false;
      keysDown.clear();
      $('#game-config').hide();
      $('#settings').show();
      $('#settings .box').fadeIn();

      for (let option in app.config.achievement) {
        if ($(`#option_${option} option[value="${app.config.achievement[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.achievement[option].toString()).change();
        }
      }
      if (!app.config.general) app.config.general = {};
      $('#option_startWithWindows').val(String(app.config.general.startWithWindows !== false)).change();
      $('#option_disableHardwareAccel').val(String(app.config.general.disableHardwareAccel === true)).change();
      $('#option_closeToTray').val(String(app.config.general.closeToTray !== false)).change();
      $('#option_theme').val(app.config.general.theme || 'default').change();
      ipcRenderer
        .invoke('startup:get-start-with-windows')
        .then((enabled) => {
          app.config.general.startWithWindows = enabled === true;
          $('#option_startWithWindows').val(String(enabled === true)).change();
        })
        .catch((err) => debug.log(`startup:get-start-with-windows failed: ${err}`));

      for (let option in app.config.achievement_source) {
        if ($(`#option_${option} option[value="${app.config.achievement_source[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.achievement_source[option].toString()).change();
        }
      }

      for (let option in app.config.emulator) {
        if ($(`#option_${option} option[value="${app.config.emulator[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.emulator[option].toString()).change();
        }
      }
      $('#option_mode').val('regular');
      if (app.config.emulator) {
        $('#emulator-login-user').val(app.config.emulator.loginAccountName || '');
        $('#emulator-login-pass').val(app.config.emulator.loginPassword || '');
      }
      updateEmulatorUi();

      $('#hotkey').text(app.config.overlay.hotkey);

      for (let option in app.config.notification) {
        if ($(`#option_${option} option[value="${app.config.notification[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.notification[option].toString()).change();
        }
      }

      for (let option in app.config.notification_toast) {
        if ($(`#option_${option} option[value="${app.config.notification_toast[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.notification_toast[option].toString()).change();
        }
      }

      for (let option in app.config.notification_transport) {
        if ($(`#option_${option} option[value="${app.config.notification_transport[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.notification_transport[option].toString()).change();
        }
      }

      // Overlay (in-game) notification controls — enable lives in notification_transport, the look in
      // overlay.notification*. The preset dropdown is filled from the bundled preset library.
      const cfgOverlay = app.config.overlay || {};
      $('#option_notifMode').val(app.config.notification_transport.mode || 'toast').change();
      $('#option_overlayPosition').val(cfgOverlay.notificationPosition || 'center-bottom').change();
      $('#option_overlayScale').val(String(cfgOverlay.notificationScale || 1)).change();
      $('#option_overlayVolume').val(String(cfgOverlay.notificationVolume != null ? cfgOverlay.notificationVolume : 100)).change();
      $('#option_overlayDuration').val(String(cfgOverlay.notificationDuration || 'auto')).change();
      const cfgSouvenir = app.config.souvenir || {};
      $('#option_souvenirScreenshot').val(String(cfgSouvenir.screenshot === true)).change();
      const souvenirDir = cfgSouvenir.dir && cfgSouvenir.dir.trim() ? cfgSouvenir.dir : souvenirDefaultDir();
      $('#souvenir-dir-display').text(souvenirDir);
      $('#btn-souvenir-dir').attr('title', souvenirDir);
      // The preset/sound dropdowns are filled asynchronously. Auto-save must stay disarmed until BOTH
      // finish populating: otherwise the `change` event fired while populating runs readNotificationSettings
      // against a still-empty sound dropdown and persists notificationSound='' (wiping the user's choice).
      // settingsReady is therefore armed in the Promise.all below, not synchronously at the end of this handler.
      const presetsReady = ipcRenderer
        .invoke('list-presets')
        .then((presets) => {
          const list = presets && presets.length ? presets : ['Default'];
          const sel = $('#option_overlayPreset');
          sel.empty();
          list.forEach((name) => {
            sel.append($('<option>').attr('value', name).text(name));
          });
          sel.val(cfgOverlay.notificationPreset || 'Default');
          // Per-type overrides: same preset list plus a "same as main" ('' value) first entry.
          for (const [id, value] of [
            ['#option_overlayPresetRare', cfgOverlay.notificationPresetRare || ''],
            ['#option_overlayPresetPlatinum', cfgOverlay.notificationPresetPlatinum || ''],
          ]) {
            const typeSel = $(id);
            typeSel.empty();
            typeSel.append($('<option>').attr('value', '').text(typeSel.attr('data-lang-same') || 'Same as main'));
            list.forEach((name) => {
              typeSel.append($('<option>').attr('value', name).text(name));
            });
            typeSel.val(list.includes(value) ? value : '');
          }
        })
        .catch(() => {});
      const soundsReady = ipcRenderer
        .invoke('list-sounds')
        .then((sounds) => {
          const sel = $('#option_overlaySound');
          sel.empty();
          sel.append($('<option>').attr('value', '').text(sel.attr('data-lang-none') || 'None'));
          (sounds || []).forEach((name) => sel.append($('<option>').attr('value', name).text(name.replace(/\.[^.]+$/, ''))));
          sel.val(cfgOverlay.notificationSound || '');
        })
        .catch(() => {});

      if (app.config.steam) {
        if (app.config.steam.apiKey) {
          $('#steamwebapikey').val(app.config.steam.apiKey);
        }
      }
      populateLegitUsers(app.config.steam.main || '0');

      $('#settings #dirlist').empty();
      userDir
        .get()
        .then(async (userDirList) => {
          for (let dir of userDirList) {
            try {
              if (await userDir.check(dir.path)) populateUserDirList({ dir: dir.path, notify: dir.notify, reverse: true });
            } catch (err) {
              //Do nothing
              debug.log(err);
            }
          }
        })
        .catch((err) => {
          //Do nothing
          debug.log(err);
        });

      $('#settings #libdirlist').empty();
      libraryDirs
        .get()
        .then((libraryDirList) => {
          for (let dir of libraryDirList) populateLibraryDirList({ dir, reverse: true });
        })
        .catch((err) => {
          //Do nothing
          debug.log(err);
        });

      // Populate the Debug tab's read-only diagnostics (versions + API-key status). Wrapped so a
      // failure here can never block the settings form from opening.
      try {
        $('#diag-versions').text(
          `App ${remote.app.getVersion()} · Electron ${process.versions.electron} · Node ${process.versions.node} · Chrome ${process.versions.chrome}`
        );
        const hasKey = !!(app.config && app.config.steam && app.config.steam.apiKey);
        const apikeyEl = $('#diag-apikey');
        apikeyEl.find('span').last().text(
          hasKey
            ? apikeyEl.attr('data-configured') || 'configured'
            : apikeyEl.attr('data-fallback') || 'not set — using fallback scraping'
        );
      } catch (err) {
        debug.log(err);
      }

      // Form is fully populated (including the async preset/sound dropdowns) -> arm auto-save for the
      // Notifications tab. Gating on these Promises prevents the populate-time change events from
      // persisting stale/empty values before the dropdowns have loaded.
      Promise.all([presetsReady, soundsReady]).then(() => {
        settingsReady = true;
      });
    });

    window.addEventListener('keydown', (e) => {
      if (!listeningHotkey) return;
      keysDown.add(normalizeKey(e));
      keys = Array.from(keysDown).join(' + ');
      $('#hotkey').text(keys);
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      if (!listeningHotkey) return;
      keysDown.delete(normalizeKey(e));
      holdingKeysCheck = setTimeout(() => {
        if (keysDown.size > 0) {
          keys = Array.from(keysDown).join(' + ');
          $('#hotkey').text(keys);
        }
      }, 250);
      if (keysDown.size === 0) {
        listeningHotkey = false;
      }
    });

    $('#btn-hotkey-edit').click(function () {
      listeningHotkey = true;
      $('#hotkey').text('...');
    });

    // --- Debug tab: diagnostics shortcuts ---
    $('#open-logs').click(function () {
      try {
        const userDataPath = ipcRenderer.sendSync('get-user-data-path-sync');
        remote.shell.openPath(path.join(userDataPath, 'logs'));
      } catch (err) {
        debug.log(err);
      }
    });
    $('#open-userdata').click(function () {
      try {
        remote.shell.openPath(ipcRenderer.sendSync('get-user-data-path-sync'));
      } catch (err) {
        debug.log(err);
      }
    });

    // Scan a library folder for Goldberg/GBE installs and report which ones are missing their schema.
    $('#scan-gbe').click(async function () {
      const result = $('#scan-gbe-result');
      try {
        const goldberg = require(path.join(appPath, 'parser/goldberg.js'));
        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
          title: 'Select a game-library folder to scan',
          buttonLabel: 'Scan',
          properties: ['openDirectory', 'dontAddToRecent'],
        });
        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
        result.text('Scanning…');
        const found = goldberg.findCompatibleGames(picked.filePaths[0]);
        if (found.length === 0) {
          result.text('No Goldberg / GBE Fork installs found in that folder.');
          return;
        }
        const unconfigured = found.filter((g) => !g.hasSchema);
        const emuLabel = { gbe: 'GBE Fork', goldberg: 'Goldberg', none: 'unknown' };
        const detail = found
          .map((g) => `${g.appid || '?'} · ${emuLabel[g.emulator] || g.emulator} — ${g.hasSchema ? `${g.schemaCount} achievements` : 'MISSING achievements.json'}\n  ${g.steamSettings}`)
          .join('\n');
        result.text(`Found ${found.length} install(s); ${unconfigured.length} missing their achievements.json schema.`);
        remote.dialog.showMessageBox(remote.getCurrentWindow(), {
          type: unconfigured.length ? 'warning' : 'info',
          title: 'Goldberg / GBE Fork scan',
          message: `${found.length} install(s) found — ${unconfigured.length} unconfigured`,
          detail,
          buttons: ['OK'],
          noLink: true,
        });
      } catch (err) {
        result.text(`Scan failed: ${err}`);
        debug.log(err);
      }
    });

    $('#btn-settings-cancel, #settings .overlay').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      $('#settings .box').fadeOut(() => {
        $('#settings').hide();
        let elem = $('#settingNav li').first();
        $('#settingNav li').removeClass('active');
        elem.addClass('active');
        $('#settings .box section.content').removeClass('active');
        $("#settings .box section.content[data-view='" + elem.data('view') + "']").addClass('active');
        self.css('pointer-events', 'initial');
        $('title-bar')[0].inSettings = false;
        // Cancel reverts an unsaved theme preview back to the persisted choice.
        document.documentElement.dataset.theme = (app.config.general && app.config.general.theme) || 'default';
      });
    });

    $('#btn-settings-save').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      app.config.overlay.hotkey = $('#hotkey').text();
      $('#options-ui .right')
        .children('select')
        .each(function (index) {
          try {
            // These General-tab selects persist under `general`, not `achievement` — handled explicitly below.
            if (
              $(this)[0].id === 'option_startWithWindows' ||
              $(this)[0].id === 'option_disableHardwareAccel' ||
              $(this)[0].id === 'option_closeToTray' ||
              $(this)[0].id === 'option_theme'
            )
              return;
            if ($(this)[0].id !== '' && $(this).val() !== '') {
              app.config.achievement[$(this)[0].id.replace('option_', '')] =
                $(this).val() === 'true' ? true : $(this).val() === 'false' ? false : $(this).val();
            }
          } catch (e) {
            debug.log(e);
            debug.log('error while reading general settings ui');
          }
        });
      if (!app.config.general) app.config.general = {};
      app.config.general.disableHardwareAccel = $('#option_disableHardwareAccel').val() === 'true';
      app.config.general.closeToTray = $('#option_closeToTray').val() !== 'false';
      app.config.general.theme = $('#option_theme').val() || 'default';

      $('#options-source .right')
        .children('select')
        .each(function (index) {
          try {
            if ($(this)[0].id !== '' && $(this).val() !== '') {
              app.config.achievement_source[$(this)[0].id.replace('option_', '')] =
                $(this).val() === 'true' ? true : $(this).val() === 'false' ? false : $(this).val();
            }
          } catch (e) {
            debug.log(e);
            debug.log('error while reading ach source settings ui');
          }
        });

      $('#options-emulator .right, #options-emulator2 .right')
        .children('select')
        .each(function () {
          try {
            if ($(this)[0].id === 'option_goldbergDownloadIcons') return;
            if ($(this)[0].id !== '' && $(this).val() !== '') {
              app.config.emulator[$(this)[0].id.replace('option_', '')] =
                $(this).val() === 'true' ? true : $(this).val() === 'false' ? false : $(this).val();
            }
          } catch (e) {
            debug.log(e);
            debug.log('error while reading emulator settings ui');
          }
        });
      app.config.achievement.goldbergDownloadIcons = $('#option_goldbergDownloadIcons').val() === 'true';
      app.config.emulator.mode = 'regular';
      // Steam login fields (username plain, password AES-encrypted on disk by settings.js).
      if (app.config.emulator) {
        app.config.emulator.loginAccountName = $('#emulator-login-user').val().trim();
        app.config.emulator.loginPassword = $('#emulator-login-pass').val();
      }

      $('#options-notify-common .right')
        .children('select')
        .each(function (index) {
          try {
            // groupToast sits in the common group visually but persists under notification_toast.
            if ($(this)[0].id === 'option_groupToast') return;
            if ($(this)[0].id !== '' && $(this).val() !== '') {
              app.config.notification[$(this)[0].id.replace('option_', '')] =
                $(this).val() === 'true' ? true : $(this).val() === 'false' ? false : $(this).val();
            }
          } catch (e) {
            debug.log(e);
            debug.log('error while reading notification common settings ui');
          }
        });

      if ($('#option_groupToast').val() !== '') {
        app.config.notification_toast.groupToast = $('#option_groupToast').val() === 'true';
      }

      $('#options-notify-transport .right')
        .children('select')
        .each(function (index) {
          try {
            if ($(this)[0].id !== '' && $(this).val() !== '') {
              app.config.notification_transport[$(this)[0].id.replace('option_', '')] =
                $(this).val() === 'true' ? true : $(this).val() === 'false' ? false : $(this).val();
            }
          } catch (e) {
            debug.log(e);
            debug.log('error while reading notification transport settings ui');
          }
        });

      let steamApiKey = $('#steamwebapikey').val().trim();
      if (steamApiKey.length > 0) {
        app.config.steam = { apiKey: steamApiKey };
      } else {
        // Empty field -> explicit clear. Use '' (not delete) so settings.save() can tell an
        // intentional removal apart from a partial save that simply omits the key.
        if (!app.config.steam) app.config.steam = {};
        app.config.steam.apiKey = '';
      }

      app.config.steam.main = $('#options-mainSteam .right select').val();

      let userDirList = [];
      $('#settings #dirlist > li').each(function () {
        let dir = $(this).find('.path span').text();
        userDirList.push({ path: dir, notify: true });
      });

      let libraryDirList = [];
      $('#settings #libdirlist > li').each(function () {
        libraryDirList.push($(this).find('.path span').text());
      });

      const startWithWindows = $('#option_startWithWindows').val() === 'true';
      const applyStartup = ipcRenderer
        .invoke('startup:set-start-with-windows', startWithWindows)
        .then(() => {
          if (!app.config.general) app.config.general = {};
          app.config.general.startWithWindows = startWithWindows;
        })
        .catch((err) => {
          const wrapped = new Error(err && err.message ? err.message : String(err));
          wrapped.isStartupSettingError = true;
          throw wrapped;
        });

      settings.setUserDataPath(ipcRenderer.sendSync('get-user-data-path-sync'));
      withSettingsTimeout(Promise.all([userDir.save(userDirList), libraryDirs.save(libraryDirList), applyStartup]), 'Saving folders/startup')
        .then(() => withSettingsTimeout(settings.save(app.config), 'Writing options.ini'))
        .then(() => {
          $('#settings .box').fadeOut(() => {
            self.css('pointer-events', 'initial');
            resetUI();
          });
        })
        .catch((err) => {
          $('#settings .box').fadeOut(() => {
            $('#settings').hide();
            let elem = $('#settingNav li').first();
            $('#settingNav li').removeClass('active');
            elem.addClass('active');
            $('#settings .box section.content').removeClass('active');
            $("#settings .box section.content[data-view='" + elem.data('view') + "']").addClass('active');
            self.css('pointer-events', 'initial');
            $('title-bar')[0].inSettings = false;

            remote.dialog.showMessageBoxSync({
              type: 'error',
              title: 'Unexpected Error',
              message: err && err.isStartupSettingError ? 'Error while updating the startup setting.' : 'Error while saving settings.',
              detail: `${err}`,
            });
          });
        });
    });

    $('#settings .arrow-list .next').click(function () {
      let sel = $(this).parent('.right').find('select')[0];
      let i = sel.selectedIndex;
      sel.options[++i % sel.options.length].selected = true;

      if ('createEvent' in document) {
        let evt = document.createEvent('HTMLEvents');
        // Native <select> change events bubble. Keep the synthetic arrow-control event equivalent so
        // dependent settings (and delegated auto-save handlers) react immediately.
        evt.initEvent('change', true, true);
        sel.dispatchEvent(evt);
      } else {
        sel.fireEvent('onchange');
      }
    });

    $('#settings .arrow-list .previous').click(function () {
      let sel = $(this).parent('.right').find('select')[0];
      let i = sel.selectedIndex;
      if (i <= 0) {
        i = sel.options.length;
      }
      sel.options[--i % sel.options.length].selected = true;

      if ('createEvent' in document) {
        let evt = document.createEvent('HTMLEvents');
        evt.initEvent('change', true, true);
        sel.dispatchEvent(evt);
      } else {
        sel.fireEvent('onchange');
      }
    });

    // Validate the saved Advanced-mode Steam credentials against the real GSE tool. AppID 480
    // (Spacewar) is used only as a harmless generation target. Interactive Steam Guard/email/captcha
    // prompts are forwarded to the in-app modal and `-tok` lets GSE retain the resulting refresh token.
    $('#emulator-login-test').click(async function () {
      const button = $(this);
      const status = $('#emulator-login-test-status');
      const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
      const emuText = fr
        ? {
            missing: "Renseigne d'abord l'identifiant et le mot de passe Steam.",
            running: "Connexion à Steam… Saisis le code Steam Guard s'il est demandé.",
            success: 'Connexion Steam réussie. Le refresh token generate_emu_config a été sauvegardé.',
            failed: 'Échec de la connexion Steam',
          }
        : {
            missing: 'Enter the Steam username and password first.',
            running: 'Connecting to Steam… Enter the Steam Guard code if requested.',
            success: 'Steam login successful. The generate_emu_config refresh token was saved.',
            failed: 'Steam login failed',
          };
      const username = $('#emulator-login-user').val().trim();
      const password = $('#emulator-login-pass').val();
      const setStatus = (text, cls = '') => status.removeClass('success error').addClass(cls).text(text || '');
      if (!username || !password) {
        setStatus(emuText.missing, 'error');
        return;
      }
      if (button.hasClass('disabled')) return;
      button.addClass('disabled').css('pointer-events', 'none');
      setStatus(emuText.running, 'running');
      let generated = null;
      try {
        const userData = ipcRenderer.sendSync('get-user-data-path-sync');
        const genEmu = require(path.join(appPath, 'parser/genEmuConfig.js'));
        let preferredTag = null;
        try { preferredTag = settingsFs.readFileSync(path.join(userData, 'cache/gse_fork/latest.txt'), 'utf8').trim() || null; } catch {}
        const tool = await genEmu.ensureGenerateEmuConfig({
          cacheDir: path.join(userData, 'cache/gse_emu_config'),
          preferredTag,
          log: debug,
        });
        const onPrompt = async (question) => {
          if (typeof window.awPromptText !== 'function') throw new Error('2FA prompt UI is unavailable');
          return window.awPromptText(`Steam / GSE — ${question}`, '', /password/i.test(question) ? 'password' : 'text');
        };
        generated = await genEmu.generate({
          tool,
          appid: '480',
          login: { username, password },
          onPrompt,
          timeout: 300000,
          log: debug,
        });
        setStatus(emuText.success, 'success');
      } catch (err) {
        debug.log(`[emulator-login-test] ${err}`);
        setStatus(`${emuText.failed}: ${err.message || err}`, 'error');
      } finally {
        if (generated && generated.workDir) {
          try { settingsFs.rmSync(generated.workDir, { recursive: true, force: true }); } catch {}
        }
        button.removeClass('disabled').css('pointer-events', '');
      }
    });

    // Bind on the controls themselves as well as using a bubbling event above. This keeps the
    // dependency UI reliable for keyboard changes, programmatic population and the arrow buttons.
    $('#options-emulator select, #options-emulator2 select').on('change', updateEmulatorUi);

    // Live theme preview: applying on change lets the user see the theme before committing with OK;
    // Cancel restores whatever is saved in the config.
    $('#option_theme').on('change', function () {
      document.documentElement.dataset.theme = $(this).val() || 'default';
    });

    // Let the mouse wheel cycle the value displayed between the arrows. This is
    // especially useful for long lists while keeping the compact control aligned.
    $('#settings .arrow-list .right').on('wheel', function (event) {
      event.preventDefault();
      const direction = event.originalEvent.deltaY > 0 ? '.next' : '.previous';
      $(this).find(direction).trigger('click');
    });

    $('#option_lang').mouseover(function () {
      let self = $(this);
      let tooltip = self.find('option:selected').data('tooltip');
      self.attr('title', tooltip);
    });

    $('#settingNav li').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      let view = self.data('view');

      $('#settingNav li').removeClass('active');
      self.addClass('active');

      $('#settings .box section.content').removeClass('active');
      $("#settings .box section.content[data-view='" + view + "']").addClass('active').scrollTop(0);

      self.css('pointer-events', 'initial');
    });

    $('#addCustomDir').click(async function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      try {
        let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'showHiddenFiles'] });

        if (dialog.filePaths.length > 0) {
          debug.log(`Adding folder: ${dialog.filePaths}`);

          if (await userDir.check(dialog.filePaths[0])) {
            populateUserDirList({ dir: dialog.filePaths[0] });
          } else {
            debug.log('-> Invalid folder');
            remote.dialog.showMessageBoxSync({
              type: 'warning',
              title: 'Invalid folder',
              message: $("#settings .content[data-view='folder'] > .controls .info p")
                .html()
                .replace(/\s{2,}/g, '')
                .replace(/<br>/g, '\n'),
            });
          }
        } else {
          debug.log('Adding folder: User Cancel');
        }
      } catch (err) {
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: 'Unexpected Error',
          message: 'Error adding custom folder',
          detail: `${err}`,
        });
      }

      self.css('pointer-events', 'initial');
    });

    $('#addLibraryDir').click(async function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      try {
        let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'showHiddenFiles'] });

        if (dialog.filePaths.length > 0) {
          debug.log(`Adding library folder: ${dialog.filePaths}`);
          populateLibraryDirList({ dir: dialog.filePaths[0] });
        } else {
          debug.log('Adding library folder: User Cancel');
        }
      } catch (err) {
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: 'Unexpected Error',
          message: 'Error adding library folder',
          detail: `${err}`,
        });
      }

      self.css('pointer-events', 'initial');
    });

    // #7 — Generate configs from the watched/library folders on demand. Persists the current folders,
    // then runs a full rescan: makeList discovers every game in those folders and applies the one-shot
    // emulator fix (schema + steam_settings + icons) to unconfigured ones, so they're ready without
    // waiting for the 15-min background scan or opening each game manually.
    $('#generate-configs').click(async function () {
      const self = $(this);
      const result = $('#generate-configs-result');
      self.css('pointer-events', 'none');
      const fr = String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
      try {
        // 1) persist the folders currently listed in the UI so the scan uses them
        let userDirList = [];
        $('#settings #dirlist > li').each(function () {
          userDirList.push({ path: $(this).find('.path span').text(), notify: true });
        });
        let libraryDirList = [];
        $('#settings #libdirlist > li').each(function () {
          libraryDirList.push($(this).find('.path span').text());
        });
        settings.setUserDataPath(ipcRenderer.sendSync('get-user-data-path-sync'));
        await Promise.all([userDir.save(userDirList), libraryDirs.save(libraryDirList)]);

        // 2) quick Goldberg/GBE count across the library folders for a summary (the full scan below
        //    covers every source, not just these)
        let found = [];
        try {
          const goldberg = require(path.join(appPath, 'parser/goldberg.js'));
          for (const dir of libraryDirList) {
            try {
              found = found.concat(goldberg.findCompatibleGames(dir));
            } catch (e) {
              debug.log(e);
            }
          }
        } catch (e) {
          debug.log(e);
        }
        const unconfigured = found.filter((g) => !g.hasSchema).length;
        const autoFixEnabled = app.config?.emulator?.autoApplyNewGames !== false;
        const detail = fr
          ? autoFixEnabled
            ? "Le bouton lance un scan complet maintenant. Pendant ce scan, Achievement Watcher applique l'auto-fix GBE/Goldberg aux jeux détectés qui ont un dossier d'installation connu. Les réparations se font en arrière-plan : relance un scan si un jeu vient juste d'être corrigé et n'apparaît pas encore comme prêt."
            : "Le bouton lance seulement un scan complet pour détecter les jeux. La réparation automatique est désactivée dans Configuration émulateur > Corriger automatiquement les nouveaux jeux détectés."
          : autoFixEnabled
            ? 'This starts a full scan now. During that scan, Achievement Watcher applies the GBE/Goldberg auto-fix to detected games with a known install folder. Repairs run in the background: scan again if a freshly fixed game does not show as ready yet.'
            : 'This only starts a full detection scan. Automatic repair is disabled in Emulator configuration > Automatically fix newly detected games.';
        const choice = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
          type: autoFixEnabled ? 'info' : 'warning',
          title: fr ? 'Génération des configs' : 'Generate configs',
          message: fr
            ? `${found.length} jeu(x) émulé(s) détecté(s) dans tes bibliothèques — ${unconfigured} sans achievements.json.`
            : `${found.length} emulated game(s) found in your libraries — ${unconfigured} without achievements.json.`,
          detail,
          buttons: [fr ? 'Lancer le scan' : 'Start scan', fr ? 'Annuler' : 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (choice !== 0) return;

        // 3) full rescan — discovers the folders and applies the one-shot emulator fix to unconfigured games
        result.text(
          fr
            ? autoFixEnabled
              ? `Scan lancé — ${unconfigured} jeu(x) sans schema seront réparés si leur dossier d'installation est reconnu.`
              : "Scan lancé — réparation automatique désactivée, aucun fichier ne sera modifié."
            : autoFixEnabled
              ? `Scan started — ${unconfigured} game(s) without schema will be repaired if their install folder is recognized.`
              : 'Scan started — automatic repair is disabled, no files will be changed.'
        );
        resetUI();
      } catch (err) {
        result.text(fr ? `Génération impossible : ${err}` : `Generate configs failed: ${err}`);
        remote.dialog.showMessageBoxSync({ type: 'error', title: 'Unexpected Error', message: 'Error generating configs', detail: `${err}` });
      } finally {
        self.css('pointer-events', 'initial');
      }
    });

    $('#smartFind').click(async function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      $('#wrap-dirlist .loading-overlay').show();
      $('#addCustomDir').css('pointer-events', 'none');
      $('#btn-settings-save').css('pointer-events', 'none');

      debug.log('auto-finding folder(s) ...');

      try {
        for (let dir of await userDir.find()) {
          debug.log(`Found folder: ${dir}`);
          if (await userDir.check(dir)) {
            //redundant ?
            populateUserDirList({ dir: dir });
          } else {
            debug.log('-> Invalid folder');
          }
        }
        if (libraryDirs.find) {
          for (let dir of await libraryDirs.find()) {
            debug.log(`Found library folder: ${dir}`);
            populateLibraryDirList({ dir });
          }
        }
      } catch (err) {
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: 'Unexpected Error',
          message: 'Error while auto-finding folder(s)',
          detail: `${err}`,
        });
      }

      self.css('pointer-events', 'initial');
      $('#wrap-dirlist .loading-overlay').hide();
      $('#addCustomDir').css('pointer-events', 'initial');
      $('#btn-settings-save').css('pointer-events', 'initial');
    });

    $('#blacklist_reset').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      blacklist
        .reset()
        .then(() => {
          if ($('#achievement').is(':visible')) {
            $('#btn-previous').trigger('click');
          }
          $('#game-config').hide();
          $('#settings').hide();
          $('#game-list ul').empty();
          $('#game-list .loading .progressBar').attr('data-percent', 0);
          $('#game-list .loading .progressBar > .meter').css('width', '0%');
          self.css('pointer-events', 'initial');
          $('#win-settings').css('pointer-events', 'initial');
          $('#game-list .loading').show();
          $('#user-info').css('opacity', 0).css('pointer-events', 'none');
          $('#game-list .isEmpty').hide();
          let elem = $('#settingNav li').first();
          $('#settingNav li').removeClass('active');
          elem.addClass('active');
          $('#settings .box section.content').removeClass('active');
          $("#settings .box section.content[data-view='" + elem.data('view') + "']").addClass('active');
          if (app.args.appid) app.args.appid = null;
          app.onStart();
        })
        .catch((err) => {
          self.css('pointer-events', 'initial');
          remote.dialog.showMessageBoxSync({
            type: 'error',
            title: 'Unexpected Error',
            message: 'Error while trying to reset user blacklist',
            detail: `${err}`,
          });
        });
    });

    // Auto-save the Notifications tab: persist immediately on any change, no OK required.
    // The volume slider is a range input, not a <select>, so it is targeted explicitly (the
    // customiser's own range inputs build presets and must NOT trigger a settings save).
    $("#settings .box section.content[data-view='notification']").on('change', 'select, #option_overlayVolume', autosaveNotifications);

    // Shared by the three Notifications-tab test buttons (achievement/toast, progress, playtime):
    // spawns a fullscreen dummy window so the toast is visible over it, then asks the watchdog
    // (over its existing websocket) to fire the given test notification.
    function runNotificationTest(cmd) {
      let self = $(this);
      self.css('pointer-events', 'none');

      let dummy = new remote.BrowserWindow({ frame: false, backgroundColor: '#000000' });
      dummy.on('closed', () => {
        dummy = null;
        self.css('pointer-events', 'initial');
      });
      dummy.setFullScreen(true);

      setTimeout(() => {
        const ws = new WebSocket('ws://localhost:8082');
        ws.onerror = (err) => {
          ws.close();
          dummy.close();
          remote.dialog.showMessageBoxSync({
            type: 'error',
            title: 'WebSocket Connection Error',
            message: 'Notification Test Failure.',
            detail: 'Error in connection establishment: net::ERR_CONNECTION_REFUSED\nIs Watchdog Running ?',
          });
        };

        ws.onopen = () => {
          ws.onmessage = (evt) => {
            try {
              let res = JSON.parse(evt.data);
              if (res.cmd === cmd) {
                if (res.success === true) {
                  ws.close();
                  setTimeout(() => {
                    dummy.close();
                  }, 7000);
                } else if (res.success === false && res.error) {
                  throw res.error;
                } else {
                  throw 'Unexpected response';
                }
              } else {
                throw 'Unexpected response';
              }
            } catch (err) {
              ws.close();
              dummy.close();
              remote.dialog.showMessageBoxSync({
                type: 'error',
                title: 'Unexpected Error',
                message: 'Notification Test Failure.',
                detail: `${err}`,
              });
            }
          };
          try {
            ws.send(JSON.stringify({ cmd }));
          } catch (err) {
            ws.close();
            dummy.close();
            remote.dialog.showMessageBoxSync({
              type: 'error',
              title: 'Unexpected Error',
              message: 'Notification Test Failure.',
              detail: `${err}`,
            });
          }
        };
      }, 500);
    }

    // Random rarity for the "rare" test: one of the three tiers presets style (gold <3%,
    // silver <6%, bronze ≤10%), rounded to one decimal like the real watchdog path.
    function randomRareRarity() {
      const tiers = [
        { min: 0.1, max: 2.9 },
        { min: 3.0, max: 5.9 },
        { min: 6.0, max: 10.0 },
      ];
      const tier = tiers[Math.floor(Math.random() * tiers.length)];
      return Math.round((tier.min + Math.random() * (tier.max - tier.min)) * 10) / 10;
    }
    // Build overlay test payload for a given notification kind, using the current overlay settings.
    function overlayTestData(kind) {
      const mainPreset = $('#option_overlayPreset').val() || 'Default';
      // Tests honor the per-type preset overrides so they render exactly like the real popups.
      const preset =
        kind === 'rare'
          ? $('#option_overlayPresetRare').val() || mainPreset
          : kind === 'platinum'
          ? $('#option_overlayPresetPlatinum').val() || mainPreset
          : mainPreset;
      const sound = $('#option_overlaySound').val() || '';
      const rarePct = kind === 'rare' ? randomRareRarity() : null;
      const fr = String((window.app && window.app.config && window.app.config.achievement && window.app.config.achievement.lang) || '')
        .toLowerCase()
        .startsWith('fr');
      const texts = fr
        ? {
            toast: { displayName: 'Succès débloqué', description: 'Test overlay — preset ' + preset },
            rare: { displayName: 'Succès rare', description: 'Rare · ' + rarePct + ' % des joueurs' },
            progress: { displayName: 'Progression', description: '3 / 10' },
            playtime: { displayName: 'Hollow Knight', description: 'Vous avez joué pendant 42 minutes' },
            platinum: { displayName: 'Trophée Platine', description: '100 % complété' },
          }
        : {
            toast: { displayName: 'Achievement Unlocked', description: 'Overlay test — ' + preset + ' preset' },
            rare: { displayName: 'Rare Achievement', description: 'Rare · ' + rarePct + '% of players' },
            progress: { displayName: 'Progress', description: '3 / 10' },
            playtime: { displayName: 'Hollow Knight', description: 'You played for 42 minutes' },
            platinum: { displayName: 'Platinum!', description: '100% completed' },
          };
      const volRaw = parseInt($('#option_overlayVolume').val(), 10);
      const durRaw = $('#option_overlayDuration').val();
      const durSec = durRaw === 'auto' || !durRaw ? 0 : parseInt(durRaw, 10) || 0;
      const achievementIcon = path.join(appPath, 'resources/img/achievement.svg');
      const gameIcon = path.join(appPath, 'resources/icon/icon.png');
      return Object.assign(
        {
          preset,
          notificationType: kind === 'toast' ? 'achievement' : kind,
          position: $('#option_overlayPosition').val() || 'center-bottom',
          scale: parseFloat($('#option_overlayScale').val()) || 1,
          volume: Number.isFinite(volRaw) ? volRaw : 100,
          durationMs: durSec > 0 ? durSec * 1000 : undefined,
          iconPath: kind === 'playtime' ? gameIcon : achievementIcon,
          achievementIconPath: achievementIcon,
          gameIconPath: gameIcon,
          progress: kind === 'progress' ? { current: 3, max: 10, percent: 30 } : null,
          // Playtime notifications never play a sound, so its test mirrors that behaviour.
          soundPath: kind === 'playtime' ? '' : resolveSoundFile(sound),
        },
        texts[kind] || texts.toast
      );
    }
    // Route a test through whichever transport(s) the user picked (toast / overlay / both).
    function fireNotificationTest(kind, btn) {
      const mode = $('#option_notifMode').val() || 'toast';
      if (mode === 'toast' || mode === 'both') runNotificationTest.call(btn, kind + '-test');
      if (mode === 'overlay' || mode === 'both') ipcRenderer.send('spawn-overlay-notification', overlayTestData(kind));
    }
    $('#notify_test').click(function () {
      fireNotificationTest('toast', this);
    });
    $('#notify_rare_test').click(function () {
      fireNotificationTest('rare', this);
    });
    $('#notify_progress_test').click(function () {
      fireNotificationTest('progress', this);
    });
    $('#notify_playtime_test').click(function () {
      fireNotificationTest('playtime', this);
    });
    $('#notify_platinum_test').click(function () {
      fireNotificationTest('platinum', this);
    });
    // Preview a sound at the configured overlay volume (0–200%). >100% needs a WebAudio gain node
    // (Audio.volume caps at 1.0) — mirrors how the real notification window plays it (init.js).
    let previewAudioCtx = null;
    function previewSoundAtVolume(name) {
      const file = resolveSoundFile(name);
      if (!file) return;
      const raw = parseInt($('#option_overlayVolume').val(), 10);
      const gain = Math.max(0, Math.min(2, (Number.isFinite(raw) ? raw : 100) / 100));
      try {
        const audio = new Audio('file:///' + file.replace(/\\/g, '/'));
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx && gain !== 1) {
            if (!previewAudioCtx) previewAudioCtx = new Ctx();
            const srcNode = previewAudioCtx.createMediaElementSource(audio);
            const gainNode = previewAudioCtx.createGain();
            gainNode.gain.value = gain;
            srcNode.connect(gainNode);
            gainNode.connect(previewAudioCtx.destination);
          } else {
            audio.volume = Math.min(1, gain);
          }
        } catch (e) {
          audio.volume = Math.min(1, gain);
        }
        audio.play().catch(() => {});
      } catch (e) {}
    }
    // Preview the overlay sound when the dropdown is changed by the user.
    $('#option_overlaySound').on('change', function () {
      const v = $(this).val();
      if (!v) return;
      previewSoundAtVolume(v);
    });
    // Volume slider: live % label while dragging; on release (change), preview the selected sound at
    // the new volume so the user hears what they set (auto-save is the delegated handler above).
    function updateOverlayVolumeLabel() {
      const v = parseInt($('#option_overlayVolume').val(), 10);
      $('#overlayVolume-value').text((Number.isFinite(v) ? v : 100) + '%');
    }
    $('#option_overlayVolume').on('input', updateOverlayVolumeLabel);
    $('#option_overlayVolume').on('change', function () {
      updateOverlayVolumeLabel();
      if (!settingsReady) return; // form is being populated — not a user interaction
      previewSoundAtVolume($('#option_overlaySound').val());
    });
    // Mouse wheel nudges the slider one step, then commits via a debounced change so the
    // preview + auto-save fire once instead of on every tick.
    let volumeWheelCommit = null;
    $('#option_overlayVolume').on('wheel', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const el = this;
      const step = parseInt(el.step, 10) || 5;
      const dir = event.originalEvent.deltaY > 0 ? -1 : 1;
      el.value = Math.max(0, Math.min(200, (parseInt(el.value, 10) || 0) + dir * step));
      updateOverlayVolumeLabel();
      clearTimeout(volumeWheelCommit);
      volumeWheelCommit = setTimeout(() => $(el).trigger('change'), 350);
    });

    // Import a custom notification sound: copy it into <userData>/sounds, then refresh the dropdown and
    // select it (the change triggers a preview + the Notifications-tab auto-save).
    $('#btn-import-sound').click(async function () {
      const self = $(this);
      self.css('pointer-events', 'none');
      try {
        const name = await ipcRenderer.invoke('import-sound');
        if (name) {
          const sounds = await ipcRenderer.invoke('list-sounds');
          const sel = $('#option_overlaySound');
          sel.empty();
          sel.append($('<option>').attr('value', '').text(sel.attr('data-lang-none') || 'None'));
          (sounds || []).forEach((n) => sel.append($('<option>').attr('value', n).text(n.replace(/\.[^.]+$/, ''))));
          sel.val(name).change();
        }
      } catch (e) {
        debug.log(e);
      }
      self.css('pointer-events', 'initial');
    });

    // Reposition the overlay notification popup: spawn a draggable witness using the current preset;
    // dragging it persists the 'custom' position used when Position = Custom.
    $('#btn-overlay-reposition').click(function () {
      const data = overlayTestData('toast');
      data.position = 'custom';
      data.reposition = true;
      data.durationMs = undefined;
      data.soundPath = '';
      ipcRenderer.send('spawn-overlay-notification', data);
      // Make sure the dropdown reflects that custom positioning is now in use.
      $('#option_overlayPosition').val('custom').change();
    });

    // Pick a custom folder for souvenir screenshots (empty = default Pictures\Achievement Watcher).
    $('#btn-souvenir-dir').click(async function () {
      try {
        const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'dontAddToRecent'] });
        if (res.canceled || !res.filePaths || !res.filePaths.length) return;
        if (!app.config.souvenir) app.config.souvenir = {};
        app.config.souvenir.dir = res.filePaths[0];
        $('#souvenir-dir-display').text(res.filePaths[0]);
        $('#btn-souvenir-dir').attr('title', res.filePaths[0]);
        autosaveNotifications();
      } catch (e) {
        debug.log(e);
      }
    });

    // --- Custom preset builder: live preview + create ---
    function custInt(id, def) {
      const n = parseInt($('#' + id).val(), 10);
      return Number.isFinite(n) ? n : def;
    }
    function updatePresetPreview() {
      const bg = $('#cust-bg').val() || '#16181d';
      const text = $('#cust-text').val() || '#ffffff';
      const accent = $('#cust-accent').val() || '#4aa3ff';
      const opacity = custInt('cust-opacity', 100) / 100;
      const font = custInt('cust-font', 16);
      const radius = custInt('cust-radius', 12);
      const icon = custInt('cust-icon', 64);
      $('#cust-preview').css({ background: bg, color: text, 'border-left-color': accent, 'border-radius': radius + 'px', 'font-size': font + 'px', opacity: opacity });
      $('#cust-preview-title').css('color', accent);
      $('#cust-preview-icon').css({ color: accent, 'font-size': Math.round(icon * 0.62) + 'px' });
    }
    $('#options-notify-customiser').on('input change', 'input', updatePresetPreview);
    updatePresetPreview();

    $('#btn-create-preset').click(async function () {
      const self = $(this);
      const status = $('#cust-status');
      const name = ($('#cust-name').val() || '').trim();
      if (!name) {
        status.text(status.attr('data-err') || 'Enter a name first').css('color', '#e66');
        return;
      }
      self.css('pointer-events', 'none');
      try {
        const res = await ipcRenderer.invoke('create-custom-preset', {
          name,
          bg: $('#cust-bg').val(),
          text: $('#cust-text').val(),
          accent: $('#cust-accent').val(),
          opacity: custInt('cust-opacity', 100) / 100,
          fontSize: custInt('cust-font', 16),
          radius: custInt('cust-radius', 12),
          iconSize: custInt('cust-icon', 64),
        });
        if (res && res.ok) {
          // Refresh the preset dropdown and select the new preset (autosave persists the choice).
          const presets = await ipcRenderer.invoke('list-presets');
          const sel = $('#option_overlayPreset');
          sel.empty();
          (presets && presets.length ? presets : ['Default']).forEach((n) => sel.append($('<option>').attr('value', n).text(n)));
          sel.val(res.name).change();
          status.text((status.attr('data-ok') || 'Created & selected:') + ' ' + res.name).css('color', '#6c6');
        } else {
          status.text((status.attr('data-fail') || 'Failed') + (res && res.error ? ': ' + res.error : '')).css('color', '#e66');
        }
      } catch (e) {
        debug.log(e);
        status.text('Failed: ' + e).css('color', '#e66');
      }
      self.css('pointer-events', 'initial');
    });

    $('#option_mergeDuplicate')
      .parent('.right')
      .find('.previous, .next')
      .click(function () {
        $('#option_importCache').val($('#option_mergeDuplicate').val());
      });
  });
})(window.jQuery, window, document);

function boolifyValue(v) {
  return v === 'true' ? true : v === 'false' ? false : v;
}

// Default folder where souvenir screenshots are written when no custom folder is set.
function souvenirDefaultDir() {
  try {
    return path.join(remote.app.getPath('pictures'), 'Achievement Watcher');
  } catch (e) {
    return 'Pictures\\Achievement Watcher';
  }
}

// Resolve a notification sound name to an absolute path. User-imported sounds (in <userData>/sounds)
// take priority over the bundled ones (app/sounds), matching the main process's resolveNotificationSound.
function resolveSoundFile(name) {
  if (!name) return '';
  try {
    const ud = ipcRenderer.sendSync('get-user-data-path-sync');
    const userPath = path.join(ud, 'sounds', name);
    if (settingsFs.existsSync(userPath)) return userPath;
  } catch (e) {}
  return path.join(appPath, 'sounds', name);
}

// Read every Notifications-tab control back into app.config. Mirrors the per-section logic of the
// OK-save handler but scoped to the notification view so it can run on every change (auto-save).
function readNotificationSettings() {
  $('#options-notify-common .right')
    .children('select')
    .each(function () {
      if (this.id === 'option_groupToast') return; // persists under notification_toast (handled below)
      if (this.id !== '' && $(this).val() !== '') app.config.notification[this.id.replace('option_', '')] = boolifyValue($(this).val());
    });
  $('#options-notify-transport .right')
    .children('select')
    .each(function () {
      if (this.id !== '' && $(this).val() !== '') app.config.notification_transport[this.id.replace('option_', '')] = boolifyValue($(this).val());
    });
  // Group-by-game sits in the common group visually but is persisted under notification_toast.
  if ($('#option_groupToast').val() !== '') app.config.notification_toast.groupToast = boolifyValue($('#option_groupToast').val());

  // Overlay (in-game) notification — enable in notification_transport, look in overlay.notification*.
  app.config.notification_transport.mode = $('#option_notifMode').val() || 'toast';
  if (!app.config.overlay) app.config.overlay = {};
  app.config.overlay.notificationPreset = $('#option_overlayPreset').val() || 'Default';
  app.config.overlay.notificationPresetRare = $('#option_overlayPresetRare').val() || '';
  app.config.overlay.notificationPresetPlatinum = $('#option_overlayPresetPlatinum').val() || '';
  app.config.overlay.notificationPosition = $('#option_overlayPosition').val() || 'center-bottom';
  app.config.overlay.notificationScale = parseFloat($('#option_overlayScale').val()) || 1;
  app.config.overlay.notificationSound = $('#option_overlaySound').val() || '';
  const volRaw = parseInt($('#option_overlayVolume').val(), 10);
  app.config.overlay.notificationVolume = Number.isFinite(volRaw) ? volRaw : 100;
  const durRaw = $('#option_overlayDuration').val();
  app.config.overlay.notificationDuration = durRaw === 'auto' || !durRaw ? 'auto' : parseInt(durRaw, 10) || 'auto';

  // Souvenir screenshot — dir is set by its own folder-picker button and preserved here.
  if (!app.config.souvenir) app.config.souvenir = {};
  app.config.souvenir.screenshot = $('#option_souvenirScreenshot').val() === 'true';
}

// Debounced auto-save for the Notifications tab. No-op until the form has finished populating.
function autosaveNotifications() {
  if (!settingsReady) return;
  try {
    readNotificationSettings();
  } catch (e) {
    debug.log(e);
    return;
  }
  clearTimeout(notifAutosaveTimer);
  notifAutosaveTimer = setTimeout(() => {
    settings.setUserDataPath(ipcRenderer.sendSync('get-user-data-path-sync'));
    settings.save(app.config).catch((err) => debug.log(err));
  }, 200);
}

function populateUserDirList(option) {
  let dir = option.dir || option.path || '';
  if (!dir) return;

  let options = {
    dir,
    notify: true,
    reverse: option.reverse || false,
  };

  let alreadyInList = false;
  $('#settings #dirlist > li').each(function () {
    let dir = $(this).find('.path span').text();
    if (path.normalize(dir) == path.normalize(options.dir)) {
      alreadyInList = true;
      return false; //break out of each() loop
    }
  });

  if (alreadyInList) {
    debug.log('-> Already in list');
    return;
  }

  let template = `<li>
                <div class="path" title="${escapeHtml(options.dir)}"><span>${escapeHtml(options.dir)}</span></div>
                <div class="controls">
                  <ul>
                    <li class="edit"><i class="fas fa-pen"></i></li>
                    <li class="trash"><i class="fas fa-trash-alt"></i></li>
                  </ul>
                </div>
              </li>`;

  if (options.reverse) {
    $('#settings #dirlist').append(template);
  } else {
    $('#settings #dirlist').prepend(template);
  }

  let elem = options.reverse ? $('#settings #dirlist > li').last() : $('#settings #dirlist > li').first();

  if (elem.find('.path span').width() >= 350 || options.dir.length > 42) {
    elem.find('.path').addClass('overflow');
  }

  elem.find('.controls .trash').click(function () {
    elem.remove();
  });
  elem.find('.controls .edit').click(async function () {
    let path = elem.find('.path span').text();

    let filePaths = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
      defaultPath: path,
      properties: ['openDirectory', 'showHiddenFiles'],
    });
    try {
      if (filePaths) {
        debug.log(`Editing folder to: ${filePaths}`);

        if (await userDir.check(filePaths[0])) {
          elem.find('.path').attr('title', filePaths[0]);
          elem.find('.path span').text(filePaths[0]);
          elem.find('.path').removeClass('overflow');
          if (elem.find('.path span').width() >= 350) {
            elem.find('.path').addClass('overflow');
          }
          debug.log('-> Edited');
        } else {
          debug.log('-> Invalid folder');
          remote.dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Invalid folder',
            message: $("#settings .content[data-view='folder'] > .controls .info p")
              .html()
              .replace(/\s{2,}/g, '')
              .replace(/<br>/g, '\n'),
          });
        }
      } else {
        debug.log('Editing folder: User Cancel');
      }
    } catch (err) {
      remote.dialog.showMessageBoxSync({
        type: 'error',
        title: 'Unexpected Error',
        message: 'Error editing custom folder',
        detail: `${err}`,
      });
    }
  });
}

function populateLibraryDirList(option) {
  let dir = option.dir || option.path || '';
  if (!dir) return;

  let options = {
    dir,
    reverse: option.reverse || false,
  };

  let alreadyInList = false;
  $('#settings #libdirlist > li').each(function () {
    let dir = $(this).find('.path span').text();
    if (path.normalize(dir) == path.normalize(options.dir)) {
      alreadyInList = true;
      return false; //break out of each() loop
    }
  });

  if (alreadyInList) {
    debug.log('-> Already in list');
    return;
  }

  let template = `<li>
                <div class="path" title="${escapeHtml(options.dir)}"><span>${escapeHtml(options.dir)}</span></div>
                <div class="controls">
                  <ul>
                    <li class="edit"><i class="fas fa-pen"></i></li>
                    <li class="trash"><i class="fas fa-trash-alt"></i></li>
                  </ul>
                </div>
              </li>`;

  if (options.reverse) {
    $('#settings #libdirlist').append(template);
  } else {
    $('#settings #libdirlist').prepend(template);
  }

  let elem = options.reverse ? $('#settings #libdirlist > li').last() : $('#settings #libdirlist > li').first();

  if (elem.find('.path span').width() >= 350 || options.dir.length > 42) {
    elem.find('.path').addClass('overflow');
  }

  elem.find('.controls .trash').click(function () {
    elem.remove();
  });
  elem.find('.controls .edit').click(function () {
    let dirPath = elem.find('.path span').text();

    let filePaths = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
      defaultPath: dirPath,
      properties: ['openDirectory', 'showHiddenFiles'],
    });
    try {
      if (filePaths) {
        debug.log(`Editing library folder to: ${filePaths}`);
        elem.find('.path').attr('title', filePaths[0]);
        elem.find('.path span').text(filePaths[0]);
        elem.find('.path').removeClass('overflow');
        if (elem.find('.path span').width() >= 350) {
          elem.find('.path').addClass('overflow');
        }
        debug.log('-> Edited');
      } else {
        debug.log('Editing library folder: User Cancel');
      }
    } catch (err) {
      remote.dialog.showMessageBoxSync({
        type: 'error',
        title: 'Unexpected Error',
        message: 'Error editing library folder',
        detail: `${err}`,
      });
    }
  });
}

function populateLegitUsers(selected) {
  let list = ipcRenderer.sendSync('get-steam-user-list');
  let selector = $('#option_mainSteam');
  let defaultOption = selector.find('option[value="0"]');
  defaultOption.prop('selected', selected === '0');
  selector.empty();
  selector.append(defaultOption);
  if (!list || list.length === 0) return;
  for (let user of list)
    selector.append(
      $('<option>')
        .attr('value', user.user)
        .prop('selected', selected === user.user)
        .text(user.name)
    );
}
