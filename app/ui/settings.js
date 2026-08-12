'use strict';

const remote = require('@electron/remote');
const path = require('path');
// app.js is loaded immediately after this file as a classic script and declares `const fs` in the
// same global lexical scope. Keep a settings-specific name here or Chromium rejects all of app.js.
const settingsFs = require('fs');

const appPath = remote.app.getAppPath();
const { escapeHtml } = require(path.join(appPath, 'util/escapeHtml.js'));
const userThemes = require(path.join(appPath, 'util/userThemes.js'));
const themeLayers = require(path.join(appPath, 'util/themeLayers.js'));
const scanScopeTools = require(path.join(appPath, 'parser/scanScope.js'));
const { t } = require(path.join(appPath, 'locale/t.js'));
let listeningHotkey = false;
let keysDown = new Set();
let keys = '';
let holdingKeysCheck = null;
// Notifications tab auto-saves on every change once the form is populated; this guard prevents
// the initial `.val(...).change()` population from triggering a save storm / saving stale values.
let settingsReady = false;
let notifAutosaveTimer = null;
const SETTINGS_SAVE_TIMEOUT_MS = 30000;

// Apply a stored theme value: built-ins switch <html data-theme>, user themes and
// the Custom theme inject their CSS through the shared user-theme <style> element.
function applyThemeValue(value) {
  const user = userThemes.parseValue(value);
  if (user || value === 'custom') {
    document.documentElement.dataset.theme = 'default';
  } else {
    document.documentElement.dataset.theme = value || 'default';
  }
  ipcRenderer
    .invoke('get-theme-payload', value || 'default')
    .then((payload) => {
      const css = [payload && payload.appCss ? payload.appCss : '', payload && payload.userCss ? payload.userCss : ''].join('\n');
      userThemes.applyCss(css);
    })
    .catch(() => userThemes.applyCss(''));
}

