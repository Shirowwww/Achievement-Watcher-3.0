'use strict';

const assert = require('node:assert/strict');

const exophase = require('../app/parser/exophase.js');

// Offline fixture mirroring the real Exophase award-list markup (one <li> per achievement,
// award-details/award-title/award-description classes, img.award-image icon).
const FIXTURE = `
<ul>
  <li class="col-12 locked t0 award visible" data-award-id="1">
    <div class="row align-items-center">
      <div class="col-auto award-left">
        <div class="box image hidden-toggle">
          <img class="award-image trophy-image visible" src="/steam/awards/s/abc.png?sig" width="64" height="64" />
        </div>
      </div>
      <div class="col award-details snippet">
        <div class="text-medium award-title hidden-toggle"><a href="#">Escaped Tartarus</a></div>
        <div class="award-description hidden-toggle"><p>Clear   Tartarus</p></div>
      </div>
    </div>
  </li>
  <li class="award">
    <div class="award-details">
      <div class="award-title"><a href="#">No Icon Here</a></div>
      <div class="award-description"><p>Second achievement</p></div>
    </div>
  </li>
</ul>`;

(() => {
  // platform mapping: emulator ids map to exophase suffixes, unknown ids pass through
  assert.equal(exophase.mapExophasePlatform('xenia'), 'xbox-360');
  assert.equal(exophase.mapExophasePlatform('rpcs3'), 'ps3');
  assert.equal(exophase.mapExophasePlatform('shadps4'), 'ps4');
  assert.equal(exophase.mapExophasePlatform('Steam'), 'steam');
  assert.equal(exophase.mapExophasePlatform(''), '');

  // slug building: accents stripped, apostrophes and roman numerals get variants
  assert.equal(exophase.buildExophaseSlug('Éléphant Café'), 'elephant-cafe');
  const variants = exophase.buildExophaseSlugVariants("Assassin's Creed IV");
  assert.ok(variants.includes('assassin-s-creed-iv'), `missing apostrophe variant in ${variants}`);
  assert.ok(variants.includes('assassins-creed-4'), `missing roman variant in ${variants}`);
  // "Trophies" suffix (PSN titles) is dropped before slugging
  assert.ok(exophase.buildExophaseSlugVariants('Hades Trophies').includes('hades'));

  // language map is keyed by the Steam API language names used across the app
  assert.equal(exophase.EXOPHASE_LANG_MAP.english, 'us');
  assert.equal(exophase.EXOPHASE_LANG_MAP.french, 'fr');
  assert.ok(exophase.EXOPHASE_LANG_KEYS.includes('schinese'));

  // HTML extraction: titles + collapsed whitespace descriptions + absolute icon URLs
  const items = exophase.extractAchievementsFromHtml(FIXTURE, 'https://www.exophase.com/game/x-steam/achievements/us/');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Escaped Tartarus');
  assert.equal(items[0].description, 'Clear Tartarus');
  assert.equal(items[0].icon_url, 'https://www.exophase.com/steam/awards/s/abc.png?sig');
  assert.equal(items[1].title, 'No Icon Here');
  assert.equal(items[1].icon_url, '');

  // blocked/empty pages extract to nothing instead of throwing
  assert.deepEqual(exophase.extractAchievementsFromHtml('', 'https://x/'), []);

  console.log('PASS: exophase slug/lang/extraction helpers');
})();
