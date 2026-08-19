'use strict';

// The Watchdog indicator now reports four states from a heartbeat instead of two from a pipe probe.
// Three files have to agree for that to read correctly on screen, and nothing else checks the seam:
// app.js decides which classes a state gets, titlebar.css decides what those classes look like, and
// titleBar.js ships the markup the very first paint uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const appJs = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
const titleBarJs = fs.readFileSync(path.join(appDir, 'components/titleBar/titleBar.js'), 'utf8');
const titleBarCss = fs.readFileSync(path.join(appDir, 'resources/css/titlebar.css'), 'utf8');

test('the pulse is bound to its own class, not to the orange colour', () => {
  // 'starting' and 'unresponsive' are both orange; the pulse is the only thing telling them apart.
  // Binding the animation back to .status-orange would make a wedged Watchdog look like a starting
  // one, which is the exact confusion this state was added to remove.
  assert.match(titleBarCss, /\.status-dot\.status-pulse::before,/);
  assert.match(titleBarCss, /\.status-dot\.status-pulse::after \{[^}]*animation-delay: 1s;/);
  assert.doesNotMatch(titleBarCss, /\.status-dot\.status-orange::(before|after)/, 'the pulse must not be re-attached to the colour');
});

test('the first paint pulses before any status has been pushed', () => {
  // The poll only reports every 5s, so the shipped markup is what the user sees on launch.
  assert.match(titleBarJs, /class="status-dot status-orange status-pulse"/);
});

test('every Watchdog state maps to a distinct presentation', () => {
  const presentation = appJs.slice(appJs.indexOf('function watchdogPresentation('));
  assert.ok(presentation, 'watchdogPresentation must exist');
  const body = presentation.slice(0, presentation.indexOf('\n}\n'));

  for (const state of ['running', 'starting', 'unresponsive']) {
    assert.ok(body.includes(`case '${state}':`), `missing a case for '${state}'`);
  }
  assert.ok(body.includes('default:'), 'an unknown state must still render something (stopped)');

  // Only 'starting' pulses; everything else is steady, including the permanently-visible green.
  assert.equal((body.match(/pulse: true/g) || []).length, 1);

  // A wedged monitor has to be killed before a replacement can bind the port, so it offers a
  // restart. Offering "Start" there would run a no-op against a process that is already alive.
  assert.ok(body.includes("t('restart-watchdog'"), 'the unresponsive state must offer a restart');
  assert.ok(body.includes("t('start-watchdog'"), 'the stopped state must offer a start');
});

test('a legacy boolean on the status channel is still understood', () => {
  // The channel carried booleans before the heartbeat existed; a renderer left over from an older
  // build must not paint "stopped" for a healthy monitor.
  assert.match(appJs, /typeof state === 'string' \? state : state \? 'running' : 'stopped'/);
});
