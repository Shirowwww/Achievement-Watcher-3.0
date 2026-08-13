'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const ssf = require('../../app/util/steamSchemaFetch.js');

test('mapOfficialAchievements maps the full AW shape with rarity', () => {
  const entries = ssf.mapOfficialAchievements(
    {
      achievements: [
        {
          internal_name: 'ACH_FIRST',
          localized_name: 'First!',
          localized_desc: 'Do the thing.',
          hidden: true,
          icon: 'abc.jpg',
          icon_gray: 'abc_gray.jpg',
          player_percent_unlocked: '40.5',
        },
        {
          internal_name: 'ACH_SECOND',
          localized_name: 'Second',
          localized_desc: '',
          hidden: false,
          icon: 'def.jpg',
          icon_gray: 'def_gray.jpg',
          player_percent_unlocked: '2.25',
        },
      ],
    },
    440
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: 'ACH_FIRST',
    defaultvalue: 0,
    displayName: 'First!',
    hidden: 1,
    description: 'Do the thing.',
    icon: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/440/abc.jpg',
    icongray: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/440/abc_gray.jpg',
    rarityPercent: 40.5,
  });
  assert.equal(entries[1].hidden, 0);
  assert.equal(entries[1].rarityPercent, 2.25);
});

test('mapOfficialAchievements treats a missing array as zero achievements and guards missing icons', () => {
  assert.deepEqual(ssf.mapOfficialAchievements({ groups: [] }, 440), []);
  assert.deepEqual(ssf.mapOfficialAchievements({ achievements: [{ internal_name: 'X' }] }, 440), [
    {
      name: 'X',
      defaultvalue: 0,
      displayName: undefined,
      hidden: 0,
      description: '',
      icon: '',
      icongray: '',
      rarityPercent: null,
    },
  ]);
});

test('mapSteamHuntersJson maps apiName/description/rarity and no icons', () => {
  const entries = ssf.mapSteamHuntersJson([
    {
      achievementId: 1,
      apiName: 'TF_DAMAGE',
      name: 'Iron Kurtain',
      description: 'Take damage.',
      steamPercentage: 40.2,
    },
  ]);
  assert.deepEqual(entries[0], {
    name: 'TF_DAMAGE',
    defaultvalue: 0,
    displayName: 'Iron Kurtain',
    hidden: 0,
    description: 'Take damage.',
    icon: '',
    icongray: '',
    rarityPercent: 40.2,
  });
  assert.deepEqual(ssf.mapSteamHuntersJson(null), []);
});

test('mapSteamHuntersJson falls back to estimatedSteamPercentage when Steam has no percentage yet', () => {
  const entries = ssf.mapSteamHuntersJson([
    { apiName: 'A1', name: 'New', description: 'Fresh', steamPercentage: null, estimatedSteamPercentage: 12.5 },
    { apiName: 'A2', name: 'Old', description: 'Measured', steamPercentage: 7, estimatedSteamPercentage: 99 },
  ]);
  assert.equal(entries[0].rarityPercent, 12.5);
  assert.equal(entries[1].rarityPercent, 7);
});

test('parseSteamCommunityRows extracts icon hash, full URL, title and description', () => {
  const html = `
    <div class="achieveRow">
      <div class="achieveImgHolder">
        <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/440/hash1.jpg" />
      </div>
      <div class="achieveTxt"><h3>Public One</h3><h5>Visible text.</h5></div>
    </div>
    <div class="achieveRow">
      <div class="achieveImgHolder">
        <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/440/hash2.jpg" />
      </div>
      <div class="achieveTxt"><h3>Hidden One</h3><h5>  </h5></div>
    </div>
    <div class="achieveRow">
      <div class="achieveImgHolder">
        <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/440/hash3.jpg" />
      </div>
      <div class="achieveTxt"><h5>No title, skipped</h5></div>
    </div>`;
  const rows = ssf.parseSteamCommunityRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].img, 'hash1');
  assert.equal(rows[0].icon, 'https://shared.fastly.steamstatic.com/community_assets/images/apps/440/hash1.jpg');
  assert.equal(rows[0].title, 'Public One');
  assert.equal(rows[0].description, 'Visible text.');
  assert.equal(rows[1].description, '');
  assert.deepEqual(ssf.parseSteamCommunityRows('<html></html>'), []);
  assert.deepEqual(ssf.parseSteamCommunityRows(''), []);
});

