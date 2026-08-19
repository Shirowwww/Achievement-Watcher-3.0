'use strict';

/*
  The two file-changing repairs Game Health can run, and the plans that describe them before they
  run. Both delegate to the existing parsers rather than writing files themselves, so the backup
  behaviour those parsers already implement is the backup behaviour here:

    goldberg.repair()        copies every file it is about to replace into steam_settings/.aw-backups/<timestamp>/
    gbeInstaller.installDlls() copies each replaced steam_api dll to <name>.bak once

  Dependencies are injected so this stays testable without Electron, a network or a game install.
*/

const path = require('path');

// What "Repair the achievement data" is about to write, in the caller's own terms. The renderer
// shows this before the first byte is written; nothing here touches the disk.
function planAchievementDataRepair({ steamSettings, gameDir, achievementCount = 0, downloadIcons = false } = {}) {
  const target = steamSettings || (gameDir ? path.join(gameDir, 'steam_settings') : '');
  const writes = ['achievements.json', 'steam_appid.txt', 'configs.app.ini', 'configs.main.ini', 'configs.user.ini'];
  if (downloadIcons) writes.push('images/');
  return { target, writes, achievementCount, backup: target ? path.join(target, '.aw-backups') : '' };
}

/*
  Resolve where the emulator runtime dll(s) would go. Mirrors the directory choice the right-click
  emulator fix makes, so a game repaired from here ends up with the same layout.
*/
function planRuntimeInstall({ gbeInstaller, gameDir, exePath = null, steamSettings = null, dllPaths = [], arch = 'x64' } = {}) {
  const dirs = gbeInstaller.runtimeDllDirs({ gameDir, dllPaths, exePath, steamSettings });
  const file = gbeInstaller.ARCH[arch] ? gbeInstaller.ARCH[arch].file : gbeInstaller.ARCH.x64.file;
  return { dirs, arch, file, backup: `${file}.bak` };
}

/*
  Write the achievement schema, icons and GBE config files for one game. `schema` is the AW game
  object; every other argument is passed straight through to goldberg.repair(), including the
  backup it performs first.
*/
async function repairAchievementData({
  goldberg,
  plan,
  appid,
  schema,
  downloadIcon = null,
  fetchDlc = null,
  accountName = '',
  language = '',
  // Complete configs.user.ini even when the app has no name or language to stamp into it - the two
  // user-config warnings are listed as repairable, so the repair has to be able to clear them.
  fillUserDefaults = false,
  // Passed straight to goldberg.repair(); see its onProgress for the phases and their counts.
  onProgress = null,
} = {}) {
  if (!plan || !plan.target) throw new Error('repairAchievementData: no steam_settings target resolved');
  return goldberg.repair({
    steamSettings: plan.target,
    appid,
    schema,
    downloadIcon,
    fetchDlc,
    accountName,
    language,
    fillUserDefaults,
    onProgress,
  });
}

/*
  Install the supported GBE Fork runtime dll(s) into the planned directories. Used for the one case
  Game Health diagnoses as a runtime fault: a complete steam_settings with no steam_api dll beside
  it, so nothing will ever read the schema. steam_interfaces.txt is regenerated when the original
  dll is still recoverable - a best-effort step that never fails the install.
*/
async function installEmulatorRuntime({ gbeInstaller, plan, cacheDir, steamSettings = null, log } = {}) {
  if (!plan || !Array.isArray(plan.dirs) || plan.dirs.length === 0) {
    throw new Error('installEmulatorRuntime: no target directory resolved');
  }
  const dlls = await gbeInstaller.ensureEmulatorDlls({ cacheDir, log });
  const summary = gbeInstaller.installDlls({
    dllDirs: plan.dirs,
    dlls,
    writeIfMissing: plan.arch,
    ensureArch: plan.arch,
    log,
  });

  let interfaces = null;
  if (steamSettings) {
    try {
      interfaces = await gbeInstaller.generateInterfaces({
        dllPath: path.join(plan.dirs[0], plan.file),
        steamSettings,
        dlls,
        log,
      });
    } catch (err) {
      // The emulator still works without steam_interfaces.txt for most titles; surface it in the
      // result instead of failing an otherwise successful install.
      interfaces = { generated: false, reason: String((err && err.message) || err) };
    }
  }

  return { ...summary, interfaces };
}

module.exports = { planAchievementDataRepair, planRuntimeInstall, repairAchievementData, installEmulatorRuntime };
