'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const goldberg = require(path.join(__dirname, '..', 'app', 'parser', 'goldberg.js'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gbe-backup-'));
(async () => {
  try {
    const gameDir = path.join(temp, 'My Game');
    const dllDir = path.join(gameDir, 'Binaries', 'Win64');
    const steamSettings = path.join(dllDir, 'steam_settings');
    const destinationRoot = path.join(temp, 'user backups');
    fs.mkdirSync(steamSettings, { recursive: true });
    fs.mkdirSync(destinationRoot, { recursive: true });
    fs.writeFileSync(path.join(dllDir, 'steam_api64.dll'), 'original dll');
    fs.writeFileSync(path.join(steamSettings, 'configs.main.ini'), '[main]');
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), '[{"name":"OLD"}]');

    const incomplete = goldberg.diagnose({ gameDir, appid: '480', schema: { achievement: { list: [{ name: 'OLD' }] } } });
    assert.ok(incomplete.issues.some((i) => i.code === 'NO_DLC_CONFIG'), 'diagnosis should flag missing configs.app.ini');
    assert.ok(incomplete.issues.some((i) => i.code === 'NO_USER_CONFIG'), 'diagnosis should flag missing configs.user.ini');
    assert.ok(incomplete.issues.some((i) => i.code === 'NO_NEW_APP_TICKET'), 'diagnosis should flag missing modern app ticket config');
    assert.ok(incomplete.issues.some((i) => i.code === 'NO_GC_TOKEN'), 'diagnosis should flag missing GC token config');

    const backup = goldberg.backupSetup({ gameDir, destinationRoot });
    assert.strictEqual(fs.readFileSync(path.join(backup.backupDir, 'Binaries', 'Win64', 'steam_api64.dll'), 'utf8'), 'original dll');
    assert.strictEqual(fs.readFileSync(path.join(backup.backupDir, 'Binaries', 'Win64', 'steam_settings', 'configs.main.ini'), 'utf8'), '[main]');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(backup.backupDir, 'backup.json'), 'utf8')).gameDir, gameDir);

    // Restore the portable backup over a mutated install: the original dll + schema must come back,
    // and the manifest's recorded relative paths must land at their nested locations.
    fs.writeFileSync(path.join(dllDir, 'steam_api64.dll'), 'tampered dll');
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), '[{"name":"TAMPERED"}]');
    const restore = goldberg.restoreSetup({ backupDir: backup.backupDir, gameDir });
    assert.strictEqual(fs.readFileSync(path.join(dllDir, 'steam_api64.dll'), 'utf8'), 'original dll', 'restore should bring back the original dll');
    assert.strictEqual(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'), '[{"name":"OLD"}]', 'restore should bring back the original schema');
    assert.ok(restore.files.length >= 2, 'restore summary should list the restored items');
    assert.throws(() => goldberg.restoreSetup({ backupDir: destinationRoot, gameDir }), /backup\.json/, 'restore should reject a folder without a manifest');

    const repair = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: { achievement: { list: [{ name: 'NEW', displayName: 'New', description: 'New achievement', hidden: 0 }] } },
    });
    assert.ok(repair.backupDir, 'repair should preserve the schema it replaces');
    assert.strictEqual(fs.readFileSync(path.join(repair.backupDir, 'achievements.json'), 'utf8'), '[{"name":"OLD"}]');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'))[0].name, 'NEW');
    console.log('PASS: portable GBE backup and non-destructive repair');

    // DLC + user config: repair writes configs.app.ini (unlock_all + the fetched id=name list) and
    // configs.user.ini (account_name + language), preserving an existing account_steamid + ip_country.
    fs.writeFileSync(path.join(steamSettings, 'configs.user.ini'), '[user::general]\naccount_steamid=76561197960287930\nip_country=US\n');
    const repair2 = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: { achievement: { list: [{ name: 'A', displayName: 'A', hidden: 0 }] } },
      fetchDlc: async () => [{ appid: 111, name: 'DLC One' }, { appid: 222, name: 'DLC Two' }],
      accountName: 'Shiro',
      language: 'french',
    });
    const appIni = fs.readFileSync(path.join(steamSettings, 'configs.app.ini'), 'utf8');
    assert.ok(/\[app::dlcs\]/.test(appIni), 'configs.app.ini should have an [app::dlcs] section');
    assert.ok(/\bunlock_all=1\b/.test(appIni), 'configs.app.ini should unlock all DLCs');
    assert.ok(/\n111=DLC One\b/.test(appIni) && /\n222=DLC Two\b/.test(appIni), 'configs.app.ini should list the fetched DLCs');
    assert.strictEqual(repair2.dlc.count, 2, 'repair summary should report 2 DLCs');

    const userIni = fs.readFileSync(path.join(steamSettings, 'configs.user.ini'), 'utf8');
    assert.ok(/\baccount_name=Shiro\b/.test(userIni), 'configs.user.ini should set account_name');
    assert.ok(/\blanguage=french\b/.test(userIni), 'configs.user.ini should set language');
    assert.ok(/\baccount_steamid=76561197960287930\b/.test(userIni), 'configs.user.ini must preserve account_steamid');
    assert.ok(/\bip_country=US\b/.test(userIni), 'configs.user.ini must preserve ip_country');
    assert.strictEqual(repair2.user.language, 'french');
    assert.strictEqual(repair2.user.changed, true);
    const mainIni = fs.readFileSync(path.join(steamSettings, 'configs.main.ini'), 'utf8');
    assert.ok(/\[main::general\]/.test(mainIni), 'configs.main.ini should have [main::general]');
    assert.ok(/\bnew_app_ticket=1\b/.test(mainIni), 'configs.main.ini should enable new_app_ticket');
    assert.ok(/\bgc_token=1\b/.test(mainIni), 'configs.main.ini should enable gc_token');
    assert.ok(/\[main::stats\]/.test(mainIni), 'configs.main.ini should have [main::stats]');
    assert.ok(/\bstat_achievement_progress_functionality=1\b/.test(mainIni), 'configs.main.ini should enable stat achievement progress');
    assert.strictEqual(repair2.main.newAppTicket, true);
    assert.strictEqual(repair2.main.gcToken, true);
    const unchangedUser = goldberg.writeUserConfig({ steamSettings, accountName: 'Shiro', language: 'french' });
    assert.strictEqual(unchangedUser.changed, false, 'an unchanged identity should not rewrite configs.user.ini every scan');

    // A repack that left GBE's template placeholder local_save_path active must be neutralized so saves
    // land in the monitored GSE Saves folder; a genuine custom path must be preserved.
    fs.writeFileSync(path.join(steamSettings, 'configs.user.ini'),
      '[user::general]\naccount_steamid=765\n\n[user::saves]\nlocal_save_path=./path/relative/to/dll\nsaves_folder_name=GSE Saves\n');
    const fixedUser = goldberg.writeUserConfig({ steamSettings, accountName: 'Shiro', language: 'french' });
    const fixedIni = fs.readFileSync(path.join(steamSettings, 'configs.user.ini'), 'utf8');
    assert.strictEqual(fixedUser.savePathFixed, true, 'placeholder local_save_path should be flagged fixed');
    assert.ok(/^local_save_path=\s*$/m.test(fixedIni), 'placeholder local_save_path should be blanked');
    assert.ok(/\baccount_steamid=765\b/.test(fixedIni) && /\bsaves_folder_name=GSE Saves\b/.test(fixedIni), 'neutralizing the save path must preserve the rest of the section');
    const reFixed = goldberg.writeUserConfig({ steamSettings, accountName: 'Shiro', language: 'french' });
    assert.strictEqual(reFixed.changed, false, 'a blanked save path should not be rewritten on the next scan');

    fs.writeFileSync(path.join(steamSettings, 'configs.user.ini'), '[user::saves]\nlocal_save_path=D:/MySaves\n');
    const customUser = goldberg.writeUserConfig({ steamSettings, accountName: 'Shiro', language: 'french' });
    assert.strictEqual(customUser.savePathFixed, false, 'a custom local_save_path must not be touched');
    assert.ok(/local_save_path=D:\/MySaves/.test(fs.readFileSync(path.join(steamSettings, 'configs.user.ini'), 'utf8')), 'a custom local_save_path must be preserved');
    // restore the canonical identity config the later diagnose() assertions expect
    fs.writeFileSync(path.join(steamSettings, 'configs.user.ini'), '[user::general]\naccount_name=Shiro\nlanguage=french\naccount_steamid=76561197960287930\nip_country=US\n');

    const complete = goldberg.diagnose({ gameDir, appid: '480', schema: { achievement: { list: [{ name: 'A' }] } } });
    assert.ok(!complete.issues.some((i) => i.code === 'NO_DLC_CONFIG' || i.code === 'NO_USER_CONFIG' || i.code === 'NO_NEW_APP_TICKET' || i.code === 'NO_GC_TOKEN'));

    // Merge, don't clobber: a second pass with a curated DLC entry keeps the earlier ones.
    await goldberg.writeDlcConfig({ steamSettings, dlcs: [{ appid: 333, name: 'DLC Three' }] });
    const appIni2 = fs.readFileSync(path.join(steamSettings, 'configs.app.ini'), 'utf8');
    assert.ok(/\n111=DLC One\b/.test(appIni2) && /\n333=DLC Three\b/.test(appIni2), 'writeDlcConfig should union with existing DLC entries');
    console.log('PASS: repair writes/merges DLC + user config (preserving steamid)');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
