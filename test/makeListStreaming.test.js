'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
  makeList streams each loaded game to its caller, and the renderer builds `gameList` — the array the
  periodic new-game check diffs against — inside that callback.

  Deferring the call to requestAnimationFrame breaks that in a way nothing else catches: rAF is only
  delivered to a VISIBLE document, and this is a tray app whose main window is usually hidden and runs
  with backgroundThrottling enabled. A background scan then completed having appended nothing, so the
  next check saw the whole library as newly installed and refreshed it — every three minutes forever.

  This is a source-level guard on purpose: the defect is re-introducing the defer, not the runtime
  behaviour of any one call, and reproducing it needs a hidden Electron window.
*/

const achievements = fs.readFileSync(path.join(__dirname, '..', 'app', 'parser', 'achievements.js'), 'utf8');

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

test('the renderer builds its game list from that callback', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  assert.match(app, /gameList\.push\(game\)/, 'the renderer tracks loaded games in gameList');
  // The periodic check diffs discovery against that array, which is why it must be filled reliably.
  assert.match(app, /gameList\.map\(\(g\)\s*=>\s*String\(g\.appid\)\)/, 'the new-game check diffs against gameList');
});
