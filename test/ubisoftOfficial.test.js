'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ubi-official-'));
process.env.APPDATA = tmp; // keep the rarity sidecar inside the sandbox
// watchdog/util/log.js opens its log file at require time — give it a home inside the sandbox
fs.mkdirSync(path.join(tmp, 'Achievement Watcher', 'logs'), { recursive: true });

const ubi = require('../app/parser/ubisoftOfficial.js');
const AdmZip = require('../app/node_modules/adm-zip');

// Build a spool buffer the way Ubisoft Connect writes it: repeated outer field-1 length-delimited
// messages, each holding a nested message {field1: achievementId} plus field2 = unix timestamp.
function varint(n) {
  const bytes = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    bytes.push(b);
  } while (v > 0);
  return Buffer.from(bytes);
}
function spoolRecord(achId, time) {
  const inner = Buffer.concat([Buffer.from([0x08]), varint(achId)]); // field1 varint = id
  const payload = Buffer.concat([
    Buffer.from([0x0a, inner.length]), // field1 len-delimited = inner message
    inner,
    Buffer.from([0x10]), // field2 varint = timestamp
    varint(time),
  ]);
  return Buffer.concat([Buffer.from([0x0a, payload.length]), payload]);
}

(async () => {
  try {
    const T1 = 1742423507; // 2025-03-19T22:31:47Z
    const T2 = 1742424320;

    // ---- spool parsing
    const spoolDir = path.join(tmp, 'spool', 'user-guid-1');
    fs.mkdirSync(spoolDir, { recursive: true });
    const spoolFile = path.join(spoolDir, '8006.spool');
    fs.writeFileSync(
      spoolFile,
      Buffer.concat([spoolRecord(32, T1), spoolRecord(28, T2), spoolRecord(32, T1)]) // dup ignored
    );

    const parsed = ubi._internal.readUbisoftSpoolFile(spoolFile);
    assert.equal(parsed.appid, '8006');
    assert.equal(parsed.records.length, 2);
    assert.deepEqual(parsed.records[0], { achievementId: 32, earned_time: T1 });

    const snapshot = ubi._internal.buildUbisoftOfficialSnapshot(parsed.records);
    assert.deepEqual(snapshot['32'], { earned: true, earned_time: T1 });
    assert.deepEqual(snapshot['28'], { earned: true, earned_time: T2 });

    // millisecond timestamps are normalized to seconds
    const ms = ubi._internal.buildUbisoftOfficialSnapshot([{ achievementId: 5, earned_time: T1 * 1000 }]);
    assert.equal(ms['5'].earned_time, T1);

    // ---- achievements archive (schema zip without .zip extension)
    const achRoot = path.join(tmp, 'achievements-cache');
    fs.mkdirSync(achRoot, { recursive: true });
    const zip = new AdmZip();
    zip.addFile('en-US_loc.txt', Buffer.from('01\tFirst Blood\tWin once\n2\tCollector\tCollect all\n', 'utf8'));
    zip.addFile('fr-FR_loc.txt', Buffer.from('01\tPremier sang\tGagner une fois\n2\tCollectionneur\tTout collecter\n', 'utf8'));
    zip.addFile('1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const archivePath = path.join(achRoot, '8006_1758_ach.spec');
    fs.writeFileSync(archivePath, zip.toBuffer());

    const resolved = ubi._internal.resolveAchievementsArchive('8006', { achievementsRoot: achRoot });
    assert.equal(resolved.archivePath, archivePath);

    const schema = ubi._internal.collectSchemaData(archivePath);
    assert.deepEqual(schema.ids, ['1', '2']); // "01" is normalized, ids sorted numerically
    assert.equal(schema.localizations.get('english').get('1').displayName, 'First Blood');
    assert.equal(schema.localizations.get('french').get('2').description, 'Tout collecter');
    assert.ok(schema.imageBuffers.has('1'));
    assert.ok(!schema.imageBuffers.has('2'));

    // ---- full contract: getGameData localizes, extracts icons, borrows steam art via the asset
    ubi.setUserDataPath(path.join(tmp, 'Achievement Watcher'));
    const appidEntry = {
      appid: '8006',
      source: 'Ubisoft Connect',
      data: { type: 'ubisoftOfficial', spoolFilePath: spoolFile, archivePath, title: '' },
    };
    const game = await ubi.getGameData(appidEntry, 'french');
    assert.equal(game.name, "Assassin's Creed® Shadows"); // from assets/uplay-steam.json
    assert.equal(game.achievement.total, 2);
    assert.equal(game.achievement.list[0].displayName, 'Premier sang');
    assert.equal(game.achievement.list[1].description, 'Tout collecter');
    assert.ok(fs.existsSync(game.achievement.list[0].icon), 'icon extracted to disk');
    assert.equal(game.achievement.list[1].icon, '', 'no icon in archive -> empty');
    assert.match(game.img.portrait, /steamstatic\.com.*3159330.*library_600x900\.jpg/);

    // unknown language falls back to english
    const en = await ubi.getGameData(appidEntry, 'klingon');
    assert.equal(en.achievement.list[0].displayName, 'First Blood');

    // ---- unlock map through the contract
    const unlocks = ubi.getAchievements(appidEntry);
    assert.equal(unlocks['32'].earned, true);
    assert.equal(unlocks['28'].earned_time, T2);

    // ---- steam apiname → numeric id bridge used by the rarity seeding
    assert.equal(ubi._internal.normalizeSteamAchName('Ach_12'), '12');
    assert.equal(ubi._internal.normalizeSteamAchName('ACS_ACH_7'), '7');
    assert.equal(ubi._internal.normalizeSteamAchName('PlainName'), 'PlainName');

    // ---- spool listing
    const entries = ubi._internal.listSpoolEntries(path.join(tmp, 'spool'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].appid, '8006');
    assert.equal(entries[0].userId, 'user-guid-1');

    // ---- watchdog live-watcher readers share the same formats
    const ubiWatch = require('../watchdog/console/ubisoftWatch.js');
    const wRecords = ubiWatch._internal.readSpool(spoolFile);
    assert.equal(wRecords.length, 2);
    assert.deepEqual(wRecords[0], { id: '32', time: T1 });
    const wZip = ubiWatch._internal.readZipEntries(archivePath);
    const wTexts = ubiWatch._internal.parseLocTxt(wZip.readEntry('fr-FR_loc.txt'));
    assert.equal(wTexts.get('1').displayName, 'Premier sang');

    console.log('PASS: ubisoftOfficial spool + archive schema + contract');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup — never mask the real test failure */
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
