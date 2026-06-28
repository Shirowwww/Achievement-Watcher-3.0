'use strict';

const onboardingFs = require('fs');
const merge = require('deepmerge');
const onboardingAvatar = require(path.join(appPath, 'components/userAvatar/avatar.js'));
const uiLanguages = require(path.join(appPath, 'locale/uiLanguages.js'));

(function ($, window, document) {
  const STEAM_API_KEY_URL = 'https://steamcommunity.com/dev/apikey';
  const STEP_COUNT = 6;
  const onboardingTextCache = new Map();
  let step = 0;
  let addedSaveDirs = [];
  let addedLibraryDirs = [];
  let languageChosenThisSession = false;
  // Auto-config gate: at first run, proactively detect candidate save folders when the folders step is
  // first shown so the user reviews/trims real candidates instead of starting from an empty list.
  let isFirstRunSession = false;
  let autoDetectedThisSession = false;

  function localizedText() {
    const lang = uiLanguages.has(app.config?.achievement?.lang) ? app.config.achievement.lang : 'english';
    if (onboardingTextCache.has(lang)) return onboardingTextCache.get(lang);

    try {
      const english = JSON.parse(onboardingFs.readFileSync(path.join(appPath, 'locale/lang/english.json'), 'utf8')).onboarding || {};
      const requested =
        lang === 'english' ? english : JSON.parse(onboardingFs.readFileSync(path.join(appPath, `locale/lang/${lang}.json`), 'utf8')).onboarding || {};
      const localized = merge(english, requested, {
        arrayMerge: (dest, src) => src,
        isEmpty: (a) => a === null || a === '',
      });
      onboardingTextCache.set(lang, localized);
      return localized;
    } catch (err) {
      debug.log(err);
      return null;
    }
  }

  function isFrench() {
    return String(app.config?.achievement?.lang || '').toLowerCase().startsWith('fr');
  }

  function text() {
    const localized = localizedText();
    if (localized) return localized;
    return isFrench()
      ? {
          settingsLabel: 'Guide de démarrage',
          settingsButton: 'Ouvrir le guide',
          settingsHelp: 'Rouvre la configuration guidée : clé API, profil, dossiers, sources et notifications.',
          eyebrow: 'Première configuration',
          close: 'Fermer',
          steps: ['Langue', 'Fonctionnement', 'Compte', 'Clé API', 'Jeux', 'Réglages'],
          languageTitle: 'Choisir la langue',
          languageCopy:
            'Choisis la langue avant le premier scan. Les jeux, métadonnées, succès et caches Steam seront chargés dans cette langue dès le départ.',
          language: 'Langue des jeux et de l’interface',
          languagePlaceholder: 'Choisir une langue...',
          languageHint: 'Le premier chargement de la bibliothèque ne commence qu’après ce choix.',
          introTitle: 'Comment ça marche',
          introCopy:
            "Achievement Watcher scanne les dossiers de sauvegarde connus et tes bibliothèques de jeux, puis le Watchdog reste dans la zone de notification pour les notifications et l'overlay en jeu.",
          scanTitle: 'Scanner',
          scanCopy: 'Steam, GOG, Epic, émulateurs et dossiers Goldberg/GBE sont détectés à partir des fichiers de succès.',
          watchTitle: 'Surveiller',
          watchCopy: 'Le Watchdog observe les fichiers et les lancements de jeux pour afficher les déblocages pendant que tu joues.',
          fixTitle: 'Réparer',
          fixCopy: 'Pour les jeux Steam émulés, le clic droit peut ajouter GBE Fork, les schémas, les DLC et les fichiers de lancement.',
          profileTitle: 'Profil',
          profileCopy: "Choisis le pseudo affiché en haut de l'app et ajoute une photo locale si tu veux.",
          username: 'Pseudo',
          mainSteam: 'Compte Steam principal',
          avatarPick: 'Choisir une photo',
          avatarDefault: 'Par défaut',
          avatarHint: 'Optionnel. Stocké localement sur ce PC.',
          apiTitle: 'Clé API Web Steam',
          apiCopy: 'Une clé améliore la récupération des données Steam. Tu peux laisser vide et la renseigner plus tard.',
          apiWarning:
            '⚠ IMPORTANT : sans clé API, le tout premier chargement de la bibliothèque sera TRÈS LENT — chaque jeu est récupéré en scrapant les pages Steam (plusieurs secondes par jeu). Avec une clé, c’est quasi instantané et plus précis. La fenêtre reste utilisable pendant le chargement, mais c’est vivement recommandé d’en mettre une.',
          apiLabel: 'Clé API Web Steam',
          apiLink: 'Obtenir une clé API Steam',
          apiNote: 'Utilise la page officielle Steam. La clé est chiffrée avant enregistrement.',
          foldersTitle: 'Ajouter les jeux sur disque',
          foldersCopy:
            'Utilise Recherche intelligente pour remplir automatiquement les dossiers connus. Sinon ajoute un dossier de sauvegarde/configuration pour les émulateurs, ou un dossier de bibliothèque qui contient plusieurs jeux installés.',
          addSave: 'Dossier sauvegarde/config',
          smartFind: 'Recherche intelligente',
          addLibrary: 'Dossier de bibliothèque',
          smartFindHint: 'recommandé',
          addSaveHint: 'un émulateur/source',
          addLibraryHint: 'plusieurs jeux installés',
          saveList: 'Sauvegardes / configs',
          libraryList: 'Bibliothèques de jeux',
          emptyList: 'Rien ajouté pour cette session.',
          settingsTitle: 'Réglages recommandés',
          settingsCopy: 'Les interrupteurs les plus utiles au départ. Tout reste modifiable ensuite dans Paramètres.',
          source: 'Afficher les jeux Steam',
          notifications: 'Notifications',
          playtime: 'Suivi du temps de jeu',
          autoFix: 'Auto-fix des jeux émulés',
          hidden: 'Succès cachés',
          merge: 'Fusionner les doublons',
          show: 'Montrer',
          hide: 'Cacher',
          sourceHint: 'Affiche aussi tes jeux Steam légitimes (profil public requis).',
          notificationsHint: 'Où apparaissent les déblocages : toast Windows, overlay en jeu, ou les deux.',
          playtimeHint: 'Suit automatiquement le temps de jeu des jeux détectés.',
          autoFixHint: 'Applique le fix émulateur (GBE Fork, succès, DLC) aux nouveaux jeux émulés.',
          hiddenHint: 'Révèle le nom et la description des succès cachés avant de les débloquer.',
          mergeHint: 'Regroupe un même jeu trouvé dans plusieurs sources en une seule vignette.',
          none: 'Aucun',
          installed: 'Installés',
          owned: 'Possédés',
          toast: 'Toast',
          overlay: 'Overlay',
          both: 'Les deux',
          enabled: 'Activé',
          disabled: 'Désactivé',
          back: 'Retour',
          next: 'Suivant',
          finish: 'Terminer',
          skip: 'Passer',
          saving: 'Enregistrement...',
          saved: 'Configuration enregistrée.',
          languageRequired: 'Choisis une langue pour continuer.',
          invalidFolder: 'Ce dossier ne ressemble pas à un dossier de succès pris en charge.',
          smartRunning: 'Recherche en cours...',
          smartDone: 'Recherche terminée.',
          saveError: "Impossible d'enregistrer la configuration.",
        }
      : {
          settingsLabel: 'First-run guide',
          settingsButton: 'Open guide',
          settingsHelp: 'Reopen the setup guide for API key, profile, folders, sources, and notifications.',
          eyebrow: 'First setup',
          close: 'Close',
          steps: ['Language', 'How it works', 'Account', 'API key', 'Games', 'Settings'],
          languageTitle: 'Choose language',
          languageCopy:
            'Choose the language before the first scan. Games, metadata, achievements, and Steam caches will load in this language from the start.',
          language: 'Game and interface language',
          languagePlaceholder: 'Choose a language...',
          languageHint: 'The first library load starts only after this choice.',
          introTitle: 'How it works',
          introCopy:
            'Achievement Watcher scans known save folders and your game libraries, then the Watchdog keeps running in the tray for unlock notifications and the in-game overlay.',
          scanTitle: 'Scan',
          scanCopy: 'Steam, GOG, Epic, emulators and Goldberg/GBE folders are detected from saved achievement files.',
          watchTitle: 'Watch',
          watchCopy: 'The background Watchdog watches files and game launches so unlocks appear while you play.',
          fixTitle: 'Repair',
          fixCopy: 'For emulated Steam games, the right-click fix can add GBE Fork, schemas, DLC data, and launch helpers.',
          profileTitle: 'Profile',
          profileCopy: 'Pick the name shown in the header and optionally set a local avatar.',
          username: 'Display name',
          mainSteam: 'Main Steam account',
          avatarPick: 'Choose photo',
          avatarDefault: 'Default',
          avatarHint: 'Optional. Stored locally on this PC.',
          apiTitle: 'Steam Web API key',
          apiCopy: 'A key improves Steam metadata retrieval. You can leave it empty and add it later.',
          apiWarning:
            '⚠ IMPORTANT: without an API key, the very first library load will be VERY SLOW — each game is fetched by scraping the Steam pages (several seconds per game). With a key it is near-instant and more accurate. The window stays usable while it loads, but adding one is strongly recommended.',
          apiLabel: 'Steam Web API key',
          apiLink: 'Get a Steam Web API key',
          apiNote: 'Use the official Steam page. The key is encrypted before saving.',
          foldersTitle: 'Add games on disk',
          foldersCopy:
            'Use Smart find to add known folders automatically. Or add a save/config folder for emulator data, and a library folder when one folder contains several installed games.',
          addSave: 'Save/config folder',
          smartFind: 'Smart find folders',
          addLibrary: 'Game library folder',
          smartFindHint: 'recommended',
          addSaveHint: 'one emulator/source',
          addLibraryHint: 'many installed games',
          saveList: 'Save / config folders',
          libraryList: 'Game libraries',
          emptyList: 'Nothing added this session.',
          settingsTitle: 'Recommended settings',
          settingsCopy: 'These are the main switches most users need first. Everything remains editable later in Settings.',
          source: 'Display Steam games',
          notifications: 'Notifications',
          playtime: 'Playtime tracking',
          autoFix: 'Auto-fix emulated games',
          hidden: 'Hidden achievements',
          merge: 'Merge duplicates',
          show: 'Show',
          hide: 'Hide',
          sourceHint: 'Also lists your legitimate Steam games (public profile required).',
          notificationsHint: 'Where unlocks appear: Windows toast, in-game overlay, or both.',
          playtimeHint: 'Automatically tracks playtime for detected games.',
          autoFixHint: 'Applies the emulator fix (GBE Fork, achievements, DLC) to new emulated games.',
          hiddenHint: 'Reveals hidden achievement names and descriptions before you unlock them.',
          mergeHint: 'Combines the same game found in several sources into a single tile.',
          none: 'None',
          installed: 'Installed',
          owned: 'Owned',
          toast: 'Toast',
          overlay: 'Overlay',
          both: 'Both',
          enabled: 'Enabled',
          disabled: 'Disabled',
          back: 'Back',
          next: 'Next',
          finish: 'Finish',
          skip: 'Skip',
          saving: 'Saving...',
          saved: 'Setup saved.',
          languageRequired: 'Choose a language to continue.',
          invalidFolder: 'That folder does not look like a supported achievement folder.',
          smartRunning: 'Searching...',
          smartDone: 'Search complete.',
          saveError: 'Could not save setup.',
        };
  }

  function boolValue(v) {
    return v === 'true';
  }

  function normalizeDir(dir) {
    return path.normalize(String(dir || '')).toLowerCase();
  }

  function setStatus(message, kind) {
    $('#onboarding-status').removeClass('success error running').addClass(kind || '').text(message || '');
  }

  function applyText() {
    const t = text();
    $('#onboarding-settings-label').text(t.settingsLabel);
    $('#btn-onboarding-open span').text(t.settingsButton);
    $('#onboarding-settings-help').text(t.settingsHelp);
    $('#onboarding-eyebrow').text(t.eyebrow);
    $('#onboarding-close').attr('title', t.close);
    $('.onboarding-steps button').each(function (index) {
      $(this).find('span').text(t.steps[index]);
    });
    $('#onboard-language-title').text(t.languageTitle);
    $('#onboard-language-copy').text(t.languageCopy);
    $('#onboard-language-label').text(t.language);
    $('#onboard-language-hint').text(t.languageHint);
    $('#onboard-intro-title').text(t.introTitle);
    $('#onboard-intro-copy').text(t.introCopy);
    $('#onboard-card-scan-title').text(t.scanTitle);
    $('#onboard-card-scan-copy').text(t.scanCopy);
    $('#onboard-card-watch-title').text(t.watchTitle);
    $('#onboard-card-watch-copy').text(t.watchCopy);
    $('#onboard-card-fix-title').text(t.fixTitle);
    $('#onboard-card-fix-copy').text(t.fixCopy);
    $('#onboard-profile-title').text(t.profileTitle);
    $('#onboard-profile-copy').text(t.profileCopy);
    $('#onboard-username-label').text(t.username);
    $('#onboard-main-steam-label').text(t.mainSteam);
    $('#onboard-avatar-pick span').text(t.avatarPick);
    $('#onboard-avatar-clear span').text(t.avatarDefault);
    $('#onboard-avatar-hint').text(t.avatarHint);
    $('#onboard-api-title').text(t.apiTitle);
    $('#onboard-api-copy').text(t.apiCopy);
    $('#onboard-api-warning-text').text(t.apiWarning);
    $('#onboard-api-label').text(t.apiLabel);
    $('#onboard-api-link span').text(t.apiLink);
    $('#onboard-api-note').text(t.apiNote);
    $('#onboard-folders-title').text(t.foldersTitle);
    $('#onboard-folders-copy').text(t.foldersCopy);
    $('#onboard-add-save-dir span').text(t.addSave);
    $('#onboard-smart-find span').text(t.smartFind);
    $('#onboard-add-library-dir span').text(t.addLibrary);
    $('#onboard-smart-find-hint').text(t.smartFindHint);
    $('#onboard-add-save-dir-hint').text(t.addSaveHint);
    $('#onboard-add-library-dir-hint').text(t.addLibraryHint);
    $('#onboard-save-list-title').text(t.saveList);
    $('#onboard-library-list-title').text(t.libraryList);
    $('#onboard-settings-title').text(t.settingsTitle);
    $('#onboard-settings-copy').text(t.settingsCopy);
    $('#onboard-source-label').text(t.source);
    $('#onboard-notification-mode-label').text(t.notifications);
    $('#onboard-playtime-label').text(t.playtime);
    $('#onboard-auto-fix-label').text(t.autoFix);
    $('#onboard-hidden-label').text(t.hidden);
    $('#onboard-merge-label').text(t.merge);
    $('#onboard-source-hint').text(t.sourceHint);
    $('#onboard-notification-mode-hint').text(t.notificationsHint);
    $('#onboard-playtime-hint').text(t.playtimeHint);
    $('#onboard-auto-fix-hint').text(t.autoFixHint);
    $('#onboard-hidden-hint').text(t.hiddenHint);
    $('#onboard-merge-hint').text(t.mergeHint);
    $("#onboard-legit-steam option[value='0']").text(t.none);
    $("#onboard-legit-steam option[value='1']").text(t.installed);
    $("#onboard-legit-steam option[value='2']").text(t.owned);
    $("#onboard-notification-mode option[value='toast']").text(t.toast);
    $("#onboard-notification-mode option[value='overlay']").text(t.overlay);
    $("#onboard-notification-mode option[value='both']").text(t.both);
    $("#onboard-playtime option[value='true'], #onboard-auto-fix option[value='true'], #onboard-merge option[value='true']").text(t.enabled);
    $("#onboard-playtime option[value='false'], #onboard-auto-fix option[value='false'], #onboard-merge option[value='false']").text(t.disabled);
    $("#onboard-hidden option[value='true']").text(t.show);
    $("#onboard-hidden option[value='false']").text(t.hide);
    $('#onboarding-prev span').text(t.back);
    $('#onboarding-skip').text(t.skip);
    updateStepButtons();
    renderDirLists();
  }

  function populateLanguageSelect(selected) {
    const current = selected || app.config.achievement?.lang || 'english';
    const t = text();
    const selector = $('#onboard-language');
    selector.empty();
    if (isFirstRunSession && !languageChosenThisSession) {
      selector.append($('<option>').attr('value', '').text(t.languagePlaceholder));
    }
    for (const language of uiLanguages.all()) {
      selector.append(
        $('<option>')
          .attr('value', language.api)
          .attr('title', language.displayName)
          .text(language.native || language.displayName)
      );
    }
    if (isFirstRunSession && !languageChosenThisSession) {
      selector.val('');
      return;
    }
    selector.val(uiLanguages.has(current) ? current : 'english');
  }

  function populateMainSteamSelect(selected) {
    const t = text();
    const selector = $('#onboard-main-steam');
    selector.empty().append($('<option>').attr('value', '0').text(t.none));
    try {
      const list = ipcRenderer.sendSync('get-steam-user-list') || [];
      for (const user of list) selector.append($('<option>').attr('value', user.user).text(user.name));
    } catch (err) {
      debug.log(err);
    }
    selector.val(selected || '0');
  }

  async function refreshAvatarPreview() {
    const preview = $('#onboard-avatar-preview');
    try {
      const avatar = await onboardingAvatar.getAvatar();
      preview.css('background-image', `url("${avatar}")`);
    } catch {
      preview.css('background-image', 'url("../resources/img/avatar.png")');
    }
  }

  function populateValues() {
    populateLanguageSelect(app.config.achievement?.lang || 'english');
    $('#onboard-username').val(app.config.general?.username || os.userInfo().username || 'User');
    $('#onboard-api-key').val(app.config.steam?.apiKey || '');
    populateMainSteamSelect(app.config.steam?.main || '0');
    $('#onboard-legit-steam').val(String(app.config.achievement_source?.legitSteam ?? 0));
    $('#onboard-notification-mode').val(app.config.notification_transport?.mode || 'toast');
    $('#onboard-playtime').val(String(app.config.notification?.playtime ?? false));
    $('#onboard-auto-fix').val(String(app.config.emulator?.autoApplyNewGames ?? false));
    $('#onboard-hidden').val(String(app.config.achievement?.showHidden ?? false));
    $('#onboard-merge').val(String(app.config.achievement?.mergeDuplicate ?? true));
    refreshAvatarPreview();
  }

  function renderDirLists() {
    const t = text();
    const render = (selector, rows) => {
      const list = $(selector);
      list.empty();
      if (!rows.length) {
        list.append($('<li>').addClass('empty').text(t.emptyList));
        return;
      }
      rows.forEach((dir, index) => {
        const item = $('<li>');
        item.append($('<span>').text(dir.path || dir));
        item.append(
          $('<button>')
            .attr('type', 'button')
            .attr('title', t.close)
            .html('<i class="fas fa-times"></i>')
            .on('click', () => {
              rows.splice(index, 1);
              renderDirLists();
            })
        );
        list.append(item);
      });
    };
    render('#onboard-save-dir-list', addedSaveDirs);
    render('#onboard-library-dir-list', addedLibraryDirs);
  }

  function addSaveDir(dir) {
    const normalized = normalizeDir(dir);
    if (!normalized || addedSaveDirs.some((item) => normalizeDir(item.path) === normalized)) return;
    addedSaveDirs.push({ path: dir, notify: true });
    renderDirLists();
  }

  function addLibraryDir(dir) {
    const normalized = normalizeDir(dir);
    if (!normalized || addedLibraryDirs.some((item) => normalizeDir(item) === normalized)) return;
    addedLibraryDirs.push(dir);
    renderDirLists();
  }

  async function pickSaveDir() {
    try {
      const dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'showHiddenFiles'] });
      if (!dialog.filePaths || dialog.filePaths.length === 0) return;
      if (await userDir.check(dialog.filePaths[0])) addSaveDir(dialog.filePaths[0]);
      else {
        remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
          type: 'warning',
          title: 'Achievement Watcher',
          message: text().invalidFolder,
        });
      }
    } catch (err) {
      debug.log(err);
    }
  }

  async function smartFindDirs() {
    const button = $('#onboard-smart-find');
    button.css('pointer-events', 'none');
    setStatus(text().smartRunning, 'running');
    try {
      for (const dir of await userDir.find()) {
        try {
          if (await userDir.check(dir)) addSaveDir(dir);
        } catch (err) {
          debug.log(err);
        }
      }
      if (libraryDirs.find) {
        for (const dir of await libraryDirs.find()) {
          addLibraryDir(dir);
        }
      }
      setStatus(text().smartDone, 'success');
    } catch (err) {
      setStatus(`${err}`, 'error');
      debug.log(err);
    } finally {
      button.css('pointer-events', 'initial');
    }
  }

  async function pickLibraryDir() {
    try {
      const dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { properties: ['openDirectory', 'showHiddenFiles'] });
      if (!dialog.filePaths || dialog.filePaths.length === 0) return;
      addLibraryDir(dialog.filePaths[0]);
    } catch (err) {
      debug.log(err);
    }
  }

  function showStep(nextStep) {
    if (isFirstRunSession && step === 0 && nextStep > 0 && !uiLanguages.has($('#onboard-language').val())) {
      setStatus(text().languageRequired, 'error');
      return;
    }
    step = Math.max(0, Math.min(STEP_COUNT - 1, nextStep));
    setStatus('', '');
    $('.onboarding-step').removeClass('active');
    $(`.onboarding-step[data-step='${step}']`).addClass('active');
    $('.onboarding-steps button').removeClass('active');
    $(`.onboarding-steps button[data-step='${step}']`).addClass('active');
    updateStepButtons();
    maybeAutoDetectFolders();
  }

  // First time the folders step is reached during a first-run session, kick off the smart-find scan so
  // detected candidate folders are presented for review (the auto-config gate). Runs at most once and
  // never on a manual reopen from Settings (so it doesn't re-scan every time you open the guide).
  function maybeAutoDetectFolders() {
    if (!isFirstRunSession || autoDetectedThisSession) return;
    if ($(`.onboarding-step[data-step='${step}']`).find('#onboard-smart-find').length === 0) return;
    autoDetectedThisSession = true;
    smartFindDirs();
  }

  function updateStepButtons() {
    const t = text();
    $('#onboarding-prev').prop('disabled', step === 0);
    $('#onboarding-next span').text(step === STEP_COUNT - 1 ? t.finish : t.next);
    $('#onboarding-next i').toggleClass('fa-check', step === STEP_COUNT - 1).toggleClass('fa-chevron-right', step !== STEP_COUNT - 1);
    $('#onboarding-skip, #onboarding-close').toggle(!isFirstRunSession);
  }

  function mergeSaveDirs(existing, additions) {
    const seen = new Set();
    const result = [];
    for (const entry of existing || []) {
      if (!entry || !entry.path) continue;
      const key = normalizeDir(entry.path);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    for (const entry of additions) {
      const key = normalizeDir(entry.path);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  }

  function mergeLibraryDirs(existing, additions) {
    const seen = new Set();
    const result = [];
    for (const dir of existing || []) {
      const key = normalizeDir(dir);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(dir);
    }
    for (const dir of additions) {
      const key = normalizeDir(dir);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(dir);
    }
    return result;
  }

  async function persist(markComplete = true) {
    const t = text();
    setStatus(t.saving, 'running');
    try {
      if (!app.config.general) app.config.general = {};
      if (!app.config.steam) app.config.steam = {};
      if (!app.config.achievement_source) app.config.achievement_source = {};
      if (!app.config.notification) app.config.notification = {};
      if (!app.config.notification_transport) app.config.notification_transport = {};
      if (!app.config.emulator) app.config.emulator = {};
      if (!app.config.achievement) app.config.achievement = {};

      const language = $('#onboard-language').val();
      if (!uiLanguages.has(language)) {
        setStatus(t.languageRequired, 'error');
        return false;
      }
      app.config.achievement.lang = language;
      app.config.general.username = $('#onboard-username').val().trim() || app.config.general.username || os.userInfo().username || 'User';
      app.config.general.onboardingCompleted = markComplete;
      app.config.steam.apiKey = $('#onboard-api-key').val().trim();
      app.config.steam.main = $('#onboard-main-steam').val() || '0';
      app.config.achievement_source.legitSteam = parseInt($('#onboard-legit-steam').val(), 10) || 0;
      app.config.notification_transport.mode = $('#onboard-notification-mode').val() || 'toast';
      app.config.notification.playtime = boolValue($('#onboard-playtime').val());
      app.config.emulator.autoApplyNewGames = boolValue($('#onboard-auto-fix').val());
      app.config.achievement.showHidden = boolValue($('#onboard-hidden').val());
      app.config.achievement.mergeDuplicate = boolValue($('#onboard-merge').val());

      settings.setUserDataPath(ipcRenderer.sendSync('get-user-data-path-sync'));
      const [currentSaveDirs, currentLibraryDirs] = await Promise.all([userDir.get(), libraryDirs.get()]);
      await Promise.all([
        userDir.save(mergeSaveDirs(currentSaveDirs, addedSaveDirs)),
        libraryDirs.save(mergeLibraryDirs(currentLibraryDirs, addedLibraryDirs)),
        settings.save(app.config),
      ]);
      $('#user-info .info .name').text(app.config.general.username);
      setStatus(t.saved, 'success');
      return true;
    } catch (err) {
      setStatus(t.saveError, 'error');
      debug.log(err);
      return false;
    }
  }

  async function finish() {
    if (!(await persist(true))) return;
    hide();
    resetUI();
  }

  async function skip() {
    if (isFirstRunSession) {
      setStatus(text().languageRequired, 'error');
      return;
    }
    if (!(await persist(true))) return;
    hide();
  }

  function hide() {
    $('#onboarding').attr('aria-hidden', 'true').hide();
    setStatus('', '');
  }

  function show(force) {
    if (!force && app.config.general?.onboardingCompleted === true) return;
    isFirstRunSession = !force; // auto-detect candidates only on the genuine first-run guide
    autoDetectedThisSession = false;
    languageChosenThisSession = false;
    addedSaveDirs = [];
    addedLibraryDirs = [];
    applyText();
    populateValues();
    renderDirLists();
    showStep(0);
    $('#settings .box').hide();
    $('#settings').hide();
    if ($('title-bar')[0]) $('title-bar')[0].inSettings = false;
    $('#onboarding').attr('aria-hidden', 'false').show();
  }

  window.openAchievementWatcherOnboarding = show;
  window.addEventListener('aw-open-onboarding', (event) => {
    window.__awPendingOnboardingOpen = false;
    show(event.detail && event.detail.force !== false);
  });

  $(function () {
    applyText();
    if (window.__awPendingOnboardingOpen) {
      window.__awPendingOnboardingOpen = false;
      setTimeout(() => show(true), 0);
    }
    $('#onboarding-prev').on('click', () => showStep(step - 1));
    $('#onboarding-next').on('click', () => {
      if (step === STEP_COUNT - 1) finish();
      else showStep(step + 1);
    });
    $('#onboarding-skip, #onboarding-close, #onboarding .overlay').on('click', skip);
    $('.onboarding-steps button').on('click', function () {
      showStep(parseInt($(this).data('step'), 10));
    });
    $(document).on('click', '#btn-onboarding-open', (event) => {
      event.preventDefault();
      event.stopPropagation();
      show(true);
    });
    $('#onboard-add-save-dir').on('click', pickSaveDir);
    $('#onboard-smart-find').on('click', smartFindDirs);
    $('#onboard-add-library-dir').on('click', pickLibraryDir);
    $('#onboard-avatar-pick').on('click', async () => {
      try {
        const dialog = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
          properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
          filters: [{ name: 'Image', extensions: ['jpeg', 'jpg', 'png', 'gif', 'bmp'] }],
        });
        if (!dialog.filePaths || dialog.filePaths.length === 0) return;
        const avatar = await onboardingAvatar.imageFileToBase64(dialog.filePaths[0]);
        localStorage.setItem('avatar', avatar);
        await refreshAvatarPreview();
        const avatarEl = document.querySelector('user-avatar');
        if (avatarEl && typeof avatarEl.update === 'function') avatarEl.update();
      } catch (err) {
        debug.log(err);
      }
    });
    $('#onboard-avatar-clear').on('click', async () => {
      localStorage.removeItem('avatar');
      await refreshAvatarPreview();
      const avatarEl = document.querySelector('user-avatar');
      if (avatarEl && typeof avatarEl.update === 'function') avatarEl.update();
    });
    $('#onboard-api-link').attr('href', STEAM_API_KEY_URL);
    $('#onboard-language').on('change', function () {
      if (!app.config.achievement) app.config.achievement = {};
      app.config.achievement.lang = $(this).val() || 'english';
      languageChosenThisSession = uiLanguages.has(app.config.achievement.lang);
      applyText();
      populateLanguageSelect(app.config.achievement.lang);
    });

    setTimeout(() => show(false), 600);
  });
})(window.jQuery, window, document);
