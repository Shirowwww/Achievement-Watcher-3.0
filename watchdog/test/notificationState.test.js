'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const state = require(path.join(__dirname, '..', 'queryUserNotificationState.js'));

function loadStateModuleWithFakeQuery(now, query) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'queryUserNotificationState.js'), 'utf8');
  const fakeExecFile = () => {};
  const module = { exports: {} };
  const loadModule = new Function('require', 'module', 'exports', 'process', 'Date', source);

  loadModule((request) => {
    if (request === 'child_process') return { execFile: fakeExecFile };
    if (request === 'util') {
      return { promisify: (value) => value === fakeExecFile ? query : require('node:util').promisify(value) };
    }
    if (request === './util/powershell.js') return { resolvePowerShell: () => 'powershell.exe' };
    if (request === './util/log.js') return { warn: () => {} };
    throw new Error(`Unexpected module request: ${request}`);
  }, module, module.exports, { platform: 'win32' }, { now });

  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

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

// This regression test asserts a real state on Windows: the old version shelled out to a nonexistent
// assembly, so it passed everywhere while callers silently answered false.
test('on Windows the query returns a real notification state', { skip: process.platform !== 'win32' ? 'Windows-only' : false }, async () => {
  state._resetCache();
  const current = await state.queryUserNotificationState();
  assert.ok(
    current && Object.values(state.QUERY_USER_NOTIFICATION_STATE).includes(current),
    `expected one of ${Object.values(state.QUERY_USER_NOTIFICATION_STATE).join(', ')}, got ${JSON.stringify(current)}`
  );
  // The predicates must agree with the state rather than answering from a failed query.
  state._resetCache();
  assert.strictEqual(await state.arePopupsSuppressed(), state.POPUP_SUPPRESSED_STATES.includes(current));
  state._resetCache();
  assert.strictEqual(await state.isFullscreenAppRunning(), state.FULLSCREEN_STATES.includes(current));
});

// Off Windows the query cannot answer at all, and both predicates must say "not suppressed" rather
// than guess — a wrong guess would swallow a working notification.
test('an unreadable notification state never suppresses a notification', { skip: process.platform === 'win32' ? 'non-Windows only' : false }, async () => {
  state._resetCache();
  assert.strictEqual(await state.queryUserNotificationState(), null);
  state._resetCache();
  assert.strictEqual(await state.arePopupsSuppressed(), false);
  state._resetCache();
  assert.strictEqual(await state.isFullscreenAppRunning(), false);
});

// The state is read once per achievement in a batch unlock, so the answer has to be shared.
test('repeated reads inside the TTL are served from one query', async () => {
  let queries = 0;
  const isolated = loadStateModuleWithFakeQuery(() => 0, async () => {
    queries += 1;
    return { stdout: '5' };
  });
  const first = await isolated.queryUserNotificationState();
  for (let i = 0; i < 25; i += 1) assert.strictEqual(await isolated.queryUserNotificationState(), first);
  assert.strictEqual(queries, 1, 'cached reads must not each shell out to PowerShell');
});

test('a slow query starts the TTL when its result arrives', async () => {
  let now = 0;
  let queries = 0;
  const pending = deferred();
  const isolated = loadStateModuleWithFakeQuery(() => now, () => {
    queries += 1;
    return pending.promise;
  });

  const first = isolated.queryUserNotificationState();
  assert.strictEqual(queries, 1);

  // Simulate a slow PowerShell startup that exceeds the one-second cache TTL.
  now = 2000;
  pending.resolve({ stdout: '5' });
  assert.strictEqual(await first, 'QUNS_ACCEPTS_NOTIFICATIONS');
  assert.strictEqual(await isolated.queryUserNotificationState(), 'QUNS_ACCEPTS_NOTIFICATIONS');
  assert.strictEqual(queries, 1, 'a fresh result must remain cached for the full TTL');
});

// A batch unlock asks all at once, before any answer is cached. Without in-flight sharing every
// caller starts its own PowerShell — twenty of them, each compiling the shell32 import — which is
// exactly the burst the notification path produces when a save file unlocks a whole set.
test('a burst of simultaneous reads shares a single query', async () => {
  let queries = 0;
  const pending = deferred();
  const isolated = loadStateModuleWithFakeQuery(() => 0, () => {
    queries += 1;
    return pending.promise;
  });
  const answerPromise = Promise.all(Array.from({ length: 20 }, () => isolated.queryUserNotificationState()));
  assert.strictEqual(queries, 1, 'every caller in the burst must share the in-flight query');
  pending.resolve({ stdout: '5' });
  const answers = await answerPromise;

  assert.strictEqual(new Set(answers).size, 1, 'every caller in the burst must get the same answer');
});
