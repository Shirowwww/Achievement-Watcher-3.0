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

// The Watchdog ships its own tests under watchdog/test/. They resolve their dependencies from
// watchdog/node_modules (regodit, koffi), so they run as a second process with that cwd rather than
// being folded into the app suite - a single run with cwd=app resolves the wrong node_modules.
// Both are run here because `npm test` in app/ is the one command the release checklist calls: a
// suite this runner cannot see is a suite nobody runs.
const SUITES = [
  { name: 'app', dir: __dirname, cwd: path.join(__dirname, '..', 'app') },
  { name: 'watchdog', dir: path.join(__dirname, '..', 'watchdog', 'test'), cwd: path.join(__dirname, '..', 'watchdog') },
];

let failed = false;
for (const suite of SUITES) {
  const files = discoverTests(suite.dir);
  if (files.length === 0) throw new Error(`No tests found below ${suite.dir}`);

  console.log(`\n=== ${suite.name} suite (${files.length} files) ===`);
  // Native registry integrations can race on Windows runners, so keep each suite serial.
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2), ...files], {
    cwd: suite.cwd,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
