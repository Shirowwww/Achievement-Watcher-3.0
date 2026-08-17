'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isOfficialLauncherInstall, steamLibraryAppid } = require('../../app/parser/launcherDetect.js');
const goldberg = require('../../app/parser/goldberg.js');

function makeGame(tmp, name, files = [], dirs = []) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), Buffer.alloc(16, 1));
  for (const sub of dirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

// A Steam library: appmanifest_<appid>.acf next to the common/<installdir> folder it describes.
function makeSteamLibrary(tmp, name) {
  const steamapps = path.join(tmp, name, 'steamapps');
  fs.mkdirSync(path.join(steamapps, 'common'), { recursive: true });
  return {
    steamapps,
    install(appid, installdir, { emulated = false, files = ['Game.exe', 'steam_appid.txt'] } = {}) {
      fs.writeFileSync(
        path.join(steamapps, `appmanifest_${appid}.acf`),
        `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"installdir"\t\t"${installdir}"\n}\n`
      );
      const dir = path.join(steamapps, 'common', installdir);
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      for (const file of files) fs.writeFileSync(path.join(dir, file), file === 'steam_appid.txt' ? String(appid) : Buffer.alloc(16, 1));
      // Valve's dll and an emulated one are both called steam_api64.dll; only the contents differ.
      fs.writeFileSync(path.join(dir, 'bin', 'steam_api64.dll'), Buffer.from(emulated ? 'MZ...steam_settings/achievements.json...' : 'MZ...SteamAPI_Init...'));
      return dir;
    },
  };
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

test('a game Steam installed is a launcher install, not a cracked one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-library-'));
  try {
    const library = makeSteamLibrary(tmp, 'Jeux');
    // Source games ship steam_appid.txt, and every Steam game ships steam_api64.dll — the two
    // markers the emulator scan keys on. Steam's own manifest is what settles it (Garry's Mod).
    const gmod = library.install(4000, 'GarrysMod');
    assert.equal(steamLibraryAppid(gmod), '4000');
    assert.equal(steamLibraryAppid(path.join(gmod, 'bin')), '4000', 'a folder inside the install resolves to the same game');
    assert.equal(isOfficialLauncherInstall(gmod), true);

    // Cracked in place: the manifest is still there, but the dll was replaced.
    const cracked = library.install(500, 'Cracked In Place', { emulated: true });
    assert.equal(steamLibraryAppid(cracked), '500');
    assert.equal(isOfficialLauncherInstall(cracked), false);

    // A folder that merely sits under some other "common" directory is not a Steam install.
    const lookalike = makeGame(tmp, path.join('games', 'common', 'Repack'), ['Game.exe', 'steam_appid.txt']);
    assert.equal(steamLibraryAppid(lookalike), null);
    assert.equal(isOfficialLauncherInstall(lookalike), false);

    // The whole point: the install scan no longer offers a Steam game as an emulator target.
    const skipped = [];
    const found = goldberg.findCompatibleGames([tmp], { onSkip: (dir, appid) => skipped.push(appid) });
    assert.deepEqual(skipped, ['4000']);
    const dirs = found.map((g) => g.gameDir);
    assert.ok(dirs.includes(cracked), 'the cracked install in the same library is still found');
    assert.ok(!dirs.includes(gmod), 'the Steam install is not offered as an emulator target');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
