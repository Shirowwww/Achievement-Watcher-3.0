'use strict';

/*
  Achievement reset. The property that matters is not "the file is gone" but "the user can get it
  back and the game can earn the achievement again": every case below checks the backup as closely
  as the deletion, because a reset that cannot be undone is a data-loss bug with a button on it.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const targets = require(path.join(appDir, 'util', 'achievementResetTargets.js'));
const shadps4 = require(path.join(appDir, 'parser', 'shadps4.js'));
const manualUnlock = require(path.join(appDir, 'parser', 'manualUnlock.js'));
const achievementReset = require(path.join(appDir, 'parser', 'achievementReset.js'));

function tempProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ach-reset-'));
  achievementReset.setUserDataPath(dir);
  manualUnlock.setUserDataPath(dir);
  return dir;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ---- what may be touched ----------------------------------------------------------------------

test('emulator saves are reset by deletion, because that is what every emulator rebuilds', () => {
  for (const name of ['achievements.json', 'achievements.ini', 'ACHIEVEMENTS.INI', 'stats.bin', 'achieve.dat', 'user_stats.ini', 'TROPUSR.DAT']) {
    assert.equal(targets.resetActionFor(name), targets.ACTION.DELETE, `${name} must be resettable`);
  }
});

/*
  ShadPS4 and Xenia keep the achievement list in the same file as its unlock state. Deleting one
  takes the game's achievements with it, so those two must be edited, never removed.
*/
test('files that also hold the achievement list are edited in place, never deleted', () => {
  assert.equal(targets.resetActionFor('TROP.XML'), targets.ACTION.CLEAR_SHADPS4_XML);
  assert.equal(targets.resetActionFor('TROP_07.XML'), targets.ACTION.CLEAR_SHADPS4_XML);
  assert.equal(targets.resetActionFor('4D5307E6.gpd'), targets.ACTION.CLEAR_XENIA_GPD);
});

test('schema files are never a target, whatever folder they sit in', () => {
  for (const name of ['TROPCONF.SFM', 'steam_appid.txt', 'appid.txt', 'trophy.trp', 'configs.main.ini', 'ICON0.PNG']) {
    assert.equal(targets.resetActionFor(name), null, `${name} must survive a reset`);
  }
});

// The unlocks are on the platform's servers; a local delete would only be undone by the next sync.
test('platform-owned libraries are refused with a reason instead of pretending', () => {
  const { resettable, blocked } = targets.classifySources([
    { source: 'Steam (Shirow)', path: 'C:/steam' },
    { source: 'GOG Galaxy', path: 'C:/gog' },
    { source: 'Ubisoft Connect', path: 'C:/ubi' },
    { source: 'ea', path: 'C:/ea' },
    { source: 'epic-official', path: 'C:/epic' },
    { source: 'Xbox PC', path: 'C:/xbox' },
    { source: 'Goldberg', path: 'C:/gse' },
  ]);
  assert.deepEqual(resettable.map((entry) => entry.source), ['Goldberg']);
  assert.equal(blocked.length, 6);
  assert.ok(blocked.every((entry) => entry.reason === 'official-platform'));
});

// ---- the transforms ---------------------------------------------------------------------------

test('relocking a ShadPS4 trophy file keeps every trophy and its wording', () => {
  const source = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<trophyconf>',
    '  <trophy id="0" hidden="no" ttype="B" unlockstate="true" timestamp="2026-01-02T03:04:05Z"><name>First blood</name></trophy>',
    '  <trophy id="1" hidden="no" ttype="S" unlockstate="false"><name>Second</name></trophy>',
    '  <trophy id="2" hidden="yes" ttype="G" unlocked="yes" timestamp="123"><name>Third</name></trophy>',
    '</trophyconf>',
  ].join('\n');

  const { text, cleared } = shadps4.clearTrophyXml(source);
  assert.equal(cleared, 2, 'only the two unlocked trophies count as cleared');
  assert.doesNotMatch(text, /unlockstate="true"/);
  assert.doesNotMatch(text, /unlocked="yes"/);
  assert.doesNotMatch(text, /timestamp="[^"]+"/, 'a leftover timestamp would read as an unlock date');
  // The list itself has to survive: this file IS the game's trophy schema.
  assert.match(text, /First blood/);
  assert.match(text, /<trophy id="2"[^>]*ttype="G"/);
  assert.equal((text.match(/<trophy /g) || []).length, 3);
});

test('an already locked ShadPS4 file is left exactly as it was', () => {
  const source = '<trophyconf><trophy id="0" unlockstate="false"><name>x</name></trophy></trophyconf>';
  const { text, cleared } = shadps4.clearTrophyXml(source);
  assert.equal(cleared, 0);
  assert.equal(text, source);
});

// ---- the whole operation ----------------------------------------------------------------------

