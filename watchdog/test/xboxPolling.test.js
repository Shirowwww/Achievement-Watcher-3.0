'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runXboxPoll, matchesActiveXboxPoll } = require('../util/xboxPolling.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createState(appid = '100') {
  return {
    appid,
    auth: { token: 'old' },
    snapshot: { before: true },
    polling: false,
  };
}

test('Xbox polls are single-flight and resume once the prior poll completes', async () => {
  const state = createState();
  let current = state;
  const firstAuth = deferred();
  let ensureCalls = 0;
  let pollCalls = 0;
  const writes = [];
  const run = () =>
    runXboxPoll({
      state,
      getCurrentState: () => current,
      ensureSession: () => {
        ensureCalls += 1;
        return ensureCalls === 1 ? firstAuth.promise : { token: 'next' };
      },
      pollOnce: ({ previousSnapshot }) => {
        pollCalls += 1;
        return { snapshot: { round: pollCalls, previousSnapshot }, newUnlocked: [] };
      },
      writeState: (appid, snapshot) => writes.push({ appid, snapshot }),
    });

  const first = run();
  assert.equal(ensureCalls, 1);
  assert.equal(await run(), false, 'an interval tick must not overlap an in-flight request');
  assert.equal(ensureCalls, 1);

  firstAuth.resolve({ token: 'fresh' });
  assert.equal(await first, true);
  assert.equal(state.polling, false);
  assert.equal(pollCalls, 1);
  assert.equal(writes.length, 1);

  assert.equal(await run(), true, 'the next interval tick may run after the first settles');
  assert.equal(ensureCalls, 2);
  assert.equal(pollCalls, 2);
});

test('a replaced poll state cannot continue after session refresh', async () => {
  const state = createState('100');
  const replacement = createState('200');
  let current = state;
  const refreshed = deferred();
  let pollCalls = 0;
  let writes = 0;

  const pending = runXboxPoll({
    state,
    getCurrentState: () => current,
    ensureSession: () => refreshed.promise,
    pollOnce: () => {
      pollCalls += 1;
      return { snapshot: {}, newUnlocked: [] };
    },
    writeState: () => {
      writes += 1;
    },
  });

  current = replacement;
  refreshed.resolve({ token: 'stale-refresh' });
  assert.equal(await pending, false);
  assert.deepEqual(state.auth, { token: 'old' }, 'a stale refresh must not overwrite the old state');
  assert.equal(pollCalls, 0);
  assert.equal(writes, 0);
  assert.equal(state.polling, false);
});

test('a replaced poll state cannot write a late Xbox response or notify', async () => {
  const state = createState('100');
  const replacement = createState('200');
  let current = state;
  const response = deferred();
  const pollStarted = deferred();
  let writes = 0;
  let notifications = 0;

  const pending = runXboxPoll({
    state,
    getCurrentState: () => current,
    ensureSession: () => ({ token: 'fresh' }),
    pollOnce: () => {
      pollStarted.resolve();
      return response.promise;
    },
    writeState: () => {
      writes += 1;
    },
    notifyUnlock: async () => {
      notifications += 1;
    },
  });

  await pollStarted.promise;
  current = replacement;
  response.resolve({ snapshot: { late: true }, newUnlocked: ['one'] });
  assert.equal(await pending, false);
  assert.deepEqual(state.snapshot, { before: true });
  assert.equal(writes, 0);
  assert.equal(notifications, 0);
});

test('a title switch during a notification prevents remaining stale notifications', async () => {
  const state = createState('100');
  const replacement = createState('200');
  let current = state;
  const firstNotification = deferred();
  const notificationStarted = deferred();
  const ids = [];
  const writes = [];

  const pending = runXboxPoll({
    state,
    getCurrentState: () => current,
    ensureSession: () => ({ token: 'fresh' }),
    pollOnce: () => ({ snapshot: { after: true }, newUnlocked: ['first', 'second'] }),
    writeState: (appid, snapshot) => writes.push({ appid, snapshot }),
    beforeNotifications: (newUnlocked) => assert.deepEqual(newUnlocked, ['first', 'second']),
    notifyUnlock: async (id) => {
      ids.push(id);
      if (id === 'first') {
        notificationStarted.resolve();
        await firstNotification.promise;
      }
    },
  });

  await notificationStarted.promise;
  current = replacement;
  firstNotification.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(ids, ['first']);
  assert.equal(writes.length, 1, 'the result was committed while this title was still current');
  assert.deepEqual(state.snapshot, { after: true });
});

test('a failed active poll reports its error and releases the single-flight lock', async () => {
  const state = createState();
  let current = state;
  const errors = [];

  assert.equal(
    await runXboxPoll({
      state,
      getCurrentState: () => current,
      ensureSession: () => ({ token: 'fresh' }),
      pollOnce: () => {
        throw new Error('network failed');
      },
      writeState: () => {},
      onError: (error) => errors.push(error.message),
    }),
    false
  );
  assert.deepEqual(errors, ['network failed']);
  assert.equal(state.polling, false);
});

test('only the matching Xbox game exit stops an active poll', () => {
  const state = createState('100');
  const replacement = createState('200');
  assert.equal(matchesActiveXboxPoll(state, { appid: '100', source: 'Xbox PC' }, (value) => String(value)), true);
  assert.equal(matchesActiveXboxPoll(replacement, { appid: '100', source: 'Xbox PC' }, (value) => String(value)), false);
  assert.equal(matchesActiveXboxPoll(replacement, { appid: '200', source: 'Steam' }, (value) => String(value)), false);
  assert.equal(matchesActiveXboxPoll(replacement, { appid: '200', source: 'Xbox PC' }, (value) => String(value)), true);
  assert.equal(matchesActiveXboxPoll(replacement, undefined, (value) => String(value)), true, 'shutdown still stops any active poll');
});
