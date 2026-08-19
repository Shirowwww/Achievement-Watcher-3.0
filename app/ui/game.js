'use strict';

function indexAchievementRows($) {
  const rowsByName = new Map();
  $('#achievement li .achievement[data-name]').each(function () {
    const name = this.getAttribute('data-name');
    const rows = rowsByName.get(name);
    if (rows) rows.push(this);
    else rowsByName.set(name, [this]);
  });
  return rowsByName;
}

// The rare halo under an achievement icon is two infinite rotations that Blink cannot composite, so
// every rare row repaints on the main thread every frame - including the rows scrolled out of view.
// Pausing the off-screen ones is worth ~40% of the renderer's main-thread budget on a long list, but
// it has to be done without asking the engine to test every row's position on every frame: both
// `content-visibility: auto` and IntersectionObserver do exactly that, and the per-frame cost of the
// test is itself enough to drop main-thread frames. Middle-button autoscroll advances once per
// main-thread frame, so a dropped frame there is visible stutter (#35) while wheel scrolling, run by
// the compositor, stays smooth either way.
// Hence: while the scroll is moving nothing is measured and every halo runs (the `glow-all` class,
// i.e. the behaviour that shipped before 3.9.1); the on-screen set is recomputed once it stops.
const GLOW_MARGIN_PX = 400;
const GLOW_SETTLE_MS = 150;
let glowLive = [];
let glowSettleTimer = null;

function refreshRareGlow() {
  const scroller = document.getElementById('achievement');
  if (!scroller) return;
  scroller.classList.remove('glow-all');

  const view = scroller.getBoundingClientRect();
  const top = view.top - GLOW_MARGIN_PX;
  const bottom = view.bottom + GLOW_MARGIN_PX;
  const next = [];
  for (const box of scroller.querySelectorAll('.achievement.rare .box')) {
    const rect = box.getBoundingClientRect();
    // A row hidden by the search filter or a collapsed section has a zero-height rect: it paints
    // nothing, so it never needs its halo running.
    if (rect.height > 0 && rect.bottom >= top && rect.top <= bottom) next.push(box);
  }
  for (const box of glowLive) if (!next.includes(box)) box.classList.remove('glow-live');
  for (const box of next) box.classList.add('glow-live');
  glowLive = next;
}

// Anything that moves rows or changes which ones exist (rarity arriving, a sort, the search filter,
// a section folding) goes through here rather than recomputing inline: it coalesces with the scroll
// settle, so a burst of changes costs one pass.
function scheduleRareGlowRefresh(delay = GLOW_SETTLE_MS) {
  clearTimeout(glowSettleTimer);
  glowSettleTimer = setTimeout(refreshRareGlow, delay);
}
window.scheduleRareGlowRefresh = scheduleRareGlowRefresh;

// Paint the global unlock % (rarity) onto the rendered achievement rows. `entries` is the normalized
// [{name, percent}] shape produced by util/rarity.js, identical for Steam/Epic/GOG.
function applyRarity(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  let rarityTier = null;
  try {
    const remote = require('@electron/remote');
    const path = require('path');
    rarityTier = require(path.join(remote.app.getAppPath(), 'util/overlayUi.js')).rarityTier;
  } catch {
    return; // rarity is a non-essential enrichment
  }
  const rowsByName = indexAchievementRows($);
  for (const { name, percent: raw } of entries) {
    let percent = Math.round(raw * 10) / 10;
    if (percent > 100) percent = 100;

    const elem = $(rowsByName.get(String(name)) || []);
    elem.find('.stats .community span.data').text(percent);

    const tier = rarityTier(percent);
    if (tier) {
      elem.addClass('rare');
      elem.removeClass('rarity-gold rarity-silver rarity-bronze');
      elem.addClass('rarity-' + tier);
    } else {
      elem.removeClass('rare rarity-gold rarity-silver rarity-bronze');
    }
  }
  $('.achievement-list > .header .sort-ach .sort.percentage').addClass('show');
  // Rarity arrives asynchronously; reapply a persisted percentage sort now that its values are real.
  if (typeof window.restoreAchievementSorts === 'function') window.restoreAchievementSorts();
  // `.rare` was just handed out (or taken back), so this is where the halo set first exists at all.
  scheduleRareGlowRefresh(0);
}

