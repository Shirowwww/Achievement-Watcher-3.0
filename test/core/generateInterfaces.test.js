'use strict';

// Offline orchestration test for GSE's mandatory generate_interfaces step. A tiny Node shim
// stands in for the official executable; the production archive/executable is verified separately.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gbe = require(path.join(__dirname, '..', '..', 'app', 'parser', 'gbeInstaller.js'));

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gse-interfaces-test-'));
  try {
    const game = path.join(temp, 'game');
    const settings = path.join(game, 'steam_settings');
    const tools = path.join(temp, 'tools');
    fs.mkdirSync(game, { recursive: true });
    fs.mkdirSync(tools, { recursive: true });
    const dll = path.join(game, 'steam_api64.dll');
    fs.writeFileSync(dll, 'replacement');
    fs.writeFileSync(`${dll}.bak`, 'original-steam-api');

    const shim = path.join(tools, 'generate_interfaces_x64.js');
    fs.writeFileSync(
      shim,
      "'use strict';\n" +
        "const fs = require('fs');\n" +
        "if (!fs.readFileSync(process.argv[2], 'utf8').includes('original-steam-api')) process.exit(7);\n" +
        "fs.writeFileSync('steam_interfaces.txt', 'SteamClient=SteamClient020\\n');\n"
    );
    const result = await gbe.generateInterfaces({
      dllPath: dll,
      steamSettings: settings,
      dlls: { tag: 'test-build', interfaces: { x64: { exe: process.execPath, args: [shim] }, x86: null } },
    });

    assert.strictEqual(result.generated, true);
    assert.strictEqual(result.original, `${dll}.bak`, 'must use the original backup, never the installed emulator DLL');
    assert.match(fs.readFileSync(path.join(settings, 'steam_interfaces.txt'), 'utf8'), /SteamClient020/);
    console.log('PASS: generate_interfaces uses the original DLL and installs steam_interfaces.txt');

    const noInterfacesTool = path.join(tools, 'generate_interfaces_no_interfaces.js');
    const noInterfacesSettings = path.join(game, 'no-interfaces-settings');
    fs.writeFileSync(noInterfacesTool, "console.log('Searching for interfaces...\\nNo interfaces were found');\nprocess.exit(1);\n");
    const skipped = await gbe.generateInterfaces({
      dllPath: dll,
      steamSettings: noInterfacesSettings,
      dlls: { tag: 'test-build', interfaces: { x64: { exe: process.execPath, args: [noInterfacesTool] }, x86: null } },
    });

    assert.strictEqual(skipped.generated, false);
    assert.strictEqual(skipped.reason, 'no-interfaces');
    assert.ok(!fs.existsSync(path.join(noInterfacesSettings, 'steam_interfaces.txt')), 'no-interface DLL should not create steam_interfaces.txt');
    console.log('PASS: generate_interfaces no-interface output is non-fatal');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
