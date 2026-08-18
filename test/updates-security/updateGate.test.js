'use strict';

/*
  The app re-checks for updates every hour and stays resident all day, so an answer the update
  prompt forgets becomes a dialog every hour. These tests pin what each answer remembers.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.join(__dirname, '..', '..', 'app');
const gate = require(path.join(appRoot, 'util', 'updateGate.js'));

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-08-11T12:00:00Z');
const fresh = () => ({ skippedVersion: 'none', updatePostponedVersion: '', updatePostponedUntil: 0 });

test('a first offer is shown', () => {
  assert.deepEqual(gate.shouldSuppressUpdatePrompt(fresh(), '3.9.0', { now: T0 }), { suppress: false, reason: '' });
});

/*
  Reading latest.yml is how "am I up to date?" is answered, so the fetch itself cannot be skipped.
  What it must never cost is a dialog or an installer download for something already installed: a
  re-published release, a stale cached manifest, or a local build ahead of the published tag.
*/
test('a version that is not newer than the installed one is never offered', () => {
  const same = gate.shouldSuppressUpdatePrompt(fresh(), '3.9.0', { now: T0, currentVersion: '3.9.0' });
  assert.deepEqual(same, { suppress: true, reason: 'not-newer' }, 'the running version must not be offered to itself');

  const older = gate.shouldSuppressUpdatePrompt(fresh(), '3.8.0', { now: T0, currentVersion: '3.9.0' });
  assert.deepEqual(older, { suppress: true, reason: 'not-newer' }, 'a rolled-back release must not be offered');

  // A local build ahead of the published tag: the published one is not an upgrade.
  const ahead = gate.shouldSuppressUpdatePrompt(fresh(), '3.9.0', { now: T0, currentVersion: '3.10.0' });
  assert.equal(ahead.suppress, true, 'a published version older than the local build must not be offered');

  const newer = gate.shouldSuppressUpdatePrompt(fresh(), '3.9.1', { now: T0, currentVersion: '3.9.0' });
  assert.deepEqual(newer, { suppress: false, reason: '' }, 'a genuinely newer version must still be offered');
});

test('"not newer" beats an explicit manual check, which only overrules a postpone', () => {
  const general = Object.assign(fresh(), gate.postponePatch('3.9.0', T0));
  // Manual re-check while already on the latest version: still nothing to offer.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { manual: true, now: T0, currentVersion: '3.9.0' }).reason, 'not-newer');
  // The same manual check does overrule the postpone once a newer version exists.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.1', { manual: true, now: T0, currentVersion: '3.9.0' }).suppress, false);
});

test('an unreadable version on either side is left to electron-updater rather than suppressed', () => {
  // Suppressing on a version string this cannot parse would hide real updates.
  assert.equal(gate.isNotAnUpgrade('', '3.9.0'), false);
  assert.equal(gate.isNotAnUpgrade('3.9.1', ''), false);
  assert.equal(gate.isNotAnUpgrade('not-a-version', '3.9.0'), false);
  assert.equal(gate.shouldSuppressUpdatePrompt(fresh(), '3.9.1', { now: T0 }).suppress, false, 'no currentVersion must not suppress');
});

test('"Later" silences the same version for a day, not just for the moment', () => {
  const general = Object.assign(fresh(), gate.postponePatch('3.9.0', T0));

  // The bug: the hourly re-check used to re-open the dialog an hour later, and every hour after.
  for (const hours of [1, 2, 5, 12, 23]) {
    const { suppress, reason } = gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 + hours * HOUR });
    assert.equal(suppress, true, `still prompting after ${hours}h`);
    assert.equal(reason, 'postponed');
  }

  // …and it expires on its own rather than silencing the update forever.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 + 25 * HOUR }).suppress, false);
});

test('a postponed version never hides a newer release', () => {
  const general = Object.assign(fresh(), gate.postponePatch('3.9.0', T0));
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.1', { now: T0 + HOUR }).suppress, false);
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '4.0.0', { now: T0 + HOUR }).suppress, false);
  // An older build being re-offered stays silent.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.8.9', { now: T0 + HOUR }).suppress, true);
});

test('"Skip this version" is permanent and survives any deadline', () => {
  const general = Object.assign(fresh(), { skippedVersion: '3.9.0' });
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 + 400 * HOUR }).suppress, true);
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 + 400 * HOUR }).reason, 'skipped');
  // Still permanent when the user explicitly asks for a check.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { manual: true, now: T0 }).suppress, true);
  // But a newer version is still offered.
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.10.0', { now: T0 }).suppress, false);
});

test('an explicit "Check for updates" overrules a postpone', () => {
  const general = Object.assign(fresh(), gate.postponePatch('3.9.0', T0));
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 + HOUR }).suppress, true);
  assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { manual: true, now: T0 + HOUR }).suppress, false);

  const cleared = Object.assign({}, general, gate.clearPostponePatch());
  assert.equal(gate.shouldSuppressUpdatePrompt(cleared, '3.9.0', { now: T0 + HOUR }).suppress, false);
});

test('junk in the config never suppresses an update or throws', () => {
  for (const general of [
    {},
    null,
    { skippedVersion: 'none' },
    { skippedVersion: '' },
    { updatePostponedVersion: 'not-a-version', updatePostponedUntil: T0 + HOUR },
    { updatePostponedVersion: '3.9.0', updatePostponedUntil: 'tomorrow' },
    { updatePostponedVersion: '3.9.0', updatePostponedUntil: NaN },
  ]) {
    assert.equal(gate.shouldSuppressUpdatePrompt(general, '3.9.0', { now: T0 }).suppress, false, `suppressed for ${JSON.stringify(general)}`);
  }
});

