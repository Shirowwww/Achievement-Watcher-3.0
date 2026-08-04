'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xboxPc = require('../app/parser/xboxPc.js');

test('normalizeTitleId handles decimal and hex forms', () => {
  assert.equal(xboxPc.normalizeTitleId('2476'), '2476');
  assert.equal(xboxPc.normalizeTitleId('0x9AC'), '2476');
  assert.equal(xboxPc.normalizeTitleId('9ac'), ''); // bare hex without prefix is not a decimal id
  assert.equal(xboxPc.normalizeTitleId(''), '');
});

test('extractXboxDirectAuthResult accepts the localhost callback code', () => {
  const result = xboxPc.extractXboxDirectAuthResult(
    'http://localhost:8080/auth/callback?code=abc123&state=xyz',
    'xyz'
  );
  assert.deepEqual(result, { code: 'abc123' });
  assert.equal(xboxPc.extractXboxDirectAuthResult('http://localhost:8080/auth/callback?code=abc123&state=other', 'xyz').error, 'xbox-pc-oauth-state-mismatch');
  assert.equal(xboxPc.extractXboxDirectAuthResult('https://evil.example/cb?code=x', 'xyz'), null);
  assert.equal(xboxPc.extractXboxDirectAuthResult('http://localhost:8080/auth/callback?error=access_denied', '').error, 'access_denied');
});

test('extractXboxDirectAuthResult tolerates a trailing slash on the callback path', () => {
  const result = xboxPc.extractXboxDirectAuthResult(
    'http://localhost:8080/auth/callback/?code=abc123&state=xyz',
    'xyz'
  );
  assert.deepEqual(result, { code: 'abc123' });
  assert.equal(xboxPc.extractXboxDirectAuthResult('http://localhost:8080/other/callback?code=x', 'xyz'), null);
});

test('parseMicrosoftGameConfig reads title id, name, executable and package family', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-xboxcfg-'));
  const file = path.join(dir, 'MicrosoftGame.config');
  fs.writeFileSync(
    file,
    [
      '<Game>',
      '<identity name="Halo" publisher="MS" version="1.0.0.0" titleId="0x9AC"/>',
      '<name>Halo Infinite</name>',
      '<executable>HaloInfinite.exe</executable>',
      '<PackageFamilyName>Microsoft.HaloInfinite_8wekyb3d8bbwe</PackageFamilyName>',
      '<AppId>App</AppId>',
      '</Game>',
    ].join('')
  );
  const parsed = xboxPc.parseMicrosoftGameConfig(file);
  assert.equal(parsed.titleId, '2476');
  assert.equal(parsed.title, 'Halo Infinite');
  assert.equal(parsed.executable, 'HaloInfinite.exe');
  assert.equal(parsed.processName, 'HaloInfinite.exe');
  assert.equal(parsed.installLocation, dir);
  assert.equal(parsed.packageFamilyName, 'Microsoft.HaloInfinite_8wekyb3d8bbwe');
  assert.equal(parsed.aumid, 'Microsoft.HaloInfinite_8wekyb3d8bbwe!App');
});

test('isWindowsPcTitle only keeps PC titles (plus known installed ids)', () => {
  assert.equal(xboxPc.isWindowsPcTitle({ titleId: '123', devices: ['PC', 'XboxOne'] }), true);
  assert.equal(xboxPc.isWindowsPcTitle({ titleId: '123', devices: ['XboxOne'] }), false);
  assert.equal(xboxPc.isWindowsPcTitle({ titleId: '123', devices: ['XboxOne'] }, new Set(['123'])), true);
  // Locally installed titles are always treated as PC titles, even when history lists Win32.
  assert.equal(xboxPc.isWindowsPcTitle({ titleId: '123', devices: ['Win32'] }, new Set(['123'])), true);
});

test('normalizeXboxAchievement extracts earned state, rarity and icon', () => {
  const ach = xboxPc.normalizeXboxAchievement({
    id: '1',
    name: 'First Blood',
    description: 'Kill one enemy',
    progression: { state: 'Achieved', timeUnlocked: 1700000000 },
    rarity: { currentPercentage: 12.5 },
    mediaAssets: [{ mediaType: 'Icon', url: 'https://xbox/icon.png' }],
  });
  assert.equal(ach.id, '1');
  assert.equal(ach.snapshot.earned, true);
  assert.equal(ach.snapshot.earned_time, 1700000000);
  assert.equal(ach.rarity, 12.5);
  assert.equal(ach.icon, 'https://xbox/icon.png');
});

test('getGameData merges cached schema with unlock state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-xboxcache-'));
  xboxPc.setUserDataPath(dir);
  const titleId = '2476';
  const cacheRoot = path.join(dir, 'steam_cache', 'xbox', titleId);
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(
    path.join(cacheRoot, 'schema.json'),
    JSON.stringify({
      titleId,
      name: 'Halo Infinite',
      img: { header: 'https://xbox/header.jpg' },
      achievement: {
        total: 2,
        list: [
          { name: 'a', displayName: 'A', description: 'd', icon: 'i', icongray: 'i' },
          { name: 'b', displayName: 'B', description: 'd', icon: 'i', icongray: 'i' },
        ],
      },
    })
  );
  fs.writeFileSync(path.join(cacheRoot, 'state.json'), JSON.stringify({ a: { earned: true, earned_time: 111 } }));

  const game = await xboxPc.getGameData(titleId, 'english');
  assert.equal(game.name, 'Halo Infinite');
  assert.equal(game.source, 'Xbox PC');
  assert.equal(game.achievement.unlocked, 1);
  assert.equal(game.achievement.list[0].Achieved, true);
  assert.equal(game.achievement.list[0].UnlockTime, 111);
  assert.equal(game.achievement.list[1].Achieved, false);
  assert.equal(await xboxPc.getGameData('999999', 'english'), null);
});
