'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const snapshot = require('../util/processSnapshot.js');
const tasklist = require('../util/tasklist.js');

// The ToolHelp snapshot replaces a `tasklist.exe` spawn on the playtime monitor's 3 s poll, so it
// runs for the whole life of the tray daemon: these assert the shape the monitor relies on, not the
// exact contents of a machine's process table.

test('the native snapshot is available and lists the current process', () => {
  assert.equal(snapshot.isAvailable(), true);

  const processes = snapshot.listSync();
  assert.ok(processes.length > 0, 'expected at least one process');

  const self = processes.find((entry) => entry.pid === process.pid);
  assert.ok(self, 'the running test process must appear in the snapshot');
  assert.equal(typeof self.process, 'string');
  assert.equal(self.process.toLowerCase(), path.basename(process.execPath).toLowerCase());
});

test('every row carries a usable name and a positive pid', () => {
  for (const entry of snapshot.listSync()) {
    assert.equal(typeof entry.process, 'string');
    assert.notEqual(entry.process, '');
    assert.ok(Number.isInteger(entry.pid) && entry.pid >= 0, `bad pid ${entry.pid}`);
  }
});

test('a process path resolves for the current process and never throws for a dead one', () => {
  assert.equal(snapshot.getProcessPath(process.pid).toLowerCase(), process.execPath.toLowerCase());
  // Unreachable pids (exited, protected, malformed) must degrade to '' rather than throw: the
  // playtime monitor treats a missing path as "not resolvable" and carries on.
  assert.equal(snapshot.getProcessPath(0x7ffffff0), '');
  assert.equal(snapshot.getProcessPath(-1), '');
  assert.equal(snapshot.getProcessPath(undefined), '');
});

test('tasklist.list keeps the {process, pid} contract the monitor indexes on', async () => {
  const processes = await tasklist.list();
  assert.ok(processes.length > 0);
  assert.ok(processes.every((entry) => typeof entry.process === 'string' && Number.isInteger(entry.pid)));
  assert.ok(processes.some((entry) => entry.pid === process.pid));
});

test('tasklist.isProcessRunning answers by image name and by pid', async () => {
  const self = path.basename(process.execPath);
  assert.equal(await tasklist.isProcessRunning(self), true);
  assert.equal(await tasklist.isProcessRunning(process.pid), true);
  assert.equal(await tasklist.isProcessRunning('aw-no-such-binary.exe'), false);
  assert.equal(await tasklist.isProcessRunning(''), false);
});

test('the fast path is reported as live so a silent fallback is visible in the log', async () => {
  await tasklist.list();
  // If this ever fails on a supported machine the poll has quietly gone back to spawning
  // tasklist.exe, which costs ~440 ms every 3 s for the whole life of the tray daemon.
  assert.equal(tasklist.usingNativeSnapshot(), true);
});

test('the win-tasklist fallback agrees with the native path', async () => {
  const path2 = require('path');
  const snapshotModule = require('../util/processSnapshot.js');
  const listSync = snapshotModule.listSync;
  const self = path2.basename(process.execPath);

  // Force the fallback the way a machine where koffi cannot load kernel32 would.
  snapshotModule.listSync = () => {
    throw new Error('simulated koffi failure');
  };
  delete require.cache[require.resolve('../util/tasklist.js')];
  const fallback = require('../util/tasklist.js');
  try {
    const processes = await fallback.list();
    assert.ok(processes.some((entry) => entry.pid === process.pid));
    // Only observed once a call has actually fallen through, which is exactly when the playtime
    // monitor logs it (it seeds a snapshot before writing the line).
    assert.equal(fallback.usingNativeSnapshot(), false);
    // Regression guard: win-tasklist's own isProcessRunning() filters on `STATUS eq RUNNING`, which
    // answers false for an ordinary running process, so the fallback must not use it.
    assert.equal(await fallback.isProcessRunning(self), true);
    assert.equal(await fallback.isProcessRunning('aw-no-such-binary.exe'), false);
  } finally {
    snapshotModule.listSync = listSync;
    delete require.cache[require.resolve('../util/tasklist.js')];
  }
});
