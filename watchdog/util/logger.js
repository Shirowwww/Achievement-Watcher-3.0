'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

class Logger {
  constructor(options = {}) {
    this.consoleEnabled = Boolean(options.console);
    if (options.file) {
      fs.mkdirSync(path.dirname(options.file), { recursive: true });
      this.stream = fs.createWriteStream(options.file, { flags: options.appendToFile ? 'a' : 'w', encoding: 'utf8' });
      this.stream.on('error', (error) => console.warn(error));
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
