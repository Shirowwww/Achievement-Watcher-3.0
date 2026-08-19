'use strict';

// The title-bar indicator used to be a named-pipe probe: connect, and call the Watchdog "running".
// That cannot see a monitor whose event loop has wedged - the pipe keeps accepting while nothing is
// tracked - so the monitor now pings over IPC and these are the states derived from those pings.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { deriveWatchdogState, HEARTBEAT_STALE_MS, HEARTBEAT_GRACE_MS } = require('../../app/util/watchdogState.js');

const NOW = 1_700_000_000_000;

test('no supervised child defers to the caller (the named-pipe probe)', () => {
  assert.equal(deriveWatchdogState({ alive: false, now: NOW }), null);
  assert.equal(deriveWatchdogState({}), null, 'a call with nothing known must not claim "running"');
});

test('a recent heartbeat is running', () => {
  assert.equal(deriveWatchdogState({ alive: true, heartbeatAt: NOW, now: NOW }), 'running');
  assert.equal(
    deriveWatchdogState({ alive: true, heartbeatAt: NOW - HEARTBEAT_STALE_MS, now: NOW }),
    'running',
    'the threshold itself still counts as alive'
  );
});

test('a child that has stopped beating is unresponsive, not stopped', () => {
  // The distinction is the whole point: the process is still there, so "stopped" would be a lie and
  // the fix is a restart rather than a start.
  assert.equal(deriveWatchdogState({ alive: true, heartbeatAt: NOW - HEARTBEAT_STALE_MS - 1, now: NOW }), 'unresponsive');
});

test('silence right after a spawn is starting, until the grace period runs out', () => {
  assert.equal(deriveWatchdogState({ alive: true, startedAt: NOW, now: NOW }), 'starting');
  assert.equal(deriveWatchdogState({ alive: true, startedAt: NOW - HEARTBEAT_GRACE_MS, now: NOW }), 'starting');
  assert.equal(
    deriveWatchdogState({ alive: true, startedAt: NOW - HEARTBEAT_GRACE_MS - 1, now: NOW }),
    'unresponsive',
    'a monitor that never beat at all is wedged once the startup grace expires'
  );
});

test('the startup grace never revives a child that beat and then went quiet', () => {
  // A respawn stamps startedAt and clears heartbeatAt together; if it did not, a long-lived child
  // whose loop wedged would keep reading as "starting" forever because startedAt is recent.
  const state = deriveWatchdogState({
    alive: true,
    startedAt: NOW - 5000, // recent enough to be inside the grace period
    heartbeatAt: NOW - HEARTBEAT_STALE_MS - 1,
    now: NOW,
  });
  assert.equal(state, 'unresponsive', 'a known heartbeat always outranks the startup grace');
});

test('the grace period is longer than the stale window', () => {
  // Cold start does blocking native init; if grace <= stale, every launch would flash "not
  // responding" before the first beat landed.
  assert.ok(HEARTBEAT_GRACE_MS > HEARTBEAT_STALE_MS);
});
