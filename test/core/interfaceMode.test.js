'use strict';

/*
  The Simple / Advanced policy itself: what a stored value resolves to, what an install that predates
  the setting gets, and which tabs and Game Health checks each mode shows. This is the layer that
  decides whether a capability is on screen, so its defaults are pinned here rather than inferred
  from the renderer.
*/

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const interfaceMode = require(path.join(__dirname, '..', '..', 'app', 'util', 'interfaceMode.js'));

test('only the two real modes normalize; everything else is "not chosen"', () => {
  assert.equal(interfaceMode.normalize('simple'), 'simple');
  assert.equal(interfaceMode.normalize('Advanced'), 'advanced');
  assert.equal(interfaceMode.normalize('  SIMPLE  '), 'simple');
  for (const junk of ['', null, undefined, 'expert', 0, {}, []]) {
    assert.equal(interfaceMode.normalize(junk), '', `${JSON.stringify(junk)} must not become a mode`);
  }
});

test('an unset or unreadable mode renders as Advanced, never as Simple', () => {
  // Hiding tabs from someone who never asked for it is the failure that loses capabilities; showing
  // everything is the safe one. This asymmetry is the whole point of the fallback.
  assert.equal(interfaceMode.resolve(undefined), 'advanced');
  assert.equal(interfaceMode.resolve({}), 'advanced');
  assert.equal(interfaceMode.resolve({ general: {} }), 'advanced');
  assert.equal(interfaceMode.resolve({ general: { interfaceMode: 'nonsense' } }), 'advanced');
  assert.equal(interfaceMode.resolve({ general: { interfaceMode: 'simple' } }), 'simple');
});

test('isChosen separates a real answer from the fallback', () => {
  assert.equal(interfaceMode.isChosen({ general: { interfaceMode: '' } }), false);
  assert.equal(interfaceMode.isChosen({}), false);
  assert.equal(interfaceMode.isChosen({ general: { interfaceMode: 'advanced' } }), true);
});

test('Advanced shows every tab; Simple hides only the technical ones', () => {
  const all = [...interfaceMode.SIMPLE_VIEWS, ...interfaceMode.ADVANCED_VIEWS];
  for (const view of all) {
    assert.equal(interfaceMode.isViewVisible(view, 'advanced'), true, `${view} must exist in Advanced`);
  }
  for (const view of interfaceMode.SIMPLE_VIEWS) {
    assert.equal(interfaceMode.isViewVisible(view, 'simple'), true, `${view} is an everyday tab`);
  }
  for (const view of interfaceMode.ADVANCED_VIEWS) {
    assert.equal(interfaceMode.isViewVisible(view, 'simple'), false, `${view} belongs to Advanced`);
  }
});

test('the areas the streamlined interface is built around are all in Simple', () => {
  // Library (folder), Notifications, Appearance, Sources and Help, plus the general app settings.
  for (const view of ['general', 'appearance', 'notification', 'source', 'folder', 'help']) {
    assert.ok(interfaceMode.SIMPLE_VIEWS.includes(view), `${view} must stay in Simple`);
    assert.ok(!interfaceMode.ADVANCED_VIEWS.includes(view), `${view} must not be Advanced-only`);
  }
});

test('no tab is both everyday and Advanced-only', () => {
  for (const view of interfaceMode.ADVANCED_VIEWS) {
    assert.ok(!interfaceMode.SIMPLE_VIEWS.includes(view), `${view} is listed twice`);
  }
});

test('Game Health drops only diagnostic check rows in Simple, and nothing in Advanced', () => {
  const everyCheck = ['install', 'executable', 'identity', 'achievement-data', 'emulator', 'uplay', 'progress', 'tracking', 'notifications'];
  for (const id of everyCheck) {
    assert.equal(interfaceMode.isCheckVisible(id, 'advanced'), true, `${id} must show in Advanced`);
  }
  for (const id of everyCheck.filter((entry) => !interfaceMode.SIMPLE_HIDDEN_CHECKS.includes(entry))) {
    assert.equal(interfaceMode.isCheckVisible(id, 'simple'), true, `${id} is an outcome a player can act on`);
  }
  // The hidden ones are diagnostics only. Losing a check that can FAIL and block tracking would
  // hide a real problem, so the list must stay limited to informational rows.
  assert.deepEqual(interfaceMode.SIMPLE_HIDDEN_CHECKS, ['identity']);
});

test('the niche-source rule is asymmetric on purpose: it only ever hides a row that does nothing', () => {
  const keys = Object.keys(interfaceMode.OPTIONAL_SOURCES);
  assert.ok(keys.length > 0, 'the rule needs something to act on');
  // Every reason to KEEP a row wins over the reason to hide it. That asymmetry is the safety
  // property: the mode can hide a switch nobody needs, never one that explains a missing game.
  for (const key of keys) {
    const off = interfaceMode.hiddenOptionalSources({ mode: 'simple', enabled: { [key]: false } });
    const used = interfaceMode.hiddenOptionalSources({ mode: 'simple', librarySources: interfaceMode.OPTIONAL_SOURCES[key] });
    const both = interfaceMode.hiddenOptionalSources({
      mode: 'simple',
      enabled: { [key]: false },
      librarySources: interfaceMode.OPTIONAL_SOURCES[key],
    });
    for (const [result, why] of [[off, 'switched off'], [used, 'in use'], [both, 'off and in use']]) {
      assert.ok(!result.includes(key), `${key} is ${why} and must keep its switch`);
    }
  }
  // Explicitly enabled is the same as untouched — `true` is the default, not an opinion.
  assert.deepEqual(
    interfaceMode.hiddenOptionalSources({ mode: 'simple', enabled: Object.fromEntries(keys.map((k) => [k, true])) }).sort(),
    [...keys].sort()
  );
});

test('the policy module stays pure, so the interface cannot drift from it', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'util', 'interfaceMode.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](fs|node:fs|electron|@electron\/remote|path)['"]\)/, 'no runtime dependencies');
  assert.doesNotMatch(source, /\bt\(\s*['"]/, 'wording belongs to the renderer, not to the policy');
});
