'use strict';

// Render localized Help content with live settings and controller bindings.

const HELP_LISTS = {
  'help-quick-list': 'quick',
  'help-sources-list': 'sources',
  'help-steam-list': 'steam',
  'help-emulator-list': 'emulators',
  'help-controller-list': 'controller',
  'help-overlay-list': 'overlay',
  'help-shortcuts-list': 'shortcuts',
  'help-themes-list': 'themes',
  'help-config-list': 'config',
  'help-tips-list': 'tips',
  'help-troubleshoot-list': 'troubleshoot',
};

const DEFAULT_TOGGLE = 'BACK+START+LEFT_SHOULDER';
const DEFAULT_UI_MODE = 'LEFT_SHOULDER+X';
const DEFAULT_MOVE = 'LEFT_SHOULDER+RIGHT_SHOULDER';
const DEFAULT_HOTKEY = 'Ctrl+Shift+K';

const TOKEN = (name) => `\u0001${name}\u0001`;
const TOKEN_RE = /\u0001([a-z0-9]+)\u0001/g;

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSearchTerms(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ') : [];
}

function matchesHelpQuery(text, query) {
  const haystack = normalizeSearchText(text);
  const terms = Array.isArray(query) ? query : parseSearchTerms(query);
  return terms.every((term) => haystack.includes(term));
}

function readBinding($, first, second, third, fallback) {
  const values = [first, second, third]
    .map((selector) => {
      const el = $(selector);
      return el.length ? String(el.val() || '').trim().toUpperCase() : '';
    })
    .filter(Boolean);
  return values.length ? values.join('+') : fallback;
}

function selectValue($, selector, fallback) {
  const el = $(selector);
  if (!el.length) return fallback;
  const value = String(el.val() || '').trim();
  return value === '' ? fallback : value;
}

function selectedText($, selector) {
  const el = $(selector);
  if (!el.length) return '';
  const selected = el.find('option:selected');
  return selected.length ? selected.text().trim() : '';
}

function gamepads() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      return navigator.getGamepads() || [];
    }
  } catch {}
  return [];
}

function dynamicValues($) {
  const appConfig = (window.app && window.app.config) || {};
  const controller = appConfig.controller || {};
  const labels = window.ControllerLabels || null;
  const locale = String((appConfig.achievement && appConfig.achievement.lang) || 'english');
  const pads = gamepads();
  const layout = selectValue($, '#option_controllerLayout', controller.layout || 'auto');
  const hotkeyEl = $('#hotkey');
  let hotkey = hotkeyEl.length ? hotkeyEl.text().trim() : '';
  if (!hotkey || hotkey === '...') hotkey = String((appConfig.overlay && appConfig.overlay.hotkey) || DEFAULT_HOTKEY);

  const toggleBinding =
    readBinding($, '#option_controllerToggle1', '#option_controllerToggle2', '#option_controllerToggle3', controller.toggleBinding || DEFAULT_TOGGLE) ||
    DEFAULT_TOGGLE;
  const uiBinding =
    readBinding($, '#option_controllerUi1', '#option_controllerUi2', '#option_controllerUi3', controller.uiModeBinding || DEFAULT_UI_MODE) ||
    DEFAULT_UI_MODE;
  const moveBinding =
    readBinding($, '#option_controllerMove1', '#option_controllerMove2', '#option_controllerMove3', controller.controlModeBinding || DEFAULT_MOVE) ||
    DEFAULT_MOVE;

  const button = (name) => (labels ? labels.buttonLabel(layout, name, pads, locale) : name);
  const binding = (value) => (labels ? labels.bindingLabel(layout, value, pads, locale) : value);

  return {
    hotkey,
    toggle: binding(toggleBinding),
    ui: binding(uiBinding),
    move: binding(moveBinding),
    a: button('A'),
    b: button('B'),
    x: button('X'),
    y: button('Y'),
    controllerEnabled: selectValue($, '#option_controllerEnabled', String(controller.enabled === true)) === 'true',
    controllerLayout: selectedText($, '#option_controllerLayout') || String(layout),
  };
}

