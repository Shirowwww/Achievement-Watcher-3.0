'use strict';

/*
  Registry access. `registry-js` is a compiled addon, and a checkout whose install script never ran
  has no build/Release/registry.node at all. Before the reg.exe fallback existed that turned every
  read into null/[]/false — the same answer as "this key is not on the machine" — so Steam accounts
  (and therefore every Steam game), Uplay, GreenLuma, playtime and the avatar all went quiet with
  nothing written to any log. What matters here is that losing the binary costs speed, not answers:
  each case is run through both backends and the two must agree.
*/

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const appDir = path.join(__dirname, '..', '..', 'app');
const regPath = path.join(appDir, 'util', 'reg.js');

// Load reg.js twice: once normally, once with require('registry-js') forced to fail the same way a
// missing binary fails.
function loadReg({ breakNative }) {
  delete require.cache[require.resolve(regPath)];
  const originalResolve = Module._resolveFilename;
  if (breakNative) {
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'registry-js') {
        const err = new Error("Cannot find module '../../build/Release/registry.node'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return originalResolve.call(this, request, ...rest);
    };
  }
  try {
    return require(regPath);
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

// reg.js resolves registry-js from app/, so probe from there rather than from this file.
const nativeAvailable = (() => {
  try {
    require(require.resolve('registry-js', { paths: [appDir] }));
    return true;
  } catch {
    return false;
  }
})();

const fallback = loadReg({ breakNative: true });

// A key we control, so the assertions do not depend on what happens to be installed on the machine.
const PROBE_KEY = 'Software\\AchievementWatcherRegTest';
const PROBE_UNICODE = 'C:\\Users\\pipié\\Jeux\\Ünïcødé';

function seedProbeKey() {
  const add = (args) => execFileSync('reg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  add(['add', `HKCU\\${PROBE_KEY}`, '/v', 'Text', '/t', 'REG_SZ', '/d', PROBE_UNICODE, '/f']);
  add(['add', `HKCU\\${PROBE_KEY}`, '/v', 'Number', '/t', 'REG_DWORD', '/d', '42', '/f']);
  add(['add', `HKCU\\${PROBE_KEY}\\Child`, '/f']);
}

function removeProbeKey() {
  try {
    execFileSync('reg.exe', ['delete', `HKCU\\${PROBE_KEY}`, '/f'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    /* already gone */
  }
}

test('the fallback reads values, subkeys and existence from a real key', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  seedProbeKey();
  t.after(removeProbeKey);

  assert.equal(fallback.readRegistryString('HKCU', PROBE_KEY, 'Text'), PROBE_UNICODE);
  assert.equal(fallback.readRegistryInteger('HKCU', PROBE_KEY, 'Number'), 42);
  assert.deepEqual(fallback.listRegistryAllSubkeys('HKCU', PROBE_KEY), ['Child']);
  assert.equal(fallback.regKeyExists('HKCU', PROBE_KEY), true);
  assert.deepEqual(fallback.ListRegistryAllValues('HKCU', PROBE_KEY).sort(), ['Number', 'Text']);
});

test('non-ASCII values survive the fallback, because reg.exe prints in the OEM codepage', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  seedProbeKey();
  t.after(removeProbeKey);

  // Decoding reg.exe's output as UTF-8 without forcing the codepage turns "pipié" into "pipi?".
  const read = fallback.readRegistryString('HKCU', PROBE_KEY, 'Text');
  assert.equal(read, PROBE_UNICODE);
  assert.ok(!read.includes('\uFFFD'), 'the value must not come back with replacement characters');
});

test('a missing key is reported as missing, not as an error', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const absent = 'Software\\AchievementWatcherRegTest\\NoSuchKey';
  assert.equal(fallback.regKeyExists('HKCU', absent), false);
  assert.deepEqual(fallback.listRegistryAllSubkeys('HKCU', absent), []);
  assert.equal(fallback.readRegistryString('HKCU', absent, 'Whatever'), null);
});

test('the fallback writes values that read back', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  t.after(removeProbeKey);

  fallback.writeRegistryString('HKCU', PROBE_KEY, 'Written', 'hello world');
  fallback.writeRegistryDword('HKCU', PROBE_KEY, 'WrittenNumber', 7);

  assert.equal(fallback.readRegistryString('HKCU', PROBE_KEY, 'Written'), 'hello world');
  assert.equal(fallback.readRegistryInteger('HKCU', PROBE_KEY, 'WrittenNumber'), 7);
});

test('both backends give the same answer, so a missing binary only costs speed', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  if (!nativeAvailable) return t.skip('registry-js binary not built in this checkout');
  seedProbeKey();
  t.after(removeProbeKey);

  const native = loadReg({ breakNative: false });
  const cases = [
    ['readRegistryString', 'HKCU', PROBE_KEY, 'Text'],
    ['readRegistryInteger', 'HKCU', PROBE_KEY, 'Number'],
    ['listRegistryAllSubkeys', 'HKCU', PROBE_KEY],
    ['ListRegistryAllValues', 'HKCU', PROBE_KEY],
    ['regKeyExists', 'HKCU', PROBE_KEY],
    ['regKeyExists', 'HKCU', `${PROBE_KEY}\\NoSuchKey`],
    ['readRegistryString', 'HKCU', PROBE_KEY, 'NoSuchValue'],
    // The real reason this file exists: no Steam path meant no accounts and no Steam games.
    ['readRegistryString', 'HKCU', 'Software/Valve/Steam', 'SteamPath'],
    ['listRegistryAllSubkeys', 'HKCU', 'Software/Valve/Steam/Users'],
  ];

  for (const [fn, ...args] of cases) {
    const sortIfArray = (v) => (Array.isArray(v) ? [...v].sort() : v);
    assert.deepEqual(
      sortIfArray(fallback[fn](...args)),
      sortIfArray(native[fn](...args)),
      `${fn}(${args.join(', ')}) must agree across backends`
    );
  }
});
