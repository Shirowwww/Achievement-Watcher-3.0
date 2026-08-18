'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
  makeList streams each game to the caller inside the callback that builds `gameList`. Deferring it to
  requestAnimationFrame breaks background scans (rAF never fires on a hidden, throttled window), so
  this guards the source against reintroducing the defer.
*/

const achievements = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'parser', 'achievements.js'), 'utf8');

test('makeList hands each game to its caller without waiting for a frame', () => {
  const calls = [...achievements.matchAll(/onGame\?\.\(/g)];
  assert.ok(calls.length > 0, 'makeList must stream games to its caller');

  // No onGame call may sit inside a requestAnimationFrame callback.
  const deferred = /requestAnimationFrame\(\s*\(\)\s*=>\s*onGame/.test(achievements);
  assert.equal(deferred, false, 'onGame must not be deferred to requestAnimationFrame: it never fires while the window is hidden');

  // And nothing else in the file may schedule work through rAF either.
  const rafCalls = [...achievements.matchAll(/^\s*requestAnimationFrame\(/gm)];
  assert.equal(rafCalls.length, 0, `achievements.js must not depend on frame callbacks, found ${rafCalls.length}`);
});

test('makeList reports the real game count before the first game resolves', () => {
  // Without it the renderer sizes its placeholder grid from the previous session's count.
  assert.match(achievements, /callbackProgress\(0, finalList\.length\);/, 'the total must be announced up front');
  assert.match(achievements, /callbackProgress\(Math\.floor\(\(count \/ finalList\.length\) \* 100\), finalList\.length\)/);
});

test('the renderer builds its game list from that callback', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8');
  assert.match(app, /gameList\.push\(game\)/, 'the renderer tracks loaded games in gameList');
  // gameList drives the tiles, the profile counters and the sort, so it must still be filled from
  // the stream. The periodic new-game check no longer reads it - it diffs discovery against the
  // previous discovery instead (see integration/newGameScanBaseline.test.js).
  assert.match(app, /refreshProfileStats\(\)/, 'the profile counters follow the streamed list');
});
