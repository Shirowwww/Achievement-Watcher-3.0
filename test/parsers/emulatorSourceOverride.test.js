'use strict';

// Standalone test (run from app/ via: node --test "../test/parsers/emulatorSourceOverride.test.js").
// Characterizes the per-game emulator-source override store used by the right-click "Emulator
// source" menu (app.js): get() returns null until set(), set() persists across a fresh require of
// the module (simulating app restart), and an invalid/"Automatic" value clears the override.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const modulePath = path.join(__dirname, '..', '..', 'app', 'parser', 'emulatorSourceOverride.js');
const emulatorSourceOverride = require(modulePath);

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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-emulatorsourceoverride-'));

(async () => {
  emulatorSourceOverride.setUserDataPath(temp);
  const storeFile = path.join(temp, 'cfg', 'emulatorSourceOverride.json');

  try {
    await test('no override set → get() returns null', async () => {
      assert.strictEqual(emulatorSourceOverride.get(3751950), null);
    });

    await test('set("ubisoft") persists and is readable', async () => {
      emulatorSourceOverride.set(3751950, 'ubisoft');
      assert.strictEqual(emulatorSourceOverride.get(3751950), 'ubisoft');
      assert.strictEqual(emulatorSourceOverride.get('3751950'), 'ubisoft', 'appid should be coerced to string');
    });

    await test('set("steam") on a different appid does not disturb the first', async () => {
      emulatorSourceOverride.set(242050, 'steam');
      assert.strictEqual(emulatorSourceOverride.get(242050), 'steam');
      assert.strictEqual(emulatorSourceOverride.get(3751950), 'ubisoft');
    });

    await test('survives a fresh require (simulated restart)', async () => {
      delete require.cache[require.resolve(modulePath)];
      const reloaded = require(modulePath);
      reloaded.setUserDataPath(temp);
      assert.strictEqual(reloaded.get(3751950), 'ubisoft');
      assert.strictEqual(reloaded.get(242050), 'steam');
    });

    await test('set(null) ("Automatic") clears a previously stored override', async () => {
      emulatorSourceOverride.set(3751950, null);
      assert.strictEqual(emulatorSourceOverride.get(3751950), null);
      assert.strictEqual(emulatorSourceOverride.get(242050), 'steam', 'unrelated entries stay intact');
    });

    await test('an invalid value is ignored (not persisted as a truthy override)', async () => {
      emulatorSourceOverride.set(99999, 'bogus');
      assert.strictEqual(emulatorSourceOverride.get(99999), null);
    });

    await test('corrupt store file → get() fails safe to null instead of throwing', async () => {
      fs.writeFileSync(storeFile, '{not valid json');
      assert.strictEqual(emulatorSourceOverride.get(242050), null);
    });

    console.log(`PASS: emulatorSourceOverride (${passed} checks)`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
