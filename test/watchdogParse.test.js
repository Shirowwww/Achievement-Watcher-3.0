'use strict';

// Standalone validation of the watchdog monitor.parse() crack-format branches that were broken
// before the v3.0 watchdog-parser fix: 3DM (`local.local.State` typo) and TENOKE (undeclared
// `convert`, never assigned back to `local`). Both threw on every matching save before the fix.
// Run: node test/watchdogParse.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const monitor = require(path.join(__dirname, '..', 'watchdog', 'monitor.js'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-parse-'));

  // --- TENOKE (user_stats.ini): [ACHIEVEMENTS] key={unlocked=…, time=…} ---
  const tenoke = path.join(tmp, 'user_stats.ini');
  fs.writeFileSync(tenoke, '[ACHIEVEMENTS]\nACH_WIN={unlocked=true, time=1712253396}\nACH_LOSE={unlocked=false, time=0}\n');
  const t = await monitor.parse(tenoke);
  const win = t.find((a) => a.name === 'ACH_WIN');
  const lose = t.find((a) => a.name === 'ACH_LOSE');
  assert.ok(win && win.Achieved === true, 'TENOKE: unlocked achievement should be Achieved');
  assert.strictEqual(win.UnlockTime, 1712253396, 'TENOKE: unlock time parsed');
  assert.ok(lose && lose.Achieved === false, 'TENOKE: locked achievement should not be Achieved');
  console.log(`TENOKE: ok (${t.length} entries)`);

  // --- 3DM (stats.ini): [State]=0101 means unlocked, [Time]=little-endian hex unix timestamp ---
  // 0x66105d14 = 1712253396, little-endian bytes -> "145d1066".
  const tdm = path.join(tmp, 'stats.ini');
  fs.writeFileSync(tdm, '[State]\nACH_A=0101\nACH_B=0000\n[Time]\nACH_A=145d1066\nACH_B=00000000\n');
  const d = await monitor.parse(tdm);
  const a = d.find((x) => x.name === 'ACH_A');
  assert.ok(a && a.Achieved === true, '3DM: 0101 state should be Achieved');
  assert.ok(!d.find((x) => x.name === 'ACH_B'), '3DM: locked (non-0101) achievement omitted');
  console.log(`3DM: ok (${d.length} entries)`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('watchdogParse.test.js: all assertions passed');
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