test('stripHtml removes nested tags without leaving executable markup behind', () => {
  assert.equal(ssf.stripHtml('<b>Visible</b> <scrip<script>alert(1)</script>&nbsp;'), 'Visible alert(1)');
});

test('mergeSteamHuntersWithCommunity fills icons and detects hidden via matched titles', () => {
  const sh = [
    { apiName: 'A1', name: 'Public One', description: 'SH desc', steamPercentage: 10 },
    { apiName: 'A2', name: 'Hidden One', description: 'SH hidden desc', steamPercentage: 1 },
  ];
  const rows = [
    { icon: 'https://cdn.example/a1.jpg', title: 'Public One', description: 'Visible text.' },
    { icon: 'https://cdn.example/a2.jpg', title: 'Hidden One', description: '' },
  ];
  const merged = ssf.mergeSteamHuntersWithCommunity(sh, rows);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].icon, 'https://cdn.example/a1.jpg');
  assert.equal(merged[0].hidden, 0);
  // SteamHunters descriptions win; hidden desc is preserved from SH even though the page blanks it.
  assert.equal(merged[1].hidden, 1);
  assert.equal(merged[1].description, 'SH hidden desc');
  assert.equal(merged[1].icon, 'https://cdn.example/a2.jpg');
});

test('merge fallback position row only contributes an icon, never hidden/description', () => {
  const merged = ssf.mergeSteamHuntersWithCommunity(
    [{ apiName: 'A1', name: 'No Match', description: 'SH desc' }],
    [{ icon: 'https://cdn.example/x.jpg', title: 'Different Game', description: '' }]
  );
  assert.equal(merged[0].icon, 'https://cdn.example/x.jpg');
  assert.equal(merged[0].hidden, 0);
  assert.equal(merged[0].description, 'SH desc');
});

test('parseSteamHuntersGroups normalizes DLC/update groups', () => {
  const groups = ssf.parseSteamHuntersGroups({
    groupBy: 'dlcandupdate',
    groups: [
      { dlcAppId: 378649, dlcAppName: 'The Witcher 3: Wild Hunt - Hearts of Stone', achievementApiNames: ['EP1_1', 'EP1_2'] },
      { name: 'The Doomsday Heist', achievementApiNames: ['ACHGO1'] },
      { name: 'Untagged', achievementApiNames: [] },
      null,
    ],
  });
  assert.deepEqual(groups, [
    { name: 'The Witcher 3: Wild Hunt - Hearts of Stone', dlcAppId: 378649, apiNames: ['EP1_1', 'EP1_2'] },
    { name: 'The Doomsday Heist', dlcAppId: 0, apiNames: ['ACHGO1'] },
  ]);
});

test('applySteamHuntersGroups tags entries by apiName without touching others or existing categories', () => {
  const entries = [
    { name: 'ep1_1', displayName: 'Hearts of Stone One' },
    { name: 'EP1_2', displayName: 'Hearts of Stone Two' },
    { name: 'BASE_1', displayName: 'Base Game' },
    { name: 'EP1_1', displayName: 'Duplicate already tagged', category: 'Manual' },
  ];
  const tagged = ssf.applySteamHuntersGroups(entries, {
    groups: [
      { dlcAppId: 378649, dlcAppName: 'The Witcher 3: Wild Hunt - Hearts of Stone', achievementApiNames: ['EP1_1', 'EP1_2'] },
    ],
  });
  assert.equal(tagged[0].category, 'The Witcher 3: Wild Hunt - Hearts of Stone');
  assert.equal(tagged[1].category, 'The Witcher 3: Wild Hunt - Hearts of Stone');
  assert.equal(tagged[2].category, undefined);
  assert.equal(tagged[3].category, 'Manual');
  // The source entries are not mutated.
  assert.equal(entries[0].category, undefined);
});

test('applySteamHuntersGroups handles missing/empty inputs', () => {
  assert.deepEqual(ssf.applySteamHuntersGroups([{ name: 'A' }], { groups: [] }), [{ name: 'A' }]);
  assert.deepEqual(ssf.applySteamHuntersGroups(null, { groups: [] }), null);
});

