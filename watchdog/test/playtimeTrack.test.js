'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Timer = require('../playtime/timer.js');
const TimeTrack = require('../playtime/track.js');

// regoditSafety.test.js pins the *shape* of these calls (sync entry point, no `regodit/promises`).
// What was never checked is the behaviour they exist for: that a finished session actually lands in
// the registry, that a second session adds to the first rather than replacing it, and that `last`
// is written at all - under the pinned koffi the async DWORD write segfaulted after storing `total`,
// so `last` silently never arrived and only a live run would have shown it.
const APPID = '4294967000'; // outside the real Steam appid range, so it can never collide with user data
const KEY = 'Software/Achievement Watcher Next/Playtime/Steam/' + APPID;
const windowsOnly = process.platform !== 'win32' ? 'Windows-only' : false;

test('Timer reports the elapsed session in whole seconds', () => {
  const timer = new Timer();
  assert.equal(timer.played, 0, 'a running session has no recorded time yet');

  // Move the start back instead of waiting: the arithmetic is what matters, not real elapsed time.
  timer.start = new Date(timer.start.getTime() - 125_400); // 125.4s
  timer.stop();
  assert.equal(timer.played, 125, 'truncated to whole seconds, never rounded up');

  const short = new Timer();
  short.start = new Date(short.start.getTime() - 900);
  short.stop();
  assert.equal(short.played, 0, 'a sub-second session is 0s, not a negative or a NaN');
});

test('a finished session is added to the registry total, and stamps `last`', { skip: windowsOnly }, async (t) => {
  const regedit = await import('regodit');
  const read = (name) => +regedit.regQueryIntegerValue('HKCU', KEY, name) || 0;
  const cleanup = () => {
    try {
      regedit.regDeleteKeyIncludingSubkeys('HKCU', KEY);
    } catch {
      /* nothing was written */
    }
  };
  cleanup(); // a previous aborted run must not seed the baseline
  t.after(cleanup);

  assert.equal(read('total'), 0, 'the throwaway key starts clean');

  await TimeTrack(APPID, 120);
  assert.equal(read('total'), 120, 'the first session is stored');

  const last = read('last');
  assert.ok(last > 0, '`last` must reach the registry - a 0 here is the koffi segfault-after-total regression');
  assert.ok(Math.abs(Date.now() / 1000 - last) < 120, `\`last\` should be a current unix timestamp, got ${last}`);

  await TimeTrack(APPID, 45);
  assert.equal(read('total'), 165, 'a second session accumulates instead of overwriting');
});

test('the playtime key is namespaced to AW Next so a predecessor uninstall cannot wipe it', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'playtime', 'track.js'), 'utf8');
  // issue #6: both predecessors' uninstallers remove their own "Achievement Watcher" tree.
  assert.match(source, /Software\/Achievement Watcher Next\/Playtime\/Steam\//);
});
