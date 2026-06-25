'use strict';

// Standalone test runner (no framework). Run with: node test/parsers.test.js
// Verifies the pure parsing logic of the console-emulator parsers (shadps4 XML, xenia GPD/XDBF)
// against synthetic fixtures — the highest-risk part, exercised headless.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const shadps4 = require('../app/parser/shadps4.js');
const xenia = require('../app/parser/xenia.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.stack || e.message || e}`);
    process.exitCode = 1;
  }
}

const mkTmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));

// ---- ShadPS4 fixtures --------------------------------------------------------------------------

function makeShadPs4Game() {
  const root = mkTmp('shadps4');
  const trophyDir = path.join(root, 'game_data', 'CUSA12345', 'TrophyFiles', 'trophy00');
  fs.mkdirSync(path.join(trophyDir, 'Xml'), { recursive: true });
  fs.mkdirSync(path.join(trophyDir, 'Icons'), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<trophyconf>
  <npcommid>NPWR12345_00</npcommid>
  <title-name>My PS4 Game</title-name>
  <trophy id="0" hidden="no" ttype="P"><name>Platinum</name><detail>Get all</detail></trophy>
  <trophy id="1" hidden="no" ttype="G" unlockstate="true" timestamp="1700000000"><name>Gold One</name><detail>Do gold</detail></trophy>
  <trophy id="2" hidden="yes" ttype="B"><name>Hidden One</name><detail>secret</detail></trophy>
</trophyconf>`;
  fs.writeFileSync(path.join(trophyDir, 'Xml', 'TROP.XML'), xml, 'utf8');
  return { root, trophyDir };
}

// ---- Xenia GPD (XDBF) fixture builder ----------------------------------------------------------

function utf16be(str, terminate = true) {
  const le = Buffer.from(str, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  return terminate ? Buffer.concat([be, Buffer.from([0, 0])]) : be;
}

function makeGpdBuffer() {
  const EARNED = 0x20000;
  const fixed = Buffer.alloc(0x1c);
  fixed.writeUInt32BE(0x1c, 0x00); // structSize
  fixed.writeUInt32BE(1, 0x04); // achievementId
  fixed.writeUInt32BE(1001, 0x08); // imageId
  fixed.writeInt32BE(20, 0x0c); // gamerscore
  fixed.writeUInt32BE(EARNED | 0x8, 0x10); // flags: earned + visible (0x8 set => not hidden)
  fixed.writeBigInt64BE(133444736000000000n, 0x14); // FILETIME for 1700000000000 ms (2023-11-14)
  const achPayload = Buffer.concat([fixed, utf16be('Test Ach'), utf16be('Locked desc'), utf16be('Unlocked desc')]);

  const imgPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  const titlePayload = utf16be('My Xbox Game', false);

  const offA = 0;
  const offB = achPayload.length;
  const offC = achPayload.length + imgPayload.length;

  const entry = (ns, idBig, offset, length) => {
    const b = Buffer.alloc(0x12);
    b.writeUInt16BE(ns, 0);
    b.writeBigUInt64BE(idBig, 2);
    b.writeUInt32BE(offset, 10);
    b.writeUInt32BE(length, 14);
    return b;
  };

  const header = Buffer.alloc(0x18);
  header.write('XDBF', 'ascii');
  header.writeUInt32BE(0x00010000, 0x04); // version
  header.writeUInt32BE(3, 0x08); // entryTableLength (slot count)
  header.writeUInt32BE(3, 0x0c); // entryCount
  header.writeUInt32BE(0, 0x10); // freeTableLength
  header.writeUInt32BE(0, 0x14); // freeCount

  const entryTable = Buffer.concat([
    entry(1, 1n, offA, achPayload.length), // achievement
    entry(2, 1001n, offB, imgPayload.length), // image
    entry(5, 0x8000n, offC, titlePayload.length), // title string
  ]);

  return Buffer.concat([header, entryTable, achPayload, imgPayload, titlePayload]);
}

(async () => {
  // ---- ShadPS4 ----
  await test('shadps4.scan finds the CUSA game under game_data', async () => {
    const { root } = makeShadPs4Game();
    const found = await shadps4.scan(root);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].appid, 'CUSA12345');
    assert.strictEqual(found[0].source, 'ShadPS4 Emulator');
    assert.strictEqual(found[0].data.type, 'shadps4');
    assert.strictEqual(found[0].data.trustedInstalled, false);
  });

  await test('shadps4.scan only marks a configured on-disk game as installed', async () => {
    const { root } = makeShadPs4Game();
    const gameDir = path.join(root, 'library', 'Bloodborne');
    fs.mkdirSync(path.join(gameDir, 'sce_sys'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'sce_sys', 'param.sfo'), Buffer.from('TITLE_ID\0CUSA12345\0', 'latin1'));
    fs.writeFileSync(path.join(gameDir, 'eboot.bin'), 'game');
    fs.writeFileSync(
      path.join(root, 'config.toml'),
      `[GUI]\ninstallDirs = [${JSON.stringify(path.join(root, 'library'))}]\ninstallDirsEnabled = [true]\n`,
      'utf8'
    );

    const found = await shadps4.scan(root);
    assert.strictEqual(found[0].data.trustedInstalled, true);
    assert.strictEqual(found[0].data.gameDir, gameDir);
  });

  await test('shadps4.getGameData reads schema (name, types, hidden) from TROP.XML', async () => {
    const { trophyDir } = makeShadPs4Game();
    const game = await shadps4.getGameData(trophyDir);
    assert.strictEqual(game.name, 'My PS4 Game');
    assert.strictEqual(game.system, 'playstation');
    assert.strictEqual(game.achievement.total, 3);
    const byId = Object.fromEntries(game.achievement.list.map((a) => [a.name, a]));
    assert.strictEqual(byId[0].type, 'P');
    assert.strictEqual(byId[1].type, 'G');
    assert.strictEqual(byId[2].hidden, 1);
    assert.ok(byId[0].icon.endsWith('Icons/TROP000.PNG'));
  });

  await test('shadps4.getAchievements reads unlockstate + timestamp from the XML', async () => {
    const { trophyDir } = makeShadPs4Game();
    const ach = await shadps4.getAchievements(trophyDir);
    const one = ach.find((a) => a.id === 1);
    assert.ok(one && one.achieved === true, 'trophy 1 should be unlocked');
    assert.strictEqual(one.earned_time, 1700000000);
    const zero = ach.find((a) => a.id === 0);
    assert.strictEqual(zero.achieved, false);
  });

  // ---- Xenia ----
  await test('xenia parseGpdBuffer decodes title + achievement from XDBF', async () => {
    const buf = makeGpdBuffer();
    const parsed = xenia._internal.parseGpdBuffer(buf, 'TEST.gpd');
    assert.strictEqual(parsed.title, 'My Xbox Game');
    const valid = xenia._internal.validAchievements(parsed);
    assert.strictEqual(valid.length, 1);
    assert.strictEqual(valid[0].name, 'Test Ach');
    assert.strictEqual(valid[0].gamerscore, 20);
  });

  await test('xenia normalizeUnlockTime converts FILETIME to ms in range', async () => {
    const ms = xenia._internal.normalizeUnlockTime(133444736000000000n);
    assert.strictEqual(ms, 1700000000000);
  });

  await test('xenia.getAchievements returns earned + unix-seconds time', async () => {
    const tmp = mkTmp('xenia');
    const gpd = path.join(tmp, 'TEST.gpd');
    fs.writeFileSync(gpd, makeGpdBuffer());
    const ach = await xenia.getAchievements(gpd);
    assert.strictEqual(ach.length, 1);
    assert.strictEqual(ach[0].id, '1');
    assert.strictEqual(ach[0].achieved, true);
    assert.strictEqual(ach[0].earned_time, 1700000000);
  });

  console.log(`\n${passed} passed`);
})();
