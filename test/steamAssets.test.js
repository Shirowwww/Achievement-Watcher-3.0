'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const steamAssets = require('../app/util/steamAssets.js');

(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-assets-'));
  try {
    // fixture mirroring a GBE steam_settings/steam_misc/app_info/app_product_info.json dump
    const settingsDir = path.join(tmp, 'steam_settings');
    const infoDir = path.join(settingsDir, 'steam_misc', 'app_info');
    fs.mkdirSync(infoDir, { recursive: true });
    fs.writeFileSync(
      path.join(infoDir, 'app_product_info.json'),
      JSON.stringify({
        common: {
          header_image: { english: 'header.jpg' },
          library_assets: { library_capsule: 'en', library_header: 'en', library_hero: 'en' },
          library_assets_full: {
            library_capsule: {
              image: { english: 'en/library_600x900.jpg', french: 'fr/library_600x900.jpg' },
              image2x: { english: 'en/library_600x900_2x.jpg' },
            },
            library_header: { image: { english: 'en/library_header.jpg' } },
            library_hero: { image: { english: 'https://cdn.example.com/hero.jpg' } },
          },
        },
      })
    );

    // path resolution from the steam_settings dir
    const infoPath = steamAssets.resolveProductInfoPath({ configPath: settingsDir });
    assert.equal(infoPath, path.join(path.resolve(settingsDir), 'steam_misc', 'app_info', 'app_product_info.json'));

    // portrait: localized value wins, relative values expand on the shared CDNs
    const fr = steamAssets.resolveSteamProductAssetUrls({ appid: 1145360, configPath: settingsDir, purpose: 'portrait', language: 'french' });
    assert.equal(fr.ok, true);
    assert.equal(fr.urls[0], 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/fr/library_600x900.jpg');
    assert.ok(fr.urls.some((u) => u.includes('cloudflare')), 'expected a cloudflare fallback');
    // subdir values must NOT expand on the legacy CDNs (they only serve root basenames)
    assert.ok(!fr.urls.some((u) => u.includes('akamai') && u.includes('fr/library_600x900.jpg')));
    // flag-derived root basenames DO get legacy CDN fallbacks
    assert.ok(fr.urls.some((u) => u.includes('akamai') && u.endsWith('library_600x900.jpg')));

    // unknown language falls back to english
    const xx = steamAssets.resolveSteamProductAssetUrls({ appid: 1145360, configPath: settingsDir, purpose: 'portrait', language: 'klingon' });
    assert.ok(xx.urls[0].includes('en/library_600x900.jpg'));

    // hero: absolute URLs pass through untouched and first
    const hero = steamAssets.resolveSteamProductAssetUrls({ appid: 1145360, configPath: settingsDir, purpose: 'hero' });
    assert.equal(hero.urls[0], 'https://cdn.example.com/hero.jpg');

    // header purpose collects library_header + header_image
    const header = steamAssets.resolveSteamProductAssetUrls({ appid: 1145360, configPath: settingsDir, purpose: 'header' });
    assert.ok(header.ok && header.urls.some((u) => u.endsWith('/en/library_header.jpg')));

    // failure modes are reported, never thrown
    assert.equal(steamAssets.resolveSteamProductAssetUrls({ appid: 'abc', configPath: settingsDir }).reason, 'invalid-appid');
    assert.equal(steamAssets.resolveSteamProductAssetUrls({ appid: 42, configPath: path.join(tmp, 'nope') }).reason, 'product-info-missing');

    // non-image values are rejected at collect time (buildSteamAssetUrls itself doesn't filter)
    const collected = steamAssets.collectSteamProductAssetValues(
      { common: { library_assets_full: { library_hero: { image: { english: 'movie.mp4' } } } } },
      'hero',
      'english'
    );
    assert.deepEqual(collected, []);
    assert.deepEqual(steamAssets.buildSteamAssetUrls(42, ['']), []);
    assert.deepEqual(steamAssets.buildSteamAssetUrls('not-an-appid', ['header.jpg']), []);

    console.log('PASS: steamAssets resolves local product-info covers');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
