'use strict';

const remote = require('@electron/remote');

const merge = require('deepmerge');
const ffs = require('../util/fsAsync');

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
  if (template.settings.general.theme) {
    $('#theme-settings-label').text(clear(template.settings.general.theme.name));
    $('#theme-settings-help').text(clear(template.settings.general.theme.description));
    // Theme names themselves are proper nouns and stay untranslated.
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
    const bindEmuRow = (id, t) => {
      if (!t) return;
      const li = $('#' + id).closest('li');
      if (t.name) li.find('.left span').text(clear(t.name));
      if (t.description) li.find('.help').text(clear(t.description));
      if (t.value) for (const v in t.value) li.find("select option[value='" + v + "']").text(clear(t.value[v]));
    };
    bindEmuRow('option_autoApplyNewGames', emu.autoApply);
    bindEmuRow('option_mode', emu.mode);
    bindEmuRow('option_steamSettingsMode', emu.steamSettings);
    bindEmuRow('option_login', emu.login);
    bindEmuRow('option_steamlessAutoUnpack', emu.steamless);
    bindEmuRow('option_steamlessExperimental', emu.steamlessExp);
    bindEmuRow('option_autoApplyCrackFix', emu.crackFix);
    bindEmuRow('option_apiCheckBypass', emu.apiCheckBypass);
    bindEmuRow('option_createLaunchBat', emu.launchBat);
    bindEmuRow('option_checkUpdates', emu.checkUpdates);
    bindEmuRow('option_goldbergDownloadIcons', emu.goldbergIcons || template.settings.general.goldbergIcons);
  }

  // Platform guide section: static help, bound by stable ids so settings rows can move safely.
  if (template.settings.guide) {
    const guide = template.settings.guide;
    const bindGuideText = (id, value) => {
      if (value) $('#' + id).text(clear(value));
    };
    const bindGuideList = (id, items) => {
      if (!Array.isArray(items)) return;
      const list = $('#' + id);
      if (!list.length) return;
      list.empty();
      items.forEach((item) => $('<li>').text(clear(item) || '').appendTo(list));
    };
    bindGuideText('guide-nav-label', guide.nav);
    bindGuideText('guide-title', guide.title);
    bindGuideText('guide-intro', guide.intro);
    bindGuideText('guide-quick-title', guide.quickTitle);
    bindGuideText('guide-steam-title', guide.steamTitle);
    bindGuideText('guide-emulator-title', guide.emulatorTitle);
    bindGuideText('guide-sources-title', guide.sourcesTitle);
    bindGuideText('guide-config-title', guide.configTitle);
    bindGuideText('guide-troubleshoot-title', guide.troubleshootTitle);
    bindGuideList('guide-quick-list', guide.quick);
    bindGuideList('guide-steam-list', guide.steam);
    bindGuideList('guide-emulator-list', guide.emulators);
    bindGuideList('guide-sources-list', guide.sources);
    bindGuideList('guide-config-list', guide.config);
    bindGuideList('guide-troubleshoot-list', guide.troubleshoot);
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
  }
  $('#lbl-overlayPosition').text(clear(template.settings.notification.option.overlayPosition));
  $('#lbl-overlayScale').text(clear(template.settings.notification.option.overlayScale));
  $('#lbl-overlaySound').text(clear(template.settings.notification.option.overlaySound));
  $('#lbl-overlayVolume').text(clear(template.settings.notification.option.overlayVolume));
  $('#lbl-overlayDuration').text(clear(template.settings.notification.option.overlayDuration));
  if (template.settings.notification.option.overlaySoundImport) {
    $('#btn-import-sound').attr('title', clear(template.settings.notification.option.overlaySoundImport));
  }
  // Per-option descriptions for the in-game overlay rows (bound to each row's .help via its label).
  $('#lbl-notifMode').closest('li').find('.help').text(clear(template.settings.notification.option.mode.description));
  $('#lbl-overlayPreset').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPresetDesc));
  $('#lbl-overlayPosition').closest('li').find('.help').text(clear(template.settings.notification.option.overlayPositionDesc));
  $('#lbl-overlaySound').closest('li').find('.help').text(clear(template.settings.notification.option.overlaySoundDesc));
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
    $('#cust-lbl-create').text(clear(c.create));
    $('#cust-name').attr('placeholder', clear(c.namePlaceholder));
    $('#cust-status').attr('data-err', clear(c.errName)).attr('data-ok', clear(c.created)).attr('data-fail', clear(c.failed));
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
  $("#settings .content[data-view='folder'] > .controls .info p")
    .eq(0)
    .html(clear(template.settings.folder.addInfo.join('\n')).replace(/\n/g, '<br>'));
  selector.find('.title:eq(2) span').text(clear(template.settings.folder.library));
  $('#addLibraryDir span').text(clear(template.settings.folder.addLibrary));
  if (template.settings.folder.generateConfigs) $('#generate-configs-label').text(clear(template.settings.folder.generateConfigs));
  if (template.settings.folder.generateConfigsHelp) $('#generate-configs-help').text(clear(template.settings.folder.generateConfigsHelp));
  $("#settings .content[data-view='folder'] > .controls .info p")
    .eq(1)
    .html(clear(template.settings.folder.libraryInfo.join('\n')).replace(/\n/g, '<br>'));
  selector = $('#options-source');
  $('#source-options-title').text(clear(template.settings.source.title));
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
  selector.find('li:nth-child(7) .left span').text(clear(template.settings.source.importCache.name));
  selector.find("li:nth-child(7) .right select option[value='true']").text(clear(template.settings.common.enable));
  selector.find("li:nth-child(7) .right select option[value='false']").text(clear(template.settings.common.disable));
  selector.find('li:nth-child(7) .help').text(clear(template.settings.source.importCache.description));
  $('#advanced-blacklist-title').text(clear(template.settings.advanced.blacklistTitle));
  $('#blacklist_reset span').text(clear(template.settings.advanced.blacklistButton));
  $('#blacklist_reset ~ div').text(clear(template.settings.advanced.blacklistInfo));
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
  // Diagnostics block (merged into the Avancé tab) — stable ids.
  if (template.settings.advanced.diag) {
    const d = template.settings.advanced.diag;
    $('#adv-diag-title').text(clear(d.title));
    $('#diag-apikey-label').text(clear(d.apiKeyLabel));
    if (d.apiKeyConfigured) $('#diag-apikey').attr('data-configured', clear(d.apiKeyConfigured));
    if (d.apiKeyFallback) $('#diag-apikey').attr('data-fallback', clear(d.apiKeyFallback));
    $('#open-logs span').text(clear(d.logsFolder));
    $('#open-userdata span').text(clear(d.dataFolder));
    $('#adv-goldberg-title').text(clear(d.goldbergTitle));
    $('#adv-goldberg-desc').text(clear(d.goldbergDesc));
    $('#scan-gbe span').text(clear(d.scanFolder));
    $('#adv-winnotif-title').text(clear(d.winNotifTitle));
    $('#adv-focus-assist').text(clear(d.focusAssist));
    $('#adv-notif-actions').text(clear(d.notifActions));
    $('#adv-winnotif-desc').text(clear(d.winNotifDesc));
  }
  $('#steam-api-title').text(clear(template.settings.advanced.apiKey.title));
  $('#steam-api-description').text(clear(template.settings.advanced.apiKey.description));
  $('#steam-api-fallback').text(clear(template.settings.advanced.apiKey.fallback));
  $('#steam-api-create').text(clear(template.settings.advanced.apiKey.create));
  $('#steam-api-terms').text(clear(template.settings.advanced.apiKey.terms));
  $('#steam-api-label').text(clear(template.settings.advanced.apiKey.label));
  $('#steam-api-security').text(clear(template.settings.advanced.apiKey.security));
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
  $("#settingNav li[data-view='overlay'] span").text(clear(template.settings.sideMenu.overlay));
  $("#settingNav li[data-view='notification'] span").text(clear(template.settings.sideMenu.notification));
  $("#settingNav li[data-view='folder'] span").text(clear(template.settings.sideMenu.folder));
  $("#settingNav li[data-view='source'] span").text(clear(template.settings.sideMenu.source));
  const guideNav = (template.settings.guide && template.settings.guide.nav) || template.settings.sideMenu.guide || 'Guide';
  $("#settingNav li[data-view='guide'] span").text(clear(guideNav));
  $("#settingNav li[data-view='advanced'] span").text(clear(template.settings.sideMenu.advanced));
  $('#btn-settings-cancel').text(clear(template.settings.common.cancel));
  $('#btn-settings-save').text(clear(template.settings.common.save));
  $('#btn-game-config-cancel').text(clear(template.settings.common.cancel));
  $('#btn-game-config-save').text(clear(template.settings.common.save));
}

function clear(str) {
  if (str) {
    str = str.toString();
    return str.replace(/<\/?[^>]+>/gi, '');
  }
}
