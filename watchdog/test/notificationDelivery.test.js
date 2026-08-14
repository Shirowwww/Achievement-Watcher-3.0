'use strict';

/*
  The delivery layer as a whole: one notification in, and exactly the transports the plan called for
  out. These drive notification/toaster.js with stub transports, so what is asserted is how many
  notifications a user would actually have seen — the property that matters for the fallback, since
  a fallback that fires beside a working overlay is a duplicate rather than a rescue.
*/

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// transportMemory resolves its store through AW_USER_DATA; keep this suite out of the real profile.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-notify-delivery-'));
process.env.AW_USER_DATA = USER_DATA;

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const policy = require(path.join(__dirname, '..', 'notification', 'transportPolicy.js'));
const overlayAck = require(path.join(__dirname, '..', 'notification', 'overlayAck.js'));
const transportMemory = require(path.join(__dirname, '..', 'util', 'transportMemory.js'));
require(path.join(__dirname, '..', 'util', 'userData.js')).resetCache();

const TOASTER = fs.readFileSync(path.join(__dirname, '..', 'notification', 'toaster.js'), 'utf8');

// Ack replies the fake app sends back for an overlay request, keyed by how the test set it up.
const REPLY = {
  ACCEPT: (id) => overlayAck.report(id, { stage: 'accepted', ok: true, reason: 'Shirow' }),
  REJECT: (id) => overlayAck.report(id, { stage: 'accepted', ok: false, reason: 'no-preset' }),
  SILENCE: () => {},
};

function loadToaster({ overlayHost = 'ipc', reply = REPLY.ACCEPT, fullscreen = false } = {}) {
  const calls = { overlays: [], toasts: [], balloons: [], broadcasts: [] };

  const stubs = {
    path,
    fs,
    './transport/toast.js': async (message) => {
      calls.toasts.push(message);
    },
    '../util/powerballoon': async (notification) => {
      calls.balloons.push(notification);
    },
    './prefetch.js': async (url) => url,
    '../util/squareIcon.js': { makeSquareIcon: async () => '' },
    '../util/notificationSound.js': { pickRandomSound: () => '', resolveSoundFile: () => '' },
    '../websocket.js': { broadcast: (payload) => calls.broadcasts.push(payload) },
    '../queryUserNotificationState.js': {
      arePopupsSuppressed: async () => false,
      isOverlayLikelyHidden: async () => fullscreen,
    },
    './transportPolicy.js': policy,
    '../util/transportMemory.js': transportMemory,
    // The real registry, with a wait short enough that the "no answer at all" case does not make the
    // suite sit through the production timeout.
    './overlayAck.js': { ...overlayAck, wait: (id) => overlayAck.wait(id, 50) },
    '../util/log.js': { log: () => {}, warn: () => {}, error: () => {} },
    '../watchdog.js': {
      SpawnOverlayNotification: (args) => {
        calls.overlays.push(args);
        const id = (args.find((arg) => String(arg).startsWith('--notifyId=')) || '').split('=')[1];
        if (id) reply(id);
      },
    },
    '../util/notifyStrings.js': { forLang: () => ({ achievementUnlocked: 'Achievement unlocked !' }) },
  };

  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', TOASTER)(
    (request) => {
      if (!(request in stubs)) throw new Error(`Unexpected module request: ${request}`);
      return stubs[request];
    },
    module,
    module.exports,
    { ...process, send: overlayHost === 'ipc' ? () => true : undefined, connected: overlayHost === 'ipc' }
  );

  return { notify: module.exports, calls };
}

function unlock(overrides = {}) {
  return {
    appid: '480',
    gameDisplayName: 'Spacewar',
    achievementName: 'ACH_WIN',
    achievementDisplayName: 'First blood',
    achievementDescription: 'Win a game',
    icon: 'https://example.invalid/ach.jpg',
    time: 1700000000,
    ...overrides,
  };
}

function options(mode, overrides = {}) {
  return {
    notify: true,
    lang: 'english',
    transport: { mode, websocket: false },
    toast: { appid: 'AW', winrt: true, balloonFallback: false, customAudio: '0', imageIntegration: '0' },
    prefetch: false,
    rumble: false,
    ...overrides,
  };
}

before(() => {
  fs.mkdirSync(path.join(USER_DATA, 'cfg'), { recursive: true });
});

beforeEach(() => {
  overlayAck._reset();
  policy._reset();
  transportMemory._reset();
  try {
    fs.rmSync(transportMemory.file(), { force: true });
  } catch {}
});

