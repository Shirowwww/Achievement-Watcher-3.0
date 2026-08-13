'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { START_PROCESS_SCRIPT, powershellPath, launchViaWindowsShell } = require('../../app/util/windowsShellLaunch.js');

test('manual Windows launch uses Start-Process with an explicit working directory and raw arguments', async () => {
  const executable = 'C:\\Games\\Portable Game\\game.exe';
  let call;
  await launchViaWindowsShell(
    { executable, args: '-savedir "C:\\My Saves"' },
    {
      env: { SystemRoot: 'C:\\Windows', KEEP_ME: 'yes' },
      exists: () => true,
      run(command, argv, options, callback) {
        call = { command, argv, options };
        callback(null);
      },
    }
  );

  assert.equal(call.command, path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.equal(call.argv.at(-1), START_PROCESS_SCRIPT);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.env.AW_GAME_LAUNCH_EXE, executable);
  assert.equal(call.options.env.AW_GAME_LAUNCH_CWD, path.dirname(executable));
  assert.equal(call.options.env.AW_GAME_LAUNCH_ARGS, '-savedir "C:\\My Saves"');
  assert.equal(call.options.env.KEEP_ME, 'yes');
  assert.match(START_PROCESS_SCRIPT, /Remove-Item Env:AW_GAME_LAUNCH_EXE/);
});

test('the PowerShell resolver falls back safely and missing executables are rejected', async () => {
  assert.equal(powershellPath({}, () => false), 'powershell.exe');
  await assert.rejects(
    launchViaWindowsShell({ executable: 'relative.exe' }, { exists: () => false }),
    /Game executable not found/
  );
});
