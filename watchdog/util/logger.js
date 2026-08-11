'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

/*
  Log files are opened in APPEND mode, never truncated.

  They used to open with flags 'w', and the stream is created while the module loads — before the
  single-instance check. So launching the app while it was already running (routine for a tray app:
  a double click, the login item, a toast activation) truncated the running instance's log, while
  that instance carried on writing at its old offset. The gap between the two became a hole that
  reads back as NUL bytes, shredding everything logged before it. It also meant a crash was erased
  by the very next launch — exactly when the log matters most.

  Appending fixes both, so the size is bounded here instead: past the limit the file is rotated to
  `<name>.1` (one generation kept) and a fresh one is started.
*/
const MAX_BYTES = 2 * 1024 * 1024;

function rotateIfTooBig(file, maxBytes) {
  try {
    if (fs.statSync(file).size < maxBytes) return;
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* missing file (nothing to rotate) or a lock held by another instance — keep appending */
  }
}

class Logger {
  constructor(options = {}) {
    this.consoleEnabled = Boolean(options.console);
    if (options.file) {
      fs.mkdirSync(path.dirname(options.file), { recursive: true });
      rotateIfTooBig(options.file, Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_BYTES);
      // 'a' also makes every write land at the real end of file, so several processes sharing one
      // log interleave whole lines instead of overwriting each other.
      this.stream = fs.createWriteStream(options.file, { flags: 'a', encoding: 'utf8' });
      this.stream.on('error', (error) => console.warn(error));
      // One marker per process, so a reader can tell where a launch (or a second instance) begins.
      this.stream.write(`\n===== session ${new Date().toISOString()} pid=${process.pid} =====\n`);
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

module.exports = Logger;