// Populate the theme dropdown: the built-ins + Custom + any user theme in <userData>\themes.
function populateThemeSelect() {
  const sel = $('#option_theme');
  const wanted = (app.config.general && app.config.general.theme) || 'default';
  sel.empty();
  [
    ['default', 'Steam Blue'],
    ['oled', 'OLED Black'],
    ['dracula', 'Dracula'],
    ['graphite', 'Graphite'],
    ['nord', 'Nord'],
    ['gruvbox', 'Gruvbox'],
    ['tokyonight', 'Tokyo Night'],
    ['catppuccin', 'Catppuccin Mocha'],
    ['rosepine', 'Rosé Pine'],
    ['synthwave', "Synthwave '84"],
    ['everforest', 'Everforest'],
    ['cyberpunk', 'Cyberpunk'],
    ['ember', 'Ember'],
    ['ocean', 'Ocean'],
    ['hacker', 'Hacker'],
    ['burgundy', 'Burgundy'],
    ['champagne', 'Champagne'],
  ].forEach(([value, label]) => sel.append($('<option>').attr('value', value).text(label)));
  sel.append($('<option>').attr('value', 'custom').text(t('themeCustom', 'Custom…', 'Personnalisé…')));
  ipcRenderer
    .invoke('list-user-themes')
    .then((themes) => {
      (themes || []).forEach((theme) =>
        sel.append($('<option>').attr('value', userThemes.valueFor(theme.name)).text(`${t('themeUserPrefix', 'User: ', 'Utilisateur : ')}${theme.name}`))
      );
      const matches = sel.find('option').filter(function () {
        return $(this).val() === wanted;
      });
      sel.val(matches.length ? wanted : 'default').change();
    })
    .catch(() => sel.val(wanted).change());
}

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
      // Settings always opens on General with exactly one active tab. Clear every nav <li>
      // (including the non-clickable .nav-group section labels) so a stray .active never
      // paints the accent pill behind a group header.
      $('#settingNav li').removeClass('active');
      $('#settingNav li[data-view="general"]').addClass('active');
      $('#settings .box section.content').removeClass('active');
      $("#settings .box section.content[data-view='general']").addClass('active');
      $('#game-config').hide();
      $('#settings').show();
      $('#settings .box').fadeIn();
      // Reopening starts from the full list, not from whatever was typed last time.
      if (typeof window.resetSettingsSearch === 'function') window.resetSettingsSearch();
      // Idempotent: sections already wired keep their key and are skipped.
      if (typeof window.initCollapsibleSections === 'function') window.initCollapsibleSections();
      renderBlacklistManager().catch((err) => debug.log(err));

      for (let option in app.config.achievement) {
        if ($(`#option_${option} option[value="${app.config.achievement[option]}"]`).length > 0) {
          $(`#option_${option}`).val(app.config.achievement[option].toString()).change();
        }
      }
      if (!app.config.general) app.config.general = {};
      $('#option_startWithWindows').val(String(app.config.general.startWithWindows !== false)).change();
      $('#option_disableHardwareAccel').val(String(app.config.general.disableHardwareAccel === true)).change();
      $('#option_closeToTray').val(String(app.config.general.closeToTray !== false)).change();
      $('#option_uninstallContextMenu').val(String(app.config.general.uninstallContextMenu !== false)).change();
      if (!app.config.controller) app.config.controller = {};
      $('#option_controllerEnabled').val(String(app.config.controller.enabled === true)).change();
      $('#option_controllerBackend').val(app.config.controller.backend || 'auto').change();
      populateThemeSelect();
      // The saved startup preference is authoritative; repair a mismatched login item.
      const startupPreference = app.config.general.startWithWindows !== false;
      ipcRenderer
        .invoke('startup:get-start-with-windows')
        .then((enabled) => {
          if (enabled === startupPreference) return null;
          debug.log(`startup: login item (${enabled}) disagrees with the saved preference (${startupPreference}); re-applying`);
          return ipcRenderer.invoke('startup:set-start-with-windows', startupPreference);
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
      $('#option_notifMode').val(app.config.notification_transport.mode || 'overlay').change();
      $('#option_overlayPosition').val(cfgOverlay.notificationPosition || 'center-bottom').change();
      $('#option_overlayScale').val(String(cfgOverlay.notificationScale || 1)).change();
      $('#option_overlayRandomSound').val(String(cfgOverlay.randomSound === true)).change();
      $('#option_overlayVolume').val(String(cfgOverlay.notificationVolume != null ? cfgOverlay.notificationVolume : 100)).change();
      $('#option_overlayDuration').val(String(cfgOverlay.notificationDuration || 'auto')).change();
      const cfgSouvenir = app.config.souvenir || {};
      $('#option_souvenirScreenshot').val(String(cfgSouvenir.screenshot === true)).change();
      const souvenirDir = cfgSouvenir.dir && cfgSouvenir.dir.trim() ? cfgSouvenir.dir : souvenirDefaultDir();
      $('#souvenir-dir-display').text(souvenirDir);
      $('#btn-souvenir-dir').attr('title', souvenirDir);
      // Arm auto-save only after both asynchronous lists are populated.
      const presetsReady = ipcRenderer
        .invoke('list-presets')
        .then((presets) => {
          const list = presets && presets.length ? presets : ['Shirow', 'Default'];
          const sel = $('#option_overlayPreset');
          sel.empty();
          list.forEach((name) => {
            sel.append($('<option>').attr('value', name).text(name));
          });
          sel.val(cfgOverlay.notificationPreset || 'Shirow');
          // Per-type overrides: same preset list plus a "same as main" ('' value) first entry.
          for (const [id, value] of [
            ['#option_overlayPresetRare', cfgOverlay.notificationPresetRare || ''],
            ['#option_overlayPresetPlatinum', cfgOverlay.notificationPresetPlatinum || ''],
            ['#option_overlayPresetXenia', cfgOverlay.notificationPresetXenia || ''],
            ['#option_overlayPresetRpcs3', cfgOverlay.notificationPresetRpcs3 || ''],
            ['#option_overlayPresetShadps4', cfgOverlay.notificationPresetShadps4 || ''],
          ]) {
            const typeSel = $(id);
            typeSel.empty();
            typeSel.append($('<option>').attr('value', '').text(typeSel.attr('data-lang-same') || ''));
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
          sel.append($('<option>').attr('value', '').text(sel.attr('data-lang-none') || ''));
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
            ? apikeyEl.attr('data-configured') || ''
            : apikeyEl.attr('data-fallback') || ''
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

    // Preview the real overlay for the selected or first game.
    $('#btn-hotkey-preview').click(function () {
      const openAppid = $('#achievement .wrapper > .header').attr('data-appid');
      const fallbackAppid = $('#game-list .game-box[data-appid]').first().data('appid');
      const previewAppid = openAppid || fallbackAppid;
      if (!previewAppid) return;
      ipcRenderer.send('overlay-preview', String(previewAppid));
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
    async function runUpdateCheck(btn, label) {
      if (btn.hasClass('busy')) return;
      btn.addClass('busy');
      const previousText = label.text();
      label
        .removeClass('update-ok update-error update-info')
        .addClass('update-info')
        .text(t('checking-for-updates', 'Checking…', 'Vérification…'));
      try {
        const result = await ipcRenderer.invoke('check-for-updates');
        if (!result || !result.ok) {
          const msg =
            result && result.error === 'dev-build'
              ? t('update-unavailable-dev', 'Unavailable in dev build', 'Indisponible en version dev')
              : t('update-check-failed', 'Check failed', 'Échec de la vérification');
          label.removeClass('update-info').addClass('update-error').text(msg);
        } else if (result.status === 'available') {
          label.removeClass('update-info').addClass('update-ok').text(t('update-available-short', 'Update available', 'Mise à jour disponible'));
        } else if (result.status === 'uptodate') {
          label.removeClass('update-info').addClass('update-ok').text(t('update-up-to-date-short', 'Up to date', 'À jour'));
        } else {
          label.removeClass('update-info').addClass('update-ok').text(previousText || t('update-checked', 'Check done', 'Vérifié'));
        }
      } catch (err) {
        debug.log(err);
        label.removeClass('update-info').addClass('update-error').text(t('update-check-failed', 'Check failed', 'Échec de la vérification'));
      } finally {
        btn.removeClass('busy');
        setTimeout(() => {
          label.removeClass('update-ok update-error update-info').text('');
          if (previousText) label.text(previousText);
        }, 4500);
      }
    }
    $('#check-for-updates').click(function () {
      runUpdateCheck($(this), $('#check-for-updates-label'));
    });
    $('#footer-check-updates').click(function () {
      runUpdateCheck($(this), $('#footer-update-status'));
    });

    // Scan a library folder for Goldberg/GBE installs and report which ones are missing their schema.
    $('#scan-gbe').click(async function () {
      const result = $('#scan-gbe-result');
      try {
        const goldberg = require(path.join(appPath, 'parser/goldberg.js'));
        const picked = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
          title: t('select-a-game-library-folder-to-scan', 'Select a game-library folder to scan'),
          buttonLabel: t('scan', 'Scan', 'Analyser'),
          properties: ['openDirectory', 'dontAddToRecent'],
        });
        if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) return;
        result.text(t('scanning', 'Scanning…', 'Analyse…'));
        const found = goldberg.findCompatibleGames(picked.filePaths[0]);
        if (found.length === 0) {
          result.text(t('scan-no-gbe-installs', 'No Goldberg / GBE Fork installs found in that folder.', 'Aucune installation Goldberg / GBE Fork trouvée dans ce dossier.'));
          return;
        }
        const unconfigured = found.filter((g) => !g.hasSchema);
        const emuLabel = { gbe: 'GBE Fork', goldberg: 'Goldberg', none: 'unknown' };
        const detail = found
          .map((g) => `${g.appid || '?'} · ${emuLabel[g.emulator] || g.emulator} — ${g.hasSchema ? `${g.schemaCount} achievements` : 'MISSING achievements.json'}\n  ${g.steamSettings}`)
          .join('\n');
        result.text(
          t(
            'scan-found-count',
            'Found {found} install(s); {missing} missing their achievements.json schema.',
            '{found} installation(s) trouvée(s) ; {missing} sans schéma achievements.json.',
            { found: found.length, missing: unconfigured.length }
          )
        );
        remote.dialog.showMessageBox(remote.getCurrentWindow(), {
          type: unconfigured.length ? 'warning' : 'info',
          title: t('goldberg-gbe-fork-scan', 'Goldberg / GBE Fork scan', 'Analyse Goldberg / GBE Fork'),
          message: t('scan-found-message', '{found} install(s) found — {missing} unconfigured', '{found} installation(s) trouvée(s) — {missing} non configurée(s)', {
            found: found.length,
            missing: unconfigured.length,
          }),
          detail,
          buttons: [t('ok', 'OK', 'OK')],
          noLink: true,
        });
      } catch (err) {
        result.text(t('scan-failed-x', 'Scan failed: {error}', 'Échec de l’analyse : {error}', { error: err }));
        debug.log(err);
      }
    });

    $('#btn-settings-cancel, #settings .overlay').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      $('#settings .box').fadeOut(() => {
        $('#settings').hide();
        let elem = $('#settingNav li[data-view]').first();
        $('#settingNav li[data-view]').removeClass('active');
        elem.addClass('active');
        $('#settings .box section.content').removeClass('active');
        $("#settings .box section.content[data-view='" + elem.data('view') + "']").addClass('active');
        self.css('pointer-events', 'initial');
        $('title-bar')[0].inSettings = false;
        // Cancel reverts an unsaved theme preview back to the persisted choice.
        applyThemeValue((app.config.general && app.config.general.theme) || 'default');
        // The Custom theme editor saves live; restore the snapshot taken when it opened.
        if (customThemeSnapshot) {
          ipcRenderer
            .invoke('save-custom-theme', customThemeSnapshot)
            .then((payload) => {
              if (payload && payload.appCss) userThemes.applyCss(payload.appCss);
              ipcRenderer.send('theme-changed', 'custom');
            })
            .catch((err) => debug.log(`custom theme restore failed: ${err}`));
        }
        // Games were un-blacklisted while Settings was open: refresh the library once, now.
        if (window.__awBlacklistDirty) {
          window.__awBlacklistDirty = false;
          app.onStart();
        }
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
              $(this)[0].id === 'option_uninstallContextMenu' ||
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
      app.config.general.uninstallContextMenu = $('#option_uninstallContextMenu').val() !== 'false';
      app.config.general.theme = $('#option_theme').val() || 'default';

      if (!app.config.controller) app.config.controller = {};
      app.config.controller.enabled = $('#option_controllerEnabled').val() === 'true';
      app.config.controller.backend = $('#option_controllerBackend').val() || 'auto';

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
            // groupToast and urgent sit in the common group visually but persist under
            // notification_toast.
            if ($(this)[0].id === 'option_groupToast' || $(this)[0].id === 'option_urgent') return;
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
      if ($('#option_urgent').val() !== '') {
        app.config.notification_toast.urgent = $('#option_urgent').val() === 'true';
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
          closeCustomThemeEditor();
          ipcRenderer.send('theme-changed', $('#option_theme').val() || 'default');
          $('#settings .box').fadeOut(() => {
            self.css('pointer-events', 'initial');
            resetUI();
          });
        })
        .catch((err) => {
          $('#settings .box').fadeOut(() => {
            $('#settings').hide();
            let elem = $('#settingNav li[data-view]').first();
            $('#settingNav li[data-view]').removeClass('active');
            elem.addClass('active');
            $('#settings .box section.content').removeClass('active');
            $("#settings .box section.content[data-view='" + elem.data('view') + "']").addClass('active');
            self.css('pointer-events', 'initial');
            $('title-bar')[0].inSettings = false;

            remote.dialog.showMessageBoxSync({
              type: 'error',
              title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
              message:
                err && err.isStartupSettingError
                  ? t('errorUpdatingStartupSetting', 'Error while updating the startup setting.', 'Erreur lors de la mise à jour du paramètre de démarrage.')
                  : t('errorSavingSettings', 'Error while saving settings.', 'Erreur lors de l’enregistrement des paramètres.'),
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
      const emuText = {
        missing: t('emu-login-missing', 'Enter the Steam username and password first.', "Renseigne d'abord l'identifiant et le mot de passe Steam."),
        running: t('emu-login-running', 'Connecting to Steam… Enter the Steam Guard code if requested.', "Connexion à Steam… Saisis le code Steam Guard s'il est demandé."),
        success: t('emu-login-success', 'Steam login successful. The generate_emu_config refresh token was saved.', 'Connexion Steam réussie. Le refresh token generate_emu_config a été sauvegardé.'),
        failed: t('emu-login-failed', 'Steam login failed', 'Échec de la connexion Steam'),
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

    // Epic account connect: shows unlock state for installed Epic games (epic-official source).
    // The login window and encrypted token storage live in the main process (init.js epic:* IPC).
    (function wireEpicConnect() {
      const T = () =>
        ({
          connectedAs: (n) => t('epic-connected-as', 'Connected{suffix}', 'Connecté{suffix}', { suffix: n ? ': ' + n : '' }),
          notConnected: t('epic-not-connected', 'Not connected', 'Non connecté'),
          connecting: t('epic-connecting', 'Opening the Epic sign-in window…', 'Ouverture de la fenêtre de connexion Epic…'),
          connected: t('epic-connected', 'Epic account connected.', 'Compte Epic connecté.'),
          cancelled: t('epic-cancelled', 'Sign-in cancelled.', 'Connexion annulée.'),
          failed: t('epic-failed', 'Epic sign-in failed', 'Échec de la connexion Epic'),
          disconnected: t('epic-disconnected', 'Epic account disconnected.', 'Compte Epic déconnecté.'),
        });
      const status = $('#epic-connect-status');
      const badge = $('#epic-connect-badge');
      const connectBtn = $('#epic-connect-btn');
      const disconnectBtn = $('#epic-disconnect-btn');
      const setStatus = (text, cls = '') => status.removeClass('success error running').addClass(cls).text(text || '');

      // Localize the static card labels here (kept out of loader.js's fragile nth-child i18n).
      $('#epic-connect-title').text(t('epic-title', 'Epic Games account', 'Compte Epic Games'));
      $('#epic-connect-desc').text(
        t(
          'epic-desc',
          'Optional. Connect your Epic account to show which achievements you have unlocked in installed Epic games. Achievement names, descriptions and rarity already work without connecting. Your Epic token is stored encrypted on this PC.',
          'Optionnel. Connecte ton compte Epic pour afficher les succès que tu as débloqués dans les jeux Epic installés. Les noms, descriptions et la rareté fonctionnent déjà sans connexion. Ton jeton Epic est stocké chiffré sur ce PC.'
        )
      );
      $('#epic-connect-btn-hint').text(t('epic-btn-hint', 'opens the Epic sign-in window', 'ouvre la fenêtre de connexion Epic'));
      $('#epic-connect-badge-label').text(t('connected', 'Connected', 'Connecté'));
      $('#epic-disconnect-btn-label').text(t('disconnect', 'Disconnect', 'Déconnecter'));

      async function refresh() {
        let s = {};
        try {
          s = (await ipcRenderer.invoke('epic:auth-status')) || {};
        } catch {}
        if (s.connected) {
          badge.show();
          disconnectBtn.show();
          $('#epic-connect-btn-label').text(t('epic-reconnect', 'Reconnect', 'Reconnecter'));
          setStatus(T().connectedAs(s.displayName), 'success');
        } else {
          badge.hide();
          disconnectBtn.hide();
          $('#epic-connect-btn-label').text(t('epic-connect', 'Connect Epic account', 'Connecter le compte Epic'));
          if (!status.hasClass('error')) setStatus(T().notConnected);
        }
      }

      connectBtn.off('click').on('click', async function () {
        if (connectBtn.hasClass('disabled')) return;
        connectBtn.addClass('disabled').css('pointer-events', 'none');
        setStatus(T().connecting, 'running');
        try {
          const res = (await ipcRenderer.invoke('epic:login')) || {};
          if (res.ok) setStatus(T().connected, 'success');
          else if (res.error === 'window-closed') setStatus(T().cancelled, 'error');
          else setStatus(`${T().failed}${res.error ? ': ' + res.error : ''}`, 'error');
        } catch (err) {
          setStatus(`${T().failed}: ${err.message || err}`, 'error');
        } finally {
          connectBtn.removeClass('disabled').css('pointer-events', '');
          refresh();
        }
      });

      disconnectBtn.off('click').on('click', async function () {
        try {
          await ipcRenderer.invoke('epic:logout');
          setStatus(T().disconnected);
        } catch (err) {
          setStatus(`${err.message || err}`, 'error');
        }
        refresh();
      });

      refresh();
    })();

    // Xbox PC account card (Settings > Sources): connect Microsoft/Xbox Network, then import the
    // library. Import progress arrives as `xbox-pc:import-progress` IPC events.
    (function () {
      const T = () =>
        ({
          connectedAs: (n) => t('xbox-connected-as', 'Connected{suffix}', 'Connecté{suffix}', { suffix: n ? ': ' + n : '' }),
          notConnected: t('xbox-not-connected', 'Not connected', 'Non connecté'),
          connecting: t('xbox-connecting', 'Opening the Microsoft sign-in window…', 'Ouverture de la fenêtre de connexion Microsoft…'),
          connected: t('xbox-connected', 'Xbox account connected.', 'Compte Xbox connecté.'),
          cancelled: t('xbox-cancelled', 'Sign-in cancelled.', 'Connexion annulée.'),
          failed: t('xbox-failed', 'Xbox sign-in failed', 'Échec de la connexion Xbox'),
          disconnected: t('xbox-disconnected', 'Xbox account disconnected.', 'Compte Xbox déconnecté.'),
          importing: t('xbox-importing', 'Importing the Xbox PC library…', 'Importation de la bibliothèque Xbox…'),
          imported: (r) =>
            t('xbox-imported', 'Import complete: {created} created, {updated} updated, {failed} failed.', 'Importation terminée : {created} créé(s), {updated} mis à jour, {failed} échec(s).', {
              created: r?.created || 0,
              updated: r?.updated || 0,
              failed: r?.failed || 0,
            }),
          importFailed: t('xbox-import-failed', 'Xbox library import failed', 'Échec de l’importation Xbox'),
        });
      const status = $('#xbox-connect-status');
      const badge = $('#xbox-connect-badge');
      const connectBtn = $('#xbox-connect-btn');
      const importBtn = $('#xbox-import-btn');
      const disconnectBtn = $('#xbox-disconnect-btn');
      const setStatus = (text, cls = '') => status.removeClass('success error running').addClass(cls).text(text || '');

      $('#xbox-connect-title').text(t('xbox-title', 'Xbox PC account', 'Compte Xbox PC'));
      $('#xbox-connect-desc').text(
        t(
          'xbox-desc',
          'Optional. Connect your Microsoft / Xbox Network account to import your Xbox PC library (Game Pass and Microsoft Store games): achievement names, descriptions, unlock state and rarity are fetched from Xbox Network and cached locally. Your session token is stored encrypted on this PC.',
          'Optionnel. Connecte ton compte Microsoft / Xbox Network pour importer ta bibliothèque Xbox PC (Game Pass et Microsoft Store) : noms, descriptions, état de déblocage et rareté sont récupérés depuis Xbox Network puis mis en cache localement. Ton jeton est stocké chiffré sur ce PC.'
        )
      );
      $('#xbox-connect-btn-hint').text(t('xbox-btn-hint', 'opens the Microsoft sign-in window', 'ouvre la fenêtre de connexion Microsoft'));
      $('#xbox-import-btn-hint').text(t('xbox-import-btn-hint', 'fetch achievements from Xbox Network', 'récupère les succès depuis Xbox Network'));
      $('#xbox-connect-badge-label').text(t('connected', 'Connected', 'Connecté'));
      $('#xbox-disconnect-btn-label').text(t('disconnect', 'Disconnect', 'Déconnecter'));

      async function refresh() {
        let s = {};
        try {
          s = (await ipcRenderer.invoke('xbox-pc:status')) || {};
        } catch {}
        if (s.connected) {
          badge.show();
          importBtn.show();
          disconnectBtn.show();
          $('#xbox-connect-btn-label').text(t('xbox-reconnect', 'Reconnect', 'Reconnecter'));
          setStatus(T().connectedAs(s.gamertag), 'success');
        } else {
          badge.hide();
          importBtn.hide();
          disconnectBtn.hide();
          $('#xbox-connect-btn-label').text(t('xbox-connect', 'Connect Xbox account', 'Connecter le compte Xbox'));
          if (!status.hasClass('error')) setStatus(T().notConnected);
        }
      }

      connectBtn.off('click').on('click', async function () {
        if (connectBtn.hasClass('disabled')) return;
        connectBtn.addClass('disabled').css('pointer-events', 'none');
        setStatus(T().connecting, 'running');
        try {
          const res = (await ipcRenderer.invoke('xbox-pc:login')) || {};
          if (res.ok) setStatus(T().connected, 'success');
          else if (res.error === 'window-closed') setStatus(T().cancelled, 'error');
          else setStatus(`${T().failed}${res.error ? ': ' + res.error : ''}`, 'error');
        } catch (err) {
          setStatus(`${T().failed}: ${err.message || err}`, 'error');
        } finally {
          connectBtn.removeClass('disabled').css('pointer-events', '');
          refresh();
        }
      });

      importBtn.off('click').on('click', async function () {
        if (importBtn.hasClass('disabled')) return;
        importBtn.addClass('disabled').css('pointer-events', 'none');
        setStatus(T().importing, 'running');
        try {
          const res = (await ipcRenderer.invoke('xbox-pc:import', { lang: app.config?.achievement?.lang || 'english' })) || {};
          if (res.ok) {
            setStatus(T().imported(res.result), 'success');
            app.onStart(); // refresh the library so newly imported titles appear
          } else {
            setStatus(`${T().importFailed}${res.error ? ': ' + res.error : ''}`, 'error');
          }
        } catch (err) {
          setStatus(`${T().importFailed}: ${err.message || err}`, 'error');
        } finally {
          importBtn.removeClass('disabled').css('pointer-events', '');
        }
      });

      ipcRenderer.on('xbox-pc:import-progress', (_event, p) => {
        if (p && p.detail) setStatus(`${T().importing} ${p.current}/${p.total} — ${p.detail}`, 'running');
      });

      disconnectBtn.off('click').on('click', async function () {
        try {
          await ipcRenderer.invoke('xbox-pc:disconnect');
          setStatus(T().disconnected);
        } catch (err) {
          setStatus(`${err.message || err}`, 'error');
        }
        refresh();
      });

      refresh();
    })();

    // Bind on the controls themselves as well as using a bubbling event above. This keeps the
    // dependency UI reliable for keyboard changes, programmatic population and the arrow buttons.
    $('#options-emulator select, #options-emulator2 select').on('change', updateEmulatorUi);

    // ---- Custom theme editor (Settings > General > Custom…) -----------------
    const CUSTOM_LAYER_META = [
      {
        id: 'bg',
        icon: 'fa-desktop',
        label: t('theme-layer-bg', 'Window background', 'Fond de la fenêtre'),
        hint: t('theme-layer-bg-hint', 'Behind the whole app', "Derrière toute l'interface"),
      },
      {
        id: 'header',
        icon: 'fa-grip-lines',
        label: t('theme-layer-header', 'Top bar', 'Barre du haut'),
        hint: t('theme-layer-header-hint', 'The thin bar at the very top', 'La fine barre tout en haut'),
      },
      {
        id: 'panel',
        icon: 'fa-th-list',
        label: t('theme-layer-panel', 'Library panel', 'Panneau de bibliothèque'),
        hint: t('theme-layer-panel-hint', 'The big panel with the game list', 'Le grand panneau avec la liste des jeux'),
      },
      {
        id: 'card',
        icon: 'fa-clone',
        label: t('theme-layer-card', 'Cards & rows', 'Cartes et lignes'),
        hint: t('theme-layer-card-hint', 'Game tiles, achievement rows, dialogs', 'Tuiles de jeux, lignes de succès, dialogues'),
      },
      {
        id: 'settings',
        icon: 'fa-cog',
        label: t('theme-layer-settings', 'Settings window', 'Fenêtre de réglages'),
        hint: t('theme-layer-settings-hint', 'The window you are reading now', 'La fenêtre que tu lis actuellement'),
      },
      {
        id: 'text',
        icon: 'fa-font',
        label: t('theme-layer-text', 'Text', 'Texte'),
        hint: t('theme-layer-text-hint', 'Main text color', 'Couleur du texte principal'),
      },
      {
        id: 'muted',
        icon: 'fa-paragraph',
        label: t('theme-layer-muted', 'Muted text', 'Texte atténué'),
        hint: t('theme-layer-muted-hint', 'Secondary text and labels', 'Textes secondaires et libellés'),
      },
      {
        id: 'border',
        icon: 'fa-border-all',
        label: t('theme-layer-border', 'Borders', 'Bordures'),
        hint: t('theme-layer-border-hint', 'Lines around panels and controls', 'Lignes autour des panneaux et contrôles'),
      },
      {
        id: 'accent',
        icon: 'fa-palette',
        label: t('theme-layer-accent', 'Accent', 'Accentuation'),
        hint: t('theme-layer-accent-hint', 'Buttons, highlights, progress', 'Boutons, surlignages, progression'),
      },
    ];
    const CUSTOM_FIT_LABELS = {
      cover: t('theme-fit-cover', 'Cover', 'Couvrir'),
      contain: t('theme-fit-contain', 'Contain', 'Contenir'),
      repeat: t('theme-fit-repeat', 'Repeat', 'Répéter'),
      fill: t('theme-fit-fill', 'Stretch', 'Étirer'),
    };
    const CUSTOM_EFFECT_LABELS = {
      veil: t('theme-effect-veil', 'Colored veil', 'Voile coloré'),
      blur: t('theme-effect-blur', 'Blur', 'Flou'),
    };
    const CUSTOM_IMAGE_LAYERS = themeLayers.IMAGE_LAYER_IDS;
    function gradientAngleFromDom(row) {
      const n = Number(row.find('.theme-layer-gradient-angle').val());
      return Number.isFinite(n) ? n : 180;
    }
    let customThemeDraft = null;
    let customThemeSnapshot = null;
    let customThemeSaveTimer = null;

    function customThemeFromDom() {
      const draft = {};
      for (const meta of CUSTOM_LAYER_META) {
        const row = $(`#theme-customizer-layers .theme-layer-row[data-layer="${meta.id}"]`);
        if (!row.length) continue;
        const current = (customThemeDraft && customThemeDraft[meta.id]) || {};
        const layer = { color: row.find('.theme-layer-color').val() || current.color || '#1b2838' };
        if (CUSTOM_IMAGE_LAYERS.includes(meta.id)) {
          layer.image = current.image || '';
          layer.fit = row.find('.theme-layer-fit').val() || current.fit || 'cover';
          const grad = (current.gradient && typeof current.gradient === 'object' ? current.gradient : {});
          layer.gradient = {
            enabled: row.find('.theme-layer-gradient-enabled').is(':checked'),
            from: row.find('.theme-layer-gradient-from').val() || grad.from || layer.color || current.color || '#1b2838',
            to: row.find('.theme-layer-gradient-to').val() || grad.to || grad.from || layer.color || current.color || '#1b2838',
            angle: gradientAngleFromDom(row),
          };
          layer.effect = {
            enabled: row.find('.theme-layer-effect-enabled').is(':checked'),
            type: row.find('.theme-layer-effect-type').val() === 'blur' ? 'blur' : 'veil',
            color: row.find('.theme-layer-effect-color').val() || '#000000',
            opacity: Number(row.find('.theme-layer-effect-opacity').val() || 40),
            blur: Number(row.find('.theme-layer-effect-blur').val() || 8),
            blurImage: (current.effect && current.effect.blurImage) || '',
          };
        }
        draft[meta.id] = layer;
      }
      return draft;
    }

    function renderCustomThemeLayers(theme) {
      customThemeDraft = theme;
      const container = $('#theme-customizer-layers');
      container.empty();
      for (const meta of CUSTOM_LAYER_META) {
        const layer = (theme && theme[meta.id]) || {};
        const effect = layer.effect || {};
        const row = $('<div>').addClass('theme-layer-row').attr('data-layer', meta.id);
        const previewImage =
          effect.enabled === true && effect.type === 'blur' && effect.blurImage ? effect.blurImage : layer.image || '';
        const grad = (layer.gradient && typeof layer.gradient === 'object' ? layer.gradient : {});
        const gradAngle = Number.isFinite(Number(grad.angle)) ? Number(grad.angle) : 180;
        const gradStyle = grad.enabled === true
          ? `linear-gradient(${gradAngle}deg, ${grad.from || layer.color || '#1b2838'} 0%, ${grad.to || grad.from || layer.color || '#1b2838'} 100%)`
          : '';
        const previewStyle =
          `background-color:${grad.enabled === true ? 'transparent' : (layer.color || '#1b2838')};` +
          (previewImage
            ? `background-image:${gradStyle ? gradStyle + ',' : ''}${require(path.join(appPath, 'util/cssUrl.js')).cssUrl(require('url').pathToFileURL(previewImage).href)};`
            : gradStyle
            ? `background-image:${gradStyle};`
            : 'background-image:none;');
        const preview = $('<div>').addClass('theme-layer-preview').attr('style', previewStyle);
        // Remember the resolved preview image (source or blur copy) so the live gradient
        // refresh can rebuild the swatch exactly like the real renderer does.
        row.data('previewImage', previewImage);
        const label = $('<div>')
          .addClass('theme-layer-label')
          .html(
            `<i class="fas ${meta.icon}"></i><div class="theme-layer-label-text">` +
              `<div class="theme-layer-name">${escapeHtml(meta.label)}</div>` +
              `<div class="theme-layer-hint">${escapeHtml(meta.hint || '')}</div></div>`
          );
        const controls = $('<div>').addClass('theme-layer-controls');
        controls.append($('<input>').attr('type', 'color').addClass('theme-layer-color').val(layer.color || '#1b2838'));
        if (CUSTOM_IMAGE_LAYERS.includes(meta.id)) {
          const gradientToggle = $('<label>').addClass('theme-layer-effect-toggle');
          gradientToggle.append(
            $('<input>').attr('type', 'checkbox').addClass('theme-layer-gradient-enabled').prop('checked', grad.enabled === true)
          );
          gradientToggle.append($('<span>').text(t('theme-layer-gradient', 'Gradient', 'Dégradé')));
          controls.append(gradientToggle);

          const gradientPanel = $('<div>').addClass('theme-layer-effect theme-layer-gradient-panel' + (grad.enabled === true ? ' open' : ''));
          gradientPanel.data('gradient', grad).data('baseColor', layer.color || '#1b2838');
          const angleLabels = {
            0: t('theme-gradient-angle-0', 'Bottom → Top', 'Bas → Haut'),
            45: t('theme-gradient-angle-45', 'Bottom-left → Top-right', 'Bas-gauche → Haut-droite'),
            90: t('theme-gradient-angle-90', 'Left → Right', 'Gauche → Droite'),
            135: t('theme-gradient-angle-135', 'Top-left → Bottom-right', 'Haut-gauche → Bas-droite'),
            180: t('theme-gradient-angle-180', 'Top → Bottom', 'Haut → Bas'),
            270: t('theme-gradient-angle-270', 'Top-right → Bottom-left', 'Haut-droite → Bas-gauche'),
          };
          const fromGroup = $('<div>').addClass('theme-layer-effect-group');
          fromGroup.append($('<label>').text(t('theme-gradient-from', 'From', 'De')));
          fromGroup.append($('<input>').attr('type', 'color').addClass('theme-layer-gradient-from').val(grad.from || layer.color || '#1b2838'));
          const toGroup = $('<div>').addClass('theme-layer-effect-group');
          toGroup.append($('<label>').text(t('theme-gradient-to', 'To', 'À')));
          toGroup.append($('<input>').attr('type', 'color').addClass('theme-layer-gradient-to').val(grad.to || grad.from || layer.color || '#1b2838'));
          const angleSelect = $('<select>').addClass('theme-layer-gradient-angle theme-layer-effect-type');
          for (const [deg, labelText] of Object.entries(angleLabels)) {
            angleSelect.append($('<option>').attr('value', deg).text(labelText));
          }
          angleSelect.val(String(grad.angle && angleLabels[grad.angle] ? grad.angle : 180));
          const angleGroup = $('<div>').addClass('theme-layer-effect-group');
          angleGroup.append($('<label>').text(t('theme-gradient-direction', 'Direction', 'Direction')));
          angleGroup.append(angleSelect);
          gradientPanel.append(fromGroup, toGroup, angleGroup);
          // The gradient panel must live OUTSIDE the one-line controls row (which is a
          // nowrap flex container): a flex child forced to 100% width would keep its
          // space and overlap the other controls even while collapsed.
          row.data('gradientPanel', gradientPanel);

          const pick = $('<button>')
            .attr('type', 'button')
            .addClass('theme-layer-image btn')
            .text(t('theme-layer-choose-image', 'Image…', 'Image…'));
          const clear = $('<button>')
            .attr('type', 'button')
            .addClass('theme-layer-clear-image')
            .attr('title', t('theme-layer-remove-image', 'Remove image', "Retirer l'image"))
            .text('×');
          const filename = $('<span>').addClass('theme-layer-filename').text(layer.image ? path.basename(layer.image) : '');
          const fit = $('<select>').addClass('theme-layer-fit');
          for (const [value, labelText] of Object.entries(CUSTOM_FIT_LABELS)) {
            fit.append($('<option>').attr('value', value).text(labelText));
          }
          fit.val(layer.fit || 'cover');
          fit.prop('disabled', !layer.image);
          clear.prop('disabled', !layer.image);
          controls.append(pick, filename, clear, fit);

          const effectToggle = $('<label>').addClass('theme-layer-effect-toggle');
          effectToggle.append(
            $('<input>').attr('type', 'checkbox').addClass('theme-layer-effect-enabled').prop('checked', effect.enabled === true)
          );
          effectToggle.append($('<span>').text(t('theme-effect-label', 'Effect', 'Effet')));

          const effectPanel = $('<div>').addClass('theme-layer-effect theme-layer-effect-panel' + (effect.enabled === true ? ' open' : ''));
          const effectType = $('<select>').addClass('theme-layer-effect-type');
          for (const [value, labelText] of Object.entries(CUSTOM_EFFECT_LABELS)) {
            effectType.append($('<option>').attr('value', value).text(labelText));
          }
          effectType.val(effect.type === 'blur' ? 'blur' : 'veil');

          const veilGroup = $('<div>').addClass('theme-layer-effect-group veil-group').toggle(effect.type !== 'blur');
          veilGroup.append(
            $('<label>').text(t('theme-effect-color-label', 'Color', 'Couleur')),
            $('<input>').attr('type', 'color').addClass('theme-layer-effect-color').val(effect.color || '#000000')
          );
          veilGroup.append(
            $('<label>').text(t('theme-effect-opacity-label', 'Opacity', 'Opacité')),
            $('<input>')
              .attr('type', 'range')
              .attr('min', '0')
              .attr('max', '100')
              .addClass('theme-layer-effect-opacity')
              .val(effect.opacity != null ? effect.opacity : 40),
            $('<span>').addClass('theme-layer-effect-value').text((effect.opacity != null ? effect.opacity : 40) + '%')
          );

          const blurGroup = $('<div>').addClass('theme-layer-effect-group blur-group').toggle(effect.type === 'blur');
          blurGroup.append(
            $('<label>').text(t('theme-effect-blur-label', 'Intensity', 'Intensité')),
            $('<input>')
              .attr('type', 'range')
              .attr('min', '0')
              .attr('max', '40')
              .addClass('theme-layer-effect-blur')
              .val(effect.blur != null ? effect.blur : 8),
            $('<span>').addClass('theme-layer-effect-value').text((effect.blur != null ? effect.blur : 8) + 'px')
          );

          effectPanel.append(effectType, veilGroup, blurGroup);
          controls.append(effectToggle);
          row.data('effectPanel', effectPanel);
        }
        row.append(preview, label, controls);
        const gradientPanelEl = row.data('gradientPanel');
        if (gradientPanelEl) row.append(gradientPanelEl);
        const effectPanelEl = row.data('effectPanel');
        if (effectPanelEl) row.append(effectPanelEl);
        // With an image, keep the image picker and its controls on one line in place of the
        // color picker; removing the image brings the color picker back.
        if (CUSTOM_IMAGE_LAYERS.includes(meta.id)) {
          const hasImage = !!layer.image;
          // An image replaces the color visually, so the picker is hidden; an enabled gradient
          // just disables it (kept in place to avoid shifting the row controls).
          row.find('.theme-layer-color').toggle(!hasImage).prop('disabled', grad.enabled === true);
          row.find('.theme-layer-image').show();
          row.find('.theme-layer-filename, .theme-layer-clear-image, .theme-layer-fit').toggle(hasImage);
        }
        container.append(row);
      }
    }

    function scheduleCustomThemeSave() {
      clearTimeout(customThemeSaveTimer);
      customThemeSaveTimer = setTimeout(async () => {
        try {
          const payload = await ipcRenderer.invoke('save-custom-theme', customThemeFromDom());
          if (payload && payload.appCss) userThemes.applyCss(payload.appCss);
          if (payload && payload.customTheme && customThemeDraft) {
            // Keep the generated blur paths without re-rendering (avoids losing focus mid-drag).
            for (const id of CUSTOM_IMAGE_LAYERS) {
              const next = payload.customTheme[id];
              if (next && next.effect && customThemeDraft[id]) customThemeDraft[id].effect.blurImage = next.effect.blurImage;
            }
          }
          ipcRenderer.send('theme-changed', 'custom');
        } catch (err) {
          debug.log(`custom theme save failed: ${err}`);
        }
      }, 250);
    }

    function updateEffectPanel(row) {
      const enabled = row.find('.theme-layer-effect-enabled').is(':checked');
      row.find('.theme-layer-effect-panel').toggleClass('open', enabled);
      const isBlur = row.find('.theme-layer-effect-type').val() === 'blur';
      row.find('.veil-group').toggle(enabled && !isBlur);
      row.find('.blur-group').toggle(enabled && isBlur);
    }

    function openCustomThemeEditor() {
      $('#theme-customizer').show();
      ipcRenderer
        .invoke('get-theme-payload', 'custom')
        .then((payload) => {
          const theme = payload && payload.customTheme ? payload.customTheme : themeLayers.defaultCustomTheme();
          customThemeSnapshot = theme;
          renderCustomThemeLayers(theme);
        })
        .catch((err) => debug.log(`custom theme load failed: ${err}`));
    }

    function closeCustomThemeEditor() {
      $('#theme-customizer').hide();
      clearTimeout(customThemeSaveTimer);
      customThemeSnapshot = null;
    }

    $('#theme-customizer-layers').on('input change', '.theme-layer-color, .theme-layer-fit', () => scheduleCustomThemeSave());

    // Keep the small per-row swatch in sync with the color picker immediately (the picker itself
    // already reflects its own value natively; this mirrors it onto our custom preview box, which
    // otherwise only gets its background from the initial render).
    $('#theme-customizer-layers').on('input change', '.theme-layer-color', function () {
      $(this).closest('.theme-layer-row').find('.theme-layer-preview').css('background-color', $(this).val());
    });

    $('#theme-customizer-layers').on('change', '.theme-layer-effect-enabled', function () {
      updateEffectPanel($(this).closest('.theme-layer-row'));
      scheduleCustomThemeSave();
    });

    $('#theme-customizer-layers').on('change', '.theme-layer-effect-type', function () {
      updateEffectPanel($(this).closest('.theme-layer-row'));
      scheduleCustomThemeSave();
    });

    $('#theme-customizer-layers').on('input', '.theme-layer-effect-color, .theme-layer-effect-opacity, .theme-layer-effect-blur', function () {
      const row = $(this).closest('.theme-layer-row');
      if ($(this).hasClass('theme-layer-effect-opacity')) {
        row.find('.veil-group .theme-layer-effect-value').text($(this).val() + '%');
      } else if ($(this).hasClass('theme-layer-effect-blur')) {
        row.find('.blur-group .theme-layer-effect-value').text($(this).val() + 'px');
      }
      scheduleCustomThemeSave();
    });

    // Gradient editor: keep the collapsed panel, the layer preview and the saved theme
    // in sync while the user picks the two colors and the direction.
    function refreshGradientPreview(row) {
      const baseColor = row.find('.theme-layer-color').val() || '#1b2838';
      const enabled = row.find('.theme-layer-gradient-enabled').is(':checked');
      const from = row.find('.theme-layer-gradient-from').val() || baseColor;
      const to = row.find('.theme-layer-gradient-to').val() || from;
      const angle = gradientAngleFromDom(row);
      const preview = row.find('.theme-layer-preview');
      // An enabled gradient replaces the layer's base color entirely (the generated app/overlay
      // CSS drops the opaque color backdrop too), so the swatch must not keep the base color.
      preview.css('background-color', enabled ? 'transparent' : baseColor);
      const layers = [];
      if (enabled) layers.push(`linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`);
      const imageSrc = row.data('previewImage') || '';
      if (imageSrc) layers.push(require(path.join(appPath, 'util/cssUrl.js')).cssUrl(imageSrc));
      preview.css('background-image', layers.length ? layers.join(',') : 'none');
    }

    $('#theme-customizer-layers').on('change', '.theme-layer-gradient-enabled', function () {
      const row = $(this).closest('.theme-layer-row');
      const panel = row.find('.theme-layer-gradient-panel');
      panel.toggleClass('open', this.checked);
      // Keep the picker in place (no layout shift) but disable it while the gradient replaces it.
      row.find('.theme-layer-color').prop('disabled', this.checked);
      if (this.checked) {
        // A freshly enabled gradient follows the layer color unless the user already
        // picked custom colors for it (detected by comparing with the stored base color).
        const grad = panel.data('gradient') || {};
        const base = panel.data('baseColor') || '#1b2838';
        if ((!grad.from || grad.from === base) && (!grad.to || grad.to === base)) {
          const color = row.find('.theme-layer-color').val() || '#1b2838';
          row.find('.theme-layer-gradient-from').val(color);
          row.find('.theme-layer-gradient-to').val(color);
        }
      }
      refreshGradientPreview(row);
      scheduleCustomThemeSave();
    });

    $('#theme-customizer-layers').on('input', '.theme-layer-gradient-from, .theme-layer-gradient-to, .theme-layer-gradient-angle', function () {
      refreshGradientPreview($(this).closest('.theme-layer-row'));
      scheduleCustomThemeSave();
    });

    $('#theme-customizer-layers').on('click', '.theme-layer-image', async function () {
      const layer = $(this).closest('.theme-layer-row').data('layer');
      try {
        const result = await ipcRenderer.invoke('pick-theme-image', layer);
        if (result && result.ok) {
          // Refresh the draft from the live DOM first so changing only the image never
          // resets unsaved color/effect edits made in other rows.
          const draft = customThemeFromDom();
          if (draft[layer]) {
            draft[layer].image = result.file;
            renderCustomThemeLayers(draft);
          }
          scheduleCustomThemeSave();
        }
      } catch (err) {
        debug.log(`theme image pick failed: ${err}`);
      }
    });

    $('#theme-customizer-layers').on('click', '.theme-layer-clear-image', function () {
      const layer = $(this).closest('.theme-layer-row').data('layer');
      const draft = customThemeFromDom();
      if (draft[layer] && draft[layer].image) {
        draft[layer].image = '';
        renderCustomThemeLayers(draft);
        scheduleCustomThemeSave();
      }
    });

    $('#theme-customizer-reset').on('click', function () {
      renderCustomThemeLayers(themeLayers.defaultCustomTheme());
      scheduleCustomThemeSave();
    });

    // Live theme preview: applying on change lets the user see the theme before committing with OK;
    // Cancel restores whatever is saved in the config.
    $('#option_theme').on('change', function () {
      const value = $(this).val() || 'default';
      applyThemeValue(value);
      if (value === 'custom') openCustomThemeEditor();
      else closeCustomThemeEditor();
      ipcRenderer.send('theme-changed', value);
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

    $('#settingNav li[data-view]').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      let view = self.data('view');

      $('#settingNav li[data-view]').removeClass('active');
      self.addClass('active');

      $('#settings .box section.content').removeClass('active');
      $("#settings .box section.content[data-view='" + view + "']").addClass('active').scrollTop(0);

      self.css('pointer-events', 'initial');
    });

    // The help screen points to the settings people most often need when a game or notification is
    // missing. Reuse the normal sidebar action so it keeps the active state and scroll behaviour.
    $('#settings [data-help-view]').click(function () {
      const view = String($(this).data('help-view') || '');
      $(`#settingNav li[data-view='${view}']`).trigger('click');
    });

    /* ---- Collapsible sections ----------------------------------------------
       Every section card folds away under its own header, so a long tab can be
       reduced to the handful of sections being worked on. State is per section
       and remembered across sessions.

       Nothing is wrapped, moved or removed: the header gains a chevron and the
       card gains a class, and CSS hides the card's non-header children. That is
       forced by the same constraint as the search filter below — the i18n loader
       binds labels positionally, so the DOM structure has to survive untouched.
    */
    const sectionRules = require(path.join(appPath, 'util/settingsSections.js'));
    const SECTION_STATE_KEY = 'settingsCollapsedSections';

    function readCollapsedSections() {
      try {
        const stored = JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || 'null');
        if (Array.isArray(stored)) return new Set(stored);
      } catch (err) {
        debug.log(`settings sections: unreadable stored state (${err})`);
      }
      return new Set(sectionRules.DEFAULT_COLLAPSED);
    }

    function writeCollapsedSections(keys) {
      try {
        localStorage.setItem(SECTION_STATE_KEY, JSON.stringify([...keys]));
      } catch (err) {
        debug.log(`settings sections: could not persist state (${err})`);
      }
    }

    function setSectionCollapsed(section, collapsed) {
      const el = $(section);
      el.toggleClass('is-collapsed', collapsed);
      const header = sectionRules.headerFor($, section);
      if (header) header.attr('aria-expanded', collapsed ? 'false' : 'true');
    }

    function initCollapsibleSections() {
      const collapsed = readCollapsedSections();
      $('#settings .box section.content[data-view]').each(function () {
        const view = $(this).attr('data-view');
        sectionRules.sectionsIn($, this).each(function (index) {
          const section = $(this);
          const header = sectionRules.headerFor($, this);
          if (!header || section.data('sectionKey')) return; // already wired
          const key = sectionRules.sectionKey($, this, view, index);
          section.addClass('settings-section').data('sectionKey', key);
          header.addClass('settings-section-header').attr({ role: 'button', tabindex: '0' });
          // The chevron is appended once and points down when open, sideways when closed.
          if (!header.children('.settings-section-arrow').length) {
            header.append('<i class="fas fa-chevron-down settings-section-arrow" aria-hidden="true"></i>');
          }
          setSectionCollapsed(this, collapsed.has(key));
        });
      });
    }

    function toggleSection(section) {
      const key = $(section).data('sectionKey');
      if (!key) return;
      const collapsed = readCollapsedSections();
      const nowCollapsed = !$(section).hasClass('is-collapsed');
      if (nowCollapsed) collapsed.add(key);
      else collapsed.delete(key);
      setSectionCollapsed(section, nowCollapsed);
      writeCollapsedSections(collapsed);
    }

    window.initCollapsibleSections = initCollapsibleSections;
    initCollapsibleSections();

    $('#settings').on('click', '.settings-section-header', function () {
      toggleSection($(this).closest('.settings-section'));
    });
    $('#settings').on('keydown', '.settings-section-header', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      toggleSection($(this).closest('.settings-section'));
    });

    /* ---- Settings search ---------------------------------------------------
       Seven tabs and roughly a hundred rows means the hardest part of changing a
       setting is remembering which tab owns it. Typing here filters the rows of
       every tab at once and the nav counters show where the matches are, so a
       half-remembered word is enough to find an option.

       A search sees through collapsed sections: `#settings.searching` suspends
       the collapse in CSS, so a match is never hidden inside a folded card, and
       every section returns to its own state when the query is cleared.

       Rows are hidden with a class rather than removed: the i18n loader binds
       most labels positionally (`li:nth-child(n)`), and :nth-child counts
       elements whether or not they are displayed, so filtering must never touch
       the DOM structure. */
    const searchRules = require(path.join(appPath, 'util/settingsSearch.js'));

    function clearSettingsSearch() {
      $('#settings').removeClass('searching no-search-result');
      $('#settings .box .content').removeClass('search-hidden');
      $('#settings .box .content .search-hidden').removeClass('search-hidden');
      $('#settingNav li[data-view]').removeClass('no-match').find('.nav-count').text('');
    }

    function applySettingsSearch(rawQuery) {
      if (searchRules.parseTerms(rawQuery).length === 0) {
        clearSettingsSearch();
        return;
      }

      $('#settings').addClass('searching');
      const { total, perView } = searchRules.filterSections($, rawQuery);

      for (const [view, count] of Object.entries(perView)) {
        const navItem = $(`#settingNav li[data-view='${view}']`);
        navItem.find('.nav-count').text(count);
        navItem.toggleClass('no-match', count === 0);
      }

      $('#settings').toggleClass('no-search-result', total === 0);

      // Land the user on results rather than on an empty tab, but never yank them off a tab that
      // still has matches — that would fight their own typing.
      if (total > 0 && $('#settingNav li.active').hasClass('no-match')) {
        $('#settingNav li[data-view]:not(.no-match)').first().trigger('click');
      }
    }

    let searchDebounce = null;
    $('#settings-search-input').on('input', function () {
      const value = $(this).val();
      clearTimeout(searchDebounce);
      // Filtering walks every row of every tab; debouncing keeps fast typing from re-running it per
      // keystroke while still feeling immediate.
      searchDebounce = setTimeout(() => applySettingsSearch(value), 80);
    });

    $('#settings-search-input').on('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        $(this).val('');
        clearSettingsSearch();
      }
    });

    $('#settings-search-clear').click(function () {
      $('#settings-search-input').val('').focus();
      clearSettingsSearch();
    });

    // Ctrl+F while Settings is open goes to the field, matching every other search box in the app.
    $(document).on('keydown', function (e) {
      if (!$('#settings').is(':visible')) return;
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'f') {
        e.preventDefault();
        $('#settings-search-input').focus().select();
      }
    });

    // Reopening Settings should start from a clean slate rather than the last search.
    window.resetSettingsSearch = function () {
      $('#settings-search-input').val('');
      clearSettingsSearch();
    };

    // Tell the user what a freshly added save/config folder actually contains: run the real scan on
    // it and report the game count, so "added but nothing shows up" stops being a mystery.
    async function reportFolderScan(dir) {
      const result = $('#folder-action-result');
      result.text(result.attr('data-running') || t('scanning', 'Scanning…', 'Analyse…'));
      try {
        const found = await userDir.scan(dir);
        const count = Array.isArray(found) ? found.length : 0;
        result.text(
          count > 0
            ? `${result.attr('data-done') || t('scan-complete', 'Scan complete.', 'Analyse terminée.')} (${count})`
            : result.attr('data-invalid') || t('no-game-found', 'No game found.', 'Aucun jeu trouvé.')
        );
      } catch (err) {
        debug.log(err);
        result.text('');
      }
    }

    $('#addCustomDir').click(async function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      try {
        let dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'showHiddenFiles'] });

        if (dialog.filePaths.length > 0) {
          debug.log(`Adding folder: ${dialog.filePaths}`);

          if (await userDir.check(dialog.filePaths[0])) {
            populateUserDirList({ dir: dialog.filePaths[0] });
            reportFolderScan(dialog.filePaths[0]);
          } else {
            debug.log('-> Invalid folder');
            remote.dialog.showMessageBoxSync({
              type: 'warning',
              title: t('invalid-folder', 'Invalid folder', 'Dossier invalide'),
              message: $("#settings .content[data-view='folder'] > .controls .info p")
                .html()
                .replace(/\s{2,}/g, '')
                .replace(/<br>/g, '\n'),
              detail: $('#folder-action-result').attr('data-invalid') || '',
            });
          }
        } else {
          debug.log('Adding folder: User Cancel');
        }
      } catch (err) {
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
          message: t('error-adding-custom-folder', 'Error adding custom folder', 'Erreur lors de l\'ajout du dossier personnalisé'),
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
          title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
          message: t('error-adding-library-folder', 'Error adding library folder', 'Erreur lors de l\'ajout du dossier de bibliothèque'),
          detail: `${err}`,
        });
      }

      self.css('pointer-events', 'initial');
    });

    // Generate emulator configs for the watched/library folders, then rescan.
    $('#generate-configs').click(async function () {
      const self = $(this);
      const result = $('#generate-configs-result');
      self.css('pointer-events', 'none');
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
        const detail = autoFixEnabled
          ? t(
              'generate-configs-detail-auto-fix',
              'This starts a full scan now. During that scan, Achievement Watcher applies the GBE/Goldberg auto-fix to detected games with a known install folder. Repairs run in the background: scan again if a freshly fixed game does not show as ready yet.',
              "Le bouton lance un scan complet maintenant. Pendant ce scan, Achievement Watcher applique l'auto-fix GBE/Goldberg aux jeux détectés qui ont un dossier d'installation connu. Les réparations se font en arrière-plan : relance un scan si un jeu vient juste d'être corrigé et n'apparaît pas encore comme prêt."
            )
          : t(
              'generate-configs-detail-scan-only',
              'This only starts a full detection scan. Automatic repair is disabled in Emulator configuration > Automatically fix newly detected games.',
              'Le bouton lance seulement un scan complet pour détecter les jeux. La réparation automatique est désactivée dans Configuration émulateur > Corriger automatiquement les nouveaux jeux détectés.'
            );
        const choice = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
          type: autoFixEnabled ? 'info' : 'warning',
          title: t('generate-configs', 'Generate configs', 'Génération des configs'),
          message: t('x-emulated-game-s-found-in-your-libraries-x-without-achievements', '{found} emulated game(s) found in your libraries — {missing} without achievements.json.', '{found} jeu(x) émulé(s) détecté(s) dans tes bibliothèques — {missing} sans achievements.json.', {
            found: found.length,
            missing: unconfigured,
          }),
          detail,
          buttons: [t('start-scan', 'Start scan', 'Lancer le scan'), t('cancel', 'Cancel', 'Annuler')],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (choice !== 0) return;

        // 3) full rescan — discovers the folders and applies the one-shot emulator fix to unconfigured games
        result.text(
          autoFixEnabled
            ? t('scan-started-auto-fix', 'Scan started — {count} game(s) without schema will be repaired if their install folder is recognized.', 'Scan lancé — {count} jeu(x) sans schema seront réparés si leur dossier d\'installation est reconnu.', { count: unconfigured })
            : t('scan-started-scan-only', 'Scan started — automatic repair is disabled, no files will be changed.', 'Scan lancé — réparation automatique désactivée, aucun fichier ne sera modifié.')
        );
        resetUI();
      } catch (err) {
        result.text(t('generate-configs-failed-x', 'Generate configs failed: {error}', 'Génération impossible : {error}', { error: err }));
        remote.dialog.showMessageBoxSync({ type: 'error', title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'), message: t('error-generating-configs', 'Error generating configs', 'Erreur lors de la génération des configs'), detail: `${err}` });
      } finally {
        self.css('pointer-events', 'initial');
      }
    });

    // Rescan only the configured locations that the user selected. The parser receives this scope
    // ephemerally: folder preferences stay intact, and the existing tiles outside the scope remain
    // visible while their disks are deliberately left untouched.
    let folderRescanBusy = false;
    const folderRescanKey = scanScopeTools.directoryKey;
    function getFolderRescanLocations() {
      const locations = new Map();
      const add = (value, kind) => {
        const dir = String(value || '').trim();
        const key = folderRescanKey(dir);
        if (!key) return;
        const record = locations.get(key) || { path: dir, user: false, library: false };
        record[kind] = true;
        locations.set(key, record);
      };
      $('#settings #dirlist > li').each(function () {
        add($(this).find('.path span').text(), 'user');
      });
      $('#settings #libdirlist > li').each(function () {
        add($(this).find('.path span').text(), 'library');
      });
      return [...locations.values()];
    }
    function updateFolderRescanControls() {
      const inputs = $('#folder-rescan-list input[type="checkbox"]');
      const hasSelection = inputs.filter(':checked').length > 0;
      $('#folder-rescan-select-all').prop('disabled', folderRescanBusy || inputs.length === 0);
      $('#folder-rescan-select-none').prop('disabled', folderRescanBusy || inputs.length === 0);
      $('#folder-rescan-run').prop('disabled', folderRescanBusy || !hasSelection);
    }
    function renderFolderRescanLocations() {
      const list = $('#folder-rescan-list');
      const selected = new Set(
        list
          .find('input[type="checkbox"]:checked')
          .map(function () {
            return String($(this).attr('data-folder-key') || '');
          })
          .get()
      );
      const keepSelection = list.children().length > 0;
      const locations = getFolderRescanLocations();
      list.empty();
      if (locations.length === 0) {
        $('#folder-rescan-result').text(t('rescan-no-folders', 'Add a folder before rescanning.', 'Ajoute un dossier avant de relancer une analyse.'));
        updateFolderRescanControls();
        return;
      }
      for (const location of locations) {
        const key = folderRescanKey(location.path);
        const icon = location.user && location.library ? 'fa-layer-group' : location.library ? 'fa-folder-open' : 'fa-save';
        const row = $('<li>').addClass('folder-rescan-location');
        const label = $('<label>');
        const input = $('<input>', { type: 'checkbox' })
          .attr('data-folder-key', key)
          .attr('data-user', location.user ? 'true' : 'false')
          .attr('data-library', location.library ? 'true' : 'false')
          .attr('aria-label', location.path)
          .prop('checked', keepSelection ? selected.has(key) : true);
        label.append(input, $('<i>').addClass(`fas ${icon}`), $('<span>').attr('title', location.path).text(location.path));
        row.append(label).appendTo(list);
      }
      if (!keepSelection) $('#folder-rescan-result').empty();
      updateFolderRescanControls();
    }
    function selectedFolderRescanScope() {
      const scope = { userDirs: [], libraryDirs: [] };
      $('#folder-rescan-list input[type="checkbox"]:checked').each(function () {
        const path = $(this).siblings('span').text();
        if ($(this).attr('data-user') === 'true') scope.userDirs.push(path);
        if ($(this).attr('data-library') === 'true') scope.libraryDirs.push(path);
      });
      return scope;
    }
    function saveCurrentFolderLists() {
      const userDirList = [];
      const libraryDirList = [];
      $('#settings #dirlist > li').each(function () {
        userDirList.push({ path: $(this).find('.path span').text(), notify: true });
      });
      $('#settings #libdirlist > li').each(function () {
        libraryDirList.push($(this).find('.path span').text());
      });
      settings.setUserDataPath(ipcRenderer.sendSync('get-user-data-path-sync'));
      return withSettingsTimeout(Promise.all([userDir.save(userDirList), libraryDirs.save(libraryDirList)]), 'Saving folders for selected rescan');
    }
    $('#folder-rescan-list').on('change', 'input[type="checkbox"]', function () {
      $('#folder-rescan-result').empty();
      updateFolderRescanControls();
    });
    $('#folder-rescan-select-all').click(function () {
      $('#folder-rescan-list input[type="checkbox"]').prop('checked', true).trigger('change');
    });
    $('#folder-rescan-select-none').click(function () {
      $('#folder-rescan-list input[type="checkbox"]').prop('checked', false).trigger('change');
    });
    $('#folder-rescan-run').click(async function () {
      if (folderRescanBusy) return;
      const scope = selectedFolderRescanScope();
      const count = scope.userDirs.length + scope.libraryDirs.filter((dir) => !scope.userDirs.some((userDir) => folderRescanKey(userDir) === folderRescanKey(dir))).length;
      const result = $('#folder-rescan-result');
      if (count === 0) {
        result.text(t('rescan-no-selection', 'Select at least one folder.', 'Sélectionne au moins un dossier.'));
        updateFolderRescanControls();
        return;
      }
      folderRescanBusy = true;
      updateFolderRescanControls();
      result.text(t('rescan-started', 'Rescanning {count} selected folder(s)…', 'Analyse des {count} dossier(s) sélectionné(s)…', { count }));
      try {
        await saveCurrentFolderLists();
        await app.onStart({ scanScope: scope });
        result.text(t('rescan-complete', 'Selected folders rescanned.', 'Dossiers sélectionnés analysés.'));
      } catch (err) {
        debug.log(err);
        result.text(t('rescan-failed', 'Selected-folder scan failed: {error}', 'Échec de l’analyse des dossiers sélectionnés : {error}', { error: err && err.message ? err.message : err }));
      } finally {
        folderRescanBusy = false;
        updateFolderRescanControls();
      }
    });
    $(document).on('folder-rescan-locations-changed', renderFolderRescanLocations);
    // Adding or removing a scan root changes which `local-<hash>` ids can be traced back to a
    // folder, so the resolver's cached folder map has to be rebuilt on the next lookup.
    $(document).on('folder-rescan-locations-changed', function () {
      if (typeof blacklist.forgetLocalInstallIndex === 'function') blacklist.forgetLocalInstallIndex();
    });
    renderFolderRescanLocations();

    $('#smartFind').click(async function () {
      let self = $(this);
      self.css('pointer-events', 'none');
      $('#wrap-dirlist .loading-overlay').show();
      $('#addCustomDir').css('pointer-events', 'none');
      $('#btn-settings-save').css('pointer-events', 'none');

      debug.log('auto-finding folder(s) ...');
      const result = $('#folder-action-result');
      result.text(result.attr('data-running') || '');
      // Diff the lists before/after so the summary reports what Smart Find actually added.
      const before = $('#settings #dirlist > li').length + $('#settings #libdirlist > li').length;

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
        const added = Math.max(0, $('#settings #dirlist > li').length + $('#settings #libdirlist > li').length - before);
        result.text(`${result.attr('data-done') || ''} (${added})`);
      } catch (err) {
        result.text('');
        remote.dialog.showMessageBoxSync({
          type: 'error',
          title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
          message: t('error-while-auto-finding-folder-s', 'Error while auto-finding folder(s)', 'Erreur lors de la recherche automatique de dossiers'),
          detail: `${err}`,
        });
      }

      self.css('pointer-events', 'initial');
      $('#wrap-dirlist .loading-overlay').hide();
      $('#addCustomDir').css('pointer-events', 'initial');
      $('#btn-settings-save').css('pointer-events', 'initial');
    });

    $('#blacklist-add-input').attr('placeholder', t('blacklist-add-placeholder', 'Steam App ID', 'ID d’app Steam'));
    $('#blacklist-add-btn span').text(t('blacklist-add-button', 'Add', 'Ajouter'));

    // Resolve missing numeric blacklist names with a short, cacheable Steam lookup.
    const BLACKLIST_NAME_LOOKUP_TIMEOUT_MS = 8000;
    async function resolveBlacklistNameOnline(appid) {
      const id = String(appid ?? '').trim();
      if (!/^\d+$/.test(id)) return '';
      try {
        const name = await Promise.race([
          ipcRenderer.invoke('get-steam-data', { appid: Number(id), type: 'name' }),
          new Promise((resolve) => setTimeout(() => resolve(''), BLACKLIST_NAME_LOOKUP_TIMEOUT_MS)),
        ]);
        return typeof name === 'string' ? name.trim() : '';
      } catch (err) {
        debug.log(`blacklist: online name lookup failed for ${id}: ${err}`);
        return '';
      }
    }

    // Render hidden games, backfilling missing names locally and then online.
    async function renderBlacklistManager() {
      const listEl = $('#blacklist-manager');
      const emptyEl = $('#blacklist-empty');
      listEl.empty();
      let entries = [];
      try {
        entries = await blacklist.getUserDetailed();
      } catch (err) {
        debug.log(err);
      }
      emptyEl.text(entries.length === 0 ? listEl.attr('data-empty') || '' : '');
      const unresolved = [];
      for (const entry of entries) {
        const li = $('<li>');
        const nameEl = $('<span class="name">')
          .text(entry.name || String(entry.appid))
          .attr('title', String(entry.appid))
          .appendTo(li);
        if (!entry.name) unresolved.push({ appid: entry.appid, nameEl });
        $('<span class="appid">').text(entry.appid).appendTo(li);
        $('<button type="button" class="inline-action-btn"><i class="fas fa-undo"></i></button>')
          .attr('title', listEl.attr('data-restore') || '')
          .on('click', async function () {
            const btn = $(this);
            btn.css('pointer-events', 'none');
            try {
              await blacklist.remove(entry.appid);
              window.__awBlacklistDirty = true;
              await renderBlacklistManager();
            } catch (err) {
              debug.log(err);
              btn.css('pointer-events', 'initial');
            }
          })
          .appendTo(li);
        listEl.append(li);
      }
      // Deliberately not awaited: the rows are already on screen from local data, and the callers
      // that await this render (opening Settings, restoring a game) must not sit on the network.
      resolveMissingBlacklistNames(unresolved).catch((err) => debug.log(err));
    }

    async function resolveMissingBlacklistNames(pendingRows) {
      for (const pending of pendingRows) {
        // Sequential on purpose: an appid-only blacklist would otherwise fire a burst of store
        // lookups at once, and each one is already cached after the first success.
        const name = await resolveBlacklistNameOnline(pending.appid);
        if (!name) continue;
        // The list may have been re-rendered (or Settings closed) while this was in flight.
        if (pending.nameEl.closest('body').length) pending.nameEl.text(name);
        try {
          await blacklist.setName(pending.appid, name);
        } catch (err) {
          debug.log(err);
        }
      }
    }
    window.renderBlacklistManager = renderBlacklistManager;

    $('#blacklist-add-btn').click(async function () {
      const input = $('#blacklist-add-input');
      const appid = String(input.val() || '').trim();
      if (!/^\d+$/.test(appid)) return;
      try {
        // No name to hand over: add() resolves one from the local sources itself, and the render
        // below fills in anything only Steam knows. Neither step blocks this click.
        await blacklist.add(appid, '');
        input.val('');
        await renderBlacklistManager();
      } catch (err) {
        debug.log(err);
      }
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
          let elem = $('#settingNav li[data-view]').first();
          $('#settingNav li[data-view]').removeClass('active');
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
            title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
            message: t('error-while-trying-to-reset-user-blacklist', 'Error while trying to reset user blacklist', 'Erreur lors de la réinitialisation de la liste noire'),
            detail: `${err}`,
          });
        });
    });

    // Auto-save notification controls, excluding customizer sliders.
    $("#settings .box section.content[data-view='notification']").on('change', 'select, #option_overlayVolume', autosaveNotifications);

    // Collapse overlay-only controls when toast-only mode is selected.
    function animateOverlaySettingCollapse(el, visible) {
      const $el = $(el);
      if (!$el.length) return;
      const collapsed = $el.hasClass('overlay-setting-collapsed');
      if (visible === !collapsed) return;
      if (visible) {
        $el.css('max-height', '0px');
        $el.removeClass('overlay-setting-collapsed');
        void $el[0].offsetHeight;
        $el.css('max-height', $el[0].scrollHeight + 'px');
        setTimeout(() => {
          if (!$el.hasClass('overlay-setting-collapsed')) $el.css('max-height', '');
        }, 320);
      } else {
        $el.css('max-height', '');
        const height = $el[0].scrollHeight;
        $el.css('max-height', height + 'px');
        void $el[0].offsetHeight;
        $el.addClass('overlay-setting-collapsed');
        setTimeout(() => $el.css('max-height', ''), 320);
      }
    }

    function updateOverlayOptionsVisibility() {
      const mode = $('#option_notifMode').val() || 'overlay';
      const visible = mode !== 'toast';
      // Sound controls also apply to Windows toasts.
      const KEEP_VISIBLE_OVERLAY_IDS = new Set(['lbl-overlaySound', 'lbl-overlayRandomSound', 'lbl-overlayVolume']);
      $('#options-notify-overlay > li:not(:first-child)').each(function () {
        const labelId = $(this).find('[id^="lbl-overlay"]').first().attr('id') || '';
        animateOverlaySettingCollapse(this, visible || KEEP_VISIBLE_OVERLAY_IDS.has(labelId));
      });
      animateOverlaySettingCollapse($('#options-notify-customiser').closest('.arrow-list')[0], visible);
    }
    $('#option_notifMode').on('change', updateOverlayOptionsVisibility);
    updateOverlayOptionsVisibility();

    // Send notification test requests through the watchdog websocket.
    function runNotificationTest(cmd) {
      setTimeout(() => {
        const ws = new WebSocket('ws://localhost:8082');
        ws.onerror = (err) => {
          ws.close();
          remote.dialog.showMessageBoxSync({
            type: 'error',
            title: t('websocket-connection-error', 'WebSocket Connection Error', 'Erreur de connexion WebSocket'),
            message: t('notification-test-failure', 'Notification Test Failure.', 'Échec du test de notification.'),
            detail: t('error-in-connection-establishment-net-err-connection-refused-nis', 'Error in connection establishment: net::ERR_CONNECTION_REFUSED\nIs Watchdog Running ?'),
          });
        };

        ws.onopen = () => {
          ws.onmessage = (evt) => {
            try {
              let res = JSON.parse(evt.data);
              if (res.cmd === cmd) {
                if (res.success === true) {
                  ws.close();
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
              remote.dialog.showMessageBoxSync({
                type: 'error',
                title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
                message: t('notification-test-failure', 'Notification Test Failure.', 'Échec du test de notification.'),
                detail: `${err}`,
              });
            }
          };
          try {
            ws.send(JSON.stringify({ cmd }));
          } catch (err) {
            ws.close();
            remote.dialog.showMessageBoxSync({
              type: 'error',
              title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
              message: t('notification-test-failure', 'Notification Test Failure.', 'Échec du test de notification.'),
              detail: `${err}`,
            });
          }
        };
      }, 200);
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
    // Build a notification test payload using the current overlay settings.
    function overlayTestData(kind, presetOverride, label) {
      const mainPreset = $('#option_overlayPreset').val() || 'Shirow';
      // Match the per-type preset used by real notifications.
      const preset =
        presetOverride ||
        (kind === 'rare'
          ? $('#option_overlayPresetRare').val() || mainPreset
          : kind === 'platinum'
          ? $('#option_overlayPresetPlatinum').val() || mainPreset
          : mainPreset);
      const presetLabel = label || preset;
      const sound = $('#option_overlaySound').val() || '';
      const rarePct = kind === 'rare' ? randomRareRarity() : null;
      const texts = {
        toast: {
          displayName: t('test-toast-name', 'Achievement Unlocked', 'Succès débloqué'),
          description: t('test-toast-desc', 'Notification test — {preset} preset', 'Test de notification — preset {preset}', { preset: presetLabel }),
        },
        rare: {
          displayName: t('test-rare-name', 'Rare Achievement', 'Succès rare'),
          description: t('test-rare-desc', 'Rare · {percent}% of players', 'Rare · {percent} % des joueurs', { percent: rarePct }),
        },
        progress: {
          displayName: t('test-progress-name', 'Progress', 'Progression'),
          description: t('test-progress-desc', '3 / 10', '3 / 10'),
        },
        playtime: {
          displayName: t('test-playtime-name', 'Hollow Knight', 'Hollow Knight'),
          description: t('test-playtime-desc', 'You played for 42 minutes', 'Vous avez joué pendant 42 minutes'),
        },
        platinum: {
          displayName: t('test-platinum-name', 'Platinum!', 'Trophée Platine'),
          description: t('test-platinum-desc', '100% completed', '100 % complété'),
        },
      };
      const volRaw = parseInt($('#option_overlayVolume').val(), 10);
      const durRaw = $('#option_overlayDuration').val();
      const durSec = durRaw === 'auto' || !durRaw ? 0 : parseInt(durRaw, 10) || 0;
      const achievementIcon = path.join(appPath, 'resources/img/achievement.svg');
      const gameIcon = path.join(appPath, 'resources/icon/icon.png');
      return Object.assign(
        {
          // Test notifications may replace the current overlay immediately (and are never
          // deduplicated), so the tester can chain preset previews without waiting.
          test: true,
          preset,
          // A rare unlock is a normal achievement notification carrying a rarityPercent.
          notificationType: kind === 'toast' || kind === 'rare' ? 'achievement' : kind,
          rarityPercent: rarePct,
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
    function fireNotificationTest(kind, btn, modeOverride) {
      const mode = modeOverride || $('#option_notifMode').val() || 'overlay';
      if (mode === 'toast' || mode === 'both') runNotificationTest.call(btn, kind + '-test');
      if (mode === 'overlay' || mode === 'both') ipcRenderer.send('spawn-overlay-notification', overlayTestData(kind));
    }
    // The first-run guide shares the exact same test path, while supplying its still-unsaved
    // notification transport choice. Keep the rendering and Watchdog protocol in one place.
    window.testAchievementWatcherNotification = function (mode, button) {
      const transport = ['toast', 'overlay', 'both'].includes(mode) ? mode : 'overlay';
      fireNotificationTest('toast', button, transport);
    };
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
          sel.append($('<option>').attr('value', '').text(sel.attr('data-lang-none') || ''));
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

    // --- Custom preset builder: live preview, real overlay preview, create/update ---
    function custInt(id, def) {
      const n = parseInt($('#' + id).val(), 10);
      return Number.isFinite(n) ? n : def;
    }
    // The one place that reads the builder's controls. Everything downstream (the inline preview,
    // the overlay preview and the generator) works from this, so all three can never disagree.
    function readPresetOptions() {
      return {
        bg: $('#cust-bg').val() || '#16181d',
        text: $('#cust-text').val() || '#ffffff',
        accent: $('#cust-accent').val() || '#4aa3ff',
        opacity: custInt('cust-opacity', 100) / 100,
        fontSize: custInt('cust-font', 16),
        radius: custInt('cust-radius', 12),
        iconSize: custInt('cust-icon', 64),
        width: custInt('cust-width', 420),
      };
    }
    function setPresetStatus(message, state) {
      $('#cust-status')
        .text(message || '')
        .removeClass('is-ok is-error')
        .addClass(state === 'ok' ? 'is-ok' : state === 'error' ? 'is-error' : '');
    }
    function updatePresetPreview() {
      const o = readPresetOptions();
      $('#cust-preview').css({
        background: o.bg,
        color: o.text,
        'border-left-color': o.accent,
        'border-radius': o.radius + 'px',
        'font-size': o.fontSize + 'px',
        width: o.width + 'px',
        opacity: o.opacity,
      });
      $('#cust-preview-title').css('color', o.accent);
      $('#cust-preview-icon').css({ color: o.accent, 'font-size': Math.round(o.iconSize * 0.62) + 'px' });
      $('#cust-val-opacity').text(Math.round(o.opacity * 100) + '%');
      $('#cust-val-font').text(o.fontSize + 'px');
      $('#cust-val-radius').text(o.radius + 'px');
      $('#cust-val-icon').text(o.iconSize + 'px');
      $('#cust-val-width').text(o.width + 'px');
    }
    $('#options-notify-customiser').on('input change', 'input', updatePresetPreview);
    updatePresetPreview();

    // Creating a preset that already exists replaces it, so the button says so: "Create" for a new
    // name, "Update" once the typed name matches a preset the builder generated.
    let generatedPresets = [];
    function updateCreateButtonMode() {
      const name = ($('#cust-name').val() || '').trim();
      const known = name && generatedPresets.some((n) => n.toLowerCase() === name.toLowerCase());
      const label = known ? $('#cust-lbl-create').attr('data-update') : $('#cust-lbl-create').attr('data-create');
      if (label) $('#cust-lbl-create').text(label);
      $('#btn-create-preset').find('i').attr('class', known ? 'fas fa-save' : 'fas fa-plus');
    }

    // Presets generated here can be re-opened: the builder stores its own options next to the
    // generated CSS, so a preset stays editable instead of being a one-shot export.
    async function refreshGeneratedPresetList(selected) {
      try {
        generatedPresets = (await ipcRenderer.invoke('list-custom-presets')) || [];
      } catch (err) {
        debug.log(err);
        generatedPresets = [];
      }
      const sel = $('#cust-load');
      sel.empty();
      sel.append($('<option>').attr('value', '').text(sel.attr('data-new') || ''));
      generatedPresets.forEach((n) => sel.append($('<option>').attr('value', n).text(n)));
      sel.val(generatedPresets.includes(selected) ? selected : '');
      updateCreateButtonMode();
      updateDeleteButtonVisibility();
    }

    // Deleting only ever applies to a preset this builder generated, so the button appears once one
    // is actually loaded — never next to a bundled preset or a half-typed new name.
    function updateDeleteButtonVisibility() {
      const loaded = String($('#cust-load').val() || '');
      $('#btn-delete-preset').toggle(Boolean(loaded) && generatedPresets.includes(loaded));
    }

    $('#btn-delete-preset').click(async function () {
      const name = String($('#cust-load').val() || '');
      if (!name) return;
      const self = $(this);
      const confirmed = remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
        type: 'warning',
        buttons: [t('delete', 'Delete', 'Supprimer'), t('cancel', 'Cancel', 'Annuler')],
        defaultId: 1,
        cancelId: 1,
        title: t('delete-preset-title', 'Delete preset', 'Supprimer le preset'),
        message: t('delete-preset-message', 'Delete the preset "{name}"?', 'Supprimer le preset « {name} » ?', { name }),
        detail: t('delete-preset-detail', 'The preset files are removed from disk. This cannot be undone.', 'Les fichiers du preset seront supprimés du disque. Cette action est irréversible.'),
        noLink: true,
      });
      if (confirmed !== 0) return;
      self.css('pointer-events', 'none');
      try {
        const res = await ipcRenderer.invoke('delete-custom-preset', name);
        if (res && res.ok) {
          // The deleted preset may have been the selected one; rebuild both lists and fall back.
          const presets = await ipcRenderer.invoke('list-presets');
          const sel = $('#option_overlayPreset');
          const previous = sel.val();
          sel.empty();
          (presets && presets.length ? presets : ['Shirow', 'Default']).forEach((n) => sel.append($('<option>').attr('value', n).text(n)));
          sel.val(presets.includes(previous) ? previous : presets[0] || 'Shirow').change();
          $('#cust-name').val('');
          await refreshGeneratedPresetList('');
          setPresetStatus(`${$('#cust-status').attr('data-deleted') || ''} ${name}`.trim(), 'ok');
        } else {
          setPresetStatus((($('#cust-status').attr('data-fail') || '') + (res && res.error ? ': ' + res.error : '')).trim(), 'error');
        }
      } catch (err) {
        debug.log(err);
        setPresetStatus((($('#cust-status').attr('data-fail') || '') + ': ' + err).trim(), 'error');
      }
      self.css('pointer-events', 'initial');
    });
    $('#cust-name').on('input', updateCreateButtonMode);

    $('#cust-load').on('change', async function () {
      const name = String($(this).val() || '');
      updateDeleteButtonVisibility();
      if (!name) {
        setPresetStatus('');
        return;
      }
      try {
        const opts = await ipcRenderer.invoke('read-custom-preset', name);
        if (!opts) {
          setPresetStatus($('#cust-status').attr('data-fail') || '', 'error');
          return;
        }
        $('#cust-name').val(opts.name || name);
        $('#cust-bg').val(opts.bg);
        $('#cust-text').val(opts.text);
        $('#cust-accent').val(opts.accent);
        $('#cust-opacity').val(Math.round(opts.opacity * 100));
        $('#cust-font').val(opts.fontSize);
        $('#cust-radius').val(opts.radius);
        $('#cust-icon').val(opts.iconSize);
        $('#cust-width').val(opts.width);
        updatePresetPreview();
        updateCreateButtonMode();
        updateDeleteButtonVisibility();
        setPresetStatus(`${$('#cust-status').attr('data-loaded') || ''} ${opts.name || name}`.trim(), 'ok');
      } catch (err) {
        debug.log(err);
        setPresetStatus($('#cust-status').attr('data-fail') || '', 'error');
      }
    });

    // Render the design as a real overlay popup without saving it first — the only way to judge a
    // preset is at full size, on screen, with the animation and the configured position/scale.
    $('#btn-preview-preset').click(async function () {
      const self = $(this);
      self.css('pointer-events', 'none');
      try {
        const res = await ipcRenderer.invoke('preview-custom-preset', readPresetOptions());
        if (res && res.ok) {
          setPresetStatus('');
          // Only name the design when the user actually named it. Falling back to the picker's
          // "New preset…" placeholder produced "Notification test — New preset… preset", which
          // reads like a bug; an unnamed draft just shows the plain sample text instead.
          const label = ($('#cust-name').val() || '').trim();
          ipcRenderer.send('spawn-overlay-notification', overlayTestData('toast', res.name, label));
        } else {
          setPresetStatus((($('#cust-status').attr('data-fail') || '') + (res && res.error ? ': ' + res.error : '')).trim(), 'error');
        }
      } catch (e) {
        debug.log(e);
        setPresetStatus((($('#cust-status').attr('data-fail') || '') + ': ' + e).trim(), 'error');
      }
      self.css('pointer-events', 'initial');
    });

    $('#btn-create-preset').click(async function () {
      const self = $(this);
      const status = $('#cust-status');
      const name = ($('#cust-name').val() || '').trim();
      if (!name) {
        setPresetStatus(status.attr('data-err') || '', 'error');
        return;
      }
      self.css('pointer-events', 'none');
      try {
        const res = await ipcRenderer.invoke('create-custom-preset', Object.assign({ name }, readPresetOptions()));
        if (res && res.ok) {
          // Refresh the preset dropdown and select the new preset (autosave persists the choice).
          const presets = await ipcRenderer.invoke('list-presets');
          const sel = $('#option_overlayPreset');
          sel.empty();
          (presets && presets.length ? presets : ['Shirow', 'Default']).forEach((n) => sel.append($('<option>').attr('value', n).text(n)));
          sel.val(res.name).change();
          await refreshGeneratedPresetList(res.name);
          const done = res.replaced ? status.attr('data-updated') : status.attr('data-ok');
          setPresetStatus(`${done || ''} ${res.name}`.trim(), 'ok');
        } else {
          setPresetStatus(((status.attr('data-fail') || '') + (res && res.error ? ': ' + res.error : '')).trim(), 'error');
        }
      } catch (e) {
        debug.log(e);
        setPresetStatus(((status.attr('data-fail') || '') + ': ' + e).trim(), 'error');
      }
      self.css('pointer-events', 'initial');
    });

    refreshGeneratedPresetList().catch((err) => debug.log(err));
    // The locale loader can run after this file wired the picker up (and again on a language
    // change), so re-render the two runtime-worded controls whenever it publishes new labels.
    $(document).on('customiser-labels-changed', function () {
      refreshGeneratedPresetList(String($('#cust-load').val() || '')).catch((err) => debug.log(err));
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
      // persist under notification_toast (handled below)
      if (this.id === 'option_groupToast' || this.id === 'option_urgent') return;
      if (this.id !== '' && $(this).val() !== '') app.config.notification[this.id.replace('option_', '')] = boolifyValue($(this).val());
    });
  $('#options-notify-transport .right')
    .children('select')
    .each(function () {
      if (this.id !== '' && $(this).val() !== '') app.config.notification_transport[this.id.replace('option_', '')] = boolifyValue($(this).val());
    });
  // Group-by-game and urgent sit in the common group visually but persist under notification_toast.
  if ($('#option_groupToast').val() !== '') app.config.notification_toast.groupToast = boolifyValue($('#option_groupToast').val());
  if ($('#option_urgent').val() !== '') app.config.notification_toast.urgent = boolifyValue($('#option_urgent').val());

  // Overlay (in-game) notification — enable in notification_transport, look in overlay.notification*.
  app.config.notification_transport.mode = $('#option_notifMode').val() || 'overlay';
  if (!app.config.overlay) app.config.overlay = {};
  app.config.overlay.notificationPreset = $('#option_overlayPreset').val() || 'Shirow';
  app.config.overlay.notificationPresetRare = $('#option_overlayPresetRare').val() || '';
  app.config.overlay.notificationPresetPlatinum = $('#option_overlayPresetPlatinum').val() || '';
  app.config.overlay.notificationPresetXenia = $('#option_overlayPresetXenia').val() || '';
  app.config.overlay.notificationPresetRpcs3 = $('#option_overlayPresetRpcs3').val() || '';
  app.config.overlay.notificationPresetShadps4 = $('#option_overlayPresetShadps4').val() || '';
  app.config.overlay.notificationPosition = $('#option_overlayPosition').val() || 'center-bottom';
  app.config.overlay.notificationScale = parseFloat($('#option_overlayScale').val()) || 1;
  app.config.overlay.randomSound = $('#option_overlayRandomSound').val() === 'true';
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

  $(document).trigger('folder-rescan-locations-changed');

  if (elem.find('.path span').width() >= 350 || options.dir.length > 42) {
    elem.find('.path').addClass('overflow');
  }

  elem.find('.controls .trash').click(function () {
    elem.remove();
    $(document).trigger('folder-rescan-locations-changed');
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
          $(document).trigger('folder-rescan-locations-changed');
          debug.log('-> Edited');
        } else {
          debug.log('-> Invalid folder');
          remote.dialog.showMessageBoxSync({
            type: 'warning',
            title: t('invalid-folder', 'Invalid folder', 'Dossier invalide'),
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
        title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
        message: t('error-editing-custom-folder', 'Error editing custom folder', 'Erreur lors de la modification du dossier personnalisé'),
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

  $(document).trigger('folder-rescan-locations-changed');

  if (elem.find('.path span').width() >= 350 || options.dir.length > 42) {
    elem.find('.path').addClass('overflow');
  }

  elem.find('.controls .trash').click(function () {
    elem.remove();
    $(document).trigger('folder-rescan-locations-changed');
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
        $(document).trigger('folder-rescan-locations-changed');
        debug.log('-> Edited');
      } else {
        debug.log('Editing library folder: User Cancel');
      }
    } catch (err) {
      remote.dialog.showMessageBoxSync({
        type: 'error',
        title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
        message: t('error-editing-library-folder', 'Error editing library folder', 'Erreur lors de la modification du dossier de bibliothèque'),
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
