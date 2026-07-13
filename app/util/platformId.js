'use strict';

// Platform-aware appid identity. Ported concept from PSerban93/Achievements (JokerVerse)
// utils/config-platform-migrator.js `sanitizeAppIdForPlatform` — MIT-licensed; see NOTICE.md. The
// target uses it to migrate a persisted per-game config store (which AW doesn't have); the reusable
// kernel is validating that an appid matches its platform's id shape.
//
// AW keys its shared caches (rarity sidecars, cover overrides, watchdog gameIndex) by bare appid.
// Most sources map onto a Steam appid, so sharing a key is correct. But the official-launcher
// sources added in Tier 2/3 carry NATIVE ids in their own number space:
//   - GOG official     → GOG productId (10-digit, e.g. 1423049311)
//   - Ubisoft official → Ubisoft productId (SMALL int, e.g. 1843/6100/8006)
//   - Epic official    → Epic namespace (32-hex string)
// A Ubisoft productId like 1843 collides with the real Steam appid 1843 (Space Empires V): their
// rarity/cover/gameIndex entries would clobber each other. `officialAppId` namespaces the
// collision-prone native ids so each platform gets its own cache key. (Epic's hex namespace and
// GOG's 10-digit ids don't realistically collide with Steam's sequential appids, but namespacing
// them is harmless and future-proof.)

// Map an internal parser `data.type` / source to a stable short platform tag.
const SOURCE_TO_PLATFORM = {
  gogOfficial: 'gog-official',
  ubisoftOfficial: 'ubisoft-official',
  epicOfficial: 'epic-official',
  steamOfficial: 'steam-official',
};

// Platforms whose native id space overlaps Steam's numeric appids and therefore need a namespaced
// cache key. (Epic namespaces are hex strings, already collision-proof.)
const NEEDS_NAMESPACE = new Set(['ubisoft-official', 'gog-official']);

const PLATFORM_PREFIX = {
  'gog-official': 'gog',
  'ubisoft-official': 'uplay',
  'epic-official': 'epic',
  'steam-official': 'steam',
};

function normalizeType(type) {
  return SOURCE_TO_PLATFORM[type] || String(type || '').trim().toLowerCase();
}

// Validate/normalize a raw appid for a platform. Returns '' when it doesn't match the expected
// shape, so callers can reject a malformed id before it becomes a cache filename.
function sanitizeAppIdForPlatform(value, type) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const platform = normalizeType(type);
  switch (platform) {
    case 'epic-official':
      // Epic namespace / catalog id: alphanumeric + a few separators.
      return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw) ? raw : '';
    case 'rpcs3':
      return /^NP[A-Z0-9_]+$/i.test(raw) ? raw : '';
    case 'shadps4':
      return /^CUSA[0-9]+$/i.test(raw) || /^NP[A-Z0-9_]+$/i.test(raw) ? raw : '';
    case 'xenia':
      return /^(?:0x)?[0-9a-f]+$/i.test(raw) ? raw.replace(/^0x/i, '') : '';
    case 'steam':
    case 'steam-official':
    case 'gog':
    case 'gog-official':
    case 'ubisoft-official':
    case 'uplay':
    default:
      // Numeric id space (Steam/GOG/Ubisoft/emulated). Hex is tolerated for legacy callers.
      return /^[0-9a-fA-F]+$/.test(raw) ? raw : '';
  }
}

// Collision-safe cache key for a source's appid. Native-id official sources get a `<prefix>-<id>`
// key; everything else keeps its bare appid (so Steam/emulator caches are unchanged — back-compat).
function officialAppId(type, rawId) {
  const id = String(rawId || '').trim();
  if (!id) return id;
  const platform = normalizeType(type);
  if (NEEDS_NAMESPACE.has(platform) && !id.includes('-')) {
    return `${PLATFORM_PREFIX[platform]}-${id}`;
  }
  return id;
}

// Recover the raw native id from a namespaced cache key (inverse of officialAppId).
function rawAppId(value) {
  const s = String(value || '');
  const m = s.match(/^(?:gog|uplay|epic|steam)-(.+)$/);
  return m ? m[1] : s;
}

module.exports = {
  SOURCE_TO_PLATFORM,
  normalizeType,
  sanitizeAppIdForPlatform,
  officialAppId,
  rawAppId,
};
