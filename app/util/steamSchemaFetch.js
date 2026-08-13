'use strict';

const path = require('path');
const { createRequire } = require('module');

/*
  Pure mapping/parsing helpers for the keyless Steam schema chain:

    official GetGameAchievements (works without an API key)
      -> SteamHunters public JSON API
      -> SteamCommunity achievements page (plain HTML)

  The module performs no I/O and depends on nothing but node-html-parser (loaded lazily so the
  file stays require-able in environments that only need the JSON mappings). Network orchestration
  lives in app/electron/init.js (main process) and watchdog/steam.js.

  All mappers emit the achievement shape the rest of the app consumes:
  { name, defaultvalue, displayName, hidden, description, icon, icongray, rarityPercent? }
*/

function toRarityPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// IPlayerService/GetGameAchievements response -> AW schema entries. Real descriptions for hidden
// achievements are included by Steam itself, unlike legacy GetSchemaForGame.
function mapOfficialAchievements(response, appid) {
  const list = response && Array.isArray(response.achievements) ? response.achievements : [];
  return list.map((a) => ({
    name: a.internal_name,
    defaultvalue: 0,
    displayName: a.localized_name,
    hidden: a.hidden ? 1 : 0,
    description: a.localized_desc || '',
    icon: a.icon
      ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${a.icon}`
      : '',
    icongray: a.icon_gray
      ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${a.icon_gray}`
      : '',
    rarityPercent: toRarityPercent(a.player_percent_unlocked),
  }));
}

// SteamHunters public JSON API (https://steamhunters.com/api/apps/<id>/achievements) -> entries.
// The JSON carries apiName/name/description and global rarity, but no icons and no hidden flag.
// `estimatedSteamPercentage` is the fallback used by other consumers when Steam has not published
// the real percentage yet (the field appears on brand-new or low-owner games).
function mapSteamHuntersJson(list) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    name: a.apiName,
    defaultvalue: 0,
    displayName: a.name,
    hidden: 0,
    description: a.description || '',
    icon: '',
    icongray: '',
    rarityPercent: toRarityPercent(a.steamPercentage ?? a.estimatedSteamPercentage),
  }));
}

function stripHtml(value) {
  const source = String(value || '');
  let text = '';
  let inTag = false;
  for (const character of source) {
    if (character === '<') {
      inTag = true;
    } else if (character === '>') {
      inTag = false;
    } else if (!inTag) {
      text += character;
    }
  }
  return text.replace(/&nbsp;/g, ' ').trim();
}

// SteamCommunity achievements page -> [{ img, icon, title, description }].
// `img` keeps the historical hash-only value (used by mergeTranslatedAchievements), `icon` is the
// full URL used when rebuilding a schema from the SteamHunters/SteamCommunity fallback.
function parseSteamCommunityRows(html) {
  const rows = [];
  if (!html || typeof html !== 'string' || !html.includes('achieveRow')) return rows;

  let htmlParser = null;
  try {
    htmlParser = require('node-html-parser');
  } catch {
    // The packaged Watchdog loads this module from resources/app.asar.unpacked, outside the
    // watchdog's own node_modules chain; anchor the lookup at the watchdog package (its cwd).
    try {
      htmlParser = createRequire(path.join(process.cwd(), 'package.json'))('node-html-parser');
    } catch {
      htmlParser = null;
    }
  }

  if (htmlParser) {
    const doc = htmlParser.parse(html);
    for (const row of doc.querySelectorAll('.achieveRow')) {
      const title = row.querySelector('.achieveTxt h3')?.text?.trim() || '';
      if (!title) continue;
      const src = row.querySelector('.achieveImgHolder img')?.getAttribute('src') || '';
      rows.push({
        img: src ? src.split('/').pop().split('.jpg')[0] : '',
        icon: src || '',
        title,
        description: row.querySelector('.achieveTxt h5')?.text?.trim() || '',
      });
    }
    return rows;
  }

  // Regex fallback for environments without node-html-parser (standalone verification only).
  const rowRe = /<div class="achieveRow[^"]*">([\s\S]*?)<div style="clear: both;"><\/div>/g;
  let match;
  while ((match = rowRe.exec(html))) {
    const block = match[1];
    const title = stripHtml((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    if (!title) continue;
    const src = (block.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '';
    rows.push({
      img: src ? src.split('/').pop().split('.jpg')[0] : '',
      icon: src,
      title,
      description: stripHtml((block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) || [])[1]),
    });
  }
  return rows;
}

// SteamCommunity rows -> AW entries (degraded fallback: no apiName, hidden detected via blank
// description). Only used when both the official endpoint and SteamHunters are unreachable.
function mapSteamCommunityRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    name: r.title || '',
    defaultvalue: 0,
    displayName: r.title || '',
    hidden: r.title && !r.description ? 1 : 0,
    description: r.description || '',
    icon: r.icon || '',
    icongray: '',
  }));
}

