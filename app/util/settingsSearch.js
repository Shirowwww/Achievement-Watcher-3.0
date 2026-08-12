'use strict';

/*
  Pure matching rules behind the Settings search box (driven by app/ui/settings.js).

  Kept DOM-free on purpose. The settings panel is translated positionally — locale/loader.js binds
  most labels with `li:nth-child(n)` — so the filter must hide rows rather than move or remove them,
  and the selectors it walks are as much a part of the contract as the matching itself. Both live
  here so test/settingsSearch.test.js can exercise them against the real app.html without a browser.
*/

/*
  Rows a search can hide. Only the OUTERMOST match inside a tab counts as a row: settings rows are
  never nested in one another, so anything matching this inside another match is part of that row —
  a folder entry's edit/unlink buttons are `<li>`s inside the path row, and a guide panel's bullets
  are `<li>`s inside the help panel. Filtering them independently would strip a visible row of its
  controls and leave containers standing empty.
*/
const ROW_SELECTOR = 'li, .emulator-login, .emulator-hero, .help-panel';

// Blocks that should disappear once every row inside them is filtered out, so a filtered tab shows
// matching sections instead of a column of empty headers.
const BLOCK_SELECTOR = 'ul, .arrow-list, .emulator-group, .settings-card, #options-steam-api, #epic-connect';

function normalize(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Split a query into words. Matching is per-word and order-independent, so "hide zero" and
// "zero hide" both find "Hide 0% games" — that is how a half-remembered setting is actually typed.
function parseTerms(query) {
  return normalize(query).split(' ').filter(Boolean);
}

// A row matches when every term appears somewhere in its searchable text.
function matches(haystack, terms) {
  const text = normalize(haystack);
  return terms.every((term) => text.includes(term));
}

/*
  Everything a row can reasonably be found by: its visible text (label, help, option values) plus
  the option ids it contains. The ids matter because they are the only stable, language-independent
  handle on a setting — searching "hideZero" works in a Japanese UI too.
*/
function buildHaystack({ text = '', ids = [], placeholders = [] } = {}) {
  return normalize([text, ...ids.map((id) => String(id).replace(/^option_/, '')), ...placeholders].join(' '));
}

// Searchable text of one row, read through jQuery.
function haystackFor($, row) {
  const el = $(row);
  return buildHaystack({
    text: el.text() || '',
    ids: el
      .find('[id]')
      .map(function () {
        return this.id;
      })
      .get(),
    placeholders: el
      .find('input[placeholder]')
      .map(function () {
        return $(this).attr('placeholder');
      })
      .get(),
  });
}

/*
  Hide every non-matching settings row and collapse empty blocks. Rows are hidden with a class, never
  moved — positional i18n breaks if the DOM order changes. Returns { total, perView }.
*/
// The rows of one tab: matches of ROW_SELECTOR with no other match between them and the tab.
function rowsIn($, section) {
  return section.find(ROW_SELECTOR).filter(function () {
    return $(this).parentsUntil(section).filter(ROW_SELECTOR).length === 0;
  });
}

function filterSections($, query, scope = '#settings') {
  const terms = parseTerms(query);
  const perView = {};
  let total = 0;

  $(`${scope} .box section.content[data-view]`).each(function () {
    const section = $(this);
    const rows = rowsIn($, section);
    let hits = 0;

    rows.each(function () {
      const row = $(this);
      if (terms.length === 0 || matches(haystackFor($, this), terms)) {
        row.removeClass('search-hidden');
        hits++;
      } else {
        row.addClass('search-hidden');
      }
    });

    section.find(BLOCK_SELECTOR).each(function () {
      const block = $(this);
      // Only the rows this block actually owns decide whether it still has anything to show.
      const owned = rows.filter(function () {
        return this !== block[0] && block[0].contains(this);
      });
      block.toggleClass('search-hidden', terms.length > 0 && owned.length > 0 && owned.not('.search-hidden').length === 0);
    });

    perView[section.attr('data-view')] = hits;
    total += hits;
  });

  return { total, perView };
}

module.exports = { ROW_SELECTOR, BLOCK_SELECTOR, normalize, parseTerms, matches, buildHaystack, haystackFor, rowsIn, filterSections };
