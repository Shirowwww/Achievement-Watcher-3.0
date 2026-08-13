'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const steam = require('../steam.js');
const ssf = require('../../app/util/steamSchemaFetch.js');

test('watchdog official mapper keeps hidden descriptions and rarity', () => {
  const entries = steam._internal.mapOfficialAchievements(
    {
      achievements: [
        {
          internal_name: 'ACH_X',
          localized_name: 'Secret',
          localized_desc: 'Real hidden text.',
          hidden: true,
          icon: 'x.jpg',
          icon_gray: 'x_gray.jpg',
          player_percent_unlocked: '3.3',
        },
      ],
    },
    730
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hidden, 1);
  assert.equal(entries[0].description, 'Real hidden text.');
  assert.equal(entries[0].rarityPercent, 3.3);
  assert.equal(entries[0].icon, 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/730/x.jpg');
});

test('watchdog official mapper returns [] for zero-achievement games instead of throwing', () => {
  assert.deepEqual(steam._internal.mapOfficialAchievements({ groups: [] }, 391540), []);
});

test('watchdog SteamHunters mapper keeps apiName/description/rarity', () => {
  const entries = steam._internal.mapSteamHuntersJson([
    { apiName: 'T1', name: 'Title', description: 'Desc', steamPercentage: 42 },
  ]);
  assert.equal(entries[0].name, 'T1');
  assert.equal(entries[0].displayName, 'Title');
  assert.equal(entries[0].rarityPercent, 42);
  assert.equal(entries[0].icon, '');
  assert.deepEqual(steam._internal.mapSteamHuntersJson(null), []);
});

test('watchdog SteamHunters mapper falls back to estimatedSteamPercentage', () => {
  const entries = steam._internal.mapSteamHuntersJson([
    { apiName: 'T1', name: 'Fresh', description: 'Desc', estimatedSteamPercentage: 3.25 },
  ]);
  assert.equal(entries[0].rarityPercent, 3.25);
});

test('watchdog SteamCommunity parser extracts rows and skips empty titles', () => {
  const html = `
    <div class="achieveRow">
      <div class="achieveImgHolder"><img src="https://cdn.example/a1.jpg" /></div>
      <div class="achieveTxt"><h3>Visible</h3><h5>Text here.</h5></div>
    </div>
    <div class="achieveRow">
      <div class="achieveImgHolder"><img src="https://cdn.example/a2.jpg" /></div>
      <div class="achieveTxt"><h3>Secret</h3><h5>   </h5></div>
    </div>
    <div class="achieveRow"><div class="achieveImgHolder"><img src="https://cdn.example/x.jpg" /></div></div>`;
  const rows = steam._internal.parseSteamCommunityRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Visible');
  assert.equal(rows[0].description, 'Text here.');
  assert.equal(rows[0].icon, 'https://cdn.example/a1.jpg');
  assert.equal(rows[1].description, '');
  assert.deepEqual(steam._internal.parseSteamCommunityRows('<html></html>'), []);
});

test('watchdog SteamCommunity merge fills icons and hidden only on matched titles', () => {
  const sh = [
    { apiName: 'A1', name: 'Visible', description: 'SH desc', steamPercentage: 10 },
    { apiName: 'A2', name: 'Secret', description: 'SH hidden desc', steamPercentage: 1 },
    { apiName: 'A3', name: 'No Match', description: '', steamPercentage: 0 },
  ];
  const rows = [
    { title: 'Visible', description: 'Page text', icon: 'https://cdn.example/a1.jpg' },
    { title: 'Secret', description: '', icon: 'https://cdn.example/a2.jpg' },
  ];
  const merged = steam._internal.mergeSteamHuntersWithCommunity(sh, rows);
  assert.equal(merged[0].icon, 'https://cdn.example/a1.jpg');
  assert.equal(merged[0].hidden, 0);
  assert.equal(merged[0].description, 'SH desc');
  assert.equal(merged[1].hidden, 1);
  assert.equal(merged[1].description, 'SH hidden desc');
  assert.equal(merged[2].icon, '');
});

test('watchdog keyless chain localizes SteamHunters titles via English rows + icon-hash overlay', () => {
  const sh = [
    { apiName: 'A1', name: 'Friend in Need', description: 'Join a faction.', steamPercentage: 19.8 },
    { apiName: 'A2', name: 'Hidden One', description: 'Secret text.', steamPercentage: 1.2 },
  ];
  const englishRows = [
    { img: 'hash1', icon: 'https://cdn.example/hash1.jpg', title: 'Friend in Need', description: 'Join a faction.' },
    { img: 'hash2', icon: 'https://cdn.example/hash2.jpg', title: 'Hidden One', description: '' },
  ];
  // Step 1: English SteamCommunity page merges icons + hidden by English title.
  const merged = steam._internal.mergeSteamHuntersWithCommunity(sh, englishRows);
  assert.equal(merged[0].icon, 'https://cdn.example/hash1.jpg');
  assert.equal(merged[1].hidden, 1);
  assert.equal(merged[1].description, 'Secret text.'); // SteamHunters text is kept
  // Step 2: the localized page overlays titles/descriptions by icon hash (language-independent).
  const localizedRows = [
    { img: 'hash1', icon: 'https://cdn.example/hash1.jpg', title: 'Ami dans le besoin', description: 'Rejoindre une faction.' },
    { img: 'hash2', icon: 'https://cdn.example/hash2.jpg', title: 'Succès caché', description: '' },
  ];
  steam._internal.mergeTranslatedAchievements(merged, localizedRows);
  assert.equal(merged[0].displayName, 'Ami dans le besoin');
  assert.equal(merged[0].description, 'Rejoindre une faction.');
  // Hidden description must never be replaced by the page's intentional blank.
  assert.equal(merged[1].description, 'Secret text.');
});

test('watchdog mappers are the shared app module (no private fork to drift)', () => {
  assert.equal(steam._internal.mapOfficialAchievements, ssf.mapOfficialAchievements);
  assert.equal(steam._internal.mapSteamHuntersJson, ssf.mapSteamHuntersJson);
  assert.equal(steam._internal.parseSteamCommunityRows, ssf.parseSteamCommunityRows);
  assert.equal(steam._internal.mergeSteamHuntersWithCommunity, ssf.mergeSteamHuntersWithCommunity);
  assert.equal(steam._internal.toRarityPercent, ssf.toRarityPercent);
});

test('watchdog rarity conversion handles blanks', () => {
  assert.equal(steam._internal.toRarityPercent(''), null);
  assert.equal(steam._internal.toRarityPercent('1.5'), 1.5);
});

test('watchdog distinguishes a verified empty schema from a total network outage', async () => {
  const realFetch = global.fetch;
  try {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ response: {} }) };
    };
    assert.deepEqual(await steam._internal.getAchievementsKeyless('391540', 'english'), []);
    assert.equal(calls, 1, 'a verified empty official response must not fall through');

    global.fetch = async () => {
      throw new Error('offline');
    };
    assert.equal(await steam._internal.getAchievementsKeyless('391540', 'english'), null);
  } finally {
    global.fetch = realFetch;
  }
});

test('watchdog falls back to SteamCommunity when both apiName sources are unavailable', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => {
      calls += 1;
      if (calls <= 2) throw new Error('api unavailable');
      return {
        ok: true,
        text: async () => `
          <div class="achieveRow">
            <div class="achieveImgHolder"><img src="https://cdn.example/community-only.jpg" /></div>
            <div class="achieveTxt"><h3>Community Only</h3><h5>Recovered text.</h5></div>
          </div>`,
      };
    };
    const achievements = await steam._internal.getAchievementsKeyless('391540', 'english');
    assert.equal(achievements.length, 1);
    assert.equal(achievements[0].displayName, 'Community Only');
    assert.equal(achievements[0].description, 'Recovered text.');
  } finally {
    global.fetch = realFetch;
  }
});
