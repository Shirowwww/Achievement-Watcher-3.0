'use strict';

// Offline orchestration test for GSE's mandatory generate_interfaces step. A tiny command shim
// stands in for the official executable; the production archive/executable is verified separately.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gbe = require(path.join(__dirname, '..', 'app', 'parser', 'gbeInstaller.js'));

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

    const shim = path.join(tools, 'generate_interfaces_x64.cmd');
    fs.writeFileSync(shim, '@echo off\r\nfindstr /c:"original-steam-api" "%~1" >nul || exit /b 7\r\necho SteamClient=SteamClient020>steam_interfaces.txt\r\n');
    const result = await gbe.generateInterfaces({
      dllPath: dll,
      steamSettings: settings,
      dlls: { tag: 'test-build', interfaces: { x64: shim, x86: null } },
    });

    assert.strictEqual(result.generated, true);
    assert.strictEqual(result.original, `${dll}.bak`, 'must use the original backup, never the installed emulator DLL');
    assert.match(fs.readFileSync(path.join(settings, 'steam_interfaces.txt'), 'utf8'), /SteamClient020/);
    console.log('PASS: generate_interfaces uses the original DLL and installs steam_interfaces.txt');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
