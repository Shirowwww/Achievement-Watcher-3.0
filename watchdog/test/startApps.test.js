'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const startApps = require('../util/startApps.js');

test('isValidAUMID accepts both packaged and desktop app ids', () => {
  assert.equal(startApps.isValidAUMID('Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App'), true);
  // Achievement Watcher's own identity, carried by the installer's Start Menu shortcut. The old
  // check required the packaged "family!app" shape and rejected it, so the app's real app id was
  // reported as invalid on every start (issue #8).
  assert.equal(startApps.isValidAUMID('io.github.shirowwww.achievement.watcher'), true);
});

test('isValidAUMID rejects what Windows itself rejects', () => {
  assert.equal(startApps.isValidAUMID('bad id_with-space!App'), false);
  assert.equal(startApps.isValidAUMID('x'.repeat(129)), false);
  assert.equal(startApps.isValidAUMID(''), false);
  assert.equal(startApps.isValidAUMID(null), false);
});

test('isPackagedAUMID separates MSIX identities from desktop ones', () => {
  // Only a packaged identity may load http(s) toast images; a desktop id needs local files.
  assert.equal(startApps.isPackagedAUMID('Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App'), true);
  assert.equal(startApps.isPackagedAUMID('io.github.shirowwww.achievement.watcher'), false);
  assert.equal(startApps.isPackagedAUMID('Microsoft.XboxGamingOverlay'), false);
});

test('hasAumid does an exact Start Menu lookup and never throws', async () => {
  assert.equal(await startApps.hasAumid(''), false);
  assert.equal(await startApps.hasAumid(null), false);

  // A pre-fetched list keeps this offline and deterministic; the same call without one shells out
  // to Get-StartApps once for every candidate at start-up.
  const known = ['io.github.shirowwww.achievement.watcher', 'microsoft.xboxgamingoverlay_8wekyb3d8bbwe!app'];
  assert.equal(await startApps.hasAumid('io.github.shirowwww.achievement.watcher', known), true);
  assert.equal(await startApps.hasAumid('Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App', known), true, 'lookup is case-insensitive');
  assert.equal(await startApps.hasAumid('Microsoft.XboxApp_8wekyb3d8bbwe!Microsoft.XboxApp', known), false);

  assert.equal(typeof (await startApps.hasAumid('Definitely.Not.A.Real.App_12345678!App')), 'boolean');
  assert.ok(Array.isArray(await startApps.listAumids()));
});
