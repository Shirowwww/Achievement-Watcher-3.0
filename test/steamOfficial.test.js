'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const so = require('../app/parser/steamOfficial.js');

// ---- tiny binary KV writer (inverse of parseKVBinary) ----
function cstr(s) {
  return Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])]);
}
function kvNode(key, ...children) {
  return Buffer.concat([Buffer.from([0x00]), cstr(key), ...children, Buffer.from([0x08])]);
}
function kvStr(key, val) {
  return Buffer.concat([Buffer.from([0x01]), cstr(key), cstr(val)]);
}
function kvInt(key, val) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(val);
  return Buffer.concat([Buffer.from([0x02]), cstr(key), b]);
}
function kvFloat(key, val) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(val);
  return Buffer.concat([Buffer.from([0x03]), cstr(key), b]);
}

(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-official-'));
  try {
    const T1 = 1598274099;

    // Schema bin: stat 1 = achievements (bits), stat 2 = progress stat "STAT_KILLS"
    const schemaBuf = kvNode(
      '480',
      kvStr('gamename', 'Test Game'),
      kvNode(
        'stats',
        kvNode(
          '1',
          kvStr('type', '4'),
          kvNode(
            'bits',
            kvNode(
              '0',
              kvStr('name', 'ACH_FIRST'),
              kvNode('display', kvNode('name', kvStr('english', 'First!'), kvStr('french', 'Premier !')), kvStr('desc', 'Do the thing'), kvStr('hidden', '0'), kvStr('icon', 'abc.jpg'))
            ),
            kvNode(
              '1',
              kvStr('name', 'ACH_HUNTER'),
              kvNode('display', kvStr('name', 'Hunter'), kvStr('hidden', '1')),
              kvNode('progress', kvNode('value', kvStr('operation', 'statvalue'), kvStr('operand1', 'STAT_KILLS')), kvInt('max_val', 100))
            )
          )
        ),
        kvNode('2', kvStr('name', 'STAT_KILLS'), kvStr('type', 'INT'), kvInt('min', 0), kvInt('max', 100))
      )
    );

    const parsedSchema = so.parseKVBinary(schemaBuf);
    assert.equal(parsedSchema.rootName, '480');
    assert.equal(so.extractGameName(parsedSchema.data), 'Test Game');

    const entries = so.extractSchemaAchievements(parsedSchema.data);
    assert.equal(entries.length, 2);
    const first = entries.find((e) => e.api === 'ACH_FIRST');
    assert.equal(first.statId, 1);
    assert.equal(first.bit, 0);
    assert.equal(first.hidden, 0);
    assert.equal(so.localizedString(first.displayName, 'french'), 'Premier !');
    assert.equal(so.localizedString(first.displayName, 'klingon'), 'First!');
    const hunter = entries.find((e) => e.api === 'ACH_HUNTER');
    assert.equal(hunter.hidden, 1);
    assert.equal(hunter.progressStatId, 2); // resolved via STAT_KILLS definition
    assert.equal(hunter.progressMax, 100);

    // User bin: stat 1 data = bit0 set (ACH_FIRST earned @T1), stat 2 = 42 kills
    const userBuf = kvNode(
      'user',
      kvNode(
        'stats',
        kvNode('1', kvInt('data', 0b01), kvNode('AchievementTimes', kvInt('0', T1))),
        kvNode('2', kvInt('data', 42))
      )
    );
    const userStats = so.extractUserStats(so.parseKVBinary(userBuf).data);
    assert.equal(userStats['1'].data_u32, 1);
    assert.equal(userStats['1'].times['0'], T1);

    const snap = so.buildSnapshotFromAppcache(entries, userStats);
    assert.deepEqual(snap.ACH_FIRST, { earned: true, earned_time: T1 });
    assert.equal(snap.ACH_HUNTER.earned, false);
    assert.equal(snap.ACH_HUNTER.progress, 42);
    assert.equal(snap.ACH_HUNTER.max_progress, 100);

    // float progress stats decode through the raw u32 bits
    const floatEntries = [{ api: 'ACH_F', statId: 1, bit: 3, progressStatId: 9, progressMax: 1, progressStatType: 'FLOAT' }];
    const fbuf = Buffer.alloc(4);
    fbuf.writeFloatLE(0.5);
    const floatSnap = so.buildSnapshotFromAppcache(floatEntries, { 9: { data_u32: fbuf.readUInt32LE(0), data_type: 'int32', times: {} } });
    assert.equal(floatSnap.ACH_F.progress, 0.5);

    // ---- end-to-end through files (the shape steam.js consumes)
    fs.writeFileSync(path.join(tmp, 'UserGameStatsSchema_480.bin'), schemaBuf);
    fs.writeFileSync(path.join(tmp, 'UserGameStats_111_480.bin'), userBuf);
    const rows = so.readLocalUserStats({ statsDir: tmp, appid: '480', accountId: '111' });
    assert.equal(rows.length, 2);
    const earnedRow = rows.find((r) => r.apiname === 'ACH_FIRST');
    assert.deepEqual(earnedRow, { apiname: 'ACH_FIRST', achieved: 1, unlocktime: T1 });
    const progressRow = rows.find((r) => r.apiname === 'ACH_HUNTER');
    assert.equal(progressRow.achieved, 0);
    assert.equal(progressRow.progress, 42);

    // unknown account falls back to the freshest bin for the appid
    const rows2 = so.readLocalUserStats({ statsDir: tmp, appid: '480', accountId: '999' });
    assert.equal(rows2.length, 2);

    // missing schema -> null (network fallback signal), never a throw
    assert.equal(so.readLocalUserStats({ statsDir: tmp, appid: '999' }), null);
    assert.equal(so.readLocalUserStats({ statsDir: path.join(tmp, 'nope'), appid: '480' }), null);

    // bin name parsing + listing order
    assert.deepEqual(so.parseUserBinName('UserGameStats_274782616_1002300.bin'), { accountId: '274782616', appid: '1002300' });
    assert.equal(so.parseUserBinName('UserGameStatsSchema_1002300.bin'), null);
    assert.equal(so.listUserBins(tmp, '480').length, 1);

    console.log('PASS: steamOfficial binary KV schema + user stats + snapshot');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
})();
