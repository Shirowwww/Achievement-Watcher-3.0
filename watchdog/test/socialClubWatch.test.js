'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findIndexedSocialClubGame, gameFolderName, socialClubSlug, SOCIALCLUB_ACHIEVEMENT_FILES } = require('../util/socialClub.js');

function indexFile(dir, entries) {
  const file = path.join(dir, 'gameIndex.json');
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

test('a changed file deep inside a SocialClub profile maps back to its indexed game', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sc-watch-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const root = path.join(tmp, 'Goldberg SocialClub Emu Saves');
  const index = indexFile(tmp, [
    { appid: 'socialclub-rdr2', name: 'Red Dead Redemption 2', source: 'Goldberg SocialClub', steamappid: '1174180' },
    { appid: '271590', name: 'RDR2', source: 'Steam' }, // unrelated source must never match
  ]);

  // The library entry is titled with the RESOLVED Steam name while the folder keeps the emulator's
  // own name, so matching on the title alone never fires — the slug derived from the folder does.
  const changed = path.join(root, 'RDR2', '0F74F4C4', 'achievements.json');
  const found = findIndexedSocialClubGame(root, changed, { files: [index] });
  assert.ok(found, 'entry is found through the socialclub-<slug> appid, not the display name');
  assert.equal(found.appid, 'socialclub-rdr2');
  assert.equal(found.steamappid, '1174180');

  // An unknown game folder or a missing index must resolve to nothing (caller skips, never crashes).
  assert.equal(findIndexedSocialClubGame(root, path.join(root, 'Mystery Game', '0F74F4C4'), { files: [index] }), null);
  assert.equal(findIndexedSocialClubGame(root, changed, { files: [path.join(tmp, 'missing.json')] }), null);
  assert.equal(findIndexedSocialClubGame(root, path.join(tmp, 'outside'), { files: [index] }), null);
});

test('the display name still matches when it equals the folder name', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sc-watch-name-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const root = path.join(tmp, 'Goldberg SocialClub Emu Saves');
  const index = indexFile(tmp, [{ appid: 'legacy-id', name: 'GTA V', source: 'Goldberg SocialClub', steamappid: '271590' }]);

  const found = findIndexedSocialClubGame(root, path.join(root, 'gta v', '0F74F4C4', 'stats.json'), { files: [index] });
  assert.ok(found, 'matching is case-insensitive like the Windows filesystem');
  assert.equal(found.appid, 'legacy-id');
});

test('the game folder is resolved whether the root or a single game folder is watched', () => {
  const root = 'C:\\Users\\me\\AppData\\Roaming\\Goldberg SocialClub Emu Saves';

  // Watching the emulator root: the game is the segment right below it.
  assert.equal(gameFolderName(root, `${root}\\GTA V\\0F74F4C4\\achievements.json`), 'GTA V');

  // Watching one game folder directly (a folder the user added in Settings): the watched directory
  // IS the game, so the first segment below it is the hex profile, not a game name.
  const gameDir = `${root}\\GTA V`;
  assert.equal(gameFolderName(gameDir, `${gameDir}\\0F74F4C4\\achievements.json`), 'GTA V');
  assert.equal(gameFolderName(gameDir, gameDir), 'GTA V');

  // A SocialClub tree relocated outside %APPDATA% still resolves through the root's name.
  assert.equal(gameFolderName('D:\\x', 'D:\\Backups\\Goldberg SocialClub Emu Saves\\Bully\\0A1B2C\\stats.json'), 'Bully');
});

test('the slug matches the app-side socialClubAppId for the same folder name', () => {
  // Both sides derive the id from the folder name; if these ever drift, live unlocks stop resolving.
  const { _internal } = require('../../app/parser/socialclub.js');
  for (const name of ['GTA V', 'Red Dead Redemption 2', 'L.A. Noire', 'Grand Theft Auto: Vice City — Definitive Edition']) {
    assert.equal(socialClubSlug(name), _internal.socialClubAppId(name), `slug mismatch for "${name}"`);
  }
});

test('only decodable achievement files are watched', () => {
  // Rockstar's own save blobs are rewritten constantly during play and nothing can decode them, so
  // watching them would wake the monitor for no possible result.
  assert.ok(SOCIALCLUB_ACHIEVEMENT_FILES.includes('achievements.json'));
  assert.ok(SOCIALCLUB_ACHIEVEMENT_FILES.includes('stats.json'));
  for (const noise of ['cfg.dat', 'SGTA50000', 'SRDR1000', 'pc_settings.bin']) {
    assert.ok(!SOCIALCLUB_ACHIEVEMENT_FILES.includes(noise), `${noise} must not trigger a re-read`);
  }
});
