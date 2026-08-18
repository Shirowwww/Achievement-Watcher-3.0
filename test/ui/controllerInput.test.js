'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// Pure binding logic of the ported native-controller input manager (no koffi/hardware needed).
const {
  normalizeControllerBinding,
  matchesControllerBinding,
  matchesNormalizedBinding,
  createNormalizedBindingCache,
  normalizeControllerButtonName,
  normalizeBackendPreference,
  XINPUT_BUTTONS,
  DEFAULT_OVERLAY_CONTROLLER_TOGGLE_BINDING,
  DEFAULT_OVERLAY_CONTROLLER_CONTROL_MODE_BINDING,
  DEFAULT_OVERLAY_CONTROLLER_UI_MODE_BINDING,
} = require('../../watchdog/console/controller/controller-input-manager.js');

// The renderer (app/util/controllerLabels.js) and the watchdog (controller-input-manager.js) each
// keep their own hand-written copy of the canonical button vocabulary - app/ ships to the browser
// via a <script> tag and watchdog/ is a separate npm package with its own node_modules, packaged
// standalone (electron-builder copies ../watchdog beside the app.asar rather than into it), so a
// plain require() across the two at runtime would work in dev but break the installed build. Until
// that's worth a real build-time sharing mechanism, this test is the tripwire for the two vocabularies
// silently drifting apart.
const controllerLabels = require('../../app/util/controllerLabels.js');

test('normalizeControllerButtonName accepts known names case-insensitively and rejects junk', () => {
  assert.equal(normalizeControllerButtonName('start'), 'START');
  assert.equal(normalizeControllerButtonName(' Back '), 'BACK');
  assert.equal(normalizeControllerButtonName('GUIDE'), 'GUIDE');
  assert.equal(normalizeControllerButtonName('NOPE'), null);
});

test('normalizeControllerBinding parses "BACK+START" into a canonical, order-normalized array', () => {
  assert.deepEqual(normalizeControllerBinding('START+BACK'), ['BACK', 'START']);
  assert.deepEqual(normalizeControllerBinding(['LEFT_SHOULDER', 'RIGHT_SHOULDER']), ['LEFT_SHOULDER', 'RIGHT_SHOULDER']);
  assert.deepEqual(normalizeControllerBinding('X+LEFT_SHOULDER+A'), ['A', 'X', 'LEFT_SHOULDER']);
});

test('normalizeControllerBinding de-duplicates and drops unknown buttons', () => {
  assert.deepEqual(normalizeControllerBinding('A+A+ZZZ'), ['A']);
});

test('normalizeControllerBinding accepts up to three buttons and rejects a fourth', () => {
  assert.deepEqual(normalizeControllerBinding('A+B+X'), ['A', 'B', 'X']);
  assert.equal(normalizeControllerBinding('A+B+X+Y'), null);
});

test('normalizeControllerBinding falls back to the default when the value is unusable', () => {
  assert.deepEqual(
    normalizeControllerBinding('ZZZ', { defaultBinding: DEFAULT_OVERLAY_CONTROLLER_TOGGLE_BINDING }),
    ['BACK', 'START', 'LEFT_SHOULDER']
  );
});

test('matchesControllerBinding is true only when every bound button is pressed', () => {
  const both = XINPUT_BUTTONS.BACK | XINPUT_BUTTONS.START;
  assert.equal(matchesControllerBinding({ buttons: both }, ['BACK', 'START']), true);
  assert.equal(matchesControllerBinding({ buttons: XINPUT_BUTTONS.BACK }, ['BACK', 'START']), false);
  assert.equal(matchesControllerBinding({ buttons: XINPUT_BUTTONS.A }, ['A']), true);
  const three = XINPUT_BUTTONS.A | XINPUT_BUTTONS.B | XINPUT_BUTTONS.X;
  assert.equal(matchesControllerBinding({ buttons: three }, ['A', 'B', 'X']), true);
  assert.equal(matchesControllerBinding({ buttons: three }, ['A', 'B', 'Y']), false);
});

test('matchesControllerBinding reads the GUIDE (system) button from systemButtons', () => {
  assert.equal(matchesControllerBinding({ buttons: 0, systemButtons: 0x1 }, ['GUIDE']), true);
  assert.equal(matchesControllerBinding({ buttons: 0, systemButtons: 0 }, ['GUIDE']), false);
});