// Turn the shipped Xbox-style wording into tokens that the DOM renderer can style.
function localizeHelpText(text, values, kind) {
  let out = String(text || '');
  const comboReplacements = [
    ['Back + Start + LB', 'toggle'],
    ['Select + Start + LB', 'toggle'],
    ['Back + Start', 'toggle'],
    ['Select + Start', 'toggle'],
    ['LB + X', 'ui'],
    ['LB + RB', 'move'],
  ];
  for (const [needle, key] of comboReplacements) {
    out = out.split(needle).join(TOKEN(key));
  }
  if (kind === 'controller' || kind === 'overlay') {
    out = out.replace(/\b(A|B|X|Y)\b/g, (match) => TOKEN(match.toLowerCase()));
  }
  // Drop "(default)" once the real hotkey is shown; the current value is what matters.
  out = out.replace(/Ctrl\+Shift\+K\s*\((?:default|défaut)\)\s*:?/g, `${TOKEN('hotkey')}:`);
  // Some translations put the equivalent of "by default" before the shortcut.
  out = out.replace(/\([^)]*Ctrl\+Shift\+K[^)]*\)/g, `(${TOKEN('hotkey')})`);
  out = out.replace(/Ctrl\+Shift\+K/g, TOKEN('hotkey'));
  return out;
}

// Pure string form of the same substitution, used by tests and debugging.
function formatHelpText(text, values, kind) {
  return localizeHelpText(text, values, kind).replace(TOKEN_RE, (match, key) =>
    values[key] != null ? String(values[key]) : match
  );
}

function appendRichText(parent, text, values) {
  const parts = String(text || '').split(/(\u0001[^\u0001]+\u0001)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('\u0001') && part.endsWith('\u0001')) {
      const key = part.slice(1, -1);
      const value = values[key];
      if (value != null && value !== '') {
        const kbd = document.createElement('kbd');
        kbd.className = 'help-key';
        kbd.textContent = String(value);
        parent.appendChild(kbd);
        continue;
      }
    }
    parent.appendChild(document.createTextNode(part));
  }
}

function renderList($, id, items, kind, values) {
  const list = $('#' + id);
  if (!list.length) return;
  list.empty();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const li = document.createElement('li');
    appendRichText(li, localizeHelpText(item, values, kind), values);
    list[0].appendChild(li);
  });
}

function appendChip(container, iconClass, label, value, state) {
  if (!label && !value) return;
  const chip = $('<span class="help-chip"></span>');
  if (state) chip.addClass(state);
  if (iconClass) chip.append($('<i>').addClass(iconClass));
  if (label) chip.append($('<b>').text(label));
  if (value != null && value !== '') chip.append($('<span>').text(value));
  chip.appendTo(container);
}

function countSources($) {
  const rows = $('#options-source li').toArray();
  let enabled = 0;
  for (const row of rows) {
    const select = row.querySelector('select');
    if (!select) continue;
    const on = select.value === 'true' || (select.id === 'option_legitSteam' && select.value !== '0');
    if (on) enabled += 1;
  }
  return { enabled, total: rows.length };
}

function renderSetup($, values) {
  const container = $('#help-setup');
  if (!container.length) return;
  container.empty();
  const settingsLocale = window.appLocale && window.appLocale.settings;
  if (!settingsLocale) return;

  const common = settingsLocale.common || {};
  const general = settingsLocale.general || {};
  const overlay = settingsLocale.overlay || {};
  const source = settingsLocale.source || {};
  const controller = general.controller || {};
  const savedTheme = window.app && window.app.config && window.app.config.general && window.app.config.general.theme;
  const themeValue = selectedText($, '#option_theme') || String(savedTheme || '');

  appendChip(container, 'fas fa-palette', general.theme && general.theme.name, themeValue, 'is-on');

  const notifMode = selectedText($, '#option_notifMode');
  const notifEnabled = selectValue($, '#option_notify', 'true') !== 'false';
  appendChip(container, 'fas fa-bell', settingsLocale.sideMenu && settingsLocale.sideMenu.notification, notifMode, notifEnabled ? 'is-on' : 'is-off');

  const controllerEnabled = values.controllerEnabled;
  const controllerValue = [values.controllerLayout, controllerEnabled ? common.enable : common.disable].filter(Boolean).join(' · ');
  appendChip(container, 'fas fa-gamepad', controller.title, controllerValue, controllerEnabled ? 'is-on' : 'is-off');

  appendChip(container, 'fas fa-keyboard', overlay.hotkey && overlay.hotkey.name, values.hotkey, 'is-on');

  const sourceCount = countSources($);
  if (sourceCount.total > 0) {
    appendChip(container, 'fas fa-database', source.title, `${sourceCount.enabled}/${sourceCount.total}`, 'is-on');
  }
}

function renderControllerStatus($, values) {
  const list = $('#help-controller-list');
  if (!list.length) return;
  const settingsLocale = window.appLocale && window.appLocale.settings;
  const layoutLabel = settingsLocale && settingsLocale.general && settingsLocale.general.controller && settingsLocale.general.controller.layout.name;
  const row = document.createElement('li');
  row.className = 'help-chip-row';
  list[0].prepend(row);
  appendChip($(row), 'fas fa-arrows-alt-h', layoutLabel || '', values.controllerLayout, values.controllerEnabled ? 'is-on' : 'is-off');
}

