'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function discoverTests(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return discoverTests(target);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [target] : [];
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

const files = discoverTests(__dirname);
if (files.length === 0) throw new Error(`No tests found below ${__dirname}`);

// A small cap keeps the four Chromium suites and native-module integrations from competing for all
// cores at once on developer machines, while still running the suite substantially in parallel.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...process.argv.slice(2), ...files], {
  cwd: path.join(__dirname, '..', 'app'),
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = typeof result.status === 'number' ? result.status : 1;
