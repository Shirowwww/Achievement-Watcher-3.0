'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { resolvePowerShell } = require('./powershell.js');

function isValidAUMID(appID) {
  if (typeof appID !== 'string') return false;

  const value = appID.trim();
  if (value.length > 128 || value.includes(' ') || !value.includes('!')) return false;

  const [familyName] = value.split('!');
  if (!familyName.includes('_')) return false;

  const [name] = familyName.split('_');
  const sections = name.split('.');
  return sections.length >= 2 && sections.length <= 4;
}

async function has({ id, name } = {}) {
  try {
    const script = [
      '$apps = Get-StartApps;',
      name ? '$apps = $apps | Where-Object { $_.Name -like $args[0] };' : '',
      id ? '$apps = $apps | Where-Object { $_.AppID -match $args[1] };' : '',
      'if ($apps) { "true" } else { "false" }',
    ].join(' ');
    const args = [name ? `*${name}*` : '', id ? `.*${id}.*` : ''];
    const { stdout } = await execFileAsync(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script, ...args], { windowsHide: true });
    return stdout.trim().toLowerCase().includes('true');
  } catch {
    return false;
  }
}

module.exports = { has, isValidAUMID };
