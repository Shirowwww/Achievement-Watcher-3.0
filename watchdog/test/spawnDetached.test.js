'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnDetached } = require('../util/spawnDetached.js');

test('keeps an async child-process launch error local to the detached launch', () => {
  const child = new EventEmitter();
  let unrefCalls = 0;
  child.unref = () => {
    unrefCalls += 1;
  };

  const reported = [];
  const result = spawnDetached(
    () => child,
    'C:\\missing\\Achievement Watcher.exe',
    ['--wintype=overlay'],
    { detached: true },
    (error) => reported.push(error)
  );

  assert.equal(result, child);
  assert.equal(unrefCalls, 1);
  assert.equal(child.listenerCount('error'), 1, 'the asynchronous spawn error has a listener before unref');

  const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  assert.doesNotThrow(() => child.emit('error', error));
  assert.deepEqual(reported, [error]);
});

test('reports a synchronous spawn failure without attempting to unref a child', () => {
  const error = Object.assign(new Error('spawn EPERM'), { code: 'EPERM' });
  const reported = [];

  const result = spawnDetached(
    () => {
      throw error;
    },
    'C:\\blocked\\action.exe',
    [],
    {},
    (failure) => reported.push(failure)
  );

  assert.equal(result, null);
  assert.deepEqual(reported, [error]);
});

test('contains errors thrown by the reporter itself', () => {
  const child = new EventEmitter();
  child.unref = () => {};
  spawnDetached(() => child, 'C:\\missing\\action.exe', [], {}, () => {
    throw new Error('logger unavailable');
  });

  assert.doesNotThrow(() => child.emit('error', new Error('spawn ENOENT')));
});
