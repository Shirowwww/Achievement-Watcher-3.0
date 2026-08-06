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

    // Loader builds without AchKeyPrefix support look the unlock up by the BARE objective id, so the
    // schema they are given has to be keyed that way or every in-game unlock misses.
    assert.deepStrictEqual(
      uplayR2.buildAchievementsSchemaJson(
        { achievement: { list: [{ name: 'Ach_Prologue_1', displayName: 'Prologue', description: 'Complete the Prologue' }] } },
        { keyed: false }
      ),
      { 1: { displayName: 'Prologue', description: 'Complete the Prologue', earned: 0 } }
    );
    console.log('PASS: buildAchievementsSchemaJson keys by api-name, or by bare id for legacy loaders');

    // resolveSteamMapping: exact uplay_id match (Assassin's Creed II, a real entry in uplay-steam.json).
    const byId = uplayR2.resolveSteamMapping({ appid: 'UPLAY4' });
    assert.strictEqual(byId.steam_appid, 33230);
    assert.strictEqual(byId.uplay_id, '4');

    // Regression (issue #14): the Steam variant of Far Cry 4 registers as Ubisoft product 971.
    // It must resolve to Steam 298110 through the mapping asset even when the install folder
    // registry key is missing and the configurations block carries only storefront names.
    const fc4By971 = uplayR2.resolveSteamMapping({ appid: 'UPLAY971' });
    assert.strictEqual(fc4By971.steam_appid, 298110);
    assert.strictEqual(fc4By971.steam_name, 'Far Cry® 4');

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
    // The stub carries the ini key names a real loader binary embeds, because inspectLoader() reads
    // them to decide whether this build understands the achievement redirect at all.
    const MODERN_LOADER = 'stub AchSavePath AchSaveType AchKeyPrefix Achievements';
    const LEGACY_LOADER = 'stub Achievements SaveType SavePath'; // pre-redirect build
    const gameDir = path.join(temp, 'My Ubisoft Game');
    const dllDir = path.join(gameDir, 'Binaries', 'Win64');
    fs.mkdirSync(dllDir, { recursive: true });
    fs.writeFileSync(path.join(dllDir, 'uplay_r2_loader64.dll'), MODERN_LOADER);
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
    // The loader opens upc_r2.ini first and only falls back to uplay_r2.ini, so that precedence is
    // what INI_NAMES (and therefore the reported config file) must follow.
    assert.strictEqual(uplayR2.INI_NAMES[0], 'upc_r2.ini');
    assert.strictEqual(toolPaths.configFile, path.join(dllDir, 'upc_r2.ini'));
    assert.strictEqual(toolPaths.schemaFile, path.join(dllDir, 'achievements_schema.json'));
    assert.strictEqual(toolPaths.saveDir, path.join(process.env.APPDATA, 'GSE Saves', '3751950'));
    assert.strictEqual(toolPaths.loader.supportsAchRedirect, true, 'the modern stub advertises redirect support');

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
    assert.strictEqual(fs.readFileSync(path.join(dllDir, 'uplay_r2_loader64.dll.bak'), 'utf8'), MODERN_LOADER, 'the .bak must remain the original cracked stub');
    console.log('PASS: uplayR2Installer seeds from a user cache and installs with a one-time backup');

    /*
      Legacy loader (no AchSaveType/AchSavePath/AchKeyPrefix support).

      Writing the redirect keys to such a build produces an ini that reads as fully configured while
      the emulator quietly keeps saving to its own folder and looks unlocks up by bare objective id —
      the exact silent failure behind "the achievements don't work". repair() must therefore adapt
      both the ini it writes and the way it keys the schema.
    */
    const legacyDir = path.join(temp, 'Legacy Ubisoft Game');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'upc_r2_loader64.dll'), LEGACY_LOADER);
    const legacyRepair = uplayR2.repair({
      dir: legacyDir,
      steamAppid: 3751950,
      schema: { achievement: { list: [{ name: 'ACObsidian_Ach_1', displayName: 'Last to Leave' }, { name: 'ACObsidian_Ach_7', displayName: 'Fort Fight' }] } },
      prefix: 'ACObsidian_Ach_',
    });
    assert.strictEqual(legacyRepair.loader.supportsAchRedirect, false);
    assert.deepStrictEqual(Object.keys(legacyRepair.achievementsSchemaJson), ['1', '7'], 'a legacy loader gets bare objective ids');
    for (const iniName of uplayR2.INI_NAMES) {
      const ini = fs.readFileSync(path.join(legacyDir, iniName), 'utf8');
      assert.ok(/Achievements\s*=\s*1/.test(ini), `${iniName} should still enable achievements`);
      assert.ok(!/^[ \t]*AchSavePath[ \t]*=[ \t]*\S/m.test(ini), `${iniName} must not claim a redirect the loader ignores`);
    }
    console.log('PASS: repair adapts schema keys and ini keys to a legacy loader build');

    // Reading back what such a build wrote: its own save folder, keyed by bare objective id.
    const legacySaveDir = path.join(process.env.APPDATA, 'Goldberg UplayEmu Saves', '65043');
    fs.mkdirSync(legacySaveDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacySaveDir, 'achievements.json'),
      JSON.stringify({
        1: { displayName: 'Last to Leave', earned: 1, earned_time: 1750000000 },
        7: { displayName: 'Fort Fight', earned: 0 },
      })
    );
    const saveDirs = uplayR2.resolveAchievementSaveDirs({ gameDir: legacyDir, runtimeDir: legacyDir, uplayId: '65043', steamAppid: 3751950 });
    assert.ok(saveDirs.includes(legacySaveDir), `the emulator's default save folder must be a candidate: ${saveDirs.join(', ')}`);
    const legacySave = uplayR2.readAchievementSave(saveDirs);
    assert.strictEqual(legacySave.dir, legacySaveDir);

    const remapped = uplayR2.mapSaveToSchemaKeys(legacySave.entries, {
      prefix: 'ACObsidian_Ach_',
      apiNames: ['ACObsidian_Ach_1', 'ACObsidian_Ach_7', 'ACObsidian_Ach_9'],
    });
    assert.deepStrictEqual(Object.keys(remapped).sort(), ['ACObsidian_Ach_1', 'ACObsidian_Ach_7']);
    assert.strictEqual(remapped.ACObsidian_Ach_1.earned, 1);
    assert.strictEqual(remapped.ACObsidian_Ach_1.earned_time, 1750000000);

    // A save that uses the prefixed keys (modern loader) resolves through the same call, and a key
    // belonging to no achievement in this game's schema is dropped rather than guessed at.
    assert.deepStrictEqual(
      Object.keys(uplayR2.mapSaveToSchemaKeys({ ACObsidian_Ach_7: { earned: 1 }, ACOther_Ach_3: { earned: 1 } }, { prefix: 'ACObsidian_Ach_', apiNames: ['ACObsidian_Ach_7'] })),
      ['ACObsidian_Ach_7']
    );

    /*
      Several candidate folders routinely hold an achievements.json at once — the emulator seeds a
      fully-locked copy from the schema, a previous SaveType leaves one behind, and repair()
      pre-creates the redirect target. Stopping at the first file found would let any of those stale,
      all-zero copies mask the one the game is really writing, so the read merges them and an unlock
      always wins over a lock.
    */
    const staleDir = path.join(legacyDir, 'saves', '65043');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'achievements.json'),
      JSON.stringify({ 1: { earned: 0 }, 7: { earned: 0 }, 12: { earned: 1, earned_time: 1750000900 } })
    );
    const mergedSave = uplayR2.readAchievementSave(
      uplayR2.resolveAchievementSaveDirs({ gameDir: legacyDir, runtimeDir: legacyDir, uplayId: '65043', steamAppid: 3751950 })
    );
    assert.ok(mergedSave.files.length >= 2, `both saves should be read, got ${JSON.stringify(mergedSave.files)}`);
    assert.equal(mergedSave.entries['1'].earned, 1, 'an unlock in one file must not be masked by a lock in another');
    assert.equal(mergedSave.entries['12'].earned, 1, 'an unlock only present in the second file must still be seen');

    // Same rule for timestamps: the most recent unlock wins.
    fs.writeFileSync(path.join(staleDir, 'achievements.json'), JSON.stringify({ 1: { earned: 1, earned_time: 1760000000 } }));
    const newest = uplayR2.readAchievementSave(
      uplayR2.resolveAchievementSaveDirs({ gameDir: legacyDir, runtimeDir: legacyDir, uplayId: '65043', steamAppid: 3751950 })
    );
    assert.equal(newest.entries['1'].earned_time, 1760000000);
    fs.rmSync(path.join(legacyDir, 'saves'), { recursive: true, force: true });
    console.log('PASS: unlock state is merged across every save folder, never masked by a stale copy');

    // An ini pointing somewhere custom is honoured ahead of the defaults.
    const customSaveDir = path.join(temp, 'custom-saves');
    fs.writeFileSync(path.join(legacyDir, 'upc_r2.ini'), '[Settings]\nAchievements = 1\nSaveType = 2\nSavePath = ' + customSaveDir + '\n');
    assert.strictEqual(
      uplayR2.resolveAchievementSaveDirs({ gameDir: legacyDir, runtimeDir: legacyDir, uplayId: '65043', steamAppid: 3751950 })[0],
      customSaveDir
    );
    console.log('PASS: unlocks are read from wherever the emulator actually writes them, re-keyed to Steam api-names');

    // diagnose() must surface a wiped setup rather than silently reporting 0%: a game update that
    // re-extracts the repack removes achievements_schema.json and restores its own ini.
    fs.rmSync(path.join(legacyDir, 'achievements_schema.json'));
    fs.writeFileSync(path.join(legacyDir, 'upc_r2.ini'), '[Settings]\nAchievements = 0\n');
    const wipedReport = uplayR2.diagnose({ gameDir: legacyDir, appid: 'UPLAY65043' });
    assert.strictEqual(wipedReport.ok, false);
    assert.ok(wipedReport.issues.some((i) => i.code === 'NO_SCHEMA_JSON'), 'a missing schema is an error');
    assert.ok(wipedReport.issues.some((i) => i.code === 'ACHIEVEMENTS_DISABLED'), 'Achievements=0 is an error, not a warning');
    assert.ok(wipedReport.issues.some((i) => i.code === 'LOADER_NO_ACH_REDIRECT'), 'the loader limitation is reported');
    console.log('PASS: diagnose detects a setup wiped by a game update');
  } finally {
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
