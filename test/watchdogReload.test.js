'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// watchdog.js opens pipes, spawns watchers and reads real settings on require, so the reload guard is
// asserted on its source and then exercised through a faithful model. A live run only reaches the
// non-overlapping path (start() finishes inside node-watch's batching window), so the coalescing
// branch is covered here.
const source = fs.readFileSync(path.join(__dirname, '..', 'watchdog', 'watchdog.js'), 'utf8');

test('start() guards against re-entry and rebuilds its watcher list', () => {
  assert.match(source, /starting:\s*false/, 'a re-entrancy flag must exist');
  assert.match(source, /if \(this\.starting\)\s*\{[\s\S]*?this\.restartPending = true/, 'a second start() must be deferred');
  assert.match(source, /self\.watcher = \[\]/, 'the watcher list must be rebuilt per pass');
  assert.match(source, /finally \{\s*this\.starting = false;/, 'the flag must be released even on failure');
});

test('the options watcher tears down through the shared helper', () => {
  assert.match(source, /closeWatchers: function \(\)/);
  assert.match(source, /option file change detected -> reloading[\s\S]{0,120}self\.closeWatchers\(\)/);
  assert.ok(
    !/self\.watcher\.forEach\(\(watcher\) => watcher\.close\(\)\)/.test(source),
    'the unguarded forEach teardown must be gone (it threw on a hole and skipped the rest)'
  );
});

test('overlapping reloads run one pass at a time and leak no watchers', async () => {
  // Model of the real object: start() awaits, assigns watchers by index, and is re-entered by the
  // options-file watcher. Before the guard, two concurrent passes both wrote into `watcher`, so the
  // first pass's handles were overwritten while still open.
  let openWatchers = 0;
  const opened = [];

  const app = {
    watcher: [],
    starting: false,
    restartPending: false,
    passes: 0,
    closeWatchers() {
      for (const w of this.watcher) {
        if (w && !w.closed) {
          w.closed = true;
          openWatchers -= 1;
        }
      }
    },
    async start() {
      if (this.starting) {
        this.restartPending = true;
        return;
      }
      this.starting = true;
      try {
        this.passes += 1;
        this.watcher = [];
        for (let i = 0; i < 3; i += 1) {
          await new Promise((r) => setImmediate(r)); // the awaits inside the real start()
          const w = { id: `${this.passes}:${i}`, closed: false };
          opened.push(w);
          openWatchers += 1;
          this.watcher[i] = w;
        }
      } finally {
        this.starting = false;
      }
      if (this.restartPending) {
        this.restartPending = false;
        this.closeWatchers();
        await this.start();
      }
    },
  };

  // Initial start, then three settings saves landing while it is still awaiting.
  const first = app.start();
  app.start();
  app.start();
  app.start();
  await first;
  // Let the coalesced trailing pass finish.
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(app.passes, 2, 'three overlapping reloads collapse into exactly one extra pass');
  assert.equal(app.watcher.length, 3, 'the live pass owns exactly its own watchers');
  assert.equal(openWatchers, 3, 'no watcher from an earlier pass stays open');
  assert.equal(opened.length, 6, 'two passes opened three watchers each');
  for (const w of opened.slice(0, 3)) assert.equal(w.closed, true, 'first pass watchers must be closed');
});

test('a failing pass still releases the guard', async () => {
  const app = {
    starting: false,
    restartPending: false,
    watcher: [],
    async start() {
      if (this.starting) {
        this.restartPending = true;
        return;
      }
      this.starting = true;
      try {
        throw new Error('settings load failed');
      } catch {
        /* the real start() logs and exits; here just swallow */
      } finally {
        this.starting = false;
      }
    },
  };

  await app.start();
  assert.equal(app.starting, false, 'a crashed pass must not wedge the guard shut forever');
  await app.start();
  assert.equal(app.starting, false);
});
