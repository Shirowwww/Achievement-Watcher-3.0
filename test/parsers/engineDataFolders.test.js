'use strict';

// Godot/Unity engine payload folders must never be mistaken for the game.
// Real case: "Sovereign Tower" (Godot 4 C# export) surfaced as ".NET Runtime Crash Dump Generator"
// because the unconfigured scan descended into `data_<name>_windows_x86_64` and picked the .NET
// runtime's createdump.exe instead of the sovereign_tower.exe sitting one level above it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const exeDetect = require('../../app/parser/exeDetect.js');

const appDir = path.join(__dirname, '..', '..', 'app');

function tmpGame(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));
}

function writeBytes(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
}

// A Godot 4 C# export: the launcher and its pack at the root, the whole .NET runtime below.
function godotExport(gameDir, product) {
  writeBytes(path.join(gameDir, `${product.toLowerCase().replace(/ /g, '_')}.exe`), 5000);
  writeBytes(path.join(gameDir, `${product.toLowerCase().replace(/ /g, '_')}.pck`), 100);
  writeBytes(path.join(gameDir, 'crashpad_handler.exe'), 2000);
  const data = path.join(gameDir, `data_${product} (VS)_windows_x86_64`);
  writeBytes(path.join(data, 'createdump.exe'), 60000); // bigger than the game exe, on purpose
  writeBytes(path.join(data, `${product} (VS).dll`), 1000);
  return data;
}

test('createdump.exe is never a game executable', () => {
  assert.ok(exeDetect.isKnownNonGameExe('createdump.exe'));
  assert.ok(exeDetect.isKnownNonGameExe('CreateDump.exe'));

  const runtimeDir = tmpGame('dotnet-runtime');
  writeBytes(path.join(runtimeDir, 'createdump.exe'), 60000);
  assert.strictEqual(exeDetect.shallowGameExe(runtimeDir), null, 'a bare .NET runtime folder holds no game');
});

test('the engine payload folder pattern matches Godot and Unity layouts only', () => {
  const r = exeDetect.ENGINE_DATA_DIRS;
  assert.ok(r.test('data_Sovereign Tower (VS)_windows_x86_64'), 'Godot 4 C# export');
  assert.ok(r.test('data_MyGame_linux_x86_64'));
  assert.ok(r.test('MyGame_Data'), 'Unity payload');
  assert.ok(r.test('MonoBleedingEdge'), 'Unity mono runtime');
  assert.ok(!r.test('data'), 'a plain data folder is not an engine payload');
  assert.ok(!r.test('Sovereign Tower'), 'a game folder is not an engine payload');
  assert.ok(!r.test('Binaries'));
});

test('a Godot export resolves to the game exe, not the .NET runtime helper', () => {
  const gameDir = tmpGame('godot-export');
  godotExport(gameDir, 'Sovereign Tower');

  const detected = exeDetect.detect(gameDir, 'Sovereign Tower', {});
  assert.ok(detected, 'an executable should be detected');
  assert.strictEqual(path.basename(detected.full), 'sovereign_tower.exe');
  assert.ok(detected.confident, 'the game exe is safe to auto-assign');
});

test('the unconfigured scan stops at the folder that owns a game exe', () => {
  const source = fs.readFileSync(path.join(appDir, 'parser', 'achievements.js'), 'utf8');
  const walk = source.slice(source.indexOf('  const walk = (dir, depth) => {'));
  const body = walk.slice(0, walk.indexOf('\n  };'));
  assert.match(body, /!exeDetect\.ENGINE_DATA_DIRS\.test\(e\.name\)/, 'engine payload folders are not walked');
  assert.match(
    body,
    /const ownExe = !!exeDetect\.shallowGameExe\(dir\);\s*\n\s*if \(ownExe \|\|/,
    'a folder with an exe of its own is the game, never a container to descend into'
  );
});
