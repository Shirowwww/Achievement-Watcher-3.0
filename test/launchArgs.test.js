'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { splitLaunchArgs } = require(path.join(__dirname, '..', 'app', 'util', 'launchArgs.js'));

test('quotes group an argument without surviving into it', () => {
  // spawn() runs without a shell and re-quotes each element, so a token that keeps its own quotes
  // reaches the game as part of the value and the path does not resolve.
  const argv = splitLaunchArgs(String.raw`-windowed -savedir "D:\My Games\Save Data" -lang=fr`);
  assert.deepEqual(argv, ['-windowed', '-savedir', String.raw`D:\My Games\Save Data`, '-lang=fr']);
  for (const arg of argv) assert.ok(!arg.includes('"'), `argument still carries a quote: ${arg}`);
});

test('plain arguments are split on whitespace', () => {
  assert.deepEqual(splitLaunchArgs('-a -b  -c'), ['-a', '-b', '-c']);
});

test('empty and nullish input produce no arguments', () => {
  assert.deepEqual(splitLaunchArgs(''), []);
  assert.deepEqual(splitLaunchArgs('   '), []);
  assert.deepEqual(splitLaunchArgs(null), []);
  assert.deepEqual(splitLaunchArgs(undefined), []);
});

test('an unmatched quote still launches the game, and reports why', () => {
  // argv-split throws here; a typo in the arguments field must not make the play button dead.
  const logged = [];
  const argv = splitLaunchArgs('-a "unbalanced', (m) => logged.push(m));
  assert.deepEqual(argv, ['-a', '"unbalanced']);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /whitespace split/);
});

test('the logger is optional', () => {
  assert.doesNotThrow(() => splitLaunchArgs('-a "unbalanced'));
});
