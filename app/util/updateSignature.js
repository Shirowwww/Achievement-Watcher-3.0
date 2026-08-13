'use strict';

const { execFile } = require('child_process');
const path = require('path');

// Electron inherits the developer's PowerShell 7 module path on some systems. A child Windows
// PowerShell 5 process then tries to load incompatible module metadata and cannot find
// Get-AuthenticodeSignature. Point it at its own built-in module directory instead.
const WINDOWS_POWERSHELL_MODULES = path.join(
  process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'Modules'
);

function publisherMatches(subject, publisherNames) {
  const names = Array.isArray(publisherNames) ? publisherNames : [publisherNames];
  return names
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .some((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|,\\s*)CN=${escaped}(?=,|$)`, 'i').test(String(subject || ''));
    });
}

function evaluateUpdateSignature(publisherNames, signature) {
  const subject = signature && signature.SignerCertificate && signature.SignerCertificate.Subject;

  // Older releases can be unsigned, and electron-updater already verifies the SHA-512 in
  // latest.yml before this hook runs. Do not turn a valid legacy update into an error solely
  // because it predates the local signing setup.
  if (!subject) return null;

  // A self-signed release certificate is deliberately not a Windows-trusted root on every PC.
  // Match the configured publisher CN, rather than Authenticode's trust status, so a legitimate
  // Shirow-signed update works on a fresh Windows installation as well.
  if (publisherMatches(String(subject), publisherNames)) return null;

  const expected = (Array.isArray(publisherNames) ? publisherNames : [publisherNames]).filter(Boolean).join(' | ');
  return `installer is not signed by ${expected || 'the configured publisher'} (subject: ${subject})`;
}

function verifyUpdateCodeSignature(publisherNames, unescapedTempUpdateFile, log = () => {}) {
  return new Promise((resolve) => {
    const tempUpdateFile = String(unescapedTempUpdateFile || '').replace(/'/g, "''");
    const command = `Get-AuthenticodeSignature -LiteralPath '${tempUpdateFile}' | ConvertTo-Json -Compress`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', command],
      {
        timeout: 20 * 1000,
        windowsHide: true,
        env: { ...process.env, PSModulePath: WINDOWS_POWERSHELL_MODULES },
      },
      (error, stdout, stderr) => {
        if (error || stderr) {
          log(`[updater] signature check could not run: ${error || stderr}`);
          resolve(null); // Keep the legacy updater fallback for a broken PowerShell installation.
          return;
        }
        try {
          const result = evaluateUpdateSignature(publisherNames, JSON.parse(stdout));
          if (result === null) log('[updater] update signer accepted');
          resolve(result);
        } catch (err) {
          resolve(`signature check failed to parse: ${err.message}`);
        }
      }
    );
  });
}

module.exports = {
  publisherMatches,
  evaluateUpdateSignature,
  verifyUpdateCodeSignature,
};
