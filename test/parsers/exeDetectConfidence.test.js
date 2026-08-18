'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const exeDetect = require('../../app/parser/exeDetect.js');

function tmpGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-conf-${name}-`));
}

// Unlike tmpGame(), the returned directory's own basename is exactly `name` - no tmp-prefix/suffix
// noise - so folder-name-similarity assertions see the same basename a real install folder would have.
function tmpGameNamed(name) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-conf-'));
  const dir = path.join(parent, name);
  fs.mkdirSync(dir);
  return dir;
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
  const gameDir = tmpGameNamed('AC Black Flag Resynced');
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

test('a dual-DRM repack (real exe + unrelated-named loader) is confident even with zero name overlap', () => {
  // The internal exe name often has no lexical relationship to the storefront title (Ubisoft codenames,
  // sequel subtitles, remaster suffixes, ...), so neither gameSim nor folderSim can ever clear a
  // name-based threshold here. The loader is still unambiguous by elimination: it is the only
  // non-utility candidate once the loader itself is filtered out.
  const gameDir = tmpGame('AC Black Flag Resynced');
  writeBytes(path.join(gameDir, 'upc_r2_loader64.exe'), 512);
  writeBytes(path.join(gameDir, 'AC4BFSP.exe'), 40 * 1024);
  const res = exeDetect.detectConfident(gameDir, 'Assassin’s Creed Black Flag Resynced');
  assert.ok(res, 'the real exe should be confidently identified by elimination');
  assert.strictEqual(res.name, 'AC4BFSP.exe');
  assert.strictEqual(res.confidence, 'sole-non-utility-candidate');
});

test('two genuinely ambiguous non-utility candidates stay ambiguous (elimination rule does not overreach)', () => {
  const gameDir = tmpGame('two-non-utility');
  writeBytes(path.join(gameDir, 'Foo.exe'), 1000);
  writeBytes(path.join(gameDir, 'Bar.exe'), 1000);
  const res = exeDetect.detect(gameDir, 'Totally Unrelated Title');
  assert.ok(res);
  assert.strictEqual(res.confident, false);
});

test('a loader never outranks a real exe in raw selection, even with a large size/dll advantage', () => {
  const gameDir = tmpGame('loader-outsizes-real-exe');
  const dll = path.join(gameDir, 'steam_api64.dll');
  writeBytes(dll, 1);
  // The loader sits next to the dll (max dll bonus) and dwarfs the real exe in size - without the
  // non-utility-first tie-break this can outscore the genuine candidate on raw score alone.
  writeBytes(path.join(gameDir, 'upc_r2_loader64.exe'), 50 * 1024 * 1024);
  writeBytes(path.join(gameDir, 'AC4BFSP.exe'), 128);
  const res = exeDetect.detect(gameDir, 'Assassin’s Creed Black Flag Resynced', { dllPaths: [dll] });
  assert.ok(res);
  assert.strictEqual(res.name, 'AC4BFSP.exe', 'the loader must never be picked over a genuine candidate');
});
