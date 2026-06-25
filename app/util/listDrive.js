'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

/*
  List local fixed drive letters (e.g. ["C:", "D:"]).

  The legacy implementation shelled out to WMIC, which is deprecated and has been
  REMOVED from Windows 11 24H2+ — there the custom-folder scan used to fail outright.
  We now query CIM via PowerShell (accurate DriveType=3 / fixed-disk filtering) and
  fall back to a dependency-free drive-letter probe if PowerShell is unavailable or
  returns nothing. Output format ("C:") is kept identical to the old behaviour so the
  callers (glob cwd) are unaffected.
*/
module.exports = (option = {}) => {
  const ignoreSystemDrive = option.ignoreSystemDrive || false;
  const systemDrive = (process.env['SystemDrive'] || 'C:').toUpperCase();

  const probeLetters = () => {
    const drives = [];
    for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
      const letter = String.fromCharCode(c) + ':';
      try {
        if (fs.existsSync(letter + '\\')) drives.push(letter);
      } catch {
        /* drive not ready / inaccessible -> skip */
      }
    }
    return drives;
  };

  const finalize = (drives) => {
    let list = drives.filter((d) => /^[A-Za-z]:$/.test(d));
    if (ignoreSystemDrive) list = list.filter((d) => d.toUpperCase() !== systemDrive);
    return list;
  };

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID",
      ],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        let drives = [];
        if (!err && stdout) {
          drives = String(stdout)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s !== '');
        }
        if (drives.length === 0) drives = probeLetters(); //PowerShell missing/blocked -> native fallback
        resolve(finalize(drives));
      }
    );
  });
};
