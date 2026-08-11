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

test('base exe wins over shadow -l variant in the same folder', () => {
  const gameDir = tmpGame('exe-shadow-l');
  const baseExe = path.join(gameDir, 'tlou-ii.exe');
  const launchVariant = path.join(gameDir, 'tlou-ii-l.exe');
  const rootDll = path.join(gameDir, 'steam_api64.dll');

  writeBytes(baseExe, 900);
  writeBytes(launchVariant, 1000);
  writeBytes(rootDll, 1);

  const detected = exeDetect.detect(gameDir, 'The Last of Us Part II Remastered', { dllPaths: [rootDll] });
  assert.ok(detected, 'an executable should be detected');
  assert.strictEqual(detected.full, baseExe);
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

test('a steam_settings folder nested under a Unity engine subfolder is anchored to the root game folder', () => {
  // Mirrors a real repack layout: "<Game>_Data/Plugins/x86_64/steam_settings" holds the Goldberg
  // config, but "<Game>.exe" lives three levels up. Anchoring gameDir at the nested folder would strand
  // the install with no reachable exe and leave the real root folder unclaimed (so a second, independent
  // scan pass could later "discover" it again as an unrelated duplicate).
  const root = tmpGame('goldberg-nested-steam-settings');
  const gameDir = path.join(root, 'Big Walk');
  const gameExe = path.join(gameDir, 'Big Walk.exe');
  const engineDir = path.join(gameDir, 'Big Walk_Data', 'Plugins', 'x86_64');
  const steamSettings = path.join(engineDir, 'steam_settings');

  writeBytes(gameExe, 200);
  fs.mkdirSync(steamSettings, { recursive: true });
  writeBytes(path.join(engineDir, 'steam_api64.dll'), 1);
  fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '1478500');

  const found = goldberg.findCompatibleGames([root]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].gameDir, gameDir, 'gameDir should be anchored at the top-level folder, not the nested engine folder');
  assert.strictEqual(found[0].appid, '1478500');
  // The exe finder must actually be able to find something once anchored correctly.
  const exe = exeDetect.detect(found[0].gameDir, path.basename(found[0].gameDir), {});
  assert.ok(exe, 'an exe should be discoverable from the corrected gameDir');
  assert.strictEqual(exe.full, gameExe);
});

test('a steam_settings folder that already sits next to the exe is left untouched (no unnecessary walk-up)', () => {
  const root = tmpGame('goldberg-shallow-steam-settings');
  const gameDir = path.join(root, 'Some Game');
  const gameExe = path.join(gameDir, 'SomeGame.exe');
  const steamSettings = path.join(gameDir, 'steam_settings');

  writeBytes(gameExe, 200);
  fs.mkdirSync(steamSettings, { recursive: true });
  fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '999000');

  const found = goldberg.findCompatibleGames([root]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].gameDir, gameDir);
  assert.strictEqual(found[0].appid, '999000');
});

test('a folder merely named like an engine subfolder (but actually the game root) is not walked past', () => {
  // The nested-anchor fix is gated on the marker folder's own name looking like an engine-internals
  // directory (x86_64, bin, plugins, ...) AND having no exe of its own. A top-level game folder that
  // happens to be named "bin" (unusual, but not impossible) and DOES have its own exe must be left alone.
  const root = tmpGame('goldberg-engine-named-root');
  const gameDir = path.join(root, 'bin');
  const gameExe = path.join(gameDir, 'game.exe');
  const steamSettings = path.join(gameDir, 'steam_settings');

  writeBytes(gameExe, 200);
  fs.mkdirSync(steamSettings, { recursive: true });
  fs.writeFileSync(path.join(steamSettings, 'steam_appid.txt'), '888000');

  const found = goldberg.findCompatibleGames([root]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].gameDir, gameDir);
  assert.strictEqual(found[0].appid, '888000');
});

test('steam_appid.txt tolerates trailing NUL bytes from repacks', () => {
  const root = tmpGame('goldberg-appid-nul');
  const gameDir = path.join(root, 'It Takes Two');
  const gameExe = path.join(gameDir, 'Nuts', 'Binaries', 'Win64', 'ItTakesTwo.exe');
  const nestedDll = path.join(gameDir, 'Nuts', 'Binaries', 'Win64', 'steam_api64.dll');

  writeBytes(gameExe, 200);
  writeBytes(nestedDll, 1);
  fs.writeFileSync(path.join(gameDir, 'steam_appid.txt'), '1426210\n\0');

  const found = goldberg.findCompatibleGames([root]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].gameDir, gameDir);
  assert.strictEqual(found[0].appid, '1426210');
});

test('real steam_settings schema wins over shallow overlay interfaces folder', () => {
  const gameDir = tmpGame('goldberg-settings-score');
  const overlaySettings = path.join(gameDir, '__overlay', 'steam_settings');
  const gameSettings = path.join(gameDir, 'Nuts', 'Binaries', 'Win64', 'steam_settings');

  fs.mkdirSync(overlaySettings, { recursive: true });
  fs.mkdirSync(gameSettings, { recursive: true });
  fs.writeFileSync(path.join(overlaySettings, 'steam_interfaces.txt'), 'SteamClient=SteamClient020\n');
  fs.writeFileSync(path.join(overlaySettings, 'achievements.json'), '[{"name":"A"}]');
  fs.writeFileSync(path.join(overlaySettings, 'configs.user.ini'), '[user::general]\n');
  fs.writeFileSync(path.join(gameSettings, 'achievements.json'), '[{"name":"A"}]');
  fs.writeFileSync(path.join(gameSettings, 'configs.user.ini'), '[user::general]\n');

  assert.strictEqual(goldberg.findSteamSettings(gameDir), gameSettings);
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
