'use strict';

/*
  Which Settings blocks are collapsible sections. Collapsing only toggles a class - positional i18n
  requires the DOM to survive - so the selectors are part of the contract, tested against app.html.
*/

/*
  A section is a card with one of the three card headers; heroes and nested blocks are excluded.
*/
const SECTION_SELECTOR = '.arrow-list, .emulator-group, .settings-card, #epic-connect, .emulator-login';

/*
  The clickable header of a section, as a DIRECT child. Three shapes exist:
    .title                  - the ordinary card header
    .emulator-group-title   - emulator groups
    .emulator-login-heading - account/customizer cards, whose .title is nested one level deeper
*/
const HEADER_SELECTOR = '.title, .emulator-group-title, .emulator-login-heading';

/*
  Sections that start collapsed on a fresh profile.

  Empty on purpose. The preset designer used to be listed here - a large authoring surface sitting
  between the notification options and the souvenir settings - but it now has a tab of its own, where
  it is the reason the user opened the tab. Nothing else in the panel is big enough to be worth
  hiding from someone who has just arrived.
*/
const DEFAULT_COLLAPSED = [];

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
