'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const state = require(path.join(__dirname, '..', 'queryUserNotificationState.js'));

// SHQueryUserNotificationState tells us when Windows will accept a toast but never pop it on
// screen. Achievement toasts are fired while the game is on top, playtime toasts after it exits —
// which is exactly why one kind looked broken and the other did not (issue #18).
test('full-screen and quiet-hours states are the ones that swallow toast popups', () => {
  for (const suppressed of ['QUNS_BUSY', 'QUNS_RUNNING_D3D_FULL_SCREEN', 'QUNS_PRESENTATION_MODE', 'QUNS_APP', 'QUNS_QUIET_TIME']) {
    assert.ok(state.POPUP_SUPPRESSED_STATES.includes(suppressed), `${suppressed} must count as suppressed`);
  }
  assert.ok(!state.POPUP_SUPPRESSED_STATES.includes('QUNS_ACCEPTS_NOTIFICATIONS'));
  assert.ok(!state.POPUP_SUPPRESSED_STATES.includes('QUNS_NOT_PRESENT'));
});

// Quiet hours mute popups but do not mean a game is on screen, so it must not make the watchdog
// believe a watched process is running.
test('quiet hours is not treated as a running full-screen app', () => {
  assert.ok(!state.FULLSCREEN_STATES.includes('QUNS_QUIET_TIME'));
  assert.deepStrictEqual(
    state.FULLSCREEN_STATES.filter((s) => !state.POPUP_SUPPRESSED_STATES.includes(s)),
    []
  );
});

test('an unreadable notification state never suppresses a notification', async () => {
  // resolvePowerShell()/SHQueryUserNotificationState cannot answer off Windows: the query fails and
  // both predicates must answer false rather than guess.
  assert.strictEqual(await state.queryUserNotificationState(), null);
  assert.strictEqual(await state.arePopupsSuppressed(), false);
  assert.strictEqual(await state.isFullscreenAppRunning(), false);
});
