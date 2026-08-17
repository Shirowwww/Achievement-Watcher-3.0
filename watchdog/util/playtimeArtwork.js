'use strict';

const path = require('path');
const { steamHeaderImage, steamLibraryImage } = require('./steamArtwork.js');

function numericSteamId(game) {
  const candidates = [game && game.steamappid, game && game.appid];
  for (const value of candidates) {
    const id = String(value == null ? '' : value).trim();
    if (/^\d+$/.test(id)) return id;
  }
  return '';
}

function usableArtwork(value) {
  if (typeof value !== 'string') return undefined;
  const source = value.trim();
  if (!source) return undefined;
  if (/^https?:\/\//i.test(source) || source.startsWith('file:///') || path.isAbsolute(source)) return source;
  return undefined;
}

function resolvePlaytimeArtwork(game = {}) {
  const steamId = numericSteamId(game);
  const iconUrl = usableArtwork(game.iconUrl);
  const headerUrl = usableArtwork(game.headerUrl);
  const portraitUrl = usableArtwork(game.portraitUrl);
  const steamIcon =
    steamId && game.icon
      ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${steamId}/${game.icon}.jpg`
      : undefined;
  // The square logo the library already fetched for this game.
  const squareLogo = iconUrl || steamIcon;

  return {
    icon: squareLogo,
    // A resolved icon is already square and is a better Windows app-logo than a cropped poster.
    gameIcon: iconUrl || portraitUrl || (steamId ? steamLibraryImage(steamId) : undefined) || squareLogo,
    // The square logo is the last resort for the hero slot: a game with no header or portrait art
    // (a manual entry, a synthetic appid) otherwise ends its session on a card with an empty image.
    image: headerUrl || portraitUrl || (steamId ? steamHeaderImage(steamId) : undefined) || squareLogo,
  };
}

module.exports = { numericSteamId, usableArtwork, resolvePlaytimeArtwork };