function goldbergGame(profile) {
  const saveDir = path.join(profile, 'GSE Saves', '480');
  write(path.join(saveDir, 'achievements.json'), JSON.stringify({ ACH_WIN: { earned: true, earned_time: 1700000000 } }));
  write(path.join(saveDir, 'stats.ini'), '[Stats]\nkills=120\n');
  // Neighbouring files a reset must not touch.
  write(path.join(saveDir, 'remote', 'save1.dat'), 'game progress');
  return {
    appid: '480',
    name: 'Spacewar',
    source: 'Goldberg',
    dataPaths: [{ source: 'Goldberg', path: saveDir }],
    achievement: { total: 2, unlocked: 1, list: [] },
  };
}

test('a reset clears the saves, the baseline and the manual unlocks in one go', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const game = goldbergGame(profile);
  const baseline = write(path.join(profile, 'steam_cache', 'data', '480.db'), '[{"name":"ACH_WIN","Achieved":true}]');
  manualUnlock.saveUpdate('480', 'Goldberg', 'ACH_MANUAL', 'mark-unlocked');

  const plan = achievementReset.plan(game);
  assert.equal(plan.supported, true);
  assert.equal(plan.files.length, 2, 'the achievement save and its stats counter');
  assert.equal(plan.manualEntries, 1);
  assert.ok(plan.baseline, 'the watchdog baseline has to go too, or nothing ever notifies again');

  const result = achievementReset.run(plan);
  assert.deepEqual(result.errors, []);
  assert.equal(fs.existsSync(path.join(profile, 'GSE Saves', '480', 'achievements.json')), false);
  assert.equal(fs.existsSync(path.join(profile, 'GSE Saves', '480', 'stats.ini')), false);
  assert.equal(fs.existsSync(baseline), false);
  // A save file that is not achievement data is none of the reset's business.
  assert.equal(fs.readFileSync(path.join(profile, 'GSE Saves', '480', 'remote', 'save1.dat'), 'utf8'), 'game progress');
  const sidecar = manualUnlock.readMap(manualUnlock.sidecarFile());
  assert.equal(sidecar[manualUnlock.gameKey('480', 'Goldberg')], undefined);
});

test('everything a reset removed comes back, byte for byte', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const game = goldbergGame(profile);
  const savePath = path.join(profile, 'GSE Saves', '480', 'achievements.json');
  const before = fs.readFileSync(savePath, 'utf8');
  write(path.join(profile, 'steam_cache', 'data', '480.db'), '[{"name":"ACH_WIN","Achieved":true}]');
  manualUnlock.saveUpdate('480', 'Goldberg', 'ACH_MANUAL', 'mark-unlocked');

  const result = achievementReset.run(achievementReset.plan(game));
  const backups = achievementReset.listBackups('480');
  assert.equal(backups.length, 1);
  assert.equal(backups[0].id, result.backupId);

  const restored = achievementReset.restore('480', backups[0].id);
  assert.deepEqual(restored.errors, []);
  assert.equal(fs.readFileSync(savePath, 'utf8'), before);
  // The baseline returns with the save, so restored unlocks do not arrive as a burst of toasts.
  assert.equal(fs.existsSync(path.join(profile, 'steam_cache', 'data', '480.db')), true);
  const sidecar = manualUnlock.readMap(manualUnlock.sidecarFile());
  assert.ok(sidecar[manualUnlock.gameKey('480', 'Goldberg')], 'manual unlocks are part of what was reset');
});

test('a game whose unlocks live on a platform is reported as nothing to do', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const plan = achievementReset.plan({
    appid: '620',
    name: 'Portal 2',
    source: 'Steam (Shirow)',
    dataPaths: [{ source: 'Steam (Shirow)', path: profile }],
  });
  assert.equal(plan.supported, false);
  assert.equal(plan.files.length, 0);
  assert.equal(plan.blocked.length, 1);
});

test('a ShadPS4 game is relocked in place, and restoring brings the unlocks back', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const trophyDir = path.join(profile, 'shadps4', 'CUSA00001', 'TrophyFiles', 'trophy00');
  const xml = path.join(trophyDir, 'Xml', 'TROP.XML');
  const original = '<trophyconf><trophy id="0" unlockstate="true" timestamp="9"><name>Platinum</name></trophy></trophyconf>';
  write(xml, original);

  const plan = achievementReset.plan({
    appid: 'CUSA00001',
    name: 'A PS4 game',
    source: 'ShadPS4 Emulator',
    dataPaths: [{ source: 'ShadPS4 Emulator', path: trophyDir }],
  });
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].action, targets.ACTION.CLEAR_SHADPS4_XML);

  const result = achievementReset.run(plan);
  assert.equal(result.cleared, 1);
  assert.equal(fs.existsSync(xml), true, 'the trophy list must still exist after a reset');
  assert.match(fs.readFileSync(xml, 'utf8'), /unlockstate="false"/);

  achievementReset.restore('CUSA00001', result.backupId);
  assert.equal(fs.readFileSync(xml, 'utf8'), original);
});

// A path that resolved to something enormous must not turn a reset into a disk walk.
test('the folder walk is bounded in depth and in count', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const deep = path.join(profile, 'a', 'b', 'c', 'd', 'e', 'f');
  write(path.join(deep, 'achievements.json'), '{}');
  write(path.join(profile, 'a', 'achievements.json'), '{}');
  const found = achievementReset._internal.collectTargets(path.join(profile, 'a'), 'Goldberg', []);
  assert.equal(found.length, 1, 'only the file within the depth bound is reachable');
});