test('mapSteamCommunityRows is the degraded fallback: title as name, blank desc means hidden', () => {
  const rows = [
    { icon: 'https://cdn.example/a.jpg', title: 'Visible', description: 'Text' },
    { icon: 'https://cdn.example/b.jpg', title: 'Secret', description: '' },
  ];
  const entries = ssf.mapSteamCommunityRows(rows);
  assert.deepEqual(entries[0], {
    name: 'Visible',
    defaultvalue: 0,
    displayName: 'Visible',
    hidden: 0,
    description: 'Text',
    icon: 'https://cdn.example/a.jpg',
    icongray: '',
  });
  assert.equal(entries[1].hidden, 1);
});

test('iconKey extracts a stable hash from a full URL or bare filename', () => {
  assert.equal(ssf.iconKey('https://cdn.example/apps/440/abc123.jpg'), 'abc123');
  assert.equal(ssf.iconKey('https://cdn.example/apps/440/abc123.png'), 'abc123');
  assert.equal(ssf.iconKey('abc123'), 'abc123');
  assert.equal(ssf.iconKey(''), '');
  assert.equal(ssf.iconKey(null), '');
});

test('buildApiNameIndex keys apiNames by both icon and icongray hash', () => {
  const index = ssf.buildApiNameIndex([
    { name: 'ACH_FIRST', icon: 'https://cdn.example/a.jpg', icongray: 'https://cdn.example/a_gray.jpg' },
    { name: 'ACH_SECOND', icon: 'https://cdn.example/b.jpg', icongray: '' },
    { name: 'ACH_NO_ICON' },
  ]);
  assert.deepEqual(index, {
    a: 'ACH_FIRST',
    a_gray: 'ACH_FIRST',
    b: 'ACH_SECOND',
  });
});

test('buildApiNameIndex drops a hash shared by two different achievements instead of guessing', () => {
  // Cheap/low-effort games sometimes reuse one generic icon for several achievements. Picking either
  // name would be a coin flip that can mislabel a real unlock, so neither is kept.
  const index = ssf.buildApiNameIndex([
    { name: 'ACH_A', icon: 'https://cdn.example/shared.jpg' },
    { name: 'ACH_B', icon: 'https://cdn.example/shared.jpg' },
    { name: 'ACH_C', icon: 'https://cdn.example/unique.jpg' },
  ]);
  assert.deepEqual(index, { unique: 'ACH_C' });
});

test('buildApiNameIndex tolerates the same achievement listed twice (harmless, not ambiguous)', () => {
  const index = ssf.buildApiNameIndex([
    { name: 'ACH_A', icon: 'https://cdn.example/a.jpg' },
    { name: 'ACH_A', icon: 'https://cdn.example/a.jpg' },
  ]);
  assert.deepEqual(index, { a: 'ACH_A' });
});

test('buildApiNameIndex tolerates non-array input', () => {
  assert.deepEqual(ssf.buildApiNameIndex(null), {});
  assert.deepEqual(ssf.buildApiNameIndex(undefined), {});
});

test('applyApiNameIndex recovers real apiNames for the degraded SteamCommunity-only fallback', () => {
  const degraded = ssf.mapSteamCommunityRows([
    { icon: 'https://cdn.example/a.jpg', title: 'Public One', description: 'Text' },
    { icon: 'https://cdn.example/unknown.jpg', title: 'Never Resolved Before', description: '' },
  ]);
  const index = { a: 'ACH_FIRST' };
  const recovered = ssf.applyApiNameIndex(degraded, index);
  assert.equal(recovered[0].name, 'ACH_FIRST');
  // Unindexed entries keep their title-based placeholder name unchanged, not worse than before.
  assert.equal(recovered[1].name, 'Never Resolved Before');
  // Original entries are not mutated.
  assert.equal(degraded[0].name, 'Public One');
});

test('applyApiNameIndex is a no-op when there is no index yet', () => {
  const degraded = ssf.mapSteamCommunityRows([{ icon: 'https://cdn.example/a.jpg', title: 'X', description: '' }]);
  assert.deepEqual(ssf.applyApiNameIndex(degraded, null), degraded);
  assert.deepEqual(ssf.applyApiNameIndex(degraded, {}), degraded);
});

test('toRarityPercent handles numeric strings, numbers and blanks', () => {
  assert.equal(ssf.toRarityPercent('12.5'), 12.5);
  assert.equal(ssf.toRarityPercent(7), 7);
  assert.equal(ssf.toRarityPercent(''), null);
  assert.equal(ssf.toRarityPercent(undefined), null);
  assert.equal(ssf.toRarityPercent('nope'), null);
});
