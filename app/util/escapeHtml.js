'use strict';

// Escape untrusted text before interpolating it into an HTML template string.
// Achievement names, display names and descriptions come from scraped pages (SteamDB /
// SteamCommunity), emulator achievements.json files and SteamGridDB, and are otherwise injected
// verbatim via jQuery .append() in the renderer — which runs with nodeIntegration, so an
// `<img src=x onerror=…>` payload would execute arbitrary Node code (XSS -> RCE hardening).
// Browsers decode these entities back to the original string when reading an attribute value, so
// escaping a value that is later read back via .data()/[attr="…"] is round-trip safe.
const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

module.exports = { escapeHtml };