test('nothing is deleted when its backup could not be written', (t) => {
  const profile = tempProfile();
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const game = goldbergGame(profile);
  const plan = achievementReset.plan(game);
  // A target that vanished between planning and running stands in for any unreadable source.
  const missing = path.join(profile, 'GSE Saves', '480', 'gone.json');
  plan.files.push({ path: missing, action: targets.ACTION.DELETE, source: 'Goldberg' });

  const result = achievementReset.run(plan);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].stage, 'backup');
  // The rest of the plan still ran: one unreadable file must not cost the user the whole reset.
  assert.equal(fs.existsSync(path.join(profile, 'GSE Saves', '480', 'achievements.json')), false);
});

// ---- Xenia -------------------------------------------------------------------------------------

/*
  A minimal but real GPD: an XDBF header, one entry table slot per achievement and the achievement
  payloads themselves. Building it here rather than shipping a binary fixture keeps the offsets this
  patch depends on (flags at 0x10, unlock time at 0x14) visible and checkable.
*/
function buildGpd(achievements) {
  const ENTRY_SIZE = 0x12;
  const HEADER = 0x18;
  const payloads = achievements.map((achievement) => {
    const text = Buffer.from(`${achievement.name}\0locked\0unlocked\0`, 'utf16le').swap16(); // GPD strings are UTF-16 BE
    const payload = Buffer.alloc(0x1c + text.length);
    payload.writeUInt32BE(0x1c, 0x00); // struct size
    payload.writeUInt32BE(achievement.id, 0x04);
    payload.writeUInt32BE(1, 0x08); // image id
    payload.writeInt32BE(10, 0x0c); // gamerscore
    payload.writeUInt32BE(achievement.earned ? 0x20001 : 0x00001, 0x10);
    if (achievement.earned) payload.writeBigUInt64BE(133000000000000000n, 0x14);
    text.copy(payload, 0x1c);
    return payload;
  });

  const header = Buffer.alloc(HEADER);
  header.write('XDBF', 0, 'ascii');
  header.writeUInt32BE(0x00010000, 0x04);
  header.writeUInt32BE(payloads.length, 0x08); // entry table length, in slots
  header.writeUInt32BE(payloads.length, 0x0c);
  header.writeUInt32BE(0, 0x10);
  header.writeUInt32BE(0, 0x14);

  const table = Buffer.alloc(payloads.length * ENTRY_SIZE);
  let offset = 0;
  payloads.forEach((payload, index) => {
    const base = index * ENTRY_SIZE;
    table.writeUInt16BE(1, base); // achievement namespace
    table.writeBigUInt64BE(BigInt(achievements[index].id), base + 2);
    table.writeUInt32BE(offset, base + 10);
    table.writeUInt32BE(payload.length, base + 14);
    offset += payload.length;
  });

  return Buffer.concat([header, table, ...payloads]);
}

test('relocking a Xenia GPD clears the earned bit without moving a byte', () => {
  const xenia = require(path.join(appDir, 'parser', 'xenia.js'));
  const original = buildGpd([
    { id: 1, name: 'First blood', earned: true },
    { id: 2, name: 'Second', earned: false },
    { id: 3, name: 'Third', earned: true },
  ]);

  const before = xenia._internal.validAchievements(xenia._internal.parseGpdBuffer(original, 'test.gpd'));
  assert.equal(before.length, 3, 'the fixture must parse as three achievements to begin with');

  const { buffer, cleared } = xenia.clearGpdBuffer(original);
  assert.equal(cleared, 2);
  assert.equal(buffer.length, original.length, 'an in-place patch must not resize the file');

  // The achievement list itself is what a delete would have destroyed: it has to be intact.
  const after = xenia._internal.validAchievements(xenia._internal.parseGpdBuffer(buffer, 'test.gpd'));
  assert.equal(after.length, 3);
  assert.deepEqual(after.map((a) => a.name), before.map((a) => a.name));
  assert.deepEqual(after.map((a) => a.gamerscore), before.map((a) => a.gamerscore));
  for (const achievement of after) {
    assert.equal((achievement.flags & xenia._internal.ACHIEVEMENT_EARNED_FLAG) !== 0, false, 'nothing may stay earned');
    assert.equal(String(achievement.unlockRaw), '0', 'a leftover unlock time would read as a date');
  }
  // The non-earned flag bits are configuration, not state, and must be preserved.
  assert.deepEqual(after.map((a) => a.flags), before.map((a) => a.flags & ~xenia._internal.ACHIEVEMENT_EARNED_FLAG));
});

test('a GPD that does not parse is returned untouched rather than half-written', () => {
  const xenia = require(path.join(appDir, 'parser', 'xenia.js'));
  const junk = Buffer.from('not a gpd at all');
  const { buffer, cleared } = xenia.clearGpdBuffer(junk);
  assert.equal(cleared, 0);
  assert.equal(buffer.equals(junk), true);
});
