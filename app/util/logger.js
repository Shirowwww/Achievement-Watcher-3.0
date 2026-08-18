'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

/*
  Log files are opened in APPEND mode, never truncated: 'w' truncated the running instance's log on
  second launches (routine for a tray app) and erased crashes. Size is bounded by rotating to <name>.1.
*/
const MAX_BYTES = 2 * 1024 * 1024;
const LOG_ENTRY = '\\[\\d{4}-\\d{2}-\\d{2}T[^\\s\\]\\r\\n]+(?:\\s+(?:INFO|WARN|ERROR))?\\]';

// Older builds could serialize the complete settings object into a diagnostic log. Redact those
// object events in place: unrelated history and byte offsets survive, while stale credentials and
// account identifiers cannot be copied into a future issue report.
function redactLegacySettingsDumps(file) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    const eventPattern = new RegExp(`(^|\\n)(${LOG_ENTRY} [^\\r\\n]*\\{[\\s\\S]*?)(?=\\n${LOG_ENTRY} |$)`, 'g');
    const matches = [];
    let match;
    while ((match = eventPattern.exec(source))) {
      const event = match[2];
      if (!/\b(?:loginPassword|apiKey)\s*:/i.test(event)) continue;
      const offset = Buffer.byteLength(source.slice(0, match.index + match[1].length), 'utf8');
      matches.push({ event, offset });
    }
    if (!matches.length) return 0;

    const fd = fs.openSync(file, 'r+');
    try {
      for (const item of matches) {
        const original = Buffer.from(item.event, 'utf8');
        const timestamp = /^([^\r\n]+?\])\s/.exec(item.event)?.[1] || '[legacy]';
        const marker = Buffer.from(`${timestamp} [legacy settings dump redacted]`, 'utf8');
        const replacement = Buffer.alloc(original.length, 0x20);
        marker.copy(replacement, 0, 0, Math.min(marker.length, replacement.length));
        if (replacement.length) replacement[replacement.length - 1] = 0x0a;
        fs.writeSync(fd, replacement, 0, replacement.length, item.offset);
      }
    } finally {
      fs.closeSync(fd);
    }
    return matches.length;
  } catch {
    return 0;
  }
}

function rotateIfTooBig(file, maxBytes) {
  try {
    if (fs.statSync(file).size < maxBytes) return;
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* missing file (nothing to rotate) or a lock held by another instance - keep appending */
  }
}

// Modules sharing a log file share its stream: the 11 parser modules all open parser.log, and
// preparing it per module re-scanned the whole file (plus its .1) each time.
const streams = new Map();

function openLogStream(file, maxBytes) {
  const key = path.resolve(file);
  const existing = streams.get(key);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  redactLegacySettingsDumps(file);
  redactLegacySettingsDumps(`${file}.1`);
  rotateIfTooBig(file, maxBytes);
  // 'a' also makes every write land at the real end of file, so several processes sharing one
  // log interleave whole lines instead of overwriting each other.
  const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  stream.on('error', (error) => console.warn(error));
  // One marker per process, so a reader can tell where a launch (or a second instance) begins.
  stream.write(`\n===== session ${new Date().toISOString()} pid=${process.pid} =====\n`);
  streams.set(key, stream);
  return stream;
}

/*
  A test run must never write into the user's real logs.

  Every logger resolves its path from the live userData directory, so `npm test` was appending to
  the installed app's parser.log and notification.log - hundreds of WARN lines per run, carrying
  fixture appids and deliberately thrown errors ("offline", "api unavailable"). Those lines then
  showed up in exported diagnostics as though the app had produced them, which is worse than merely
  untidy: it sends anyone reading the log after a real fault chasing failures that never happened.

  Console output is untouched, so the test runner still shows everything it did before.
*/
function logFilesDisabled() {
  // NODE_TEST_CONTEXT is set by `node --test` in each test process; the explicit variable covers
  // anything else that wants file-free logging (a smoke script, a packaging step).
  return Boolean(process.env.NODE_TEST_CONTEXT || process.env.AW_DISABLE_LOG_FILES);
}

class Logger {
  constructor(options = {}) {
    this.consoleEnabled = Boolean(options.console);
    // `allowDuringTests` is for the suites that exercise the file behaviour itself against a temp
    // directory. It is the deliberate exception to the rule above, which exists to keep production
    // modules - whose paths resolve to the live userData directory - from writing during a run.
    if (options.file && (options.allowDuringTests || !logFilesDisabled())) {
      this.stream = openLogStream(options.file, Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_BYTES);
    }
  }

  log(event, level = 'info') {
    const normalizedLevel = ['info', 'warn', 'error'].includes(level) ? level : 'info';
    const output = event instanceof Error ? event.stack || event.message : typeof event === 'object' ? util.inspect(event, { depth: null }) : String(event);
    const timestamp = new Date().toISOString();
    if (this.consoleEnabled) console[normalizedLevel === 'info' ? 'log' : normalizedLevel](`[${timestamp}] ${output}`);
    if (this.stream) this.stream.write(`[${timestamp} ${normalizedLevel.toUpperCase()}] ${output}\n`);
  }

  info(event) { this.log(event, 'info'); }
  warn(event) { this.log(event, 'warn'); }
  error(event) { this.log(event, 'error'); }
}

Logger.redactLegacySettingsDumps = redactLegacySettingsDumps;

module.exports = Logger;
