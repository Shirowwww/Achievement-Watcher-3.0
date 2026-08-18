'use strict';

const assert = require('node:assert/strict');

const ui = require('../../app/util/overlayUi.js');

async function run() {
  // HTML escaping keeps game-provided text from injecting markup into the overlay.
  assert.equal(ui.escapeHtml(`<b>"x" & 'y'</b>`), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(ui.escapeHtml(null), '');
  assert.equal(ui.escapeHtml(0), '0');

  // Localized text: plain strings, per-language objects, English fallback, hidden fallback.
  assert.equal(ui.safeLocalizedText('  Hello  ', 'french', 'Hidden'), 'Hello');
  assert.equal(ui.safeLocalizedText({ french: 'Bonjour', english: 'Hello' }, 'french', 'Hidden'), 'Bonjour');
  assert.equal(ui.safeLocalizedText({ english: 'Hello' }, 'french', 'Hidden'), 'Hello');
  assert.equal(ui.safeLocalizedText(null, 'french', 'Hidden'), 'Hidden');
  assert.equal(ui.safeLocalizedText(42, 'french', 'Hidden'), 'Hidden');

  // App locale ids map to BCP-47 tags for Intl date formatting.
  assert.equal(ui.toBcp47('french'), 'fr-FR');
  assert.equal(ui.toBcp47('brazilian'), 'pt-BR');
  assert.equal(ui.toBcp47('schinese'), 'zh-CN');

  // Timestamps: unix seconds, localized output, N/A fallback.
  assert.equal(ui.formatTimestamp(0, 'english', 'N/A'), 'N/A');
  assert.match(ui.formatTimestamp(1700000000, 'english', 'N/A'), /2023/);
  assert.equal(ui.formatTimestamp('garbage', 'english', 'N/A'), 'N/A');

  // Progress is only shown when meaningful: a MaxProgress without CurProgress on a
  // locked row is a schema artifact and must not render a misleading "0 / 1".
  assert.deepEqual(ui.progressInfo({}), { hasProgress: false, current: 0, max: 0, percent: 0 });
  assert.deepEqual(ui.progressInfo({ MaxProgress: 1 }), { hasProgress: false, current: 0, max: 1, percent: 0 });
  assert.deepEqual(ui.progressInfo({ MaxProgress: 10, CurProgress: 3 }), { hasProgress: true, current: 3, max: 10, percent: 30 });
  assert.deepEqual(ui.progressInfo({ MaxProgress: 10, CurProgress: 3, Achieved: true }), { hasProgress: true, current: 10, max: 10, percent: 100 });
  assert.deepEqual(ui.progressInfo({ MaxProgress: 5, CurProgress: 99 }), { hasProgress: true, current: 5, max: 5, percent: 100 });

  // Rarity: number, decimal-string, object and null shapes.
  assert.equal(ui.rarityPercent({ rarityPercent: 12.5 }), 12.5);
  assert.equal(ui.rarityPercent({ globalPercent: '6,2' }), 6.2);
  assert.equal(ui.rarityPercent({ rarity: { percent: 3 } }), 3);
  assert.equal(ui.rarityPercent({ rarity: 88 }), 88);
  assert.equal(ui.rarityPercent({}), null);
  assert.equal(ui.rarityPercent({ rarity: '' }), null);
  assert.equal(ui.rarityPercent({ rarityPercent: 250 }), 100);
  assert.equal(ui.rarityPercent({}), null);

  // Rarity tiers: shared with the main window - gold <3%, silver <6%, bronze ≤10%, nothing above.
  assert.equal(ui.rarityTier(0), 'gold');
  assert.equal(ui.rarityTier(2.9), 'gold');
  assert.equal(ui.rarityTier(3), 'silver');
  assert.equal(ui.rarityTier(5.9), 'silver');
  assert.equal(ui.rarityTier(6), 'bronze');
  assert.equal(ui.rarityTier(10), 'bronze');
  assert.equal(ui.rarityTier(10.1), null);
  assert.equal(ui.rarityTier(88), null);
  assert.equal(ui.rarityTier(null), null);
  assert.equal(ui.rarityTier('garbage'), null);

  // Sorting: status first when active, then localized title.
  const list = [
    { name: 'b', displayName: 'Zeta', Achieved: true },
    { name: 'a', displayName: 'Alpha', Achieved: false },
    { name: 'c', displayName: 'Beta', Achieved: true },
  ];
  assert.deepEqual(
    ui.sortAchievements(list, { status: -1, achievement: null }, (a) => a.displayName).map((a) => a.name),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    ui.sortAchievements(list, { status: null, achievement: 1 }, (a) => a.displayName).map((a) => a.name),
    ['a', 'c', 'b']
  );
  assert.deepEqual(
    ui.sortAchievements(list, { status: 1, achievement: 1 }, (a) => a.displayName).map((a) => a.name),
    ['a', 'c', 'b']
  );

  // Stats: total/unlocked/locked/in-progress/percent.
  const stats = ui.buildStats([
    { Achieved: true },
    { Achieved: false },
    { Achieved: false, MaxProgress: 10, CurProgress: 4 },
    { Achieved: false, MaxProgress: 1 },
  ]);
  assert.deepEqual(stats, { total: 4, unlocked: 1, locked: 3, progress: 1, percent: 25 });
  assert.deepEqual(ui.buildStats([]), { total: 0, unlocked: 0, locked: 0, progress: 0, percent: 0 });

  console.log('PASS: overlayUi helpers');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
