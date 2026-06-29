'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const goldberg = require('../app/parser/goldberg.js');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nested-appid-'));
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('bundled modding editor subfolder does not steal the game appid (DOS2 / The Divinity Engine 2)', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const game = path.join(root, 'Divinity Original Sin 2');
  // Game root has steam_settings but NO steam_appid.txt -> forces the nested fallback.
  fs.mkdirSync(path.join(game, 'steam_settings'), { recursive: true });
  write(path.join(game, 'steam_api64.dll'), 'x');
  write(path.join(game, 'EoCApp.exe'), 'x'.repeat(5000));
  // The shipped editor carries its own (wrong) appid.
  write(path.join(game, 'The Divinity Engine 2', 'steam_appid.txt'), '435730');
  // The real game's appid lives nested in a bin folder.
  write(path.join(game, 'DefEd', 'bin', 'steam_appid.txt'), '435150');

  const found = goldberg.findCompatibleGames([root]);
  const ids = found.map((g) => String(g.appid));
  assert.ok(ids.includes('435150'), 'the game appid should be resolved');
  assert.ok(!ids.includes('435730'), "the editor's appid must never be picked up");
});

test('a direct root steam_appid.txt always wins over a bundled tool subfolder', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const game = path.join(root, 'Divinity Original Sin 2');
  fs.mkdirSync(game, { recursive: true });
  write(path.join(game, 'steam_appid.txt'), '435150');
  write(path.join(game, 'steam_api64.dll'), 'x');
  write(path.join(game, 'The Divinity Engine 2', 'steam_appid.txt'), '435730');

  const ids = goldberg.findCompatibleGames([root]).map((g) => String(g.appid));
  assert.deepStrictEqual(ids, ['435150']);
});

test('a normal single nested appid is still found', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const game = path.join(root, 'Some Game');
  fs.mkdirSync(path.join(game, 'steam_settings'), { recursive: true });
  write(path.join(game, 'steam_api64.dll'), 'x');
  write(path.join(game, 'game.exe'), 'x'.repeat(5000));
  write(path.join(game, 'bin', 'steam_appid.txt'), '480');

  const ids = goldberg.findCompatibleGames([root]).map((g) => String(g.appid));
  assert.ok(ids.includes('480'), 'a legit nested appid must still resolve');
});

// Each name here is a companion-tool subfolder; its appid (777xxx) must never beat the game's (555000).
for (const tool of [
  'Creation Kit',
  'Construction Kit',
  'Dedicated Server',
  'Workshop Tools',
  'Authoring Tools',
  'World Editor',
  'LevelEditor',
  'Dev Kit',
  'SDK',
  'Benchmark',
]) {
  test(`bundled tool subfolder "${tool}" does not steal the game appid`, (t) => {
    const root = mkRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const game = path.join(root, 'Cool Game');
    fs.mkdirSync(path.join(game, 'steam_settings'), { recursive: true });
    write(path.join(game, 'steam_api64.dll'), 'x');
    write(path.join(game, 'CoolGame.exe'), 'x'.repeat(5000));
    write(path.join(game, tool, 'steam_appid.txt'), '777999');
    write(path.join(game, 'bin', 'steam_appid.txt'), '555000');

    const ids = goldberg.findCompatibleGames([root]).map((g) => String(g.appid));
    assert.ok(ids.includes('555000'), `the game appid should win over "${tool}"`);
    assert.ok(!ids.includes('777999'), `"${tool}" appid must not be picked up`);
  });
}

test('a legit game whose TITLE contains a tool word (e.g. "Engine") still resolves its nested appid', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Folder name contains "Engine", but the appid lives in a normal "Binaries/Win64" subfolder — the
  // tool filter must not stop us descending into ordinary game folders.
  const game = path.join(root, 'Train Engine Simulator');
  fs.mkdirSync(path.join(game, 'steam_settings'), { recursive: true });
  write(path.join(game, 'steam_api64.dll'), 'x');
  write(path.join(game, 'TrainSim.exe'), 'x'.repeat(5000));
  write(path.join(game, 'Binaries', 'Win64', 'steam_appid.txt'), '424242');

  const ids = goldberg.findCompatibleGames([root]).map((g) => String(g.appid));
  assert.ok(ids.includes('424242'), 'a normal nested appid under non-tool folders must still resolve');
});
