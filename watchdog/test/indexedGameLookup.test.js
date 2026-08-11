'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createIndexedGameLookup } = require('../util/indexedGameLookup.js');

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fakeFileSystem(initial) {
  const files = new Map();
  let reads = 0;
  let revision = 0;
  let failedReads = 0;
  const failedStats = [];

  const write = (file, value) => {
    revision += 1;
    files.set(file, { text: JSON.stringify(value), revision });
  };
  for (const [file, value] of Object.entries(initial)) write(file, value);

  return {
    fs: {
      statSync(file) {
        const entry = files.get(file);
        if (!entry) throw errorWithCode('ENOENT', 'ENOENT');
        if (failedStats.length > 0) {
          const code = failedStats.shift();
          throw errorWithCode(`simulated ${code} stat failure`, code);
        }
        return { mtimeMs: entry.revision, ctimeMs: entry.revision, size: entry.text.length };
      },
      readFileSync(file) {
        const entry = files.get(file);
        if (!entry) throw new Error('ENOENT');
        reads += 1;
        if (failedReads > 0) {
          failedReads -= 1;
          throw new Error('simulated transient lock');
        }
        return entry.text;
      },
    },
    write,
    remove: (file) => files.delete(file),
    failNextRead: () => {
      failedReads += 1;
    },
    failNextStat: (code = 'EACCES') => {
      failedStats.push(code);
    },
    corrupt: (file) => {
      revision += 1;
      files.set(file, { text: '{not-json', revision });
    },
    get reads() {
      return reads;
    },
  };
}

test('lookup caches stable files, keeps first duplicate, and lets cfg override schema', () => {
  const state = fakeFileSystem({
    schema: [
      { appid: '1', name: 'Schema first' },
      { appid: '1', name: 'Schema later' },
    ],
    cfg: [{ appid: '1', name: 'User override' }],
  });
  const lookup = createIndexedGameLookup({ getFiles: () => ['schema', 'cfg'], fs: state.fs });

  assert.equal(lookup(1).name, 'User override');
  assert.equal(state.reads, 2);
  assert.equal(lookup('1').name, 'User override');
  assert.equal(state.reads, 2, 'unchanged files must not be reparsed');
});

test('lookup reloads on edit, deletion, and invalid index files without losing lower-priority data', () => {
  const state = fakeFileSystem({
    schema: [{ appid: '1', name: 'Schema' }],
    cfg: [{ appid: '1', name: 'Override' }],
  });
  const lookup = createIndexedGameLookup({ getFiles: () => ['schema', 'cfg'], fs: state.fs });

  assert.equal(lookup('1').name, 'Override');
  state.write('cfg', [{ appid: '1', name: 'Updated override' }]);
  assert.equal(lookup('1').name, 'Updated override');
  state.corrupt('cfg');
  assert.equal(lookup('1').name, 'Schema');
  state.remove('cfg');
  assert.equal(lookup('1').name, 'Schema');
});

test('a transient read failure is retried even if file metadata has not changed', () => {
  const state = fakeFileSystem({ schema: [{ appid: '1', name: 'Schema' }] });
  const lookup = createIndexedGameLookup({ getFiles: () => ['schema'], fs: state.fs });

  state.failNextRead();
  assert.equal(lookup('1'), undefined);
  assert.equal(lookup('1').name, 'Schema');
});

test('a transient stat failure keeps the last good index and retries immediately', () => {
  const state = fakeFileSystem({ schema: [{ appid: '1', name: 'Schema' }] });
  const lookup = createIndexedGameLookup({ getFiles: () => ['schema'], fs: state.fs });

  assert.equal(lookup('1').name, 'Schema');
  assert.equal(state.reads, 1);
  state.failNextStat();
  assert.equal(lookup('1').name, 'Schema', 'a temporary lock must not discard cached metadata');
  assert.equal(state.reads, 1, 'an unavailable file must not be parsed as if it were missing');
  assert.equal(lookup('1').name, 'Schema');
  assert.equal(state.reads, 2, 'the next event retries after the stat lock clears');
});

test('a permanent stat failure does not return stale metadata', () => {
  const state = fakeFileSystem({ schema: [{ appid: '1', name: 'Schema' }] });
  const lookup = createIndexedGameLookup({ getFiles: () => ['schema'], fs: state.fs });

  assert.equal(lookup('1').name, 'Schema');
  state.failNextStat('ENOTDIR');
  assert.equal(lookup('1'), undefined, 'a path that cannot name an index is treated like the old skipped read');
  assert.equal(lookup('1').name, 'Schema', 'the index is restored once the path becomes readable again');
});
