'use strict';

// getLocalAchievementSchema falls back to the emulator's own steam_settings/achievements.json
// (Goldberg / GBE Fork) when there is no TENOKE schema — so cracked, brand-new titles that aren't on
// SteamHunters yet still surface their real achievement names/descriptions/icons offline.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const steam = require('../app/parser/steam.js');

function gameDirWith(achievementsJson) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gbe-schema-'));
  const settings = path.join(tmp, 'game', 'steam_settings');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(path.join(settings, 'achievements.json'), JSON.stringify(achievementsJson));
  return path.join(tmp, 'game');
}

test('reads a GBE-Fork achievements.json (localized fields) into AW schema shape', () => {
  const dir = gameDirWith([
    {
      name: 'ACH_WIN',
      displayName: { english: 'Winner', french: 'Gagnant' },
      description: { english: 'Win the game', french: 'Gagner la partie' },
      hidden: '0',
      icon: 'images/aabbcc.jpg',
      icon_gray: 'images/aabbcc_gray.jpg',
    },
  ]);
  const schema = steam.getLocalAchievementSchema(dir, '3751950', 'french');
  assert.equal(schema.length, 1);
  assert.equal(schema[0].name, 'ACH_WIN');
  assert.equal(schema[0].displayName, 'Gagnant');
  assert.equal(schema[0].description, 'Gagner la partie');
  assert.equal(schema[0].hidden, 0);
  // Icon is resolved to the community CDN using the basename of whatever the emulator recorded.
  assert.equal(
    schema[0].icon,
    'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/3751950/aabbcc.jpg'
  );
  assert.equal(
    schema[0].icongray,
    'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/3751950/aabbcc_gray.jpg'
  );
});

test('handles plain-string fields and hidden coercion', () => {
  const dir = gameDirWith([
    { name: 'A', displayName: 'Alpha', description: 'first', hidden: 1, icon: 'x.jpg' },
    { name: 'B', displayName: 'Beta', description: '', hidden: '1', icon: '' },
  ]);
  const schema = steam.getLocalAchievementSchema(dir, '100', 'english');
  assert.equal(schema.length, 2);
  assert.equal(schema[0].displayName, 'Alpha');
  assert.equal(schema[0].hidden, 1);
  assert.equal(schema[1].hidden, 1);
  assert.equal(schema[1].icon, '');
});

test('ignores a Goldberg SAVE file (object, not array) and returns []', () => {
  // The unlock-state file has the same name but is an object keyed by apiname — never a schema.
  const dir = gameDirWith({ ACH_WIN: { earned: true, earned_time: 123 } });
  assert.deepEqual(steam.getLocalAchievementSchema(dir, '3751950', 'english'), []);
});

test('returns [] when neither TENOKE nor achievements.json exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gbe-empty-'));
  fs.mkdirSync(path.join(tmp, 'game'), { recursive: true });
  assert.deepEqual(steam.getLocalAchievementSchema(path.join(tmp, 'game'), '3751950', 'english'), []);
});
