'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isOfficialLauncherInstall } = require('../../app/parser/launcherDetect.js');

function makeGame(tmp, name, files = [], dirs = []) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), Buffer.alloc(16, 1));
  for (const sub of dirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

test('official launcher installs are recognised by their markers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-launcher-detect-'));
  try {
    // Ubisoft Connect legit: launcher markers, no Uplay R2 loader.
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Ubi Legit', ['uplay_install.state', 'ACGame.exe'])), true);
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Ubi Manifest', ['uplay_install.manifest', 'Game.exe'])), true);
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Ubi UpcCfg', ['upc.cfg', 'Game.exe'])), true);

    // Cracked Uplay R2: keeps the launcher markers AND ships the loader -> not official.
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Ubi Crack Root', ['uplay_install.state', 'upc_r2_loader64.dll', 'Game.exe'])), false);
    const nestedLoader = makeGame(tmp, 'Ubi Crack Nested', ['uplay_install.state', 'Game.exe'], ['Binaries', 'Binaries/Win64']);
    fs.writeFileSync(path.join(nestedLoader, 'Binaries', 'Win64', 'uplay_r2_loader64.dll'), Buffer.alloc(16, 1));
    assert.equal(isOfficialLauncherInstall(nestedLoader), false);

    // GOG Galaxy legit.
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'GOG Info', ['goggame-1423049311.info', 'Game.exe'])), true);
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'GOG Id', ['goggame-123.id', 'Game.exe'])), true);

    // Epic Games legit (.egstore metadata folder).
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Epic Game', ['Game.exe'], ['.egstore'])), true);

    // Microsoft Store / MSIX package.
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'MS Store', ['AppxManifest.xml', 'Game.exe'])), true);

    // Plain folders stay eligible for the unconfigured scan.
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Bare Crack', ['Game.exe'])), false);
    assert.equal(isOfficialLauncherInstall(makeGame(tmp, 'Empty Folder')), false);
    assert.equal(isOfficialLauncherInstall(path.join(tmp, 'does-not-exist')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
