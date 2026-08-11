'use strict';

// SteamCommunity translations identify an achievement by either artwork URL. Indexing keeps the
// original Array.find order (first schema entry wins), while avoiding a full schema scan per
// translated achievement.
function buildAchievementImageIndex(achievements) {
  const byImage = new Map();

  for (const achievement of Array.isArray(achievements) ? achievements : []) {
    if (!byImage.has(achievement.icon)) byImage.set(achievement.icon, achievement);
    if (!byImage.has(achievement.icongray)) byImage.set(achievement.icongray, achievement);
  }

  return byImage;
}

function mergeTranslatedAchievements(achievements, translations) {
  const byImage = buildAchievementImageIndex(achievements);

  for (const translation of Array.isArray(translations) ? translations : []) {
    const match = byImage.get(translation.img);
    if (!match) continue;
    match.description = translation.description;
    match.displayName = translation.title;
  }

  return achievements;
}

module.exports = {
  buildAchievementImageIndex,
  mergeTranslatedAchievements,
};
