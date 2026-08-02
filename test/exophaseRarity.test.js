'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exophase = require('../app/parser/exophase.js');

const FIXTURE = `
<ul>
  <li class="award">
    <div class="award-image"><img src="/img/a.png" /></div>
    <div class="award-detail">
      <div class="award-title">Kill 10 enemies</div>
      <div class="award-description"><p>Defeat ten foes</p></div>
    </div>
    <div class="award-average text-center"><span data-rarity="12.5%">12.5%</span></div>
  </li>
  <li class="award">
    <div class="award-image"><img src="/img/b.png" /></div>
    <div class="award-detail">
      <div class="award-title">Finish the game</div>
      <div class="award-description"><p>Complete the story</p></div>
    </div>
    <div class="award-average text-center"><span data-rarity="3.25%">3.25%</span></div>
  </li>
</ul>`;

test('extractAchievementsFromHtml reads the per-card rarity', () => {
  const items = exophase.extractAchievementsFromHtml(FIXTURE, 'https://www.exophase.com/game/x/');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Kill 10 enemies');
  assert.equal(items[0].rarityPct, 12.5);
  assert.equal(items[0].raritySource, 'exophase');
  assert.equal(items[1].rarityPct, 3.25);
});

test('matchExophaseRarityToAchievements maps awards back to schema ids', () => {
  const items = [
    { titles: { english: 'Kill 10 enemies' }, descriptions: { english: 'Defeat ten foes' }, rarityPct: 12.5 },
    { titles: { english: 'Finish the game' }, descriptions: { english: 'Complete the story' }, rarityPct: 3.25 },
  ];
  const achievements = [
    { name: '0', displayName: 'Kill 10 enemies', description: 'Defeat ten foes' },
    { name: '1', displayName: 'Finish the game', description: 'Complete the story' },
    { name: '2', displayName: 'Untracked', description: 'Not on Exophase' },
  ];
  const entries = exophase.matchExophaseRarityToAchievements(achievements, items);
  assert.deepEqual(entries, [
    { name: '0', percent: 12.5 },
    { name: '1', percent: 3.25 },
  ]);
});

test('rarity percent normalizer tolerates text and commas', () => {
  assert.equal(exophase.normalizeExophaseRarityPct('12,5%'), 12.5);
  assert.equal(exophase.normalizeExophaseRarityPct(' 4.2% of players '), 4.2);
  assert.equal(exophase.normalizeExophaseRarityPct('n/a'), null);
  assert.equal(exophase.normalizeExophaseRarityPct(7), 7);
});

test('slug candidates cover ps3/psn and ps4 suffixes', () => {
  const rpcs3 = exophase.buildExophaseRaritySlugCandidates('God of War III', 'rpcs3');
  assert.ok(rpcs3.includes('god-of-war-iii'));
  assert.ok(rpcs3.includes('god-of-war-iii-ps3'));
  assert.ok(rpcs3.includes('god-of-war-iii-psn'));
  const shadps4 = exophase.buildExophaseRaritySlugCandidates('Bloodborne', 'shadps4');
  assert.ok(shadps4.includes('bloodborne-ps4'));
  const xenia = exophase.buildExophaseRaritySlugCandidates('Halo 3', 'xenia');
  assert.ok(xenia.includes('halo-3'));
  assert.ok(!xenia.includes('halo-3-ps3'));
});
