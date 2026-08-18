'use strict';

// Eleven parser modules construct a Logger on the same parser.log; each one used to re-scan the
// file (and its rotated .1) and open its own stream.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Logger = require('../../app/util/logger.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-logger-reuse-'));
}

function flush(stream) {
  return new Promise((resolve) => stream.end(resolve));
}

test('loggers on the same file share one prepared stream', async () => {
  const dir = tmpdir();
  let stream;
  try {
    const file = path.join(dir, 'logs', 'parser.log');
    const first = new Logger({ file, allowDuringTests: true });
    stream = first.stream;
    const rest = Array.from({ length: 10 }, () => new Logger({ file, allowDuringTests: true }));
    for (const logger of rest) assert.equal(logger.stream, first.stream);
  } finally {
    if (stream) await flush(stream);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a shared file gets exactly one session banner per process', async () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'logs', 'parser.log');
    const loggers = Array.from({ length: 11 }, () => new Logger({ file, allowDuringTests: true }));
    loggers[0].log('first');
    loggers[10].log('last');
    await flush(loggers[0].stream);

    const written = fs.readFileSync(file, 'utf8');
    assert.equal(written.match(/^===== session /gm)?.length, 1);
    // Every module still writes through the shared stream.
    assert.match(written, /first/);
    assert.match(written, /last/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('different files keep independent streams', async () => {
  const dir = tmpdir();
  const opened = [];
  try {
    const parser = new Logger({ file: path.join(dir, 'logs', 'parser.log'), allowDuringTests: true });
    const blacklist = new Logger({ file: path.join(dir, 'logs', 'blacklist.log'), allowDuringTests: true });
    opened.push(parser.stream, blacklist.stream);
    assert.notEqual(parser.stream, blacklist.stream);
  } finally {
    for (const stream of opened) await flush(stream);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file-less logger has no stream', () => {
  assert.equal(new Logger({ console: false }).stream, undefined);
});

/*
  A test run must not append to the user's real logs.

  Every production logger resolves its path from the live userData directory, so `npm test` used to
  append hundreds of WARN lines to the installed app's parser.log and notification.log - fixture
  appids and deliberately thrown errors ("offline", "api unavailable") that then showed up in
  exported diagnostics as if the app had produced them.
*/
test('a production logger writes no file during a test run', () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'logs', 'parser.log');
    const logger = new Logger({ file });
    logger.log('this must not reach the disk');
    assert.equal(logger.stream, undefined, 'no stream may be opened without allowDuringTests');
    assert.equal(fs.existsSync(file), false, 'no log file may be created during a test run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
