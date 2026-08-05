'use strict';

const fs = require('fs');
const path = require('path');
const merge = require('deepmerge');

// Builds the payload for the `overlay-language` IPC channel consumed by
// app/view/overlay.html. The renderer applies `strings` to its header columns,
// status labels and empty/fallback messages, and uses `lang` when picking a
// localized achievement name/description.
//
// English is the base and every locale is merged over it, so a missing or
// broken per-language file degrades to English exactly like locale/loader.js
// and the onboarding guide.
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
