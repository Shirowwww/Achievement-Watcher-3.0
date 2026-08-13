'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { numericSteamId, usableArtwork, resolvePlaytimeArtwork } = require('../util/playtimeArtwork.js');

test('manual games use their resolved artwork instead of synthetic Steam URLs', () => {
  const game = {
    appid: 'manual-e5537b5f3f22',
    icon: 'not-a-steam-icon-hash',
    iconUrl: 'https://cdn2.steamgriddb.com/icon/ryujinx.png',
    headerUrl: 'https://cdn2.steamgriddb.com/hero/ryujinx.jpg',
    portraitUrl: 'https://cdn2.steamgriddb.com/grid/ryujinx.jpg',
  };

  assert.deepEqual(resolvePlaytimeArtwork(game), {
    icon: game.iconUrl,
    gameIcon: game.iconUrl,
    image: game.headerUrl,
  });
});

test('manual games without artwork do not manufacture invalid Steam CDN URLs', () => {
  assert.equal(numericSteamId({ appid: 'manual-abc' }), '');
  assert.deepEqual(resolvePlaytimeArtwork({ appid: 'manual-abc', icon: 'hash' }), {
    icon: undefined,
    gameIcon: undefined,
    image: undefined,
  });
});

test('a manual optional Steam AppID remains a valid fallback', () => {
  const artwork = resolvePlaytimeArtwork({ appid: 'manual-abc', steamappid: '123', icon: 'hash' });
  assert.match(artwork.icon, /\/123\/hash\.jpg$/);
  assert.match(artwork.gameIcon, /\/123\/library_600x900\.jpg$/);
  assert.match(artwork.image, /\/123\/header\.jpg$/);
});

test('artwork references reject relative schema tokens but accept URLs and absolute paths', () => {
  assert.equal(usableArtwork('header'), undefined);
  assert.equal(usableArtwork('https://example.test/image.png'), 'https://example.test/image.png');
  assert.equal(usableArtwork('C:\\Games\\cover.png'), 'C:\\Games\\cover.png');
});
