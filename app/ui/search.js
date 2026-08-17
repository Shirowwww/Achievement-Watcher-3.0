'use strict';

(function ($, window, document) {
  const { stripTags } = require('../util/stripTags.js');
  $(function () {
    $('#search-bar input[type=search]').keyup(function () {
      const self = $(this);
      const filter = stripTags(self.val())
        .trim()
        .toUpperCase();
      const gamelist = $('#game-list ul');
      const li = gamelist.children('li');

      // Toggle a class instead of inline display so search COMPOSES with the CSS-driven
      // "installed only" filter (ul.installed-only li:has([data-installed='0'])). Inline .show()
      // used to win over that rule, leaking phantom (non-installed) games into results and leaving
      // them stuck visible after the box was cleared. A tile is shown only when it is neither
      // search-hidden nor filtered out by installed-only.
      li.each((index, elem) => {
        const _this = $(elem);
        const gameName = _this.find('.game-box .info .title').text().toUpperCase();
        const gameID = String(_this.find('.game-box').data('appid') ?? '');

        // Numbers are matched in the title too (e.g. "2" finds "Resident Evil 2"), while an exact
        // appid still resolves a single game. Empty query => everything matches (filter is cleared).
        const match = filter === '' || gameName.includes(filter) || gameID === filter;
        _this.toggleClass('search-hidden', !match);
      });
    });

    $('#search-bar input[type=search]').change(function () {
      const self = $(this);
      if (self.val().length > 0) self.addClass('has');
      else self.removeClass('has');
    });

    $(document).keydown(function (e) {
      if (e.ctrlKey && e.which === 70) {
        //CTRL+F
        const elem = $('#achievement').is(':visible') ? $('#achievement-search-input') : $('#search-bar input[type=search]');
        elem.is(':focus') ? elem.blur() : elem.focus();
      }
    });
  });
})(window.jQuery, window, document);
