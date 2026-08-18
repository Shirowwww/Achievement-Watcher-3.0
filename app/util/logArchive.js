'use strict';

/*
  Bundle the diagnostic logs into one .zip while the app is running.

  Copying a log out of <userData>\logs by hand is unreliable for the exact case the logs are wanted
  for: the tray daemon, the Watchdog monitor and every transient notification process keep their
  streams open and keep appending, so Explorer copies a file that is being written mid-line, a
  compressor can fail on the size changing under it, and a user who closed only the window still has
  the daemon holding the folder. Reading each file once into memory and writing the bytes into an
  archive sidesteps all of it: the snapshot is consistent, the running processes are untouched, and
  what comes out is a single file that can be attached to an issue.

  Deliberately dependency-injected (`fs`, `Zip`): the whole thing is testable without Electron, a
  real userData folder or a real archive.
*/

const nodeFs = require('fs');
const path = require('path');

// Everything the log folder can legitimately hold: the live logs and the single rotated copy
// logger.js keeps as <name>.1 (see MAX_BYTES there). `.corrupt-*` quarantine files are included on
// purpose - when one exists it is usually the reason a report was opened.
function isLogFile(name) {
  return /\.log$/i.test(name) || /\.log\.1$/i.test(name) || /\.corrupt-\d+$/i.test(name);
}

function safeStat(fs, file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/*
  A short header so a report carries the versions the logs were produced by. Only values the app
  already prints in its own Diagnostics line - no paths outside the app, no account identifiers.
*/
function buildManifest({ appVersion = '', versions = {}, platform = '', release = '', files = [] } = {}) {
  const lines = [
    `Achievement Watcher ${appVersion}`.trim(),
    `generated: ${new Date().toISOString()}`,
    `platform: ${platform}${release ? ` ${release}` : ''}`,
  ];
  for (const key of ['electron', 'chrome', 'node']) {
    if (versions && versions[key]) lines.push(`${key}: ${versions[key]}`);
  }
  lines.push('', `files (${files.length}):`);
  for (const entry of files) lines.push(`  ${entry.name} - ${entry.bytes} bytes`);
  return lines.join('\n') + '\n';
}

/*
  Read every log in `logsDir` and write them into `destination` as a zip.

  Returns { destination, files: [{ name, bytes }], skipped: [{ name, reason }] }. A file that cannot
  be read is recorded in `skipped` rather than aborting the export - one unreadable log must never
  cost the user the other eleven.
*/
function exportLogs({ logsDir, destination, Zip, fs = nodeFs, meta = {} } = {}) {
  if (!logsDir) throw new Error('exportLogs: logsDir is required');
  if (!destination) throw new Error('exportLogs: destination is required');
  if (typeof Zip !== 'function') throw new Error('exportLogs: a Zip constructor is required');

  let entries = [];
  try {
    entries = fs.readdirSync(logsDir);
  } catch (err) {
    throw new Error(`No log folder to export: ${err.message || err}`);
  }

  const zip = new Zip();
  const files = [];
  const skipped = [];

  for (const name of entries.filter(isLogFile).sort()) {
    const full = path.join(logsDir, name);
    const stat = safeStat(fs, full);
    if (!stat || !stat.isFile()) continue;
    try {
      // One read, one buffer: the file keeps growing behind us, and a snapshot of a known length is
      // exactly what a report wants - not a stream racing the writer to the end of the file.
      const buffer = fs.readFileSync(full);
      zip.addFile(name, buffer);
      files.push({ name, bytes: buffer.length });
    } catch (err) {
      skipped.push({ name, reason: String((err && err.message) || err) });
    }
  }

  zip.addFile('about.txt', Buffer.from(buildManifest({ ...meta, files }), 'utf8'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  zip.writeZip(destination);
  return { destination, files, skipped };
}

// Default name for the save dialog: sorts chronologically and says which build produced it.
function suggestedArchiveName(appVersion = '', now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `AW-logs-${appVersion ? `${appVersion}-` : ''}${stamp}.zip`;
}

module.exports = { exportLogs, suggestedArchiveName, buildManifest, isLogFile };
