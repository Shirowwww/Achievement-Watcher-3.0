'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPollingProcessMonitor, indexProcesses } = require('../playtime/pollingProcessMonitor.js');

function createTimers() {
  const callbacks = [];
  return {
    callbacks,
    clearIntervalFn: (timer) => {
      callbacks[timer] = null;
    },
    setIntervalFn: (callback) => {
      callbacks.push(callback);
      return callbacks.length - 1;
    },
  };
}

test('indexes both task-list process names and legacy name snapshots', () => {
  const indexed = indexProcesses([
    { pid: 1, process: 'current.exe' },
    { pid: 2, name: 'legacy.exe' },
    { pid: 0, process: 'System' },
    { pid: 'bad', process: 'invalid.exe' },
  ]);

  assert.deepEqual([...indexed.values()], [
    { pid: 1, process: 'current.exe', filepath: '' },
    { pid: 2, process: 'legacy.exe', filepath: '' },
  ]);
});

test('can omit ignored processes from snapshots and change events', async () => {
  const timers = createTimers();
  const monitor = createPollingProcessMonitor({
    list: async () => [
      { pid: 1, process: 'ignored.exe' },
      { pid: 2, process: 'game.exe' },
    ],
    shouldObserve: ({ process }) => process !== 'ignored.exe',
    ...timers,
  });
  const created = [];
  monitor.on('creation', (event) => created.push(event));

  await monitor.poll();
  monitor.close();

  assert.deepEqual(created, [['game.exe', 2, '']]);
});

test('does not replay the startup snapshot and emits only process changes', async () => {
  const timers = createTimers();
  const snapshots = [
    [
      { pid: 1, process: 'already-open.exe' },
      { pid: 2, process: 'new-game.exe' },
    ],
    [{ pid: 2, process: 'new-game.exe' }],
  ];
  const monitor = createPollingProcessMonitor({
    list: async () => snapshots.shift(),
    initialProcesses: [{ pid: 1, process: 'already-open.exe' }],
    ...timers,
  });
  const created = [];
  const deleted = [];
  monitor.on('creation', (event) => created.push(event));
  monitor.on('deletion', (event) => deleted.push(event));

  await monitor.poll();
  await monitor.poll();
  monitor.close();

  assert.deepEqual(created, [['new-game.exe', 2, '']]);
  assert.deepEqual(deleted, [['already-open.exe', 1]]);
  assert.equal(timers.callbacks[0], null);
});

test('shares an in-flight task-list request and stops delivering events after close', async () => {
  const timers = createTimers();
  let calls = 0;
  let resolveList;
  const monitor = createPollingProcessMonitor({
    list: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    },
    ...timers,
  });
  const created = [];
  monitor.on('creation', (event) => created.push(event));

  const first = monitor.poll();
  const second = monitor.poll();
  assert.equal(calls, 1);
  monitor.close();
  resolveList([{ pid: 5, process: 'late.exe' }]);
  await Promise.all([first, second]);

  assert.deepEqual(created, []);
});

test('resolves an image path for new processes only, never for the whole snapshot', async () => {
  const timers = createTimers();
  const resolved = [];
  const snapshots = [
    [
      { pid: 1, process: 'already-open.exe' },
      { pid: 2, process: 'new-game.exe' },
    ],
    [
      { pid: 1, process: 'already-open.exe' },
      { pid: 2, process: 'new-game.exe' },
    ],
  ];
  const monitor = createPollingProcessMonitor({
    list: async () => snapshots.shift(),
    initialProcesses: [{ pid: 1, process: 'already-open.exe' }],
    resolvePath: (pid) => {
      resolved.push(pid);
      return 'D:\Games\new-game.exe';
    },
    ...timers,
  });
  const created = [];
  monitor.on('creation', (event) => created.push(event));

  await monitor.poll();
  await monitor.poll();
  monitor.close();

  assert.deepEqual(created, [['new-game.exe', 2, 'D:\Games\new-game.exe']]);
  // Only the process that appeared, and only on the poll it appeared in.
  assert.deepEqual(resolved, [2]);
});

test('a failing path resolver degrades to an empty path instead of dropping the event', async () => {
  const timers = createTimers();
  const monitor = createPollingProcessMonitor({
    list: async () => [{ pid: 7, process: 'game.exe' }],
    resolvePath: () => {
      throw new Error('OpenProcess denied');
    },
    ...timers,
  });
  const created = [];
  monitor.on('creation', (event) => created.push(event));

  await monitor.poll();
  monitor.close();

  assert.deepEqual(created, [['game.exe', 7, '']]);
});
