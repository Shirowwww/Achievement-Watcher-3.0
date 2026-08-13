'use strict';

function isInstalled(game) {
  return Boolean(game && (game.installed === true || game.installed === 1 || game.installed === '1'));
}

function calculateLibraryStats(games, { installedOnly = false } = {}) {
  // A game with no achievement schema still belongs in the library and can track playtime, but it
  // has no meaningful completion percentage. Excluding it from every achievement-stat denominator
  // avoids turning 0/0 into either a completed game or an artificial 0% entry in the average.
  const visibleGames = (Array.isArray(games) ? games : []).filter((game) => {
    if (!game || !game.achievement || (installedOnly && !isInstalled(game))) return false;
    return Number(game.achievement.total) > 0;
  });

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
