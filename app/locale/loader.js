'use strict';

const remote = require('@electron/remote');
const path = require('path');
const appPath = path.join(__dirname, '..');

const merge = require('deepmerge');
const ffs = require('../util/fsAsync');
const { stripTags } = require('../util/stripTags.js');

const langDir = path.join(appPath, 'locale/lang');
const uiLanguages = require(path.join(appPath, 'locale/uiLanguages.js'));

module.exports.load = async (lang = 'english') => {
  try {
    if (!uiLanguages.has(lang)) lang = 'english';

    let english = JSON.parse(await ffs.readFile(path.join(langDir, 'english.json'), 'utf8'));
    let template;
    try {
      if (lang != 'english') {
        let requested = JSON.parse(await ffs.readFile(path.join(langDir, `${lang}.json`), 'utf8'));
        template = merge(english, requested, {
          arrayMerge: (dest, src, options) => src, //Do not concatenate array
          isEmpty: (a) => a === null || a === '', //Ignore empty or null value
        });
      } else {
        template = english;
      }
    } catch (err) {
      console.warn(err);
      template = english;
    }

    let locale = uiLanguages.get(lang).webapi;

    if (template) {
      translateUI(lang, locale, template);
      // Expose the merged locale so imperative strings (dialogs, menus) can be
      // translated through the same files via locale/t.js.
      window.appLocale = template;
      // The dynamic Help panel reads the same locale + live settings; refresh it whenever the
      // language payload is (re)applied so it never shows stale labels or hard-coded shortcuts.
      if (window.AchievementHelp && typeof window.AchievementHelp.render === 'function') {
        try {
          window.AchievementHelp.render($);
        } catch {}
      }
    } else {
      throw 'Unexpected Error';
    }

    return locale;
  } catch (err) {
    throw err;
  }
};

