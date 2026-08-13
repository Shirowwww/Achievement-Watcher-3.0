'use strict';

// SteamCommunity translations identify an achievement by either artwork URL. Indexing keeps the
// original Array.find order (first schema entry wins), while avoiding a full schema scan per
// translated achievement.
function iconKey(urlOrHash) {
  const value = String(urlOrHash || '').trim();
  if (!value) return value;
  const base = value.split('/').pop() || value;
  return base.replace(/\.(?:jpg|png)$/i, '');
}

function buildAchievementImageIndex(achievements) {
  const byImage = new Map();

  for (const achievement of Array.isArray(achievements) ? achievements : []) {
    const icon = iconKey(achievement.icon);
    const gray = iconKey(achievement.icongray);
    if (icon && !byImage.has(icon)) byImage.set(icon, achievement);
    if (gray && !byImage.has(gray)) byImage.set(gray, achievement);
    // Legacy behaviour: a schema entry with no artwork at all still receives a translation that
    // carries no image. Real empty strings are skipped, so entries whose icon is missing (e.g.
    // SteamHunters mappings) are never mislabeled by a page row without an image URL either.
    if (!icon && !gray && !byImage.has(undefined)) byImage.set(undefined, achievement);
  }

  return byImage;
}

function mergeTranslatedAchievements(achievements, translations) {
  const byImage = buildAchievementImageIndex(achievements);

  for (const translation of Array.isArray(translations) ? translations : []) {
    const key = translation.img == null ? undefined : iconKey(translation.img);
    const match = key === '' ? undefined : byImage.get(key);
    if (!match) continue;
    // SteamCommunity blanks hidden descriptions on purpose; never overwrite a real schema
    // description with an empty one (the official endpoint / SteamHunters provide the text).
    if (translation.description && String(translation.description).trim() !== '') {
      match.description = translation.description;
    }
    if (translation.title) match.displayName = translation.title;
  }

  return achievements;
}

module.exports = {
  iconKey,
  buildAchievementImageIndex,
  mergeTranslatedAchievements,
};
