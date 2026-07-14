'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const uplayR2 = require(path.join(__dirname, '..', 'app', 'parser', 'uplayR2.js'));
const uplayR2Installer = require(path.join(__dirname, '..', 'app', 'parser', 'uplayR2Installer.js'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-uplayr2-'));
const savedAppData = process.env.APPDATA;
process.env.APPDATA = path.join(temp, 'AppData');

(async () => {
  try {
    // derivePrefixedIds: a game whose Steam api-names all share one prefix+trailing-digits is supported.
    const consistent = uplayR2.derivePrefixedIds([
      { name: 'Ach_Prologue_1' },
      { name: 'Ach_Prologue_10' },
      { name: 'Ach_Prologue_29' },
    ]);
    assert.deepStrictEqual(consistent, { prefix: 'Ach_Prologue_', count: 3 });

    // Mismatched prefixes across achievements -> unsupported (null), not a guess.
    assert.strictEqual(
      uplayR2.derivePrefixedIds([{ name: 'Ach_Prologue_1' }, { name: 'Ach_Epilogue_2' }]),
      null,
      'a game with more than one prefix family should be reported unsupported'
    );

    // An achievement whose name has no trailing digits breaks the convention entirely.
    assert.strictEqual(
      uplayR2.derivePrefixedIds([{ name: 'Ach_Prologue_1' }, { name: 'ACH_NO_DIGITS' }]),
      null,
      'a name with no trailing digits should be reported unsupported'
    );

    assert.strictEqual(uplayR2.derivePrefixedIds([]), null, 'an empty list is unsupported');
    console.log('PASS: derivePrefixedIds only accepts a single consistent prefix+digits convention');

    // buildAchievementsSchemaJson keys by the REAL Steam api-name (== prefix+digits), no transform.
    const schemaJson = uplayR2.buildAchievementsSchemaJson({
      achievement: {
        list: [
          { name: 'Ach_Prologue_1', displayName: 'Prologue', description: 'Complete the Prologue' },
          { name: 'Ach_Prologue_10', displayName: 'The Ronin' }, // no description
        ],
      },
    });
    assert.deepStrictEqual(schemaJson, {
      Ach_Prologue_1: { displayName: 'Prologue', description: 'Complete the Prologue', earned: 0 },
      Ach_Prologue_10: { displayName: 'The Ronin', description: '', earned: 0 },
    });
    console.log('PASS: buildAchievementsSchemaJson keys by the real Steam api-name');

    // resolveSteamMapping: exact uplay_id match (Assassin's Creed II, a real entry in uplay-steam.json).
    const byId = uplayR2.resolveSteamMapping({ appid: 'UPLAY4' });
    assert.strictEqual(byId.steam_appid, 33230);
    assert.strictEqual(byId.uplay_id, '4');

    // Fuzzy name match should resolve to the same entry without an id.
    const byName = uplayR2.resolveSteamMapping({ name: "Assassin's Creed II" });
    assert.strictEqual(byName.steam_appid, 33230);

    // A repack folder can have an unrelated name; Ubisoft's binary install state still embeds the
    // canonical product title and must win before the folder-name fallback.
    const renamedInstall = path.join(temp, 'Totally Unrelated Repack Folder');
    fs.mkdirSync(renamedInstall, { recursive: true });
    fs.writeFileSync(
      path.join(renamedInstall, 'uplay_install.state'),
      Buffer.concat([Buffer.from([0x0a, 0x24]), Buffer.from("Assassin's Creed Black Flag Resynced"), Buffer.from([0x10, 0x01])])
    );
    const byInstallState = uplayR2.resolveSteamMapping({ gameDir: renamedInstall, name: 'Wrong Folder Name' });
    assert.strictEqual(byInstallState.steam_appid, 3751950);
    assert.strictEqual(byInstallState.uplay_id, '65043');

    const officialIdentity = uplayR2.resolveGameIdentity({
      appid: 'uplay-65043',
      ubisoftProductId: '65043',
      name: "Assassin's Creed Black Flag Resynced",
    });
    assert.strictEqual(officialIdentity.uplayId, '65043');
    assert.strictEqual(officialIdentity.steamAppid, '3751950');

    assert.strictEqual(uplayR2.resolveSteamMapping({ appid: 'UPLAY999999999', name: 'Not A Real Game Xyzzy' }), null);
    console.log('PASS: resolveSteamMapping and UI identity normalize native, namespaced and mapped ids');

    // detectEmulator: bounded shallow walk finds the loader dll in a nested Binaries folder.
    const gameDir = path.join(temp, 'My Ubisoft Game');
    const dllDir = path.join(gameDir, 'Binaries', 'Win64');
    fs.mkdirSync(dllDir, { recursive: true });
    fs.writeFileSync(path.join(dllDir, 'uplay_r2_loader64.dll'), 'stub');
    const emu = uplayR2.detectEmulator(gameDir);
    assert.strictEqual(emu.type, 'uplayR2');
    assert.strictEqual(emu.dll.length, 1);
    assert.strictEqual(uplayR2.detectEmulator(path.join(temp, 'nonexistent')).type, 'none');
    assert.strictEqual(uplayR2.isUbisoftInstall(gameDir), true, 'a loader-only install is Ubisoft');

    const markerOnlyDir = path.join(temp, 'Unknown Ubisoft Game');
    fs.mkdirSync(markerOnlyDir, { recursive: true });
    fs.writeFileSync(path.join(markerOnlyDir, 'uplay_install.manifest'), 'opaque');
    assert.strictEqual(uplayR2.isUbisoftInstall(markerOnlyDir), true, 'an unmapped marker-only install is still Ubisoft');
    assert.strictEqual(uplayR2.isUbisoftInstall(path.join(temp, 'nonexistent')), false, 'an ordinary folder is not Ubisoft');

    assert.strictEqual(uplayR2.isUbisoftGame({ source: 'Uplay R2' }), true);
    assert.strictEqual(uplayR2.isUbisoftGame({ system: 'uplay' }), true);
    assert.strictEqual(uplayR2.isUbisoftGame({ uplayR2: true }), true);
    assert.strictEqual(uplayR2.isUbisoftGame({ appid: 'UPLAY65043' }), true);
    assert.strictEqual(uplayR2.isUbisoftGame({ source: 'GBE Fork', appid: '3751950' }), false);
    console.log('PASS: Ubisoft classifier covers loaders, install markers, flags, system and legacy ids');

    const toolPaths = uplayR2.getGameToolPaths({
      appid: '3751950',
      name: "Assassin's Creed Black Flag Resynced",
      gameDir,
      uplayR2: true,
    });
    assert.strictEqual(toolPaths.steamAppid, '3751950');
    assert.strictEqual(toolPaths.uplayId, '65043');
    assert.strictEqual(toolPaths.runtimeDir, dllDir);
    assert.strictEqual(toolPaths.configFile, path.join(dllDir, 'uplay_r2.ini'));
    assert.strictEqual(toolPaths.schemaFile, path.join(dllDir, 'achievements_schema.json'));
    assert.strictEqual(toolPaths.saveDir, path.join(process.env.APPDATA, 'GSE Saves', '3751950'));

    const sourceIcon = path.join(__dirname, '..', 'app', 'Source', 'ubisoft.svg');
    assert.ok(fs.existsSync(sourceIcon), 'the Ubisoft source must ship a dedicated icon');
    assert.match(fs.readFileSync(sourceIcon, 'utf8'), /aria-label="Ubisoft Connect"/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8'), /getSourceImg\('ubisoft'\)/);
    console.log('PASS: Ubisoft UI tools expose mapped ids, runtime paths and a dedicated source icon');

    // diagnose(): no dll yet -> NO_UPLAY_R2_DLL, no read/write attempted.
    const emptyDir = path.join(temp, 'Empty Game');
    fs.mkdirSync(emptyDir, { recursive: true });
    const noDllReport = uplayR2.diagnose({ gameDir: emptyDir, appid: 'UPLAY4' });
    assert.strictEqual(noDllReport.ok, false);
    assert.ok(noDllReport.issues.some((i) => i.code === 'NO_UPLAY_R2_DLL'));

    // repair(): full round trip — schema + ini written, DLC/Items/Chunks preserved, GSE Saves pre-created.
    const repair1 = uplayR2.repair({
      dir: dllDir,
      steamAppid: 33230,
      schema: { achievement: { list: [{ name: 'Ach_Prologue_1', displayName: 'Prologue', description: 'Complete the Prologue' }] } },
      prefix: 'Ach_Prologue_',
      accountName: 'Shiro',
      language: 'french',
    });
    assert.strictEqual(repair1.wroteSchema, true);
    assert.strictEqual(repair1.backupDir, null, 'first repair has nothing to back up yet');
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(dllDir, 'achievements_schema.json'), 'utf8')),
      { Ach_Prologue_1: { displayName: 'Prologue', description: 'Complete the Prologue', earned: 0 } }
    );

    const expectedSavePath = path.join(process.env.APPDATA, 'GSE Saves', '33230');
    assert.ok(fs.existsSync(expectedSavePath), 'repair should pre-create the GSE Saves\\<steamAppid> folder');

    for (const iniName of uplayR2.INI_NAMES) {
      const ini = fs.readFileSync(path.join(dllDir, iniName), 'utf8');
      assert.ok(/Achievements\s*=\s*1/.test(ini), `${iniName} should enable Achievements`);
      assert.ok(/AchKeyPrefix\s*=\s*Ach_Prologue_/.test(ini), `${iniName} should set AchKeyPrefix`);
      assert.ok(/AchSaveType\s*=\s*1/.test(ini), `${iniName} should redirect AchSaveType`);
      assert.ok(ini.includes(expectedSavePath), `${iniName} should point AchSavePath at GSE Saves\\33230`);
      assert.ok(/Username\s*=\s*Shiro/.test(ini), `${iniName} should stamp the account name`);
      assert.ok(/\[DLC\]/.test(ini) && /\[Items\]/.test(ini) && /\[Chunks\]/.test(ini), `${iniName} should keep the DLC/Items/Chunks sections`);
    }
    console.log('PASS: repair writes achievements_schema.json + patches both ini variants');

    // A second repair must never overwrite the UserId already on disk (would orphan the runtime save),
    // and must back up the previous schema/ini.
    const savedUserId = fs.readFileSync(path.join(dllDir, 'uplay_r2.ini'), 'utf8').match(/UserId\s*=\s*(\S+)/)[1];
    const repair2 = uplayR2.repair({
      dir: dllDir,
      steamAppid: 33230,
      schema: { achievement: { list: [{ name: 'Ach_Prologue_1', displayName: 'Prologue' }, { name: 'Ach_Prologue_10', displayName: 'The Ronin' }] } },
      prefix: 'Ach_Prologue_',
    });
    assert.ok(repair2.backupDir, 'second repair should back up the previous schema/ini');
    assert.ok(fs.existsSync(path.join(repair2.backupDir, 'achievements_schema.json')));
    const userIdAfter = fs.readFileSync(path.join(dllDir, 'uplay_r2.ini'), 'utf8').match(/UserId\s*=\s*(\S+)/)[1];
    assert.strictEqual(userIdAfter, savedUserId, 'repair must never overwrite an existing UserId');
    assert.strictEqual(Object.keys(repair2.achievementsSchemaJson).length, 2, 'repair should reflect the updated schema');
    console.log('PASS: repair backs up the previous config and never orphans the UserId');

    // diagnose() now reports a valid setup + the runtime save state.
    const goodReport = uplayR2.diagnose({ gameDir, appid: 'UPLAY4' });
    assert.strictEqual(goodReport.ok, true, `expected ok diagnose, got issues: ${JSON.stringify(goodReport.issues)}`);
    assert.strictEqual(goodReport.mapping.steam_appid, 33230);
    assert.ok(goodReport.issues.some((i) => i.code === 'NO_SAVE_YET'), 'no unlocks written yet is expected, not an error');
    console.log('PASS: diagnose reports a fully configured Uplay R2 setup');

    // uplayR2Installer: cache seeding + install with .bak backup.
    const cacheDir = path.join(temp, 'cache', 'uplayR2');
    let dlls = uplayR2Installer.ensureEmulatorDlls({ cacheDir });
    assert.strictEqual(dlls.seeded, false, 'an empty cache should report not seeded');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'uplay_r2_loader64.dll'), 'REAL DLL BYTES');
    dlls = uplayR2Installer.ensureEmulatorDlls({ cacheDir });
    assert.strictEqual(dlls.seeded, true);

    const installResult = uplayR2Installer.installDlls({ dllDirs: [dllDir], dlls });
    assert.strictEqual(installResult.installed, 1);
    assert.strictEqual(installResult.backedUp, 1, 'the cracked stub dll should be backed up once');
    assert.strictEqual(fs.readFileSync(path.join(dllDir, 'uplay_r2_loader64.dll'), 'utf8'), 'REAL DLL BYTES');
    assert.ok(fs.existsSync(path.join(dllDir, 'uplay_r2_loader64.dll.bak')));

    // A second install must not re-backup (the .bak must always hold the ORIGINAL cracked stub).
    fs.writeFileSync(path.join(cacheDir, 'uplay_r2_loader64.dll'), 'REAL DLL V2');
    const installResult2 = uplayR2Installer.installDlls({ dllDirs: [dllDir], dlls: uplayR2Installer.ensureEmulatorDlls({ cacheDir }) });
    assert.strictEqual(installResult2.backedUp, 0, 're-installing must not clobber the original .bak');
    assert.strictEqual(fs.readFileSync(path.join(dllDir, 'uplay_r2_loader64.dll.bak'), 'utf8'), 'stub', 'the .bak must remain the original cracked stub');
    console.log('PASS: uplayR2Installer seeds from a user cache and installs with a one-time backup');
  } finally {
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
