'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const steam = require('../app/parser/steam.js');
const { applyLocalStatProgress } = require('../app/parser/statProgress.js');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stat-progress-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'stats.json'),
      JSON.stringify({
        real_stat_hash: { value: 3 },
        completed_stat_hash: { value: 1 },
      })
    );

    const root = await steam.getAchievementsFromFile(tmp);
    const schema = [
      {
        name: 'ACH_PROGRESS',
        progress: { max_val: 5, value: { operation: 'statvalue', operand1: 'real_stat_hash' } },
      },
      {
        name: 'ACH_DONE',
        progress: { max_val: 1, value: { operation: 'statvalue', operand1: 'completed_stat_hash' } },
      },
    ];

    const applied = applyLocalStatProgress(root, schema);
    assert.equal(applied, 2);
    assert.deepEqual(root.ACH_PROGRESS, { CurProgress: 3, MaxProgress: 5, Achieved: '0' });
    assert.deepEqual(root.ACH_DONE, { CurProgress: 1, MaxProgress: 1, Achieved: '1' });
    console.log('PASS: local GBE stat progress maps through rich achievement schema');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