test('the default ui-mode and control-mode bindings share LEFT_SHOULDER, so both combos can be held at once', () => {
  // Documents why processModeToggleActions() gates the ui-mode press on
  // !isControlModeHoldPressed(): holding LB+RB+X satisfies both default bindings
  // simultaneously, and control-mode is given priority over the ui-mode toggle.
  const held = XINPUT_BUTTONS.LEFT_SHOULDER | XINPUT_BUTTONS.RIGHT_SHOULDER | XINPUT_BUTTONS.X;
  assert.equal(matchesControllerBinding({ buttons: held }, DEFAULT_OVERLAY_CONTROLLER_UI_MODE_BINDING), true);
  assert.equal(matchesControllerBinding({ buttons: held }, DEFAULT_OVERLAY_CONTROLLER_CONTROL_MODE_BINDING), true);
});

test('matchesNormalizedBinding agrees with matchesControllerBinding for an already-normalized array', () => {
  // The hot poll-tick path pre-normalizes once and calls matchesNormalizedBinding() directly,
  // skipping matchesControllerBinding()'s own normalizeControllerBinding() call. Both must agree.
  const three = XINPUT_BUTTONS.A | XINPUT_BUTTONS.B | XINPUT_BUTTONS.X;
  const normalized = normalizeControllerBinding('X+A+B');
  assert.equal(
    matchesNormalizedBinding({ buttons: three }, normalized),
    matchesControllerBinding({ buttons: three }, 'X+A+B')
  );
  assert.equal(matchesNormalizedBinding({ buttons: three }, normalized), true);
  assert.equal(matchesNormalizedBinding({ buttons: XINPUT_BUTTONS.A }, normalized), false);
  assert.equal(matchesNormalizedBinding({ buttons: 0, systemButtons: 0x1 }, ['GUIDE']), true);
  assert.equal(matchesNormalizedBinding(0, null), false, 'an unnormalizable binding never matches');
});

test('createNormalizedBindingCache only re-normalizes when the raw value actually changes', () => {
  const cache = createNormalizedBindingCache();
  const first = cache('LEFT_SHOULDER+X');
  assert.deepEqual(first, normalizeControllerBinding('LEFT_SHOULDER+X'));

  // Same raw string reference: must return the exact same array instance (cache hit).
  const second = cache('LEFT_SHOULDER+X');
  assert.strictEqual(second, first, 'unchanged raw input must be served from cache, not re-normalized');

  // A settings change (a new raw value) must produce a fresh, correctly normalized result.
  const third = cache('BACK+START');
  assert.deepEqual(third, ['BACK', 'START']);
  assert.notStrictEqual(third, first);

  // Switching back to the previous raw value re-normalizes rather than reusing a stale two-slot cache.
  const fourth = cache('LEFT_SHOULDER+X');
  assert.deepEqual(fourth, normalizeControllerBinding('LEFT_SHOULDER+X'));
});

test('the renderer and watchdog agree on the full canonical button vocabulary', () => {
  // Every button the renderer (app/util/controllerLabels.js) knows about must be accepted by the
  // watchdog's own normalizer, and vice versa - otherwise a binding that validates and displays
  // correctly in Settings could silently fail to match at runtime, or a button the watchdog accepts
  // could never be selected in the UI.
  for (const name of controllerLabels.CONTROLLER_BUTTON_ORDER) {
    assert.equal(
      normalizeControllerButtonName(name),
      name,
      `watchdog does not recognize renderer button "${name}"`
    );
  }
  for (const name of ['BACK', 'START', 'GUIDE', 'A', 'B', 'X', 'Y', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_THUMB', 'RIGHT_THUMB', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT']) {
    assert.ok(
      controllerLabels.CONTROLLER_BUTTON_ORDER.includes(name),
      `renderer does not recognize watchdog button "${name}"`
    );
  }
  assert.equal(controllerLabels.CONTROLLER_BUTTON_ORDER.length, 15);
});

test('normalizeBackendPreference clamps to the known set', () => {
  assert.equal(normalizeBackendPreference('XInput'), 'xinput');
  assert.equal(normalizeBackendPreference('gameinput'), 'gameinput');
  assert.equal(normalizeBackendPreference('whatever'), 'auto');
  assert.equal(normalizeBackendPreference(''), 'auto');
});
