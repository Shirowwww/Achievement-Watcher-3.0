'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const cover = require('../../app/parser/steamdbCover.js');

// SteamDB's app-info assets table: anchors whose href is the (hashed) store_item_assets path.
const ASSETS_TABLE = `
<table id="js-assets-table"><tbody>
  <tr><td>library_hero</td><td><a href="store_item_assets/steam/apps/440/8f9a1b/library_hero.jpg">library_hero.jpg</a></td></tr>
  <tr><td>library_capsule</td><td><a href="store_item_assets/steam/apps/440/8f9a1b/library_capsule.jpg">library_capsule.jpg</a></td></tr>
  <tr><td>library_600x900</td><td><a href="store_item_assets/steam/apps/440/8f9a1b/library_600x900.jpg">library_600x900.jpg</a></td></tr>
</tbody></table>`;

test('coverFromHtml prefers the 600x900 portrait over the wider capsule', () => {
  assert.equal(
    cover.coverFromHtml('440', ASSETS_TABLE),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/440/8f9a1b/library_600x900.jpg'
  );
});

test('coverFromHtml falls back to library_capsule (incl. localized suffixes) when no portrait exists', () => {
  const html = `
    <table id="js-assets-table"><tbody>
      <tr><td><a href="store_item_assets/steam/apps/620/c0ffee/library_capsule_french.jpg">library_capsule_french.jpg</a></td></tr>
    </tbody></table>`;
  assert.equal(
    cover.coverFromHtml('620', html),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/c0ffee/library_capsule_french.jpg'
  );
});

test('coverFromHtml keeps absolute asset URLs as-is and strips the query string', () => {
  const html = '<a href="https://cdn.akamai.steamstatic.com/steam/apps/70/library_600x900.jpg?t=17">cover</a>';
  assert.equal(cover.coverFromHtml('70', html), 'https://cdn.akamai.steamstatic.com/steam/apps/70/library_600x900.jpg');
});

test('coverFromHtml sweeps raw markup when SteamDB reshuffles its assets table', () => {
  const html = '<div data-assets=\'{"cover":"store_item_assets/steam/apps/292030/deadbeef/library_600x900.jpg"}\'></div>';
  assert.equal(
    cover.coverFromHtml('292030', html),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/292030/deadbeef/library_600x900.jpg'
  );
});

test('coverFromHtml returns null when the page holds no library asset', () => {
  assert.equal(cover.coverFromHtml('999', '<html><body><p>no assets here</p></body></html>'), null);
  assert.equal(cover.coverFromHtml('999', ''), null);
});

test('normalizeSteamDbAssetUrl resolves bare filenames against the appid asset root', () => {
  assert.equal(
    cover.normalizeSteamDbAssetUrl('1091500', 'library_600x900.jpg'),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/library_600x900.jpg'
  );
});

test('coversFromHtml collects every library asset, portrait first and deduplicated', () => {
  const html = [
    '<a href="store_item_assets/steam/apps/620/c0ffee/library_capsule_french.jpg">capsule fr</a>',
    '<a href="store_item_assets/steam/apps/620/c0ffee/library_600x900.jpg">portrait</a>',
    '<a href="store_item_assets/steam/apps/620/c0ffee/library_capsule.jpg">capsule</a>',
    '<a href="store_item_assets/steam/apps/620/c0ffee/library_600x900.jpg">dupe</a>',
  ].join('');
  const urls = cover.coversFromHtml('620', html);
  assert.ok(urls.includes('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/c0ffee/library_600x900.jpg'));
  assert.ok(urls.includes('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/c0ffee/library_capsule_french.jpg'));
  assert.equal(urls.length, 3, 'duplicates are removed');
});

test('coversFromHtml returns an empty list when nothing matches', () => {
  assert.deepEqual(cover.coversFromHtml('999', '<html><body><p>nothing</p></body></html>'), []);
  assert.deepEqual(cover.coversFromHtml('999', ''), []);
});
