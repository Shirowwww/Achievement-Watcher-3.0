'use strict';

/*
  Scroll a game's achievement list to one row and flash it.

  A Windows toast carries the achievement in its activation URI, so clicking it should land on that
  achievement rather than on the top of the game page. Everything here is DOM work the renderer
  cannot do until the game view has rendered, and it is kept out of app.js so its edge cases (a name
  that matches nothing, a collapsed list, a leftover search filter) can be exercised directly.

  jQuery is passed in rather than required: this module is loaded by the renderer, where $ is a
  page global.
*/

// The unlocked/locked lists slide open over 400ms. Measuring a row mid-slide yields a stale offset.
const EXPAND_SETTLE_MS = 450;
const SCROLL_MS = 250;

function focusAchievementRow($, container, rows, name, options = {}) {
  const { onMissing = () => {}, expandSettleMs = EXPAND_SETTLE_MS, scrollMs = SCROLL_MS } = options;

  // Matched in JS rather than through an attribute selector: achievement names come from
  // third-party schemas and a quote in one would turn a `[data-name="..."]` selector into a
  // syntax error.
  const target = rows
    .filter(function () {
      const el = this.querySelector('.achievement[data-name]');
      return el != null && el.getAttribute('data-name') === name;
    })
    .first();

  if (target.length === 0) {
    onMissing(name);
    return false;
  }

  // A search filter left over from an earlier view can hide the row. Highlighting something
  // invisible reads as "the toast click did nothing", so clear the filter instead.
  if (target.hasClass('search-hidden')) {
    $('#achievement-search-input').val('');
    $('#achievement .achievement-list ul > li').removeClass('search-hidden');
  }

  target.addClass('highlight');

  const scroll = () => {
    container.animate({ scrollTop: target.offset().top + container.scrollTop() - target.outerHeight(true) }, scrollMs, 'swing');
  };

  // A list the user collapsed stays collapsed across game views, so the row can be in a hidden ul.
  const list = target.closest('ul');
  if (list.is(':hidden')) {
    list.closest('.achievement-list').children('.header').find('.toggle').trigger('click');
    setTimeout(scroll, expandSettleMs);
  } else {
    scroll();
  }
  return true;
}

module.exports = { focusAchievementRow, EXPAND_SETTLE_MS, SCROLL_MS };
