'use strict';

// Single-select, three-state sort: first click selects the intuitive direction, second click
// reverses it, third click clears the sort. Both the criterion and its direction survive restarts.
//   time   = most recent achievement unlock
//   played = most recently played (watchdog last-played timestamp)
function activeSortMode() {
  let mode = localStorage.sortBy;
  if (!['none', 'alpha', 'percent', 'time', 'played'].includes(mode)) {
    // Migrate from the old per-criterion flags (prefer time > percent > alpha), else default alpha.
    if (localStorage.sortByTime === 'true') mode = 'time';
    else if (localStorage.sortByPercent === 'false' && localStorage.sortByAlpha === 'false') mode = 'alpha';
    else mode = 'alpha';
    localStorage.sortBy = mode;
  }
  return mode;
}

function defaultSortDirection(mode) {
  return mode === 'alpha' ? 'asc' : 'desc';
}

function activeSortDirection(mode) {
  const direction = localStorage.sortDirection;
  return direction === 'asc' || direction === 'desc' ? direction : defaultSortDirection(mode);
}

function oppositeDirection(direction) {
  return direction === 'asc' ? 'desc' : 'asc';
}

function modeForButton(button) {
  if (button.hasClass('alpha')) return 'alpha';
  if (button.hasClass('percentage')) return 'percent';
  if (button.hasClass('played')) return 'played';
  return 'time';
}

// i18n strings come from the active locale (set on window.sortLabelStrings by locale/loader.js); the
// French defaults below are the fallback if a locale loads without a `sort` block.
const SORT_LABEL_FALLBACK = {
  tooltip: { alpha: 'Nom : A → Z', percent: 'Progression', time: 'Date du succès', played: 'Dernière partie' },
  label: {
    alpha: { asc: 'Nom : A → Z', desc: 'Nom : Z → A' },
    percent: { asc: 'Progression : faible → élevée', desc: 'Progression : élevée → faible' },
    time: { asc: 'Succès : ancien → récent', desc: 'Succès : récent → ancien' },
    played: { asc: 'Partie : ancienne → récente', desc: 'Partie : récente → ancienne' },
    rarity: { asc: 'Rareté : plus rare → plus commun', desc: 'Rareté : plus commun → plus rare' },
  },
  action: { reverse: 'cliquer pour inverser', clear: 'cliquer pour enlever le tri' },
};

function sortLabels() {
  return window.sortLabelStrings || SORT_LABEL_FALLBACK;
}

function nextActionLabel(mode, direction) {
  const action = sortLabels().action || SORT_LABEL_FALLBACK.action;
  return direction === defaultSortDirection(mode) ? action.reverse : action.clear;
}

function sortTitle(mode, direction) {
  const labels = sortLabels().label || SORT_LABEL_FALLBACK.label;
  const label = (labels[mode] || {})[direction];
  return label + ' — ' + nextActionLabel(mode, direction);
}

function achievementSortTitle(mode, direction) {
  if (mode === 'percent') {
    const labels = sortLabels().label || SORT_LABEL_FALLBACK.label;
    const rarity = labels.rarity || SORT_LABEL_FALLBACK.label.rarity;
    const action = sortLabels().action || SORT_LABEL_FALLBACK.action;
    return rarity[direction] + ' — ' + (direction === 'asc' ? action.reverse : action.clear);
  }
  return sortTitle(mode, direction);
}

// The arrow indicator reflects *default vs reversed* order, not asc/desc — so the first click shows
// the same arrow (default order) on every criterion instead of ▲ for names and ▼ for the rest.
// `defaultDir` lets the achievement panel pass its own initial direction (percent starts ascending).
function paintSortButton(button, mode, direction, defaultDir = defaultSortDirection(mode)) {
  const state = direction === defaultDir ? 'default' : 'reversed';
  button
    .addClass('active direction-' + state)
    .removeClass('direction-' + (state === 'default' ? 'reversed' : 'default'))
    .attr('title', sortTitle(mode, direction))
    .attr('aria-label', sortTitle(mode, direction))
    .attr('aria-pressed', 'true');
}

