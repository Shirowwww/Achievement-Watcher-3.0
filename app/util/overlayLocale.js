'use strict';

const fs = require('fs');
const path = require('path');
const merge = require('deepmerge');

// Builds the overlay-language payload: strings for headers/status/empty labels plus the lang used for
// localized names. English is the base and every locale merges over it, degrading gracefully.
function loadOverlayLocale({ localeDir, lang } = {}) {
  const language = String(lang || 'english');
  const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));
  let data = english;
  if (language !== 'english') {
    try {
      const requested = JSON.parse(fs.readFileSync(path.join(localeDir, `${language}.json`), 'utf8'));
      data = merge(english, requested, {
        arrayMerge: (dest, src) => src,
        isEmpty: (value) => value === null || value === '',
      });
    } catch {
      // Broken or missing per-language file: keep the English base.
    }
  }
  return {
    lang: language,
    strings: (data && data.overlay) || {},
  };
}

module.exports = { loadOverlayLocale };