function renderSourceChips($) {
  const list = $('#help-sources-list');
  if (!list.length) return;
  const rows = $('#options-source li').toArray();
  if (!rows.length) return;
  const row = document.createElement('li');
  row.className = 'help-chip-row';
  list[0].prepend(row);
  for (const sourceRow of rows) {
    const select = sourceRow.querySelector('select');
    if (!select) continue;
    const labelEl = sourceRow.querySelector('.left span');
    const label = labelEl && labelEl.textContent ? labelEl.textContent.trim() : select.id.replace(/^option_/, '');
    if (!label) continue;
    const on = select.value === 'true' || (select.id === 'option_legitSteam' && select.value !== '0');
    appendChip($(row), '', '', label, on ? 'is-on' : 'is-off');
  }
}

function renderPanelCounts($, help) {
  for (const [id, key] of Object.entries(HELP_LISTS)) {
    const summary = $('#' + id).closest('.help-panel').find('summary').first();
    if (!summary.length) continue;
    let count = summary.find('.help-topic-count');
    if (!count.length) count = $('<span class="help-topic-count" aria-hidden="true"></span>').appendTo(summary);
    count.text(Array.isArray(help[key]) ? help[key].length : 0);
  }
}

function applyHelpSearch($, rawQuery) {
  const card = $('#settings .content[data-view="help"] .help-card');
  const panels = card.find('.help-panel').toArray();
  const terms = parseSearchTerms(rawQuery);
  const clearButton = $('#help-search-clear');
  const noResults = $('#help-no-results');
  const matchCount = $('#help-match-count');

  clearButton.prop('hidden', terms.length === 0);
  if (terms.length === 0) {
    for (const panel of panels) {
      panel.hidden = false;
      if (panel.dataset.helpOpenBeforeSearch != null) {
        panel.open = panel.dataset.helpOpenBeforeSearch === 'true';
        delete panel.dataset.helpOpenBeforeSearch;
      }
    }
    card.removeClass('is-searching');
    noResults.prop('hidden', true);
    matchCount.text('');
    return { matches: panels.length, total: panels.length };
  }

  const startingSearch = !card.hasClass('is-searching');
  card.addClass('is-searching');
  const matchedPanels = [];
  for (const panel of panels) {
    if (startingSearch) panel.dataset.helpOpenBeforeSearch = String(panel.open);
    const matched = matchesHelpQuery(panel.textContent, terms);
    panel.hidden = !matched;
    if (matched) matchedPanels.push(panel);
  }

  const matches = matchedPanels.length;
  for (const panel of matchedPanels) panel.open = matches === 1;
  noResults.prop('hidden', matches !== 0);
  matchCount.text(`${matches}/${panels.length}`);
  card.closest('.content').scrollTop(0);
  return { matches, total: panels.length };
}

function bindSearch($) {
  const input = $('#help-search-input');
  if (!input.length) return;

  input.off('.achievementHelp').on('input.achievementHelp', function () {
    applyHelpSearch($, $(this).val());
  });
  input.on('keydown.achievementHelp', function (event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    $(this).val('');
    applyHelpSearch($, '');
  });
  $('#help-search-clear').off('.achievementHelp').on('click.achievementHelp', function () {
    input.val('').focus();
    applyHelpSearch($, '');
  });
}

function render($) {
  if (!$ || !window.appLocale || !window.appLocale.settings || !window.appLocale.settings.help) return;
  const help = window.appLocale.settings.help;
  const values = dynamicValues($);
  for (const [id, key] of Object.entries(HELP_LISTS)) {
    renderList($, id, help[key], key, values);
  }
  renderSetup($, values);
  renderControllerStatus($, values);
  renderSourceChips($);
  renderPanelCounts($, help);
  bindSearch($);
  applyHelpSearch($, $('#help-search-input').val());
}

const helpApi = {
  render,
  formatHelpText,
  localizeHelpText,
  normalizeSearchText,
  parseSearchTerms,
  matchesHelpQuery,
  applyHelpSearch,
  HELP_LISTS,
  DEFAULT_TOGGLE,
  DEFAULT_UI_MODE,
  DEFAULT_MOVE,
  DEFAULT_HOTKEY,
};

if (typeof module !== 'undefined' && module.exports) module.exports = helpApi;
if (typeof window !== 'undefined') window.AchievementHelp = helpApi;
