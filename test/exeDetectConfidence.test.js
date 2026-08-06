'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const exeDetect = require('../app/parser/exeDetect.js');

function tmpGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-conf-${name}-`));
}

function writeBytes(file, size = 128) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

test('a single plausible exe is always confident', () => {
  const gameDir = tmpGame('single');
  writeBytes(path.join(gameDir, 'Game.exe'));
  const res = exeDetect.detectConfident(gameDir, '');
  assert.ok(res);
  assert.strictEqual(res.name, 'Game.exe');
  assert.strictEqual(res.confidence, 'single-candidate');
});

test('an ambiguous folder with no name/dll evidence is NOT auto-detected', () => {
  const gameDir = tmpGame('ambiguous');
  writeBytes(path.join(gameDir, 'Foo.exe'));
  writeBytes(path.join(gameDir, 'Bar.exe'));
  const best = exeDetect.detect(gameDir, 'Totally Unrelated');
  assert.ok(best);
  assert.strictEqual(best.confident, false);
  assert.strictEqual(exeDetect.detectConfident(gameDir, 'Totally Unrelated'), null);
});

test('a strong exe-name match is confident even with other candidates', () => {
  const gameDir = tmpGame('strong');
  writeBytes(path.join(gameDir, 'Launcher.exe'));
  writeBytes(path.join(gameDir, 'Portal2.exe'));
  const res = exeDetect.detectConfident(gameDir, 'Portal 2');
  assert.ok(res);
  assert.strictEqual(res.name, 'Portal2.exe');
});

test('a steam_api dll beside a decent name match is confident', () => {
  const gameDir = tmpGame('dll-name');
  writeBytes(path.join(gameDir, 'launcher.exe'));
  writeBytes(path.join(gameDir, 'ItTakesTwo.exe'));
  writeBytes(path.join(gameDir, 'steam_api64.dll'));
  const res = exeDetect.detectConfident(gameDir, 'It Takes Two', {
    dllPaths: [path.join(gameDir, 'steam_api64.dll')],
  });
  assert.ok(res);
  assert.strictEqual(res.name, 'ItTakesTwo.exe');
});

test('a strong install-folder match is confident (Steam manifest folder names)', () => {
  const gameDir = tmpGame('AC Black Flag Resynced');
  writeBytes(path.join(gameDir, 'ACBlackFlag.exe'));
  writeBytes(path.join(gameDir, 'Launcher.exe'));
  const res = exeDetect.detectConfident(gameDir, 'Assassin\'s Creed IV Black Flag');
  assert.ok(res);
  assert.strictEqual(res.name, 'ACBlackFlag.exe');
  assert.strictEqual(res.confidence, 'strong-folder-name');
});

test('authoritative exe bypasses ambiguity (launcher manifest paths)', () => {
  const gameDir = tmpGame('authoritative');
  writeBytes(path.join(gameDir, 'Foo.exe'));
  writeBytes(path.join(gameDir, 'Bar.exe'));
  const res = exeDetect.detectConfident(gameDir, 'Whatever', { authoritative: true });
  assert.ok(res);
  assert.strictEqual(res.confidence, 'authoritative');
});

test('a strong name beats a larger unrelated helper', () => {
  const gameDir = tmpGame('strong-beats-helper');
  writeBytes(path.join(gameDir, 'BigHelper.exe'), 4096);
  writeBytes(path.join(gameDir, 'Rayman.exe'), 64);
  const res = exeDetect.detectConfident(gameDir, 'Rayman');
  assert.ok(res);
  assert.strictEqual(res.name, 'Rayman.exe');
});
