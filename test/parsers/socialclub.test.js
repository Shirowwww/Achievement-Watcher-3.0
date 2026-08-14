'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-socialclub-'));
const originalAppData = process.env.APPDATA;
process.env.APPDATA = tmp;
fs.mkdirSync(path.join(tmp, 'Achievement Watcher Next', 'logs'), { recursive: true });

const socialclub = require('../../app/parser/socialclub.js');

const ROOT = path.join(tmp, 'Goldberg SocialClub Emu Saves');
const GAME_DIR = path.join(ROOT, 'GTA V');
const PROFILE_DIR = path.join(GAME_DIR, '0F74F4C4');
const ACH_FILE = path.join(PROFILE_DIR, 'achievements.json');

function writeFixture() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(
    ACH_FILE,
    JSON.stringify({
      ACH_ONE: { earned: true, earned_time: 1742423507 },
      ACH_TWO: { earned: false },
    }),
    'utf8'
  );
}

// Real layout produced by the Goldberg SocialClub Emulator: the game folder only contains the
// redirected Rockstar profile (hex profile id + settings/cfg.dat + SAVE/SGTA…). There is no
// achievements.json — the parser must still discover the game and report it honestly.
function writeRockstarProfileFixture() {
  const rdrGame = path.join(ROOT, 'RDR2');
  const rdrProfile = path.join(rdrGame, '0F74F4C4');
  fs.mkdirSync(path.join(rdrProfile, 'settings'), { recursive: true });
  fs.mkdirSync(path.join(rdrProfile, 'SAVE'), { recursive: true });
  fs.writeFileSync(path.join(rdrProfile, 'local_save.txt'), '', 'utf8');
  fs.writeFileSync(path.join(rdrProfile, 'settings', 'cfg.dat'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(rdrProfile, 'SAVE', 'SRDR1000'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(rdrProfile, 'SAVE', 'SRDR1000.bak'), Buffer.from([0, 1, 2, 3]));
  // The emulator's own settings folder at the root must never become a library entry.
  fs.mkdirSync(path.join(ROOT, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'settings', 'account_name.txt'), 'Player', 'utf8');
}

(async () => {
  try {
    writeFixture();
    writeRockstarProfileFixture();
    // A game folder created by the emulator but not yet populated (no profile, no save) is still a
    // valid Settings target — it must be accepted even though there is nothing to parse yet.
    const emptyGame = path.join(ROOT, 'Empty Game');
    fs.mkdirSync(emptyGame, { recursive: true });

    // Regression (issue #11): a hex profile folder that exists but holds NOTHING (no achievement
    // file, no Rockstar save data — the emulator created the shape but the game was never played)
    // must not be listed as a game named after the raw folder.
    const emptyProfileGame = path.join(ROOT, 'GTA_DEF');
    fs.mkdirSync(path.join(emptyProfileGame, '0F74F4C4'), { recursive: true });

    // Path validation: the root, a game folder and a profile folder are all accepted; unrelated
    // folders are not.
    assert.equal(socialclub.isSocialClubPath(ROOT), true);
    assert.equal(socialclub.isSocialClubPath(GAME_DIR), true);
    assert.equal(socialclub.isSocialClubPath(PROFILE_DIR), true);
    assert.equal(socialclub.isSocialClubPath(emptyGame), true);
    assert.equal(socialclub.isSocialClubPath(path.join(tmp, 'Steam')), false);
    assert.equal(socialclub.isSocialClubPath(path.join(GAME_DIR, 'nope.txt')), false);

    // Regression: watched Steam-emulator save roots (SmartSteamEmu, CODEX, OnlineFix, GSE Saves, …)
    // contain numeric Steam AppID subfolders that look like hex profile ids (e.g. 311210). They must
    // NOT be accepted/scanned as Goldberg SocialClub, or the folder itself shows up as a fake game
    // in the library next to the real games.
    const fakeSaveRoot = path.join(tmp, 'SmartSteamEmu');
    fs.mkdirSync(path.join(fakeSaveRoot, '311210'), { recursive: true });
    assert.equal(socialclub.isSocialClubPath(fakeSaveRoot), false);
    assert.deepEqual(await socialclub.scan(fakeSaveRoot), []);

    // A standalone folder with hard Rockstar profile evidence is still accepted outside the root,
    // so a custom SocialClub save location keeps working.
    const customRockstar = path.join(tmp, 'Custom RDR2 Saves');
    fs.mkdirSync(path.join(customRockstar, 'settings'), { recursive: true });
    fs.writeFileSync(path.join(customRockstar, 'local_save.txt'), '', 'utf8');
    fs.writeFileSync(path.join(customRockstar, 'settings', 'cfg.dat'), Buffer.from([0, 1, 2, 3]));
    assert.equal(socialclub.isSocialClubPath(customRockstar), true);
    const customFound = await socialclub.scan(customRockstar);
    assert.equal(customFound.length, 1);
    assert.equal(customFound[0].name, 'Custom RDR2 Saves');

    // Discovery from the root: one entry per game folder, namespaced appid, distinct source.
    // The root "settings" folder is not a game, and neither is a game folder whose only content is
    // an empty hex profile folder (issue #11).
    const found = await socialclub.scan(ROOT);
    assert.equal(found.length, 2);
    assert.ok(!found.some((g) => g.name === 'GTA_DEF'), 'an empty profile folder must not become a game card');
    const gta = found.find((g) => g.appid === 'socialclub-gta-v');
    assert.ok(gta, 'GTA V must be discovered');
    assert.equal(gta.name, 'GTA V');
    assert.equal(gta.source, 'Goldberg SocialClub');
    assert.equal(gta.data.type, 'socialclub');
    assert.equal(gta.data.path, GAME_DIR);

    // Unlock parsing: the standard achievements.json format inside the profile folder is read.
    const unlocks = await socialclub.getAchievements(gta);
    assert.equal(unlocks.ACH_ONE.Achieved, 1);
    assert.equal(unlocks.ACH_ONE.UnlockTime, 1742423507);
    assert.equal(unlocks.ACH_TWO.Achieved, 0);

    // Metadata: GTA V resolves offline to Steam appid 271590. Without a Steam schema (no network /
    // no cache in this sandbox) a minimal game is returned rather than nothing.
    const game = await socialclub.getGameData(gta, 'english', {});
    assert.equal(game.appid, 'socialclub-gta-v');
    assert.equal(game.steamappid, 271590);
    assert.equal(game.name, 'GTA V');
    assert.equal(game.source, 'Goldberg SocialClub');
    assert.equal(game.socialClub, true);

    // A Rockstar-only profile (no achievements.json anywhere) is still discovered and mapped to its
    // Steam release; the parser reports 0 readable achievements instead of pretending to decode
    // the proprietary save files.
    const rdr = found.find((g) => g.appid === 'socialclub-rdr2');
    assert.ok(rdr, 'RDR2 must be discovered from its Rockstar profile layout');
    assert.deepEqual(await socialclub.getAchievements(rdr), {});
    const rdrGame = await socialclub.getGameData(rdr, 'english', {});
    assert.equal(rdrGame.appid, 'socialclub-rdr2');
    assert.equal(rdrGame.steamappid, 1174180);
    assert.equal(rdrGame.name, 'RDR2');
    assert.equal(rdrGame.socialClub, true);
    assert.equal(rdrGame.achievement.total, 0);

    // A profile folder selected directly resolves through its parent game folder.
    const direct = await socialclub.scan(PROFILE_DIR);
    assert.equal(direct.length, 1);
    assert.equal(direct[0].appid, 'socialclub-gta-v');

    console.log('PASS: socialclub parser');
  } finally {
    process.env.APPDATA = originalAppData;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
