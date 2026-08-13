'use strict';

function isInstalled(game) {
  return Boolean(game && (game.installed === true || game.installed === 1 || game.installed === '1'));
}

function calculateLibraryStats(games, { installedOnly = false } = {}) {
  const visibleGames = (Array.isArray(games) ? games : []).filter(
    (game) => game && game.achievement && (!installedOnly || isInstalled(game))
  );

  const totalUnlocked = visibleGames.reduce(
    (sum, game) => sum + (Number.parseInt(game.achievement.unlocked, 10) || 0),
    0
  );
  const completed = visibleGames.filter((game) => {
    const total = Number(game.achievement.total) || 0;
    return total > 0 && Number(game.achievement.unlocked) === total;
  }).length;
  const progressTotal = visibleGames.reduce((sum, game) => {
    const total = Number(game.achievement.total) || 0;
    const unlocked = Number(game.achievement.unlocked) || 0;
    return sum + (total > 0 ? Math.round((100 * unlocked) / total) : 0);
  }, 0);

  return {
    totalUnlocked,
    completed,
    total: visibleGames.length,
    average: visibleGames.length > 0 ? Math.floor(progressTotal / visibleGames.length) : 0,
  };
}

module.exports = { calculateLibraryStats, isInstalled };