function sortOptions() {
  let mode = activeSortMode();
  let direction = activeSortDirection(mode);
  $('#sort-box .sort').removeClass('active direction-default direction-reversed').attr('aria-pressed', 'false');
  if (mode !== 'none') paintSortButton($('#sort-box .sort.' + (mode === 'percent' ? 'percentage' : mode)), mode, direction);
  return { alpha: mode === 'alpha', percent: mode === 'percent', time: mode === 'time', played: mode === 'played', direction };
}

function sort(elem, option = {}) {
  let options = {
    alpha: option.alpha,
    percent: option.percent || false,
    time: option.time || false,
    played: option.played || false,
    direction: option.direction === 'asc' ? 'asc' : 'desc',
  };

  const factor = options.direction === 'asc' ? 1 : -1;

  let li = elem.children('li');

  li.detach().sort(function (a, b) {
    if (options.played) {
      let result = ($(a).find('.game-box').data('lastplayed') - $(b).find('.game-box').data('lastplayed')) * factor;
      if (result != 0) return result;
    }

    if (options.time) {
      let result = ($(a).find('.game-box').data('time') - $(b).find('.game-box').data('time')) * factor;
      if (result != 0) return result;
    }

    if (options.percent) {
      let result = ($(a).find('.progressBar').data('percent') - $(b).find('.progressBar').data('percent')) * factor;
      if (result != 0) return result;
    }

    if (options.alpha) {
      return $(a).find('.info .title').text().localeCompare($(b).find('.info .title').text(), undefined, { sensitivity: 'base' }) * factor;
    } else {
      return $(a).find('.game-box').data('appid') - $(b).find('.game-box').data('appid');
    }
  });

  elem.append(li);
}

function achievementStorageKey(root, part) {
  return 'sortAch_' + root.attr('id') + '_' + part;
}

function applyAchievementSort(root, mode, direction) {
  const elem = root.children('ul');
  const li = elem.children("li:not('#hidden-disclaimer')");
  const factor = direction === 'asc' ? 1 : -1;

  li.detach().sort(function (a, b) {
    if (mode === 'percent') {
      const aPercent = parseFloat($(a).find('.achievement .stats .community .data').text());
      const bPercent = parseFloat($(b).find('.achievement .stats .community .data').text());
      if (Number.isFinite(aPercent) !== Number.isFinite(bPercent)) return Number.isFinite(aPercent) ? -1 : 1;
      const result = (aPercent - bPercent) * factor;
      if (result !== 0) return result;
    } else if (mode === 'time') {
      const result = ($(a).find('.achievement .stats .time').data('time') - $(b).find('.achievement .stats .time').data('time')) * factor;
      if (result !== 0) return result;
    }
    return $(a).find('.achievement').data('index') - $(b).find('.achievement').data('index');
  });

  elem.prepend(li);
  root.find('.header .sort-ach .sort').removeClass('active direction-default direction-reversed').attr('aria-pressed', 'false');
  const button = root.find('.header .sort-ach .sort.' + (mode === 'percent' ? 'percentage' : mode));
  if (button.length) {
    paintSortButton(button, mode, direction, mode === 'percent' ? 'asc' : defaultSortDirection(mode));
    button.attr('title', achievementSortTitle(mode, direction)).attr('aria-label', achievementSortTitle(mode, direction));
  }
}

function restoreAchievementSort(root) {
  const modeKey = achievementStorageKey(root, 'mode');
  const directionKey = achievementStorageKey(root, 'direction');
  let mode = localStorage[modeKey];
  let direction = localStorage[directionKey];
  // Preserve the previous version's sole achievement preference on first run after the update.
  if (!mode && root.attr('id') === 'unlock' && localStorage.sortAchByTime === 'true') {
    mode = 'time';
    direction = 'desc';
    localStorage[modeKey] = mode;
    localStorage[directionKey] = direction;
  }
  if (['percent', 'time'].includes(mode) && ['asc', 'desc'].includes(direction)) applyAchievementSort(root, mode, direction);
}

window.restoreAchievementSorts = function () {
  $('.achievement-list').each(function () {
    restoreAchievementSort($(this));
  });
};

