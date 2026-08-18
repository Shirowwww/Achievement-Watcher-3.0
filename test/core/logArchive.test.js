'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('../../app/node_modules/adm-zip');
const { exportLogs, suggestedArchiveName, isLogFile } = require('../../app/util/logArchive.js');

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));
}

test('every log in the folder is snapshotted into one archive, with a manifest', () => {
  const logsDir = tempDir('logs');
  const out = path.join(tempDir('out'), 'nested', 'logs.zip');
  try {
    fs.writeFileSync(path.join(logsDir, 'parser.log'), 'parser line\n');
    fs.writeFileSync(path.join(logsDir, 'parser.log.1'), 'rotated line\n');
    fs.writeFileSync(path.join(logsDir, 'renderer.log'), 'renderer line\n');
    fs.writeFileSync(path.join(logsDir, 'userdir.db.corrupt-1700000000000'), '{broken');
    // Not a log: the archive is for diagnostics, not for whatever else happens to sit there.
    fs.writeFileSync(path.join(logsDir, 'notes.txt'), 'ignore me');
    fs.mkdirSync(path.join(logsDir, 'a-folder'));

    const summary = exportLogs({
      logsDir,
      destination: out,
      Zip: AdmZip,
      meta: { appVersion: '3.9.0', platform: 'win32', release: '10.0.26200', versions: { electron: '43.0.0' } },
    });

    assert.equal(summary.destination, out);
    assert.deepEqual(summary.files.map((f) => f.name).sort(), [
      'parser.log',
      'parser.log.1',
      'renderer.log',
      'userdir.db.corrupt-1700000000000',
    ]);
    assert.deepEqual(summary.skipped, []);
    assert.ok(fs.existsSync(out), 'the destination folder is created when missing');

    const entries = new AdmZip(out).getEntries().map((e) => e.entryName);
    assert.ok(entries.includes('parser.log'));
    assert.ok(entries.includes('about.txt'));
    assert.ok(!entries.includes('notes.txt'));
    assert.ok(!entries.some((e) => e.startsWith('a-folder')));

    const zip = new AdmZip(out);
    assert.equal(zip.readAsText('parser.log'), 'parser line\n');
    const about = zip.readAsText('about.txt');
    assert.match(about, /Achievement Watcher 3\.9\.0/);
    assert.match(about, /platform: win32 10\.0\.26200/);
    assert.match(about, /electron: 43\.0\.0/);
    assert.match(about, /parser\.log - 12 bytes/);
  } finally {
    fs.rmSync(logsDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(path.dirname(out)), { recursive: true, force: true });
  }
});

// One unreadable log must not cost the user the other eleven - the whole point of the button is that
// it works while every one of those files is being written to.
test('a log that cannot be read is recorded, not fatal', () => {
  const logsDir = tempDir('logs-partial');
  const out = path.join(tempDir('out-partial'), 'logs.zip');
  try {
    fs.writeFileSync(path.join(logsDir, 'good.log'), 'ok\n');
    fs.writeFileSync(path.join(logsDir, 'locked.log'), 'held open\n');

    const summary = exportLogs({
      logsDir,
      destination: out,
      Zip: AdmZip,
      fs: {
        ...fs,
        readFileSync(file, ...rest) {
          if (path.basename(file) === 'locked.log') throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
          return fs.readFileSync(file, ...rest);
        },
      },
    });

    assert.deepEqual(summary.files.map((f) => f.name), ['good.log']);
    assert.equal(summary.skipped.length, 1);
    assert.equal(summary.skipped[0].name, 'locked.log');
    assert.match(summary.skipped[0].reason, /EBUSY/);
    assert.ok(fs.existsSync(out), 'the archive is still written');
  } finally {
    fs.rmSync(logsDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

test('a missing log folder is reported instead of producing an empty archive', () => {
  assert.throws(
    () => exportLogs({ logsDir: path.join(os.tmpdir(), 'aw-no-such-logs-dir'), destination: 'x.zip', Zip: AdmZip }),
    /No log folder to export/
  );
});

test('the suggested file name sorts chronologically and names the build', () => {
  const name = suggestedArchiveName('3.9.0', new Date(Date.UTC(2026, 7, 18, 1, 2, 3)));
  assert.equal(name, 'AW-logs-3.9.0-2026-08-18-01-02-03.zip');
  assert.match(suggestedArchiveName(), /^AW-logs-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
});

test('only diagnostic files are eligible', () => {
  assert.equal(isLogFile('parser.log'), true);
  assert.equal(isLogFile('parser.log.1'), true);
  assert.equal(isLogFile('userdir.db.corrupt-1700000000000'), true);
  assert.equal(isLogFile('options.ini'), false);
  assert.equal(isLogFile('gameIndex.json'), false);
});
