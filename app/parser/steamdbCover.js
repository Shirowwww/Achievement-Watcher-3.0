'use strict';

// Parse SteamDB HTML to recover hashed library-cover URLs.

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

// Every library asset URL found on a SteamDB info page (deduplicated). The 600x900 portrait comes
// first when present, then any wider library_capsule variants — callers filter by orientation.
function coversFromHtml(appid, html) {
  const source = String(html || '');
  if (!source) return [];
  const out = [];
  const push = (value) => {
    const url = normalizeSteamDbAssetUrl(appid, value);
    if (url && !out.includes(url)) out.push(url);
  };
  try {
    const root = htmlParser.parse(source);
    for (const anchor of root.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || '';
      const text = anchor.text || '';
      for (const candidate of [href, text]) {
        if (isPortraitAsset(candidate)) push(candidate);
      }
    }
  } catch {
    /* malformed HTML -> raw sweep below */
  }
  const sweep = /https?:\/\/[^"'<\s]*(?:library_600x900\.jpg|library_capsule(?:_[a-z0-9]+)*\.jpg)|store_item_assets\/steam\/apps\/\d+\/[^"'<\s]*(?:library_600x900\.jpg|library_capsule(?:_[a-z0-9]+)*\.jpg)/gi;
  let match;
  while ((match = sweep.exec(source))) push(match[0]);
  return out;
}

module.exports = {
  CDN_BASE,
  normalizeSteamDbAssetUrl,
  isPortraitAsset,
  isCapsuleAsset,
  coverFromHtml,
  coversFromHtml,
};
