'use strict';

// Extract SteamID64 owners from the SteamLadder HTML fetched by the main process.

const PROFILE_HREF_RE = /\/profile\/(\d{17})\b/g;

// Extract de-duplicated SteamID64s (17-digit) from SteamLadder profile links, in page order.
function extractSteamIdsFromHtml(html = '', limit = 250) {
  const source = String(html || '');
  const cap = Math.max(1, Number(limit) || 250);
  const steamIds = [];
  const seen = new Set();
  let match;
  PROFILE_HREF_RE.lastIndex = 0;
  while ((match = PROFILE_HREF_RE.exec(source)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    steamIds.push(id);
    if (steamIds.length >= cap) break;
  }
  return steamIds;
}

module.exports = {
  DEFAULT_URL: 'https://steamladder.com/ladder/games/',
  extractSteamIdsFromHtml,
};