function getGlobalStat(appid, source, gameName, achievements, context) {
  let rarity;
  try {
    const path = require('path');
    const remote = require('@electron/remote');
    rarity = require(path.join(remote.app.getAppPath(), 'util/rarity.js'));
  } catch (err) {
    return; // rarity is a non-essential enrichment - never let it break the game view
  }

  // 1. Instant paint from the on-disk sidecar so a repeat/offline view shows tiers immediately
  //    instead of waiting on (or losing) the network round-trip.
  try {
    applyRarity(rarity.readRarityCacheEntries(appid));
  } catch (err) {
    /* no cache yet - the refresh below will populate it */
  }

  // 2. Background refresh: hits the network only when the cache is stale (TTL-gated inside the util),
  //    persists the result, and repaints. Failures fall back to whatever the cache already showed.
  const pending =
    source === 'steam-bridge' && context && context.steamAppId
      ? rarity.getSteamBridgeRarity(appid, context.steamAppId, context.names || achievements.map((a) => a && a.name), {})
      : rarity.getRarityEntries(appid, source, { gameName, achievements });
  pending.then((entries) => applyRarity(entries)).catch(() => {});
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

    // While the list is moving every rare halo runs, as it did before this budget existed; the
    // on-screen set is worked out once it has come to rest. Passive: this must never be able to
    // hold up the scroll it is watching.
    const achievementScroller = document.getElementById('achievement');
    if (achievementScroller) {
      achievementScroller.addEventListener(
        'scroll',
        function () {
          this.classList.add('glow-all');
          scheduleRareGlowRefresh();
        },
        { passive: true }
      );
    }
    // A taller window shows rows that were out of the picked set, and nothing else would notice.
    window.addEventListener('resize', () => scheduleRareGlowRefresh(), { passive: true });

    // Filter the unlocked/locked achievement rows by title or (visible) description. Hidden-masked
    // descriptions are matched on their displayed label only, so spoilers don't leak through search.
    $('#achievement-search-input').on('input', function () {
      const { stripTags } = require('../util/stripTags.js');
      const filter = stripTags(String($(this).val() || ''))
        .trim()
        .toUpperCase();
      $('#achievement .achievement-list ul > li').each(function () {
        const elem = $(this);
        const title = elem.find('.achievement .content .title').text().toUpperCase();
        const desc = elem.find('.achievement .content .description').text().toUpperCase();
        elem.toggleClass('search-hidden', filter !== '' && !title.includes(filter) && !desc.includes(filter));
      });
      scheduleRareGlowRefresh();
    });

    // Mouse side-button navigation (app-wide): Back (4) closes Settings first - it overlays
    // everything - then the game detail view; Forward (5) reopens the game closed with Back.
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

    // Right-click an achievement row to mark it as manually unlocked (or clear the override).
    $('#achievement .achievement-list').on('contextmenu', '.achievement', function (event) {
      const row = $(this);
      const name = row.data('name');
      const appid = $('#achievement .wrapper > .header').attr('data-appid');
      const source = $('#achievement .wrapper > .header').attr('data-source') || '';
      if (!name || !appid) return;

      const achieved = row.data('achieved') === 1;
      const manual = row.data('manual') === 1;
      const remote = require('@electron/remote');
      const items = [];
      if (manual) {
        items.push({
          label: $('#game-list').attr('data-ctx-clearmanualunlock') || '',
          click: () => window.app?.manualUnlockAction?.(appid, source, name, 'clear-manual'),
        });
      } else if (!achieved) {
        items.push({
          label: $('#game-list').attr('data-ctx-manualunlock') || '',
          click: () => window.app?.manualUnlockAction?.(appid, source, name, 'mark-unlocked'),
        });
      }
      if (items.length === 0) return;
      event.preventDefault();
      remote.Menu.buildFromTemplate(items).popup({ window: remote.getCurrentWindow() });
    });

    $('#btn-previous').click(function () {
      let self = $(this);
      self.css('pointer-events', 'none');

      if (app.args.name) app.args.name = null;

      // Mark the detail view as closed straight away, before the 800ms of fade-out and delay below.
      // An artwork fetch still in flight for this game checks this attribute before painting body,
      // so clearing it here is what stops a late reply from putting the game's background behind
      // the library. Everything else that reads it means "the game currently on screen" too.
      $('#achievement .wrapper > .header').removeAttr('data-appid').removeAttr('data-source');

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

    /*
      Reset this game's achievements, from the game's own page. The appid comes from the header
      attribute rather than from a captured variable: it is the same value every other late-arriving
      handler in this view checks, so the button can never act on the game that was open before.
    */
    $('#btn-reset-achievements').click(async function () {
      const appid = $('#achievement .wrapper > .header').attr('data-appid');
      if (!appid) return;
      const self = $(this);
      self.css('pointer-events', 'none');
      try {
        await app.resetAchievementsAction(appid);
      } finally {
        self.css('pointer-events', 'initial');
      }
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
        // Folding a section moves everything below it, so re-pick the halos once it has settled.
        scheduleRareGlowRefresh(0);
      }, speed);
    });
  });
})(window.jQuery, window, document);
