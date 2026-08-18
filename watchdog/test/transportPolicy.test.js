'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const policy = require(path.join(__dirname, '..', 'notification', 'transportPolicy.js'));

// The signal set a healthy resident app produces with nothing covering the screen.
function healthy(overrides = {}) {
  return { overlayHost: 'ipc', overlayHidden: false, remembered: null, ...overrides };
}

function plan(mode, signals = healthy(), extra = {}) {
  return policy.planDelivery({ mode, signals, ...extra });
}

test.beforeEach(() => policy._reset());

test('Automatic shows the overlay when nothing says it would go unseen', () => {
  const result = plan('auto');
  assert.equal(result.overlay, true);
  assert.equal(result.toast, false);
  assert.equal(result.fallbackToToast, true, 'a definite overlay failure must still be allowed to reach a toast');
  assert.equal(result.reason, policy.REASON.OVERLAY);
});

// An always-on-top window is not composited over an exclusive full-screen D3D swap chain: the popup
// would play where nobody can see it, which is the case the whole automatic mode exists for.
test('Automatic switches to Windows notifications in exclusive fullscreen', () => {
  const result = plan('auto', healthy({ overlayHidden: true }));
  assert.deepEqual(
    { overlay: result.overlay, toast: result.toast, reason: result.reason },
    { overlay: false, toast: true, reason: policy.REASON.FULLSCREEN_HIDDEN }
  );
});

// Without the IPC channel the app cannot report what became of a popup. Automatic is defined by
// acting on observed outcomes, so it uses the transport whose result this process can account for.
test('Automatic will not use an overlay whose outcome cannot be observed', () => {
  const result = plan('auto', healthy({ overlayHost: 'spawn' }));
  assert.equal(result.overlay, false);
  assert.equal(result.toast, true);
  assert.equal(result.reason, policy.REASON.OVERLAY_UNAVAILABLE);
});

test('a definite overlay failure parks Automatic on toasts, and a success releases it at once', () => {
  policy.recordOverlayFailure(1000);
  assert.equal(plan('auto', healthy(), { now: 1000 + policy.OVERLAY_COOLDOWN_MS - 1 }).reason, policy.REASON.OVERLAY_FAILING);
  // Self-healing: a broken preset that gets fixed must not cost notifications until a restart.
  assert.equal(plan('auto', healthy(), { now: 1000 + policy.OVERLAY_COOLDOWN_MS + 1 }).overlay, true);

  policy.recordOverlayFailure(1000);
  policy.recordOverlaySuccess();
  assert.equal(plan('auto', healthy(), { now: 1500 }).overlay, true);
});

/*
  The per-game memory is a tie-breaker for the case where the live query failed, never a substitute
  for it: a game that once needed a toast must go back to the overlay as soon as Windows says the
  screen is clear, or the memory would make one bad session permanent.
*/
test('what worked for a game only decides when the live signal cannot be read', () => {
  assert.equal(plan('auto', healthy({ overlayHidden: null, remembered: 'toast' })).reason, policy.REASON.REMEMBERED_TOAST);
  assert.equal(plan('auto', healthy({ overlayHidden: false, remembered: 'toast' })).overlay, true);
  assert.equal(plan('auto', healthy({ overlayHidden: null, remembered: 'overlay' })).overlay, true);
  assert.equal(plan('auto', healthy({ overlayHidden: null, remembered: null })).overlay, true);
});

test('Windows notification mode never spawns an overlay, whatever the signals say', () => {
  for (const signals of [healthy(), healthy({ overlayHidden: true }), healthy({ overlayHost: 'spawn' })]) {
    const result = plan('toast', signals);
    assert.deepEqual(
      { overlay: result.overlay, toast: result.toast, fallbackToToast: result.fallbackToToast },
      { overlay: false, toast: true, fallbackToToast: false }
    );
    assert.equal(result.reason, policy.REASON.FORCED_TOAST);
  }
});

/*
  "Prefer the overlay" holds the overlay through the prediction that it will be invisible - that is
  the user's call and a prediction is not an outcome. It gives way only to a reported failure, where
  the alternative is no notification at all.
*/
test('overlay mode keeps the overlay in fullscreen but stays open to a reported failure', () => {
  const hidden = plan('overlay', healthy({ overlayHidden: true }));
  assert.equal(hidden.overlay, true);
  assert.equal(hidden.toast, false);
  assert.equal(hidden.fallbackToToast, true);
  assert.equal(hidden.reason, policy.REASON.FORCED_OVERLAY);

  policy.recordOverlayFailure(1000);
  assert.equal(plan('overlay', healthy(), { now: 1100 }).overlay, true, 'the cooldown is an Automatic rule, not a forced-mode one');
});

test('Both fires both transports and asks for no fallback', () => {
  const result = plan('both', healthy({ overlayHidden: true }));
  assert.equal(result.overlay, true);
  assert.equal(result.toast, true);
  assert.equal(result.fallbackToToast, false, 'a fallback beside a planned toast would be the duplicate');
});

test('an unknown or absent mode is treated as Automatic rather than as no notification', () => {
  for (const mode of [undefined, null, '', 'gntp', 'chromium']) {
    assert.equal(policy.normalizeMode(mode), 'auto');
    assert.equal(plan(mode).overlay, true);
  }
});

// The broadcast is a separate feature: external clients keep receiving unlocks whichever popup the
// user sees, and turning it off must not depend on the display transport.
test('the websocket broadcast follows its own setting', () => {
  assert.equal(plan('toast', healthy(), { websocket: true }).websocket, true);
  assert.equal(plan('toast', healthy(), { websocket: false }).websocket, false);
  assert.equal(plan('auto', healthy(), { websocket: false }).websocket, true);
});
