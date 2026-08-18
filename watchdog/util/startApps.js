'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { resolvePowerShell } = require('./powershell.js');

// A PACKAGED (MSIX/UWP) app id: "<PackageFamilyName>!<ApplicationId>", e.g.
// "Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App". This shape matters beyond cosmetics: only a
// packaged identity lets Windows download http(s) toast images. A desktop app must ship local files.
function isPackagedAUMID(appID) {
  if (typeof appID !== 'string') return false;

  const value = appID.trim();
  if (value.length > 128 || value.includes(' ') || !value.includes('!')) return false;

  const [familyName] = value.split('!');
  if (!familyName.includes('_')) return false;

  const [name] = familyName.split('_');
  const sections = name.split('.');
  return sections.length >= 2 && sections.length <= 4;
}

// A usable AppUserModelID. Windows accepts any string of at most 128 characters with no whitespace,
// which is exactly what a desktop app's Start Menu shortcut carries - Achievement Watcher's own id
// is "io.github.shirowwww.achievement.watcher", with no "!" and no "_". The old check only accepted
// the packaged shape, so the app's real identity was reported as invalid (issue #8).
function isValidAUMID(appID) {
  if (typeof appID !== 'string') return false;
  const value = appID.trim();
  if (!value || value.length > 128 || /\s/.test(value)) return false;
  return true;
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

// Every AppUserModelID Windows knows about, lower-cased. One PowerShell spawn answers the question
// for all candidates at once, instead of one spawn per id.
async function listAumids() {
  try {
    const script = 'Get-StartApps | ForEach-Object { $_.AppID }';
    const { stdout } = await execFileAsync(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    });
    return String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Exact Start Menu AppUserModelID lookup - the only check that answers the question that actually
// matters: "will Windows display a toast posted under this id?". Windows silently drops toasts for
// an id that no installed app owns, which is how the hardcoded "Microsoft.XboxApp_…" default kept
// failing on Windows 11 (the classic Xbox app no longer ships) while the format check said the id
// was fine. `has({id})` matches by regex and can hit lookalikes, so this does a strict comparison.
async function hasAumid(aumid, known = null) {
  if (typeof aumid !== 'string' || !aumid.trim()) return false;
  const list = Array.isArray(known) ? known : await listAumids();
  return list.includes(aumid.trim().toLowerCase());
}

module.exports = { has, hasAumid, listAumids, isValidAUMID, isPackagedAUMID };
