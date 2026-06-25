'use strict';

// Standalone test runner (no framework in the watchdog package).
// Run with: node watchdog/test/parseWithRetry.test.js
const assert = require('assert');
const parseWithRetry = require('../util/parseWithRetry.js');

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

(async () => {
  await test('returns the list when the producer succeeds on the first try', async () => {
    const result = await parseWithRetry(async () => [{ name: 'A' }], { delayMs: 1 });
    assert.deepStrictEqual(result, [{ name: 'A' }]);
  });

  await test('retries when the producer throws (truncated read), then returns the recovered list', async () => {
    let calls = 0;
    const result = await parseWithRetry(async () => {
      calls += 1;
      if (calls < 2) throw new Error('truncated read');
      return [{ name: 'B' }];
    }, { delayMs: 1 });
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(result, [{ name: 'B' }]);
  });

  await test('retries when the producer yields an empty list, then returns the recovered list', async () => {
    let calls = 0;
    const result = await parseWithRetry(async () => {
      calls += 1;
      return calls < 3 ? [] : [{ name: 'C' }];
    }, { delayMs: 1 });
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(result, [{ name: 'C' }]);
  });

  await test('returns [] after exhausting attempts when the producer always throws', async () => {
    let calls = 0;
    const result = await parseWithRetry(async () => {
      calls += 1;
      throw new Error('always fails');
    }, { attempts: 3, delayMs: 1 });
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(result, []);
  });

  await test('returns [] when the producer always yields empty (legitimately empty save)', async () => {
    let calls = 0;
    const result = await parseWithRetry(async () => {
      calls += 1;
      return [];
    }, { attempts: 3, delayMs: 1 });
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(result, []);
  });

  await test('invokes onError once per thrown attempt with the attempt index', async () => {
    const seen = [];
    await parseWithRetry(async () => {
      throw new Error('boom');
    }, { attempts: 2, delayMs: 1, onError: (err, i) => seen.push(i) });
    assert.deepStrictEqual(seen, [0, 1]);
  });

  console.log(`\n${passed} passed`);
})();
