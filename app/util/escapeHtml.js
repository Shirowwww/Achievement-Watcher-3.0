'use strict';

// Escape untrusted text before interpolating it into HTML: scraped names/descriptions are appended
// verbatim in a nodeIntegration renderer, so a payload would execute Node code (XSS → RCE hardening).
// Entity escaping is round-trip safe when values are read back via .data()/[attr="…"].
const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

module.exports = { escapeHtml };