function translateUI(lang, locale, template) {
  let selector = $('#option_lang');
  selector.empty();
  for (let language of uiLanguages.all()) {
    selector.append(
      `<option value="${language.api}" data-tooltip="${language.native}" title="${language.displayName}" ${language.api === lang ? 'selected' : ''}>${
        language.native
      }</option>`
    );
  }

  $('html').attr('lang', `${locale.toLowerCase()}`);

  $('#sort-box .installed-filter').attr('title', clear(template.installedOnly));
  if (template.sort) {
    // Expose the dynamic sort labels for sort.js (built on click), and set the static button tooltips.
    // NB: must NOT be named `sortLabels` — sort.js declares a global `function sortLabels()` that
    // shares the same window slot, so reusing the name would overwrite that function (→ TypeError).
    window.sortLabelStrings = template.sort;
    if (template.sort.tooltip) {
      $('#sort-box .sort.alpha').attr('title', clear(template.sort.tooltip.alpha));
      $('#sort-box .sort.percentage').attr('title', clear(template.sort.tooltip.percent));
      $('#sort-box .sort.time').attr('title', clear(template.sort.tooltip.time));
      $('#sort-box .sort.played').attr('title', clear(template.sort.tooltip.played));
    }
  }
  selector = $('#game-list');
  selector.find('.loading .title').text(clear(template.loading));
  selector.find('.isEmpty .empty-title').text(clear(template.emptyList));
  selector.find('.isEmpty .empty-hint').text(clear(template.emptyListHint));
  selector.find('.isEmpty .empty-action').text(clear(template.emptyListAction));
  selector.attr('data-contextMenu0', clear(template.removeFromList));
  selector.attr('data-contextMenu1', clear(template.buildIconPrefetchCache));
  if (template.contextMenu) {
    selector.attr('data-ctx-resetplaytime', clear(template.contextMenu.resetPlaytime));
    if (template.contextMenu.manualUnlock) selector.attr('data-ctx-manualunlock', clear(template.contextMenu.manualUnlock));
    if (template.contextMenu.clearManualUnlock) selector.attr('data-ctx-clearmanualunlock', clear(template.contextMenu.clearManualUnlock));
    if (template.contextMenu.manualUnlocked) $('#achievement .achievement-list').attr('data-lang-manualUnlocked', clear(template.contextMenu.manualUnlocked));
    if (template.contextMenu.muteProgress) selector.attr('data-ctx-muteprogress', clear(template.contextMenu.muteProgress));
    if (template.contextMenu.unmuteProgress) selector.attr('data-ctx-unmuteprogress', clear(template.contextMenu.unmuteProgress));
    selector.attr('data-ctx-genjson', clear(template.contextMenu.generateAchievementsJson));
    selector.attr('data-ctx-diagnose', clear(template.contextMenu.diagnose));
    selector.attr('data-ctx-backupgbe', clear(template.contextMenu.backupGBE));
    if (template.contextMenu.restoreGBE) selector.attr('data-ctx-restoregbe', clear(template.contextMenu.restoreGBE));
    selector.attr('data-ctx-installgbe', clear(template.contextMenu.installGBE));
    if (template.contextMenu.removeDRM) selector.attr('data-ctx-removedrm', clear(template.contextMenu.removeDRM));
    if (template.contextMenu.crackfix) selector.attr('data-ctx-crackfix', clear(template.contextMenu.crackfix));
    selector.attr('data-ctx-iconcache', clear(template.contextMenu.openIconCache));
    selector.attr('data-ctx-dbcache', clear(template.contextMenu.openDbCache));
    selector.attr('data-ctx-installloc', clear(template.contextMenu.openInstallLocation));
    if (template.contextMenu.groupGame) selector.attr('data-ctx-group-game', clear(template.contextMenu.groupGame));
    if (template.contextMenu.groupEmulator) selector.attr('data-ctx-group-emulator', clear(template.contextMenu.groupEmulator));
    if (template.contextMenu.groupFolders) selector.attr('data-ctx-group-folders', clear(template.contextMenu.groupFolders));
    if (template.contextMenu.groupLinks) selector.attr('data-ctx-group-links', clear(template.contextMenu.groupLinks));
    if (template.contextMenu.groupCover) selector.attr('data-ctx-group-cover', clear(template.contextMenu.groupCover));
    if (template.contextMenu.uninstallGroup) selector.attr('data-ctx-uninstall-group', clear(template.contextMenu.uninstallGroup));
    if (template.contextMenu.uninstallViaSteam) selector.attr('data-ctx-uninstall-steam', clear(template.contextMenu.uninstallViaSteam));
    if (template.contextMenu.runUninstaller) selector.attr('data-ctx-uninstall-run', clear(template.contextMenu.runUninstaller));
    if (template.contextMenu.deleteFolder) selector.attr('data-ctx-uninstall-delete', clear(template.contextMenu.deleteFolder));
  }
  selector = $('#user-info .info .stats');
  selector.find('li:nth-child(1) span:eq(1)').text(clear(template.achievements));
  selector.find('li:nth-child(2) span:eq(1)').text(clear(template.perfectGame));
  selector.find('li:nth-child(3) span:eq(1)').text(clear(template.completionRate));
  $('#btn-previous').text(clear(template.allGamesBackButton));
  $('#unlock .header .title span').text(clear(template.unlocked));
  $('#lock .header .title span').text(clear(template.locked));
  $('#achievement .achievements').data('lang-globalStat', clear(template.globalStat));
  if (template.achievementSearchPlaceholder) {
    $('#achievement-search-input').attr('placeholder', clear(template.achievementSearchPlaceholder));
  }
  $('#unlock').data('lang-noneUnlocked', clear(template.noneUnlocked));
  $('#unlock').data('lang-play', clear(template.play));
  $('#unlock').data('lang-noneUnlockedHint', clear(template.noneUnlockedHint));
  $('#lock').data('lang-title', clear(template.hiddenRemain));
  $('#lock').data('lang-message', clear(template.revealedOnceUnlocked));
  $('#lock').data('lang-hiddenDesc', clear(template.hiddenDescriptionPlaceholder));
  $('#lock').data('lang-hidden', clear(template.settings.common.show));
  $('#btn-scrollup span').text(clear(template.scrollUp));
  $('#settings .box .header span').text(clear(template.settings.title));
  if (template.settings.search) {
    $('#settings-search-input').attr('placeholder', clear(template.settings.search.placeholder));
    $('#settings-search-input').attr('aria-label', clear(template.settings.search.ariaLabel || template.settings.search.placeholder));
    $('#settings-search-clear').attr('aria-label', clear(template.settings.search.clear));
    $('#settings-search-empty-text').text(clear(template.settings.search.empty));
  }
  selector = $('#options-ui');
  selector.find('li:nth-child(1) .left span').text(clear(template.settings.general.language.name));
  selector.find('li:nth-child(1) .help span').text(clear(template.settings.general.language.description));
  selector.find('li:nth-child(2) .left span').text(clear(template.settings.general.thumbnail.name));
  selector.find("li:nth-child(2) .right select option[value='true']").text(clear(template.settings.general.thumbnail.value.portrait));
  selector.find("li:nth-child(2) .right select option[value='false']").text(clear(template.settings.general.thumbnail.value.landscape));
  if (template.settings.general.thumbnail.description) selector.find('li:nth-child(2) .help').text(clear(template.settings.general.thumbnail.description));
  selector.find('li:nth-child(3) .left span').text(clear(template.settings.general.hiddenAch.name));
  selector.find("li:nth-child(3) .right select option[value='true']").text(clear(template.settings.common.show));
  selector.find("li:nth-child(3) .right select option[value='false']").text(clear(template.settings.common.hide));
  if (template.settings.general.hiddenAch.description) selector.find('li:nth-child(3) .help').text(clear(template.settings.general.hiddenAch.description));
  selector.find('li:nth-child(4) .left span').text(clear(template.settings.general.mergeDuplicates.name));
  selector.find("li:nth-child(4) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(4) .right select option[value='false']").text(clear(template.settings.common.disable));
  if (template.settings.general.mergeDuplicates.description) selector.find('li:nth-child(4) .help').text(clear(template.settings.general.mergeDuplicates.description));
  selector.find('li:nth-child(5) .left span').text(clear(template.settings.general.timeMerge.name));
  selector.find("li:nth-child(5) .right select option[value='true']").text(clear(template.settings.general.timeMerge.value.recent));
  selector.find("li:nth-child(5) .right select option[value='false']").text(clear(template.settings.general.timeMerge.value.oldest));
  selector.find('li:nth-child(5) .help').text(clear(template.settings.general.timeMerge.description));
  selector.find('li:nth-child(6) .left span').text(clear(template.settings.general.hideZero.name));
  if (template.settings.general.hideZero.description) selector.find('li:nth-child(6) .help').text(clear(template.settings.general.hideZero.description));
  selector.find("li:nth-child(6) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(6) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(7) .left span').text(clear(template.settings.overlay.hotkey.name));
  selector.find('li:nth-child(7) .help').text(clear(template.settings.overlay.hotkey.description));
  selector.find('#btn-hotkey-preview').attr('title', clear(template.settings.overlay.hotkey.preview));
  if (template.settings.general.startup) {
    const startup = $('#option_startWithWindows').closest('li');
    startup.find('.left span').text(clear(template.settings.general.startup.name));
    startup.find('.help').text(clear(template.settings.general.startup.description));
    startup.find("select option[value='true']").text(clear(template.settings.common.enable));
    startup.find("select option[value='false']").text(clear(template.settings.common.disable));
  }
  if (template.settings.general.tray) {
    $('#close-tray-settings-label').text(clear(template.settings.general.tray.name));
    $('#close-tray-settings-help').text(clear(template.settings.general.tray.description));
    $("#option_closeToTray option[value='true']").text(clear(template.settings.common.enable));
    $("#option_closeToTray option[value='false']").text(clear(template.settings.common.disable));
  }
  if (template.settings.general.onboarding) {
    $('#onboarding-settings-label').text(clear(template.settings.general.onboarding.name));
    $('#btn-onboarding-open span').text(clear(template.settings.general.onboarding.button));
    $('#onboarding-settings-help').text(clear(template.settings.general.onboarding.description));
  }
  if (template.settings.general.hardwareAccel) {
    $('#hwaccel-settings-label').text(clear(template.settings.general.hardwareAccel.name));
    $('#hwaccel-settings-help').text(clear(template.settings.general.hardwareAccel.description));
    $("#option_disableHardwareAccel option[value='true']").text(clear(template.settings.common.enable));
    $("#option_disableHardwareAccel option[value='false']").text(clear(template.settings.common.disable));
  }
  if (template.settings.general.controller) {
    const ctl = template.settings.general.controller;
    $('#controller-settings-title').text(clear(ctl.title));
    $('#controller-enabled-label').text(clear(ctl.enabled.name));
    $('#controller-enabled-help').text(clear(ctl.enabled.description));
    $("#option_controllerEnabled option[value='true']").text(clear(template.settings.common.enable));
    $("#option_controllerEnabled option[value='false']").text(clear(template.settings.common.disable));
    $('#controller-app-label').text(clear(ctl.appNavigation.name));
    $('#controller-app-help').text(clear(ctl.appNavigation.description));
    $("#option_controllerAppNavigation option[value='true']").text(clear(template.settings.common.enable));
    $("#option_controllerAppNavigation option[value='false']").text(clear(template.settings.common.disable));
    $('#controller-layout-label').text(clear(ctl.layout.name));
    $('#controller-layout-help').text(clear(ctl.layout.description));
    $("#option_controllerLayout option[value='auto']").text(clear(ctl.layout.auto));
    $('#controller-toggle-binding-label').text(clear(ctl.bindings.toggle));
    $('#controller-toggle-binding-help').text(clear(ctl.bindings.toggleDescription));
    $('#controller-ui-binding-label').text(clear(ctl.bindings.ui));
    $('#controller-ui-binding-help').text(clear(ctl.bindings.uiDescription));
    $('#controller-move-binding-label').text(clear(ctl.bindings.move));
    $('#controller-move-binding-help').text(clear(ctl.bindings.moveDescription));
    $('#controller-focus-label').text(clear(ctl.priority.name));
    $('#controller-focus-help').text(clear(ctl.priority.description));
    $("#option_controllerFocusOverlay option[value='true']").text(clear(template.settings.common.enable));
    $("#option_controllerFocusOverlay option[value='false']").text(clear(template.settings.common.disable));
    $('#controller-pause-label').text(clear(ctl.escape.name));
    $('#controller-pause-help').text(clear(ctl.escape.description));
    $("#option_controllerSendEscape option[value='true']").text(clear(template.settings.common.enable));
    $("#option_controllerSendEscape option[value='false']").text(clear(template.settings.common.disable));
    $('#controller-backend-label').text(clear(ctl.backend.name));
    $('#controller-backend-help').text(clear(ctl.backend.description));
    $("#option_controllerBackend option[value='auto']").text(clear(ctl.backend.auto));
    if (ctl.backend.xinput) $("#option_controllerBackend option[value='xinput']").text(clear(ctl.backend.xinput));
    if (ctl.backend.gameinput) $("#option_controllerBackend option[value='gameinput']").text(clear(ctl.backend.gameinput));
  }
  if (template.settings.general.theme) {
    $('#theme-settings-label').text(clear(template.settings.general.theme.name));
    $('#theme-settings-help').text(clear(template.settings.general.theme.description));
    $('#appearance-title').text(clear(template.settings.general.theme.name));
    $('#theme-customizer-title').text(clear(template.settings.general.theme.customTitle));
    $('#theme-customizer-hint').text(clear(template.settings.general.theme.customHint));
    $('#theme-customizer-desc').text(clear(template.settings.general.theme.customDesc));
    $('#theme-customizer-reset span').text(clear(template.settings.general.theme.resetAll));
    // Theme names themselves are proper nouns and stay untranslated.
  }
  if (template.settings.general.uninstallMenu) {
    $('#uninstall-settings-label').text(clear(template.settings.general.uninstallMenu.name));
    $('#uninstall-settings-help').text(clear(template.settings.general.uninstallMenu.description));
    $("#option_uninstallContextMenu option[value='true']").text(clear(template.settings.common.enable));
    $("#option_uninstallContextMenu option[value='false']").text(clear(template.settings.common.disable));
  }
  $('#general-options-title').text(clear(template.settings.general.sectionTitle));

  // Emulator setup section (own settings tab) — bound by stable id, not nth-child.
  if (template.settings.emulator) {
    const emu = template.settings.emulator;
    if (emu.nav) $('#emulator-nav-label').text(clear(emu.nav));
    if (emu.sectionTitle) $('#emulator-options-title').text(clear(emu.sectionTitle));
    if (emu.intro) $('#emulator-options-intro').text(clear(emu.intro));
    if (emu.coreTitle) $('#emulator-core-title').text(clear(emu.coreTitle));
    if (emu.advancedTitle) $('#emulator-advanced-title').text(clear(emu.advancedTitle));
    if (emu.loginTitle) $('#emulator-login-title').text(clear(emu.loginTitle));
    if (emu.loginWarning) $('#emulator-login-warning').text(clear(emu.loginWarning));
    if (emu.loginDesc) $('#emulator-login-desc').text(clear(emu.loginDesc));
    if (emu.loginUser) $('#emulator-login-user-label').text(clear(emu.loginUser));
    if (emu.loginPass) $('#emulator-login-pass-label').text(clear(emu.loginPass));
    if (emu.loginTest) $('#emulator-login-test-label').text(clear(emu.loginTest));
    if (emu.loginTestHint) $('#emulator-login-test-hint').text(clear(emu.loginTestHint));
    if (emu.loginPlaceholder) $('#emulator-login-user').attr('placeholder', clear(emu.loginPlaceholder));
    const bindEmuRow = (id, t) => {
      if (!t) return;
      const li = $('#' + id).closest('li');
      if (t.name) li.find('.left span').text(clear(t.name));
      if (t.description) li.find('.help').text(clear(t.description));
      if (t.value) for (const v in t.value) li.find("select option[value='" + v + "']").text(clear(t.value[v]));
    };
    bindEmuRow('option_autoApplyNewGames', emu.autoApply);
    bindEmuRow('option_steamSettingsMode', emu.steamSettings);
    bindEmuRow('option_login', emu.login);
    bindEmuRow('option_steamlessAutoUnpack', emu.steamless);
    bindEmuRow('option_steamlessExperimental', emu.steamlessExp);
    bindEmuRow('option_autoApplyCrackFix', emu.crackFix);
    bindEmuRow('option_apiCheckBypass', emu.apiCheckBypass);
    bindEmuRow('option_checkUpdates', emu.checkUpdates);
    bindEmuRow('option_goldbergDownloadIcons', emu.goldbergIcons);
  }

  // Help & tips section: static help, bound by stable ids so settings rows can move safely.
  if (template.settings.help) {
    const help = template.settings.help;
    const bindHelpText = (id, value) => {
      if (value) $('#' + id).text(clear(value));
    };
    const bindHelpList = (id, items) => {
      if (!Array.isArray(items)) return;
      const list = $('#' + id);
      if (!list.length) return;
      list.empty();
      items.forEach((item) => $('<li>').text(clear(item) || '').appendTo(list));
    };
    bindHelpText('help-nav-label', help.nav);
    bindHelpText('help-title', help.title);
    bindHelpText('help-intro', help.intro);
    bindHelpText('help-setup-title', help.setupTitle);
    bindHelpText('help-topics-title', help.topicsTitle);
    bindHelpText('help-no-results', help.noResults);
    const helpSearchPlaceholder = clear(help.searchPlaceholder);
    if (helpSearchPlaceholder) {
      $('#help-search-input').attr('placeholder', helpSearchPlaceholder).attr('aria-label', helpSearchPlaceholder);
    }
    const helpSearchClear = clear(template.settings.search && template.settings.search.clear);
    if (helpSearchClear) $('#help-search-clear').attr('title', helpSearchClear).attr('aria-label', helpSearchClear);
    bindHelpText('help-quick-title', help.quickTitle);
    bindHelpText('help-steam-title', help.steamTitle);
    bindHelpText('help-emulator-title', help.emulatorTitle);
    bindHelpText('help-sources-title', help.sourcesTitle);
    bindHelpText('help-controller-title', help.controllerTitle);
    bindHelpText('help-overlay-title', help.overlayTitle);
    bindHelpText('help-themes-title', help.themesTitle);
    bindHelpText('help-config-title', help.configTitle);
    bindHelpText('help-shortcuts-title', help.shortcutsTitle);
    bindHelpText('help-tips-title', help.tipsTitle);
    bindHelpText('help-troubleshoot-title', help.troubleshootTitle);
    bindHelpList('help-quick-list', help.quick);
    bindHelpList('help-steam-list', help.steam);
    bindHelpList('help-emulator-list', help.emulators);
    bindHelpList('help-sources-list', help.sources);
    bindHelpList('help-controller-list', help.controller);
    bindHelpList('help-overlay-list', help.overlay);
    bindHelpList('help-themes-list', help.themes);
    bindHelpList('help-config-list', help.config);
    bindHelpList('help-shortcuts-list', help.shortcuts);
    bindHelpList('help-tips-list', help.tips);
    bindHelpList('help-troubleshoot-list', help.troubleshoot);
  }

  $('#options-notify .autosave-hint span').text(clear(template.settings.notification.info.autoSave));
  selector = $('#options-notify-common');
  selector.prev('.title').find('span').text(clear(template.settings.notification.title.common));
  selector.find('li:nth-child(1) .left span').text(clear(template.settings.notification.option.notification.name));
  selector.find("li:nth-child(1) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(1) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(1) .help').text(clear(template.settings.notification.option.notification.description));
  selector.find('li:nth-child(2) .left span').text(clear(template.settings.notification.option.rumble.name));
  selector.find("li:nth-child(2) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(2) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(2) .help').text(clear(template.settings.notification.option.rumble.description));
  selector.find('li:nth-child(3) .left span').text(clear(template.settings.notification.option.notifyOnProgress.name));
  selector.find("li:nth-child(3) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(3) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(3) .help').text(clear(template.settings.notification.option.notifyOnProgress.description));
  selector.find('li:nth-child(4) .left span').text(clear(template.settings.notification.option.playtime.name));
  selector.find("li:nth-child(4) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(4) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(4) .help').text(clear(template.settings.notification.option.playtime.description));
  selector.find('li:nth-child(5) .left span').text(clear(template.settings.notification.option.platinum.name));
  selector.find("li:nth-child(5) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(5) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(5) .help').text(clear(template.settings.notification.option.platinum.description));
  // Group-by-game now lives in the common group (its own "Toast" sub-section was removed).
  selector.find('li:nth-child(6) .left span').text(clear(template.settings.notification.option.groupToast.name));
  selector.find("li:nth-child(6) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(6) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(6) .help').text(clear(template.settings.notification.option.groupToast.description));
  // Appended after groupToast, which was the last row: inserting anywhere else would shift every
  // nth-child binding above and relabel its neighbours.
  selector.find('li:nth-child(7) .left span').text(clear(template.settings.notification.option.urgent.name));
  selector.find("li:nth-child(7) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(7) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(7) .help').text(clear(template.settings.notification.option.urgent.description));
  selector = $('#options-notify-transport');
  selector.prev('.title').find('span').text(clear(template.settings.notification.title.transport));
  selector.find("li:nth-child(1) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(1) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(1) .help').text(clear(template.settings.notification.option.useWS.description));
  selector = $('#options-notify-test');
  selector.prev('.title').find('span').text(clear(template.settings.notification.title.test));
  $('#notify_test span').text(clear(template.settings.notification.test.achievement));
  if (template.settings.notification.test.rare) {
    $('#notify_rare_test span').text(clear(template.settings.notification.test.rare));
  }
  $('#notify_progress_test span').text(clear(template.settings.notification.test.progress));
  $('#notify_playtime_test span').text(clear(template.settings.notification.test.playtime));
  $('#notify_platinum_test span').text(clear(template.settings.notification.test.platinum));
  // Overlay (in-game) notification section — bound by stable ids to avoid nth-child fragility.
  $('#overlay-notify-title').text(clear(template.settings.notification.title.overlay));
  $('#lbl-notifMode').text(clear(template.settings.notification.option.mode.name));
  $("#option_notifMode option[value='toast']").text(clear(template.settings.notification.option.mode.value.toast));
  $("#option_notifMode option[value='overlay']").text(clear(template.settings.notification.option.mode.value.overlay));
  $("#option_notifMode option[value='both']").text(clear(template.settings.notification.option.mode.value.both));
  $('#lbl-overlayPreset').text(clear(template.settings.notification.option.overlayPreset));
  if (template.settings.notification.option.overlayPresetRare) {
    const opt = template.settings.notification.option;
    $('#lbl-overlayPresetRare').text(clear(opt.overlayPresetRare));
    $('#lbl-overlayPresetPlatinum').text(clear(opt.overlayPresetPlatinum));
    $('#lbl-overlayPresetRare').closest('li').find('.help').text(clear(opt.overlayPresetRareDesc));
    $('#lbl-overlayPresetPlatinum').closest('li').find('.help').text(clear(opt.overlayPresetPlatinumDesc));
    // "Same as main" is dynamic (the dropdowns are (re)populated async) — expose it as a data attr
    // and refresh the '' option if it is already there.
    $('#option_overlayPresetRare, #option_overlayPresetPlatinum').attr('data-lang-same', clear(opt.presetSameAsMain));
    $("#option_overlayPresetRare option[value=''], #option_overlayPresetPlatinum option[value='']").text(clear(opt.presetSameAsMain));
    $('#option_overlayPresetXenia, #option_overlayPresetRpcs3, #option_overlayPresetShadps4').attr('data-lang-same', clear(opt.presetSameAsMain));
    $("#option_overlayPresetXenia option[value=''], #option_overlayPresetRpcs3 option[value=''], #option_overlayPresetShadps4 option[value='']").text(
      clear(opt.presetSameAsMain)
    );
  }
  $('#lbl-overlayPosition').text(clear(template.settings.notification.option.overlayPosition));
  $('#lbl-overlayScale').text(clear(template.settings.notification.option.overlayScale));
  $('#lbl-overlaySound').text(clear(template.settings.notification.option.overlaySound));
  $('#lbl-overlayRandomSound').text(clear(template.settings.notification.option.overlayRandomSound));
  $('#lbl-overlayVolume').text(clear(template.settings.notification.option.overlayVolume));
  $('#lbl-overlayDuration').text(clear(template.settings.notification.option.overlayDuration));
  $('#option_overlayRandomSound option[value="false"]').text(clear(template.settings.common.disable));
  $('#option_overlayRandomSound option[value="true"]').text(clear(template.settings.common.enable));
  if (template.settings.notification.option.overlaySoundImport) {
    $('#btn-import-sound').attr('title', clear(template.settings.notification.option.overlaySoundImport));
  }
  // Per-option descriptions for the in-game overlay rows (bound to each row's .help via its label).
  $('#lbl-notifMode').closest('li').find('.help').text(clear(template.settings.notification.option.mode.description));
  $('#lbl-overlayPreset').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPresetDesc));
  $('#lbl-overlayPresetXenia').text(clear(template.settings.notification.option.overlayPresetXenia));
  $('#lbl-overlayPresetXenia').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPresetXeniaDesc));
  $('#lbl-overlayPresetRpcs3').text(clear(template.settings.notification.option.overlayPresetRpcs3));
  $('#lbl-overlayPresetRpcs3').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPresetRpcs3Desc));
  $('#lbl-overlayPresetShadps4').text(clear(template.settings.notification.option.overlayPresetShadps4));
  $('#lbl-overlayPresetShadps4').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPresetShadps4Desc));
  $('#lbl-overlayPosition').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPositionDesc));
  $('#lbl-overlaySound').closest('li').find('.help').text(clear(template.settings.notification.option.overlaySoundDesc));
  $('#lbl-overlayRandomSound').closest('li').find('.help').text(clear(template.settings.notification.option.overlayRandomSoundDesc));
  $('#lbl-overlayScale').closest('li').find('.help').text(clear(template.settings.notification.option.overlayScaleDesc));
  $('#lbl-overlayVolume').closest('li').find('.help').text(clear(template.settings.notification.option.overlayVolumeDesc));
  $('#lbl-overlayDuration').closest('li').find('.help').text(clear(template.settings.notification.option.overlayDurationDesc));
  $("#option_overlayDuration option[value='auto']").text(clear(template.settings.notification.option.overlayDurationAuto));
  if (template.settings.notification.option.souvenirTitle) {
    const opt = template.settings.notification.option;
    $('#souvenir-notify-title').text(clear(opt.souvenirTitle));
    $('#lbl-souvenirScreenshot').text(clear(opt.souvenirScreenshot));
    $('#lbl-souvenirScreenshot').closest('li').find('.help').text(clear(opt.souvenirScreenshotDesc));
    $("#option_souvenirScreenshot option[value='true']").text(clear(template.settings.common.enable));
    $("#option_souvenirScreenshot option[value='false']").text(clear(template.settings.common.disable));
    $('#lbl-souvenirDir').text(clear(opt.souvenirDir));
    $('#souvenir-dir-help').text(clear(opt.souvenirDirHelp));
  }
  if (template.settings.notification.option.customiser) {
    const c = template.settings.notification.option.customiser;
    $('#customiser-title').text(clear(c.title));
    $('#customiser-intro').text(clear(c.intro));
    $('#cust-lbl-name').text(clear(c.name));
    $('#cust-lbl-bg').text(clear(c.background));
    $('#cust-lbl-text').text(clear(c.text));
    $('#cust-lbl-accent').text(clear(c.accent));
    $('#cust-lbl-opacity').text(clear(c.opacity));
    $('#cust-lbl-font').text(clear(c.fontSize));
    $('#cust-lbl-radius').text(clear(c.corners));
    $('#cust-lbl-icon').text(clear(c.iconSize));
    $('#cust-lbl-width').text(clear(c.width));
    $('#cust-lbl-load').text(clear(c.edit));
    $('#cust-lbl-preview').text(clear(c.preview));
    $('#cust-lbl-delete').text(clear(c.deleteLabel));
    // The create button and the preset picker swap their wording at runtime (create vs update,
    // "new preset" placeholder), so both spellings are parked on data attributes here and the
    // settings code re-renders them on the event below.
    $('#cust-lbl-create').attr('data-create', clear(c.create)).attr('data-update', clear(c.update)).text(clear(c.create));
    $('#cust-load').attr('data-new', clear(c.editNew));
    $('#cust-name').attr('placeholder', clear(c.namePlaceholder));
    $('#cust-status')
      .attr('data-err', clear(c.errName))
      .attr('data-ok', clear(c.created))
      .attr('data-updated', clear(c.updated))
      .attr('data-loaded', clear(c.loaded))
      .attr('data-deleted', clear(c.deleted))
      .attr('data-fail', clear(c.failed));
    if (c.previewTitle) $('#cust-preview-title').text(clear(c.previewTitle));
    if (c.previewDetail) $('#cust-preview-detail').text(clear(c.previewDetail));
    $(document).trigger('customiser-labels-changed');
  }
  // Localize the 8 overlay position options + expose the dynamic "None" sound label as a data attr.
  $("#option_overlayPosition option[value='center-bottom']").text(clear(template.settings.notification.option.position.centerBottom));
  $("#option_overlayPosition option[value='center-top']").text(clear(template.settings.notification.option.position.centerTop));
  $("#option_overlayPosition option[value='top-left']").text(clear(template.settings.notification.option.position.topLeft));
  $("#option_overlayPosition option[value='top-right']").text(clear(template.settings.notification.option.position.topRight));
  $("#option_overlayPosition option[value='bottom-left']").text(clear(template.settings.notification.option.position.bottomLeft));
  $("#option_overlayPosition option[value='bottom-right']").text(clear(template.settings.notification.option.position.bottomRight));
  $("#option_overlayPosition option[value='middle-left']").text(clear(template.settings.notification.option.position.middleLeft));
  $("#option_overlayPosition option[value='middle-right']").text(clear(template.settings.notification.option.position.middleRight));
  if (template.settings.notification.option.position.custom)
    $("#option_overlayPosition option[value='custom']").text(clear(template.settings.notification.option.position.custom));
  if (template.settings.notification.option.reposition) $('#btn-overlay-reposition').attr('title', clear(template.settings.notification.option.reposition));
  $('#option_overlaySound').attr('data-lang-none', clear(template.settings.notification.option.soundNone));
  selector = $("#settings .box .content[data-view='folder']");
  selector.find('.disclaimer span').text(clear(template.settings.folder.headline));
  selector.find('.title:eq(0) span').text(clear(template.settings.folder.default));
  selector.find('.title:eq(1) span').text(clear(template.settings.folder.custom));
  $('#addCustomDir span').text(clear(template.settings.folder.add));
  if (template.settings.folder.smartFind) $('#smartFind-label').text(clear(template.settings.folder.smartFind));
  if (template.settings.folder.smartFindHelp) $('#smartFind-help').text(clear(template.settings.folder.smartFindHelp));
  $('#folder-add-info').html(clear(template.settings.folder.addInfo.join('\n')).replace(/\n/g, '<br>'));
  selector.find('.title:eq(2) span').text(clear(template.settings.folder.library));
  $('#addLibraryDir span').text(clear(template.settings.folder.addLibrary));
  if (template.settings.folder.generateConfigs) $('#generate-configs-label').text(clear(template.settings.folder.generateConfigs));
  if (template.settings.folder.generateConfigsHelp) $('#generate-configs-help').text(clear(template.settings.folder.generateConfigsHelp));
  $('#folder-library-info').html(clear(template.settings.folder.libraryInfo.join('\n')).replace(/\n/g, '<br>'));
  const folderRescan = template.dialogs;
  if (folderRescan) {
    $('#folder-rescan-title').text(clear(folderRescan['rescan-selected-folders']));
    $('#folder-rescan-help').text(clear(folderRescan['rescan-selected-help']));
    $('#folder-rescan-select-all span').text(clear(folderRescan['rescan-select-all']));
    $('#folder-rescan-select-none span').text(clear(folderRescan['rescan-select-none']));
    $('#folder-rescan-run span').text(clear(folderRescan['rescan-selected-folders']));
  }
  selector = $('#options-source');
  $('#source-options-title').text(clear(template.settings.source.title));
  if (template.settings.source.officialPlatforms) {
    $('#source-official-title').text(clear(template.settings.source.officialPlatforms.title));
    $('#source-official-description').text(clear(template.settings.source.officialPlatforms.description));
  }
  selector.find('li:nth-child(1) .left span').text(clear(template.settings.source.legitSteam.name));
  selector.find("li:nth-child(1) .right select option[value='0']").text(clear(template.settings.source.legitSteam.value.none));
  selector.find("li:nth-child(1) .right select option[value='1']").text(clear(template.settings.source.legitSteam.value.installed));
  selector.find("li:nth-child(1) .right select option[value='2']").text(clear(template.settings.source.legitSteam.value.owned));
  selector.find('li:nth-child(1) .help').text(clear(template.settings.source.legitSteam.description));
  selector.find('li:nth-child(2) .left span').text(clear(template.settings.source.steamEmu.name));
  selector.find("li:nth-child(2) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(2) .right select option[value='false']").text(clear(template.settings.common.disable));
  if (template.settings.source.steamEmu.description) selector.find('li:nth-child(2) .help').text(clear(template.settings.source.steamEmu.description));
  selector.find("li:nth-child(3) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(3) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(3) .help').text(clear(template.settings.source.greenLuma.description));
  selector.find("li:nth-child(4) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(4) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(4) .help').text(clear(template.settings.source.rpcs3.description));
  selector.find("li:nth-child(5) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(5) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(5) .help').text(clear(template.settings.source.lumaPlay.description));
  selector.find('li:nth-child(6) .left span').text(clear(template.settings.source.ea.name));
  selector.find("li:nth-child(6) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(6) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(6) .help').text(clear(template.settings.source.ea.description));
  selector.find('li:nth-child(7) .left span').text(clear(template.settings.source.xboxPc.name));
  selector.find("li:nth-child(7) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(7) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(7) .help').text(clear(template.settings.source.xboxPc.description));
  selector.find('li:nth-child(8) .left span').text(clear(template.settings.source.importCache.name));
  selector.find("li:nth-child(8) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(8) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(8) .help').text(clear(template.settings.source.importCache.description));
  selector.find('li:nth-child(9) .left span').text(clear(template.settings.source.socialClub.name));
  selector.find("li:nth-child(9) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(9) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(9) .help').text(clear(template.settings.source.socialClub.description));
  // Sources whose row carries a proper name (shadPS4, Ubisoft Connect, ...) only need their help
  // text translated. Bound by id rather than by position: the nth-child bindings above break the
  // moment a row is inserted anywhere but the end, which is why these are kept out of that scheme.
  for (const key of ['ubisoftOfficial', 'gogOfficial', 'epicOfficial', 'gog', 'epic', 'shadps4', 'xenia']) {
    const source = template.settings.source[key];
    if (source && source.description) $(`#source-help-${key}`).text(clear(source.description));
    $(`#option_${key} option[value='true']`).text(clear(template.settings.common.enable));
    $(`#option_${key} option[value='false']`).text(clear(template.settings.common.disable));
  }
  $('#advanced-blacklist-title').text(clear(template.settings.advanced.blacklistTitle));
  $('#blacklist_reset span').text(clear(template.settings.advanced.blacklistButton));
  $('#blacklist-info').text(clear(template.settings.advanced.blacklistInfo));
  if (template.settings.advanced.blacklistEmpty) {
    $('#blacklist-manager')
      .attr('data-empty', clear(template.settings.advanced.blacklistEmpty))
      .attr('data-restore', clear(template.settings.advanced.blacklistRestore));
  }
  if (template.onboarding) {
    $('#folder-action-result')
      .attr('data-running', clear(template.onboarding.smartRunning))
      .attr('data-done', clear(template.onboarding.smartDone))
      .attr('data-invalid', clear(template.onboarding.invalidFolder));
  }
  // Maintenance + Fix-all (Avancé tab) — stable ids.
  if (template.settings.advanced.maintenanceTitle) $('#adv-maintenance-title').text(clear(template.settings.advanced.maintenanceTitle));
  if (template.settings.advanced.fixAll) {
    $('#fix-all-label').text(clear(template.settings.advanced.fixAll.name));
    $('#fix-all-button').text(clear(template.settings.advanced.fixAll.button));
    $('#fix-all-help').text(clear(template.settings.advanced.fixAll.description));
  }
  if (template.settings.advanced.clearUpdateCache) {
    $('#clear-update-cache-label').text(clear(template.settings.advanced.clearUpdateCache.name));
    $('#clear-update-cache-button').text(clear(template.settings.advanced.clearUpdateCache.button));
    $('#clear-update-cache-help').text(clear(template.settings.advanced.clearUpdateCache.description));
  }
  if (template.settings.advanced.forceAchievementRecheck) {
    $('#force-achievement-recheck-label').text(clear(template.settings.advanced.forceAchievementRecheck.name));
    $('#force-achievement-recheck-button').text(clear(template.settings.advanced.forceAchievementRecheck.button));
    $('#force-achievement-recheck-help').text(clear(template.settings.advanced.forceAchievementRecheck.description));
  }
  if (template.settings.advanced.checkUpdates) {
    $('#check-for-updates-label').text(clear(template.settings.advanced.checkUpdates));
    $('#footer-check-updates')
      .attr('title', clear(template.settings.advanced.checkUpdates))
      .attr('aria-label', clear(template.settings.advanced.checkUpdates));
  }
  // Diagnostics block (merged into the Avancé tab) — stable ids.
  if (template.settings.advanced.diag) {
    const d = template.settings.advanced.diag;
    $('#adv-diag-title').text(clear(d.title));
    $('#open-logs span').text(clear(d.logsFolder));
    $('#open-userdata span').text(clear(d.dataFolder));
    $('#adv-goldberg-title').text(clear(d.goldbergTitle));
    $('#adv-goldberg-desc').text(clear(d.goldbergDesc));
    $('#scan-gbe span').text(clear(d.scanFolder));
  }
  selector = $('#options-mainSteam');
  $('#adv-mainsteam-title span').text(clear(template.settings.advanced.mainSteam.title));
  selector.find('li:nth-child(1) .left span').text(clear(template.settings.advanced.mainSteam.name));
  selector.find('li:nth-child(1) .right select option[value="0"]').text(clear(template.settings.source.legitSteam.value.none));
  selector.find('li:nth-child(1) .help').text(clear(template.settings.advanced.mainSteam.description));
  selector;
  selector = $('#settings .box .footer .notice p:nth-child(1)');
  selector.find('span:eq(0)').text(clear(template.settings.common.version));
  selector.find('span:eq(1)').text(clear(remote.app.getVersion()));
  selector.find('a:first').text(clear(template.settings.common.maintainedBy));
  $('#settings .box .footer .notice p:nth-child(2) a:first').text(clear(template.settings.common.fork));
  $('#settings .box .footer .notice p:nth-child(3) a:first').text(clear(template.settings.common.original));
  $("#settingNav li[data-view='general'] span").text(clear(template.settings.sideMenu.general));
  $("#settingNav li[data-view='controller'] span").text(clear(template.settings.general.controller.title));
  $("#settingNav li[data-view='notification'] span").text(clear(template.settings.sideMenu.notification));
  $("#settingNav li[data-view='folder'] span").text(clear(template.settings.sideMenu.folder));
  $("#settingNav li[data-view='source'] span").text(clear(template.settings.sideMenu.source));
  if (template.settings.general.theme) $("#settingNav li[data-view='appearance'] span").text(clear(template.settings.general.theme.name));
  $("#settingNav li[data-view='advanced'] span").text(clear(template.settings.sideMenu.advanced));
  // Sidebar group headers keep the flat list readable without adding new locale keys.
  $('#nav-group-general').text(clear(template.settings.sideMenu.general));
  $('#nav-group-notification').text(clear(template.settings.sideMenu.notification));
  $('#nav-group-library').text(clear(template.settings.source.title || template.settings.sideMenu.source));
  $('#nav-group-help').text(clear(template.settings.help.nav));
  $('#nav-group-advanced').text(clear(template.settings.sideMenu.advanced));
  $('#btn-settings-cancel').text(clear(template.settings.common.cancel));
  $('#btn-settings-save').text(clear(template.settings.common.save));
  $('#btn-game-config-cancel').text(clear(template.settings.common.cancel));
  $('#btn-game-config-save').text(clear(template.settings.common.save));
}

function clear(str) {
  if (str) {
    return stripTags(str.toString());
  }
}
