'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const START_PROCESS_SCRIPT = [
  '$gameExe = $env:AW_GAME_LAUNCH_EXE',
  '$gameCwd = $env:AW_GAME_LAUNCH_CWD',
  '$gameArgs = $env:AW_GAME_LAUNCH_ARGS',
  'Remove-Item Env:AW_GAME_LAUNCH_EXE, Env:AW_GAME_LAUNCH_CWD, Env:AW_GAME_LAUNCH_ARGS -ErrorAction SilentlyContinue',
  '$launch = @{ FilePath = $gameExe; WorkingDirectory = $gameCwd }',
  'if ($gameArgs) { $launch.ArgumentList = $gameArgs }',
  'Start-Process @launch',
].join('; ');

function powershellPath(env = process.env, exists = fs.existsSync) {
  const root = String(env.SystemRoot || env.WINDIR || '').trim();
  const bundled = root ? path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '';
  return bundled && exists(bundled) ? bundled : 'powershell.exe';
}

function launchViaWindowsShell(
  { executable, args = '', workingDirectory = path.dirname(executable || '') } = {},
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
        },
      },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

module.exports = { START_PROCESS_SCRIPT, powershellPath, launchViaWindowsShell };
