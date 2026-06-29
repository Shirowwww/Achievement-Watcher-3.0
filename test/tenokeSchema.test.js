'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const goldberg = require('../app/parser/goldberg.js');
const steam = require('../app/parser/steam.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tenoke-schema-'));

try {
  const gameDir = path.join(tmp, 'Strange Antiquities');
  const dllDir = path.join(gameDir, 'Strange Antiquities_Data', 'Plugins', 'x86_64');
  fs.mkdirSync(dllDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'Strange Antiquities.exe'), 'exe');
  fs.writeFileSync(path.join(dllDir, 'steam_api64.dll'), 'dll');
  fs.writeFileSync(
    path.join(dllDir, 'tenoke.ini'),
    [
      '[TENOKE]',
      'id = 2885870 # Strange Antiquities',
      '',
      '[ACHIEVEMENTS.businessAsUnusual]',
      'icon = "1903.jpg"',
      'icon_gray = "gray.jpg"',
      'hidden = "0"',
      '',
      '[ACHIEVEMENTS.felinePriorities]',
      'icon = "cat.jpg"',
      'icon_gray = "gray.jpg"',
      'hidden = "0"',
      'progress_min = 0.0',
      'progress_max = 30.0',
      '',
      '[ACHIEVEMENTS.businessAsUnusual.name]',
      'english = "Business as Unusual"',
      '',
      '[ACHIEVEMENTS.businessAsUnusual.desc]',
      'english = "Handle your first customer"',
      '',
      '[ACHIEVEMENTS.felinePriorities.name]',
      'english = "Feline Priorities"',
      '',
      '[ACHIEVEMENTS.felinePriorities.desc]',
      'english = "Pet Jupiter 30 times"',
    ].join('\n')
  );

  const found = goldberg.findCompatibleGames([tmp]);
  assert.equal(found.length, 1);
  assert.equal(found[0].appid, '2885870');
  assert.equal(found[0].gameDir, gameDir);

  const schema = steam.getLocalAchievementSchema(gameDir, '2885870', 'english');
  assert.equal(schema.length, 2);
  assert.equal(schema[0].name, 'businessAsUnusual');
  assert.equal(schema[0].displayName, 'Business as Unusual');
  assert.equal(schema[0].description, 'Handle your first customer');
  assert.equal(schema[0].icon, 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/2885870/1903.jpg');
  assert.equal(schema[1].max_progress, 30);

  console.log('PASS: TENOKE appid + local achievement schema');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
