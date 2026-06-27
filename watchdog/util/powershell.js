'use strict';

const fs = require('fs');
const path = require('path');

let cached;

function addToPath(exePath) {
  if (!path.isAbsolute(exePath)) return;
  const dir = path.dirname(exePath);
  const current = process.env.PATH || process.env.Path || '';
  const parts = current.split(path.delimiter).filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === dir.toLowerCase())) {
    process.env.PATH = [dir, ...parts].join(path.delimiter);
  }
}

function resolvePowerShell() {
  if (cached) return cached;

  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];

  cached = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || 'powershell.exe';

  addToPath(cached);

  return cached;
}

module.exports = { resolvePowerShell };
