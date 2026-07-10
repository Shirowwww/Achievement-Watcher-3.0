'use strict';

// Paint the global unlock % (rarity) onto the rendered achievement rows. `entries` is the normalized
// [{name, percent}] shape produced by util/rarity.js, identical for Steam/Epic/GOG.
function applyRarity(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  for (const { name, percent: raw } of entries) {
    let percent = Math.round(raw * 10) / 10;
    if (percent > 100) percent = 100;

    const elem = $(`#achievement li .achievement[data-name="${name}"]`);
    elem.find('.stats .community span.data').text(percent);

    if (percent >= 0 && percent <= 10) {
      // Keep `rare` as the visual base (glow machinery + community color),
      // then layer a tier color on top: gold <3%, silver <6%, bronze <=10%.
      elem.addClass('rare');
      elem.removeClass('rarity-gold rarity-silver rarity-bronze');
      if (percent < 3) elem.addClass('rarity-gold');
      else if (percent < 6) elem.addClass('rarity-silver');
      else elem.addClass('rarity-bronze');
    }
  }
  $('.achievement-list > .header .sort-ach .sort.percentage').addClass('show');
  // Rarity arrives asynchronously; reapply a persisted percentage sort now that its values are real.
  if (typeof window.restoreAchievementSorts === 'function') window.restoreAchievementSorts();
}

function getGlobalStat(appid, source) {
  let rarity;
  try {
    const path = require('path');
    const remote = require('@electron/remote');
    rarity = require(path.join(remote.app.getAppPath(), 'util/rarity.js'));
  } catch (err) {
    return; // rarity is a non-essential enrichment — never let it break the game view
  }

  // 1. Instant paint from the on-disk sidecar so a repeat/offline view shows tiers immediately
  //    instead of waiting on (or losing) the network round-trip.
  try {
    applyRarity(rarity.readRarityCacheEntries(appid));
  } catch (err) {
    /* no cache yet — the refresh below will populate it */
  }

  // 2. Background refresh: hits the network only when the cache is stale (TTL-gated inside the util),
  //    persists the result, and repaints. Failures fall back to whatever the cache already showed.
  rarity
    .getRarityEntries(appid, source)
    .then((entries) => applyRarity(entries))
    .catch(() => {});
}

(function ($, window, document) {
  $(function () {
    // Remember the tile of the game being viewed so the mouse "Forward" button can reopen it.
    // Opening a game also resets the achievement search box (fresh view, no stale filter).
    $('#game-list').on('click', '.game-box', function () {
      window.__awMouseNavGameBox = this;
      $('#achievement-search-input').val('');
      $('#achievement .achievement-list ul > li').removeClass('search-hidden');
    });

    // Filter the unlocked/locked achievement rows by title or (visible) description. Hidden-masked
    // descriptions are matched on their displayed label only, so spoilers don't leak through search.
    $('#achievement-search-input').on('input', function () {
      const filter = String($(this).val() || '')
        .replace(/<\/?[^>]+>/gi, '')
        .trim()
        .toUpperCase();
      $('#achievement .achievement-list ul > li').each(function () {
        const elem = $(this);
        const title = elem.find('.achievement .content .title').text().toUpperCase();
        const desc = elem.find('.achievement .content .description').text().toUpperCase();
        elem.toggleClass('search-hidden', filter !== '' && !title.includes(filter) && !desc.includes(filter));
      });
    });

    // Mouse side-button navigation (app-wide): Back (4) closes Settings first — it overlays
    // everything — then the game detail view; Forward (5) reopens the game closed with Back.
    $(document).mouseup(function (e) {
      if ($('#onboarding').is(':visible')) return;
      if (e.which === 4) {
        if ($('#settings').is(':visible')) {
          $('#btn-settings-cancel').trigger('click');
        } else if ($('#achievement').is(':visible')) {
          $('#btn-previous').trigger('click');
        }
      } else if (e.which === 5) {
        const box = window.__awMouseNavGameBox;
        if (!$('#achievement').is(':visible') && !$('#settings').is(':visible') && box && document.contains(box)) {
          $(box).trigger('click');
        }
      }
    });

    $('#btn-previous').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      if (app.args.name) app.args.name = null;

      $('#achievement')
        .fadeOut(500, function () {
          setTimeout(() => {
            $('body').removeAttr('style');
            $('.achievement-list > .header .sort-ach .sort').removeClass('show active');
            $('#home').fadeIn(500, function () {
              self.css('pointer-events', 'initial');
            });
          }, 300);
        })
        .scrollTop(0);
    });

    $('#btn-scrollup').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      $('#achievement').animate({ scrollTop: 0 }, 500, 'swing', function () {
        self.css('pointer-events', 'initial');
      });
    });

    $('#achievement .achievement-list .header .toggle').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      let list = self.parent().next('ul');
      let elem = self.closest('.achievement-list');
      let speed = 400;

      if (elem.hasClass('active')) {
        list.slideUp(speed);
        elem.removeClass('active');
      } else {
        list.slideDown(speed);
        elem.addClass('active');
      }
      setTimeout(() => {
        self.css('pointer-events', 'initial');
      }, speed);
    });
  });
})(window.jQuery, window, document);
