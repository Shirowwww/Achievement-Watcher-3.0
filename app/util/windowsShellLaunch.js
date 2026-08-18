'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/*
  Start-Process is ShellExecute, which is what makes this useful beyond spawn():

    - a GUI/.NET program gets a normal Windows launch environment (Ryujinx crashes in Console.Title
      when started as a detached child with ignored stdio handles);
    - an executable whose manifest asks for administrator is ELEVATED instead of failing. CreateProcess
      (spawn) refuses those outright with EACCES, which is the whole reason the caller falls back here.

  `-Verb RunAs` is the explicit form, for an executable that needs administrator rights without saying
  so in its manifest. It always prompts, so it is only used when asked for.

  Start-Process reports a bad path or a declined UAC prompt as a non-terminating error, which leaves
  powershell's exit code at 0 and made every failure look like a success. -ErrorAction Stop + the
  try/catch below turn it into a non-zero exit with the message on stderr, so execFile's callback sees it.
*/
const START_PROCESS_SCRIPT = [
  '$gameExe = $env:AW_GAME_LAUNCH_EXE',
  '$gameCwd = $env:AW_GAME_LAUNCH_CWD',
  '$gameArgs = $env:AW_GAME_LAUNCH_ARGS',
  '$gameVerb = $env:AW_GAME_LAUNCH_VERB',
  'Remove-Item Env:AW_GAME_LAUNCH_EXE, Env:AW_GAME_LAUNCH_CWD, Env:AW_GAME_LAUNCH_ARGS, Env:AW_GAME_LAUNCH_VERB -ErrorAction SilentlyContinue',
  '$launch = @{ FilePath = $gameExe; WorkingDirectory = $gameCwd; ErrorAction = "Stop" }',
  'if ($gameArgs) { $launch.ArgumentList = $gameArgs }',
  'if ($gameVerb) { $launch.Verb = $gameVerb }',
  'try { Start-Process @launch } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
].join('; ');

function powershellPath(env = process.env, exists = fs.existsSync) {
  const root = String(env.SystemRoot || env.WINDIR || '').trim();
  const bundled = root ? path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '';
  return bundled && exists(bundled) ? bundled : 'powershell.exe';
}

function launchViaWindowsShell(
  { executable, args = '', workingDirectory = path.dirname(executable || ''), elevate = false } = {},
  { run = execFile, env = process.env, exists = fs.existsSync } = {}
) {
  const exe = path.resolve(String(executable || ''));
  if (!path.isAbsolute(String(executable || '')) || !exists(exe)) {
    return Promise.reject(new Error(`Game executable not found: ${executable || ''}`));
  }
  const cwd = path.resolve(String(workingDirectory || path.dirname(exe)));
  if (!exists(cwd)) return Promise.reject(new Error(`Game working directory not found: ${cwd}`));

  return new Promise((resolve, reject) => {
    run(
      powershellPath(env, exists),
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', START_PROCESS_SCRIPT],
      {
        windowsHide: true,
        env: {
          ...env,
          AW_GAME_LAUNCH_EXE: exe,
          AW_GAME_LAUNCH_CWD: cwd,
          AW_GAME_LAUNCH_ARGS: String(args || ''),
          AW_GAME_LAUNCH_VERB: elevate ? 'RunAs' : '',
        },
      },
      // The UAC prompt writes the useful part ("The operation was canceled by the user") to stderr;
      // execFile's Error only carries the exit code, so the message is re-attached here.
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const detail = String(stderr || '').trim();
        reject(detail ? Object.assign(new Error(detail), { cause: error }) : error);
      }
    );
  });
}

/*
  Windows refuses a CreateProcess (spawn) launch of an executable that requires elevation with
  ERROR_ELEVATION_REQUIRED, which libuv reports as EACCES - indistinguishable by code alone from a
  genuine permission problem, so both are answered the same way: retry through ShellExecute.
*/
function isElevationLikeError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'EACCES' || code === 'EPERM') return true;
  return /elevation|requires elevation|access is denied|EACCES|EPERM/i.test(String(error.message || error));
}

// True when the failure is the user declining (or dismissing) the UAC prompt, rather than the launch
// itself going wrong. Worth telling apart: there is nothing to retry and nothing to report as broken.
function isElevationDeclinedError(error) {
  return /operation was canceled by the user|canceled by the user|annulée par l|1223/i.test(String((error && error.message) || error || ''));
}

module.exports = { START_PROCESS_SCRIPT, powershellPath, launchViaWindowsShell, isElevationLikeError, isElevationDeclinedError };