// Merge SteamHunters JSON (apiName + descriptions, English) with SteamCommunity rows (icons +
// hidden status). Titles are matched case-insensitively against the ENGLISH page (SteamHunters is
// English-only); a same-position row is only used for the icon, never for hidden/description, so a
// misordered page cannot mislabel an achievement. Localized text is applied separately by
// achievementTranslations.mergeTranslatedAchievements, which matches by icon hash.
function mergeSteamHuntersWithCommunity(shList, rows) {
  const mapped = mapSteamHuntersJson(shList);
  if (!Array.isArray(rows) || rows.length === 0) return mapped;

  const byTitle = new Map();
  for (const row of rows) {
    if (row && row.title) byTitle.set(row.title.toLowerCase(), row);
  }

  return mapped.map((achievement, index) => {
    const matched = byTitle.get(String(achievement.displayName || '').toLowerCase());
    const row = matched || rows[index];
    if (!row) return achievement;
    return {
      ...achievement,
      // Hidden is only trustworthy when the row really is the same achievement.
      hidden: matched && row.title && !row.description ? 1 : achievement.hidden,
      description: achievement.description || (matched ? row.description : '') || '',
      icon: achievement.icon || row.icon || '',
      icongray: achievement.icongray || '',
    };
  });
}

// Icon URL/hash -> stable identifier (same trick as achievementTranslations.js). Steam serves the
// same CDN image for a given achievement everywhere, so this survives across languages/sources.
function iconKey(urlOrHash) {
  const value = String(urlOrHash || '').trim();
  if (!value) return '';
  const base = value.split('/').pop() || value;
  return base.replace(/\.(?:jpg|png)$/i, '');
}

// Icon-hash -> real apiName lookup, built from a list that has real apiNames (never from the
// SteamCommunity-only degraded fallback, whose `name` is just a display title). A hash shared by
// two DIFFERENT apiNames (some games reuse one generic icon) is dropped instead of guessed.
function buildApiNameIndex(achievements) {
  const index = {};
  const ambiguous = new Set();
  for (const a of Array.isArray(achievements) ? achievements : []) {
    if (!a || !a.name) continue;
    for (const key of [iconKey(a.icon), iconKey(a.icongray)]) {
      if (!key) continue;
      if (key in index) {
        if (index[key] !== a.name) ambiguous.add(key);
        continue;
      }
      index[key] = a.name;
    }
  }
  for (const key of ambiguous) delete index[key];
  return index;
}

// Recovers real apiNames for the degraded SteamCommunity-only fallback via the index above. No
// match just keeps the title-based placeholder name — never worse than before this lookup existed.
function applyApiNameIndex(achievements, index) {
  if (!index || typeof index !== 'object' || Object.keys(index).length === 0) return achievements;
  return (Array.isArray(achievements) ? achievements : []).map((a) => {
    const real = a && index[iconKey(a.icon)];
    return real ? { ...a, name: real } : a;
  });
}

// SteamHunters achievement-group JSON (https://steamhunters.com/api/GetAchievementGroups/v1) ->
// normalized groups. Only entries that carry an apiName list are useful for tagging schema entries.
function parseSteamHuntersGroups(json) {
  if (!json || !Array.isArray(json.groups)) return [];
  return json.groups
    .map((group) => ({
      name: String(group && (group.dlcAppName || group.name) || '').trim(),
      dlcAppId: group && group.dlcAppId ? Number(group.dlcAppId) : 0,
      apiNames: Array.isArray(group && group.achievementApiNames)
        ? group.achievementApiNames.map((n) => String(n || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((group) => group.name && group.apiNames.length > 0);
}

// Tag schema entries with their SteamHunters group name (DLC/update). Matching is by apiName only
// (case-insensitive, because Steam emulator files and official schemas occasionally differ in
// case), so a SteamCommunity-only fallback (title-based names) is simply left untagged. Never
// overwrites an existing category and never mutates entries in place.
function applySteamHuntersGroups(achievements, groups) {
  const normalized = parseSteamHuntersGroups(Array.isArray(groups) ? { groups } : groups);
  if (!Array.isArray(achievements) || achievements.length === 0 || normalized.length === 0) {
    return achievements;
  }
  const byApiName = new Map();
  for (const group of normalized) {
    for (const apiName of group.apiNames) {
      const key = apiName.toLowerCase();
      if (!byApiName.has(key)) byApiName.set(key, group.name);
    }
  }
  return achievements.map((achievement) => {
    if (!achievement || achievement.category || !achievement.name) return achievement;
    const label = byApiName.get(String(achievement.name).trim().toLowerCase());
    return label ? { ...achievement, category: label } : achievement;
  });
}

module.exports = {
  mapOfficialAchievements,
  mapSteamHuntersJson,
  stripHtml,
  parseSteamCommunityRows,
  mapSteamCommunityRows,
  mergeSteamHuntersWithCommunity,
  parseSteamHuntersGroups,
  applySteamHuntersGroups,
  toRarityPercent,
  iconKey,
  buildApiNameIndex,
  applyApiNameIndex,
};
