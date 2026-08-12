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
const controllerLabels = require('../app/util/controllerLabels.js');

// The loader falls back to a full default config if any section is missing, so start from a complete
// options.ini: load once on an empty file (which writes the defaults to disk), then mutate from there.
async function freshDefaultIniFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ctl-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'options.ini');
  fs.writeFileSync(file, '', 'utf8');
  await settings.load(file); // materializes + persists the full default config
  return file;
}

async function loadWithController(patch, t) {
  const file = await freshDefaultIniFile(t);
  const opts = ini.parse(fs.readFileSync(file, 'utf8'));
  opts.controller = { ...opts.controller, ...patch };
  fs.writeFileSync(file, ini.stringify(opts), 'utf8');
  return settings.load(file);
}

test('defaults the controller section when absent', async (t) => {
  const file = await freshDefaultIniFile(t);
  const opts = await settings.load(file);
  assert.equal(opts.controller.enabled, false);
  assert.equal(opts.controller.appNavigation, true);
  assert.equal(opts.controller.backend, 'auto');
  assert.equal(opts.controller.layout, 'auto');
  assert.equal(opts.controller.toggleBinding, 'BACK+START');
  assert.equal(opts.controller.uiModeBinding, 'LEFT_SHOULDER+X');
  assert.equal(opts.controller.controlModeBinding, 'LEFT_SHOULDER+RIGHT_SHOULDER');
  assert.equal(opts.controller.focusOverlay, false);
  assert.equal(opts.controller.sendEscapeOnControllerOpen, false);
  assert.equal(opts.controller.debugLogging, false);
});

test('coerces an invalid backend back to auto and keeps a valid one', async (t) => {
  const bad = await loadWithController({ enabled: true, backend: 'bogus' }, t);
  assert.equal(bad.controller.backend, 'auto');
  assert.equal(bad.controller.enabled, true);

  const good = await loadWithController({ enabled: true, backend: 'xinput' }, t);
  assert.equal(good.controller.backend, 'xinput');
  assert.equal(good.controller.enabled, true);
});

test('preserves custom bindings across a load round-trip', async (t) => {
  const opts = await loadWithController({
    appNavigation: false,
    toggleBinding: 'BACK+START+GUIDE',
    uiModeBinding: 'LEFT_SHOULDER+A+X',
    controlModeBinding: 'A+B+LEFT_SHOULDER',
  }, t);
  assert.equal(opts.controller.appNavigation, false);
  assert.equal(opts.controller.toggleBinding, 'BACK+START+GUIDE');
  assert.equal(opts.controller.uiModeBinding, 'LEFT_SHOULDER+A+X');
  assert.equal(opts.controller.controlModeBinding, 'A+B+LEFT_SHOULDER');
});

test('coerces invalid controller settings back to defaults', async (t) => {
  const opts = await loadWithController({
    layout: 'dreamcast',
    toggleBinding: 'ZZZ+START',
    uiModeBinding: 'LEFT_TRIGGER+X',
    controlModeBinding: 'A',
    focusOverlay: 'yes',
    sendEscapeOnControllerOpen: 'yes',
  }, t);
  assert.equal(opts.controller.layout, 'auto');
  assert.equal(opts.controller.toggleBinding, 'BACK+START');
  assert.equal(opts.controller.uiModeBinding, 'LEFT_SHOULDER+X');
  assert.equal(opts.controller.controlModeBinding, 'A');
  assert.equal(opts.controller.focusOverlay, false);
  assert.equal(opts.controller.sendEscapeOnControllerOpen, false);
});

test('keeps sendEscapeOnControllerOpen enabled across a load round-trip', async (t) => {
  const opts = await loadWithController({ sendEscapeOnControllerOpen: true }, t);
  assert.equal(opts.controller.sendEscapeOnControllerOpen, true);
});

test('rejects bindings with more than three buttons', async (t) => {
  const opts = await loadWithController({
    toggleBinding: 'BACK+START+GUIDE+A',
    controlModeBinding: 'A+B+X+Y',
  }, t);
  assert.equal(opts.controller.toggleBinding, 'BACK+START');
  assert.equal(opts.controller.controlModeBinding, 'LEFT_SHOULDER+RIGHT_SHOULDER');
});

test('Share + Square (BACK + X) survives settings and matches the Gamepad API', async (t) => {
  const opts = await loadWithController({ uiModeBinding: 'BACK+X' }, t);
  assert.equal(opts.controller.uiModeBinding, 'BACK+X');
  const gamepad = { buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  gamepad.buttons[8].pressed = true; // Share
  gamepad.buttons[2].pressed = true; // Square
  assert.equal(controllerLabels.comboPressed(gamepad, opts.controller.uiModeBinding.split('+')), true);
});
