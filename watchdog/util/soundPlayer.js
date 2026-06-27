'use strict';

const { execFile } = require('child_process');
const { resolvePowerShell } = require('./powershell.js');

function play(filePath, { delayMs = 0, volume = 0.5 } = {}) {
  return new Promise((resolve, reject) => {
    const run = () => {
      const script = [
        '$ErrorActionPreference = "Stop";',
        'Add-Type -AssemblyName PresentationCore;',
        '$player = New-Object System.Windows.Media.MediaPlayer;',
        '$player.Open([Uri]::new($env:AW_SOUND_FILE));',
        '$player.Volume = [Math]::Max(0, [Math]::Min(1, [double]$env:AW_SOUND_VOLUME));',
        '$player.Play();',
        'Start-Sleep -Milliseconds 250;',
        'while (-not $player.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 50; }',
        'Start-Sleep -Milliseconds ([Math]::Max(250, [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds));',
        '$player.Close();',
      ].join(' ');

      execFile(
        resolvePowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          env: {
            ...process.env,
            AW_SOUND_FILE: filePath,
            AW_SOUND_VOLUME: String(volume),
          },
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    };

    const ms = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 0;
    if (ms > 0) setTimeout(run, ms);
    else run();
  });
}

module.exports = { play };
