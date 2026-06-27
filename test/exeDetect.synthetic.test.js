'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const exeDetect = require('../app/parser/exeDetect.js');
const goldberg = require('../app/parser/goldberg.js');

function tmpGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));
}

function writeBytes(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

test('root exe beside root steam_api64 wins over nested steam_api helper exe', () => {
  const gameDir = tmpGame('exe-root-dll');
  const gameExe = path.join(gameDir, 'RealGame.exe');
  const rootDll = path.join(gameDir, 'steam_api64.dll');
  const helperExe = path.join(gameDir, 'Tools', 'BiggerHelper.exe');
  const helperDll = path.join(gameDir, 'Tools', 'steam_api.dll');

  writeBytes(gameExe, 10);
  writeBytes(rootDll, 1);
  writeBytes(helperExe, 1000);
  writeBytes(helperDll, 1);

  const detected = exeDetect.detect(gameDir, '', { dllPaths: [rootDll, helperDll] });
  assert.ok(detected, 'an executable should be detected');
  assert.strictEqual(detected.full, gameExe);
});

test('nested exe beside steam_api is still valid when there is no root Steam API pair', () => {
  const gameDir = tmpGame('exe-nested-dll');
  const launcherExe = path.join(gameDir, 'Launcher.exe');
  const gameExe = path.join(gameDir, 'Binaries', 'Win64', 'RealGame.exe');
  const nestedDll = path.join(gameDir, 'Binaries', 'Win64', 'steam_api64.dll');

  writeBytes(launcherExe, 5000);
  writeBytes(gameExe, 100);
  writeBytes(nestedDll, 1);

  const detected = exeDetect.detect(gameDir, 'Real Game', { dllPaths: [nestedDll] });
  assert.ok(detected, 'an executable should be detected');
  assert.strictEqual(detected.full, gameExe);
});

test('root exe wins when steam_api lives in a nested helper folder', () => {
  const gameDir = tmpGame('exe-root-nested-dll');
  const gameExe = path.join(gameDir, 'RealGame.exe');
  const helperExe = path.join(gameDir, 'Tools', 'BiggerHelper.exe');
  const helperDll = path.join(gameDir, 'Tools', 'steam_api64.dll');

  writeBytes(gameExe, 200);
  writeBytes(helperExe, 1000);
  writeBytes(helperDll, 1);

  const detected = exeDetect.detect(gameDir, '', { dllPaths: [helperDll] });
  assert.ok(detected, 'an executable should be detected');
  assert.strictEqual(detected.full, gameExe);
});

test('nested steam_api and nested appid config are anchored to the root game folder', () => {
  const root = tmpGame('goldberg-root-anchor');
  const gameDir = path.join(root, 'Real Game');
  const gameExe = path.join(gameDir, 'RealGame.exe');
  const nestedDll = path.join(gameDir, 'Engine', 'Bin', 'steam_api64.dll');
  const nestedAppid = path.join(gameDir, 'Config', 'steam_appid.txt');

  writeBytes(gameExe, 200);
  writeBytes(nestedDll, 1);
  fs.mkdirSync(path.dirname(nestedAppid), { recursive: true });
  fs.writeFileSync(nestedAppid, '123456');

  const found = goldberg.findCompatibleGames([root]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].gameDir, gameDir);
  assert.strictEqual(found[0].appid, '123456');
});

test('takenGameDirs prevents a second exe from the same install folder', () => {
  const gameDir = tmpGame('exe-one-per-dir');
  const gameExe = path.join(gameDir, 'RealGame.exe');
  const rootDll = path.join(gameDir, 'steam_api64.dll');

  writeBytes(gameExe, 10);
  writeBytes(rootDll, 1);

  const detected = exeDetect.detect(gameDir, 'Real Game', { dllPaths: [rootDll], takenGameDirs: [gameDir] });
  assert.strictEqual(detected, null);
});
