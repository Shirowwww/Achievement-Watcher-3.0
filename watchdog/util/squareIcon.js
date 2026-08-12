'use strict';

// Windows toast `appLogoOverride` expects a square image; Steam library art is portrait/landscape.
// Center-crop the high-res local copy into a square PNG before powertoast builds the toast.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fileURLToPath } = require('url');
const { resolvePowerShell } = require('./powershell.js');
const { userDataDir } = require('./userData.js');

function localImagePath(source) {
  if (!source || typeof source !== 'string') return null;
  if (source.startsWith('file:///')) {
    try {
      source = fileURLToPath(source);
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(source)) return null;
  return fs.existsSync(source) ? source : null;
}

function squareOutputPath(appid, sourcePath, userDataRoot) {
  const dir = path.join(userDataRoot || userDataDir(), 'steam_cache', 'icon', String(appid || 'unknown'));
  const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  return path.join(dir, `${base}-square.png`);
}

function makeSquareIcon(source, appid, options = {}) {
  const src = localImagePath(source);
  if (!src) return Promise.resolve(null);
  const dst = squareOutputPath(appid, src, options.userDataRoot);
  if (fs.existsSync(dst)) return Promise.resolve(dst);

  return new Promise((resolve, reject) => {
    const script = [
      '$ErrorActionPreference = "Stop";',
      'Add-Type -AssemblyName System.Drawing;',
      '$img = [System.Drawing.Image]::FromFile($env:AW_ICON_SRC);',
      'try {',
      '  $side = [Math]::Min($img.Width, $img.Height);',
      '  if ($side -le 0) { throw "Invalid image dimensions"; }',
      '  $srcX = [Math]::Max(0, [Math]::Floor(($img.Width - $side) / 2));',
      '  $srcY = [Math]::Max(0, [Math]::Floor(($img.Height - $side) / 2));',
      '  $bmp = New-Object System.Drawing.Bitmap($side, $side);',
      '  try {',
      '    $g = [System.Drawing.Graphics]::FromImage($bmp);',
      '    try {',
      '      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;',
      '      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality;',
      '      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality;',
      '      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality;',
      '      $srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $side, $side);',
      '      $dstRect = New-Object System.Drawing.Rectangle(0, 0, $side, $side);',
      '      $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel);',
      '    } finally { $g.Dispose(); }',
      '    $dir = Split-Path -Parent $env:AW_ICON_DST;',
      '    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; }',
      '    $bmp.Save($env:AW_ICON_DST, [System.Drawing.Imaging.ImageFormat]::Png);',
      '  } finally { $bmp.Dispose(); }',
      '} finally { $img.Dispose(); }',
    ].join(' ');

    execFile(
      resolvePowerShell(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          AW_ICON_SRC: src,
          AW_ICON_DST: dst,
        },
      },
      (err) => {
        if (err) reject(err);
        else resolve(fs.existsSync(dst) ? dst : null);
      }
    );
  });
}

module.exports = { localImagePath, makeSquareIcon, squareOutputPath };
