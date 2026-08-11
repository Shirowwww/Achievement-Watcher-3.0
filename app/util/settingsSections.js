'use strict';

/*
  Which blocks of the Settings panel are collapsible sections, and what identifies each one.

  Kept beside settingsSearch.js and for the same reason: the settings panel is translated
  positionally (locale/loader.js binds most labels with `li:nth-child(n)`), so collapsing must never
  move, wrap or remove anything — it only toggles a class on the section and hides its non-header
  children in CSS. The selectors below are therefore as much a part of the contract as the code, and
  test/settingsSections.test.js exercises them against the real app.html.
*/

/*
  A section is a card that carries one of the three card headers. `.emulator-hero` and the account
  cards' inner blocks are deliberately absent: a hero is a banner with no header to click, and
  anything nested inside another section belongs to that section (see sectionsIn).
*/
const SECTION_SELECTOR = '.arrow-list, .emulator-group, .settings-card, #options-steam-api, #epic-connect, .emulator-login';

/*
  The clickable header of a section, as a DIRECT child. Three shapes exist:
    .title                  — the ordinary card header
    .emulator-group-title   — emulator groups
    .emulator-login-heading — account/customizer cards, whose .title is nested one level deeper
*/
const HEADER_SELECTOR = '.title, .emulator-group-title, .emulator-login-heading';

// Sections that start collapsed on a fresh profile. The preset builder is a large, rarely-used
// authoring surface sitting between the notification options and the souvenir settings, so it stays
// out of the way until asked for.
const DEFAULT_COLLAPSED = ['options-notify-customiser'];

// The header element of a section, or null when it has none (which makes it not a section).
function headerFor($, section) {
  const header = $(section).children(HEADER_SELECTOR).first();
  return header.length ? header : null;
}

/*
  The collapsible sections of one tab: matches of SECTION_SELECTOR that have a header and are not
  themselves inside another match. `.emulator-list` also carries `.arrow-list`, so an emulator
  group's inner list would otherwise be reported as a second section inside its own group.
*/
function sectionsIn($, scope) {
  const root = $(scope);
  return root.find(SECTION_SELECTOR).filter(function () {
    if (!headerFor($, this)) return false;
    return $(this).parentsUntil(root).filter(SECTION_SELECTOR).length === 0;
  });
}

/*
  A stable, language-independent key for remembering one section's open/closed state. Ids come
  first because they survive re-ordering; the positional fallback only applies to a handful of
  unnamed cards, where the worst case is that a section forgets its state after a layout change.
*/
function sectionKey($, section, view, index) {
  const el = $(section);
  const own = el.attr('id');
  if (own) return own;

  const list = el.find('ul[id]').first().attr('id');
  if (list) return list;

  const header = headerFor($, section);
  const labelled = header ? header.find('[id]').first().attr('id') : '';
  if (labelled) return labelled;

  return `${view || 'view'}:${index}`;
}

module.exports = { SECTION_SELECTOR, HEADER_SELECTOR, DEFAULT_COLLAPSED, headerFor, sectionsIn, sectionKey };
