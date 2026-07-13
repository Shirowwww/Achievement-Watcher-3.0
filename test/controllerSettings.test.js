'use strict';

// Verifies the watchdog settings loader materializes the [controller] section (Tier 4) with sane
// defaults, coerces bad values, and preserves valid user choices across a load → rewrite round-trip.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const settings = require('../watchdog/settings.js');
const ini = require('../watchdog/util/ini.js');

// The loader falls back to a full default config if any section is missing, so start from a complete
// options.ini: load once on an empty file (which writes the defaults to disk), then mutate from there.
async function freshDefaultIniFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ctl-settings-'));
  const file = path.join(dir, 'options.ini');
  fs.writeFileSync(file, '', 'utf8');
  await settings.load(file); // materializes + persists the full default config
  return file;
}

async function loadWithController(patch) {
  const file = await freshDefaultIniFile();
  const opts = ini.parse(fs.readFileSync(file, 'utf8'));
  opts.controller = { ...opts.controller, ...patch };
  fs.writeFileSync(file, ini.stringify(opts), 'utf8');
  return settings.load(file);
}

test('defaults the controller section when absent', async () => {
  const file = await freshDefaultIniFile();
  const opts = await settings.load(file);
  assert.equal(opts.controller.enabled, false);
  assert.equal(opts.controller.backend, 'auto');
  assert.equal(opts.controller.toggleBinding, 'BACK+START');
  assert.equal(opts.controller.controlModeBinding, 'LEFT_SHOULDER+RIGHT_SHOULDER');
  assert.equal(opts.controller.debugLogging, false);
});

test('coerces an invalid backend back to auto and keeps a valid one', async () => {
  const bad = await loadWithController({ enabled: true, backend: 'bogus' });
  assert.equal(bad.controller.backend, 'auto');
  assert.equal(bad.controller.enabled, true);

  const good = await loadWithController({ enabled: true, backend: 'xinput' });
  assert.equal(good.controller.backend, 'xinput');
  assert.equal(good.controller.enabled, true);
});

test('preserves custom bindings across a load round-trip', async () => {
  const opts = await loadWithController({ toggleBinding: 'GUIDE', controlModeBinding: 'A+B' });
  assert.equal(opts.controller.toggleBinding, 'GUIDE');
  assert.equal(opts.controller.controlModeBinding, 'A+B');
});