after(() => fs.rmSync(USER_DATA, { recursive: true, force: true }));

test('Automatic sends one overlay and no toast when the app confirms it rendered', async () => {
  const { notify, calls } = loadToaster();
  await notify(unlock(), options('auto'));
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.toasts.length, 0, 'a confirmed overlay must never be doubled by a toast');
});

test('a reported overlay failure is rescued by exactly one Windows notification', async () => {
  const { notify, calls } = loadToaster({ reply: REPLY.REJECT });
  await notify(unlock(), options('auto'));
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.toasts.length, 1, 'the user must still be told, once');
});

/*
  Silence is not failure. The process cannot tell whether a popup appeared, so sending a toast anyway
  would risk showing the same unlock twice; instead the overlay is marked unhealthy and the NEXT
  notification changes transport. This is the rule that makes "never duplicate" and "never pretend it
  worked" hold at the same time.
*/
test('an unanswered overlay produces no second notification, and moves the next one to Windows', async () => {
  const first = loadToaster({ reply: REPLY.SILENCE });
  await first.notify(unlock(), options('auto'));
  assert.equal(first.calls.overlays.length, 1);
  assert.equal(first.calls.toasts.length, 0, 'an unconfirmed overlay must not be duplicated onto a toast');

  const second = loadToaster({ reply: REPLY.ACCEPT });
  await second.notify(unlock({ achievementName: 'ACH_TWO' }), options('auto'));
  assert.equal(second.calls.overlays.length, 0);
  assert.equal(second.calls.toasts.length, 1);
});

test('Automatic uses a Windows notification while the game holds exclusive fullscreen', async () => {
  const { notify, calls } = loadToaster({ fullscreen: true });
  await notify(unlock(), options('auto'));
  assert.equal(calls.overlays.length, 0);
  assert.equal(calls.toasts.length, 1);
});

test('Windows notification mode never reaches the overlay, fullscreen or not', async () => {
  for (const fullscreen of [false, true]) {
    const { notify, calls } = loadToaster({ fullscreen, reply: REPLY.REJECT });
    await notify(unlock(), options('toast'));
    assert.equal(calls.overlays.length, 0);
    assert.equal(calls.toasts.length, 1);
  }
});

test('overlay mode stays on the overlay in fullscreen and does not add a toast', async () => {
  const { notify, calls } = loadToaster({ fullscreen: true });
  await notify(unlock(), options('overlay'));
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.toasts.length, 0);
});

test('Both sends one of each — and a failing overlay adds nothing on top', async () => {
  const { notify, calls } = loadToaster({ reply: REPLY.REJECT });
  await notify(unlock(), options('both'));
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.toasts.length, 1, 'the planned toast is the only one; the fallback must not add a second');
});

test('nothing is sent at all when notifications are switched off', async () => {
  const { notify, calls } = loadToaster();
  await notify(unlock(), options('auto', { notify: false }));
  assert.deepEqual([calls.overlays.length, calls.toasts.length, calls.broadcasts.length], [0, 0, 0]);
});

test('what delivered the notification is recorded for the game, with why', async () => {
  const { notify } = loadToaster({ reply: REPLY.REJECT, fullscreen: false });
  await notify(unlock(), options('auto'));
  const entry = transportMemory.entryForGame('480');
  assert.equal(entry.transport, 'toast');
  assert.equal(entry.outcome, 'fallback');
  assert.equal(entry.reason, policy.REASON.OVERLAY);
});

// Playtime fires as the game closes, when nothing is covering the screen any more. Recording it
// would overwrite what was learned in game with a result that says nothing about in-game delivery.
test('playtime notifications are not what the per-game memory learns from', async () => {
  const { notify } = loadToaster();
  await notify(unlock({ notificationType: 'playtime', silent: true }), options('auto'));
  assert.equal(transportMemory.entryForGame('480'), null);
});

test('a game that only ever worked on toasts is not asked to try the overlay blind', async () => {
  transportMemory.remember('480', { transport: 'toast', reason: policy.REASON.FULLSCREEN_HIDDEN, outcome: 'delivered' });
  // Windows could not answer this time: the memory is all there is to go on.
  const { notify, calls } = loadToaster({ fullscreen: null });
  await notify(unlock(), options('auto'));
  assert.equal(calls.overlays.length, 0);
  assert.equal(calls.toasts.length, 1);
});
