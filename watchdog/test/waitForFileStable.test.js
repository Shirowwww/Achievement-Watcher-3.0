'use strict';

// Standalone test runner (no framework in the watchdog package).
// Run with: node watchdog/test/waitForFileStable.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const waitForFileStable = require('../util/waitForFileStable.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.message}`);
    process.exitCode = 1;
  }
}

const tmp = (suffix) => path.join(os.tmpdir(), `aw-wffs-${process.pid}-${suffix}`);

(async () => {
  await test('does not return until a file still being written has stopped growing', async () => {
    const file = tmp('growing.json');
    const chunk = '"a":1,';
    const total = 6;
    fs.writeFileSync(file, '{');
    // Writer appends on a cadence faster than the settle poll interval, then stops, so consecutive
    // samples keep differing until the last chunk lands. (Content assertion, not timing — a settle
    // that returned mid-write would observe fewer than `total` chunks.)
    let chunks = 0;
    const timer = setInterval(() => {
      chunks += 1;
      fs.appendFileSync(file, chunk);
      if (chunks >= total) clearInterval(timer);
    }, 20);

    await waitForFileStable(file, { intervalMs: 50, maxWaitMs: 3000 });

    clearInterval(timer);
    const got = fs.readFileSync(file, 'utf8');
    fs.rmSync(file, { force: true });
    const seen = (got.match(/"a":1,/g) || []).length;
    assert.strictEqual(seen, total, `settle returned mid-write: saw ${seen}/${total} chunks`);
  });

  await test('returns immediately (well under maxWait) for an already-stable file', async () => {
    const file = tmp('stable.json');
    fs.writeFileSync(file, '{"done":true}');
    const start = Date.now();
    await waitForFileStable(file, { intervalMs: 40, maxWaitMs: 2000 });
    const elapsed = Date.now() - start;
    fs.rmSync(file, { force: true });
    assert.ok(elapsed < 1000, `stable file should settle fast, took ${elapsed}ms`);
  });

  await test('bails out (does not hang) when the file does not exist', async () => {
    const start = Date.now();
    await waitForFileStable(tmp('missing.json'), { intervalMs: 40, maxWaitMs: 2000 });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `missing file should return promptly, took ${elapsed}ms`);
  });

  console.log(`\n${passed} passed`);
})();