test('a running game pushes the next check out, and a finished session pulls it in', () => {
  const { INTERVALS } = gate;
  assert.equal(gate.nextCheckDelayMs({}), INTERVALS.recheck);
  assert.equal(gate.nextCheckDelayMs({ failed: true }), INTERVALS.retry);
  assert.equal(gate.nextCheckDelayMs({ gameRunning: true }), INTERVALS.inGame);
  // Playing wins over a failed check: neither should interrupt the session.
  assert.equal(gate.nextCheckDelayMs({ gameRunning: true, failed: true }), INTERVALS.inGame);

  assert.ok(INTERVALS.inGame < INTERVALS.recheck, 'an in-game re-check must come back sooner than the hourly one');
  assert.ok(INTERVALS.afterGame < INTERVALS.inGame, 'a finished session must be noticed quickly');
  assert.ok(INTERVALS.afterGame >= 30 * 1000, 'but not so fast it lands during the game-exit shuffle');
});

test('nothing is recorded when a prompt is only held back for a game', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  const start = init.indexOf("autoUpdater.on('update-available'");
  const body = init.slice(start, init.indexOf("autoUpdater.on('update-not-available'"));
  const heldBack = body.slice(body.indexOf('isGameRunning()'), body.indexOf('dialog.showMessageBox'));
  assert.ok(!/postponeUpdate|skippedVersion/.test(heldBack), 'holding a prompt back must not answer for the user');
  // A manual check is a deliberate request and must still be answered.
  assert.match(body, /if \(!manual && isGameRunning\(\)\)/);
});

test('the monitor is the only source of game activity, and losing it never wedges the updater', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  const watchdog = fs.readFileSync(path.join(appRoot, '..', 'watchdog', 'watchdog.js'), 'utf8');

  // The watchdog owns the process monitor and pushes every change.
  assert.match(watchdog, /process\.send\(\{ gameActivity: \{ count: runningGames\.length \} \}\)/);
  assert.match(watchdog, /forwardGameActivity\(\);/);
  assert.ok((watchdog.match(/forwardGameActivity\(\)/g) || []).length >= 3, 'startup state + launch/exit must all be published');

  // The app consumes it, and clears the count if the monitor dies mid-session - otherwise a stuck
  // "a game is running" would silence updates forever.
  assert.match(init, /msg\.gameActivity\) setGameActivity\(msg\.gameActivity\.count\)/);
  assert.strictEqual((init.match(/setGameActivity\(0\)/g) || []).length, 2, 'both monitor-loss paths must reset the count');
});

test('the download prompt claims the dialog before its first await', () => {
  // Checking a flag, awaiting, then setting it lets two checks landing in the same tick (the hourly
  // timer racing the Settings button) both walk past the guard and stack two dialogs.
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  for (const event of ['update-available']) {
    const start = init.indexOf(`autoUpdater.on('${event}'`);
    assert.ok(start > 0, `no ${event} handler`);
    const body = init.slice(start, start + 2600);
    const claim = body.indexOf('updatePromptOpen = true');
    const firstAwait = body.indexOf('await ');
    assert.ok(claim > 0, `${event}: never claims the prompt`);
    assert.ok(firstAwait > 0, `${event}: expected an await in the handler`);
    assert.ok(claim < firstAwait, `${event}: claims the prompt only AFTER awaiting - two events can stack dialogs`);
  }
});

test('the single consent prompt persists Later and a downloaded update installs silently', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  // A fire-and-forget save can be lost if the app quits right after the click.
  assert.ok(!/(?<!await )settingsJS\.save\(configJS\)/.test(init), 'settings must be awaited when recording an update answer');
  assert.match(init, /await postponeUpdate\(info\.version\)/);
  assert.strictEqual((init.match(/await postponeUpdate\(info\.version\)/g) || []).length, 1, 'the download prompt must record "Later"');
  assert.match(init, /autoUpdater\.quitAndInstall\(true, true\)/);
});

/*
  A permanently resident Steam app (a controller utility, an overlay tool) is a running game by
  every signal AW has, for as long as the machine is on. That made the install hold-back permanent:
  every check downloaded the update and none of them installed it, and because the retry only fires
  when the last game exits, nothing ever said why. An explicitly requested update overrides it.
*/
test('an update the user asked for installs even while a game is running', () => {
  assert.strictEqual(gate.shouldHoldInstall({ gameRunning: true, acceptedManually: true }), false);
});

test('an update that arrived on its own still waits for the game to end', () => {
  assert.strictEqual(gate.shouldHoldInstall({ gameRunning: true, acceptedManually: false }), true);
});

test('nothing is held back when no game is running, however it was accepted', () => {
  assert.strictEqual(gate.shouldHoldInstall({ gameRunning: false, acceptedManually: false }), false);
  assert.strictEqual(gate.shouldHoldInstall({ gameRunning: false, acceptedManually: true }), false);
  assert.strictEqual(gate.shouldHoldInstall({}), false, 'defaults must not hold an install');
});

test('the manual acceptance is carried from the prompt to the install step', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  // The flag only means anything if the accept path records it and the install path reads it.
  assert.match(init, /updateAcceptedManually = manual;/, 'the accepted download must record whether the check was manual');
  assert.match(
    init,
    /shouldHoldInstall\(\{ gameRunning: isGameRunning\(\), acceptedManually: updateAcceptedManually \}\)/,
    'the install step must ask the gate, not isGameRunning() alone'
  );
  // A held-back install that says nothing is indistinguishable from a broken updater.
  assert.match(init, /notifyUpdateHeldBack\(info\.version\)/, 'a held-back install must tell the user');
});
