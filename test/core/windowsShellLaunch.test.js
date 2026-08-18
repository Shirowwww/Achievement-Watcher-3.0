'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  START_PROCESS_SCRIPT,
  powershellPath,
  launchViaWindowsShell,
  isElevationLikeError,
  isElevationDeclinedError,
} = require('../../app/util/windowsShellLaunch.js');

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

// An explicit elevation is only ever requested, never assumed: the verb is empty unless asked for,
// because -Verb RunAs always raises a UAC prompt even for a game that does not need one.
test('elevation is opt-in and travels as the Start-Process verb', async () => {
  const executable = 'C:\\Games\\Needs Admin\\game.exe';
  const runWith = async (options) => {
    let call;
    await launchViaWindowsShell(options, {
      env: { SystemRoot: 'C:\\Windows' },
      exists: () => true,
      run(command, argv, opts, callback) {
        call = opts;
        callback(null);
      },
    });
    return call;
  };

  assert.equal((await runWith({ executable })).env.AW_GAME_LAUNCH_VERB, '');
  assert.equal((await runWith({ executable, elevate: true })).env.AW_GAME_LAUNCH_VERB, 'RunAs');
  assert.equal((await runWith({ executable, workingDirectory: 'C:\\Games' })).env.AW_GAME_LAUNCH_CWD, 'C:\\Games');
  // Start-Process reports a bad path or a declined prompt as a NON-terminating error, which leaves
  // powershell's exit code at 0. Without these the launcher reports every failure as a success.
  assert.match(START_PROCESS_SCRIPT, /ErrorAction = "Stop"/);
  assert.match(START_PROCESS_SCRIPT, /catch \{ \[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\); exit 1 \}/);
  assert.match(START_PROCESS_SCRIPT, /Remove-Item Env:AW_GAME_LAUNCH_EXE[^;]*AW_GAME_LAUNCH_VERB/);
});

// execFile's Error only carries the exit code; the reason the launch failed is on stderr, and it is
// the only thing that lets the caller tell "declined the prompt" from "could not start".
test('a failed shell launch surfaces the PowerShell message, not just the exit code', async () => {
  await assert.rejects(
    launchViaWindowsShell(
      { executable: 'C:\\Games\\g\\game.exe' },
      {
        env: { SystemRoot: 'C:\\Windows' },
        exists: () => true,
        run(command, argv, options, callback) {
          callback(new Error('Command failed: exit 1'), '', 'The operation was canceled by the user.\n');
        },
      }
    ),
    /The operation was canceled by the user/
  );
});

test('Windows reports "needs elevation" as EACCES, so both spellings route to the shell fallback', () => {
  assert.equal(isElevationLikeError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })), true);
  assert.equal(isElevationLikeError(Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })), true);
  assert.equal(isElevationLikeError(new Error('The requested operation requires elevation')), true);
  assert.equal(isElevationLikeError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })), false);
  assert.equal(isElevationLikeError(null), false);

  // Dismissing the UAC prompt is a decision, not a fault: it must never produce an error dialog.
  assert.equal(isElevationDeclinedError(new Error('The operation was canceled by the user.')), true);
  assert.equal(isElevationDeclinedError(new Error('This file does not have an app associated with it')), false);
});
