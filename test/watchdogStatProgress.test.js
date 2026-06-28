'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const monitor = require('../watchdog/monitor.js');
const { mapStatProgressEntries } = require('../watchdog/util/statProgress.js');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-watchdog-stat-'));
  try {
    const file = path.join(tmp, 'stats.json');
    fs.writeFileSync(file, JSON.stringify({ real_stat_hash: { value: 1 } }));
    const parsed = await monitor.parse(file);
    assert.equal(parsed[0].name, 'real_stat_hash');
    assert.equal(parsed[0].CurProgress, 1);

    const schema = [{ name: 'ACH_DONE', progress: { max_val: 1, value: { operation: 'statvalue', operand1: 'real_stat_hash' } } }];
    const mapped = mapStatProgressEntries(parsed, schema);
    assert.equal(mapped, 1);
    assert.equal(parsed.some((entry) => entry.name === 'real_stat_hash'), false, 'mapped raw stat hash should not be notified');
    const achieved = parsed.find((entry) => entry.name === 'ACH_DONE');
    assert.ok(achieved && achieved.Achieved === true, 'watchdog should map full stat progress to an unlock');
    console.log('PASS: watchdog maps GBE stats.json through rich achievement schema');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