// "Show installed games only" filter. ON by default (hides phantom entries: orphaned emulator
// save folders and stale cache imports that have no live install). State persists in localStorage.
// Filtering is purely CSS-driven (a class on the list <ul>), so it applies instantly to already
// rendered tiles AND to tiles streamed in afterwards, with no rescan.
function installedOnlyEnabled() {
  return localStorage.showInstalledOnly === 'true' || typeof localStorage.showInstalledOnly === 'undefined';
}

function updateInstalledEmptyState() {
  const ul = $('#game-list ul');
  if (ul.children('li').length === 0) return; // nothing loaded yet — resetUI() owns the empty state
  const visible = ul.children('li').filter(function () {
    return $(this).css('display') !== 'none';
  }).length;
  $('#game-list .isEmpty').toggle(visible === 0);
}

function applyInstalledFilter() {
  const on = installedOnlyEnabled();
  $('#game-list ul').toggleClass('installed-only', on);
  $('#sort-box .installed-filter').toggleClass('active', on);
  updateInstalledEmptyState();
}
// Exposed so app.js can re-apply after it flips data-installed (exeList signal, post-reconcile).
window.applyInstalledFilter = applyInstalledFilter;

(function ($, window, document) {
  $(function () {
    applyInstalledFilter();

    $('#sort-box .installed-filter').click(function () {
      const button = $(this);
      const gamelist = $('#game-list ul');
      button.css('pointer-events', 'none');

      gamelist.fadeOut('fast', () => {
        localStorage.showInstalledOnly = installedOnlyEnabled() ? 'false' : 'true';
        applyInstalledFilter();
        gamelist.fadeIn('fast', () => button.css('pointer-events', 'initial'));
      });
    });

    $('#sort-box .sort').click(function () {
      let self = $(this);
      $('#sort-box .sort').css('pointer-events', 'none');

      let gamelist = $('#game-list ul');
      const clickedMode = modeForButton(self);
      const currentMode = activeSortMode();
      const currentDirection = activeSortDirection(currentMode);
      let mode = clickedMode;
      let direction = defaultSortDirection(clickedMode);
      if (clickedMode === currentMode) {
        if (currentDirection === defaultSortDirection(clickedMode)) direction = oppositeDirection(currentDirection);
        else mode = 'none';
      }
      localStorage.sortBy = mode;
      if (mode === 'none') localStorage.removeItem('sortDirection');
      else localStorage.sortDirection = direction;

      gamelist.fadeOut(() => {
        $('#sort-box .sort').removeClass('active direction-default direction-reversed').attr('aria-pressed', 'false');
        if (mode !== 'none') paintSortButton(self, mode, direction);

        sort(gamelist, {
          alpha: mode === 'alpha',
          percent: mode === 'percent',
          time: mode === 'time',
          played: mode === 'played',
          direction,
        });

        gamelist.fadeIn(() => {
          $('#sort-box .sort').css('pointer-events', 'initial');
        });
      });
    });

    $('.achievement-list > .header .sort-ach .sort').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      let root = self.closest('.achievement-list');
      const mode = modeForButton(self);
      const modeKey = achievementStorageKey(root, 'mode');
      const directionKey = achievementStorageKey(root, 'direction');
      const currentMode = localStorage[modeKey];
      const currentDirection = localStorage[directionKey];
      const initialDirection = mode === 'percent' ? 'asc' : defaultSortDirection(mode);
      if (currentMode === mode && currentDirection === oppositeDirection(initialDirection)) {
        localStorage.removeItem(modeKey);
        localStorage.removeItem(directionKey);
        localStorage.sortAchByTime = 'false';
        applyAchievementSort(root, null, 'asc');
      } else {
        const direction = currentMode === mode ? oppositeDirection(currentDirection) : initialDirection;
        localStorage[modeKey] = mode;
        localStorage[directionKey] = direction;
        localStorage.sortAchByTime = mode === 'time' ? 'true' : 'false'; // legacy preference migration
        applyAchievementSort(root, mode, direction);
      }
      self.css('pointer-events', 'initial');
    });
  });
})(window.jQuery, window, document);
