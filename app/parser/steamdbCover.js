'use strict';

// SteamDB library-capsule cover fallback. Steam's guessable CDN paths
// (`.../steam/apps/<appid>/library_600x900.jpg`) only exist for older titles: modern store assets
// live under a HASHED path (`store_item_assets/steam/apps/<appid>/<hash>/library_600x900.jpg`) that
// cannot be derived from the appid. When every guessable portrait URL 404s, AW ends up with no
// cover. SteamDB's app-info page lists the real (hashed) asset links, so scraping it recovers the
// genuine library capsule.
//
// SteamDB 403s plain HTTP (Cloudflare) but loads through AW's puppeteer-extra + stealth browser, so
// the page fetch lives in the main process (init.js `get-steamdb-cover`, same browser as the
// SteamDB launch-metadata scrape). This module is the pure logic — resolve a cover URL out of the
// page HTML — so it stays unit-testable offline.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/game-cover.js — MIT-licensed; see THIRD_PARTY_NOTICES.md.
// Playwright's page.evaluate() is replaced by node-html-parser + regex over the captured HTML.

const htmlParser = require('node-html-parser');

const CDN_BASE = 'https://shared.fastly.steamstatic.com';

const LIBRARY_PORTRAIT_RE = /library_600x900\.jpg/i;
const LIBRARY_CAPSULE_RE = /library_capsule(?:_[a-z0-9]+)*\.jpg/i;
const ABSOLUTE_ASSET_RE = /https?:\/\/[^"'<\s]*(?:library_600x900\.jpg|library_capsule(?:_[a-z0-9]+)*\.jpg)/i;
const RELATIVE_ASSET_RE = /store_item_assets\/steam\/apps\/\d+\/[^"'<\s]*(?:library_600x900\.jpg|library_capsule(?:_[a-z0-9]+)*\.jpg)/i;

// SteamDB renders asset links either absolute or relative to the store-asset CDN root.
function normalizeSteamDbAssetUrl(appid, value) {
  const raw = String(value || '')
    .trim()
    .split('?')[0];
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, '');
  if (clean.startsWith('store_item_assets/')) return `${CDN_BASE}/${clean}`;
  return `${CDN_BASE}/store_item_assets/steam/apps/${appid}/${clean}`;
}

function isPortraitAsset(value) {
  return LIBRARY_PORTRAIT_RE.test(String(value || ''));
}

function isCapsuleAsset(value) {
  return LIBRARY_CAPSULE_RE.test(String(value || ''));
}

// The 600x900 portrait is what the library grid wants; the wider library_capsule is the fallback.
function coverFromHtml(appid, html) {
  const source = String(html || '');
  if (!source) return null;

  let capsule = '';
  try {
    const root = htmlParser.parse(source);
    for (const anchor of root.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || '';
      const text = anchor.text || '';
      const candidate = isPortraitAsset(href) || isCapsuleAsset(href) ? href : text;
      if (isPortraitAsset(candidate)) return normalizeSteamDbAssetUrl(appid, candidate);
      if (!capsule && isCapsuleAsset(candidate)) capsule = candidate;
    }
  } catch {
    /* malformed HTML -> fall through to the raw regex sweep below */
  }
  if (capsule) return normalizeSteamDbAssetUrl(appid, capsule);

  // No anchor matched (SteamDB reshuffles its assets table): sweep the raw markup instead.
  const absolute = source.match(ABSOLUTE_ASSET_RE);
  if (absolute) return normalizeSteamDbAssetUrl(appid, absolute[0]);
  const relative = source.match(RELATIVE_ASSET_RE);
  if (relative) return normalizeSteamDbAssetUrl(appid, relative[0]);

  return null;
}

module.exports = {
  CDN_BASE,
  normalizeSteamDbAssetUrl,
  isPortraitAsset,
  isCapsuleAsset,
  coverFromHtml,
};
