'use strict';

/*
  Game Health repairs. Two things are being protected here:

  1. the plan a repair announces has to match what it then writes, because that plan is the text the
     user approves before anything is modified;
  2. the repairs must keep delegating to the parsers that own the backup behaviour, instead of
     growing their own write path that could skip it.

  The second point is checked against the real goldberg.repair() on a temporary folder, so a change
  that stopped backing files up would fail here rather than in someone's game install.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const goldberg = require(path.join(appDir, 'parser', 'goldberg.js'));
const {
  planAchievementDataRepair,
  planRuntimeInstall,
  repairAchievementData,
  installEmulatorRuntime,
} = require(path.join(appDir, 'util', 'gameHealthRepair.js'));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const schema = {
  name: 'Test Game',
  achievement: {
    total: 2,
    list: [
      { name: 'ACH_ONE', displayName: 'One', description: 'First', hidden: 0, icon: '', icongray: '' },
      { name: 'ACH_TWO', displayName: 'Two', description: 'Second', hidden: 0, icon: '', icongray: '' },
    ],
  },
};

test('the achievement-data plan names the folder, the files and the backup location', () => {
  const plan = planAchievementDataRepair({ gameDir: path.join('C:', 'Jeux', 'Test'), achievementCount: 2 });
  assert.equal(plan.target, path.join('C:', 'Jeux', 'Test', 'steam_settings'));
  assert.equal(plan.backup, path.join(plan.target, '.aw-backups'));
  assert.ok(plan.writes.includes('achievements.json'));
  assert.ok(plan.writes.includes('configs.user.ini'));
  assert.ok(!plan.writes.includes('images/'), 'icons are only announced when they will be downloaded');

  const withIcons = planAchievementDataRepair({ steamSettings: 'S:/ss', downloadIcons: true });
  assert.equal(withIcons.target, 'S:/ss');
  assert.ok(withIcons.writes.includes('images/'));
});

test('an explicit steam_settings path wins over deriving one from the game folder', () => {
  const plan = planAchievementDataRepair({ steamSettings: 'D:/Games/X/bin/steam_settings', gameDir: 'D:/Games/X' });
  assert.equal(plan.target, 'D:/Games/X/bin/steam_settings');
});

test('the achievement-data repair refuses to run without a resolved target', async () => {
  await assert.rejects(() => repairAchievementData({ goldberg, plan: { target: '' }, schema }), /no steam_settings target/);
  await assert.rejects(() => repairAchievementData({ goldberg, plan: null, schema }), /no steam_settings target/);
});

test('the achievement-data repair writes the schema through goldberg.repair', async () => {
  const gameDir = tempDir('aw-health-repair-');
  try {
    const plan = planAchievementDataRepair({ gameDir });
    const summary = await repairAchievementData({ goldberg, plan, appid: '480', schema });

    assert.equal(summary.steamSettings, plan.target);
    const written = JSON.parse(fs.readFileSync(path.join(plan.target, 'achievements.json'), 'utf8'));
    assert.deepEqual(written.map((a) => a.name), ['ACH_ONE', 'ACH_TWO']);
    assert.equal(fs.readFileSync(path.join(plan.target, 'steam_appid.txt'), 'utf8'), '480');
    // A first-time write has nothing to preserve, so it must not leave an empty backup folder.
    assert.equal(summary.backupDir, null);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('rerunning the repair preserves the previous files in the announced backup folder', async () => {
  const gameDir = tempDir('aw-health-backup-');
  try {
    const plan = planAchievementDataRepair({ gameDir });
    fs.mkdirSync(plan.target, { recursive: true });
    fs.writeFileSync(path.join(plan.target, 'achievements.json'), '[{"name":"OLD"}]');

    const summary = await repairAchievementData({ goldberg, plan, appid: '480', schema });

    assert.ok(summary.backupDir, 'the previous version must be backed up');
    assert.ok(
      summary.backupDir.startsWith(plan.backup),
      `the backup must land where the plan said (${plan.backup}), got ${summary.backupDir}`
    );
    const preserved = JSON.parse(fs.readFileSync(path.join(summary.backupDir, 'achievements.json'), 'utf8'));
    assert.deepEqual(preserved, [{ name: 'OLD' }], 'the overwritten file is recoverable');
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
  }
});

test('the runtime plan announces the arch-correct file and its .bak', () => {
  const stub = {
    ARCH: { x64: { file: 'steam_api64.dll' }, x86: { file: 'steam_api.dll' } },
    runtimeDllDirs: ({ gameDir }) => [gameDir],
  };
  const x64 = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'x64' });
  assert.deepEqual(x64.dirs, ['C:/Jeux/Test']);
  assert.equal(x64.file, 'steam_api64.dll');
  assert.equal(x64.backup, 'steam_api64.dll.bak');

  const x86 = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'x86' });
  assert.equal(x86.file, 'steam_api.dll');

  // An unknown arch must still produce a usable plan rather than an undefined filename.
  const odd = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'arm64' });
  assert.equal(odd.file, 'steam_api64.dll');
});

test('the runtime install refuses to run without a target directory', async () => {
  const stub = { ensureEmulatorDlls: async () => ({}), installDlls: () => ({}) };
  await assert.rejects(() => installEmulatorRuntime({ gbeInstaller: stub, plan: { dirs: [] } }), /no target directory/);
  await assert.rejects(() => installEmulatorRuntime({ gbeInstaller: stub, plan: null }), /no target directory/);
});

test('the runtime install passes the planned dirs and arch straight to installDlls', async () => {
  const calls = {};
  const stub = {
    ARCH: { x64: { file: 'steam_api64.dll' }, x86: { file: 'steam_api.dll' } },
    runtimeDllDirs: () => ['C:/Jeux/Test'],
    ensureEmulatorDlls: async (args) => {
      calls.ensure = args;
      return { tag: 'v1.2.3', x64: 'cached/steam_api64.dll' };
    },
    installDlls: (args) => {
      calls.install = args;
      return { installed: 1, backedUp: 1, tag: 'v1.2.3', perDir: [] };
    },
    generateInterfaces: async (args) => {
      calls.interfaces = args;
      return { generated: true };
    },
  };

  const plan = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'x64' });
  const summary = await installEmulatorRuntime({
    gbeInstaller: stub,
    plan,
    cacheDir: 'C:/cache/gbe',
    steamSettings: 'C:/Jeux/Test/steam_settings',
  });

  assert.equal(calls.ensure.cacheDir, 'C:/cache/gbe');
  assert.deepEqual(calls.install.dllDirs, ['C:/Jeux/Test']);
  // Both are needed: a folder with no dll at all still has to receive one.
  assert.equal(calls.install.writeIfMissing, 'x64');
  assert.equal(calls.install.ensureArch, 'x64');
  assert.equal(calls.install.dlls.tag, 'v1.2.3');
  assert.equal(summary.installed, 1);
  assert.equal(summary.backedUp, 1, 'the replaced dll count is reported, not swallowed');
  assert.equal(summary.interfaces.generated, true);
});

test('a failed steam_interfaces generation is reported without failing the install', async () => {
  const stub = {
    ARCH: { x64: { file: 'steam_api64.dll' } },
    runtimeDllDirs: () => ['C:/Jeux/Test'],
    ensureEmulatorDlls: async () => ({ tag: 'v1' }),
    installDlls: () => ({ installed: 1, backedUp: 0, tag: 'v1', perDir: [] }),
    generateInterfaces: async () => {
      throw new Error('generator exploded');
    },
  };
  const plan = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'x64' });
  const summary = await installEmulatorRuntime({ gbeInstaller: stub, plan, cacheDir: 'C:/cache', steamSettings: 'C:/Jeux/Test/steam_settings' });

  assert.equal(summary.installed, 1, 'the dll install still counts as done');
  assert.equal(summary.interfaces.generated, false);
  assert.match(summary.interfaces.reason, /generator exploded/, 'the failure is surfaced, not hidden');
});

test('a download failure aborts the install instead of reporting a partial success', async () => {
  const stub = {
    ARCH: { x64: { file: 'steam_api64.dll' } },
    runtimeDllDirs: () => ['C:/Jeux/Test'],
    ensureEmulatorDlls: async () => {
      throw new Error('Could not reach GitHub');
    },
    installDlls: () => assert.fail('installDlls must not run without cached dlls'),
  };
  const plan = planRuntimeInstall({ gbeInstaller: stub, gameDir: 'C:/Jeux/Test', arch: 'x64' });
  await assert.rejects(() => installEmulatorRuntime({ gbeInstaller: stub, plan, cacheDir: 'C:/cache' }), /Could not reach GitHub/);
});

/*
  Correcting steam_appid.txt. repair() writes that file only when it is missing — deliberately, since
  an automatic repair must not overwrite a working setup with a detection that could be wrong. This
  is the explicit, user-confirmed version of the same write, and it keeps the previous value.
*/
{
  const fs = require('node:fs');
  const os = require('node:os');
  const goldberg = require(path.join(__dirname, '..', '..', 'app', 'parser', 'goldberg.js'));

  const steamSettings = (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-appid-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'steam_settings');
  };

  test('correcting the appid keeps the previous file in the shared backup folder', (t) => {
    const target = steamSettings(t);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'steam_appid.txt'), '111', 'utf8');

    const result = goldberg.writeSteamAppId({ steamSettings: target, appid: '367520' });

    assert.equal(result.changed, true);
    assert.equal(result.previous, '111');
    assert.equal(fs.readFileSync(path.join(target, 'steam_appid.txt'), 'utf8'), '367520');
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'steam_appid.txt'), 'utf8'), '111', 'the old value must remain recoverable');
  });

  test('writing the value that is already there changes and backs up nothing', (t) => {
    const target = steamSettings(t);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'steam_appid.txt'), '367520', 'utf8');

    const result = goldberg.writeSteamAppId({ steamSettings: target, appid: '367520' });
    assert.equal(result.changed, false);
    assert.equal(result.backupDir, null);
  });

  test('a missing file is simply created', (t) => {
    const target = steamSettings(t);
    const result = goldberg.writeSteamAppId({ steamSettings: target, appid: '480' });
    assert.equal(result.changed, true);
    assert.equal(result.previous, null);
    assert.equal(fs.readFileSync(path.join(target, 'steam_appid.txt'), 'utf8'), '480');
  });

  // The value is written verbatim into a file an emulator parses: anything but digits is a bug.
  test('anything that is not an appid is refused before a byte is written', (t) => {
    const target = steamSettings(t);
    for (const bad of ['', null, undefined, 'abc', '12a', '../../etc']) {
      assert.throws(() => goldberg.writeSteamAppId({ steamSettings: target, appid: bad }));
    }
    assert.equal(fs.existsSync(path.join(target, 'steam_appid.txt')), false);
  });
}
