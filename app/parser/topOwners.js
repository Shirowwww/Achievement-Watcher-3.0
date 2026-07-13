'use strict';

// Top-owners SteamID seed. Some games have no achievement schema available without a Steam Web API
// key and nobody on SteamHunters who 100%'d them — the keyless scrape in steam.js then has no public
// profile to read the schema/rarity from (see its "fallback to steamuserids" TODO). SteamLadder's
// games ladder lists prolific collectors whose profiles are public and own huge libraries, so their
// SteamIDs are a reliable pool of owners to try for any given appid.
//
// SteamLadder 403s/challenges plain HTTP, so the page fetch runs through AW's puppeteer-extra +
// stealth browser in the main process (init.js `get-top-owners`); the parsed list is disk-cached.
// This module is the pure logic — pull 17-digit SteamID64s out of the page HTML — so it stays
// unit-testable offline.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/update-top-owners.js — MIT-licensed; see
// NOTICE.md. cheerio + Playwright are replaced by a regex sweep (no new dependency).

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
